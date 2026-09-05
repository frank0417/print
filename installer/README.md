# PrintKit 一键安装包

将 **Chrome 扩展 + 本地打印代理 + Node 运行时 +（Windows）PDFtoPrinter** 打成可双击安装的文件。

## 构建

```bash
./installer/build.sh          # Windows + macOS
./installer/build.sh windows  # 仅 Windows
./installer/build.sh macos    # 仅 macOS
```

产物在 `dist/`：

| 文件 | 说明 |
| --- | --- |
| `PrintKit-Setup-windows.exe` | **Windows 一键安装**（推荐） |
| `PrintKit-Setup-macos.command` | **macOS 一键安装**（推荐） |
| `PrintKit-Setup-windows.zip` | Windows 备用 ZIP |
| `PrintKit-Setup-macos.zip` | macOS 备用 ZIP |
| `SHA256SUMS.txt` | 校验和 |

## 用户使用（一键）

### Windows
1. 下载 `PrintKit-Setup-windows.exe`（勿经微信转发，以免损坏）
2. **双击安装**
3. 按提示在 `chrome://extensions` 加载已打开的扩展目录

### macOS
1. 下载 `PrintKit-Setup-macos.command`
2. **双击运行**（首次若被拦截：右键 → 打开）
3. 按提示在 `chrome://extensions` 加载扩展目录

扩展 ID 须为：`memmopnlapcegennpipheiadaonehljd`

## 发布下载地址

- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.exe
- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-macos.command
- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.zip
- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-macos.zip
