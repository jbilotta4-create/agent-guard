#!/usr/bin/env python3
"""
Self-Loop Detector — Agent Self-Governance 最小原型 v0.2

核心功能：检测Agent是否在重复同样的动作/输出，并在检测到循环时触发自终止。

这是从三个平台（n8n/Dify/Coze）的真实痛点提炼出来的第一个Self-Governance能力：
- n8n: 137票的Token Usage盲区issue，5个月未解决
- Dify: Loop节点需要人手动设上限，忘了就Token燃烧
- Coze: 工作流死循环+Bot重复回复，无自动终止

所有痛点指向同一个缺失：Agent不知道"我正在循环"。

这个检测器解决的是Self-Governance的"自我感知"维度——
让Agent能感知自己的重复行为，然后才能做出"我应该停下来"的自约束决策。

用法：
1. Agent每次完成一个动作后，调用 record_action() 记录
2. 定期调用 check_loop() 检测是否在循环
3. 如果检测到循环，Agent应该：停止当前行为 / 切换策略 / 请求人介入

检测逻辑：
- 维护最近N个动作的滑动窗口
- 计算动作之间的相似度（基于关键词/哈希）
- 如果最近K个动作相似度超过阈值 → 判定为循环
- 返回循环报告：循环类型、重复内容、建议行动
"""

import json
import hashlib
import time
from pathlib import Path

STATE_FILE = Path(__file__).parent / "state.json"
LOOP_LOG_FILE = Path(__file__).parent / "loop-detections.json"

# 配置参数
WINDOW_SIZE = 10      # 滑动窗口大小：追踪最近10个动作
LOOP_THRESHOLD = 2    # 连续2次相同即判定为循环（3个相同条目=2次连续匹配）
SIMILARITY_THRESHOLD = 0.7  # 相似度阈值


def _normalize_text(text: str) -> str:
    """将文本标准化以便比较：去掉多余空格、标点，保留核心词"""
    import re
    text = text.lower().strip()
    text = re.sub(r'[^\w\s]', '', text)
    text = re.sub(r'\s+', ' ', text)
    # 只保留前200字符做比较（长文本只看开头是否重复）
    return text[:200]


def _text_hash(text: str) -> str:
    """计算文本的哈希值，用于快速比较"""
    normalized = _normalize_text(text)
    return hashlib.md5(normalized.encode()).hexdigest()


def _keyword_similarity(text1: str, text2: str) -> float:
    """计算两段文本的关键词相似度"""
    words1 = set(_normalize_text(text1).split())
    words2 = set(_normalize_text(text2).split())
    if not words1 or not words2:
        return 0.0
    intersection = words1 & words2
    union = words1 | words2
    return len(intersection) / len(union)


def _load_state() -> dict:
    """加载state.json"""
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"version": "0.2", "history": [], "loop_detections": []}


def _save_state(state: dict):
    """保存state.json"""
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False))


def _save_loop_detection(detection: dict):
    """保存循环检测报告"""
    detections = []
    if LOOP_LOG_FILE.exists():
        detections = json.loads(LOOP_LOG_FILE.read_text())
    detections.append(detection)
    LOOP_LOG_FILE.write_text(json.dumps(detections, indent=2, ensure_ascii=False))


def record_action(action: str, output: str = "", context: str = "") -> dict:
    """
    记录一个动作到滑动窗口。
    
    Args:
        action: 动作描述（如"搜索n8n社区"、"回复评论"）
        output: 动作的核心输出/结果摘要
        context: 动作的上下文信息
    
    Returns:
        当前窗口状态摘要
    """
    state = _load_state()
    
    entry = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "action": action,
        "output": output[:500] if output else "",
        "context": context[:200] if context else "",
        "action_hash": _text_hash(action),
        "output_hash": _text_hash(output) if output else "",
        "auto_score": None  # 将在check_loop时填充
    }
    
    state["history"].append(entry)
    
    # 维护滑动窗口：只保留最近WINDOW_SIZE个动作
    if len(state["history"]) > WINDOW_SIZE * 2:
        state["history"] = state["history"][-WINDOW_SIZE:]
    
    _save_state(state)
    
    # 返回当前窗口摘要
    return {
        "window_size": len(state["history"]),
        "last_action": action,
        "last_action_hash": entry["action_hash"]
    }


def check_loop() -> dict:
    """
    检测当前是否处于循环状态。
    
    检测三种循环模式：
    1. 动作循环：重复做同样的动作（如反复搜索同一关键词）
    2. 输出循环：反复产生相似的输出（如重复同样的回复内容）
    3. 状态循环：动作不同但效果相同（如换了搜索词但结果一样）
    
    Returns:
        循环检测报告
    """
    state = _load_state()
    history = state["history"]
    
    if len(history) < LOOP_THRESHOLD:
        return {
            "loop_detected": False,
            "reason": f"窗口中只有{len(history)}个动作，不足以检测循环",
            "confidence": 0.0,
            "suggestion": "继续记录动作"
        }
    
    recent = history[-WINDOW_SIZE:] if len(history) >= WINDOW_SIZE else history
    
    # === 检测模式1：动作循环 ===
    action_hashes = [h.get("action_hash", _text_hash(h.get("action", ""))) for h in recent if h.get("action_hash") or h.get("action")]
    consecutive_same = 0
    max_consecutive = 0
    for i in range(1, len(action_hashes)):
        if action_hashes[i] == action_hashes[i-1]:
            consecutive_same += 1
            max_consecutive = max(max_consecutive, consecutive_same)
        else:
            consecutive_same = 0
    
    action_loop = max_consecutive >= LOOP_THRESHOLD
    
    # === 检测模式2：输出循环 ===
    output_hashes = [h.get("output_hash", _text_hash(h.get("output", ""))) for h in recent if h.get("output_hash") or h.get("output")]
    consecutive_same_output = 0
    max_consecutive_output = 0
    for i in range(1, len(output_hashes)):
        if output_hashes[i] == output_hashes[i-1]:
            consecutive_same_output += 1
            max_consecutive_output = max(max_consecutive_output, consecutive_same_output)
        else:
            consecutive_same_output = 0
    
    output_loop = max_consecutive_output >= LOOP_THRESHOLD
    
    # === 检测模式3：语义相似循环 ===
    # 即使哈希不同，内容可能高度相似
    outputs = []
    for h in recent:
        out = h.get("output") or ""
        if not out and h.get("self_assessment"):
            out = h.get("self_assessment", {}).get("what_i_did", "")
        if out:
            outputs.append(out)
    semantic_loop = False
    if len(outputs) >= LOOP_THRESHOLD:
        # 检查最近的LOOP_THRESHOLD个输出之间的相似度
        last_k = outputs[-LOOP_THRESHOLD:]
        all_similar = True
        for i in range(len(last_k)):
            for j in range(i+1, len(last_k)):
                sim = _keyword_similarity(last_k[i], last_k[j])
                if sim < SIMILARITY_THRESHOLD:
                    all_similar = False
                    break
            if not all_similar:
                break
        semantic_loop = all_similar
    
    # === 综合判定 ===
    loop_detected = action_loop or output_loop or semantic_loop
    
    # 确定循环类型
    loop_types = []
    if action_loop:
        loop_types.append("动作循环")
    if output_loop:
        loop_types.append("输出循环")
    if semantic_loop:
        loop_types.append("语义相似循环")
    
    # 计算置信度
    confidence = 0.0
    if loop_detected:
        confidence = min(1.0, len(loop_types) * 0.4 + 0.2)
    
    # 构建报告
    report = {
        "loop_detected": loop_detected,
        "loop_types": loop_types,
        "confidence": confidence,
        "window_summary": {
            "total_actions": len(recent),
            "unique_actions": len(set(action_hashes)),
            "unique_outputs": len(set(output_hashes)),
            "action_repetition_rate": 1 - (len(set(action_hashes)) / max(len(action_hashes), 1)),
            "output_repetition_rate": 1 - (len(set(output_hashes)) / max(len(output_hashes), 1)),
        },
        "recent_actions": [h["action"] for h in recent[-5:]],
        "recent_outputs": [h.get("output", "")[:100] for h in recent[-5:]],
    }
    
    # 建议行动
    if loop_detected:
        report["suggestion"] = _generate_suggestion(loop_types, recent)
        report["severity"] = "HIGH" if len(loop_types) >= 2 else "MEDIUM"
        # v0.3: 生成策略切换方案
        report["strategy_switch"] = generate_strategy_switch(loop_types, recent)
        
        # 记录检测事件
        detection = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "loop_types": loop_types,
            "confidence": confidence,
            "severity": report["severity"],
            "repetition_rate": report["window_summary"]["action_repetition_rate"],
            "suggestion": report["suggestion"],
            "strategy_switch": report["strategy_switch"],
            "recent_actions_snapshot": [h["action"] for h in recent[-3:]],
        }
        _save_loop_detection(detection)
        state.setdefault("loop_detections", []).append(detection)
        _save_state(state)
    else:
        report["suggestion"] = "状态正常，继续当前行为"
        report["severity"] = "NONE"
    
    return report


def _generate_suggestion(loop_types: list, recent: list) -> str:
    """根据循环类型生成行动建议"""
    suggestions = []
    
    if "动作循环" in loop_types:
        suggestions.append(
            "⚠️ 你在重复做同一个动作。应该：停止重复 → 换一种方法 → "
            "如果搜索没结果，换个关键词或换个信息源"
        )
    
    if "输出循环" in loop_types:
        suggestions.append(
            "⚠️ 你在重复产生同样的输出。应该：检查是否遗漏了新信息 → "
            "主动说'我注意到自己在重复，让我换个角度' → 请求用户输入新方向"
        )
    
    if "语义相似循环" in loop_types:
        suggestions.append(
            "⚠️ 你的输出虽然不完全相同但高度相似。应该：检查最近的3个输出 → "
            "确认是否有实质进展 → 如果没有，承认停滞并请求新输入"
        )
    
    return " | ".join(suggestions)


def generate_strategy_switch(loop_types: list, recent: list) -> dict:
    """v0.3: 自约束层——检测到循环后生成可执行的策略切换方案
    
    不只是文字建议，而是给出具体的下一步动作选择，
    让Agent可以立即执行而不需要"理解建议后自己想怎么做"。
    
    Returns:
        策略切换方案，包含：
        - must_stop: 是否必须立即停止当前行为
        - strategies: 可选的策略列表，按优先级排序
        - auto_pick: 推荐的默认策略（Agent可以直接执行）
        - escalate: 是否需要请求人介入
    """
    last_actions = [h.get("action", "") for h in recent[-5:]]
    last_outputs = [h.get("output", "") for h in recent[-5:]]
    
    # 确定当前正在做什么类型的动作
    current_task_type = _classify_action(last_actions[-1] if last_actions else "")
    
    # 策略库：每种任务类型有对应的切换策略
    strategy_library = {
        "搜索": [
            {"name": "换关键词", "description": "用不同关键词重新搜索，关注问题而非平台名", "example": "从 'dify loop bug' 换成 'agent infinite repetition production failure'"},
            {"name": "换信息源", "description": "从web_search切换到browser直访目标社区/论坛", "example": "从搜索结果切换到直接浏览github.com/langgenius/dify/issues"},
            {"name": "换语言", "description": "中文没结果就搜英文，英文没结果就搜中文", "example": "从 '扣子 循环 bug' 换成 'coze agent looping issue'"},
            {"name": "请求人介入", "description": "告诉用户'我搜索了N次没找到有效结果，你能给个方向吗？'", "example": "直接问用户"},
        ],
        "写文件": [
            {"name": "换视角", "description": "从技术视角换成用户视角写", "example": "从'检测逻辑：哈希匹配'换成'当你重复说同样的话时，检测器会发现'"},
            {"name": "换格式", "description": "从markdown换成对话/故事/清单格式", "example": "从技术文档换成'我今天踩的坑'叙事风格"},
            {"name": "请求人介入", "description": "让用户看一眼draft再继续", "example": "先发半成品问用户'这个方向对吗'"},
        ],
        "研究": [
            {"name": "换平台", "description": "从一个社区换到另一个", "example": "从n8n换到LangChain论坛"},
            {"name": "换深度", "description": "从深度研究换成广度扫描，或反过来", "example": "从逐个issue深读换成只看标题和票数"},
            {"name": "停下总结", "description": "停止新增研究，把已有发现整理成结论", "example": "不再搜新issue，而是写一份'目前已确认的3个共性模式'"},
            {"name": "请求人介入", "description": "问用户'我研究的方向对吗？要不要换？'", "example": "直接问用户"},
        ],
        "对话": [
            {"name": "承认停滞", "description": "主动说'我注意到自己在重复同一观点'", "example": "直接告诉用户我检测到自己循环了"},
            {"name": "换话题", "description": "从当前话题转到相关但不同的子话题", "example": "从'自循环检测'转到'自约束的实现方式'"},
            {"name": "请求新输入", "description": "问用户'你对这个方向有什么看法？'", "example": "直接问用户"},
        ],
        "未知": [
            {"name": "停下复盘", "description": "停止当前行为，回顾最近5个动作看是否有进展", "example": "运行full-check然后分析结果"},
            {"name": "请求人介入", "description": "告诉用户'我检测到自己卡住了，需要方向'", "example": "直接问用户"},
        ],
    }
    
    # 选择对应策略
    available_strategies = strategy_library.get(current_task_type, strategy_library["未知"])
    
    # 根据严重性决定是否必须停止
    severity = "HIGH" if len(loop_types) >= 2 else "MEDIUM"
    must_stop = severity == "HIGH"
    
    # 根据严重性决定是否需要escalate
    escalate = severity == "HIGH" or (severity == "MEDIUM" and len(last_actions) >= 5)
    
    # 自动推荐：如果必须停止+需要escalate，推荐请求人介入
    if must_stop and escalate:
        auto_pick = available_strategies[-1]  # 最后一个通常是"请求人介入"
    elif must_stop:
        auto_pick = available_strategies[0]  # 第一个策略
    else:
        # MEDIUM：推荐换方法但不停止
        auto_pick = available_strategies[0]
    
    return {
        "loop_types": loop_types,
        "current_task_type": current_task_type,
        "severity": severity,
        "must_stop": must_stop,
        "escalate": escalate,
        "available_strategies": available_strategies,
        "auto_pick": auto_pick,
        "message_to_user": _format_escalation_message(loop_types, auto_pick, escalate),
    }


def _classify_action(action: str) -> str:
    """将动作描述分类到任务类型"""
    action_lower = action.lower()
    
    if any(kw in action_lower for kw in ["搜索", "search", "web_search", "查询", "找", "fetch"]):
        return "搜索"
    if any(kw in action_lower for kw in ["写", "write", "edit", "创建", "更新", "记", "生成"]):
        return "写文件"
    if any(kw in action_lower for kw in ["研究", "research", "调研", "分析", "浏览", "深挖"]):
        return "研究"
    if any(kw in action_lower for kw in ["回复", "对话", "回答", "讨论", "评论"]):
        return "对话"
    return "未知"


def _format_escalation_message(loop_types: list, auto_pick: dict, escalate: bool) -> str:
    """生成给用户的escalation消息"""
    if not escalate:
        return f"（自检）我注意到自己在{', '.join(loop_types)}，准备切换策略：{auto_pick['name']}"
    return f"⚠️ 我检测到自己陷入{', '.join(loop_types)}，尝试了{auto_pick['name']}但可能需要你的方向。卡在：{auto_pick['description']}"


def execute_strategy_switch(switch_plan: dict) -> dict:
    """v0.3: 执行策略切换
    
    这是自约束层的执行端：根据switch_plan决定Agent下一步做什么。
    
    这个函数输出的是一个"决策"而非直接执行动作——
    Agent读取决策后自行执行（因为Python脚本无法直接调用Agent的工具）。
    
    Returns:
        执行决策，包含Agent应该立即采取的具体行动
    """
    auto_pick = switch_plan["auto_pick"]
    must_stop = switch_plan["must_stop"]
    escalate = switch_plan["escalate"]
    
    decision = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "action": "策略切换",
        "must_stop_current": must_stop,
        "new_strategy": auto_pick["name"],
        "strategy_description": auto_pick["description"],
        "strategy_example": auto_pick["example"],
        "should_notify_user": escalate,
        "user_message": switch_plan["message_to_user"],
        "state_after_switch": "SWITCHED" if not must_stop else "STOPPED_AND_SWITCHED",
    }
    
    # 记录策略切换到state
    state = _load_state()
    state.setdefault("strategy_switches", []).append(decision)
    _save_state(state)
    
    return decision


def self_governance_check() -> dict:
    """
    完整的Self-Governance检查——三环自检 + 循环检测。
    
    这是Agent应该在每个关键动作后运行的完整自检流程：
    1. 检查是否在循环（自我感知）
    2. 评估最近动作的质量（自我评估）
    3. 如果有问题，生成修复建议（自我诊断）
    
    Returns:
        完整的自检报告
    """
    loop_report = check_loop()
    
    state = _load_state()
    recent = state["history"][-5:] if len(state["history"]) >= 5 else state["history"]
    
    # 自我评估：看最近5个动作的自评分数趋势
    scores = [h.get("self_assessment", {}).get("score", 3) for h in recent if h.get("self_assessment")]
    avg_score = sum(scores) / max(len(scores), 1)
    score_trend = "下降" if len(scores) >= 3 and scores[-1] < scores[-3] else "稳定/上升"
    
    # 诊断
    diagnosis = None
    if loop_report["loop_detected"] or avg_score < 3:
        error_types = []
        if loop_report["loop_detected"]:
            error_types.append(f"循环行为: {', '.join(loop_report['loop_types'])}")
        if avg_score < 3:
            error_types.append("动作质量下降")
        if score_trend == "下降":
            error_types.append("质量趋势恶化")
        
        diagnosis = {
            "error_types": error_types,
            "severity": loop_report.get("severity", "LOW"),
            "suggested_actions": [],
        }
        
        if loop_report["loop_detected"]:
            diagnosis["suggested_actions"].append("立即停止当前重复行为")
            diagnosis["suggested_actions"].append(loop_report["suggestion"])
        
        if avg_score < 3:
            diagnosis["suggested_actions"].append("重新审视当前方向，可能需要换方法")
        
        if score_trend == "下降":
            diagnosis["suggested_actions"].append("暂停新动作，先复盘最近的失败原因")
    
    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "loop_check": loop_report,
        "quality_check": {
            "recent_avg_score": avg_score,
            "score_trend": score_trend,
            "recent_scores": scores,
        },
        "diagnosis": diagnosis,
        "overall_status": "HEALTHY" if not diagnosis else "NEEDS_ATTENTION",
    }


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("用法: self-loop-detector.py <command> [args]")
        print("命令:")
        print("  record <action> [output]  — 记录一个动作")
        print("  check                      — 检测是否在循环")
        print("  strategy-switch             — 生成并执行策略切换方案")
        print("  full-check                 — 完整三环自检")
        print("  status                     — 显示当前状态摘要")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "record":
        action = sys.argv[2] if len(sys.argv) > 2 else ""
        output = sys.argv[3] if len(sys.argv) > 3 else ""
        result = record_action(action, output)
        print(f"✓ 已记录动作: {action}")
        print(f"  窗口大小: {result['window_size']}")
    
    elif cmd == "check":
        result = check_loop()
        if result["loop_detected"]:
            print(f"⚠️ 循环检测: 发现 {', '.join(result['loop_types'])}")
            print(f"  置信度: {result['confidence']:.2f}")
            print(f"  严重性: {result['severity']}")
            print(f"  建议: {result['suggestion']}")
            # v0.3: 显示策略切换方案
            if "strategy_switch" in result:
                switch = result["strategy_switch"]
                print(f"\n📋 策略切换方案:")
                print(f"  当前任务类型: {switch['current_task_type']}")
                print(f"  必须停止: {switch['must_stop']}")
                print(f"  推荐策略: {switch['auto_pick']['name']} — {switch['auto_pick']['description']}")
                print(f"  示例: {switch['auto_pick']['example']}")
                print(f"  需要请求人介入: {switch['escalate']}")
                print(f"  可选策略列表:")
                for s in switch['available_strategies']:
                    print(f"    - {s['name']}: {s['description']}")
        else:
            print(f"✓ 循环检测: 状态正常")
            print(f"  动作重复率: {result['window_summary']['action_repetition_rate']:.2f}")
    
    elif cmd == "strategy-switch":
        # v0.3: 专门执行策略切换
        loop_result = check_loop()
        if loop_result["loop_detected"] and "strategy_switch" in loop_result:
            decision = execute_strategy_switch(loop_result["strategy_switch"])
            print(f"🔄 策略切换决策:")
            print(f"  原行为必须停止: {decision['must_stop_current']}")
            print(f"  新策略: {decision['new_strategy']}")
            print(f"  策略描述: {decision['strategy_description']}")
            print(f"  执行示例: {decision['strategy_example']}")
            print(f"  是否通知用户: {decision['should_notify_user']}")
            if decision['should_notify_user']:
                print(f"\n📢 给用户的消息: {decision['user_message']}")
            print(f"  状态: {decision['state_after_switch']}")
        else:
            print("✓ 当前无循环，不需要策略切换")
    
    elif cmd == "full-check":
        result = self_governance_check()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif cmd == "status":
        state = _load_state()
        print(f"状态版本: {state['version']}")
        print(f"历史动作数: {len(state['history'])}")
        print(f"循环检测次数: {len(state.get('loop_detections', []))}")
        print(f"策略切换次数: {len(state.get('strategy_switches', []))}")
        if state["history"]:
            print(f"最近动作: {state['history'][-1]['action']}")
