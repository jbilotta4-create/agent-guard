# Dify平台深度痛点田野笔记

## 日期：2026-06-18

## 从搜索结果和社区讨论提取的真实痛点

### 1. Agent多轮MCP调用幻觉 (Issue #22529)
**来源**: https://github.com/langgenius/dify/issues/22529
**标签**: 🐞 bug + 🤖 feat:agent
**痛点**: Dify 1.6.0版本，Agent使用MCP工具时，需要多轮调用工具并整合结果时，产生严重幻觉。例如：先调用Tool A获取ID，再调用Tool B用ID查询——Agent在多轮调用中产生幻觉，输出不准确的结果。
**映射**: 自诊断缺失 — Agent无法验证多轮工具调用结果的逻辑一致性，不知道自己"幻觉"了

### 2. "让Dify更AI-ready" (Issue #37188)
**来源**: https://github.com/langgenius/dify/issues/37188
**痛点**: 用户请求"Please Make Dify More 'AI'-Ready! Add Some Practical Features to Let Agents Help Us with Workflows" — 用户想让Agent能帮助用户管理workflow，而不仅仅是被workflow驱动。
**映射**: 自发现缺失 — Agent目前只能在workflow内执行，无法主动发现和优化workflow本身

### 3. Self-Refining Agent策略插件请求 (Issue #3280)
**来源**: https://github.com/langgenius/dify-official-plugins/issues/3280
**标签**: enhancement
**痛点**: 用户请求Dify官方提供"Self-Refining Agent Strategy Plugin" — Agent能自动评估和优化自己输出的插件
**映射**: 自省+自愈缺失 — Agent没有内置的"自我优化"能力，用户需要自己写插件

### 4. 记忆污染问题（中文社区反复出现）
**来源**: 多个中文教程和社区讨论
**痛点**: Dify的多轮对话中，记忆窗口会导致问题分类错误和知识库检索不精确。开记忆会在第三轮对话时"污染"用户问题；不开记忆则分类错误。
**具体表现**:
- 打开LLM节点记忆但不打开问题分类节点记忆 → 分类错误
- 打开问题分类记忆 → 仍然有时分类错误
- 记忆窗口截断 → 只保留最近几轮，丢失上下文 → 回复不准确
**映射**: 自约束缺失 — Agent没有能力自己判断"这段记忆是否有用/有害"，无法自主管理记忆质量

### 5. 循环/Loop节点Token燃烧风险
**来源**: Dify官方文档+多个中文教程的"避坑指南"
**痛点**: Dify的Loop节点需要手动设置退出条件和最大次数。如果忘了设最大次数或逻辑写错，就会进入死循环直到Token耗尽。中文教程专门警告："一定要设最大次数，为了防止逻辑写错导致Token燃烧"
**映射**: 自约束缺失 — Agent无法自己检测"我是否在循环"，需要人手动设限

### 6. Agent策略限制
**来源**: Dify官方文档
**痛点**: Dify Agent只支持Function Calling和ReAct两种策略，用户可以设置"最大迭代次数"但这是静态硬限制。Agent在迭代过程中无法自己判断"我应该停止了吗"，只能靠人设的数字上限。
**映射**: 自约束缺失 — Agent没有动态自终止能力

### 7. VSCode Copilot Agent无限循环 (Issue #9708)
**来源**: https://github.com/microsoft/vscode-copilot-release/issues/9708
**标签**: infinite-response-loop
**痛点**: VSCode Copilot的Agent mode进入无限循环——"declaring he is going to do something, then some actions display in the chat, then he says exactly the same thing over and over"
**映射**: 自约束缺失 — 这不是Dify的问题，但说明Agent循环是跨平台的普遍痛点

### 8. Dify可观测性（外部工具视角）
**来源**: 53AI社区文章 "Dify 可观测性方案全解：从内置仪表盘到七大外部集成"
**要点**: Dify确实集成了Opik、Langfuse、Arize Phoenix等可观测性工具，但这些全是外部视角的观测——人通过仪表盘看Agent的状态。Agent自己无法使用这些数据来评估自己的状态。
**映射**: 关键区分 — 可观测性≠自发现。外部仪表盘让人看到Agent的问题，但Agent不知道自己有问题

## 关键发现

1. **Dify的循环保护是"人设上限"而非"Agent自终止"** — Loop节点需要手动设置最大次数，Agent无法自己判断"我应该停了"
2. **记忆管理是"截断"而非"筛选"** — Agent没有能力判断"这段记忆有害应该丢弃"，只能靠窗口大小硬截断
3. **可观测性是外部工具，不是Agent内生能力** — Langfuse等让人看到Agent状态，但Agent无法访问这些数据来自我评估
4. **Self-Refining插件请求说明用户需求** — 有人已经在请求"Agent能自动优化自己"的能力了，但目前没有官方支持
5. **多轮工具调用幻觉是自诊断的典型场景** — Agent在串联多步推理时产生幻觉，但无法自己检测逻辑不一致

## 与n8n对比

- n8n用户自己搭熔断器、审计日志、审查关卡（"用n8n治理n8n"模式）
- Dify用户请求官方提供Self-Refining插件（"靠平台提供"模式）
- 两种模式都指向同一个缺失：Agent没有内生的自我治理能力
