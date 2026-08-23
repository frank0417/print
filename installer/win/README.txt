PrintKit Windows Setup (all-in-one)
===================================

Included: Chrome extension, native print host, Node.js runtime, PDFtoPrinter.exe

Install
-------
1. Download PrintKit-Setup-windows.zip from GitHub Releases (do NOT re-zip via WeChat)
2. Extract to a short path, e.g. C:\PrintKit-Setup-windows
3. Double-click Install-PrintKit.bat
4. chrome://extensions -> Developer mode ON -> Load unpacked
5. Select: %LOCALAPPDATA%\PrintKit\extension
6. Extension ID must be: memmopnlapcegennpipheiadaonehljd

Download
--------
https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.zip

Uninstall
---------
Run Uninstall-PrintKit.ps1 in PowerShell

If Install-PrintKit.bat shows garbled text or parser errors:
- Re-download the ZIP from GitHub (WeChat may corrupt .ps1 encoding)
- Extract again and run Install-PrintKit.bat
