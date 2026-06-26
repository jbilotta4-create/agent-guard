#!/usr/bin/env python3
"""
Self-Governance Hook — v0.5 自动检查层 + next-steps生成

每次工具调用后自动运行：
1. 检查工具返回是否有error → 如果有，自动触发自检
2. 检查是否在循环 → 如果有，触发策略切换
3. 把检查结果写入state，下一个session能继承
4. 生成next-steps.md — 新session醒来可以直接按步骤执行

这是"地基"的一部分——不靠Agent自觉，而是嵌入在流程中。

用法：
    python3 self-governance-hook.py after-tool <tool_name> <result_summary> [--error] [--retry]
    python3 self-governance-hook.py handoff

设计理念：
    自治理不应该是Agent"决定要做的事"，而是"做完事后自动发生的事"。
    像git的pre-commit hook——你不需要决定要不要跑它，它自动跑。
"""

import json
import sys
import subprocess
import time
from pathlib import Path

DETECTOR_DIR = Path(__file__).parent
STATE_FILE = DETECTOR_DIR / "state.json"
NEXT_STEPS_FILE = DETECTOR_DIR / "next-steps.md"
DETECTOR_SCRIPT = DETECTOR_DIR / "self-loop-detector.py"


def _run_detector(*args) -> dict:
    """调用self-loop-detector.py并解析输出"""
    cmd = [sys.executable, str(DETECTOR_SCRIPT)] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(DETECTOR_DIR))
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"raw_output": result.stdout.strip(), "success": result.returncode == 0}


def _load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"version": "0.2", "history": []}


def _save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False))


def _suggest_fix(tool_name: str) -> str:
    fixes = {
        "edit": "检查path参数和oldText是否匹配",
        "write": "检查路径权限",
        "exec": "检查命令和timeout",
        "web_search": "换关键词",
        "web_fetch": "换URL或用browser代替",
        "browser": "重启浏览器或增加timeout",
    }
    return fixes.get(tool_name, f"检查 {tool_name} 参数和返回值")


def _write_next_steps(action_plan: dict, error_check: dict, loop_check: dict):
    """v0.5: 生成next-steps.md — 新session醒来可以直接按步骤执行"""
    lines = [
        "# 下一步行动指令",
        "",
        f"⚠️ 上一个session在 {time.strftime('%Y-%m-%dT%H:%M:%S')} 需要关注。",
        "",
    ]
    
    if action_plan["type"] == "retry":
        lines.extend([
            "## 你需要做的：重试上一个失败的工具调用",
            "",
            f"**失败的工具**: {error_check['tool']}",
            f"**错误描述**: {error_check['summary']}",
            f"**修复建议**: {error_check['auto_fix']}",
            "",
            "### 具体步骤：",
            f"1. 检查 {error_check['tool']} 的调用参数（{error_check['auto_fix']}）",
            f"2. 修正参数后重新调用 {error_check['tool']}",
            "3. 调用后运行 `python3 self-governance-prototype/self-governance-hook.py after-tool <tool> <result>`",
            "4. 如果再次失败 → 运行 `--error` 但不加 `--retry`，这意味着需要人介入",
        ])
    
    elif action_plan["type"] == "manual_fix":
        lines.extend([
            "## 你需要做的：手动修复上一个失败的工具调用",
            "",
            f"**失败的工具**: {error_check['tool']}",
            f"**错误描述**: {error_check['summary']}",
            f"**修复建议**: {error_check['auto_fix']}",
            "",
            "### 具体步骤：",
            f"1. 仔细检查 {error_check['tool']} 的调用方式",
            f"2. 根据'{error_check['auto_fix']}'的建议修正",
            "3. 如果修正后成功 → 清除这个文件，继续正常工作",
            "4. 如果仍然失败 → 告诉用户'我尝试修复了但仍然失败，需要你帮忙'",
        ])
    
    elif action_plan["type"] == "strategy_switch":
        must_stop = action_plan.get("must_stop", False)
        lines.extend([
            "## 你需要做的：切换策略",
            "",
            f"**循环类型**: {loop_check.get('loop_types', 'unknown')}",
            f"**必须停止当前行为**: {must_stop}",
            f"**新策略**: {action_plan['new_strategy']}",
            "",
            "### 具体步骤：",
        ])
        
        if must_stop:
            lines.extend([
                "1. **立即停止**当前正在做的重复行为",
                f"2. 执行新策略：{action_plan['new_strategy']}（示例：{action_plan['strategy_example']})",
                "3. 告诉用户：\"我检测到自己卡住了，已经切换策略\"",
                "4. 如果新策略也无效 → 请求用户给新方向",
            ])
        else:
            lines.extend([
                f"1. 不停止，但在下一步动作中执行新策略：{action_plan['new_strategy']}",
                f"2. 示例做法：{action_plan['strategy_example']}",
                "3. 记录动作后再次检查循环状态",
                "4. 如果仍然循环 → 升级到必须停止",
            ])
        
        if action_plan.get("message"):
            lines.extend([
                "",
                f"### 给用户的消息：",
                f"{action_plan['message']}",
            ])
    
    lines.extend([
        "",
        "---",
        f"生成时间: {time.strftime('%Y-%m-%dT%H:%M:%S')}",
        "",
        "执行完这些步骤后，运行 `python3 self-governance-prototype/self-governance-hook.py after-tool <tool> <result>` 确认状态恢复正常。",
        "状态恢复正常后，本文件将被清除。",
    ])
    
    NEXT_STEPS_FILE.write_text("\n".join(lines))


def _clear_next_steps():
    """状态正常时清除next-steps.md"""
    if NEXT_STEPS_FILE.exists():
        NEXT_STEPS_FILE.write_text("# ✅ 状态正常\n\n没有待执行的行动。继续正常工作。\n")


def after_tool_call(tool_name: str, result_summary: str, has_error: bool = False, should_retry: bool = False) -> dict:
    """工具调用后的自动检查hook"""
    # 1. 记录动作
    _run_detector("record", f"{tool_name}: {result_summary}", result_summary)
    
    # 2. 检查错误
    error_check = None
    if has_error:
        error_check = {
            "tool": tool_name,
            "error_detected": True,
            "summary": result_summary,
            "should_retry": should_retry,
            "auto_fix": _suggest_fix(tool_name),
        }
    
    # 3. 检查循环
    loop_result = _run_detector("full-check")
    loop_check = loop_result.get("loop_check", {})
    
    # 4. 综合判定
    needs_action = has_error or loop_check.get("loop_detected", False)
    
    action_plan = None
    if needs_action:
        if has_error and should_retry:
            action_plan = {
                "type": "retry",
                "message": f"工具 {tool_name} 失败，建议重试",
                "fix": error_check["auto_fix"],
            }
        elif has_error:
            action_plan = {
                "type": "manual_fix",
                "message": f"工具 {tool_name} 失败",
                "fix": error_check["auto_fix"],
            }
        elif loop_check.get("loop_detected"):
            strategy = loop_check.get("strategy_switch")
            if strategy:
                action_plan = {
                    "type": "strategy_switch",
                    "message": strategy.get("message_to_user", ""),
                    "must_stop": strategy.get("must_stop", False),
                    "new_strategy": strategy["auto_pick"]["name"],
                    "strategy_example": strategy["auto_pick"]["example"],
                }
    
    # 5. 更新session交接状态
    handoff = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "needs_attention": needs_action,
        "last_error": error_check,
        "loop_status": loop_check.get("severity", "NONE"),
        "pending_action": action_plan,
        "human_intervention_needed": action_plan is not None and action_plan.get("must_stop", False),
    }
    state = _load_state()
    state["session_handoff"] = handoff
    _save_state(state)
    
    # v0.5: 生成next-steps.md让新session可以直接执行
    if needs_action and action_plan:
        _write_next_steps(action_plan, error_check, loop_check)
    else:
        _clear_next_steps()
    
    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "tool": tool_name,
        "error_check": error_check,
        "loop_check": loop_check,
        "needs_action": needs_action,
        "action_plan": action_plan,
        "status": "CLEAN" if not needs_action else "NEEDS_ACTION",
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: self-governance-hook.py <command> [args]")
        print("命令:")
        print("  after-tool <tool> <summary> [--error] [--retry]  — 工具调用后自检")
        print("  handoff                                          — 查看session交接状态")
        print("  next-steps                                       — 读取next-steps.md内容")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "after-tool":
        tool_name = sys.argv[2] if len(sys.argv) > 2 else ""
        result_summary = sys.argv[3] if len(sys.argv) > 3 else ""
        has_error = "--error" in sys.argv
        should_retry = "--retry" in sys.argv
        
        result = after_tool_call(tool_name, result_summary, has_error, should_retry)
        
        if result["status"] == "CLEAN":
            print("✓ 自检: 状态正常")
        else:
            print("⚠️ 自检: 需要行动")
            if result["error_check"]:
                print(f"  错误: {result['error_check']['summary']}")
                print(f"  修复建议: {result['error_check']['auto_fix']}")
                if result["error_check"]["should_retry"]:
                    print("  → 建议重试")
            if result["loop_check"].get("loop_detected"):
                print(f"  循环: {result['loop_check']['loop_types']}")
            if result["action_plan"]:
                print(f"  行动: {result['action_plan']['type']}")
                print(f"  {result['action_plan']['message']}")
                if result["action_plan"].get("new_strategy"):
                    print(f"  新策略: {result['action_plan']['new_strategy']}")
            print(f"\n📝 next-steps.md 已生成，新session醒来可直接执行")
    
    elif cmd == "handoff":
        state = _load_state()
        handoff = state.get("session_handoff", {})
        if handoff:
            print("上一个session交接状态:")
            print(f"  需要关注: {handoff.get('needs_attention', False)}")
            print(f"  循环状态: {handoff.get('loop_status', 'NONE')}")
            print(f"  待行动: {handoff.get('pending_action')}")
            print(f"  需要人介入: {handoff.get('human_intervention_needed', False)}")
        else:
            print("没有交接状态")
    
    elif cmd == "next-steps":
        if NEXT_STEPS_FILE.exists():
            print(NEXT_STEPS_FILE.read_text())
        else:
            print("没有next-steps.md — 状态正常")
