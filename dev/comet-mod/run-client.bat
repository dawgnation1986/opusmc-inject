@echo off
chcp 65001 >nul
call "%~dp0env.bat"
cd /d "%~dp0meteor-client"
echo.
echo [Comet FX] Launching Minecraft 26.3 client with CometFX...
echo [Comet FX] Requires a Minecraft account; assets will be downloaded to D: caches.
echo [Comet FX] After login: ClickGUI -^> Render -^> comet-fx -^> enable
echo.
call gradlew.bat runClient --no-daemon --console=plain
pause
