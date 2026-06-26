# AI Agent执行了430次同一个命令，为什么循环检测没拦住？

## 一个真实的事故

最近OpenClaw社区出了一个issue（#93917）：一个生产环境的agent session里，同一个docker命令被执行了**430次**。

```
sleep 3 && docker exec alist /opt/alist/alist admin set admin123
```

不是430次不同的命令。是**完全相同的命令**，执行了430次。

更离谱的是，这个session的循环检测配置已经设得很激进了：warning阈值5、critical阈值10、全局熔断器15。按理说10次就该拦住了。

但一个都没拦住。

## 为什么没拦住？

OpenClaw内置的循环检测有两个路径：

1. **Warning路径**：统计相同参数的调用次数。这个**能**触发——5次就warning了。
2. **Critical路径**：要求**连续调用的结果hash完全相同**。这个**不能**触发。

为什么？因为exec命令每次失败时的错误输出**略有不同**——不同的时间戳、不同的错误信息、不同的连接状态。结果hash每次都不一样，所以`noProgressStreak`永远是1，永远达不到critical阈值。

```
第1次: Error: Connection refused at 14:23:01
第2次: Error: Connection refused at 14:23:04  ← 时间戳变了
第3次: Error: ECONNRESET at 14:23:07          ← 错误类型都变了
```

三次调用，三个不同的hash。内置检测器认为"结果在变化，可能还在尝试不同的东西"。

但事实是：**结果在变化，但没有任何一次产生了有意义的进展。**

## 这不是个案

同一个session里还有：

| 重复次数 | 命令 |
|---------|------|
| 430次 | docker exec设置admin密码 |
| 164次 | SSH远程检查服务版本 |
| 132次 | NapCat发送消息 |
| 131次 | 清理临时文件 |

1252次工具调用，大部分是重复的。而且warning触发了，但**模型忽略了文本warning**，继续执行。

## 核心问题：结果变化 ≠ 有进展

内置检测器的假设是：**如果结果在变化，agent可能还在尝试不同的方法，不应该打断它。**

这个假设在大多数情况下是对的。但当agent陷入"同一个命令反复失败，每次失败信息略有不同"的模式时，这个假设就错了。

真正的判断标准不应该是"结果hash是否相同"，而是**"结果是否产生了有意义的进展"**。

## 我的解法：result_nontrivial

我做了个OpenClaw插件叫[Agent Guard](https://github.com/jbilotta4-create/agent-guard)，用不同的思路检测循环：

不问"结果是否相同"，问**"结果是否有意义"**。

具体来说：

- exec调用：exit code 0 + 输出非空 → 有意义（成功执行了）
- exec调用：exit code非0 → 无意义（失败了，再试也不会不同）
- web_search：返回了搜索结果 → 有意义
- web_search：返回空结果 → 无意义

在output_loop检测中，我只统计**结果没有意义**的重复调用。430次docker命令，每次exit code都是非0，每次都是无意义的，所以430次全部计入循环计数。

阈值设4-6次就触发——因为如果一个命令连续失败4次，继续执行第5次的概率几乎为零。

## 7种检测类型

除了output_loop，Agent Guard还检测：

| 类型 | 检测什么 | 对应的真实场景 |
|------|---------|--------------|
| action_loop | 相同参数重复调用 | agent反复读同一个文件 |
| output_loop | 不同参数但结果无意义 | 430次docker命令 |
| error_loop | 同一工具连续失败 | SSH连接反复超时 |
| error_cascade | 不同工具都失败 | 环境问题导致所有工具都报错 |
| pingPong | 两个工具交替调用 | agent在read和write之间反复横跳 |
| search_loop | 连续搜索没找到新信息 | compaction后重复搜索 |
| write_loop | 同一文件反复写 | agent在文件内容上犹豫不决 |

每种检测都带recovery suggestion——不只是拦住，是告诉agent接下来该怎么做。

## 和内置检测的关系

不是替代，是互补。内置检测在post-compaction场景（上下文压缩后监视3次调用）有独特优势，Agent Guard在运行时检测更早触发。用两层比一层安全。

## 装上试试

```bash
# OpenClaw plugin安装
openclaw plugin install agent-guard
```

GitHub: https://github.com/jbilotta4-create/agent-guard

如果你的agent也遇到过"明明在循环但检测器没拦住"的情况，欢迎来提issue。
