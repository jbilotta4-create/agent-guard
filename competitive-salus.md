# Salus 竞品深度分析

_2026-06-20_

## 基本信息

- **公司**: Salus (YC W26)
- **创始人**: Kevin + Vedant (Stanford CS roommates)
- **团队**: 2人
- **定位**: Runtime guardrails that validate AI agent actions before they execute
- **网站**: usesalus.ai
- **定价**: Pilot $500/mo (1 tool route), Partner $2,500/mo (10 tool routes), Enterprise custom

## 核心产品

Salus是一个**policy-aware proxy**——坐在Agent和工具之间，在action执行前做验证。

### 验证逻辑
1. **Evidence grounding**: 维护evidence cache（所有前序工具调用输出+对话历史），验证proposed action是否有证据支撑
2. **Policy adherence**: 用YAML/markdown/plain English写约束，编译成runtime checks
3. **扩展能力**: PII检测、budget/loop protection、idempotency、human-in-the-loop escalation、content moderation

### 干预方式
不只是block，而是**clarify → repair → rewrite → escalate**，让修正后的action通过。
- 58%的blocked actions能通过structured feedback自修复

### 集成方式
- **API proxy模式**: 改endpoint URL，agent无感知
- **SDK decorator模式**: `@session.protect` 装饰器
- 支持OpenAI/Anthropic/LangChain/LangGraph/CrewAI/Retell/Vapi

### 基准测试
- τ²-bench: 遵循policy更可靠，成本降低60%
- ODCV-Bench: 12个前沿模型misalignment平均降低52%

### 定价模型
- 按protected tool route收费，不按agent数量
- 1个route = 1个backend action endpoint（如issue_refund）
- 10个agent共用1个refund endpoint = 1个route

## Salus的强项

1. **产品成熟度**: 有benchmark数据、有设计合作伙伴、有完整的shadow→live部署流程
2. **定位精准**: "commit-time is the moment of judgment"——不是事后检测，是事前拦截
3. **自修复**: block后给structured feedback，58%自修复率——不只是拦截，是帮agent纠错
4. **企业级定价**: $500/mo起步，说明已经找到了愿意付费的客户
5. **YC背书**: W26 batch，有Ankit Gupta作为partner
6. **文案极佳**: 整个网站文案水平远超一般AI公司，"wires sent, records written, patients booked"

## Salus的弱点/没做的事

1. **不做循环检测**: 他们的"loop protection"是budget/count类的，不是行为模式检测。不检测action_loop（同工具同参数重复）或output_loop（同工具不同参数但输出不收敛）
2. **不做漂移检测**: 不检测agent行为是否逐渐偏离预期基线
3. **不做post-execution验证**: 只做before-execution验证，不验证执行后结果是否正确（silent no-op问题）
4. **API依赖**: 必须走他们的proxy，有网络延迟（声称28ms avg）、有数据隐私顾虑、有单点故障风险
5. **2人团队**: 早期，feature delivery速度有限
6. **不覆盖OpenClaw生态**: 无OpenClaw plugin hook集成
7. **定价门槛高**: $500/mo把个人开发者和中小企业挡在门外

## Agent Guard vs Salus 对比

| 维度 | Agent Guard | Salus |
|------|-------------|-------|
| 检测时机 | before + after tool call | before execution only |
| 循环检测 | action_loop + output_loop + error_loop + pingPong | budget/count only |
| 漂移检测 | 可扩展 | 无 |
| Post-execution验证 | after_tool_call hook | 无 |
| 自修复 | block后agent自行重试（无structured feedback） | structured feedback，58%自修复 |
| 集成方式 | OpenClaw plugin hook（native） | API proxy / SDK decorator |
| 部署 | 本地plugin | 云端proxy |
| 延迟 | ~0（本地） | 28ms avg（网络） |
| 隐私 | 数据不出本机 | 工具调用经过Salus服务器 |
| 定价 | 开源免费 | $500/mo起 |
| 目标用户 | 个人开发者/小团队 | 企业 |
| Benchmark | 961条真实日志验证 | τ²-bench + ODCV-Bench |
| 成熟度 | v0.7, 0用户 | YC backing, 有design partners |
| 文案水平 | 一般 | 极强 |

## 关键结论

### Salus验证了市场，但留下了清晰的gap

1. **循环检测是真实gap**: Salus的"loop protection"只是budget/count限制，不是行为模式检测。这正是Agent Guard的强项
2. **Post-execution验证是第二个gap**: Salus只做before-execution，不做after-execution。silent no-op（200 OK但啥也没干）他们抓不到
3. **本地部署是第三个gap**: $500/mo + 数据经过第三方proxy，对隐私敏感场景和预算有限的团队是硬伤

### 但gap不等于机会

1. **Salus可以轻松加循环检测**: 他们有evidence cache，加个repetition detector是feature不是product
2. **自修复是他们的护城河**: 58%自修复率 + structured feedback，这是Agent Guard没有的
3. **定价差距也是定位差距**: Agent Guard免费但0用户，Salus $500/mo但有付费客户

### Agent Guard的差异化定位

**"Salus guardrails what the agent tries to do. Agent Guard catches what the agent keeps doing wrong."**

- Salus = pre-action policy check（这步该不该做）
- Agent Guard = runtime behavior monitoring（是不是在循环/跑偏/静默失败）

两者互补不竞争。理想状态是：Agent Guard检测到循环 → 触发Salus做policy check → Salus决定block/repair/escalate。

### 下一步

1. **写文章时不用打Salus**——我们是互补品，正面打没意义
2. **在README里明确互补定位**——"works alongside Salus for pre-action validation"
3. **循环检测 + post-execution验证**是Salus没做的，继续深耕
4. **开源免费**是分发优势——$500/mo的门槛让大量开发者无法尝试Salus
