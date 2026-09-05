@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "REPORT=%USERPROFILE%\Desktop\PrintKit-diagnose.txt"
if not exist "%USERPROFILE%\Desktop\" set "REPORT=%TEMP%\PrintKit-diagnose.txt"

set "NODE=%LOCALAPPDATA%\PrintKit\runtime\node\node.exe"
set "HOST=%LOCALAPPDATA%\PrintKit\host\host.js"
set "INSTALL=%LOCALAPPDATA%\PrintKit"

> "%REPORT%" echo PrintKit diagnose
>>"%REPORT%" echo Time: %DATE% %TIME%
>>"%REPORT%" echo.

>>"%REPORT%" echo ==== OS ====
ver >>"%REPORT%" 2>&1
>>"%REPORT%" echo.

>>"%REPORT%" echo ==== PowerShell ====
powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()" >>"%REPORT%" 2>&1
>>"%REPORT%" echo.

>>"%REPORT%" echo ==== Paths ====
>>"%REPORT%" echo INSTALL=%INSTALL%
>>"%REPORT%" echo NODE=%NODE%
>>"%REPORT%" echo HOST=%HOST%
if exist "%NODE%" (>>"%REPORT%" echo node.exe: YES) else (>>"%REPORT%" echo node.exe: NO  *** NOT INSTALLED ***)
if exist "%HOST%" (>>"%REPORT%" echo host.js: YES) else (>>"%REPORT%" echo host.js: NO  *** NOT INSTALLED ***)
>>"%REPORT%" echo.

if not exist "%NODE%" (
  >>"%REPORT%" echo ==== RESULT ====
  >>"%REPORT%" echo PrintKit is NOT installed on this PC.
  >>"%REPORT%" echo Please extract PrintKit-Setup-windows.zip and run Install-PrintKit.bat
  >>"%REPORT%" echo ^(or Install-PrintKit-Cmd.bat^) from C:\PrintKit-Setup\
  >>"%REPORT%" echo Do NOT install from WeChat download folder.
  echo.
  echo ========================================
  echo  PrintKit is NOT installed
  echo ========================================
  echo node.exe / host.js were not found under:
  echo   %LOCALAPPDATA%\PrintKit
  echo.
  echo Please:
  echo 1. Download v0.5.11 ZIP from GitHub Releases
  echo 2. Copy to C:\PrintKit-Setup and extract
  echo 3. Double-click Install-PrintKit.bat
  echo.
  echo Report: %REPORT%
  notepad "%REPORT%"
  pause
  exit /b 1
)

>>"%REPORT%" echo ==== Node -v ====
"%NODE%" -v >>"%REPORT%" 2>&1
>>"%REPORT%" echo.

>>"%REPORT%" echo ==== Host ping ====
"%NODE%" "%HOST%" --cli ping >>"%REPORT%" 2>&1
>>"%REPORT%" echo.

>>"%REPORT%" echo ==== Printers ====
"%NODE%" "%HOST%" --cli getPrinters >>"%REPORT%" 2>&1
>>"%REPORT%" echo.

>>"%REPORT%" echo ==== Install log ====
if exist "%TEMP%\PrintKit-install.log" (
  type "%TEMP%\PrintKit-install.log" >>"%REPORT%"
) else (
  >>"%REPORT%" echo no install log
)

echo.
echo Report saved to:
echo   %REPORT%
notepad "%REPORT%"
pause
endlocal
