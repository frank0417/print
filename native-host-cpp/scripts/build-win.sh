#!/usr/bin/env bash
# Cross-build the Windows C++ engine and one-click NSIS installer on Linux.
# No Node.js payload — the installer ships printkit-host.exe (QtWebKit) only.
#
# Toolchain (Ubuntu):
#   curl -fsSL https://pkg.mxe.cc/repos/apt/client-conf/mxeapt.gpg | sudo gpg --dearmor -o /usr/share/keyrings/mxeapt.gpg
#   echo "deb [signed-by=/usr/share/keyrings/mxeapt.gpg] https://pkg.mxe.cc/repos/apt focal main" | sudo tee /etc/apt/sources.list.d/mxeapt.list
#   sudo apt-get update && sudo apt-get install mxe-x86-64-w64-mingw32.shared-qtwebkit nsis
#
# Output:
#   dist/PrintKit-Native-Setup-windows.exe   one-click installer
#   dist/PrintKit-Native-windows-x64.zip     portable zip (same payload)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOSTDIR="$ROOT/native-host-cpp"
DIST="$ROOT/dist"
STAGE="$DIST/.stage-win-native"
MXE_BIN=/usr/lib/mxe/usr/bin
QMAKE="$MXE_BIN/x86_64-w64-mingw32.shared-qmake-qt5"
VERSION="1.0.0"

command -v makensis >/dev/null || { echo "makensis missing: sudo apt-get install nsis" >&2; exit 1; }
[ -x "$QMAKE" ] || { echo "MXE qt5 toolchain missing (see header)" >&2; exit 1; }

export PATH="$MXE_BIN:$PATH"

echo "== cross-compile printkit-host.exe"
BUILD="$HOSTDIR/build-win"
mkdir -p "$BUILD"
( cd "$BUILD" && "$QMAKE" "$HOSTDIR/printkit-host.pro" && make -j"$(nproc)" )

echo "== collect DLLs + Qt plugins"
rm -rf "$STAGE"
mkdir -p "$STAGE/engine" "$STAGE/extension" "$DIST"
"$HOSTDIR/scripts/collect-win-dlls.sh" "$BUILD/release/printkit-host.exe" "$STAGE/engine" 2>/dev/null

echo "== bundle extension"
cp -a "$ROOT/extension/." "$STAGE/extension/"

echo "== NSIS installer"
EXE="$DIST/PrintKit-Native-Setup-windows.exe"
NSI="$STAGE/setup.nsi"
sed -e "s|@@SETUP_STAGE@@|$STAGE|g" \
    -e "s|@@OUT_FILE@@|$EXE|g" \
    -e "s|@@VERSION@@|$VERSION|g" \
    "$ROOT/installer/win-cpp/PrintKit-Native-Setup.nsi" > "$NSI"
makensis -V2 "$NSI"

echo "== portable zip"
ZIP="$DIST/PrintKit-Native-windows-x64.zip"
rm -f "$ZIP"
( cd "$STAGE" && zip -qr "$ZIP" engine extension )

ls -lh "$EXE" "$ZIP"
