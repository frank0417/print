#!/bin/bash
# PrintKit one-click install (macOS) — double-click Install-PrintKit.command
# Or run from self-extracting PrintKit-Setup-macos.command
set -euo pipefail

SETUP_ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_SOURCE="$SETUP_ROOT/app"
INSTALL_ROOT="${HOME}/Library/Application Support/PrintKit"
HOST_NAME="com.printkit.host"
EXT_ID="memmopnlapcegennpipheiadaonehljd"
NO_PAUSE="${PRINTKIT_NO_PAUSE:-0}"

echo "========================================"
echo " PrintKit One-Click Setup (macOS)"
echo "========================================"
echo "Install folder: $INSTALL_ROOT"
echo

if [[ ! -f "$APP_SOURCE/host/host.js" ]]; then
  echo "ERROR: missing app/host/host.js"
  echo "Use PrintKit-Setup-macos.command or the full ZIP package."
  if [[ "$NO_PAUSE" != "1" ]]; then
    read -r -p "Press Enter to exit..." _
  fi
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) NODE_DIR="$APP_SOURCE/runtime/node-arm64" ;;
  x86_64) NODE_DIR="$APP_SOURCE/runtime/node-x64" ;;
  *)
    echo "Unsupported arch: $ARCH"
    exit 1
    ;;
esac

if [[ ! -x "$NODE_DIR/bin/node" ]]; then
  echo "ERROR: bundled Node missing for $ARCH"
  exit 1
fi

echo "Copying files..."
rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT"
cp -a "$APP_SOURCE/." "$INSTALL_ROOT/"

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
FINISH_HTML="$INSTALL_ROOT/finish.html"

chmod +x "$NODE_BIN" "$HOST_JS" || true
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
  echo "Registered: $dir/$HOST_NAME.json"
}

install_manifest "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
install_manifest "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
install_manifest "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"

echo "$EXT_DIR" > "$INSTALL_ROOT/EXTENSION_PATH.txt"

# Copy path to clipboard when possible
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$EXT_DIR" | pbcopy
  echo "Extension path copied to clipboard."
fi

# Desktop alias to extension folder
if [[ -d "$HOME/Desktop" ]]; then
  ln -sfn "$EXT_DIR" "$HOME/Desktop/PrintKit-Extension" 2>/dev/null || true
fi

echo
echo "Self-check..."
"$NODE_BIN" "$HOST_JS" --cli ping || true

echo
echo "Install finished."
echo "Next: chrome://extensions → Developer mode → Load unpacked"
echo "Folder: $EXT_DIR"
echo "Expected ID: $EXT_ID"
echo

open "$EXT_DIR" 2>/dev/null || true
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || \
  open -a "Microsoft Edge" "chrome://extensions" 2>/dev/null || true

if [[ -f "$FINISH_HTML" ]]; then
  # file URL with query for path
  ENC_PATH="$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$EXT_DIR" 2>/dev/null || echo "")"
  if [[ -n "$ENC_PATH" ]]; then
    open "file://${FINISH_HTML}?path=${ENC_PATH}" 2>/dev/null || open "$FINISH_HTML" 2>/dev/null || true
  else
    open "$FINISH_HTML" 2>/dev/null || true
  fi
fi

if [[ "$NO_PAUSE" != "1" ]]; then
  read -r -p "Press Enter to exit..." _
fi
