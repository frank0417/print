#!/bin/bash
# Entrypoint for makeself one-click macOS package.
set -euo pipefail
export PRINTKIT_NO_PAUSE=1
DIR="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$DIR/Install-PrintKit.command" "$DIR/Open-Extensions.command" "$DIR/Uninstall-PrintKit.command" 2>/dev/null || true
exec "$DIR/Install-PrintKit.command"
