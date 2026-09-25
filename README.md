# PrintKit · DIV ID 映射打印

当前最新版：**v0.6.0**（可远程/一键升级）

独创 **DIV ID 映射打印**：页面长什么样，纸上就是什么样。

- **HTML 就是模板** — 无需转换私有格式，现有布局直接复用。
- **扔掉专用设计器** — 用你最熟悉的 HTML/CSS 就够了，不必双份维护。
- **打印即预览** — 锁定指定 DOM 节点（`page1` / `page2`… 或任意 `pageIds`）直接输出到纸张。
- **C++ 原生引擎** — `native-host-cpp/`：QtWebKit 渲染内核 + QPrinter 直接出纸，
  不依赖 Node.js / Python 中间层；92 KB 可执行文件，空闲 CPU 0%，内置 IP-Sentinel 毫秒级鉴权。
- **套打现场调** — 上下左右按毫米偏移，**每台打印机单独记忆**，客户自助归位，开发不用改代码。

API 对齐经典 **jatoolsPrinter / JCP**。Windows 一键安装包内置 Node 运行时 + 打印代理 + 扩展（另含 PDFtoPrinter），兼容 **Windows 7**。

## 安装最新版（Windows）

用 **浏览器** 下载（不要用微信）：

| 文件 | 地址 |
| --- | --- |
| **推荐 ZIP** | https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.zip |
| EXE 一键安装 | https://github.com/frank0417/print/releases/latest/download/PrintKit-Setup-windows.exe |
| 全部版本 | https://github.com/frank0417/print/releases/latest |

1. 把 ZIP 复制到 `C:\PrintKit-Setup`，解压（不要在微信下载目录里直接运行）
2. 双击 `Install-PrintKit.bat`，等到出现 `Install finished`
3. 打开 `chrome://extensions` → 开启开发者模式 →「加载已解压的扩展程序」
4. 选择：`%LOCALAPPDATA%\PrintKit\extension`
5. 点扩展图标，确认「本地代理」为绿点 / 已连接

扩展 ID 必须是：`memmopnlapcegennpipheiadaonehljd`

安装失败时运行同目录的 `Diagnose-PrintKit.bat`，把报告发回来。

## 升级

扩展加载的是固定目录，**升级不用重新「加载已解压扩展」**（目录不变；弹窗里点「立即升级」会自动重载）。

| 方式 | 怎么做 |
| --- | --- |
| **扩展里一键升级** | 点 PrintKit 图标 →「检查更新」→「立即升级」（从 GitHub Releases 拉取） |
| 本机脚本 | Windows 开始菜单 **PrintKit → Update PrintKit**，或运行 `%LOCALAPPDATA%\PrintKit\Update-PrintKit.bat` |
| **远程 / 内网包** | 把新包放到共享盘后，在目标电脑执行：<br>`%LOCALAPPDATA%\PrintKit\Update-PrintKit.bat /S --zip \\服务器\共享\PrintKit-Setup-windows.zip` |
| 重跑安装包 | 下载最新 `PrintKit-Setup-windows.exe`，双击或 `PrintKit-Setup-windows.exe /S`（静默覆盖） |

macOS：`~/Library/Application Support/PrintKit/Update-PrintKit.command`  
也可用 `--url https://内网/PrintKit-Setup-windows.zip`，或环境变量 `PRINTKIT_UPDATE_ZIP` / `PRINTKIT_UPDATE_URL`。

升级后若扩展未自动重载：打开 `chrome://extensions`，点 PrintKit 上的刷新。

## 卸载

| 系统 | 怎么做 |
| --- | --- |
| Windows | 设置 → 应用 → **PrintKit**，或开始菜单 **PrintKit → Uninstall PrintKit**，或 `%LOCALAPPDATA%\PrintKit\Uninstall-PrintKit.bat` |
| macOS | `~/Library/Application Support/PrintKit/Uninstall-PrintKit.command` |
| 扩展 | 卸载脚本只删本地代理；再到 `chrome://extensions` **移除 PrintKit 扩展** |

远程静默卸载（Windows）：`Uninstall-PrintKit.bat /S`

## 下载最新源码

`main` 目前还是空仓库，请拉带插件的分支（不要直接 clone 默认 main）：

| 方式 | 地址 |
| --- | --- |
| **源码 ZIP** | https://github.com/frank0417/print/archive/refs/heads/cursor/latest-printkit-6e43.zip |
| 仓库 | https://github.com/frank0417/print |
| 当前分支 | `cursor/latest-printkit-6e43` |
| PR | https://github.com/frank0417/print/pull/4 |

```bash
git clone -b cursor/latest-printkit-6e43 https://github.com/frank0417/print.git
```

解压 ZIP 后目录是 `print-cursor-latest-printkit-6e43/`，里面有 `extension/`、`native-host/`、`installer/`、`demo/`。

## 功能

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| `jatoolsPrinter.printPreview(myDoc)` | ✅ | 打开预览窗；点「打印」走本地代理 |
| `jatoolsPrinter.print(myDoc, true)` | ✅ | 打开预览窗；点「打印」走本地代理 |
| `jatoolsPrinter.print(myDoc, false)` | ✅ | **本地代理静默打印**；未安装则弹出安装说明 |
| **DIV ID 映射** `page1`… | ✅ | 连续 id、`page_div_prefix`、显式 `pageIds` |
| `listMappedPages()` | ✅ | 打印前自检映射到了哪些 DIV |
| 纸张 / 方向 / 边距 / 份数 | ✅ | 预览工具栏 +「纸张设置」对话框 |
| 套打偏移 `offsetX/Y` | ✅ | 毫米级，按打印机记忆，调整即时预览 |
| 套打底图 | ✅ | 预览对齐用（默认不出纸） |
| `settings.printer` | ✅ | 指定打印机名称（需 native-host） |
| `getPrinters()` | ✅ | 经本地代理枚举；未安装会提示安装 |
| `getHostStatus()` / `openInstallGuide()` | ✅ | 探测代理 / 打开安装说明 |

## 目录

```
extension/        Chrome 扩展（Manifest V3）
native-host-cpp/  C++ 原生打印引擎（QtWebKit + QPrinter，推荐）
native-host/      Node 版打印代理（兼容保留）
installer/        一键安装包构建脚本与 Win/Mac 安装程序
demo/             演示页
dist/             构建产物（gitignore）
```

## 从源码构建安装包

本地构建安装包：

```bash
./installer/build.sh
# 产物: dist/PrintKit-Setup-windows.exe / PrintKit-Setup-macos.command
#       （另有 .zip 备用包）
```

未安装代理时，扩展会弹出安装说明（含上述下载链接）。

### 开发者：从源码分别安装

1. Chrome 加载仓库中的 `extension/`
2. 安装 `native-host`（需本机 Node ≥ 18）：

```bash
# macOS
./native-host/scripts/install-mac.sh

# Windows
powershell -ExecutionPolicy Bypass -File .\native-host\scripts\install-win.ps1
```

自检：

```bash
node native-host/host.js --cli ping
node native-host/host.js --cli getPrinters
```

### 打开 Demo

```bash
cd demo && python3 -m http.server 5173
```

浏览器打开 `http://127.0.0.1:5173/` 。

## 业务页接入

```html
<div id="page1">第一页 · 发票联</div>
<div id="page2">第二页 · 副本</div>

<script>
  async function silentPrint() {
    const printers = await jatoolsPrinter.getPrinters();
    const myDoc = {
      documents: document,          // 从当前文档按 DIV ID 映射
      // page_div_prefix: 'so_',    // 可选：映射 so_page1, so_page2
      // pageIds: ['header','body'],// 可选：任意节点 id 列表
      copyrights: 'your-company',
      settings: {
        paperName: 'A4',
        orientation: 1,
        marginTop: 10,
        marginRight: 10,
        marginBottom: 10,
        marginLeft: 10,
        copies: 1,
        printer: printers[0]?.name, // 省略则用系统默认；套打偏移按此名称记忆
        offsetX: 0,                 // 毫米，向右为正（也可在预览窗现场调）
        offsetY: 0                  // 毫米，向下为正
      },
      done(err, result) {
        console.log(err || result);
      }
    };

    console.log('映射到', jatoolsPrinter.listMappedPages(myDoc));
    await jatoolsPrinter.print(myDoc, false); // false = 静默
  }
</script>
```

其它入口：`printKit` / `PrintKit` / `getJCP()`。演示页：`demo/index.html`、`demo/invoice.html`、`demo/ticket.html`。

## 静默打印链路

C++ 引擎（推荐，见 `native-host-cpp/README.md`）：

```
页面 print(myDoc, false)
  → 扩展 background
    → Native Messaging: com.printkit.host（C++ 单进程）
      → QtWebKit 渲染 → QPrinter 直接画到 GDI / CUPS
```

Node 版（兼容保留）：

```
页面 print(myDoc, false)
  → 扩展 background
    → Native Messaging: com.printkit.host
      → Chrome/Edge headless: HTML → PDF
        → macOS: lp / Windows: PDFtoPrinter 或 PrintTo
```

未安装代理时，`print(myDoc, false)` / `getPrinters()` 会**弹出安装说明窗口**（含一键安装包下载地址）。安装说明页可「重新检测」或「改用预览打印」。

## 与官方 JCP 的差异

- 代理基于 Node + 系统打印，而非 JCP 闭源客户端  
- Windows 完美静默已在安装包中附带 `PDFtoPrinter.exe`  
- 复杂跨域 CSS 可能需内联样式以保证 PDF 一致  

## License

MIT
