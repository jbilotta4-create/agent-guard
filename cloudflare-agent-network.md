# Cloudflare 多Agent互联方案 v2

## 三个本地Agent

| Agent | 框架 | 交互方式 | 暴露API能力 |
|-------|------|----------|------------|
| **Claude Code** | Anthropic Agent SDK | TUI / `claude -p` print mode / `claude remote-control` | 可通过OpenAI wrapper暴露HTTP API；原生有remote-control |
| **Hermes/执策** | OpenClaw | 飞书bot / hermes-relay.py (port 18790) | 飞书群消息 + 本地HTTP |
| **Codex CLI** | OpenAI | TUI / `codex mcp-server` (stdio) | 可作为MCP server暴露工具；`codex --json` 结构化输出 |

**我**跑在云服务器(VM-23-185-ubuntu)，三个Agent都跑在人的Mac本地。

## 核心问题

1. 三个本地Agent在NAT后面，我从云服务器无法直接访问
2. Agent之间没有统一的消息通道——Claude Code和Codex各跑各的
3. 当前只有Hermes通过飞书群跟我通信，Claude Code和Codex完全隔离

## 方案：Cloudflare Tunnel + MCP + 统一消息层

### 架构图

```
                    Cloudflare Edge
                    ┌─────────────────────────────────────┐
                    │  Tunnel: mac-tunnel                  │
                    │  ├── claude.yourdomain.com → :3001   │  Claude Code API wrapper
                    │  ├── hermes.yourdomain.com → :18790  │  Hermes relay
                    │  ├── codex.yourdomain.com → :3002    │  Codex MCP-over-HTTP
                    │  └── hub.yourdomain.com   → Worker   │  路由/消息/状态
                    │                                       │
                    │  Tunnel: cloud-tunnel                 │
                    │  └── shi.yourdomain.com   → :18789    │  我的OpenClaw
                    └─────────────────────────────────────┘
                              │          │          │
                    ┌─────────┼──────────┼──────────┤
                    ▼         ▼          ▼          ▼
              ┌──────────┐ ┌──────┐ ┌───────┐ ┌──────────┐
              │ Claude   │ │Hermes│ │ Codex │ │ 我(云)   │
              │ Code     │ │      │ │  CLI  │ │ OpenClaw │
              │ :3001    │ │:18790│ │ :3002 │ │ :18789   │
              └──────────┘ └──────┘ └───────┘ └──────────┘
                    └──────── Mac 本地 ────────┘
```

### 第一步：Mac上跑一个cloudflared tunnel

在Mac上创建一个named tunnel，把三个Agent都暴露出去：

```yaml
# ~/.cloudflared/config.yml
tunnel: mac-agents
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  # Claude Code API wrapper
  - hostname: claude.yourdomain.com
    service: http://localhost:3001
  # Hermes relay
  - hostname: hermes.yourdomain.com
    service: http://localhost:18790
  # Codex HTTP bridge
  - hostname: codex.yourdomain.com
    service: http://localhost:3002
  - service: http_status:404
```

### 第二步：给每个Agent包一层HTTP API

#### Claude Code → OpenAI-compatible API

用 `claude-code-openai-wrapper`（开源项目）：
```bash
# 在Mac上
git clone https://github.com/RichardAtCT/claude-code-openai-wrapper
cd claude-code-openai-wrapper
poetry install
poetry run uvicorn src.main:app --port 3001
```

暴露了：
- `POST /v1/chat/completions` — OpenAI格式
- `POST /v1/messages` — Anthropic格式
- 支持streaming、session continuity、tool execution

这样我可以通过标准的OpenAI API格式调用Claude Code。

#### Codex CLI → MCP-over-HTTP bridge

Codex原生支持 `codex mcp-server`（stdio模式），需要包一层HTTP：

```typescript
// codex-http-bridge.ts
// 把Codex的stdio MCP server包装成HTTP API
import { spawn } from 'child_process';
import express from 'express';

const app = express();
app.use(express.json());

// 启动Codex MCP server进程
const codex = spawn('codex', ['mcp-server']);

// MCP over HTTP: POST /mcp/call
app.post('/mcp/call', async (req, res) => {
  const { tool, arguments: args } = req.body;
  // 通过stdin发送MCP请求
  const request = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: tool, arguments: args },
    id: Date.now()
  }) + '\n';
  
  codex.stdin.write(request);
  
  // 从stdout读取响应（简化版，实际需要处理MCP协议帧）
  // ... 或者用 codex -p 的print mode更简单
  res.json({ status: 'processing' });
});

// 更简单的方式：直接用 codex -p (print mode)
app.post('/ask', async (req, res) => {
  const { prompt, model } = req.body;
  const proc = spawn('codex', [
    '-p', prompt,
    '--model', model || 'gpt-5-codex',
    '--output-format', 'json',
    '--permission-mode', 'auto'
  ]);
  
  let output = '';
  proc.stdout.on('data', d => output += d);
  proc.on('close', () => {
    try { res.json(JSON.parse(output)); }
    catch { res.json({ result: output }); }
  });
});

app.listen(3002, () => console.log('Codex HTTP bridge on :3002'));
```

更简单的方式——直接用 `codex -p`：
```bash
# 一行搞定，不需要bridge
codex -p "你的prompt" --output-format json --permission-mode auto
```

通过Cloudflare Tunnel，我从云服务器可以远程触发这个命令。

#### Hermes → 已有relay

Hermes已经有hermes-relay.py在18790端口，直接用。

### 第三步：云服务器也开tunnel

```yaml
# ~/.cloudflared/config.yml (云服务器)
tunnel: cloud-agent
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: shi.yourdomain.com
    service: http://localhost:18789
  - service: http_status:404
```

### 第四步：Workers做消息路由（可选进阶）

```typescript
// agent-hub Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // POST /task — 派任务给指定Agent
    if (url.pathname === '/task') {
      const { target, prompt, options } = await request.json();
      
      const endpoints: Record<string, string> = {
        'claude': 'https://claude.yourdomain.com',
        'hermes': 'https://hermes.yourdomain.com',
        'codex':  'https://codex.yourdomain.com',
        'shi':    'https://shi.yourdomain.com',
      };
      
      const base = endpoints[target];
      if (!base) return new Response('Unknown agent', { status: 404 });
      
      // 根据目标Agent选择API格式
      if (target === 'claude') {
        return fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: options?.model || 'claude-sonnet-4-20250514',
            messages: [{ role: 'user', content: prompt }],
          }),
        });
      }
      
      if (target === 'codex') {
        return fetch(`${base}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            model: options?.model || 'gpt-5-codex',
          }),
        });
      }
      
      // Hermes/shi: 直接转发
      return fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...options }),
      });
    }

    // GET /status — 各Agent在线状态
    if (url.pathname === '/status') {
      const agents = ['claude', 'hermes', 'codex', 'shi'];
      const results = await Promise.allSettled(
        agents.map(async a => {
          const endpoints: Record<string, string> = {
            'claude': 'https://claude.yourdomain.com/health',
            'hermes': 'https://hermes.yourdomain.com/health',
            'codex':  'https://codex.yourdomain.com/health',
            'shi':    'https://shi.yourdomain.com/health',
          };
          const r = await fetch(endpoints[a], { signal: AbortSignal.timeout(5000) });
          return { agent: a, status: r.ok ? 'online' : 'error' };
        })
      );
      return Response.json(results.map((r, i) => ({
        agent: agents[i],
        status: r.status === 'fulfilled' ? r.value.status : 'offline',
      })));
    }

    return new Response('Not found', { status: 404 });
  }
};
```

### 第五步：我（OpenClaw）集成

我可以通过以下方式调用其他Agent：

```bash
# 让Claude Code做代码审查
curl -s https://claude.yourdomain.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4","messages":[{"role":"user","content":"Review this PR: ..."}]}'

# 让Codex执行自动化任务
curl -s https://codex.yourdomain.com/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Refactor the auth module","model":"gpt-5-codex"}'

# 让Hermes做YouTube抓取
curl -s https://hermes.yourdomain.com/ \
  -H "Content-Type: application/json" \
  -d '{"type":"youtube","url":"..."}'
```

我也可以把这些写成OpenClaw的MCP server，这样我就能直接用工具调用：
```bash
# 在我的OpenClaw配置里加MCP server
# 指向 https://claude.yourdomain.com, https://codex.yourdomain.com 等
```

## 实施优先级

### Phase 1: 最小可用（今天能跑）
1. Mac上装cloudflared
2. 跑 `cloudflared tunnel --url http://localhost:18790` — 先让Hermes可达
3. 我测试能不能通过tunnel URL跟Hermes通信

### Phase 2: Claude Code接入
1. Mac上启动claude-code-openai-wrapper (port 3001)
2. cloudflared config加claude路由
3. 我测试远程调Claude Code

### Phase 3: Codex接入
1. 写codex-http-bridge (port 3002)
2. cloudflared config加codex路由
3. 我测试远程调Codex

### Phase 4: Workers路由层
1. 部署agent-hub Worker
2. 统一入口、健康检查、消息路由

### Phase 5: 安全加固
1. Cloudflare Zero Trust Access
2. Service Token认证
3. 只允许我的云服务器IP访问tunnel

## 需要你做的

1. **Cloudflare账号** — 免费注册
2. **域名**（可选） — 没有的话先用 trycloudflare.com
3. **Mac上装cloudflared** — `brew install cloudflared`
4. **确认每个Agent的端口** — Claude Code wrapper用3001、Codex bridge用3002可以吗？
5. **安全策略** — 是否用Zero Trust限制访问？还是共享secret够了？

## 预算

全部免费tier：
- Cloudflare Tunnel: 免费（无限流量）
- Workers: 免费10万请求/天
- KV: 免费10万读/天
- claude-code-openai-wrapper: 开源免费
- Codex HTTP bridge: 自己写，免费
