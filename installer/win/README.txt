PrintKit Windows Setup (Win7 compatible)
========================================

Your diagnose showed: node.exe NO / host.js NO
= PrintKit was NOT installed yet.

MUST DO
-------
1. Download from GitHub Releases (browser, NOT WeChat):
   https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.zip
2. Copy ZIP to C:\PrintKit-Setup\
3. Extract fully
4. Double-click Install-PrintKit.bat
   (or Install-PrintKit-Cmd.bat)
5. Wait until you see "Install finished"
6. chrome://extensions -> Developer mode -> Load unpacked
   Folder: %LOCALAPPDATA%\PrintKit\extension
7. Expected ID: memmopnlapcegennpipheiadaonehljd

If still failing, run Diagnose-PrintKit.bat and send the report.

This build uses Node 12 + pure CMD installer for Windows 7.
