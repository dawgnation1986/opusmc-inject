@echo off
rem OpusMC offline launcher: start local server (if not running), then open the game
rem with ?rooms= so login / AI companion work (origin spoof via Tampermonkey).
cd /d "%~dp0probe"
netstat -ano | findstr /C:":8777" | findstr /C:"LISTENING" >nul 2>&1
if errorlevel 1 (
  start "OpusMC Server" /min node "%~dp0tools\server.mjs"
  ping -n 3 127.0.0.1 >nul
)
start msedge "http://localhost:8777/game.html?rooms=https://xz.honghemc.cn:8443"
