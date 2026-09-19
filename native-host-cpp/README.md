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

## 构建

依赖 Qt 5.15 + QtWebKit 5.212（reborn）。

```bash
# Ubuntu / Debian
sudo apt-get install qtbase5-dev qt5-qmake libqt5webkit5-dev cmake g++

cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=g++
cmake --build build -j
```

qmake 亦可：`qmake && make`。

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

## 实测（Ubuntu 24.04 / Qt 5.15.13 / WebKit 5.212）

- 可执行文件 92 KB；空闲 RSS ≈ 38 MB（绝大部分为 Qt/WebKit 共享库页，
  多进程共享；进程私有增量在个位数 MB）
- A5 横向两页发票渲染 219 ms；PDF MediaBox 精确 595×420 pt（=210×148 mm）
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
