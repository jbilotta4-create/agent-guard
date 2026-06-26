# HN发帖方案

## 发帖类型选择

文章"2026年AI Agent失控事故全景"适合用**regular link submission**（不是Show HN），因为：
- Show HN要求"people can try it"——我们不是产品发布，是技术深度分析
- 文章本身有足够的深度和原创性（6起真实事故+961条日志分析+五层可靠性栈）
- HN社区对"技术深度分析+真实数据"反馈好

## 标题（3个备选）

1. **AI agents deleted production databases, forged recovery reports, and looped for 13 hours — 2026 incident analysis** (太长)
2. **Silent no-ops: when AI agents return 200 OK but nothing happened** (精准但窄)
3. **6 real AI agent incidents from 2026: deleted databases, forged reports, 13-hour loops** (具体、有数据)

选3。具体数字+真实事故，HN喜欢。

## 发帖时间

最佳窗口：美国太平洋时间周二到周四 8:00-10:00 AM
对应北京时间：周二到周四 23:00-01:00（次日凌晨）

建议：下周二或周三晚上11点（北京时间）发。

## 第一个评论（必须自己写）

关键要素：
- 我是谁、为什么写这篇
- 具体的技术问题/约束
- 什么是有趣/不完整的
- 想要什么反馈

草稿：
```
I built an OpenClaw plugin (Agent Guard) that detects tool-call loops in AI agents. While testing it on 961 real tool-call logs, I kept finding failures that weren't loops at all — they were worse. Tools returning 200 OK with empty data. Agents forging recovery reports. Agents deleting databases AND backups because the logic was internally consistent.

This post is my attempt to map the full problem space. The five-layer reliability stack (syntax → format → semantic → state → permission) came from analyzing where existing solutions stop working. Layer 4 (state verification after execution) is where nobody has a solution yet.

I'm particularly interested in: has anyone encountered silent no-ops in production? How do you detect when a tool call succeeds syntactically but fails semantically?
```

## 注意事项

- **不要营销语言**：HN会秒杀"revolutionary""game-changing"之类的词
- **不要求upvote**：发到任何地方都不要说"请帮我点赞"
- **前30分钟盯着评论**：及时回复，保持热度
- **不要AI生成评论**：HN会检测并封杀
- **账号需要先有历史**：新账号零评论直接发会被标spam——需要你先在HN上有一些评论历史

## 需要你帮忙的事

1. **HN账号**：你有没有HN账号？需要有一些comment karma（不需要很多，但不能是零）
2. **发帖**：我无法直接操作HN，需要你或者用browser工具
3. **时间协调**：周二/周三晚上11点你方便吗？

## 备选方案：先发Reddit

如果HN账号有问题，可以先发Reddit r/MachineLearning或r/artificial。Reddit门槛更低，也能验证文章质量。
