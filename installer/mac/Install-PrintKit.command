#!/bin/bash
# PrintKit 一体化安装（macOS）— 双击运行
set -euo pipefail

SETUP_ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_SOURCE="$SETUP_ROOT/app"
INSTALL_ROOT="${HOME}/Library/Application Support/PrintKit"
HOST_NAME="com.printkit.host"
EXT_ID="memmopnlapcegennpipheiadaonehljd"

echo "========================================"
echo " PrintKit 一体化安装 (macOS)"
echo "========================================"
echo "安装目录: $INSTALL_ROOT"
echo

if [[ ! -f "$APP_SOURCE/host/host.js" ]]; then
  echo "错误: 找不到 app/host/host.js，请使用完整的 PrintKit-Setup-macos 安装包。"
  read -r -p "按回车键退出..." _
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) NODE_DIR="$APP_SOURCE/runtime/node-arm64" ;;
  x86_64) NODE_DIR="$APP_SOURCE/runtime/node-x64" ;;
  *)
    echo "不支持的架构: $ARCH"
    exit 1
    ;;
esac

if [[ ! -x "$NODE_DIR/bin/node" ]]; then
  echo "错误: 安装包缺少内置 Node ($ARCH)"
  exit 1
fi

echo "正在复制文件..."
rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT"
cp -a "$APP_SOURCE/." "$INSTALL_ROOT/"

# Keep only the Node build for this machine to save space
if [[ "$ARCH" == "arm64" ]]; then
  rm -rf "$INSTALL_ROOT/runtime/node-x64"
  mv "$INSTALL_ROOT/runtime/node-arm64" "$INSTALL_ROOT/runtime/node"
else
  rm -rf "$INSTALL_ROOT/runtime/node-arm64"
  mv "$INSTALL_ROOT/runtime/node-x64" "$INSTALL_ROOT/runtime/node"
fi

NODE_BIN="$INSTALL_ROOT/runtime/node/bin/node"
HOST_JS="$INSTALL_ROOT/host/host.js"
WRAPPER="$INSTALL_ROOT/printkit-host"
EXT_DIR="$INSTALL_ROOT/extension"

chmod +x "$NODE_BIN" "$HOST_JS" || true
# node binary may need execute on all bundled bins
chmod -R a+X "$INSTALL_ROOT/runtime/node" || true

cat > "$WRAPPER" <<EOF
#!/bin/bash
exec "$NODE_BIN" "$HOST_JS" "\$@"
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

install_manifest() {
  local dir="$1"
  mkdir -p "$dir"
  echo "$MANIFEST_CONTENT" > "$dir/$HOST_NAME.json"
  echo "已写入: $dir/$HOST_NAME.json"
}

install_manifest "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
install_manifest "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
install_manifest "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"

echo "$EXT_DIR" > "$INSTALL_ROOT/EXTENSION_PATH.txt"

echo
echo "正在自检本地代理..."
"$NODE_BIN" "$HOST_JS" --cli ping || true

echo
echo "安装完成。"
echo "1) 打开 Chrome → chrome://extensions"
echo "2) 开启「开发者模式」→「加载已解压的扩展程序」"
echo "3) 选择目录: $EXT_DIR"
echo "4) 确认扩展 ID 为: $EXT_ID"
echo
echo "也可双击 Open-Extensions.command"
echo

# Try open Chrome extensions
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || \
  open -a "Microsoft Edge" "chrome://extensions" 2>/dev/null || true

read -r -p "按回车键退出..." _
