# PrintKit Native Host（Windows / macOS 本地打印代理）

通过 Chrome **Native Messaging** 连接扩展，实现：

- 枚举系统打印机（`getPrinters`）
- HTML → PDF（调用本机 Chrome/Edge 无头）
- 静默打印到指定打印机（`print`，对应页面 `jatoolsPrinter.print(myDoc, false)`）

## 下载

| 资源 | 地址 |
| --- | --- |
| 项目仓库 | https://github.com/frank0417/print |
| 源码 ZIP | https://github.com/frank0417/print/archive/refs/heads/main.zip |
| Node.js ≥ 18 | https://nodejs.org/zh-cn/download |
| PDFtoPrinter（Windows） | https://www.columbia.edu/~em36/pdftoprinter.html |
| SumatraPDF（Windows） | https://www.sumatrapdfreader.org/download-free-pdf-viewer |

## 要求

| 项目 | 说明 |
| --- | --- |
| Node.js | ≥ 18（运行 host） |
| 浏览器 | 已安装 Google Chrome 或 Microsoft Edge（用于 HTML→PDF） |
| macOS | 使用系统 CUPS（`lpstat` / `lp`） |
| Windows | 建议将 `PDFtoPrinter.exe` 放到 `bin/`（见下） |

## 安装

### macOS

```bash
cd native-host
chmod +x scripts/install-mac.sh
./scripts/install-mac.sh
```

### Windows（PowerShell）

```powershell
cd native-host
powershell -ExecutionPolicy Bypass -File .\scripts\install-win.ps1
```

然后在 Chrome 加载仓库中的 `extension/`（开发者模式）。  
扩展 manifest 含固定 `key`，ID 应为：

```text
memmopnlapcegennpipheiadaonehljd
```

若 ID 不一致，Native Messaging 会拒绝连接。

## 自检

```bash
node host.js --cli ping
node host.js --cli getPrinters
```

日志文件：系统临时目录下的 `printkit-host.log`。

## Windows 静默打印助手（推荐）

将以下任一文件放入 `native-host/bin/`：

1. **PDFtoPrinter.exe**（推荐）  
   https://www.columbia.edu/~em36/pdftoprinter.html
2. **SumatraPDF.exe**  
   https://www.sumatrapdfreader.org/

未放置时，会回退到系统 PDF 关联的 Print/PrintTo（可能闪窗，取决于默认 PDF 软件）。

## 协议（扩展 ↔ Host）

请求 JSON：

```json
{ "action": "print", "payload": { "pages": [...], "settings": { "printer": "HP-xxx", "copies": 1 } } }
```

| action | 说明 |
| --- | --- |
| `ping` | 探活 |
| `getHostInfo` | 版本 / 平台 |
| `getPrinters` | 打印机列表 |
| `getDefaultPrinter` | 默认打印机 |
| `print` | 静默打印（HTML pages → PDF → 打印机） |

## 卸载

- macOS: `./scripts/uninstall-mac.sh`
- Windows: `powershell -File .\scripts\uninstall-win.ps1`
