# Semantic Repetition Detection — 实施方案 (方案C: 意图模式匹配)

## 核心思路
不检测"参数是否相同"，检测"行为模式是否在重复"。

## 定义意图模式

### 模式1: 重复搜索 (search_loop)
- 触发条件：连续N次调用 web_search 或 web_fetch，N >= 6
- 跟output_loop的区别：output_loop看所有工具，search_loop只看搜索类工具
- 误报风险：中。正常研究可能连续搜索6次不同关键词
- 降低误报：检查搜索结果是否有新信息（result_nontrivial已覆盖）

### 模式2: 重复读取 (read_loop)  
- 触发条件：连续N次调用 read，且文件路径模式相似（同目录、同扩展名）
- 误报风险：中。正常开发可能连续读多个配置文件
- 降低误报：检查是否在读不同文件（不同路径=可能正常）vs 同一文件反复读

### 模式3: 重复写入 (write_loop)
- 触发条件：连续N次调用 write/edit 到同一文件
- 误报风险：低。反复写同一文件几乎一定是循环
- 这是action_loop的变体——同一文件不同内容

### 模式4: compaction后重复 (compaction_repetition) [未来]
- 触发条件：compaction后的操作与compaction前高度相似
- 需要hook到compaction事件，当前plugin框架不支持
- 留给OpenClaw内置的post-compaction guard

## 实施优先级

1. **search_loop** — 最常见的语义重复场景，误报可控
2. **write_loop** — 误报最低，最容易实现
3. **read_loop** — 需要路径模式匹配，稍复杂
4. **compaction_repetition** — 需要新hook能力，未来方向

## 代码实现位置
在 detectLoop() 函数里，在pingPong检测之后、return "none"之前，加一个意图模式检测分支。

## 阈值设计
- search_loop: 6次（跟output_loop阈值对齐）
- write_loop: 4次（更严格，因为误报代价低）
- read_loop: 8次（更宽松，因为连续读文件很常见）

## v0.10.0 scope
只做 search_loop + write_loop。read_loop留到v0.10.1。compaction_repetition留到v0.11.0（需要新hook能力）。
