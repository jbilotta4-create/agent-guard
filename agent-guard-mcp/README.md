# Agent Guard MCP Server

> 让Agent不再循环失控——循环检测 + Token预算 + 强制停止

## 为什么需要这个

Agent不知道自己正在循环。这不是假设，是真实的生产事故：

- **hermes-agent #13208**: 90+次重试同一个语法错误，无检测机制
- **fintech公司**: 两个LangChain Agent循环11天，$47,000
- **Aperant #1546**: 400并发错误无限重试烧Token
- **ellmer #958**: 开发者请求Token预算功能——基础设施缺失

所有痛点指向同一个缺失：**Agent没有"停下来"的能力**。

## 三个核心能力

### 1. 循环检测（Loop Detection）
- 识别重复动作（连续N次相同action hash）
- 识别重复输出（连续N次相同output hash）
- 识别重复错误（连续N次相同error type）
- 检测到循环 → 自动建议策略切换

### 2. Token预算（Token Budget）
- 设置最大迭代次数上限
- 接近上限时注入警告："Wrap up soon"
- 超过上限时强制停止："STOP immediately"
- 解决ellmer #958的需求

### 3. 错误追踪（Error Tracking）
- 连续错误3次 → 自动escalate到人类
- 区分错误类型，避免无限重试同一种错误
- 解决Aperant #1546的需求

## 安装

在Agent的MCP配置中添加：

```json
{
  "mcpServers": {
    "agent-guard": {
      "command": "python3",
      "args": ["path/to/agent-guard-mcp/server.py"]
    }
  }
}
```

## 使用

### 每次动作后记录
```
record_action({
  action: "search: dify loop bug",
  output: "Found 3 related issues",
  is_error: false
})
```

### 遇到错误时记录
```
record_action({
  action: "call API endpoint /users",
  output: "400 concurrency error",
  is_error: true,
  error_type: "400_tool_concurrency"
})
```

### 定期检测循环
```
check_loop()
→ { loop_detected: false, severity: "NONE" }
→ { loop_detected: true, severity: "HIGH", should_stop: true }
```

### 设置Token预算
```
set_token_budget({
  max_tokens: 100000,
  max_iterations: 50,
  warning_threshold: 0.8
})
```

### 查看状态
```
get_status()
→ { total_actions: 23, error_streak: 0, loop_detections: 1 }
```

### 强制停止
```
force_stop({ reason: "Loop detected, manual intervention needed" })
```

## 设计原则

1. **最小侵入**：Agent只需在每个动作后调用一次record_action，其他自动处理
2. **渐进式响应**：警告 → 建议策略切换 → 强制停止 → 请求人介入
3. **可配置**：所有阈值可调（WINDOW_SIZE、LOOP_THRESHOLD、max_iterations）
4. **独立运行**：纯Python，无外部依赖，状态存本地文件

## 反馈

如果你在使用中遇到问题或有改进建议，请在GitHub issue中提出。
