# Install PrintKit Native Messaging host for Windows (Chrome / Edge)
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File .\install-win.ps1

$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$HostJs = Join-Path $Root 'host.js'
$LauncherCmd = Join-Path $Root 'printkit-host.cmd'
$ExtId = 'memmopnlapcegennpipheiadaonehljd'
$HostName = 'com.printkit.host'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error '需要先安装 Node.js (>=18)。https://nodejs.org/'
}

$nodePath = $node.Source
# cmd launcher for Native Messaging (quotes-safe)
@"
@echo off
"$nodePath" "$HostJs" %*
"@ | Set-Content -Path $LauncherCmd -Encoding ASCII

$manifestJson = (@{
  name            = $HostName
  description     = 'PrintKit Native Messaging Host'
  path            = $LauncherCmd
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtId/")
} | ConvertTo-Json)

# UTF-8 without BOM (Chrome rejects BOM in native host manifests)
[System.IO.File]::WriteAllText($manifestPath, $manifestJson)

function Register-NativeHost([string]$RegPath) {
  if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
  }
  New-ItemProperty -Path $RegPath -Name '(default)' -Value $manifestPath -PropertyType String -Force | Out-Null
  Write-Host "已注册: $RegPath -> $manifestPath"
}

# Chrome + Edge (user level)
Register-NativeHost "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
Register-NativeHost "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
Register-NativeHost "HKCU:\Software\Chromium\NativeMessagingHosts\$HostName"

Write-Host ""
Write-Host "安装完成。"
Write-Host "1) Chrome 加载解压扩展: $Root\..\extension"
Write-Host "   扩展 ID 应为: $ExtId"
Write-Host "2) 自检: node `"$HostJs`" --cli ping"
Write-Host "3) 打印机: node `"$HostJs`" --cli getPrinters"
Write-Host ""
Write-Host "Windows 静默打印建议: 将 PDFtoPrinter.exe 放到 native-host\bin\"
Write-Host "下载: https://www.columbia.edu/~em36/pdftoprinter.html"
Write-Host "日志: $env:TEMP\printkit-host.log"
