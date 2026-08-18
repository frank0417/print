# Uninstall PrintKit (Windows user-level)
$ErrorActionPreference = 'SilentlyContinue'
$HostName = 'com.printkit.host'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'PrintKit'

Remove-Item "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName" -Recurse -Force
Remove-Item "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName" -Recurse -Force
Remove-Item "HKCU:\Software\Chromium\NativeMessagingHosts\$HostName" -Recurse -Force

if (Test-Path $InstallRoot) {
  Remove-Item $InstallRoot -Recurse -Force
  Write-Host "已删除: $InstallRoot"
}

Write-Host '已卸载 Native Messaging 注册。请在 chrome://extensions 中手动移除 PrintKit 扩展。'
pause
