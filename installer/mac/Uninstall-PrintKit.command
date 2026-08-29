#!/bin/bash
# Uninstall PrintKit (macOS user-level)
set -euo pipefail

HOST_NAME="com.printkit.host"
INSTALL_ROOT="${HOME}/Library/Application Support/PrintKit"

rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
rm -f "$HOME/Library/Application Support/Chromium/NativeMessagingHosts/$HOST_NAME.json"
rm -f "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$HOST_NAME.json"

if [[ -d "$INSTALL_ROOT" ]]; then
  rm -rf "$INSTALL_ROOT"
  echo "已删除: $INSTALL_ROOT"
fi

rm -f "$HOME/Desktop/PrintKit-Extension" 2>/dev/null || true

echo "已卸载 Native Messaging 注册。请在 chrome://extensions 中手动移除 PrintKit 扩展。"
read -r -p "按回车键退出..." _
