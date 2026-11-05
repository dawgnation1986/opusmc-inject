@echo off
title OpusMC local server (port 8777)
cd /d "%~dp0probe"
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found in system PATH.
  echo Install Python 3 ^(python.org^), then run this file again.
  echo Your local game files are intact in the "probe" folder.
  pause
  exit /b 1
)
echo ================================================
echo  OpusMC OFFLINE edition - local files on YOUR disk
echo  URL: http://localhost:8777/game.html
echo  The browser address bar must show localhost:8777.
echo  If it shows bilibili.com you opened the online
echo  tab yourself - that is NOT this local server.
echo  Keep this window OPEN while playing. Ctrl+C stops.
echo ================================================
start "" "http://localhost:8777/game.html"
python -m http.server 8777
