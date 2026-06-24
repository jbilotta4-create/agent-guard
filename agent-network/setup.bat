@echo off
chcp 65001 >nul 2>&1
title Agent Network - One-Click Setup
echo ============================================
echo   Agent Network 一键启动脚本
echo ============================================
echo.

:: Check if running as admin (needed for service install)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [提示] 非管理员模式运行。如需安装为Windows服务，请右键"以管理员身份运行"
    echo.
)

:: ============================================
:: Step 1: Check/Install cloudflared
:: ============================================
echo [1/4] 检查 cloudflared ...
where cloudflared >nul 2>&1
if %errorLevel% neq 0 (
    echo cloudflared 未安装，正在安装...
    winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
    if %errorLevel% neq 0 (
        echo [错误] winget 安装失败。尝试直接下载...
        echo 正在下载 cloudflared...
        powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi' -OutFile '%TEMP%\cloudflared.msi'"
        if exist "%TEMP%\cloudflared.msi" (
            msiexec /i "%TEMP%\cloudflared.msi" /qn
            echo cloudflared 安装完成
        ) else (
            echo [错误] 下载失败，请手动安装：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
            pause
            exit /b 1
        )
    )
) else (
    echo cloudflared 已安装 ✓
)
echo.

:: ============================================
:: Step 2: Setup codex-bridge (Node.js)
:: ============================================
echo [2/4] 检查 Codex HTTP Bridge ...
if not exist "%~dp0codex-bridge\server.js" (
    echo 正在创建 Codex HTTP Bridge...
    if not exist "%~dp0codex-bridge" mkdir "%~dp0codex-bridge"
    
    :: Create package.json
    echo {"name":"codex-bridge","version":"1.0.0","scripts":{"start":"node server.js"}} > "%~dp0codex-bridge\package.json"
    
    :: Create server.js
    (
    echo const { spawn } = require('child_process');
    echo const express = require('express');
    echo const app = express^(^);
    echo app.use(express.json^(^){ limit: '10mb' });
    echo.
    echo // Health check
    echo app.get('/health', ^(req, res^) =^> res.json^({ status: 'ok', agent: 'codex' }\)^);
    echo.
    echo // Ask Codex a question
    echo app.post('/ask', async ^(req, res^) =^> {
    echo   const { prompt, model, timeout } = req.body;
    echo   if ^(!prompt^) return res.status(400^).json^({ error: 'prompt is required' }\);
    echo.
    echo   const args = ['-p', prompt, '--output-format', 'json'];
    echo   if ^(model^) args.push('--model', model^);
    echo.
    echo   const proc = spawn('codex', args, { timeout: timeout ^|^| 300000 }\);
    echo   let output = '';
    echo   let errorOutput = '';
    echo.
    echo   proc.stdout.on('data', d =^> output += d.toString^(^)\);
    echo   proc.stderr.on('data', d =^> errorOutput += d.toString^(^)\);
    echo.
    echo   proc.on('close', ^(code^) =^> {
    echo     if ^(code !== 0 ^&^& !output^) {
    echo       return res.status(500^).json^({ error: errorOutput ^|^| 'Process failed', code }\);
    echo     }
    echo     try { res.json^(JSON.parse(output^)\); }
    echo     catch { res.json^({ result: output.trim^(^) }\); }
    echo   }\);
    echo   proc.on('error', ^(err^) =^> res.status(500^).json^({ error: err.message }\)^);
    echo }\);
    echo.
    echo const PORT = process.env.CODEX_PORT ^|^| 3002;
    echo app.listen(PORT, '0.0.0.0', ^(^) =^> console.log^(`Codex bridge on http://localhost:${PORT}`\)\);
    ) > "%~dp0codex-bridge\server.js"
    
    :: Install dependencies
    echo 正在安装 Node.js 依赖...
    cd /d "%~dp0codex-bridge"
    call npm install express
    cd /d "%~dp0"
    echo Codex HTTP Bridge 创建完成 ✓
) else (
    echo Codex HTTP Bridge 已存在 ✓
)
echo.

:: ============================================
:: Step 3: Setup Claude Code wrapper
:: ============================================
echo [3/4] 检查 Claude Code OpenAI Wrapper ...
if not exist "%~dp0claude-code-wrapper\src\main.py" (
    if not exist "%~dp0claude-code-wrapper\pyproject.toml" (
        echo 正在克隆 claude-code-openai-wrapper...
        git clone https://github.com/RichardAtCT/claude-code-openai-wrapper "%~dp0claude-code-wrapper"
        if %errorLevel% neq 0 (
            echo [警告] 克隆失败，Claude Code API 将不可用
            echo 你可以之后手动运行: git clone https://github.com/RichardAtCT/claude-code-openai-wrapper
        ) else (
            echo Claude Code Wrapper 克隆完成 ✓
        )
    ) else (
        echo Claude Code Wrapper 已存在 ✓
    )
) else (
    echo Claude Code Wrapper 已存在 ✓
)
echo.

:: ============================================
:: Step 4: Start everything
:: ============================================
echo [4/4] 启动所有服务...
echo.

:: Start Codex bridge in a new window
echo 启动 Codex HTTP Bridge (port 3002)...
start "Codex Bridge" cmd /c "cd /d "%~dp0codex-bridge" && node server.js"

:: Start Claude Code wrapper in a new window (if exists)
if exist "%~dp0claude-code-wrapper\pyproject.toml" (
    echo 启动 Claude Code Wrapper (port 3001)...
    start "Claude Code API" cmd /c "cd /d "%~dp0claude-code-wrapper" && poetry run uvicorn src.main:app --host 0.0.0.0 --port 3001"
) else (
    echo [跳过] Claude Code Wrapper 未安装
)

:: Start Hermes relay if exists
if exist "%~dp0hermes-relay.py" (
    echo 启动 Hermes Relay (port 18790)...
    start "Hermes Relay" cmd /c "python %~dp0hermes-relay.py"
) else (
    echo [跳过] hermes-relay.py 未找到，如果你已有Hermes relay在运行可以忽略
)

:: Wait for services to start
echo 等待服务启动...
timeout /t 5 /nobreak >nul

:: Start Cloudflare Tunnel - one tunnel for all services
echo.
echo ============================================
echo   启动 Cloudflare Tunnel
echo ============================================
echo.
echo 这将为所有Agent创建一个tunnel。
echo 启动后会显示临时URL，请把URL发给我。
echo.
echo 按 Ctrl+C 可以停止tunnel。
echo.

:: Try named tunnel first, fall back to quick tunnel
cloudflared tunnel run 2>nul
if %errorLevel% neq 0 (
    echo [提示] 没有配置named tunnel，使用临时tunnel...
    echo 每个服务一个tunnel，URL会在每次重启后变化。
    echo.
    
    :: Start tunnels for each service
    echo 启动 Codex Tunnel...
    start "Codex Tunnel" cmd /c "cloudflared tunnel --url http://localhost:3002"
    
    echo 启动 Claude Code Tunnel...
    if exist "%~dp0claude-code-wrapper\pyproject.toml" (
        start "Claude Tunnel" cmd /c "cloudflared tunnel --url http://localhost:3001"
    )
    
    echo 启动 Hermes Tunnel...
    start "Hermes Tunnel" cmd /c "cloudflared tunnel --url http://localhost:18790"
    
    echo.
    echo ============================================
    echo   所有服务已启动！
    echo ============================================
    echo.
    echo 各tunnel窗口会显示临时URL（类似 https://xxx.trycloudflare.com）
    echo 请把这些URL发给我，我就能从云服务器调用你的Agent了。
    echo.
    echo 关闭tunnel窗口即可停止服务。
)

pause
