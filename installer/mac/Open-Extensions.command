#!/bin/bash
INSTALL_ROOT="${HOME}/Library/Application Support/PrintKit"
EXT_DIR="$INSTALL_ROOT/extension"
echo "扩展目录: $EXT_DIR"
if [[ -f "$INSTALL_ROOT/EXTENSION_PATH.txt" ]]; then
  cat "$INSTALL_ROOT/EXTENSION_PATH.txt"
fi
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || \
  open -a "Microsoft Edge" "chrome://extensions" 2>/dev/null || \
  open "chrome://extensions"
echo "请开启开发者模式，加载已解压扩展并选择上述目录。"
read -r -p "按回车键退出..." _
