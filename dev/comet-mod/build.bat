@echo off
chcp 65001 >nul
call "%~dp0env.bat"
cd /d "%~dp0meteor-client"
echo.
echo [Comet FX] Building Meteor 26.3 + CometFX visual layer...
echo [Comet FX] All caches stay on D: %GRADLE_USER_HOME%
echo.
call gradlew.bat build --no-daemon --console=plain
if errorlevel 1 (
  echo.
  echo [Comet FX] BUILD FAILED
  pause
  exit /b 1
)
echo.
echo [Comet FX] BUILD OK - jar:
dir /b build\libs\*.jar
echo.
pause
