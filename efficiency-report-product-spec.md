# Agent Efficiency Report — 产品形态定义

_2026-06-21 v0.1 — 初稿，待验证_

## 核心问题

用AI Agent的人只看结果，但结果不好时不知道为什么。

Agent Guard现在做的事：检测循环→block/警告。这是给Agent看的，不是给人看的。

转型方向：把Agent的工作过程变成人能看懂的效率报告。

## 报告给谁看？

**主要用户：用AI Agent做事的人**（不是做Agent的人）

- 用OpenClaw跑自动化任务的人
- 用Claude Code/Cursor写代码的人
- 用n8n/Dify搭工作流的人

他们的痛点：
1. "Agent跑了2小时，不知道在干嘛"
2. "任务说完成了，但结果不对，不知道哪步出了问题"
3. "Agent一直在重复搜索，浪费token"
4. "cron任务每天跑，但不知道产出质量在变差"

**次要用户：管理Agent团队的人**（企业场景，后期）

## 报告长什么样？

### 1. Session Summary（每次对话结束后的总结）

```
📊 Session Report — 2026-06-21 02:15-03:47 (92min)

工具调用: 47次
  exec: 18次 (38%)  write: 12次 (26%)  web_search: 8次 (17%)  read: 6次  edit: 3次

效率指标:
  有效调用: 39/47 (83%)  ← 产出了有意义结果的调用
  无效调用: 8/47 (17%)   ← 没产出或重复的调用
  循环检测: 1次 output_loop (exec重复搜索，已自动恢复)

关键发现:
  ⚠️ 02:30-02:45 exec连续搜索同一问题6次，只有2次产出了新信息
  ✅ 02:50-03:30 连续12次write/edit全部成功，文件验证通过
  ⚠️ 03:35 exec返回错误但Agent继续执行（error_cascade风险）

Token估算: ~$0.12 (基于调用频率和时长)
可节省: ~$0.03 (如果跳过6次无效搜索)
```

### 2. Daily Digest（每天一次的汇总）

```
📊 Daily Report — 2026-06-21

总session: 4个 (总时长 4.2h)
总工具调用: 156次
有效率: 79% (比昨天+3%)

趋势:
  📈 有效率从72%→79%→79%，稳定在80%附近
  📉 搜索类调用占比从35%→28%，Agent学会了少搜多读
  ⚠️ error_cascade出现2次（昨天0次）— 可能是环境问题

今日发现:
  1. 凌晨session有8次无效exec搜索 — 考虑加搜索策略提示
  2. 下午session的write验证全部通过 — 代码质量稳定
  3. cron任务产出质量下降（output_loop检测触发1次）

建议:
  → 检查exec环境配置（error_cascade增加）
  → cron任务可能需要调整prompt
```

### 3. Alert（实时，只发重要的）

```
🚨 Agent Guard Alert

Session: 16238357
类型: error_cascade
详情: 3个不同工具连续失败(exec, write, edit)
建议: 可能是权限或环境问题，建议检查后再继续

[查看完整报告] → 链接到Session Summary
```

## 7种检测类型 → 报告发现的映射

| 检测类型 | 报告中的表述 | 严重度 |
|---------|------------|--------|
| action_loop | "Agent重复执行相同操作N次" | ⚠️ 中 |
| output_loop | "Agent反复调用同一工具但产出递减" | ⚠️ 中 |
| error_loop | "同一工具连续失败N次" | 🚨 高 |
| error_cascade | "多个工具连续失败，可能是环境问题" | 🚨 高 |
| pingPong | "Agent在两个工具间来回切换无进展" | ⚠️ 中 |
| search_loop | "Agent反复搜索无新发现" | 💡 低-中 |
| write_loop | "Agent反复修改同一文件" | 💡 低-中 |

加上状态验证的发现：
| 验证类型 | 报告中的表述 |
|---------|------------|
| file_exists失败 | "写入的文件不存在——可能写入失败" |
| content_match失败 | "编辑未生效——文件内容与预期不符" |
| result_nontrivial | "工具返回空结果——可能是静默失败" |

## 数据来源

Agent Guard已有的：
- `after_tool_call` hook：每次工具调用的完整记录（工具名、参数hash、时间、是否错误、结果是否有意义）
- `before_tool_call` hook：block记录
- 7种循环检测 + 状态验证

需要新增的：
- **Session开始/结束事件**：知道一个session的边界
- **工具调用耗时**：知道每次调用花了多久
- **Token消耗**：如果OpenClaw能提供
- **任务目标**：知道Agent在做什么（从prompt或cron配置获取）

## MVP范围

**Phase 1: Session Summary（最小可用）**

只做一件事：每次session结束时，输出一份效率报告。

数据来源：Agent Guard已有的after_tool_call记录
输出格式：纯文本（发到飞书/终端）
不需要：新UI、新存储、新API

实现方式：
1. 在after_tool_call里持续积累数据（已有）
2. 在session结束时（heartbeat或cron触发时），汇总输出
3. 格式化为人话

**Phase 2: Daily Digest**

跨session汇总。需要持久化存储（JSON文件即可）。

**Phase 3: Alert**

实时通知。需要飞书/Slack webhook。

## 产品形态选项

### 选项A: OpenClaw Plugin（最自然）
- 优势：零配置，装了就有；数据已经在plugin里
- 劣势：只能服务OpenClaw用户；报告输出受plugin API限制
- 实现：在现有plugin基础上加report生成逻辑

### 选项B: 独立CLI工具
- 优势：可以服务任何AI Agent用户（Claude Code、Cursor等）
- 劣势：需要用户手动配置数据源；冷启动更难
- 实现：读hook-proof.jsonl或类似日志，生成报告

### 选项C: 嵌入飞书通知
- 优势：人已经在飞书里，不需要额外看一个地方
- 劣势：飞书消息格式受限；不是所有用户都用飞书
- 实现：cron触发 → 生成报告 → 飞书bot发送

**我的判断：先做A（Plugin），验证价值后再考虑B（CLI）扩大覆盖。C是A的输出通道之一。**

理由：
1. 数据已经在plugin里，做A最快
2. OpenClaw用户是最近的真实用户群
3. 独立CLI需要解决数据获取问题（不同Agent的日志格式不同）
4. 飞书通知只是输出方式，不是产品形态

## 关键假设（需要验证）

1. **人真的想看效率报告吗？** — 人说"不知道Agent在干嘛"，但可能他只是想抱怨，不一定想看报告。验证方式：做出来给他看，看他看不看。
2. **报告能改变行为吗？** — 看到效率低，人会调整prompt/策略吗？还是看了就忘？验证方式：跟踪报告发出后，下一session的有效率是否变化。
3. **有效率是正确的指标吗？** — "有效调用/总调用"可能太粗糙。有些"无效"调用是必要的探索。验证方式：看报告后问人"这个分类对吗"。

## 下一步

1. ✅ 产品形态文档（本文档）
2. 🔲 在Agent Guard plugin里加session summary生成逻辑
3. 🔲 用自己的hook-proof.jsonl数据生成一份真实报告，看效果
4. 🔲 给人看，获取反馈
5. 🔲 根据反馈迭代
