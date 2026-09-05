@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set REPORT=%USERPROFILE%\Desktop\PrintKit-diagnose.txt
if not exist "%USERPROFILE%\Desktop" set REPORT=%TEMP%\PrintKit-diagnose.txt

echo PrintKit diagnose > "%REPORT%"
echo Time: %DATE% %TIME% >> "%REPORT%"
echo. >> "%REPORT%"

echo ==== OS ==== >> "%REPORT%"
ver >> "%REPORT%" 2>&1
echo. >> "%REPORT%"

echo ==== PowerShell ==== >> "%REPORT%"
powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()" >> "%REPORT%" 2>&1
echo. >> "%REPORT%"

set NODE=%LOCALAPPDATA%\PrintKit\runtime\node\node.exe
set HOST=%LOCALAPPDATA%\PrintKit\host\host.js

echo ==== Paths ==== >> "%REPORT%"
echo NODE=%NODE% >> "%REPORT%"
echo HOST=%HOST% >> "%REPORT%"
if exist "%NODE%" (echo node.exe: YES >> "%REPORT%") else (echo node.exe: NO >> "%REPORT%")
if exist "%HOST%" (echo host.js: YES >> "%REPORT%") else (echo host.js: NO >> "%REPORT%")
echo. >> "%REPORT%"

echo ==== Node -v ==== >> "%REPORT%"
if exist "%NODE%" (
  "%NODE%" -v >> "%REPORT%" 2>&1
) else (
  echo missing node.exe >> "%REPORT%"
)
echo. >> "%REPORT%"

echo ==== Host ping ==== >> "%REPORT%"
if exist "%NODE%" if exist "%HOST%" (
  "%NODE%" "%HOST%" --cli ping >> "%REPORT%" 2>&1
) else (
  echo skip ping >> "%REPORT%"
)
echo. >> "%REPORT%"

echo ==== Printers ==== >> "%REPORT%"
if exist "%NODE%" if exist "%HOST%" (
  "%NODE%" "%HOST%" --cli getPrinters >> "%REPORT%" 2>&1
) else (
  echo skip printers >> "%REPORT%"
)
echo. >> "%REPORT%"

echo ==== Install log ==== >> "%REPORT%"
if exist "%TEMP%\PrintKit-install.log" (
  type "%TEMP%\PrintKit-install.log" >> "%REPORT%"
) else (
  echo no install log >> "%REPORT%"
)

echo.
echo Report saved to:
echo   %REPORT%
echo.
echo Please send this file to support.
notepad "%REPORT%"
pause
