@echo off
chcp 65001 >nul 2>&1
title Agent Network - Quick Start
echo ============================================
echo   Agent Network 快速启动（已安装后使用）
echo ============================================
echo.

:: Start Codex bridge
if exist "%~dp0codex-bridge\server.js" (
    echo [1/3] 启动 Codex Bridge (port 3002)...
    start "Codex Bridge" cmd /c "cd /d "%~dp0codex-bridge" && node server.js"
) else (
    echo [1/3] Codex Bridge 未安装，跳过
)

:: Start Claude Code wrapper
if exist "%~dp0claude-code-wrapper\pyproject.toml" (
    echo [2/3] 启动 Claude Code API (port 3001)...
    start "Claude Code API" cmd /c "cd /d "%~dp0claude-code-wrapper" && poetry run uvicorn src.main:app --host 0.0.0.0 --port 3001"
) else (
    echo [2/3] Claude Code Wrapper 未安装，跳过
)

:: Start Hermes relay
if exist "%~dp0hermes-relay.py" (
    echo [3/3] 启动 Hermes Relay (port 18790)...
    start "Hermes Relay" cmd /c "python %~dp0hermes-relay.py"
) else (
    echo [3/3] Hermes Relay 未找到，跳过
)

timeout /t 3 /nobreak >nul

:: Start tunnels
echo.
echo 启动 Cloudflare Tunnels...
start "Codex Tunnel" cmd /c "cloudflared tunnel --url http://localhost:3002"
if exist "%~dp0claude-code-wrapper\pyproject.toml" (
    start "Claude Tunnel" cmd /c "cloudflared tunnel --url http://localhost:3001"
)
start "Hermes Tunnel" cmd /c "cloudflared tunnel --url http://localhost:18790"

echo.
echo ✓ 所有服务已启动！
echo 各tunnel窗口会显示临时URL，发给我即可。
echo.
pause
