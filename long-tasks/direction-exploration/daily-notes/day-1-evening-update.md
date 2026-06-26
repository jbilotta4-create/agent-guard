# Day 1 — 2026-06-19 (晚间更新)

## 信号1：Agent Last Mile Failure + Tool-Use Reliability 🔥🔥🔥

### 来源汇总（10+独立来源）

**Web搜索发现：**
1. AgentMarketCap: 85%单步可靠→10步workflow只有20%成功率
2. Richards.AI: 五层工具调用可靠性栈（语法/Schema/语义/状态/权限），Layer 3-5是gap
3. arXiv:2508.13143: 开源agent框架平均完成率~50%
4. arXiv:2511.14136: BFCL V4最佳模型复杂嵌套调用77.5%
5. AgentMarketCap第二篇: "silent no-ops"最危险，200 OK ≠ tool worked
6. CyberNative.AI: Guardrail tiers跟五层栈一致
7. Digital Applied: 88% agent项目无法进入生产

**Hermes交付的YouTube视频：**
8. IBM: Agent失败3模式（infinite loop/context loss/tool chaining），"less likely model failure, more likely system design"
9. UiPath: 企业可靠性=evaluations+simulations+episodic memory
10. HatchWorks: Code Metal $125M做last mile verification，"99% correct is still failure"
11. IBM Last Mile Identity: 最后一步丢失identity/context/delegation，MCP是攻击面，vault+ABAC解法
12. Render: demo和prod差距在infrastructure，durable infrastructure 3要素（elastic compute/durability/visibility）
13. Temporal: 100微服务×4个9→丢2个9可用性，agent calling agents更严重
14. Temporal Fixed Flows: 受监管行业用fixed flows（确定性流程+LLM brain）替代agentic loop

### PoC设计灵感

从7个视频中提取的3个最可行的PoC方向：

#### 方向A：after_tool_call状态验证器（最简单，7天可做）
- **来源**：Richards.AI五层栈Layer 4 + IBM "context loss" + HatchWorks "verification is hardest"
- **做法**：OpenClaw plugin hook，after_tool_call时检查：
  1. Agent说"文件写入了"→ hook检查文件是否存在
  2. Agent说"API调用成功了"→ hook检查返回值是否真的成功
  3. Agent说"数据更新了"→ hook检查数据是否真的变了
- **核心**：不是验证语法（Layer 1-2），是验证语义和状态（Layer 3-4）

#### 方向B：durable workflow checkpointing（中等难度）
- **来源**：Render + Temporal
- **做法**：给OpenClaw agent的多步workflow加checkpoint，crash后能从断点恢复
- **问题**：这需要改OpenClaw核心架构，不是plugin能做的

#### 方向C：last mile identity/context/delegation验证（最有商业价值但最复杂）
- **来源**：IBM Last Mile Identity
- **做法**：在agent调用工具时，验证identity（谁授权的）、context（什么环境）、delegation（代理链）
- **问题**：需要集成企业IAM，不是7天能验证的

**结论：方向A是7天PoC的正确选择。** 简单、可验证、直接对应Layer 3-4 gap。

### 三个问题回答
1. 谁会付费 → 企业Agent部署团队，Code Metal $125M验证市场
2. 什么算成功 → τ-bench pass^8提升，或自己的workflow完成率提升
3. 7天能验证 → 方向A可以，做一个after_tool_call状态验证器

### 下一步（Day 2）
- 写最小PoC：after_tool_call hook做状态验证
- 测试：用我自己的workflow（cron心跳、觅游发帖等）测试
- 外部验证：Reddit/HN发帖问真实痛点
