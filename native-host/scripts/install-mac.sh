#!/usr/bin/env bash
# Install PrintKit Native Messaging host for macOS (Chrome / Chromium / Edge)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_JS="$ROOT/host.js"
WRAPPER="$ROOT/printkit-host"
EXT_ID="memmopnlapcegennpipheiadaonehljd"
HOST_NAME="com.printkit.host"

if ! command -v node >/dev/null 2>&1; then
  echo "错误: 需要先安装 Node.js (>=18)。https://nodejs.org/"
  exit 1
fi

chmod +x "$HOST_JS"

# Stable launcher that uses absolute node + host path
cat > "$WRAPPER" <<EOF
#!/bin/bash
exec "$(command -v node)" "$HOST_JS" "\$@"
EOF
chmod +x "$WRAPPER"

MANIFEST_CONTENT=$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "PrintKit Native Messaging Host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF
)

install_for() {
  local dir="$1"
  mkdir -p "$dir"
  local target="$dir/$HOST_NAME.json"
  echo "$MANIFEST_CONTENT" > "$target"
  echo "已写入: $target"
}

# User-level Chrome / Chromium / Edge
install_for "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
install_for "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
install_for "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"

# Optional system-wide (needs sudo) — skip by default
if [[ "${PRINTKIT_SYSTEM_INSTALL:-}" == "1" ]]; then
  sudo mkdir -p "/Library/Google/Chrome/NativeMessagingHosts"
  echo "$MANIFEST_CONTENT" | sudo tee "/Library/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json" >/dev/null
  echo "已写入系统级 Chrome NativeMessagingHosts"
fi

echo
echo "安装完成。"
echo "1) Chrome 加载解压扩展: $ROOT/../extension"
echo "   扩展 ID 应为: $EXT_ID （manifest 已内置 key）"
echo "2) 自检: node \"$HOST_JS\" --cli ping"
echo "3) 打印机: node \"$HOST_JS\" --cli getPrinters"
echo
echo "日志: \$TMPDIR/printkit-host.log 或 /tmp/printkit-host.log"
