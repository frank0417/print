@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Starting PrintKit installer...
echo Folder: %~dp0
echo Log: %TEMP%\PrintKit-install.log
echo.

REM Prefer pure CMD installer on Windows 7 / when PowerShell is old
if exist "%~dp0Install-PrintKit-Cmd.bat" (
  call "%~dp0Install-PrintKit-Cmd.bat"
  set ERR=%ERRORLEVEL%
  if "%ERR%"=="0" (
    endlocal
    exit /b 0
  )
  echo.
  echo CMD installer failed ^(exit %ERR%^). Trying PowerShell fallback...
  echo.
)

if not exist "%~dp0Install-PrintKit.ps1" (
  echo ERROR: Install-PrintKit.ps1 not found.
  echo Run this from the extracted PrintKit-Setup-windows folder.
  pause
  exit /b 1
)

powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0Install-PrintKit.ps1"
set ERR=%ERRORLEVEL%

if not "%ERR%"=="0" (
  echo.
  echo Install failed ^(exit %ERR%^). See errors above.
  echo Log file: %TEMP%\PrintKit-install.log
  echo.
  echo Tips:
  echo  - Re-download ZIP from GitHub Releases, do NOT use WeChat
  echo  - Extract fully, then double-click Install-PrintKit.bat
  echo  - Or run Install-PrintKit-Cmd.bat directly
  echo  - Close Chrome, delete %%LOCALAPPDATA%%\PrintKit, retry
  pause
  exit /b %ERR%
)

endlocal
