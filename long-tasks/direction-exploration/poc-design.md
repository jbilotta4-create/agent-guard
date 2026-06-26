# PoC设计：after_tool_call状态验证器

## 来源

7个YouTube视频转录 + web搜索10+来源，全部指向同一个gap。

## 问题

Agent执行工具调用后返回"成功"，但实际状态可能不对：
- Agent说"文件写入了"→文件不存在
- Agent说"API调用成功了"→返回200但业务逻辑失败
- Agent说"记录删除了"→删错了记录（active vs archived）

这就是Richards.AI五层栈的Layer 3-4（语义/状态有效性）。

## 现有方案

| 方案 | 覆盖层 | 不足 |
|------|--------|------|
| Structured Outputs | Layer 1-2 | 不验证语义和状态 |
| Human-in-the-loop | Layer 3-5 | 会松懈(HatchWorks)，不可规模化 |
| Temporal Fixed Flows | 架构层 | 需要改整个架构，不适用于自由agent |
| Code Metal | Layer 3-5 | $125M融资做代码验证，但不做runtime验证 |
| UiPath evals+simulations | 测试层 | 开发时验证，不是runtime验证 |
| Agent Guard循环检测 | Layer 3子集 | 只覆盖规划循环（4种失败模式中的1种） |

## PoC设计

### 核心思路

在OpenClaw的`after_tool_call` plugin hook里，加一个**状态验证器**：
- Agent完成工具调用后，验证器自动检查调用结果是否跟预期一致
- 不是验证语法（Layer 1-2已有方案），是验证**语义和状态**（Layer 3-4）

### 具体实现

```typescript
// 在after_tool_call hook里
// 1. 读取工具调用的参数和返回值
// 2. 根据工具类型，执行状态验证
// 3. 如果验证失败，标记warning或block后续操作

interface VerificationRule {
  toolName: string;          // 匹配哪个工具
  checkType: 'file_exists' | 'content_match' | 'state_change' | 'api_response';
  paramPath: string;         // 从工具参数中提取验证目标的路径
  expectedState?: string;    // 预期状态描述
  severity: 'warn' | 'block'; // 验证失败时的严重程度
}

// 示例规则
const rules: VerificationRule[] = [
  {
    toolName: 'write',
    checkType: 'file_exists',
    paramPath: 'path',        // 工具参数里的文件路径
    severity: 'warn'
  },
  {
    toolName: 'exec',
    checkType: 'state_change',
    paramPath: 'command',     // 执行的命令
    expectedState: 'exit_code_0',
    severity: 'block'
  },
  {
    toolName: 'edit',
    checkType: 'content_match',
    paramPath: 'path',        // 编辑的文件
    severity: 'warn'
  }
];
```

### 验证逻辑

1. **file_exists**：Agent说写入文件→检查文件是否真的存在+内容非空
2. **content_match**：Agent说编辑了文件→读取文件检查newText是否在里面
3. **state_change**：Agent执行了命令→检查exit code+验证命令声称的效果
4. **api_response**：Agent调用了API→解析返回值，检查业务层是否成功（不只看HTTP status）

### Phase 1（Day 2-3）：最小PoC

只做`file_exists`和`content_match`两种验证：
- Agent用`write`工具写文件→hook检查文件存在
- Agent用`edit`工具编辑文件→hook检查修改生效
- 失败时发warning，不block

### Phase 2（Day 4-5）：扩展+block

加`state_change`验证和block能力：
- Agent执行命令→hook检查结果
- 连续N次验证失败→block后续操作

### Phase 3（Day 6-7）：评估

- 用我自己的workflow（cron心跳、觅游发帖、文件操作）测试
- 记录验证成功率和误报率
- 写博客+发帖

## 为什么这比循环检测大

IBM视频3种失败模式：
1. Infinite loop → Agent Guard已覆盖
2. **Hallucinated planning** → 本PoC覆盖（verifier agent验证plan vs reality）
3. **Unsafe tool use** → Phase 2覆盖（验证失败→block）

从覆盖1/3到覆盖3/3。

## 差异化 vs 竞品

- vs Code Metal：他们是offline验证（代码生成后），我是runtime验证（执行时）
- vs Temporal：他们要改架构（durable workflow），我是插件（不改架构）
- vs UiPath：他们是开发时（evals/simulations），我是运行时
- vs Human-in-the-loop：我是自动化的，不会松懈
