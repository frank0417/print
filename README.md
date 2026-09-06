# PrintKit · Chrome 打印扩展（对齐 jatoolsPrinter）

当前最新版：**v0.5.17**（可远程/一键升级）

用 Chrome 扩展实现网页精确打印，API 对齐经典 **jatoolsPrinter / JCP**。  
Windows 一键安装包内置 Node 运行时 + 打印代理 + 扩展（另含 PDFtoPrinter），兼容 **Windows 7**。

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
| DIV ID 映射分页 `page1`… | ✅ | 支持 `page_div_prefix` |
| 纸张 / 方向 / 边距 / 份数 | ✅ | `settings` + 预览工具栏 |
| `settings.printer` | ✅ | 指定打印机名称（需 native-host） |
| `getPrinters()` | ✅ | 经本地代理枚举；未安装会提示安装 |
| `getHostStatus()` / `openInstallGuide()` | ✅ | 探测代理 / 打开安装说明 |

## 目录

```
extension/       Chrome 扩展（Manifest V3）
native-host/     Native Messaging 打印代理源码
installer/       一键安装包构建脚本与 Win/Mac 安装程序
demo/            演示页
dist/            构建产物（gitignore）
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

未安装代理时，`print(myDoc, false)` / `getPrinters()` 会**弹出安装说明窗口**（含一键安装包下载地址）。安装说明页可「重新检测」或「改用预览打印」。

## 与官方 JCP 的差异

- 代理基于 Node + 系统打印，而非 JCP 闭源客户端  
- Windows 完美静默已在安装包中附带 `PDFtoPrinter.exe`  
- 复杂跨域 CSS 可能需内联样式以保证 PDF 一致  

## License

MIT
