#!/usr/bin/env bash
# Register the C++ host for Chrome on macOS.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${1:-$HERE/build/printkit-host}"

if [ ! -x "$BIN" ]; then
  echo "host binary not found: $BIN" >&2
  exit 1
fi

DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$DIR"
sed "s|__HOST_PATH__|$BIN|" "$HERE/com.printkit.host.json.template" \
  > "$DIR/com.printkit.host.json"
echo "registered: $DIR/com.printkit.host.json"

"$BIN" --cli ping
