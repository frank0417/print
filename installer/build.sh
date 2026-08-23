#!/usr/bin/env bash
# Build all-in-one PrintKit setup packages for Windows and macOS.
# Output: dist/PrintKit-Setup-windows.zip , dist/PrintKit-Setup-macos.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLER="$ROOT/installer"
DIST="$ROOT/dist"
CACHE="${PRINTKIT_CACHE:-/tmp/printkit-build-cache}"
NODE_VERSION="${PRINTKIT_NODE_VERSION:-22.14.0}"
STAGE="$DIST/.stage"
ARTIFACTS="${PRINTKIT_ARTIFACTS:-/opt/cursor/artifacts}"

mkdir -p "$DIST" "$CACHE" "$STAGE" "$ARTIFACTS"

log() { printf '[build] %s\n' "$*"; }

download() {
  local url="$1" out="$2"
  if [[ -f "$out" && "${PRINTKIT_FORCE_DOWNLOAD:-}" != "1" ]]; then
    log "cache hit: $out"
    return 0
  fi
  log "download: $url"
  curl -fsSL --retry 3 --retry-delay 2 -o "$out.partial" "$url"
  mv "$out.partial" "$out"
}

prepare_common_app() {
  local app="$1"
  rm -rf "$app"
  mkdir -p "$app/extension" "$app/host" "$app/bin" "$app/runtime"

  # Extension (Chrome load unpacked from install dir)
  rm -rf "$app/extension"
  mkdir -p "$app/extension"
  cp -a "$ROOT/extension/." "$app/extension/"

  # Native host sources (no node_modules needed)
  rm -rf "$app/host"
  mkdir -p "$app/host"
  cp -a "$ROOT/native-host/." "$app/host/"
  rm -f "$app/host/printkit-host" "$app/host/printkit-host.cmd" \
        "$app/host/com.printkit.host.json" "$app/host/dev-key.pem"

  # Version stamp
  cat > "$app/VERSION.txt" <<EOF
PrintKit Setup
version=0.3.1
node=$NODE_VERSION
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
repo=https://github.com/frank0417/print
EOF
}

build_windows() {
  log "=== Windows package ==="
  local name="PrintKit-Setup-windows"
  local stage="$STAGE/$name"
  rm -rf "$stage"
  mkdir -p "$stage"
  prepare_common_app "$stage/app"

  # Portable Node (win-x64)
  local node_zip="$CACHE/node-v${NODE_VERSION}-win-x64.zip"
  download "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip" "$node_zip"
  rm -rf "$CACHE/node-win-extract"
  mkdir -p "$CACHE/node-win-extract"
  unzip -q "$node_zip" -d "$CACHE/node-win-extract"
  mkdir -p "$stage/app/runtime/node"
  cp -a "$CACHE/node-win-extract/node-v${NODE_VERSION}-win-x64/." "$stage/app/runtime/node/"

  # PDFtoPrinter
  download "https://mendelson.org/PDFtoPrinter.exe" "$CACHE/PDFtoPrinter.exe"
  cp "$CACHE/PDFtoPrinter.exe" "$stage/app/bin/PDFtoPrinter.exe"
  cp "$CACHE/PDFtoPrinter.exe" "$stage/app/host/bin/PDFtoPrinter.exe"

  # Installer scripts
  cp "$INSTALLER/win/Install-PrintKit.bat" "$stage/"
  cp "$INSTALLER/win/Install-PrintKit.ps1" "$stage/"
  cp "$INSTALLER/win/Uninstall-PrintKit.ps1" "$stage/"
  cp "$INSTALLER/win/Open-Extensions.bat" "$stage/"
  cp "$INSTALLER/win/README.txt" "$stage/"

  # Zip
  local zip="$DIST/${name}.zip"
  rm -f "$zip"
  (cd "$STAGE" && zip -qr "$zip" "$name")
  log "wrote $zip ($(du -h "$zip" | awk '{print $1}'))"
  cp -f "$zip" "$ARTIFACTS/"
}

build_macos() {
  log "=== macOS package ==="
  local name="PrintKit-Setup-macos"
  local stage="$STAGE/$name"
  rm -rf "$stage"
  mkdir -p "$stage"
  prepare_common_app "$stage/app"

  # Portable Node for both architectures; installer picks one
  for arch in x64 arm64; do
    local tarball="$CACHE/node-v${NODE_VERSION}-darwin-${arch}.tar.gz"
    download "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${arch}.tar.gz" "$tarball"
    rm -rf "$CACHE/node-mac-${arch}"
    mkdir -p "$CACHE/node-mac-${arch}"
    tar -xzf "$tarball" -C "$CACHE/node-mac-${arch}"
    mkdir -p "$stage/app/runtime/node-${arch}"
    cp -a "$CACHE/node-mac-${arch}/node-v${NODE_VERSION}-darwin-${arch}/." "$stage/app/runtime/node-${arch}/"
  done

  cp "$INSTALLER/mac/Install-PrintKit.command" "$stage/"
  cp "$INSTALLER/mac/Uninstall-PrintKit.command" "$stage/"
  cp "$INSTALLER/mac/Open-Extensions.command" "$stage/"
  cp "$INSTALLER/mac/README.txt" "$stage/"
  chmod +x "$stage/"*.command

  local zip="$DIST/${name}.zip"
  rm -f "$zip"
  (cd "$STAGE" && zip -qr "$zip" "$name")
  log "wrote $zip ($(du -h "$zip" | awk '{print $1}'))"
  cp -f "$zip" "$ARTIFACTS/"
}

write_manifest() {
  cat > "$DIST/SHA256SUMS.txt" <<EOF
# PrintKit Setup packages
$(cd "$DIST" && sha256sum PrintKit-Setup-windows.zip PrintKit-Setup-macos.zip 2>/dev/null || shasum -a 256 PrintKit-Setup-windows.zip PrintKit-Setup-macos.zip)
EOF
  cp -f "$DIST/SHA256SUMS.txt" "$ARTIFACTS/" 2>/dev/null || true
  cat > "$DIST/DOWNLOADS.md" <<EOF
# PrintKit 一体化安装包

构建产物：

- \`PrintKit-Setup-windows.zip\` — Windows（内含 Node 运行时 + PDFtoPrinter + 扩展 + 代理）
- \`PrintKit-Setup-macos.zip\` — macOS（内含 Node x64/arm64 + 扩展 + 代理）

发布后下载地址（GitHub Releases）：

- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.zip
- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-macos.zip

本地构建：

\`\`\`bash
./installer/build.sh
\`\`\`
EOF
  cp -f "$DIST/DOWNLOADS.md" "$ARTIFACTS/" 2>/dev/null || true
}

TARGET="${1:-all}"
case "$TARGET" in
  win|windows) build_windows ;;
  mac|macos) build_macos ;;
  all)
    build_windows
    build_macos
    ;;
  *)
    echo "Usage: $0 [all|windows|macos]"
    exit 1
    ;;
esac

write_manifest
log "done."
ls -lh "$DIST"/*.zip "$DIST"/SHA256SUMS.txt 2>/dev/null || true
