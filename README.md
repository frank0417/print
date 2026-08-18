# PrintKit · Chrome 打印扩展（对齐 jatoolsPrinter）

用 Chrome 扩展实现网页精确打印，API 对齐经典 **jatoolsPrinter / JCP**。  
v0.2 起支持 **Windows / macOS 本地打印代理（Native Messaging）**，可静默打印到指定打印机。

## 功能

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| `jatoolsPrinter.printPreview(myDoc)` | ✅ | 打开预览窗 |
| `jatoolsPrinter.print(myDoc, true)` | ✅ | 预览 + 系统打印对话框 |
| `jatoolsPrinter.print(myDoc, false)` | ✅ | **本地代理静默打印**；未安装则弹出安装说明 |
| DIV ID 映射分页 `page1`… | ✅ | 支持 `page_div_prefix` |
| 纸张 / 方向 / 边距 / 份数 | ✅ | `settings` + 预览工具栏 |
| `settings.printer` | ✅ | 指定打印机名称（需 native-host） |
| `getPrinters()` | ✅ | 经本地代理枚举；未安装会提示安装 |
| `getHostStatus()` / `openInstallGuide()` | ✅ | 探测代理 / 打开安装说明 |

## 目录

```
extension/       Chrome 扩展（Manifest V3）
native-host/     Windows / macOS Native Messaging 打印代理
demo/            演示页
```

## 快速开始

### 1. 安装扩展

1. Chrome → `chrome://extensions` → 开启开发者模式  
2. 「加载已解压的扩展程序」→ 选择 `extension/`  
3. 确认扩展 ID 为 `memmopnlapcegennpipheiadaonehljd`（manifest 已内置 `key`）

### 2. 安装本地打印代理

**下载地址**

| 资源 | 地址 |
| --- | --- |
| 项目源码 | https://github.com/frank0417/print |
| 项目 ZIP | https://github.com/frank0417/print/archive/refs/heads/main.zip |
| Node.js ≥ 18 | https://nodejs.org/ （[中文页](https://nodejs.org/zh-cn/download)） |
| Chrome | https://www.google.com/chrome/ |
| Edge | https://www.microsoft.com/edge |
| PDFtoPrinter（Win 推荐） | https://www.columbia.edu/~em36/pdftoprinter.html |
| SumatraPDF（Win 备选） | https://www.sumatrapdfreader.org/download-free-pdf-viewer |

**macOS**

```bash
cd native-host
./scripts/install-mac.sh
```

**Windows**

```powershell
cd native-host
powershell -ExecutionPolicy Bypass -File .\scripts\install-win.ps1
```

需要本机已安装 **Node.js ≥ 18**，以及 **Chrome 或 Edge**（用于 HTML→PDF）。

Windows 静默打印建议再把 `PDFtoPrinter.exe` 放到 `native-host/bin/`（详见 `native-host/README.md`）。

未安装代理时，扩展会弹出安装说明窗口（含上述下载链接）。

自检：

```bash
node native-host/host.js --cli ping
node native-host/host.js --cli getPrinters
```

扩展弹窗也会显示「本地代理」连接状态。

### 3. 打开 Demo

```bash
cd demo && python3 -m http.server 5173
```

访问 `http://127.0.0.1:5173/` 。

## 业务页接入

```html
<div id="page1">第一页</div>
<div id="page2">第二页</div>

<script>
  async function silentPrint() {
    const printers = await jatoolsPrinter.getPrinters();
    const myDoc = {
      documents: document,
      copyrights: 'your-company',
      settings: {
        paperName: 'A4',
        orientation: 1,
        marginTop: 10,
        marginRight: 10,
        marginBottom: 10,
        marginLeft: 10,
        copies: 1,
        printer: printers[0]?.name // 可选；省略则用系统默认打印机
      },
      done(err, result) {
        console.log(err || result);
      }
    };

    // false = 静默（走本地代理）
    await jatoolsPrinter.print(myDoc, false);
  }
</script>
```

其它入口：`printKit` / `PrintKit` / `getJCP()`。

## 静默打印链路

```
页面 print(myDoc, false)
  → 扩展 background
    → Native Messaging: com.printkit.host
      → Chrome/Edge headless: HTML → PDF
        → macOS: lp / Windows: PDFtoPrinter 或 PrintTo
```

未安装代理时，`print(myDoc, false)` / `getPrinters()` 会**弹出安装说明窗口**（不再静默回退）。安装说明页提供 macOS / Windows 脚本，并可「重新检测」或「改用预览打印」。

## 与官方 JCP 的差异

- 代理基于 Node + 系统打印，而非 JCP 闭源客户端  
- Windows 完美静默推荐配合 `PDFtoPrinter.exe`  
- 复杂跨域 CSS 可能需内联样式以保证 PDF 一致  

## License

MIT
