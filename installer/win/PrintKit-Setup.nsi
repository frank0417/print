; PrintKit one-click Windows installer (NSIS)
; Built by installer/build.sh
Unicode true
CRCCheck on
SetCompressor /SOLID lzma
RequestExecutionLevel user
ShowInstDetails show

!include "LogicLib.nsh"

!define PRODUCT_NAME "PrintKit"
!define PRODUCT_VERSION "0.4.0"
!define SETUP_STAGE "@@SETUP_STAGE@@"
!define OUT_FILE "@@OUT_FILE@@"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\PrintKit"
BrandingText "PrintKit One-Click Setup"
Caption "PrintKit Setup"

Page instfiles

Section "Install"
  SetDetailsPrint both
  DetailPrint "Extracting PrintKit..."

  InitPluginsDir
  SetOutPath "$PLUGINSDIR\setup"
  File "${SETUP_STAGE}/Install-PrintKit.ps1"
  File "${SETUP_STAGE}/Open-Extensions.bat"
  File /r "${SETUP_STAGE}/app"

  DetailPrint "Running silent install..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NoLogo -ExecutionPolicy Bypass -File "$PLUGINSDIR\setup\Install-PrintKit.ps1" -NoPause -FromOneClick'
  Pop $0
  DetailPrint "Installer exit code: $0"

  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "PrintKit install failed (exit $0).$\r$\nRetry, or use the ZIP and run Install-PrintKit.bat."
    SetErrorLevel 1
    Abort
  ${EndIf}

  MessageBox MB_ICONINFORMATION|MB_OK "PrintKit installed.$\r$\n$\r$\n1) chrome://extensions$\r$\n2) Enable Developer mode$\r$\n3) Load unpacked → select the opened extension folder$\r$\n$\r$\nExpected ID: memmopnlapcegennpipheiadaonehljd"
SectionEnd
