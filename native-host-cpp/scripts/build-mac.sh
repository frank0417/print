#!/usr/bin/env bash
# Build printkit-host natively on macOS (Apple Silicon arm64 or Intel x86_64).
#
# QtWebKit comes from MacPorts, which ships prebuilt arm64/x86_64 binary
# archives — no 1-2h WebKit source build needed:
#   sudo port -N install qt5-qtwebkit
#
# Usage:
#   ./scripts/build-mac.sh              # build + run core tests
#   ./scripts/build-mac.sh --package    # also bundle a self-contained PrintKit-Host.app
#   QT_PREFIX=/path/to/qt5 ./scripts/build-mac.sh   # use a non-MacPorts Qt
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
QT_PREFIX="${QT_PREFIX:-/opt/local/libexec/qt5}"
QMAKE="$QT_PREFIX/bin/qmake"

if [ ! -x "$QMAKE" ]; then
  echo "qmake not found at $QMAKE" >&2
  echo "install QtWebKit first:  sudo port -N install qt5-qtwebkit" >&2
  echo "(or set QT_PREFIX to a Qt 5 tree that has the webkit module)" >&2
  exit 1
fi

ARCH="$(uname -m)"
echo "== building printkit-host ($ARCH) with $QMAKE"

BUILD="$HERE/build-mac"
mkdir -p "$BUILD"
cd "$BUILD"
"$QMAKE" "$HERE/printkit-host.pro"
make -j"$(sysctl -n hw.ncpu)"

BIN="$BUILD/printkit-host"
file "$BIN"

echo "== core tests (Qt-free)"
clang++ -std=c++17 -I"$HERE/src" "$HERE/tests/test_core.cpp" \
  "$HERE/src/protocol.cpp" "$HERE/src/paper.cpp" \
  "$HERE/src/sentinel.cpp" "$HERE/src/htmldoc.cpp" \
  -o "$BUILD/core-tests"
"$BUILD/core-tests"

echo "== self test"
# CI runners have no interactive WindowServer; local runs use cocoa normally.
QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-}" "$BIN" --cli ping

if [ "${1:-}" = "--package" ]; then
  echo "== packaging self-contained PrintKit-Host.app"
  APP="$BUILD/PrintKit-Host.app"
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS"
  cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>printkit-host</string>
  <key>CFBundleIdentifier</key><string>com.printkit.host</string>
  <key>CFBundleName</key><string>PrintKit Host</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
  cp "$BIN" "$APP/Contents/MacOS/printkit-host"
  MACDEPLOYQT="$QT_PREFIX/bin/macdeployqt"
  if [ ! -x "$MACDEPLOYQT" ]; then
    MACDEPLOYQT="$(command -v macdeployqt || true)"
  fi
  if [ -z "$MACDEPLOYQT" ]; then
    echo "macdeployqt not found — install it with:  sudo port -N install qt5-qttools" >&2
    exit 1
  fi
  "$MACDEPLOYQT" "$APP" -verbose=1
  # Native messaging manifest points INTO the bundle:
  #   .../PrintKit-Host.app/Contents/MacOS/printkit-host
  ( cd "$BUILD" && zip -qry "PrintKit-Host-macos-$ARCH.zip" "PrintKit-Host.app" )
  echo "package: $BUILD/PrintKit-Host-macos-$ARCH.zip"
fi

echo
echo "register with Chrome:"
echo "  $HERE/scripts/install-mac.sh $BIN"
