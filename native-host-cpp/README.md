# PrintKit C++ 原生引擎（QtWebKit + QPrinter）

**不依赖 Node.js 或 Python 中间层**：一个原生进程完成
Native Messaging ⇄ HTML 渲染 ⇄ 出纸。

```
Chrome 扩展 (DIV ID 映射)
   │ Native Messaging (uint32 LE + JSON)
   ▼
printkit-host (单个 C++ 可执行文件)
   │ QtWebKit QWebPage —— 排版内核，同一套矢量指令
   ▼
QPrinter → Windows GDI / macOS·Linux CUPS（或 PDF 文件）
```

## 与 Node 版的区别

| | Node 版（`native-host/`） | **C++ 版（本目录）** |
| --- | --- | --- |
| 渲染 | 拉起 headless Chrome → PDF → 再送印 | QtWebKit 内嵌渲染，`QWebFrame::print()` **直接画到打印机设备上下文** |
| 中间层 | Node 运行时 + Chrome 进程 | 无。单个 ~92 KB 可执行文件（动态链接 Qt） |
| 中间产物 | 临时 HTML + PDF 文件 | 无（`--cli print … out.pdf` 可选出 PDF 供校验） |
| 空闲 CPU | 常驻 Node + 可能残留 headless Chrome | 阻塞在 stdin 读取上，**空闲 CPU 0%**；Chrome 断开端口即退出 |
| 鉴权 | manifest allowed_origins | manifest + **IP-Sentinel**：进程启动即校验扩展来源，毫秒级（实测 0.002 ms），不合法直接拒绝 |

预览与出纸一致性：扩展预览窗与本引擎用同一套页面盒模型
（`@page` 尺寸 / 边距 padding / mm 偏移 translate / 内容缩放 zoom），
`tests/test_core.cpp` 与扩展侧单测互为镜像。

两条硬规则保证几何不跑版：

1. 组装 HTML 的页面几何全部以 **CSS 参考像素**（96/in）显式给出，
   引擎自己的 mm↔px DPI 映射（跑版第一元凶）被排除在链路外；
2. 出纸不走 `QWebFrame::print()` 的内部缩放启发式，而是 QPainter 手动
   控制 css-px → 设备坐标的唯一缩放系数，逐页 `render()` 输出。

Blink（预览）vs QtWebKit（出纸）同文档 A/B 实测：页面盒 1:1
（两边都是 595×420 pt），表格线、标题、页脚坐标重合；残余像素差约 3%
且全部来自两引擎的字体描边/抗锯齿风格，无位置偏移。
`--cli compose job.json out.html` 可导出组装后的最终文档用于排查。

## 构建

依赖 Qt 5.15 + QtWebKit 5.212（reborn）。

```bash
# Ubuntu / Debian
sudo apt-get install qtbase5-dev qt5-qmake libqt5webkit5-dev cmake g++

cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=g++
cmake --build build -j
```

qmake 亦可：`qmake && make`。

### macOS（原生 arm64 / x86_64）

QtWebKit 用 MacPorts 装——它有 **Apple Silicon 原生 arm64 的预编译包**
（darwin_21…25，覆盖 macOS 12–15+），无需 1–2 小时的 WebKit 源码编译，
也无需 Rosetta：

```bash
sudo port -N install qt5-qtwebkit     # arm64/x86_64 二进制包
./scripts/build-mac.sh --package      # 构建 + 核心测试 + 自包含 .app
./scripts/install-mac.sh build-mac/printkit-host   # 注册到 Chrome
```

`--package` 会用 macdeployqt 把 Qt/QtWebKit framework 打进
`PrintKit-Host.app`（QWebPage 是单进程 WebKit1，没有辅助进程要带），
产出 `PrintKit-Host-macos-<arch>.zip`；manifest 指向
`PrintKit-Host.app/Contents/MacOS/printkit-host` 即可。

CI（`.github/workflows/build.yml`）在 GitHub 的 **macos-14（Apple Silicon）**
与 macos-13（Intel）真机上分别原生构建、跑测试、出 PDF 校验并上传两个
架构的 .app 产物。分发给最终用户前还需 Developer ID 签名 + 公证
（或安装脚本里去 quarantine），否则 Gatekeeper 会拦下 Chrome 拉起宿主。

Windows：安装含 qtwebkit 的 Qt 5.x（如 Qt 5.14/5.15 + [qtwebkit 5.212 二进制](https://github.com/qtwebkit/qtwebkit/releases)），
用 `qmake printkit-host.pro && nmake`（MSVC）或 `mingw32-make`。

## 注册（host 名不变，扩展零改动）

Host 名仍是 `com.printkit.host`，Chrome 扩展无需任何修改。

```bash
./scripts/install-linux.sh          # Linux
./scripts/install-mac.sh            # macOS
powershell -File scripts/install-win.ps1   # Windows
```

## 自检

```bash
./build/printkit-host --cli ping
./build/printkit-host --cli getPrinters
./build/printkit-host --cli print job.json out.pdf   # 渲染校验（不占打印机）
```

协议 / 排版单元测试（无 Qt 依赖，纯 g++ 即可）：

```bash
g++ -std=c++17 -Isrc tests/test_core.cpp \
    src/protocol.cpp src/paper.cpp src/sentinel.cpp src/htmldoc.cpp \
    -o core-tests && ./core-tests
# 或 cmake 构建后: ctest --test-dir build
```

## 长时运行与可靠性

**内存不泄露** — 打完每单立即 `QWebSettings::clearMemoryCaches()`，并关闭
WebKit 页面缓存 / 压缩对象缓存（打印任务几乎不复用资源，缓存只会白涨）。
回归测试 `tests/test_render_loop.cpp`（`ctest` 的 `render-loop`）单进程连打
24 单：**预热后 20 单 RSS 仅 +132 KB**，增长超 32 MB 即测试失败。

**不重复打印** — 三道防线：

1. 扩展为每单生成稳定 `jobId`；宿主记住最近 32 个**成功**任务，同一 `jobId`
   再次送达（双击、消息重发）直接返回缓存结果并标记 `duplicate: true`，
   不再喂打印机。失败任务不缓存，可放心重试。
2. 修复扩展 `native.js`：带 `requestId` 的迟到回复（等待方已超时）现在直接
   丢弃，不再错误地兑现下一个等待者——那会把新任务误标为已完成，诱发用户重打。
3. 预览窗本身有 `printing` 互斥 + Enter 防误触（沿用）。

**启动可靠（无需自启动）** — Native Messaging 宿主由 Chrome 按需拉起，
**本来就不需要开机自启 / 守护进程**，只要 manifest 注册过即可（安装脚本负责）；
MV3 service worker 休眠后由页面消息自动唤醒。两处易踩的「起不来」已加固：

- stdout 只承载帧协议字节；`qInstallMessageHandler` 把所有 Qt 日志强制到
  stderr——任何库往 stdout 打一行字都会破坏帧，Chrome 会表现为「宿主无响应」。
- Linux 无显示环境自动切 `offscreen` 平台；POSIX 忽略 SIGPIPE，Chrome 断开
  管道时进程走正常退出路径。

## 实测（Ubuntu 24.04 / Qt 5.15.13 / WebKit 5.212）

- 可执行文件 92 KB；空闲 RSS ≈ 38 MB（绝大部分为 Qt/WebKit 共享库页，
  多进程共享；进程私有增量在个位数 MB）
- A5 横向两页发票渲染 219 ms；PDF MediaBox 精确 595×420 pt（=210×148 mm）
- 连打 24 单：预热后 RSS 增长 132 KB（≈6 KB/单，无泄露趋势）
- 同一 `jobId` 线上重复送达：第二次返回 `duplicate:true`，不重复出纸
- IP-Sentinel 鉴权 0.002 ms；非法扩展 ID 进程直接退出（exit 3）
- 空闲时阻塞在 `fread(stdin)`，CPU 0%；Chrome 关闭端口即退出，无驻留

## 目录

```
src/
  protocol.*   Native Messaging 帧协议（纯 C++，可单测）
  paper.*      纸张/边距/偏移解析（镜像 extension/lib/paper.js）
  htmldoc.*    页面盒模型 HTML 组装（镜像预览窗渲染规则）
  sentinel.*   IP-Sentinel 扩展来源鉴权
  job.*        print 载荷解析（QJson）
  render.*     QtWebKit → QPrinter 直接出纸
  actions.*    ping/getPrinters/print 分发
  main.cpp     消息循环 + CLI
tests/test_core.cpp   无 Qt 单测
scripts/              Win/mac/Linux 注册脚本
```
