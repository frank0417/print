@echo off
start "" chrome.exe chrome://extensions/ 2>nul
if errorlevel 1 start "" msedge.exe chrome://extensions/ 2>nul
echo 请开启「开发者模式」，加载已解压扩展，目录见 %%LOCALAPPDATA%%\PrintKit\extension
echo 完整路径已写入 %%LOCALAPPDATA%%\PrintKit\EXTENSION_PATH.txt
type "%LOCALAPPDATA%\PrintKit\EXTENSION_PATH.txt" 2>nul
pause
