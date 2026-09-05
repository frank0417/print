@echo off
REM PrintKit Windows installer - pure CMD, works on Windows 7 / PowerShell 2.0
REM Run from extracted PrintKit-Setup-windows folder.
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set SILENT=0
if /I "%~1"=="/S" set SILENT=1
if /I "%~1"=="/silent" set SILENT=1

set "LOG=%TEMP%\PrintKit-install.log"
set "INSTALL=%LOCALAPPDATA%\PrintKit"
set "APP=%~dp0app"
set "HOST_NAME=com.printkit.host"
set "EXT_ID=memmopnlapcegennpipheiadaonehljd"

echo ========================================
echo  PrintKit Setup (Windows 7 compatible)
echo ========================================
echo Install folder: %INSTALL%
echo Log: %LOG%
echo.

> "%LOG%" echo PrintKit CMD install log
>>"%LOG%" echo Time: %DATE% %TIME%
>>"%LOG%" echo Setup: %CD%
>>"%LOG%" echo Install: %INSTALL%

if not exist "%APP%\host\host.js" (
  echo ERROR: missing app\host\host.js
  echo Extract the FULL ZIP first, then run this bat from PrintKit-Setup-windows folder.
  >>"%LOG%" echo ERROR: missing app\host\host.js
  if "%SILENT%"=="0" pause
  exit /b 1
)
if not exist "%APP%\runtime\node\node.exe" (
  echo ERROR: missing app\runtime\node\node.exe
  echo This package is incomplete. Re-download from GitHub Releases.
  >>"%LOG%" echo ERROR: missing node.exe in package
  if "%SILENT%"=="0" pause
  exit /b 1
)

echo [1/5] Copying files...
if exist "%INSTALL%" (
  >>"%LOG%" echo Removing old install...
  rmdir /s /q "%INSTALL%" 2>nul
)
mkdir "%INSTALL%" 2>nul

robocopy "%APP%" "%INSTALL%" /E /NFL /NDL /NJH /NJS /nc /ns /np /R:2 /W:2 >nul
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo robocopy exit=%RC%
if %RC% GEQ 8 (
  echo ERROR: copy failed ^(robocopy %RC%^). Close Chrome and retry.
  >>"%LOG%" echo ERROR: robocopy failed
  if "%SILENT%"=="0" pause
  exit /b 1
)

if not exist "%INSTALL%\runtime\node\node.exe" (
  echo ERROR: node.exe missing after copy
  >>"%LOG%" echo ERROR: node missing after copy
  if "%SILENT%"=="0" pause
  exit /b 1
)
if not exist "%INSTALL%\host\host.js" (
  echo ERROR: host.js missing after copy
  >>"%LOG%" echo ERROR: host missing after copy
  if "%SILENT%"=="0" pause
  exit /b 1
)

echo [2/5] Creating launcher...
set "NODE=%INSTALL%\runtime\node\node.exe"
set "HOSTJS=%INSTALL%\host\host.js"
set "LAUNCHER=%INSTALL%\printkit-host.cmd"
set "MANIFEST=%INSTALL%\%HOST_NAME%.json"
set "EXTDIR=%INSTALL%\extension"

> "%LAUNCHER%" echo @echo off
>>"%LAUNCHER%" echo "%NODE%" "%HOSTJS%" %%*

if exist "%INSTALL%\bin\PDFtoPrinter.exe" (
  if not exist "%INSTALL%\host\bin" mkdir "%INSTALL%\host\bin"
  copy /Y "%INSTALL%\bin\PDFtoPrinter.exe" "%INSTALL%\host\bin\PDFtoPrinter.exe" >nul
)

echo [3/5] Writing native host manifest...
set "MANIFEST=%INSTALL%\%HOST_NAME%.json"
set "LAUNCHER=%INSTALL%\printkit-host.cmd"
REM Use bundled Node to write JSON (avoids PowerShell 2.0 issues)
set "PK_MANIFEST=%MANIFEST%"
set "PK_LAUNCHER=%LAUNCHER%"
set "PK_HOST_NAME=%HOST_NAME%"
set "PK_EXT_ID=%EXT_ID%"
"%NODE%" -e "var fs=require('fs');var o={name:process.env.PK_HOST_NAME,description:'PrintKit Native Messaging Host',path:process.env.PK_LAUNCHER,type:'stdio',allowed_origins:['chrome-extension://'+process.env.PK_EXT_ID+'/']};fs.writeFileSync(process.env.PK_MANIFEST,JSON.stringify(o,null,2));console.log('manifest ok');"
if errorlevel 1 (
  echo ERROR: failed to write manifest with node
  >>"%LOG%" echo ERROR: manifest write failed
  if "%SILENT%"=="0" pause
  exit /b 1
)

echo [4/5] Registering with Chrome / Edge...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
reg add "HKCU\Software\Chromium\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
>>"%LOG%" echo Registered native host

echo %EXTDIR%> "%INSTALL%\EXTENSION_PATH.txt"
copy /Y "%~dp0Diagnose-PrintKit.bat" "%INSTALL%\Diagnose-PrintKit.bat" >nul 2>nul
copy /Y "%~dp0Open-Extensions.bat" "%INSTALL%\Open-Extensions.bat" >nul 2>nul

echo [5/5] Self-check...
"%NODE%" -v
if errorlevel 1 (
  echo ERROR: bundled Node cannot start on this PC.
  >>"%LOG%" echo ERROR: node -v failed
  if "%SILENT%"=="0" pause
  exit /b 1
)

"%NODE%" "%HOSTJS%" --cli ping
if errorlevel 1 (
  echo ERROR: host ping failed
  >>"%LOG%" echo ERROR: host ping failed
  if "%SILENT%"=="0" pause
  exit /b 1
)

echo.
echo Printers:
"%NODE%" "%HOSTJS%" --cli getPrinters
>>"%LOG%" echo Install finished OK

echo.
echo ========================================
echo  Install finished
echo ========================================
echo Extension folder:
echo   %EXTDIR%
echo Expected extension ID:
echo   %EXT_ID%
echo.
echo NEXT STEPS:
echo 1) Open chrome://extensions
echo 2) Enable Developer mode
echo 3) Load unpacked - select the folder above
echo 4) Click PrintKit icon - should show Connected
echo.

explorer "%EXTDIR%"
start "" chrome.exe chrome://extensions 2>nul
if errorlevel 1 start "" msedge.exe chrome://extensions 2>nul

if "%SILENT%"=="0" (
  echo Press any key to exit...
  pause >nul
)
endlocal
exit /b 0
