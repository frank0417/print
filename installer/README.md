# PrintKit 一体化安装包

将 **Chrome 扩展 + 本地打印代理 + Node 运行时 +（Windows）PDFtoPrinter** 打成一个 ZIP，用户解压后双击安装即可，无需再分别下载 Node / 代理。

## 构建

```bash
./installer/build.sh          # 同时打 Windows + macOS
./installer/build.sh windows  # 仅 Windows
./installer/build.sh macos    # 仅 macOS
```

产物在 `dist/`：

- `PrintKit-Setup-windows.zip`
- `PrintKit-Setup-macos.zip`
- `SHA256SUMS.txt`

## 用户使用

### Windows
1. 解压 `PrintKit-Setup-windows.zip`
2. 双击 `Install-PrintKit.bat`
3. 在 `chrome://extensions` 加载 `%LOCALAPPDATA%\PrintKit\extension`

### macOS
1. 解压 `PrintKit-Setup-macos.zip`
2. 运行 `Install-PrintKit.command`
3. 在 `chrome://extensions` 加载 `~/Library/Application Support/PrintKit/extension`

## 发布下载地址

上传到 GitHub Releases 后：

- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.zip
- https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-macos.zip
