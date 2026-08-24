@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM X32 Visualizer launcher — runs the bridge server in a restart-on-exit
REM loop. Normally started hidden by the scheduled task install.ps1
REM registers; can also be double-clicked to run in the foreground.
REM
REM Everything here is relative to this file's own folder (%~dp0), so the
REM install can live anywhere (install.ps1 always uses C:\X32Visualizer, but
REM this script itself doesn't assume that).

set "ROOT=%~dp0"
set "DATA_DIR=%ROOT%data"
set "LOG_FILE=%DATA_DIR%\bridge.log"

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

REM --- Apply a pending update.ps1 update, staged by update.ps1 as
REM     update.ps1.new to avoid a script overwriting itself while running.
if exist "%ROOT%update.ps1.new" (
    move /y "%ROOT%update.ps1.new" "%ROOT%update.ps1" >nul
    echo [start.cmd] applied pending update.ps1 update >> "%LOG_FILE%"
)

REM --- Load settings.env (KEY=VALUE per line, # comments and blanks skipped)
if exist "%ROOT%settings.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%K in ("%ROOT%settings.env") do (
        if not "%%K"=="" set "%%K=%%L"
    )
)

set "X32_BASELINE_FILE=%ROOT%data\baseline.json"
set "X32_WEB_DIST=%ROOT%app\web"

:loop
REM Rotate the log if it has grown past ~5MB, keeping one prior copy.
if exist "%LOG_FILE%" (
    for %%F in ("%LOG_FILE%") do set "LOG_SIZE=%%~zF"
    if defined LOG_SIZE if !LOG_SIZE! GTR 5242880 (
        move /y "%LOG_FILE%" "%LOG_FILE%.1" >nul
    )
)

echo [start.cmd] %date% %time% starting node\node.exe app\server.mjs >> "%LOG_FILE%"
"%ROOT%node\node.exe" "%ROOT%app\server.mjs" >> "%LOG_FILE%" 2>&1
echo [start.cmd] %date% %time% server.mjs exited with code %errorlevel% — restarting in 5s >> "%LOG_FILE%"

timeout /t 5 /nobreak >nul
goto loop
