@echo off
setlocal
start "" chrome.exe chrome://extensions/ 2>nul
if errorlevel 1 start "" msedge.exe chrome://extensions/ 2>nul
echo Extension folder:
type "%LOCALAPPDATA%\PrintKit\EXTENSION_PATH.txt" 2>nul
echo.
echo Load unpacked extension and select the folder above.
pause
