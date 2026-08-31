@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "%~dp0Install-PrintKit.ps1" (
  echo ERROR: Install-PrintKit.ps1 not found.
  echo Run this from the extracted PrintKit-Setup-windows folder.
  pause
  exit /b 1
)

echo Starting PrintKit installer...
echo Folder: %~dp0
echo Log: %TEMP%\PrintKit-install.log
echo.

powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0Install-PrintKit.ps1"
set ERR=%ERRORLEVEL%

if not "%ERR%"=="0" (
  echo.
  echo Install failed (exit %ERR%). See errors above.
  echo Log file: %TEMP%\PrintKit-install.log
  echo.
  echo Tips:
  echo  - Re-download ZIP from GitHub Releases, do NOT use WeChat transfer
  echo  - Extract fully, then run Install-PrintKit.bat
  echo  - Close Chrome/Edge, delete %%LOCALAPPDATA%%\PrintKit, retry
  pause
  exit /b %ERR%
)

endlocal
