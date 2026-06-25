@echo off
chcp 65001 >nul 2>&1
title Agent Network - Stop All
echo 正在停止所有 Agent Network 服务...

:: Kill cloudflared tunnels
taskkill /fi "WINDOWTITLE eq Codex Tunnel*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Claude Tunnel*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Hermes Tunnel*" /f >nul 2>&1

:: Kill agent services
taskkill /fi "WINDOWTITLE eq Codex Bridge*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Claude Code API*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Hermes Relay*" /f >nul 2>&1

echo ✓ 所有服务已停止
timeout /t 2 /nobreak >nul
