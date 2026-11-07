@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 is required. Install it, then double-click PLAY.cmd again.
  pause
  exit /b 1
)
node scripts\start-client.mjs
if errorlevel 1 pause
