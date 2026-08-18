# PrintKit · Chrome 打印扩展（对齐 jatoolsPrinter）

用 Chrome 扩展实现网页精确打印，API 对齐经典 **jatoolsPrinter / JCP** 的常见用法：按 `page1`、`page2`… DIV 分页，支持打印预览与打印对话框。

> 说明：真正的 jatools/JCP 依赖本地客户端实现静默选打印机、注册表参数等。本项目在 **普通桌面 Chrome** 上通过扩展 + 系统打印对话框实现等价开发体验；完整静默出纸需后续接入 Native Messaging 本地代理（或 ChromeOS `chrome.printing`）。

## 功能（v0.1）

| 能力 | 状态 | 对齐说明 |
| --- | --- | --- |
| `jatoolsPrinter.printPreview(myDoc)` | ✅ | 打开预览窗 |
| `jatoolsPrinter.print(myDoc, true/false)` | ✅ | true=预览后调系统对话框；false=打开预览并自动 `window.print()` |
| DIV ID 映射分页 `page1`… | ✅ | 支持 `page_div_prefix` |
| 纸张 / 方向 / 边距 / 份数 | ✅ | 预览工具栏可改，写入 `@page` |
| 打印 HTML 字符串 / 元素数组 | ✅ | `documents` 可为 string / Element[] |
| `done` 回调 | ✅ | 任务创建成功后触发 |
| `getJCP()` | ✅ | Promise 风格入口 |
| `getPrinters()` | ⚠️ | ChromeOS 有 `chrome.printing` 时可用；桌面端返回 `[]` |
| 本地静默指定打印机 | ❌ | 需 Native Host，后续版本 |

## 目录

```
extension/          Chrome 扩展（Manifest V3）
  manifest.json
  background/       任务管理、打开预览窗
  content/          注入页面桥
  page/inject.js    页面世界 API（jatoolsPrinter）
  preview/          打印预览 UI
  popup/            扩展弹窗说明
demo/               本地演示页
```

## 安装扩展

1. 打开 Chrome → `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本仓库的 `extension/` 目录
4. （可选）若用 `file://` 打开 demo，请勾选扩展的「允许访问文件网址」

## 运行 Demo

任意静态服务器均可，例如：

```bash
cd demo
python3 -m http.server 5173
```

浏览器打开 `http://127.0.0.1:5173/` ，点击「打印预览」。

## 业务页接入（与 jatools 同写法）

安装扩展后，页面会自动注入全局对象，**无需再嵌 ActiveX / 引 cab**。

```html
<div id="page1">第一页内容</div>
<div id="page2">第二页内容</div>

<script>
  function doPrint(how) {
    var myDoc = {
      documents: document,
      copyrights: 'your-company',
      settings: {
        paperName: 'A4',      // A3/A4/A5/B5/Letter/Legal
        orientation: 1,       // 1 纵向 / 2 横向
        marginTop: 10,
        marginRight: 10,
        marginBottom: 10,
        marginLeft: 10,
        copies: 1
      },
      done: function (err) {
        if (err) console.error(err);
      }
    };

    if (how === 'preview') {
      jatoolsPrinter.printPreview(myDoc);
    } else if (how === 'dialog') {
      jatoolsPrinter.print(myDoc, true);
    } else {
      jatoolsPrinter.print(myDoc, false);
    }
  }
</script>
```

### 多文档前缀

同一页多套票据时：

```js
myDoc.page_div_prefix = 'report1'; // 匹配 report1page1, report1page2...
```

### 新式入口

```js
getJCP().then((jcp) => jcp.printPreview(myDoc));
// 或
printKit.printPreview(myDoc);
```

## myDoc 字段

| 字段 | 说明 |
| --- | --- |
| `documents` | `document` / 某个元素 / HTML 字符串 / 元素或字符串数组 |
| `copyrights` | 兼容字段（jatools 必填）；本扩展不强制 |
| `settings` | 纸张、方向、边距、份数等 |
| `page_div_prefix` | 页 DIV id 前缀 |
| `done(err, result)` | 回调 |
| `overlay` | 预览可见的套打底图 HTML（打印时隐藏） |

## 架构

```
业务页面
  └─ window.jatoolsPrinter (page/inject.js)
        └─ postMessage → content/bridge.js
              └─ runtime → background service worker
                    └─ 打开 preview/preview.html（系统打印）
```

## 与官方 JCP 的差异（务必知悉）

1. **桌面 Chrome 不能直接枚举/指定物理打印机做完全静默打印**（无本地客户端时）。
2. 预览与出纸依赖浏览器排版 + 系统打印对话框，复杂 CSS（尤其跨域样式表）需自测。
3. `copies` 会提示用户在系统对话框中确认份数（浏览器限制）。

后续若要完全对齐 JCP 静默能力：扩展 + Native Messaging + 本地打印代理（PDF/HTML → 系统打印队列）。

## 开发计划（建议）

- [ ] Native Messaging 本地打印代理（指定打印机、静默、保留设置）
- [ ] 预览缩放、页码跳转、指定页打印
- [ ] 更完善的样式内联（降低跨域 CSS 丢失）
- [ ] Vue/React 示例与 npm SDK 包

## License

MIT
