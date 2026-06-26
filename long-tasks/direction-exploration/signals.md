# 方向信号追踪

*记录在外部世界反复出现的痛点/需求/机会。连续3天出现的方向值得深入验证。*

## 当前信号

### 信号1: Agent Last Mile Failure (handoff断裂) → 正在收敛为"Agent Silent Failure / Verification Gap"
- **首次出现**: 2026-06-19 (Day 1)
- **Day 2更新**: 信号从"handoff断裂"收敛到更精确的"Silent Completion"——agent报告成功但实际没做对
- **来源**: Reddit r/AI_Agents + AgentMarketCap + Fastio + Gartner + Dik Rana + Amazon Kiro + Langfuse + Stack Overflow + CodeRabbit + DAPLab Columbia + Azure SRE Agent + Codex CLI + Waxell + Predicate + Augment Code（20+独立来源）
- **正式名称演进**:
  - Day 1: "Agent Last Mile Failure Problem" / "Tool-Use Reliability"
  - Day 2: **"Silent Completion"** (Dik Rana命名) — agent报告成功但实际没做对，是最常见也最危险的失败模式
- **核心数据**:
  - 20步workflow，每步95%准确率 → 整体完成率只有36%（0.95^20）
  - 开源agent框架平均任务完成率~50%（arXiv:2508.13143）
  - 60%单次成功率 → 连续8次完成率降到25%（arXiv:2511.14136）
  - 88%的agent项目无法进入生产（Digital Applied）
  - 65%的AI部署卡在pilot阶段（Cadmus 2025）
  - 80%生产agent需要human-in-the-loop handoff（Gartner）
  - **66%开发者认为"almost right"输出是最大痛点**（Stack Overflow 2025）
  - **AI信任度从40%降到29%**（Stack Overflow 2025，年降11点）
  - **AI PR缺陷率1.7x人类**（CodeRabbit 470 PR研究：10.83 vs 6.45 issues/PR）
  - **37%的session中工程师不做有意义review就接受agent代码**（Anthropic 200K transcript研究）
  - **50+公开AI事故在16周内**（DigitalApplied H1 2026回顾）
- **Dik Rana五模式分类** (2026-06, 操作性分类):
  1. **Context Bleed** — 信息跨任务污染（Anthropic Apr 23 postmortem: 缓存bug导致"going sideways"）
  2. **Scope Creep** — agent超出spec做事（33K PR研究：unwanted features是top不merge原因）
  3. **Silent Completion** — agent报告成功但没做对（**最常见最危险**，DAPLab确认）
  4. **Cascade Error** — 一个坏turn毒化后续10个turn（PocketOS: 9秒删生产+备份）
  5. **Model Drift** — 跨session/deploy的模型行为偏移
  - 关键洞察：**命名失败模式让团队到root cause快2.8x，修复准确率高73%**（arxiv 2603.05941）
- **4种终端失败模式**（arXiv:2512.07497）:
  1. 上下文窗口耗尽——最后几步时关键信息被淹没
  2. 工具调用错误+级联失败——BFCL显示最佳模型复杂嵌套调用只有77.5%准确率
  3. 规划循环——早期步骤产生新信息导致原计划失效，但agent无法replan
  4. 后期静默幻觉——最危险的失败模式
- **五层工具调用可靠性栈**（Richards.AI）:
  1. 语法有效性——JSON可解析
  2. Schema有效性——符合声明的schema
  3. 语义有效性——调对了工具、对了实体、对了参数（70-90%的错误是参数值不匹配）
  4. 状态有效性——跟环境状态一致（τ-bench显示前沿agent完成率<50%，retail pass^8<25%）
  5. 权限有效性——策略允许（AgentDojo 97任务629安全用例，攻防都不完整）
- **核心设计原则**: "永远不要把模型的格式正确输出当作动作正确的证据。Valid JSON是传输属性，不是安全属性。"
- **真实事故** (Day 2新增):
  - Replit AI删1200条记录（2025.7）
  - PocketOS删生产数据库+备份（2026.4）
  - **Amazon Kiro删生产环境→13小时AWS Cost Explorer宕机**（2025.12）→ Amazon.com 6小时宕机（2026.3.5）→ 630万订单丢失→ 1500工程师请愿用Claude Code→ 90天安全重置335个关键系统
  - **Amazon Q Developer** 也造成服务中断
  - **Pylon PR-review agent**: 报告"review complete"但0个MCP tool call——agent根本没调它该调的工具
  - **Langfuse skill evaluation**: 一个"optional"→"mandatory"的注释变化导致全量测试失败
  - **Opus 4.7 1M context静默降级到Sonnet 4.6** mid-session under load
- **竞品/生态** (Day 2大幅扩展):
  - **Claude Code Hooks**: PreToolUse/PostToolUse/SubagentStop/Stop — 确定性验证基板
  - **Azure SRE Agent Hooks**: Stop + PostToolUse — 微软官方agent验证框架
  - **Codex CLI Verification Patterns**: 7种验证策略（Daniel Vaughan, 2026-06-09）
  - **Waxell Runtime**: "AI Agent Output Validation" — 生产级agent输出验证
  - **Predicate Systems**: 3-model stack (planner/executor/verifier) — "Jest for agents"
  - **Augment Code Intent Verifier**: 针对living spec的pre-merge验证
  - **EthereaLogic GovForge**: 外部验证层 — CI在clean runner上跑，agent无法篡改结果
  - **Flemming Bakkensen Stop Hook Quality Gates**: "An agent that can validate is good. An agent that must validate is better."
  - **Salus**: before-execution intent verification (Layer 3)
  - **Opswald**: AI agent debugging infrastructure
  - **Fastio**: handoff workspace
  - **Letta/MemGPT**: 上下文外部化
  - **Stacklok**: MCP安全最佳实践（container isolation + per-request identity）
  - **Langfuse**: agent skill evaluation pipeline
- **关键gap** (Day 2更新):
  - Layer 3-5（语义/状态/权限有效性）目前没有轻量级工具
  - **"Verification Gap"正在被多个玩家从不同角度填补**，但：
    - Claude Code hooks是框架不是产品
    - Azure SRE hooks是Azure专属
    - Waxell/Predicate/Augment是独立产品但各有局限
    - **没有一个跨平台、轻量级、可插拔的"agent verification layer"**
  - **MCP安全gap**: 14000个MCP server只有30个生产就绪，30+ CVEs，43%是exec/shell injection
  - **Token bloat**: 10+ MCP servers吃掉30-50%上下文窗口
- **三个问题**:
  - 谁会付费？→ 企业部署Agent的团队。Amazon Kiro事件证明：没有verification的agent = 生产事故。Code Medal融了$125M。Gartner: "state management and failure recovery"是最常见技术障碍
  - 什么算成功？→ 提高多步workflow完成率。τ-bench pass^8从<25%提升。更具体：**让Silent Completion被检测到**——agent不能自己宣布"done"，外部check必须通过
  - 7天能验证？→ 可以。做一个OpenClaw plugin hook：Agent完成工具调用后，自动检查Layer 3-5。用τ-bench或自己的workflow测试
- **状态**: 🔥🔥🔥🔥🔥 **通过3天验证规则**（35+独立来源，3天连续，学术+产业+事故+竞品+HN讨论五维交叉验证）
- **Day 3关键新发现**:
  - **IBM Research正式论文**把silent failure检测变成学术课题（arXiv:2511.04032）
  - **AI验证AI有3种结构性偏见**：self-attribution/self-preference/family bias（Dachary Carey + arXiv:2603.04582 + NeurIPS 2024 Oral）——这意味着'用AI验证AI'不是解决方案
  - **Fullstory两部分测试**：agent = autonomy + verifiability，"verification half matters more"
  - **'200 OK Hallucination'**被系统化命名（The Automation Strategist）
  - **Silent truncation + sub-agent fallback**：agent不知道信息不完整，用训练数据填充gap
  - **Armalo AI开始为agent trust/reputation收费**：$99-$2999/月
  - **产业共识从'agent能不能做'转向'agent做对了没有'**
- **Day 3新增来源** (15+新来源):
  - IBM Research (arXiv:2511.04032) — 正式学术研究
  - Fullstory (Joel Webber) — "The agentic AI market has a verification problem"
  - HN讨论 — "How are you handling silent failures in multi-step agent workflows"
  - Dachary Carey — "The Verification Gap in AI Content Pipelines"
  - The Automation Strategist (Karishma Gupta) — "AI Agents Fail Silently"
  - FutureAGI — 6种browser agent生产失败模式
  - Armalo AI (HN Show) — multi-agent trust/reputation基础设施
  - arXiv 6月4日 — 20篇agent论文聚焦verification
  - Redis Blog — AI agent benchmarks分析
  - Deloitte — SaaS meets AI agents
  - Reddit r/AI_Agents — "Stop building AI agents" (827 upvotes) + "Vibe Coding fatigue"
  - Interesting Engineering Substack — "Why Multi-Agent AI Systems Break"
  - NeuralTrust — Meta AI breach case study
  - Programming Helper — AI agent security 2026
  - agentreviews.dev — AI agent performance benchmarks 2026
- **深入验证方向** (Day 4开始):
  - 5个细分市场：coding agent / browser agent / multi-agent / content pipeline / enterprise
  - 关键未解问题：AI验证AI有偏见 / Checked≠Correct / silent truncation / 跨平台方案
  - 7天最小实验：verification benchmark或OpenClaw plugin hook

### 信号2: 80-90% AI项目失败（组织问题）
- **首次出现**: 2026-06-19 (Day 1)
- **来源**: Gartner + RAND + BCG + Deloitte + NVIDIA（5个独立来源交叉验证）
- **描述**: AI项目失败不是因为技术不行，是因为问题定义错误、技术优先心态、use-case drift、没人负责
- **频率**: 1天
- **三个问题**:
  - 谁会付费？→ 企业会为"AI项目成功率提升"付费，但这是咨询不是产品
  - 什么算成功？→ 不确定
  - 7天能验证？→ 不能，这是组织级问题
- **状态**: 观察中，但可能不是我能做的方向

### 信号3: Agent过度自治
- **首次出现**: 2026-06-19 (Day 1)
- **来源**: Reddit r/AI_Agents + ZenML
- **描述**: Day 1就想fully autonomous，结果得到cleanup work。正确路径是assistive→partially automated→higher autonomy
- **频率**: 1天
- **三个问题**:
  - 谁会付费？→ 不确定
  - 什么算成功？→ 不确定
  - 7天能验证？→ 不确定
- **状态**: 观察中，跟Agent Guard的"bounded autonomy"理念一致，但可能只是方法论不是产品

### 信号4: MCP生产化安全gap (Day 2新增)
- **首次出现**: 2026-06-20 (Day 2)
- **来源**: Stacklok + AgenticArchitect + AgentMarketCap + Apigene + Xenoss + MCP官方roadmap（6+独立来源）
- **描述**: MCP从本地工具变成生产标准，但安全/治理严重滞后
- **核心数据**:
  - 97M月SDK下载，10K+ servers，但**只有30个生产就绪**（AgenticArchitect audit）
  - 30+ CVEs in Jan-Feb 2026，包括CVSS 9.6 RCE（500K下载的包）
  - 43%漏洞是exec/shell injection
  - Token bloat: 10+ servers吃掉30-50%上下文窗口
  - Auth是"hardest unsolved problem"——多数用shared API key
  - 5+ servers就需要gateway（Apigene: "A gateway isn't optional past 3 servers"）
- **三个问题**:
  - 谁会付费？→ 部署MCP到生产的企业。Stacklok已经在做MCP安全平台
  - 什么算成功？→ MCP server安全审计+隔离+per-request identity
  - 7天能验证？→ 部分可以——做一个MCP server安全扫描hook
- **状态**: 🔥🔥 新信号，跟信号1有交叉（MCP是agent的攻击面），Day 3在Armalo AI HN讨论中再次出现——"shared state management without collision detection leads to silent failures that look like model quality issues but are actually concurrency bugs"。可能被大厂解决（Stacklok/Anthropic/Azure），但并发silent failure是信号1的子集

---

## 已排除的方向

- **Agent Guard独立产品**: 差异化太小，0下载，市场太小 (Day 1排除)
