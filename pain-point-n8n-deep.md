# n8n社区深度痛点田野笔记 (浏览器实地考察)

## 日期：2026-06-18

## 真实帖子记录

### 1. Token Usage盲区 (137票, 62赞, 7.3k浏览, 5个月无解)
**帖子**: https://community.n8n.io/t/retrieve-llm-token-usage-in-ai-agents/68714
**痛点**: n8n的AI Agent节点内部能看到token消耗数据，但用户无法从外部获取。Agent知道自己的消耗但不告诉你。
**用户原话**: "I would like to extract the completition and prompt tokens info when using AI Agents. It would be highly beneficial to keep track of my costs."
**相关帖子**: 3个类似帖子，171+110次点击，说明这是普遍问题
**映射**: 自发现缺失 — Agent无法向外部报告自己的运行状态

### 2. AXR审计receipt发现隐藏bug
**帖子**: https://community.n8n.io/t/tamper-evident-cryptographically-verifiable-audit-trail-for-n8n-agent-workflows/299838
**痛点**: chrisconen在生产环境运行n8n booking workflow，无法事后证明workflow实际做了什么决策。执行日志在自己服务器上可以编辑，对审计方毫无可信度。
**关键发现**: 部署AXR后发现了4个之前没察觉的bug——最严重的是每次运行同时触发成功+错误+冲突三个分支，被拒绝的预约还是发了确认邮件。签名记录和workflow实际行为矛盾暴露了bug。
**用户原话**: "I kept running into a question I couldn't answer cleanly: after the fact, how do I prove what the workflow actually decided on a given run?"
**映射**: 自省+自诊断缺失 — Agent无法审计自己的决策，也无法通过对比发现自己的行为偏差

### 3. 三种生产级故障模式 + 自建安全pattern
**帖子**: https://community.n8n.io/t/how-are-you-handling-infinite-loop-protection-in-production-n8n-workflows/279286
**痛点**: RS1在AI-in-the-loop workflow中遭遇三种静默故障：
- **Runaway loops**: webhook触发自己，错误处理器无限重试，API费用烧光才注意到
- **Unreviewed AI output**: AI生成内容直接发给用户，没有审查关卡
- **No audit trail**: 出了问题没有结构化日志
**自建方案**: circuit breaker + human review gate + audit logger (开源: github.com/array0224-cloud/n8n-ops-safety-kit)
**仍在纠结**: 幂等性、审阅延迟SLA、日志存储选择
**映射**: 自约束(熔断) + 自约束(审查) + 自省(审计) — 全部Self-Governance维度

### 4. 6维生产就绪检查清单
**帖子**: https://community.n8n.io/t/the-6-dimension-production-readiness-checklist-ive-been-using-on-every-n8n-workflow-review/296612
**核心观点**: "Most n8n workflows pass the 'happy path' check fine. They break when the unusual happens"
**6个维度**:
1. Idempotency → 自约束(防重复)
2. Retry strategy → 自愈(自动恢复)
3. Audit trail → 自省(事后回顾)
4. Secrets handling → 自约束(凭证安全)
5. Dead-letter queue → 自诊断(失败分类)
6. Monitoring hooks → 自发现(主动检测)

### 5. 其他重要发现
- "Infinite loop consumed all my executions (n8n Cloud)" — 循环吃掉所有执行配额
- "N8n Workflow Fails to Resume Safely After Partial Execution (Idempotency & Checkpointing Issue)" — 部分执行后无法安全恢复
- "Open-sourced: three n8n sub-workflows for agent reliability — RetryClassifier, ContextBudget, PermissionGate" — 有人已经在做Agent可靠性子workflow
- "🛡️ Automated Error Monitoring for n8n (3 workflows, 46 nodes, zero AI)" — 用n8n自己监控自己的错误
- "I built an n8n workflow that audits other n8n workflows before you activate them" — 用n8n审计n8n（Agent审计Agent的雏形）

## 关键模式

所有n8n社区痛点指向同一个结论：**Agent平台提供了基本功能，但没有提供"让Agent运营自己"的基础设施**。用户被迫自己搭熔断器、审计日志、审查关卡——这些应该是Agent运行时的内置能力。

n8n社区出现了"用n8n治理n8n"的模式——Agent审计Agent、Agent监控Agent——这正是Self-Governance的雏形。但都是手动搭建的，没有标准化框架。
