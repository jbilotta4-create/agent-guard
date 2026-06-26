# 痛点田野调查笔记（整合版）

> 来源：GitHub issues/discussions、Reddit r/AI_Agents、知乎/CSDN、n8n community、Vectara awesome-agent-failures、学术论文（MAP study、AgentDebug、APEX benchmark）、开发者博客、SRE社区、法庭判决、CVE数据库
> 调查时间：2026-06-18

---

## 核心洞察

71%的AI采用率→只有11%到生产率。这个gap不是因为模型不行，是**工程层面的系统性缺失**——Agent不知道自己的状态、不知道出了错、出了错不会修、修不了不会报告。

所有12类痛点都指向同一组缺失能力：**自检、自诊断、自愈、自约束、自发现、自省**。这就是Agent Self-Governance。

---

## 一、级联失败（最致命）

单步95%准确率，10步链式调用后降至约60%。APEX benchmark：顶级模型首次尝试成功率<25%。
一个根因错误沿决策链级联传播，trace看起来干净、输出看起来合理、**答案是错的**。
缺：Loop级正确性实时检测，不是step级监控

## 二、工具调用失败/函数幻觉

Agent选对了工具但参数错了。Dify ReAct跑到第3轮输出"I am thinking about how to help you"就停了。n8n并行工具调用把Chat Memory写坏了（序列化器凭空发明一条AI消息，下一轮必然400）。
Agent调用delete_user_accounts而非filter_report_view，847个生产账号被删。
缺：工具参数实时验证层，"意图vs执行"对比审计

## 三、Context溢出/窗口管理失败

多轮对话从3200→28400→89300 tokens，超128K窗口时截断最老内容，原始任务定义被删除，Agent忘掉目标继续执行。4种已命名的context失败模式：Poisoning、Distraction、Confusion、Clash。
Cognition AI（Devin团队）说"context engineering是构建Agent的#1工作"。
缺：默认context管理策略、context health监控

## 四、Agent幻觉（文本+动作级）

Air Canada chatbot虚构丧亲折扣政策，法庭判决航空公司担责。Cursor "Sam"虚构单设备登录政策，大规模退订。法律AI幻觉率17-88%。1133个经法庭确认的AI幻觉案件。
缺：实时幻觉检测+拦截层，不是事后检查

## 五、Prompt注入/安全攻击

Chevrolet chatbot被注入后同意$1卖车。Clinejection攻击：GitHub issue标题隐藏prompt让AI triage bot执行任意代码，4000台机器被植入Agent。Amazon Q被注入wiper prompt差点删除1M+用户文件系统。Agent长期记忆被植入虚假信息，数周后仍引用执行。
缺：间接注入检测，长期记忆安全审计

## 六、超时/执行中断

n8n默认90秒超时，23%的suspended error直接因这个默认值。Dify ReAct默认120秒不够。Coze节点超时错误码777777776。
缺：智能动态超时（根据历史执行时间自动调整）

## 七、成本失控/Token预算暴走

LangChain多Agent循环264小时（11天）未检测反馈循环，消耗$47,000 API费用，产出为0。Gartner预测30%的GenAI项目因成本失控在PoC后放弃。
缺：硬预算断路器（alert不是enforcement）

## 八、可观测性/监控盲区

Agent不像传统服务那样crash——它"软失败"，继续流利地执行十余步建立在腐败的工具响应上。89.9%的LLM失败需要手动分析平均16.92GB日志。n8n Agent tool failures默认"静默"——没有错误日志没有告警。
缺：Agent专用observability，追踪语义偏离而非仅技术异常

## 九、部署/配置复杂度

Dify 39种常见报错（Docker版本不兼容、端口冲突、文件上传限制15M、UTC时区偏差）。Coze Studio Windows端口2379被占用、图片理解插件并发>20就崩溃（文档未标注）。
缺：一键自检工具，部署健康检查自动化

## 十、多Agent协调失败

并发Claude Code sessions静默覆盖彼此的工作：无跨session感知、无文件锁、无冲突检测。Agent间通信无标准协议，各团队自行定义→集成时崩溃。
缺：标准化多Agent通信协议、跨Agent request tracing、信任评分机制

## 十一、评估/回归测试失效

LLM eval天生不稳定（相同输入不同输出）、judge bias（位置偏好、冗长偏好）、eval overfitting到测试集——分数提升但真实质量不提升。生产失败反复出现但eval分数看起来没问题。
缺：Loop级eval框架，生产失败→自动变为eval测试case的闭环

## 十二、递归模型坍塌/数据毒化

Agent生成合成数据→喂回训练→错误每轮放大：91%→87%→61%→COLLAPSE。微调导致灾难性遗忘：医疗微调后safety_eval降33.9%。
缺：Agent行为变质检测，合成数据进管线前强制验证gate

---

## 汇总矩阵

| 痛点类型 | 频率 | 严重度 | 最缺什么 |
|---|---|---|---|
| 级联失败 | ★★★ | ★★★ | Loop级正确性实时检测 |
| 工具调用失败 | ★★★ | ★★★ | 工具参数实时验证层 |
| Context溢出 | ★★★ | ★★★ | 默认context管理策略 |
| Agent幻觉 | ★★★ | ★★★ | 实时拦截而非事后检查 |
| Prompt注入 | ★★★ | ★★★ | 间接注入检测 |
| 超时/中断 | ★★★ | ★★ | 智能动态超时 |
| 成本失控 | ★★★ | ★★★ | 硬预算断路器 |
| 监控盲区 | ★★★ | ★★★ | Agent专用observability |
| 部署配置 | ★★★ | ★★ | 一键自检工具 |
| 多Agent协调 | ★★ | ★★★ | 标准通信协议 |
| 评估失效 | ★★ | ★★ | Loop级eval框架 |
| 递归坍塌 | ★ | ★★★ | 行为变质检测 |

**一句话总结**：71%→11%的gap不是因为模型不行，是Agent缺少一套"知道自己状态、发现自己问题、修复自己错误、约束自己行为"的内置系统。这就是Agent Self-Governance。
