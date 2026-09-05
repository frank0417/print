# Uninstall PrintKit (Windows user-level)
$ErrorActionPreference = 'SilentlyContinue'
$NativeHostName = 'com.printkit.host'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'PrintKit'

Remove-Item "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName" -Recurse -Force
Remove-Item "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$NativeHostName" -Recurse -Force
Remove-Item "HKCU:\Software\Chromium\NativeMessagingHosts\$NativeHostName" -Recurse -Force

$Programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\PrintKit'
if (Test-Path $Programs) {
  Remove-Item $Programs -Recurse -Force
}

try {
  $desk = [Environment]::GetFolderPath('Desktop')
  Remove-Item (Join-Path $desk 'PrintKit Extension Folder.lnk') -Force
} catch {}

if (Test-Path $InstallRoot) {
  Remove-Item $InstallRoot -Recurse -Force
  Write-Host "Removed: $InstallRoot"
}

Write-Host 'Native Messaging registration removed.'
Write-Host 'Remove the PrintKit extension manually in chrome://extensions'
pause
