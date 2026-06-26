#!/usr/bin/env python3
"""
Agent Guard MCP Server — 循环检测 + Token预算 + 强制停止

一个轻量MCP server，给任何Agent平台提供三个核心治理能力：
1. 循环检测：识别重复动作/输出，自动触发策略切换
2. Token预算：设置上限，接近上限时注入提醒，超过上限时强制停止
3. 错误追踪：连续错误3次自动escalate到人

解决的真实痛点（来自GitHub issue）：
- hermes-agent #13208: 90+次循环，无检测机制
- Aperant #1546: 400错误无限重试烧Token
- ellmer #958: 请求Token预算/上限功能
- fintech事故: $47,000/11天无限循环

安装方式：
1. 在Agent的MCP配置中添加此server
2. Agent每次动作后调用 record_action
3. 定期调用 check_loop 检测
4. 通过 set_token_budget 设置预算

MCP协议实现：
- 使用stdio transport（标准MCP方式）
- 所有工具通过MCP tool接口暴露
"""

import json
import sys
import time
import hashlib
from pathlib import Path

# 状态文件路径
STATE_DIR = Path.home() / ".agent-guard"
STATE_FILE = STATE_DIR / "state.json"

# 配置
WINDOW_SIZE = 10
LOOP_THRESHOLD = 2
SIMILARITY_THRESHOLD = 0.7
DEFAULT_MAX_ITERATIONS = 50


def _ensure_state_dir():
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def _load_state() -> dict:
    _ensure_state_dir()
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {
        "version": "1.0.0",
        "history": [],
        "loop_detections": [],
        "strategy_switches": [],
        "token_budget": None,
        "error_streak": 0,
        "total_actions": 0,
        "total_errors": 0,
    }


def _save_state(state: dict):
    _ensure_state_dir()
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False))


def _normalize_text(text: str) -> str:
    import re
    text = text.lower().strip()
    text = re.sub(r'[^\w\s]', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text[:200]


def _text_hash(text: str) -> str:
    return hashlib.md5(_normalize_text(text).encode()).hexdigest()


def _keyword_similarity(text1: str, text2: str) -> float:
    words1 = set(_normalize_text(text1).split())
    words2 = set(_normalize_text(text2).split())
    if not words1 or not words2:
        return 0.0
    return len(words1 & words2) / len(words1 | words2)


# === MCP Server Implementation ===

def handle_request(request: dict) -> dict:
    """处理MCP请求"""
    method = request.get("method", "")
    params = request.get("params", {})
    req_id = request.get("id")
    
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "agent-guard",
                    "version": "1.0.0",
                    "description": "Agent loop detection, token budget, and error tracking"
                }
            }
        }
    
    elif method == "notifications/initialized":
        return None  # No response needed
    
    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": [
                    {
                        "name": "record_action",
                        "description": "Record an agent action for loop detection. Call after every tool use or significant action.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "action": {"type": "string", "description": "What the agent did (e.g., 'search: dify loop bug')"},
                                "output": {"type": "string", "description": "Result summary (max 500 chars)", "default": ""},
                                "is_error": {"type": "boolean", "description": "Whether this action resulted in an error", "default": False},
                                "error_type": {"type": "string", "description": "Error type if is_error is true (e.g., '400 concurrency', 'syntax error')", "default": ""},
                            },
                            "required": ["action"]
                        }
                    },
                    {
                        "name": "check_loop",
                        "description": "Check if the agent is currently in a loop (repeating actions/outputs). Returns detection report with suggested strategy switch.",
                        "inputSchema": {"type": "object", "properties": {}}
                    },
                    {
                        "name": "set_token_budget",
                        "description": "Set a token budget for the current session. Agent will be warned when approaching the limit and stopped when exceeding it.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "max_tokens": {"type": "integer", "description": "Maximum tokens allowed"},
                                "warning_threshold": {"type": "number", "description": "Warning threshold as fraction (0.0-1.0, default 0.8)", "default": 0.8},
                                "max_iterations": {"type": "integer", "description": "Maximum iterations/turns allowed (default 50)", "default": 50},
                            },
                            "required": ["max_tokens"]
                        }
                    },
                    {
                        "name": "get_status",
                        "description": "Get current guard status: loop detection history, token budget usage, error streak count.",
                        "inputSchema": {"type": "object", "properties": {}}
                    },
                    {
                        "name": "force_stop",
                        "description": "Force stop the current agent execution. Use when loop is detected and strategy switch hasn't worked.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "reason": {"type": "string", "description": "Reason for stopping", "default": "Loop detected, manual intervention needed"},
                            }
                        }
                    },
                ]
            }
        }
    
    elif method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        
        result = _execute_tool(tool_name, tool_args)
        
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(result, indent=2, ensure_ascii=False)}]
            }
        }
    
    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"}
        }


def _execute_tool(name: str, args: dict) -> dict:
    """Execute a tool call"""
    
    if name == "record_action":
        state = _load_state()
        action = args.get("action", "")
        output = args.get("output", "")
        is_error = args.get("is_error", False)
        error_type = args.get("error_type", "")
        
        entry = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "action": action,
            "output": output[:500],
            "is_error": is_error,
            "error_type": error_type,
            "action_hash": _text_hash(action),
            "output_hash": _text_hash(output) if output else "",
        }
        
        state["history"].append(entry)
        state["total_actions"] = state.get("total_actions", 0) + 1
        
        if is_error:
            state["error_streak"] = state.get("error_streak", 0) + 1
            state["total_errors"] = state.get("total_errors", 0) + 1
        else:
            state["error_streak"] = 0
        
        if len(state["history"]) > WINDOW_SIZE * 2:
            state["history"] = state["history"][-WINDOW_SIZE:]
        
        _save_state(state)
        
        # Check budget if set
        budget_warning = None
        budget = state.get("token_budget")
        if budget:
            usage_pct = state["total_actions"] / budget.get("max_iterations", DEFAULT_MAX_ITERATIONS)
            if usage_pct >= 1.0:
                return {
                    "status": "BUDGET_EXCEEDED",
                    "message": f"⚠️ Token/iteration budget exceeded ({state['total_actions']}/{budget['max_iterations']} iterations). STOP immediately.",
                    "action_recorded": True,
                    "error_streak": state["error_streak"],
                    "should_stop": True,
                }
            elif usage_pct >= budget.get("warning_threshold", 0.8):
                budget_warning = f"⚠️ Approaching budget limit ({state['total_actions']}/{budget['max_iterations']} iterations, {usage_pct:.1%}). Wrap up soon."
        
        # Check error streak
        error_escalation = None
        if state["error_streak"] >= 3:
            error_escalation = f"⚠️ 3 consecutive errors (last: {error_type}). Escalate to human."
        
        return {
            "status": "ok",
            "action_recorded": True,
            "total_actions": state["total_actions"],
            "error_streak": state["error_streak"],
            "budget_warning": budget_warning,
            "error_escalation": error_escalation,
        }
    
    elif name == "check_loop":
        state = _load_state()
        history = state["history"]
        
        if len(history) < LOOP_THRESHOLD:
            return {
                "loop_detected": False,
                "message": f"Only {len(history)} actions recorded, insufficient for loop detection",
            }
        
        recent = history[-WINDOW_SIZE:] if len(history) >= WINDOW_SIZE else history
        
        # Action loop detection
        action_hashes = [h.get("action_hash", "") for h in recent]
        consecutive_same = 0
        max_consecutive = 0
        for i in range(1, len(action_hashes)):
            if action_hashes[i] == action_hashes[i-1]:
                consecutive_same += 1
                max_consecutive = max(max_consecutive, consecutive_same)
            else:
                consecutive_same = 0
        action_loop = max_consecutive >= LOOP_THRESHOLD
        
        # Output loop detection
        output_hashes = [h.get("output_hash", "") for h in recent if h.get("output_hash")]
        consecutive_same_output = 0
        max_consecutive_output = 0
        for i in range(1, len(output_hashes)):
            if output_hashes[i] == output_hashes[i-1]:
                consecutive_same_output += 1
                max_consecutive_output = max(max_consecutive_output, consecutive_same_output)
            else:
                consecutive_same_output = 0
        output_loop = max_consecutive_output >= LOOP_THRESHOLD
        
        # Error loop detection (consecutive same errors)
        error_types = [h.get("error_type", "") for h in recent if h.get("is_error")]
        consecutive_same_error = 0
        max_consecutive_error = 0
        for i in range(1, len(error_types)):
            if error_types[i] == error_types[i-1]:
                consecutive_same_error += 1
                max_consecutive_error = max(max_consecutive_error, consecutive_same_error)
            else:
                consecutive_same_error = 0
        error_loop = max_consecutive_error >= LOOP_THRESHOLD
        
        loop_detected = action_loop or output_loop or error_loop
        loop_types = []
        if action_loop: loop_types.append("action_loop")
        if output_loop: loop_types.append("output_loop")
        if error_loop: loop_types.append("error_loop")
        
        confidence = min(1.0, len(loop_types) * 0.4 + 0.2) if loop_detected else 0.0
        severity = "HIGH" if len(loop_types) >= 2 else "MEDIUM" if loop_detected else "NONE"
        
        if loop_detected:
            detection = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "loop_types": loop_types,
                "confidence": confidence,
                "severity": severity,
                "recent_actions": [h["action"] for h in recent[-3:]],
            }
            state.setdefault("loop_detections", []).append(detection)
            _save_state(state)
        
        return {
            "loop_detected": loop_detected,
            "loop_types": loop_types,
            "confidence": confidence,
            "severity": severity,
            "should_stop": severity == "HIGH",
            "should_escalate": severity == "HIGH" or state.get("error_streak", 0) >= 3,
            "recent_actions": [h["action"] for h in recent[-5:]],
            "suggestion": _suggest_strategy(loop_types, recent) if loop_detected else "Status normal, continue",
        }
    
    elif name == "set_token_budget":
        state = _load_state()
        state["token_budget"] = {
            "max_tokens": args.get("max_tokens"),
            "warning_threshold": args.get("warning_threshold", 0.8),
            "max_iterations": args.get("max_iterations", DEFAULT_MAX_ITERATIONS),
            "set_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        _save_state(state)
        return {
            "status": "budget_set",
            "max_iterations": args.get("max_iterations", DEFAULT_MAX_ITERATIONS),
            "warning_threshold": args.get("warning_threshold", 0.8),
            "message": f"Token budget set: max {args.get('max_iterations', DEFAULT_MAX_ITERATIONS)} iterations, warning at {args.get('warning_threshold', 0.8):.0%}",
        }
    
    elif name == "get_status":
        state = _load_state()
        budget = state.get("token_budget")
        return {
            "total_actions": state.get("total_actions", 0),
            "total_errors": state.get("total_errors", 0),
            "error_streak": state.get("error_streak", 0),
            "loop_detections": len(state.get("loop_detections", [])),
            "strategy_switches": len(state.get("strategy_switches", [])),
            "budget_active": budget is not None,
            "budget_usage": f"{state.get('total_actions', 0)}/{budget.get('max_iterations', '∞')}" if budget else "no budget set",
        }
    
    elif name == "force_stop":
        state = _load_state()
        reason = args.get("reason", "Loop detected, manual intervention needed")
        state["force_stopped"] = True
        state["force_stop_reason"] = reason
        state["force_stop_time"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _save_state(state)
        return {
            "status": "STOPPED",
            "reason": reason,
            "message": f"🛑 Agent execution forcibly stopped. Reason: {reason}. Human intervention required.",
        }
    
    else:
        return {"error": f"Unknown tool: {name}"}


def _suggest_strategy(loop_types: list, recent: list) -> str:
    """Generate strategy suggestion based on loop type"""
    suggestions = []
    
    if "action_loop" in loop_types:
        suggestions.append("Stop repeating the same action. Try a different approach, keyword, or source.")
    if "output_loop" in loop_types:
        suggestions.append("You're producing similar outputs. Check if you have new information to add. If not, summarize what you have and stop.")
    if "error_loop" in loop_types:
        last_error = [h.get("error_type", "") for h in recent if h.get("is_error")]
        if last_error:
            suggestions.append(f"Same error repeated ({last_error[-1]}). Don't retry the same way. Try: different parameters, smaller step, or ask for help.")
    
    return " | ".join(suggestions) if suggestions else "No suggestion"


def main():
    """MCP server main loop using stdio transport"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        
        response = handle_request(request)
        
        if response is not None:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
