#!/usr/bin/env bash
# Uninstall macOS native host registrations (user level)
set -euo pipefail
HOST_NAME="com.printkit.host"
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
rm -f "$HOME/Library/Application Support/Chromium/NativeMessagingHosts/$HOST_NAME.json"
rm -f "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$HOST_NAME.json"
echo "已移除用户级 Native Messaging 注册。"
