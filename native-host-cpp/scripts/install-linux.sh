#!/usr/bin/env bash
# Register the C++ host for Chrome/Chromium on Linux.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${1:-$HERE/build/printkit-host}"

if [ ! -x "$BIN" ]; then
  echo "host binary not found: $BIN" >&2
  echo "build first:  cmake -S . -B build -DCMAKE_CXX_COMPILER=g++ && cmake --build build -j" >&2
  exit 1
fi

for dir in \
  "$HOME/.config/google-chrome/NativeMessagingHosts" \
  "$HOME/.config/chromium/NativeMessagingHosts"; do
  mkdir -p "$dir"
  sed "s|__HOST_PATH__|$BIN|" "$HERE/com.printkit.host.json.template" \
    > "$dir/com.printkit.host.json"
  echo "registered: $dir/com.printkit.host.json"
done

"$BIN" --cli ping
