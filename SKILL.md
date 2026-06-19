---
name: agent-guard
version: 0.6.1
description: Agent循环检测与工具调用治理——自动检测action_loop/output_loop/error_loop，可选before-action blocking
triggers: [agent guard, loop detection, agent loop, agent governance, 循环检测, agent跑偏]
---

# Agent Guard

Agent跑偏了？循环执行同样的操作？这个技能自动检测并阻止。

## 它做什么

Agent Guard在工具调用前后自动检测三种循环模式：

| 类型 | 描述 | 触发条件 |
|------|------|---------|
| `action_loop` | 同一工具+同一参数重复调用 | 阈值内重复（默认2次） |
| `output_loop` | 同一工具名+不同参数反复调用 | 阈值×2或≥6次 |
| `error_loop` | 连续工具调用错误 | maxConsecutiveErrors（默认3次） |

检测到循环后，可以选择：
- **仅警告**（blockOnLoop=false）：记录日志，不阻止执行
- **阻止执行**（blockOnLoop=true）：在工具执行前拦截，阻止循环继续

## 为什么需要这个

真实事故：
- Amazon Kiro：Agent循环导致13小时停机
- Replit：Agent删了整个代码库
- 某公司：Agent重试循环90分钟烧掉$400
- n8n：Agent 50%概率无限触发工具

这些不是理论风险，是每天都在发生的事。

## 安装

1. 下载本技能
2. 解压到你的OpenClaw插件目录
3. 运行 `openclaw plugins install --link /path/to/agent-guard-plugin`
4. 重启Gateway：`openclaw gateway restart`

## 配置

在 `openclaw.config.yaml` 中：

```yaml
plugins:
  entries:
    agent-guard:
      config:
        enabled: true
        blockOnLoop: false          # 先观察，再开启blocking
        loopThreshold: 2            # action_loop触发阈值
        loopWindowMs: 120000        # 检测时间窗口（2分钟）
        maxConsecutiveErrors: 3     # error_loop触发阈值
        logLevel: info
```

## ⚠️ 重要提醒

**先用blockOnLoop=false观察1-2天**，确认误报率可接受后再开启blocking。

开启blocking的风险：
1. 误报：正常连续使用同一工具可能被误判
2. 级联阻止：一次block可能连锁阻止后续调用
3. 治理工具锁死自己：详见[失误记录](https://github.com/jbilotta4-create/agent-guard/blob/main/failures.md)

## 验证结果

四阶段验证全部通过（2026-06-18）：

| 阶段 | 状态 |
|------|------|
| Plugin加载 | ✅ |
| Hook工作 | ✅ |
| 循环检测 | ✅ |
| 阻止执行 | ✅ |

## 与现有方案的区别

| 方案 | 方式 | 层级 |
|------|------|------|
| AgentOps | 外部可观测性 | 网络 |
| Portal26 | 外部限流 | 网络 |
| **Agent Guard** | **运行时内部hook** | **平台** |

运行时内部hook比外部监控更快、更精确、更难绕过。

## GitHub

https://github.com/jbilotta4-create/agent-guard

## Landing Page

https://jbilotta4-create.github.io/agent-guard/
