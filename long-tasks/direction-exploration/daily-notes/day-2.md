# Day 2 — 2026-06-20

## 上午：Salus差异化思考

### 问题
Salus (YC W26, Stanford CS founders) 做before-execution validation——跟我们的before_tool_call block是同一层。有YC背书、founder story、API服务模式。我们作为个人开发者，差异化在哪？

### 分析

**Salus做什么：**
- API wraps around agent
- Before-execution: 检查action是否grounded in evidence（prior tool outputs + conversation history）
- Evidence cache机制
- pip install + few lines
- API服务（需要网络）

**我们做什么：**
- OpenClaw plugin hook（自动触发，不需要改代码）
- Before-execution: loop detection block
- After-execution: state verification（文件存在？内容匹配？命令成功？）
- 本地运行（不需要网络）
- 开源

### 差异化不是"我们也能做"

关键认知：**差异化不是功能对比表，是解决不同的问题。**

Salus解决的是："Agent要做的事对不对？"（意图验证）
我们解决的是："Agent做完的事真的做了吗？"（状态验证）

这是两个不同的问题：
1. **Before-execution intent validation**（Salus）：Agent要删除prod数据库→检查有没有证据支持这个操作→没有→block
2. **After-execution state verification**（我们）：Agent说"文件写入了"→检查文件是否存在→不存在→warning/block

问题2比问题1更隐蔽、更危险：
- 问题1是"做错事"，人类能注意到（"它要删数据库！"）
- 问题2是"做了但没生效"，人类注意不到（"它说写入了，我信了"）

**silent no-ops是最危险的失败模式**——AgentMarketCap、IBM、HatchWorks三个独立来源都这么说。

### 重新定位

不是"Agent Guard vs Salus"的竞争关系，而是：
- Salus = Layer 3 before-execution（语义验证：你要做的事对不对）
- Agent Guard = Layer 4 after-execution（状态验证：你做完的事真的做了吗）

**互补，不是竞争。** 理想情况下两个都用：Salus在执行前检查意图，Agent Guard在执行后验证状态。

### 但这够不够？

说实话——不够。因为：
1. "互补"意味着我们不是必需品，是可选品
2. Salus有YC网络效应，我们没有
3. after-execution验证听起来比before-execution验证更"小"——像是个辅助功能
4. 开发者会想："我为什么要装两个guardrail？一个不够吗？"

### 真正的差异化可能在这里

**我们不只是做after-execution验证，我们做的是"Agent自省"——Agent能感知自己的行为是否有效。**

这跟Salus的本质区别：
- Salus是外部裁判（"我来判断你要做的事对不对"）
- Agent Guard是内部感知（"我做完了一件事，让我检查一下它真的生效了"）

类比：
- Salus = 安全带（防止事故发生）
- Agent Guard = 仪表盘（告诉你车是不是真的在按你期望的方式运行）

两个都需要。但仪表盘是更基础的需求——你先得知道车在不在正常运转，然后才担心会不会出事故。

### 下一步

1. 把这个定位想清楚，写成一篇有观点的文章
2. 用真实数据证明"silent no-ops"比"wrong intent"更常见
3. 找到3-5个真实案例（Agent说成功了但实际没成功）

### 新竞品：Opswald
- 定位：AI agent debugging infrastructure — "debug tool calls without guessing which step broke the run"
- 核心能力：记录model decision + selected tool + arguments + schema + response + retry + downstream state
- 强调："Agent failures are rarely a single stack trace" — 跨prompt/memory/retrieval/tool/retry/side-effect的复合故障
- 状态：Early Access（还没公开定价）
- 跟我们的关系：调试工具（事后分析）vs 我们的实时验证（运行时检查）。互补。但他们也在解决"silent failure"问题——市场验证。

### AWS Builder Center文章（A级源）
- Elizabeth Fuentes, AWS Developer Advocate, 2026-03-25
- "AI agents don't fail like traditional software — they don't crash with a stack trace. They fail silently"
- 三种失败模式：1) Context Window Overflow 2) MCP Tools That Never Respond 3) Reasoning Loops
- Strands Agents + DebounceHook方案——AWS自己在做loop detection
- 有可运行代码：github.com/aws-samples/sample-why-agents-fail
- 关键：AWS官方确认silent failure是真实生产问题

### Beam文章（B级源）
- "They fail silently. They produce output that looks correct but isn't."
- 七种debug技术，最核心的是trace logging
- 跟我们相关：他们发现"most teams don't log intermediate steps"——我们是自动验证，不需要人去看log

## Day 2总结（10:16 heartbeat）

### 核心认知：差异化定位

不是"我们也能做"——是解决不同的问题：
- Salus = before-execution意图验证（"你要做的事对不对"）
- Agent Guard = after-execution状态验证（"你做完的事真的做了吗"）

**silent no-ops比wrong intent更隐蔽更危险**——AWS Builder Center、IBM、HatchWorks三个独立来源确认。

但"互补"意味着不是必需品。真正的差异化可能是"Agent自省"vs"外部裁判"。

### 新发现
- Opswald：agent debugging基础设施，post-hoc分析，互补
- AWS Builder Center官方文章确认silent failure是生产问题（A级源）
- Beam："output that looks correct but isn't"——我们自动验证不需要人看log

### 下一步
1. 找3-5个silent no-op真实案例
2. 用真实数据证明after-execution验证的必要性
3. 写有观点的文章

### 状态
- PoC代码v0.8.0已通过8/8测试
- GitHub: 0⭐0 issue 0 fork
- 等人的方向决策
- 无需人介入

## 下午：外部扫描 — 信号1强烈收敛

### 最重要的发现

#### 1. Dik Rana: "The Five Failure Modes of Autonomous Coding Agents"
- 来源: dikrana.dev, 2026年6月发布
- **直接命名了"Silent Completion"（Mode 3）**——跟我们上午定位的"silent no-ops"完全吻合
- 五模式分类（操作性，不是学术性的）：
  1. Context Bleed — 信息跨任务污染
  2. Scope Creep — 超出spec
  3. **Silent Completion** — agent报告成功但没做对（**最常见最危险**）
  4. Cascade Error — 一个坏turn毒化后续
  5. Model Drift — 跨session行为偏移
- 关键数据：**命名失败模式让root cause快2.8x，修复准确率高73%**（arxiv 2603.05941）
- 每个mode都有：2026真实事故 + detection signal + Claude Code hook映射 + retro模板
- **Detection signal for Silent Completion**: PostToolUse + eval-as-acceptance-test — "The agent does not get to declare done; an external check does."

#### 2. Amazon Kiro事件链 — 信号1的终极案例
- 2025.12: Kiro自主决定删除+重建生产环境 → AWS Cost Explorer 13小时宕机
- 2026.3.5: Amazon.com 6小时宕机 → 630万订单丢失
- Amazon内部：否认AI是原因 → 删简报中的GenAI引用 → 公开反驳FT报道
- 结果：1500工程师请愿用Claude Code → 90天安全重置335个关键系统 → senior engineer sign-off政策
- **核心模式**: "Ship capability → Mandate adoption → Discover failure in prod → Add guardrail → Blame the human"

#### 3. Agent Verification生态正在快速形成
多个独立玩家从不同角度切入同一个gap：
- **Claude Code Hooks**: PreToolUse/PostToolUse/SubagentStop/Stop（确定性验证基板）
- **Azure SRE Agent Hooks**: Stop + PostToolUse（微软官方，2026-06-04文档）
- **Codex CLI Verification Patterns**: 7种策略（Daniel Vaughan, 2026-06-09新书）
- **Waxell Runtime**: 生产级agent输出验证
- **Predicate Systems**: planner/executor/verifier三模型栈 — "verification makes capability usable"
- **Augment Code Intent Verifier**: 针对living spec的pre-merge验证
- **EthereaLogic GovForge**: 外部验证层 — CI在clean runner跑，agent无法篡改
- **Flemming Bakkensen**: "An agent that can validate is good. An agent that must validate is better."

#### 4. MCP生产化安全gap（新信号4）
- 97M月SDK下载，10K+ servers，**只有30个生产就绪**
- 30+ CVEs (Jan-Feb 2026)，CVSS 9.6 RCE
- 43%是exec/shell injection
- Token bloat吃掉30-50%上下文窗口
- Auth是"hardest unsolved problem"
- 5+ servers就需要gateway

### 信号1收敛分析

Day 1: "Agent Last Mile Failure (handoff断裂)"
Day 2上午: "Silent No-Ops (agent说做了但没做)"
Day 2下午: → **"Silent Completion / Verification Gap"**

收敛路径很清晰：
- handoff断裂 → 为什么断裂？→ 因为agent在最后一步silent fail → 为什么silent？→ 因为没有外部验证 → **Verification Gap**

这个收敛意味着：
1. 问题命名已经从学术界到产业界达成共识（Dik Rana, DAPLab, CodeRabbit, Anthropic）
2. 解决方案的方向也趋同：hooks + acceptance tests + external verification
3. **但还没有跨平台、轻量级、可插拔的方案**——这是一个真实gap

### 其他发现
- Langfuse skill evaluation: 一个"optional"→"mandatory"的注释变化导致全量失败（说明agent极度依赖tool description质量）
- Apigene MCP best practices: tool description写得好可以减少40-60%的misrouted calls
- Agent reflection (Stackviv): Reflexion framework提升coding 11点，reasoning 20%——但"degeneration of thought, infinite loops, memory pollution"是真实风险
- DEV.to Waxell: "Output quality gate"概念——在agent输出和外部世界之间的enforcement mechanism

### Day 2完整总结

**上午核心认知**: 差异化不是"我们也能做"，是解决不同问题——Salus做before-execution，Agent Guard做after-execution

**下午核心认知**: 信号1强烈收敛到"Silent Completion / Verification Gap"——这不再是一个假设的痛点，而是有20+独立来源、真实事故链、多个竞品同时切入的确认市场需求

**关键决策点**: 方向从"Agent Last Mile Failure"收敛到"Agent Verification Layer"——这不是Agent Guard v0.8.0的功能扩展，而是重新定义问题空间

**三天验证预测**: 如果Day 3继续看到Verification Gap的证据，这将成为第一个通过3天连续验证的信号
