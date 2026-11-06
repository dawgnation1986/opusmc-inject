@echo off
rem OpusMC play launcher: start PHPMC + mc-proxy + static server (if not running), then open the game.
rem In the game: Multiplayer -> Direct Connect -> just press Enter (default ws://localhost:8780).
cd /d "%~dp0"

rem 1) PHPMC (wss 24443 + tcp 25565)
netstat -ano | findstr /C:":24443" | findstr /C:"LISTENING" >nul 2>&1
if errorlevel 1 (
  if exist "PHPMC\bin\server.php" (
    start "PHPMC Server" /min php "PHPMC\bin\server.php"
    ping -n 6 127.0.0.1 >nul
  )
)

rem 2) mc-proxy (8780: OpusMC direct connect -> PHPMC wss 24443)
netstat -ano | findstr /C:":8780" | findstr /C:"LISTENING" >nul 2>&1
if errorlevel 1 (
  start "MC Proxy" /min node "tools\mc-proxy.mjs" localhost 24443 8780
  ping -n 3 127.0.0.1 >nul
)

rem 3) static file server (8777, reuses whatever is already listening)
netstat -ano | findstr /C:":8777" | findstr /C:"LISTENING" >nul 2>&1
if errorlevel 1 (
  start "Static Server" /min node "tools\server.mjs"
  ping -n 3 127.0.0.1 >nul
)

start msedge "http://localhost:8777/game.html?rooms=https://xz.honghemc.cn:8443"
