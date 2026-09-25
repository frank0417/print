#!/usr/bin/env bash
# Recursively collect the MinGW/Qt DLLs an MXE-built exe needs, plus the Qt
# platform/print plugins. Usage: collect-win-dlls.sh <exe> <outdir> [mxe-root]
set -euo pipefail

EXE="$1"
OUT="$2"
MXE="${3:-/usr/lib/mxe/usr/x86_64-w64-mingw32.shared}"
OBJDUMP="${OBJDUMP:-/usr/lib/mxe/usr/bin/x86_64-w64-mingw32.shared-objdump}"

SEARCH_DIRS=("$MXE/bin" "$MXE/qt5/bin" "$MXE/lib")
mkdir -p "$OUT"

deps_of() {
  "$OBJDUMP" -p "$1" 2>/dev/null | awk '/DLL Name:/ {print $3}'
}

resolve() {
  local name="$1"
  for d in "${SEARCH_DIRS[@]}"; do
    if [ -f "$d/$name" ]; then
      echo "$d/$name"
      return 0
    fi
  done
  return 1
}

declare -A seen
queue=("$EXE")
while [ ${#queue[@]} -gt 0 ]; do
  cur="${queue[0]}"
  queue=("${queue[@]:1}")
  for dep in $(deps_of "$cur"); do
    [ -n "${seen[$dep]:-}" ] && continue
    seen[$dep]=1
    if path="$(resolve "$dep")"; then
      cp -n "$path" "$OUT/"
      queue+=("$path")
    fi
    # unresolved names are Windows system DLLs (kernel32 etc.) — expected
  done
done

# Qt runtime plugins (loaded dynamically, objdump cannot see them).
copy_plugins() {
  local sub="$1"; shift
  mkdir -p "$OUT/$sub"
  for f in "$@"; do
    if [ -f "$MXE/qt5/plugins/$sub/$f" ]; then
      cp -n "$MXE/qt5/plugins/$sub/$f" "$OUT/$sub/"
      for dep in $(deps_of "$OUT/$sub/$f"); do
        if [ -z "${seen[$dep]:-}" ]; then
          seen[$dep]=1
          if path="$(resolve "$dep")"; then cp -n "$path" "$OUT/"; fi
        fi
      done
    fi
  done
}

copy_plugins platforms qwindows.dll qminimal.dll qoffscreen.dll
copy_plugins printsupport windowsprintersupport.dll
copy_plugins imageformats qjpeg.dll qgif.dll qico.dll qsvg.dll
copy_plugins styles qwindowsvistastyle.dll

cp -n "$EXE" "$OUT/"
echo "collected $(ls "$OUT" | wc -l) entries into $OUT"
