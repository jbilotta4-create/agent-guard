# Agent Guard 竞品与互补品分析

## 核心定位

Agent Guard = **运行时行为治理** — 在工具调用执行前/后检测并阻止异常行为模式（循环、重复、错误级联）

## 竞品

### 直接竞品（循环检测/工具调用治理）

| 产品 | 公司 | 融资 | 方式 | 跟Agent Guard的区别 |
|------|------|------|------|-------------------|
| **Agent Governance Toolkit (AGT)** | **Microsoft** | 上市公司 | Agent OS policy engine + 7 packages, OWASP 10/10, 9500+ tests | **最大竞品** — 同为before-tool-call拦截，但覆盖全部10项OWASP风险，已集成Dify/LlamaIndex等14+框架，有TypeScript/.NET/Python SDK |
| Waxell | - | 未公开 | 三层治理平面+45策略类别 | 外部网关模式，非运行时内部 |
| Shoofly Decision Gate | - | 未公开 | before-action blocking | 外部代理模式，非平台hook |

### 间接竞品（Agent安全/治理，不同切入点）

| 产品 | 公司 | 融资 | 切入点 | 跟Agent Guard的关系 |
|------|------|------|--------|-------------------|
| **Cequence AI** | Cequence AI | 未公开 | Agentic Zero Trust + runtime behavioral monitoring | **竞品** — surfacing anomalous tool-call sequences，跟Agent Guard的before_tool_call同一思路 |
| **Prisma AIRS** | Palo Alto Networks | 上市公司 | Governance, Guardrails and Active Runtime Control | **竞品** — 大厂入场做runtime control |
| **LlamaFirewall** | Meta | 开源 | prompt injection + misalignment + insecure code | **互补** — 防外部输入/输出，Agent Guard防运行时行为 |
| Guardrails AI | - | $7.5M种子 | 输出验证 | **互补** — 验证输出，Agent Guard阻止执行 |
| AgentOps | - | 多轮 | 可观测性 | **互补** — 事后观察，Agent Guard事前阻止 |
| Llama Guard 4 | Meta | 开源 | 内容安全分类 | 不同层面 — 内容安全 vs 行为安全 |
| Plan-linter | - | 未公开 | plan层静态分析 | 不同阶段 — 规划时 vs 执行时 |

## 关键区分：互补 vs 竞争

```
防护层次：
  输入层 (prompt injection)  → LlamaFirewall PromptGuard 2
  规划层 (plan validation)   → Plan-linter
  执行层 (tool call governance) → Agent Guard ← 我们在这里
  输出层 (output validation) → Guardrails AI
  观测层 (observability)     → AgentOps
```

Agent Guard的独特位置：**执行层** — 在工具调用执行前检查和阻止。这是LlamaFirewall不覆盖的领域。

## OWASP ASI标准映射

Agent Guard直接覆盖的OWASP Top 10 for Agentic Applications 2026风险：
- **ASI02: Tool Misuse and Exploitation** — 循环检测+工具调用治理
- **ASI08: Cascading Failures** — error cascade检测

部分覆盖：
- **ASI03: Identity and Privilege Abuse** — 工具调用权限检查（待实现）

不覆盖：ASI01 (Goal Hijack), ASI04 (Supply Chain), ASI05 (RCE), ASI06 (Memory Poisoning), ASI07 (Inter-Agent Comm), ASI09 (Trust Exploitation), ASI10 (Rogue Agents)

完整10项：ASI01 Goal Hijack, ASI02 Tool Misuse, ASI03 Identity/Privilege, ASI04 Supply Chain, ASI05 RCE, ASI06 Memory Poisoning, ASI07 Inter-Agent Comm, ASI08 Cascading Failures, ASI09 Trust Exploitation, ASI10 Rogue Agents

## 数据支撑

- 88%组织遭遇agent安全事件 (RAIL/Deloitte)
- 仅6%安全预算分配给agentic AI风险
- 80%组织遭遇过agent风险行为 (McKinsey/SailPoint)
- LlamaFirewall把攻击成功率从17.6%降到1.7% — 但只覆盖输入/输出层
- Arthur AI: "Treat guardrails as first-class execution logic" — 跟Agent Guard的hook思路一致

## 待验证

- [ ] 运行时行为治理（循环检测）是否被LlamaFirewall的roadmap覆盖？
- [ ] Waxell/Shoofly的实际产品形态？是否有before-tool-call blocking？
- [ ] 市场是否愿意为"执行层防护"单独付费，还是期望LlamaFirewall等大平台覆盖？
- [ ] **Microsoft AGT已经覆盖了OWASP 10/10，Agent Guard只覆盖2/10——还需要独立存在吗？**
- [ ] AGT有OpenClaw集成吗？如果没有，Agent Guard可以作为AGT的OpenClaw适配层
- [ ] AGT的循环检测能力如何？它用的是YAML policy规则，能否检测到重复调用模式？

## Microsoft AGT 关键数据

- 发布时间：2026年4月2日（2个月前），6月13日更新
- 协议：MIT开源
- 3700+ GitHub Stars
- 七个包：Agent OS (policy engine), AgentMesh (trust), Agent Runtime (execution supervisor), Agent SRE (reliability), Agent Compliance (regulatory), Agent Marketplace (plugin lifecycle), Agent Lightning (RL training governance)
- 9500+ tests, sub-millisecond latency (<0.1ms p99)
- 已集成：Dify (65K stars), LlamaIndex (47K stars), LangChain, CrewAI, Google ADK, OpenAI Agents SDK, Haystack, LangGraph, PydanticAI
- SDK：Python, TypeScript (@microsoft/agentmesh-sdk), .NET (Microsoft.AgentGovernance)
- 暴露接口：ToolCallInterceptor, BaseIntegration, PluginInterface, PolicyProviderInterface
- 核心理念："Actions the AGT kernel denies are structurally impossible" — 确定性拦截而非概率性防护
- **关键：Agent OS是stateless的** — 每次评估只看当前action，不看历史。循环检测需要stateful（追踪历史调用），AGT架构不支持
- **AGT没有循环检测**：YAML policy只支持声明式规则（block-destructive, require-approval），不支持时序模式检测

## OpenClaw内置Loop Detection

- OpenClaw自己有内置的loop detection：`tools.loopDetection.enabled`
- 有rolling detectors和post-compaction guard
- post-compaction guard：compaction-retry后监控接下来几次工具调用，如果(toolName, argsHash, resultHash)三元组重复则abort
- 跟Agent Guard的循环检测有重叠
- **但OpenClaw内置只检测完全相同的调用（三元组匹配），不检测output_loop（同工具不同参数）**

## LangChain LoopDetectionMiddleware

- 只针对文件编辑场景（micro-loops）
- 检测同一文件被编辑N次后注入nudge prompt
- 不是通用的工具调用循环检测

## AgentPatterns.ai Loop Detection模式

- 定义为独立设计模式
- PostToolUse hook实现
- 跟Agent Guard的before_tool_call是同一思路但不同hook点
- 建议：检测到循环时inject nudge prompt而非直接block
