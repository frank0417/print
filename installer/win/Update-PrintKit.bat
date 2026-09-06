@echo off
REM PrintKit updater. Safe to run remotely / via scheduled task.
REM   Update-PrintKit.bat
REM   Update-PrintKit.bat /S
REM   Update-PrintKit.bat /S --zip \\nas\pkg\PrintKit-Setup-windows.zip
REM   Update-PrintKit.bat /S --url https://example.com/PrintKit-Setup-windows.zip
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set SILENT=0
echo %*| find /I "/S" >nul && set SILENT=1
echo %*| find /I "/silent" >nul && set SILENT=1

set "LOG=%TEMP%\printkit-update.log"
set "NODE=%~dp0runtime\node\node.exe"
set "HOST=%~dp0host\host.js"
if not exist "%NODE%" set "NODE=%LOCALAPPDATA%\PrintKit\runtime\node\node.exe"
if not exist "%HOST%" set "HOST=%LOCALAPPDATA%\PrintKit\host\host.js"

echo ========================================
echo  PrintKit Update
echo ========================================
echo Log: %LOG%
echo.

if not exist "%NODE%" (
  echo ERROR: bundled Node not found. Reinstall PrintKit first.
  if "%SILENT%"=="0" pause
  exit /b 1
)
if not exist "%HOST%" (
  echo ERROR: host.js not found. Reinstall PrintKit first.
  if "%SILENT%"=="0" pause
  exit /b 1
)

echo Checking GitHub / applying package...
"%NODE%" "%HOST%" --cli applyUpdate %*
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo Update failed ^(exit %ERR%^). See %LOG%
  echo You can also re-run the latest installer:
  echo   https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.exe
  if "%SILENT%"=="0" pause
  exit /b %ERR%
)

echo Update finished. In Chrome: chrome://extensions -^> PrintKit -^> reload.
echo ^(The popup "立即升级" does this automatically.^)
if "%SILENT%"=="0" pause
endlocal
exit /b 0
