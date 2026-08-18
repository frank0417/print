@echo off
setlocal
cd /d "%~dp0"
echo Starting PrintKit installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-PrintKit.ps1"
if errorlevel 1 (
  echo.
  echo Install failed.
  pause
)
