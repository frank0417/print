@echo off
REM PrintKit uninstaller (Windows user-level, Win7-safe)
REM   Uninstall-PrintKit.bat
REM   Uninstall-PrintKit.bat /S
setlocal EnableExtensions
set "INSTALL=%LOCALAPPDATA%\PrintKit"
set "HOST_NAME=com.printkit.host"
set "SILENT=0"
set "FROMTEMP=0"

:parse
if "%~1"=="" goto parsed
if /I "%~1"=="/S" set SILENT=1 & shift & goto parse
if /I "%~1"=="/silent" set SILENT=1 & shift & goto parse
if /I "%~1"=="/fromtemp" set FROMTEMP=1 & shift & goto parse
shift
goto parse
:parsed

if "%FROMTEMP%"=="0" (
  copy /Y "%~f0" "%TEMP%\PrintKit-Uninstall.bat" >nul
  if "%SILENT%"=="1" (
    call "%TEMP%\PrintKit-Uninstall.bat" /fromtemp /S
  ) else (
    call "%TEMP%\PrintKit-Uninstall.bat" /fromtemp
  )
  exit /b %ERRORLEVEL%
)

if "%SILENT%"=="0" (
  echo Uninstall PrintKit from:
  echo   %INSTALL%
  echo.
  choice /C YN /M "Uninstall PrintKit"
  if errorlevel 2 exit /b 0
)

echo Removing Native Messaging registration...
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>nul
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>nul
reg delete "HKCU\Software\Chromium\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintKit" /f >nul 2>nul

set "SM=%APPDATA%\Microsoft\Windows\Start Menu\Programs\PrintKit"
if exist "%SM%" rmdir /s /q "%SM%" 2>nul

if exist "%USERPROFILE%\Desktop\PrintKit Extension Folder.lnk" del /f /q "%USERPROFILE%\Desktop\PrintKit Extension Folder.lnk" 2>nul

echo Removing files...
ping 127.0.0.1 -n 2 >nul
if exist "%INSTALL%" rmdir /s /q "%INSTALL%" 2>nul

echo.
echo PrintKit uninstalled.
echo Remove the extension manually in chrome://extensions
if "%SILENT%"=="0" pause
endlocal
exit /b 0
