PrintKit 一体化安装包（macOS）
==============================

本包已内置：
  - PrintKit Chrome 扩展
  - 本地打印代理（Native Messaging Host）
  - Node.js 运行时（x64 + arm64，安装时自动选择，无需单独安装 Node）

安装步骤
--------
1. 解压本 ZIP
2. 右键 Install-PrintKit.command → 打开（首次可能需在「隐私与安全性」允许）
   或在终端执行：
     chmod +x Install-PrintKit.command && ./Install-PrintKit.command
3. 在 chrome://extensions：
   - 开启「开发者模式」
   - 「加载已解压的扩展程序」
   - 选择：~/Library/Application Support/PrintKit/extension
4. 确认扩展 ID 为：memmopnlapcegennpipheiadaonehljd

卸载
----
双击 Uninstall-PrintKit.command

项目主页
--------
https://github.com/frank0417/print
