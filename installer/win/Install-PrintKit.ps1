# PrintKit 一体化安装（Windows）
# 双击 Install-PrintKit.bat 即可；或在 PowerShell 中运行本脚本。

$ErrorActionPreference = 'Stop'

$SetupRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppSource = Join-Path $SetupRoot 'app'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'PrintKit'
$HostName = 'com.printkit.host'
$ExtId = 'memmopnlapcegennpipheiadaonehljd'

Write-Host '========================================'
Write-Host ' PrintKit 一体化安装'
Write-Host '========================================'
Write-Host "安装目录: $InstallRoot"
Write-Host ''

if (-not (Test-Path (Join-Path $AppSource 'host\host.js'))) {
  Write-Error '找不到 app\host\host.js，请使用完整的 PrintKit-Setup-windows 安装包。'
}

# Copy payload
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Write-Host '正在复制文件...'
robocopy $AppSource $InstallRoot /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) {
  Write-Error "复制失败 (robocopy exit $LASTEXITCODE)"
}

$NodeExe = Join-Path $InstallRoot 'runtime\node\node.exe'
$HostJs = Join-Path $InstallRoot 'host\host.js'
$Launcher = Join-Path $InstallRoot 'printkit-host.cmd'
$ManifestPath = Join-Path $InstallRoot "$HostName.json"
$PdfHelper = Join-Path $InstallRoot 'bin\PDFtoPrinter.exe'

if (-not (Test-Path $NodeExe)) {
  Write-Error '安装包缺少内置 Node 运行时。'
}

# Ensure PDFtoPrinter available to host
$hostBin = Join-Path $InstallRoot 'host\bin'
New-Item -ItemType Directory -Force -Path $hostBin | Out-Null
if (Test-Path $PdfHelper) {
  Copy-Item $PdfHelper (Join-Path $hostBin 'PDFtoPrinter.exe') -Force
}

# Native Messaging launcher
@"
@echo off
"$NodeExe" "$HostJs" %*
"@ | Set-Content -Path $Launcher -Encoding ASCII

$manifestJson = (@{
  name            = $HostName
  description     = 'PrintKit Native Messaging Host'
  path            = $Launcher
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtId/")
} | ConvertTo-Json)
[System.IO.File]::WriteAllText($ManifestPath, $manifestJson)

function Register-NativeHost([string]$RegPath) {
  if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
  }
  New-ItemProperty -Path $RegPath -Name '(default)' -Value $ManifestPath -PropertyType String -Force | Out-Null
  Write-Host "已注册: $RegPath"
}

Register-NativeHost "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
Register-NativeHost "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
Register-NativeHost "HKCU:\Software\Chromium\NativeMessagingHosts\$HostName"

# Self-check
Write-Host ''
Write-Host '正在自检本地代理...'
& $NodeExe $HostJs --cli ping | Write-Host

$ExtDir = Join-Path $InstallRoot 'extension'
Set-Content -Path (Join-Path $InstallRoot 'EXTENSION_PATH.txt') -Value $ExtDir -Encoding UTF8

Write-Host ''
Write-Host '安装完成。'
Write-Host "1) 打开 Chrome → chrome://extensions"
Write-Host '2) 开启「开发者模式」→「加载已解压的扩展程序」'
Write-Host "3) 选择目录: $ExtDir"
Write-Host "4) 确认扩展 ID 为: $ExtId"
Write-Host ''
Write-Host '也可双击 Open-Extensions.bat 打开扩展页。'
Write-Host ''

# Offer to open extensions page
try {
  Start-Process 'chrome.exe' 'chrome://extensions'
} catch {
  try { Start-Process 'msedge.exe' 'chrome://extensions' } catch { }
}

Write-Host '按任意键退出...'
[void][System.Console]::ReadKey($true)
