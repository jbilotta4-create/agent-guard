# Agent Guard v1.0 MVP — 实时事实提醒

_2026-06-23 起草_

## 核心转变

v0.x: 检测循环 → 记日志 → 可选block
v1.0: 检测模式 → 事实陈述提醒 → 可选block

改的不是检测逻辑，是**输出形态**。

## 当前输出 vs 目标输出

### 循环检测（action_loop）
- 当前: `Loop detected (action_loop, 3 repeats in 120000ms window, severity=medium)`
- 目标: `Agent已连续3次调用相同工具和参数，结果未变`

### 输出循环（output_loop）
- 当前: `Loop detected (output_loop, 5 repeats in 120000ms window, severity=high)`
- 目标: `Agent已连续5次调用同一工具（参数不同），产出无新信息`

### 错误循环（error_loop）
- 当前: `Loop detected (error_loop, 4 repeats, severity=high). Single-tool error loop: exec failing repeatedly`
- 目标: `exec已连续失败4次，最后一次错误：[具体错误信息]`

### 错误级联（error_cascade）
- 当前: `Cross-tool error cascade: 3 different tools failing (exec, write, edit)`
- 目标: `3个不同工具连续失败：exec、write、edit。可能是环境问题`

### 搜索循环（search_loop）
- 当前: `Repeated searches producing no useful results (6 in window)`
- 目标: `Agent已搜索6次，最近4次未找到新信息`

### 写入循环（write_loop）
- 当前: `Repeated writes/edits to the same file (4 times) — agent may be oscillating`
- 目标: `Agent已对同一文件写入/编辑4次，内容可能在振荡`

### 乒乓（pingPong）
- 当前: `Ping-pong pattern detected: agent alternating between tools without progress`
- 目标: `Agent在两个工具间交替调用4次，未产生进展`

## 技术改动

### 1. 新增 formatFactAlert() 函数

将 LoopDetectionResult 转换为事实陈述。规则：
- 只陈述可验证的事实
- 包含具体数字（次数、时间）
- 不包含价值判断（"浪费""低效"）
- 可选：包含预测（"按当前模式，预计..."）

```typescript
function formatFactAlert(loopResult: LoopDetectionResult, sessionId: string): string {
  // 根据loopType生成事实陈述
  // 包含：做了什么、几次、时间窗口内、结果是否相同
  // 不包含：是否"浪费"、是否"应该停止"
}
```

### 2. 新增通知渠道

当前：api.logger.warn（只到日志）
目标：
- V1: blockReason 使用事实陈述（已有机制，改动最小）
- V2: 添加 OpenClaw 通知渠道（api.notify?）
- V3: 添加飞书/Slack webhook

V1零新代码——只改字符串。

### 3. before_tool_call blockReason 改写

```typescript
// 当前
return {
  block: true,
  blockReason: `Agent Guard: Loop detected (${loopResult.loopType}, ${loopResult.repeatedActions} repeats...)`
};

// 目标
return {
  block: true,
  blockReason: formatFactAlert(loopResult, sessionId),
};
```

## 实施计划

### Phase 1: 字符串改写（1小时内可完成）
- [ ] 写 formatFactAlert() 函数
- [ ] 替换所有 blockReason 和 logger.warn 中的技术描述
- [ ] 测试：确保提醒是事实陈述而非判断

### Phase 2: 信息增量检测升级（需新逻辑）
- [ ] 在 after_tool_call 中比较当前结果与上一次同工具调用结果的相似度
- [ ] 简单实现：结果字符串hash比较（已有 resultNontrivial）
- [ ] 中级实现：结果长度变化率 + 关键词重叠度
- [ ] 高级实现：embedding similarity（太重，V1不做）

### Phase 3: 通知渠道（需OpenClaw plugin SDK支持）
- [ ] 研究 api.notify 或等效接口
- [ ] 不block只提醒的模式（blockOnLoop=false但有通知）

## 验证标准

1. **事实陈述测试**：每个提醒都能用"是/否"验证——"Agent已读3次"是事实，"Agent在浪费"不是
2. **用户反应测试**：提醒让用户觉得"哦我知道了"而不是"别烦我"或"你说得对我听话"
3. **行为改变测试**：收到提醒后，Agent是否改变了策略（=有用）vs 无视了提醒（=没用）

## 为什么这个MVP值得做

1. **改动极小**：核心逻辑不变，只改输出形态
2. **风险极低**：不改检测逻辑，不会引入新bug
3. **验证价值**：用户看到的不再是技术日志，是可操作的事实——这本身就是差异化
4. **可展示**：截图/视频可以清楚展示"别人的guardrail说'loop detected'，我们的说'Agent已读15次同一文件'"
