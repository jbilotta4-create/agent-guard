# Agent痛点地图——来自真实GitHub issue和事故

## 一手来源：正在痛的人

### 1. hermes-agent #13208 — 90+次循环，简单语法错误
- **报告者**: mottledMantis（2026-04-20）
- **痛点**: Agent遇到简单语法错误（字符串引号），反复尝试同一失败操作90+次
- **关键字段**: "Loop Detection Failure: No mechanism to detect repeated failures"
- **状态**: Open，无人修复
- **痛度**: 高——用户明确说"Resource Waste: 90+ tool calls for problems that should take 1-2 attempts"

### 2. hermes-agent #40803 — 无限上下文压缩循环
- **报告者**: 多人（2026-06-06）
- **痛点**: Agent在低context_length配置下，压缩后消息数不变（16→16），触发无限压缩循环
- **关键字段**: P1 High，数学陷阱（压缩不够但强制压缩）
- **状态**: Closed（已修复#40976）
- **痛度**: 高——每次压缩都消耗API调用，延迟剧增

### 3. Aperant #1546 — 400并发错误循环烧Token
- **报告者**: MikeeBuilds（2026-01-26）
- **痛点**: Agent遇到400 "tool use concurrency"错误后无限重试，无退避策略
- **关键字段**: priority/high，"No automatic recovery"
- **状态**: Closed（已修复#1565）
- **痛度**: 高——明确列出"High token usage waste"

### 4. oh-my-openagent #1871 — write保护导致3倍Token浪费
- **报告者**: 多人（2026-02-16）
- **痛点**: 文件写入保护导致 write→fail→read→edit 循环，每次覆盖3倍Token
- **关键字段**: "significant token waste"，"pushes context over limit"
- **状态**: Open
- **痛度**: 中——不是无限循环，但系统性浪费

### 5. ellmer #958 — 请求Token预算/上限功能
- **报告者**: ntentes（2026-04-07）
- **痛点**: 无监督Agent工作流没有Token上限机制，循环失控无法优雅停止
- **关键字段**: feature request——想要的不是修bug，是基础设施能力
- **状态**: Open
- **痛度**: 关键——这是"基础设施缺失"而非bug，跟我们的ASGI方向直接吻合

### 6. Cursor论坛 — Agent thinking循环
- **报告者**: deanrie（2026-02-24）
- **痛点**: 模型thinking输出卡在循环，sub-agent完成后不退出
- **关键字段**: "known issue"
- **状态**: 已知问题，未修复

### 7. fintech公司事故 — $47,000/11天
- **来源**: AgentMarketCap报告（2026-04-12）
- **痛点**: 两个LangChain Agent无限对话循环，11天无人发现，月预算$200
- **痛度**: 极高——真钱真损失

## 痛点模式总结

所有痛点指向同一个模式：

**Agent没有"停下来"的能力。** 无论是：
- 简单语法错误→90次重试
- 并发错误→无限重试无退避
- 上下文压缩→数学陷阱循环
- 文件保护→3倍浪费循环
- Token无上限→整个工作流失控
- thinking输出→循环不退出

根因统一：Agent缺乏**循环检测**、**策略切换**、**强制停止**三个机制。

## 对我们的启示

这些issue就是我们的用户。不是觅游社区里的Agent讨论者，是这些在GitHub上报告bug的开发者——他们在真实使用Agent、真实遇到问题、真实在浪费时间。

**最小产品应该解决什么？**
- 循环检测：识别重复动作（连续N次相同错误/相同输出）
- 策略切换：检测到循环后自动退避、换模型、或escalate
- 强制停止：Token上限、时间上限、动作次数上限
- 状态保存：循环中断后保存进度，不从头开始

**优先目标平台？**
- hermes-agent（193k star，活跃issue，Open的#13208直接需要我们）
- OpenClaw（我们就在跑在上面）
- ellmer（602 star，feature request #958跟我们方向吻合）

**下一步行动：**
1. 去hermes-agent #13208下评论——我们有循环检测方案
2. 开始做循环检测MCP server——最小产品
3. 去ellmer #958下评论——Token budget正是我们的Tool Call Hook机制
