---
name: agent-guard
version: 0.7.0
description: OpenClaw内置loop detection增强层——补上output_loop/error_loop/ping_pong检测
triggers: [agent guard, loop detection, agent loop, 循环检测, agent跑偏, output loop, error loop, ping pong]
---

# Agent Guard — OpenClaw Loop Detection 增强层

OpenClaw有内置loop detection（`tools.loopDetection`），但只覆盖action_loop。Agent Guard补上内置不检测的模式。

## 内置 vs Agent Guard

| 循环类型 | 描述 | 内置覆盖 | Agent Guard |
|---------|------|---------|------------|
| action_loop | 同工具+同参数+同结果重复 | ✅ genericRepeat | ✅ |
| output_loop | 同工具+不同参数反复调用 | ❌ | ✅ |
| error_loop | 连续工具调用失败 | ❌ | ✅ |
| ping_pong | 两个工具交替调用(A→B→A→B) | ✅ | ✅ |
| post-compaction guard | 压缩后重复检测 | ✅ 默认开 | — |

**Agent Guard的差异化：output_loop + error_loop**——内置不覆盖的两种模式。

## 为什么需要这个

output_loop是最危险的循环类型：Agent用同一个工具但每次换参数，看起来"不一样"但实际在做无用功。真实案例：

- Reddit r/AI_Agents：Agent 1小时调了50,000次API，每次参数不同，把生产数据库搞挂了
- n8n #13525：Agent 50%概率无限触发工具
- 某公司：Agent重试循环90分钟烧$400

内置的genericRepeat检测不到这些——因为参数每次都不同。

## 安装

```bash
git clone https://github.com/jbilotta4-create/agent-guard.git
cd agent-guard && npm install && npm run build
openclaw config patch plugins.load.paths '["/path/to/agent-guard-plugin"]'
openclaw config patch plugins.entries.agent-guard.config.loopThreshold 4
openclaw config patch plugins.entries.agent-guard.config.blockOnLoop false
openclaw gateway restart
```

## 配置

```yaml
plugins:
  entries:
    agent-guard:
      config:
        enabled: true
        blockOnLoop: false          # 先观察，再开启blocking
        loopThreshold: 4            # 检测触发阈值
        loopWindowMs: 120000        # 检测时间窗口（2分钟）
        maxConsecutiveErrors: 3     # error_loop触发阈值
        logLevel: info
```

## ⚠️ 重要提醒

**先用blockOnLoop=false观察1-2天**，确认误报率可接受后再开启blocking。

## 验证结果

四阶段验证全部通过 + 1119条真实日志验证：

| 阶段 | 状态 |
|------|------|
| Plugin加载 | ✅ |
| Hook工作 | ✅ |
| 循环检测 | ✅ |
| 阻止执行 | ✅ |
| 误报率优化 | ✅ threshold=4, 检测率29%, shouldStop=0 |

## GitHub

https://github.com/jbilotta4-create/agent-guard
