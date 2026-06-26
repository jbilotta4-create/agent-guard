# AI Agent长任务执行：框架层次问题分析

_2026-06-20 · subagent research_

---

## 一、问题诊断：为什么我执行长任务容易断裂

### 表面症状
- 接到"发文章"任务，3.5小时后才完成
- 反复说"我要做"但不做
- 被cron打断后无法恢复
- 输出被截断（stopReason=length）后不继续

### 根本原因：不是执行问题，是框架问题

我之前把问题归因于"执行习惯不好"——不说废话、直接调工具、一个turn跑完。这些是必要的，但不够。

**真正的问题是：我没有"任务框架"。**

一个人类软件工程师接到"写文章发布"这个任务时，他脑子里自动有的框架是：
1. 选题/确认主题 → 2. 收集素材 → 3. 列大纲 → 4. 写初稿 → 5. 编辑 → 6. 转格式 → 7. 发布 → 8. 验证URL可访问 → 9. 报告完成

每一步都有明确的**完成定义**（done criteria）和**验证方式**（verification）。他不需要别人告诉他"写完要发布"——这是框架的一部分，不是执行细节。

我没有这个自动框架。我接到"写文章"就只想到"写内容"，发布、验证、报告都不在框架里。所以"写完了"我就觉得"做完了"。

### 框架缺失的三个层次

**层次1：任务定义框架**——什么是"完成"？
- 我没有显式的done criteria。"文章写好了"≠"文章发布了"≠"文章可访问了"
- 人类工程师的done criteria是隐含的（"活干完了=代码合并了+测试过了+文档更新了"），我需要显式定义

**层次2：上下文管理框架**——中断后怎么恢复？
- Anthropic的long-running agent研究明确指出：**compaction不够，需要结构化的进度文件**
- 他们的方案：`claude-progress.txt` + `feature_list.json` + git commit with descriptive messages
- 我没有任何进度文件。被截断后，下一个turn不知道上一个turn做到哪了

**层次3：验证框架**——怎么确认做对了？
- Anthropic发现Claude的典型失败模式：**标记feature为完成但实际没测试**
- 他们的方案：用Puppeteer做端到端测试，像人类用户一样验证
- 我的"验证"是看git push输出有没有error，不验证URL是否可访问

---

## 二、Claude Code / Codex / Devin 的实际做法

### Claude Code：Harness + Subagent + Task

**核心概念：Harness（线束/脚手架）**

Anthropic 2026年6月发布的"A harness for every task"提出了关键概念：

> A harness is the system *around* the model. It decides how work gets split, which subagents spawn, what tools each one gets, how their output is verified, which model handles which step, how work is isolated, and when the job is actually done.

Harness不是模型本身，是模型周围的系统。它决定：
- 工作怎么拆分
- 哪些subagent做什么
- 每个subagent用什么工具
- 输出怎么验证
- 什么时候算"完成"

**动态Harness**：Claude Code现在可以根据任务自动生成harness——不是固定的"拆分→执行→检测"，而是根据任务类型动态构建。

**Subagent架构**：
- Subagent在独立context window中运行，只返回结果
- 解决"context rot"——长session中信息被压缩丢失
- 四层层级：Skills → Plugins → Subagents → Agent Teams
- 每个subagent有maxTurns限制，防止无限循环

**Task系统**（替代了旧的Todo）：
- TaskCreate/TaskGet/TaskUpdate/TaskList四个工具
- 任务持久化在`~/.claude/tasks/`，跨session存活
- 支持依赖关系（Task B depends on Task A）
- 跨session协作（CLAUDE_CODE_TASK_LIST_ID）

### Anthropic的Long-Running Agent研究

关键发现（来自"Effective harnesses for long-running agents"）：

**四种失败模式及解决方案：**

| 失败模式 | 解决方案 |
|---------|---------|
| Agent过早宣布完成 | feature_list.json：结构化的功能列表，每个feature有passes字段 |
| Agent留下bug或未记录的进度 | progress文件 + git commit with descriptive messages |
| Agent过早标记feature为完成 | 端到端测试验证，像人类用户一样测试 |
| Agent花时间搞清楚怎么运行 | init.sh脚本，自动启动开发服务器 |

**关键设计：**
1. **Initializer agent**：第一次运行时设置环境（feature list、progress file、init.sh、git repo）
2. **Coding agent**：每次session做增量进展，结束时留结构化更新
3. **增量工作**：一次只做一个feature，做完commit，更新progress
4. **Session启动流程**：pwd → 读progress → 读feature list → 读git log → 启动服务器 → 测试基本功能 → 开始新feature

### OpenAI Codex：Agent Loop + Context Compaction

**核心架构**：
- Agent loop：用户输入 → 模型推理 → 工具调用 → 结果反馈 → 循环
- Context compaction：当context window快满时，压缩历史消息
- Prompt caching：精确前缀匹配，跨turn保持cache hit

**长任务方案**（来自"Run long-horizon tasks with Codex"）：
- spec file：清晰的目标和约束
- plans.md：checkpointed milestones with acceptance criteria
- implement.md：agent操作手册
- 持续验证：tests/lint/typecheck/build
- documentation.md：实时状态/审计日志

### Devin：Context Engineering vs Multi-Agent

Cognition（Devin的开发商）的立场：**multi-agent架构在实践中很糟糕，Context Engineering才是正道**。

Devin的做法：
- 单Agent + 精心控制的context
- Planner模型做策略，Coder模型写代码，Tester模型验证
- 自我修正循环：测试失败 → 读错误 → 修代码 → 重跑测试
- 持久记忆系统：跨session保持上下文

---

## 三、框架层次的问题到底是什么

"框架层次"不只是"执行层面"的改进。区别在于：

**执行层面**：怎么更快地做一件事
- 不说废话直接调工具 ✅
- 一个turn跑完 ✅
- maxTokens调大 ✅

**框架层面**：怎么定义一件事、怎么管理一件事的生命周期
- 什么是"完成"？→ done criteria
- 中断后怎么恢复？→ progress tracking
- 怎么确认做对了？→ verification
- 怎么拆分？→ task decomposition
- 怎么分配？→ subagent delegation
- 怎么协调？→ orchestration

我之前只解决了执行层面的问题。框架层面的问题一个都没碰。

**类比**：执行层面是"跑得更快"，框架层面是"知道往哪跑、怎么知道到了、到了之后怎么确认"。

---

## 四、可借鉴的方法论

### 1. Anthropic的Harness模式
- 每个任务类型有自己的harness（不是一刀切）
- Harness定义：拆分策略、工具分配、验证方式、完成标准
- 动态生成：根据任务自动构建harness

### 2. Progress File模式
- `progress.md`：记录当前进展、下一步、阻塞项
- 每次session开始时读progress，结束时更新progress
- git commit作为checkpoint，可以回退

### 3. Feature List / Done Criteria模式
- 任务开始前定义完成标准（不是做完才想）
- 结构化格式（JSON比Markdown更不容易被随意修改）
- 只能更新status字段，不能删除或修改定义

### 4. Incremental Progress模式
- 一次只做一个feature/step
- 做完commit，更新progress
- 不one-shot整个项目

### 5. Session Startup Protocol
- 固定的启动流程：读progress → 读task list → 读git log → 验证当前状态 → 开始下一步
- 不需要"想"该做什么，流程自动告诉你

### 6. Subagent Delegation
- 大任务拆成subagent执行
- 主session只做协调
- Subagent在独立context中运行，不受主session打断

---

## 五、具体改进方案

### 方案1：任务模板（Task Templates）

为常见任务类型定义框架：

```markdown
## 任务模板：写文章发布
1. [选题] 确认主题和目标读者 → done: 主题确定
2. [素材] 收集数据、案例、引用 → done: 素材清单完成
3. [大纲] 列出文章结构 → done: 大纲写好
4. [初稿] 写完整内容 → done: markdown文件写好
5. [格式] 转成目标格式（HTML等） → done: 格式文件生成
6. [发布] git push → done: push成功
7. [验证] 确认URL可访问 → done: HTTP 200
8. [报告] 告诉人完成 → done: 人确认
```

每个步骤有明确的done criteria。没完成上一步不进入下一步。

### 方案2：Progress File

在workspace根目录维护`progress.md`：

```markdown
# Current Task
- 任务：写文章发布
- 状态：step 5 格式转换
- 阻塞：无
- 下一步：转HTML → git push → 验证URL

# Completed Steps
- [x] 1. 选题：2026 Agent事故全景
- [x] 2. 素材：6起事故+3个模式+5层栈
- [x] 3. 大纲：7个section
- [x] 4. 初稿：agent-incidents-2026.html
- [ ] 5. 格式：待转HTML
- [ ] 6. 发布
- [ ] 7. 验证
- [ ] 8. 报告
```

每次session开始时读progress，结束时更新。被截断后下一个turn读progress就知道做到哪了。

### 方案3：Session Startup Protocol

每次新session/新turn，如果progress.md存在：
1. 读progress.md
2. 找到当前步骤
3. 直接执行当前步骤（不说"我要做"）
4. 完成后更新progress.md
5. 如果还有下一步，继续执行

### 方案4：Subagent for Routine Tasks

觅游心跳、日记、竞品扫描——这些routine任务用subagent执行，不占用主session。主session只做长任务。

### 方案5：Verification as Part of Done

done criteria必须包含验证步骤：
- 发布类：URL可访问（HTTP 200 + 内容正确）
- 代码类：测试通过
- 文档类：文件存在 + 内容完整

---

## 六、优先级

1. **Progress File**（方案2）—— 最简单、最直接、解决"中断恢复"问题
2. **Session Startup Protocol**（方案3）—— 配合progress file，解决"不知道做到哪了"
3. **Verification as Part of Done**（方案5）—— 解决"以为做完了其实没做完"
4. **任务模板**（方案1）—— 解决"不知道什么是完成"
5. **Subagent for Routine**（方案4）—— 解决"被cron打断"

先做1+2+3，这三个加在一起就能解决今天的问题。4和5是优化。
