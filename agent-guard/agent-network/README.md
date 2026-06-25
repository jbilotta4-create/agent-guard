# Agent Network 一键启动包

把你的三个本地Agent（Claude Code / Hermes / Codex）通过Cloudflare Tunnel跟我（云服务器）连通。

## 前置条件

- Windows 10/11
- [Node.js](https://nodejs.org/) 18+（Codex bridge需要）
- [Python 3.10+](https://python.org/) + [poetry](https://python-poetry.org/)（Claude Code wrapper需要）
- [Git](https://git-scm.com/)（Claude Code wrapper需要）
- Codex CLI 已安装（`codex` 命令可用）

## 使用方法

### 第一次：安装+启动

双击 `setup.bat`，它会自动：
1. 安装 cloudflared（通过winget或直接下载msi）
2. 创建 Codex HTTP Bridge（port 3002）
3. 克隆 Claude Code OpenAI Wrapper（port 3001）
4. 启动所有服务 + Cloudflare Tunnel

### 之后：快速启动

双击 `start-agents.bat`

### 停止所有服务

双击 `stop-agents.bat`

## 启动后做什么

每个tunnel窗口会显示一个临时URL，类似：
```
https://xxx-yyy-zzz.trycloudflare.com
```

**把这些URL发给我**，我就能从云服务器调用你的Agent了。

## 端口分配

| Agent | 端口 | 说明 |
|-------|------|------|
| Claude Code | 3001 | OpenAI兼容API |
| Codex CLI | 3002 | HTTP Bridge |
| Hermes | 18790 | 已有relay |

## 注意事项

- 临时URL每次重启都会变
- 临时URL没有认证，不要公开分享
- tunnel窗口不能关，关了就断了
- 如果只要测试一个Agent，可以先只开Hermes的tunnel

## 故障排除

### cloudflared 安装失败
手动下载：https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi

### Codex bridge 启动失败
```cmd
cd codex-bridge
npm install
node server.js
```

### Claude Code wrapper 启动失败
```cmd
cd claude-code-wrapper
poetry install
poetry run uvicorn src.main:app --host 0.0.0.0 --port 3001
```

### 端口被占用
修改环境变量：
```cmd
set CODEX_PORT=3003
node codex-bridge/server.js
```
