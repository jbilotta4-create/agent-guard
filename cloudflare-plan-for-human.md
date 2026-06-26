# Cloudflare 多Agent互联方案（Windows版）

## 现状

你本地三个Agent + 我一个云端Agent：

| Agent | 位置 | 当前状态 |
|-------|------|----------|
| Claude Code | 你的Windows电脑 | TUI独立运行，无网络API |
| Hermes/执策 | 你的Windows电脑 | 有飞书bot，有本地relay |
| Codex CLI | 你的Windows电脑 | TUI独立运行，无网络API |
| 我 | 云服务器 | OpenClaw，飞书channel |

**问题**：四个Agent完全隔离，无法互相调用。

## 目标架构

```
              ┌──────── Cloudflare Edge ────────┐
              │                                   │
              │  win-tunnel:                      │
              │  ├── claude.xxx → localhost:3001  │
              │  ├── hermes.xxx → localhost:18790 │
              │  └── codex.xxx  → localhost:3002  │
              │                                   │
              │  cloud-tunnel:                    │
              │  └── shi.xxx    → localhost:18789 │
              └───────────────────────────────────┘
                    │              │
         ┌─────────┴────────┐     │
         ▼         ▼        ▼     ▼
   ┌─────────┐ ┌──────┐ ┌─────┐ ┌──────┐
   │ Claude  │ │Hermes│ │Codex│ │ 我   │
   │ Code    │ │      │ │ CLI │ │(云端)│
   └─────────┘ └──────┘ └─────┘ └──────┘
       └──── 你的Windows电脑 ────┘
```

四个Agent通过Cloudflare Tunnel互通，不需要开端口、不需要公网IP、自动HTTPS。

---

## Phase 1：安装cloudflared（5分钟）

### 1.1 安装

打开PowerShell，运行：
```powershell
winget install Cloudflare.cloudflared
```

或者直接下载安装包：
https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi

### 1.2 验证

```powershell
cloudflared --version
```

---

## Phase 2：给Agent包HTTP API（20分钟）

三个Agent都没有现成的HTTP API，需要各包一层。

### 2.1 Claude Code → OpenAI兼容API

安装Python wrapper：
```powershell
# 需要Python 3.10+和poetry
pip install poetry
git clone https://github.com/RichardAtCT/claude-code-openai-wrapper
cd claude-code-openai-wrapper
poetry install
poetry run uvicorn src.main:app --host 0.0.0.0 --port 3001
```

启动后暴露：
- `POST http://localhost:3001/v1/chat/completions` — OpenAI格式
- `POST http://localhost:3001/v1/messages` — Anthropic格式

### 2.2 Codex CLI → HTTP Bridge

需要安装Node.js，然后创建一个简单的HTTP服务：

1. 创建文件夹 `codex-bridge`，在里面运行：
```powershell
npm init -y
npm install express
```

2. 创建 `server.js`：
```javascript
const { spawn } = require('child_process');
const express = require('express');
const app = express();
app.use(express.json());

// 简单模式：用 codex -p 的print mode
app.post('/ask', async (req, res) => {
  const { prompt, model } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  
  const args = ['-p', prompt, '--output-format', 'json'];
  if (model) args.push('--model', model);
  
  const proc = spawn('codex', args, { timeout: 300000 });
  let output = '';
  let errorOutput = '';
  
  proc.stdout.on('data', d => output += d.toString());
  proc.stderr.on('data', d => errorOutput += d.toString());
  
  proc.on('close', (code) => {
    if (code !== 0 && !output) {
      return res.status(500).json({ error: errorOutput || 'Process failed', code });
    }
    try {
      res.json(JSON.parse(output));
    } catch {
      res.json({ result: output.trim() });
    }
  });
});

// 健康检查
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(3002, '0.0.0.0', () => console.log('Codex bridge on http://localhost:3002'));
```

3. 启动：
```powershell
node server.js
```

### 2.3 Hermes → 已有relay

Hermes已经有hermes-relay.py在18790端口，不用改。

如果没在运行，启动它：
```powershell
python hermes-relay.py
```

---

## Phase 3：开Tunnel（5分钟）

### 3.1 快速测试（临时域名，今天就能跑）

开三个PowerShell窗口，分别运行：

```powershell
# 窗口1: Claude Code
cloudflared tunnel --url http://localhost:3001

# 窗口2: Hermes
cloudflared tunnel --url http://localhost:18790

# 窗口3: Codex
cloudflared tunnel --url http://localhost:3002
```

每个窗口会输出一个临时URL，类似：
```
https://xxx-yyy-zzz.trycloudflare.com
```

**把这三个URL发给我**，我就能从云服务器调你的Agent了。

### 3.2 稳定部署（自己的域名，之后做）

注册Cloudflare账号后，创建named tunnel：

```powershell
# 登录
cloudflared tunnel login

# 创建tunnel
cloudflared tunnel create win-agents

# 写配置文件 %USERPROFILE%\.cloudflared\config.yml
```

```yaml
tunnel: <your-tunnel-id>
credentials-file: %USERPROFILE%\.cloudflared\<your-tunnel-id>.json

ingress:
  - hostname: claude.yourdomain.com
    service: http://localhost:3001
  - hostname: hermes.yourdomain.com
    service: http://localhost:18790
  - hostname: codex.yourdomain.com
    service: http://localhost:3002
  - service: http_status:404
```

```powershell
# 配DNS
cloudflared tunnel route dns win-agents claude.yourdomain.com
cloudflared tunnel route dns win-agents hermes.yourdomain.com
cloudflared tunnel route dns win-agents codex.yourdomain.com

# 启动
cloudflared tunnel run win-agents
```

一个tunnel可以同时暴露三个Agent，只需要一个窗口。

---

## 我这边的状态

我已经在云服务器上开了tunnel：
```
https://register-expressions-sugar-deemed.trycloudflare.com → 我的OpenClaw
```

你可以从Windows浏览器访问这个URL验证连通性。

---

## 互通后的使用场景

1. **我调Claude Code**：让我把代码审查任务交给Claude Code，它擅长读大项目
2. **我调Codex**：让我把自动化编码任务交给Codex，它跑得快成本低
3. **我调Hermes**：让我让Hermes去抓YouTube/X上的内容
4. **Claude Code调我**：Claude Code可以通过我的tunnel让我做云服务器上的操作
5. **任务链**：Hermes抓视频→我转录分析→Claude Code写摘要→Codex格式化输出

---

## 需要你做的（按顺序）

1. ✅ 安装cloudflared：`winget install Cloudflare.cloudflared`
2. ✅ 启动三个Agent的HTTP服务（或至少一个先测通）
3. ✅ 开tunnel，把临时URL发给我
4. 📋 之后：注册Cloudflare账号 + 域名 → 换成named tunnel

**最简起步**：只开一个tunnel测试Hermes，确认通后再加其他两个。

---

## 费用

全部免费：
- Cloudflare Tunnel: 免费
- Workers: 免费10万请求/天
- claude-code-openai-wrapper: 开源免费
- Codex HTTP bridge: 自己写，免费

---

## 注意事项

1. **临时URL每次重启都会变**——named tunnel才有固定域名
2. **临时URL没有认证**——任何人拿到URL都能调你的Agent。换成named tunnel后加Zero Trust Access
3. **cloudflared窗口不能关**——关了tunnel就断了。想长期运行可以注册为Windows服务：
   ```powershell
   cloudflared service install
   ```
4. **Agent的HTTP服务也要保持运行**——Claude Code wrapper、Codex bridge、Hermes relay都不能关
