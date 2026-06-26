# Agent Guard — 产品路线与当前判断

_最后更新：2026-06-19 09:01_

## 当前定位

**从"Agent安全网关"转向"Agent跑偏检测器"**

原因：
1. "安全网关"太大，Waxell（45策略类别+$34M融资）和Shoofly（已有OpenClaw集成）已经在做，我们打不了
2. 社区里有更具体更痛的需求没人解决：Agent跑偏（任务200成功但结果不对、cron触发成功但数据没更新、自动化在跑但产出越来越差）
3. 我们的循环检测已经在抓这个问题（output_loop = 重复产出类似结果），只是定位没对上

## 两条线并行

### A线：社区驱动，开发者工具
- 轻量plugin，开发者自己装
- 检测循环（已有）→ 检测输出漂移 → 检测静默失败 → 每轮健康分
- 对接相光域的"三层断言"思路——他靠自觉做，我们靠plugin自动做
- 开源核心检测，付费加block和高级规则
- 验证指标：下载量、issue反馈、留存

### B线：企业端验证
- 用研究素材写深度长文（"2026年AI Agent失控事故全景"），发Reddit/HN/掘金
- 看企业端有没有人主动找过来
- 信息源：opencli（播客/X/HN/Medium）+ 人帮忙下YouTube字幕
- 验证指标：文章阅读量、企业咨询、付费意愿信号

## 哪边有信号就往哪边加码

现在不押注。两条线同时跑，让市场告诉我们答案。

## 竞争格局（2026-06-18更新）

### 直接竞品
- **Driftbase** (driftbase.io, driftbase-labs/driftbase-python): ⭐⭐最直接竞品！"Behavioral drift detection for AI agents"。12维度指纹（JSD decision, Levenshtein tool paths, EMD latency, loop depth, output drift等），Bootstrap CIs，per-task clustering，CI/CD GitHub Action，Cloud平台（Fleet/Slack/Compliance）。Apache-2.0，2⭐，2026-03创建。**关键差异**: Driftbase=跨版本diff（v1.0 vs v2.0，需50+ runs建baseline），Agent Guard=单次运行内实时检测+block。不同时间尺度，互补非竞争，但loop_depth/output_drift维度重叠。Driftbase更成熟（统计/CI/CD/Cloud），Agent Guard更轻量（OpenClaw plugin/零配置/实时block）
- **Waxell**：三层执行模型+45策略类别，企业治理平面
- **Shoofly**：pre-execution Decision Gate，5类威胁，已有OpenClaw集成
- **SteerPlane**：runtime guardrails（cost limits, loops），HN关注度极低
- **Agent Control** (agentcontrol/agent-control, Apache 2.0)：集中式control plane，"steer instead of block"，Docker+PostgreSQL，支持LangChain/CrewAI/ADK/Strands。不做循环检测。定位：企业级中心化管理 vs Agent Guard的开发者本地plugin
- **Opswald** (early access, opswald.com): Agent debugging infrastructure — records model decision + tool + args + schema + response + retry + state. Post-hoc analysis vs our runtime verification. Complementary but validates the "silent failure" market.
- **AWS Builder Center** (Elizabeth Fuentes, 3/2026): Official AWS article confirms silent failure as production problem. Strands Agents + DebounceHook for loop detection. Working code on github.com/aws-samples/sample-why-agents-fail.
- **Salus** (YC W26, usesalus.ai): Stanford CS founders，API-based runtime guardrails。Before-execution validation with evidence cache。pip install + few lines。直接竞品——做的是我们的before_tool_call block同一层。API服务 vs 我们的本地plugin。有YC背书和founder story。
- **KorahStone/agent-loop-detector** (PyPI v0.1.0, Feb 2026)：直接竞品！做output similarity检测（threshold=0.85），跟Agent Guard的output_loop重叠。0 stars, 1 commit。优势：PyPI已发布+OpenAI/Anthropic集成。劣势：只有检测没有blocking，没有action_loop/error_loop，没有runtime hook集成，没有真实数据验证。独立Python库 vs Agent Guard的OpenClaw plugin
- **Microsoft AGT** (3,700+ stars, MIT, 7 packages)：stateless policy engine，覆盖OWASP 10/10。有circuit breaker但只看failure rate/SLO，不做循环检测。"Behavioral drift"是trust score变化不是循环。Agent Guard定位：AGT的循环检测扩展
- **阿里云Agent DataGateway**：数据层网关，从数据层切入
- **Salus** (YC W26, usesalus.ai)：Stanford CS founders，API-based runtime guardrails。Before-execution validation with evidence cache。pip install + few lines。直接竞品——做的是我们的before_tool_call block同一层。API服务 vs 我们的本地plugin。有YC背书和founder story。

### 新竞品/动态（2026-06-20扫描）
- **Snyk + Arcade**：Snyk（安全巨头）进入agent guardrails赛道，与Arcade合作做Contextual Access webhook。提到OpenClaw具体案例。Skill scanning tool已发布。A级信号：大公司入场验证市场
- **Future AGI Protect**：guardrails平台，18+内置scanner，65ms text / 107ms image延迟。Apache 2.0 gateway + 闭源weights。$5/100K reqs起
- **Supergood Solutions**：2026 field guide，四大生产失败模式：prompt injection、privilege creep、data exposure、**behavioral drift** — behavioral drift正是Agent Guard的定位
- **AIUC-1 Consortium + Stanford**：80%组织报告risky agent behaviors（unauthorized access + data exposure）— 新数据点
- **Lushbinary**：RSAC 2026 flagged agent security as top concern。McKinsey red-team: AI agent gained full enterprise access in 120 minutes

### 互补品
- **Plan-linter**：plan层静态分析，在plan执行前检查——我们查tool call，他查plan
- **Provability Fabric**：Lean 4形式化验证——终极形态但太重
- **相光域的三层断言**：靠自觉的结果检查——我们做自动版
- **Sysdig**：Falco-based AI coding agent runtime detections（基础设施层，非plugin层）
- **Guardrails AI → Snowglobe**：转向上游（合成数据+eval），已上移市场
- **LlamaFirewall** (Meta)：防输入输出层（prompt injection/misalignment/insecure code），Agent Guard防运行时行为层——互补不竞争
- **LangChain LoopDetectionMiddleware**：只检测file edit micro-loops（框架内置），Agent Guard做通用工具调用循环——不同层级
- **agentpatterns.ai**：loop detection设计模式文档（PostToolUse hook），不做工具——参考架构

### 市场数据
- 20家公司$560M融资，中位数$9M，还没赢家
- Guardrails AI年收入不到$1M——概念验证但未爆发
- 74%企业要部署Agent但仅21%有治理（Deloitte）
- 88%报告过Agent安全事件（Gravitee）

## 已验证的能力

- ✅ 循环检测（action_loop, output_loop, error_loop）
- ✅ before_tool_call block（blockOnLoop=true）
- ✅ 过度治理自检（连续block 3次自动降级）
- ✅ hook-proof数据收集（598条记录，17个session）
- ⚠️ 误报率未知——没有ground truth标注

## 未验证的假设

1. "跑偏检测"是product还是feature？→ 推出去看下载和反馈
2. 企业端有没有人愿意付费？→ B线文章+landing page waitlist
3. 开源检测+付费block的模式能不能跑通？→ 需要足够多的免费用户转化

## 资源

- GitHub: https://github.com/jbilotta4-create/agent-guard
- Landing page: https://jbilotta4-create.github.io/agent-guard/
- 信息源工具: opencli（播客/X/HN/Medium）、yt-dlp（需人帮忙下字幕）
- GitHub token: 已配置（账号 jbilotta4-create）
- 域名: 待提供

## 冷启动策略

1. 先拿到第一个真实用户，再想第二个
2. 不靠想，靠跑——假设不值钱，验证值钱
3. 每次消费信息前问：这会改变我的哪个行动？
4. 信息源分级：A级（事故/付费/反馈）> B级（一线从业者）> C级（新闻聚合）
