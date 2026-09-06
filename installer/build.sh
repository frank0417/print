#!/usr/bin/env bash
# Build PrintKit one-click setup packages for Windows and macOS.
# Output:
#   dist/PrintKit-Setup-windows.exe   (recommended one-click)
#   dist/PrintKit-Setup-windows.zip   (fallback)
#   dist/PrintKit-Setup-macos.command (recommended one-click)
#   dist/PrintKit-Setup-macos.zip     (fallback)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLER="$ROOT/installer"
DIST="$ROOT/dist"
CACHE="${PRINTKIT_CACHE:-/tmp/printkit-build-cache}"
NODE_VERSION="${PRINTKIT_NODE_VERSION:-22.14.0}"
# Windows 7 / Server 2008 R2 need Node 12; Node 14+ will not start there.
WIN_NODE_VERSION="${PRINTKIT_WIN_NODE_VERSION:-12.22.12}"
STAGE="$DIST/.stage"
ARTIFACTS="${PRINTKIT_ARTIFACTS:-/opt/cursor/artifacts}"
VERSION="0.5.29"

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

  rm -rf "$app/extension"
  mkdir -p "$app/extension"
  cp -a "$ROOT/extension/." "$app/extension/"

  rm -rf "$app/host"
  mkdir -p "$app/host"
  cp -a "$ROOT/native-host/." "$app/host/"
  rm -f "$app/host/printkit-host" "$app/host/printkit-host.cmd" \
        "$app/host/com.printkit.host.json" "$app/host/dev-key.pem"

  cp "$INSTALLER/common/finish.html" "$app/finish.html"

  cat > "$app/VERSION.txt" <<EOF
PrintKit Setup
version=$VERSION
node=$NODE_VERSION
win_node=${WIN_NODE_VERSION:-$NODE_VERSION}
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
repo=https://github.com/frank0417/print
one-click=yes
EOF
}

build_windows_payload() {
  local stage="$1"
  rm -rf "$stage"
  mkdir -p "$stage"
  prepare_common_app "$stage/app"

  local node_zip="$CACHE/node-v${WIN_NODE_VERSION}-win-x64.zip"
  download "https://nodejs.org/dist/v${WIN_NODE_VERSION}/node-v${WIN_NODE_VERSION}-win-x64.zip" "$node_zip"
  rm -rf "$CACHE/node-win-extract"
  mkdir -p "$CACHE/node-win-extract"
  unzip -q "$node_zip" -d "$CACHE/node-win-extract"
  mkdir -p "$stage/app/runtime/node"
  cp -a "$CACHE/node-win-extract/node-v${WIN_NODE_VERSION}-win-x64/." "$stage/app/runtime/node/"

  # Record which Node Windows builds actually ship
  if [[ -f "$stage/app/VERSION.txt" ]]; then
    sed -i "s/^node=.*/node=${WIN_NODE_VERSION} (win7-compatible)/" "$stage/app/VERSION.txt" || true
  fi

  mkdir -p "$stage/app/host/bin" "$stage/app/bin"
  download "https://mendelson.org/PDFtoPrinter.exe" "$CACHE/PDFtoPrinter.exe"
  cp "$CACHE/PDFtoPrinter.exe" "$stage/app/bin/PDFtoPrinter.exe"
  cp "$CACHE/PDFtoPrinter.exe" "$stage/app/host/bin/PDFtoPrinter.exe"

  # pdfium.dll: GDI direct print for pin printers (host/lib/win-gdi-print.js)
  # and the runtime PDFtoPrinter.exe needs. x64 only (Win7 x64+).
  local pdfium_tgz="$CACHE/pdfium-win-x64.tgz"
  download "https://github.com/bblanchon/pdfium-binaries/releases/latest/download/pdfium-win-x64.tgz" "$pdfium_tgz"
  rm -rf "$CACHE/pdfium-x64"
  mkdir -p "$CACHE/pdfium-x64"
  tar -xzf "$pdfium_tgz" -C "$CACHE/pdfium-x64"
  if [[ -f "$CACHE/pdfium-x64/bin/pdfium.dll" ]]; then
    cp "$CACHE/pdfium-x64/bin/pdfium.dll" "$stage/app/bin/pdfium.dll"
    cp "$CACHE/pdfium-x64/bin/pdfium.dll" "$stage/app/host/bin/pdfium.dll"
  else
    log "WARN: pdfium.dll not found in tgz"
  fi

  # SumatraPDF: silent bitmap print path for laser/inkjet (fallback for pins).
  local sumatra_zip="$CACHE/SumatraPDF-3.5.2-64.zip"
  download "https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.zip" "$sumatra_zip"
  rm -rf "$CACHE/sumatra-extract"
  mkdir -p "$CACHE/sumatra-extract"
  unzip -q -o "$sumatra_zip" -d "$CACHE/sumatra-extract"
  local sumatra_exe
  sumatra_exe="$(find "$CACHE/sumatra-extract" -iname 'SumatraPDF*.exe' | head -n 1)"
  if [[ -n "$sumatra_exe" ]]; then
    cp "$sumatra_exe" "$stage/app/host/bin/SumatraPDF.exe"
    cp "$sumatra_exe" "$stage/app/bin/SumatraPDF.exe"
  else
    log "WARN: SumatraPDF.exe not found in zip"
  fi

  cp "$INSTALLER/win/Install-PrintKit.bat" "$stage/"
  cp "$INSTALLER/win/Install-PrintKit-Cmd.bat" "$stage/"
  cp "$INSTALLER/win/Install-PrintKit.ps1" "$stage/"
  cp "$INSTALLER/win/Uninstall-PrintKit.ps1" "$stage/"
  cp "$INSTALLER/win/Uninstall-PrintKit.bat" "$stage/"
  cp "$INSTALLER/win/Update-PrintKit.bat" "$stage/"
  cp "$INSTALLER/win/Open-Extensions.bat" "$stage/"
  cp "$INSTALLER/win/Diagnose-PrintKit.bat" "$stage/"
  cp "$INSTALLER/win/README.txt" "$stage/"
  cp "$INSTALLER/win/Update-PrintKit.bat" "$stage/app/"
  cp "$INSTALLER/win/Uninstall-PrintKit.bat" "$stage/app/"
  cp "$INSTALLER/win/Uninstall-PrintKit.ps1" "$stage/app/"
}

build_windows() {
  log "=== Windows package (ZIP + one-click EXE) ==="
  local name="PrintKit-Setup-windows"
  local stage="$STAGE/$name"
  build_windows_payload "$stage"

  local zip="$DIST/${name}.zip"
  rm -f "$zip"
  (cd "$STAGE" && zip -qr "$zip" "$name")
  log "wrote $zip ($(du -h "$zip" | awk '{print $1}'))"
  cp -f "$zip" "$ARTIFACTS/"

  if command -v makensis >/dev/null 2>&1; then
    local exe="$DIST/${name}.exe"
    local nsi="$STAGE/PrintKit-Setup.nsi"
    # NSIS on Linux wants forward slashes in paths
    local stage_nsis="${stage}"
    local exe_nsis="${exe}"
    sed \
      -e "s|@@SETUP_STAGE@@|${stage_nsis}|g" \
      -e "s|@@OUT_FILE@@|${exe_nsis}|g" \
      "$INSTALLER/win/PrintKit-Setup.nsi" > "$nsi"
    # Convert paths to Windows-style for File commands? Linux makensis accepts Unix paths.
    log "compiling NSIS one-click EXE..."
    makensis -V2 "$nsi"
    log "wrote $exe ($(du -h "$exe" | awk '{print $1}'))"
    cp -f "$exe" "$ARTIFACTS/"
  else
    log "WARN: makensis not found; skipped .exe (ZIP only)"
  fi
}

build_macos_payload() {
  local stage="$1"
  rm -rf "$stage"
  mkdir -p "$stage"
  prepare_common_app "$stage/app"

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
  cp "$INSTALLER/mac/Update-PrintKit.command" "$stage/"
  cp "$INSTALLER/mac/Open-Extensions.command" "$stage/"
  cp "$INSTALLER/mac/oneclick-entry.sh" "$stage/"
  cp "$INSTALLER/mac/README.txt" "$stage/"
  cp "$INSTALLER/mac/Update-PrintKit.command" "$stage/app/"
  cp "$INSTALLER/mac/Uninstall-PrintKit.command" "$stage/app/"
  chmod +x "$stage/"*.command "$stage/oneclick-entry.sh" "$stage/app/"*.command
}

build_macos() {
  log "=== macOS package (ZIP + one-click .command) ==="
  local name="PrintKit-Setup-macos"
  local stage="$STAGE/$name"
  build_macos_payload "$stage"

  local zip="$DIST/${name}.zip"
  rm -f "$zip"
  (cd "$STAGE" && zip -qr "$zip" "$name")
  log "wrote $zip ($(du -h "$zip" | awk '{print $1}'))"
  cp -f "$zip" "$ARTIFACTS/"

  if command -v makeself >/dev/null 2>&1; then
    local oneclick="$DIST/${name}.command"
    rm -f "$oneclick"
    # Self-extracting archive: double-click on macOS opens Terminal and installs
    makeself --nox11 --sha256 \
      "$stage" "$oneclick" "PrintKit One-Click Setup" \
      ./oneclick-entry.sh
    chmod +x "$oneclick"
    log "wrote $oneclick ($(du -h "$oneclick" | awk '{print $1}'))"
    cp -f "$oneclick" "$ARTIFACTS/"
  else
    log "WARN: makeself not found; skipped .command one-click (ZIP only)"
  fi
}

write_manifest() {
  local files=()
  [[ -f "$DIST/PrintKit-Setup-windows.exe" ]] && files+=("PrintKit-Setup-windows.exe")
  [[ -f "$DIST/PrintKit-Setup-windows.zip" ]] && files+=("PrintKit-Setup-windows.zip")
  [[ -f "$DIST/PrintKit-Setup-macos.command" ]] && files+=("PrintKit-Setup-macos.command")
  [[ -f "$DIST/PrintKit-Setup-macos.zip" ]] && files+=("PrintKit-Setup-macos.zip")

  {
    echo "# PrintKit Setup packages (v${VERSION})"
    if ((${#files[@]})); then
      (cd "$DIST" && sha256sum "${files[@]}")
    fi
  } > "$DIST/SHA256SUMS.txt"
  cp -f "$DIST/SHA256SUMS.txt" "$ARTIFACTS/" 2>/dev/null || true

  cat > "$DIST/DOWNLOADS.md" <<EOF
# PrintKit 一键安装包 (v${VERSION})

## 推荐（一键）

| 系统 | 文件 | 用法 |
| --- | --- | --- |
| Windows | \`PrintKit-Setup-windows.exe\` | **双击即可安装** |
| macOS | \`PrintKit-Setup-macos.command\` | **双击即可安装**（首次可能需右键→打开） |

## 备用（ZIP）

| 系统 | 文件 | 用法 |
| --- | --- | --- |
| Windows | \`PrintKit-Setup-windows.zip\` | 解压后双击 \`Install-PrintKit.bat\` |
| macOS | \`PrintKit-Setup-macos.zip\` | 解压后运行 \`Install-PrintKit.command\` |

发布后下载地址：

- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.exe
- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-macos.command
- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.zip
- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-macos.zip

安装后在 \`chrome://extensions\` 加载扩展目录（安装程序会自动打开并复制路径）：

- Windows: \`%LOCALAPPDATA%\\PrintKit\\extension\`
- macOS: \`~/Library/Application Support/PrintKit/extension\`

扩展 ID 须为：\`memmopnlapcegennpipheiadaonehljd\`

## 升级

已安装用户无需重新「加载已解压扩展」（目录不变）。任选其一：

- 扩展图标 → **检查更新 / 立即升级**（从 GitHub 拉取）
- Windows：开始菜单 **PrintKit → Update PrintKit**，或
  \`%LOCALAPPDATA%\\PrintKit\\Update-PrintKit.bat\`
- macOS：\`~/Library/Application Support/PrintKit/Update-PrintKit.command\`
- 远程/内网包：
  \`Update-PrintKit.bat /S --zip \\\\server\\share\\PrintKit-Setup-windows.zip\`
- 重跑最新安装包（覆盖安装）：\`PrintKit-Setup-windows.exe /S\`

## 卸载

- Windows：设置 → 应用 → PrintKit，或开始菜单 **Uninstall PrintKit**
- macOS：\`~/Library/Application Support/PrintKit/Uninstall-PrintKit.command\`
- 然后在 \`chrome://extensions\` 移除扩展

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
ls -lh "$DIST"/PrintKit-Setup-* "$DIST"/SHA256SUMS.txt 2>/dev/null || true
