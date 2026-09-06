# Uninstall Windows native host registrations
$ErrorActionPreference = 'SilentlyContinue'
$HostName = 'com.printkit.host'
Remove-Item "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName" -Recurse -Force
Remove-Item "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName" -Recurse -Force
Remove-Item "HKCU:\Software\Chromium\NativeMessagingHosts\$HostName" -Recurse -Force
Write-Host "已移除用户级 Native Messaging 注册。"
