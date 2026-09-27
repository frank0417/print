; PrintKit Native Setup — C++ engine only (QtWebKit + QPrinter), no Node.
; Compiled by native-host-cpp/scripts/build-win.sh (Linux makensis works).
;   @@SETUP_STAGE@@  staging dir containing engine\ and extension\
;   @@OUT_FILE@@     output installer path
;   @@VERSION@@      product version

Unicode true
!include "MUI2.nsh"
!include "WordFunc.nsh"

Name "PrintKit（C++ 原生引擎）"
OutFile "@@OUT_FILE@@"
InstallDir "$LOCALAPPDATA\PrintKit"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define VERSION "@@VERSION@@"
!define HOST_NAME "com.printkit.host"
!define EXT_ID "memmopnlapcegennpipheiadaonehljd"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintKitNative"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "PrintKit"
  SetOutPath "$INSTDIR\engine"
  File /r "@@SETUP_STAGE@@\engine\*"

  SetOutPath "$INSTDIR\extension"
  File /r "@@SETUP_STAGE@@\extension\*"

  ; Native messaging manifest — JSON needs escaped backslashes in the path.
  ${WordReplace} "$INSTDIR\engine\printkit-host.exe" "\" "\\" "+" $R0
  FileOpen $0 "$INSTDIR\${HOST_NAME}.json" w
  FileWrite $0 '{"name":"${HOST_NAME}",'
  FileWrite $0 '"description":"PrintKit C++ native print host (QtWebKit + QPrinter)",'
  FileWrite $0 '"path":"$R0",'
  FileWrite $0 '"type":"stdio",'
  FileWrite $0 '"allowed_origins":["chrome-extension://${EXT_ID}/"]}'
  FileClose $0

  ; Register for Chrome, Edge and Chromium (per-user, no admin needed).
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\${HOST_NAME}" "" "$INSTDIR\${HOST_NAME}.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\${HOST_NAME}" "" "$INSTDIR\${HOST_NAME}.json"
  WriteRegStr HKCU "Software\Chromium\NativeMessagingHosts\${HOST_NAME}" "" "$INSTDIR\${HOST_NAME}.json"

  WriteUninstaller "$INSTDIR\Uninstall-PrintKit-Native.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "PrintKit（C++ 原生引擎）"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "PrintKit"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\Uninstall-PrintKit-Native.exe$\""
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  IfSilent +3
    ExecShell "open" "$INSTDIR\extension"
    MessageBox MB_OK "安装完成。$\r$\n$\r$\n最后一步：打开 chrome://extensions（开发者模式）→「加载已解压的扩展程序」，选择刚打开的目录：$\r$\n$INSTDIR\extension$\r$\n$\r$\n扩展 ID 应为：${EXT_ID}"
SectionEnd

Section "Uninstall"
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\${HOST_NAME}"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\${HOST_NAME}"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\${HOST_NAME}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd
