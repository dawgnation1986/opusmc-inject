@echo off
rem OpusMC resource-normalized source tree (port 8778, original 8777 untouched)
cd /d "%~dp0"
python tools\rebuild_atlas.py
if errorlevel 1 ( echo [atlas] rebuild failed & pause & exit /b 1 )
start "OpusMC Source" /min node "tools\server-source.mjs"
ping -n 3 127.0.0.1 >nul
start msedge "http://localhost:8778/game.html?rooms=http://localhost:8778"
