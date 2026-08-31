PrintKit Windows One-Click Setup
================================

IMPORTANT
---------
Do NOT install from WeChat download folder (xwechat_files).
WeChat transfer can break the installer.
Download from GitHub Releases, copy to C:\PrintKit-Setup, then run.

Recommended: PrintKit-Setup-windows.exe
  -> Double-click to install (no unzip)

This ZIP fallback includes:
  Chrome extension, native print host, Node.js runtime, PDFtoPrinter.exe

Install (ZIP) - most reliable
-----------------------------
1. Download from GitHub Releases (browser, not WeChat)
2. Copy ZIP to C:\PrintKit-Setup\
3. Extract fully
4. Double-click Install-PrintKit.bat
5. chrome://extensions -> Developer mode ON -> Load unpacked
6. Select: %LOCALAPPDATA%\PrintKit\extension
7. Extension ID must be: memmopnlapcegennpipheiadaonehljd

If install fails
----------------
1. Open log: %TEMP%\PrintKit-install.log
2. Close Chrome/Edge
3. Delete folder: %LOCALAPPDATA%\PrintKit
4. Re-download from GitHub and retry from C:\PrintKit-Setup

Downloads
---------
EXE: https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.exe
ZIP: https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.zip

Uninstall
---------
Run Uninstall-PrintKit.ps1 in PowerShell
