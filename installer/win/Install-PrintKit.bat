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
echo.

powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -Command ^
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & '%~dp0Install-PrintKit.ps1'"

if errorlevel 1 (
  echo.
  echo Install failed. See errors above.
  echo If text looks garbled, re-download the ZIP from GitHub Releases
  echo instead of copying through WeChat.
  pause
  exit /b 1
)

endlocal
