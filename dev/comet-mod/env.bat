@echo off
REM ============================================================
REM  Comet FX 构建环境 —— 一切皆在 D 盘，零 C 盘写入
REM  用法：在 cmd 里 call env.bat，再跑 gradlew.bat
REM ============================================================
set "ROOT=D:\discuz\webmc\hook\opusmc-inject\comet-mod"

REM Gradle 自身：发行版、依赖缓存、反编译产物、daemon 日志
set "GRADLE_USER_HOME=%ROOT%\_cache\gradle-home"

REM Java / 系统临时目录（Loom 反编译 MC 会大量使用）
set "TMP=%ROOT%\_tmp"
set "TEMP=%ROOT%\_tmp"
set "TMPDIR=%ROOT%\_tmp"

REM JVM 层再兜一次底
set "JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=%ROOT%\_tmp -Duser.home=%ROOT%\_cache\home"

REM Gradle 项目缓存也放 D 盘（默认在工程 .gradle，本来就在 D 盘，显式声明）
set "GRADLE_OPTS=-Dorg.gradle.daemon=false -Dorg.gradle.parallel=false -Dorg.gradle.caching=false -Dfile.encoding=UTF-8"

if not exist "%ROOT%\_cache\gradle-home" mkdir "%ROOT%\_cache\gradle-home"
if not exist "%ROOT%\_tmp" mkdir "%ROOT%\_tmp"
if not exist "%ROOT%\_cache\home" mkdir "%ROOT%\_cache\home"

echo [env] GRADLE_USER_HOME = %GRADLE_USER_HOME%
echo [env] TMP              = %TMP%
echo [env] JAVA_HOME        = %JAVA_HOME%
