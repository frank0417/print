#!/bin/bash
# PrintKit updater. Safe to run remotely / via SSH.
#   ./Update-PrintKit.command
#   PRINTKIT_NO_PAUSE=1 ./Update-PrintKit.command --zip /path/PrintKit-Setup-macos.zip
#   PRINTKIT_NO_PAUSE=1 ./Update-PrintKit.command --url https://example.com/PrintKit-Setup-macos.zip
set -euo pipefail

INSTALL_ROOT="${HOME}/Library/Application Support/PrintKit"
NODE="${INSTALL_ROOT}/runtime/node/bin/node"
HOST="${INSTALL_ROOT}/host/host.js"
NO_PAUSE="${PRINTKIT_NO_PAUSE:-0}"

echo "========================================"
echo " PrintKit Update (macOS)"
echo "========================================"
echo "Install folder: $INSTALL_ROOT"
echo "Log: ${TMPDIR:-/tmp}/printkit-update.log"
echo

if [[ ! -x "$NODE" ]]; then
  echo "ERROR: bundled Node not found. Reinstall PrintKit first."
  exit 1
fi
if [[ ! -f "$HOST" ]]; then
  echo "ERROR: host.js not found. Reinstall PrintKit first."
  exit 1
fi

"$NODE" "$HOST" --cli applyUpdate "$@"
echo
echo "Update finished. In Chrome: chrome://extensions → PrintKit → reload."

if [[ "$NO_PAUSE" != "1" ]]; then
  read -r -p "Press Enter to exit..." _
fi
