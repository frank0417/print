; PrintKit one-click Windows installer (NSIS)
; Built by installer/build.sh
Unicode true
CRCCheck on
SetCompressor /SOLID lzma
RequestExecutionLevel user
ShowInstDetails show

!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define PRODUCT_NAME "PrintKit"
!define PRODUCT_VERSION "0.5.7"
!define SETUP_STAGE "@@SETUP_STAGE@@"
!define OUT_FILE "@@OUT_FILE@@"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\PrintKit"
BrandingText "PrintKit One-Click Setup"
Caption "PrintKit Setup"

Page instfiles

Var PrintKitExit
Var PrintKitLogTail

Section "Install"
  SetDetailsPrint both
  DetailPrint "Extracting PrintKit..."

  InitPluginsDir
  SetOutPath "$PLUGINSDIR\setup"
  File "${SETUP_STAGE}/Install-PrintKit.ps1"
  File "${SETUP_STAGE}/Install-PrintKit.bat"
  File "${SETUP_STAGE}/Install-PrintKit-Cmd.bat"
  File "${SETUP_STAGE}/Open-Extensions.bat"
  File "${SETUP_STAGE}/Diagnose-PrintKit.bat"
  File /r "${SETUP_STAGE}/app"

  ; Stage to a stable short path (avoids WeChat / temp path quirks)
  CreateDirectory "$LOCALAPPDATA\PrintKit-Setup-Staging"
  DetailPrint "Staging files..."
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C robocopy "$PLUGINSDIR\setup" "$LOCALAPPDATA\PrintKit-Setup-Staging" /E /NFL /NDL /NJH /NJS /nc /ns /np /R:1 /W:1'
  Pop $0
  DetailPrint "Stage robocopy exit: $0"
  ; robocopy 0-7 = ok

  DetailPrint "Running silent install (CMD, Win7-safe)..."
  ; Prefer pure CMD installer - works on Windows 7 / PowerShell 2.0
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C ""$LOCALAPPDATA\PrintKit-Setup-Staging\Install-PrintKit-Cmd.bat" /S & exit /b %ERRORLEVEL%"'
  Pop $PrintKitExit
  DetailPrint "Installer exit code: $PrintKitExit"

  ; If core files landed, treat as success even if helper step failed
  IfFileExists "$LOCALAPPDATA\PrintKit\host\host.js" 0 check_fail
  IfFileExists "$LOCALAPPDATA\PrintKit\runtime\node\node.exe" 0 check_fail
  DetailPrint "Core files present. Install OK."
  Goto install_ok

check_fail:
  ${If} $PrintKitExit != 0
    StrCpy $PrintKitLogTail "See %TEMP%\PrintKit-install.log"
    MessageBox MB_ICONSTOP|MB_OK "PrintKit install failed (exit $PrintKitExit).$\r$\n$\r$\n1) Download ZIP from GitHub (not WeChat)$\r$\n2) Copy to C:\PrintKit-Setup$\r$\n3) Run Install-PrintKit.bat$\r$\n$\r$\nLog: %TEMP%\PrintKit-install.log"
    SetErrorLevel 1
    Abort
  ${EndIf}

install_ok:
  MessageBox MB_ICONINFORMATION|MB_OK "PrintKit installed.$\r$\n$\r$\n1) chrome://extensions$\r$\n2) Enable Developer mode$\r$\n3) Load unpacked -> %LOCALAPPDATA%\PrintKit\extension$\r$\n$\r$\nExpected ID: memmopnlapcegennpipheiadaonehljd"
SectionEnd
