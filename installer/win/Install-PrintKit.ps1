# PrintKit Windows installer (all-in-one package)
# Run via Install-PrintKit.bat or: powershell -ExecutionPolicy Bypass -File Install-PrintKit.ps1

$ErrorActionPreference = 'Stop'

$SetupRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppSource = Join-Path $SetupRoot 'app'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'PrintKit'
$NativeHostName = 'com.printkit.host'
$ExtId = 'memmopnlapcegennpipheiadaonehljd'

Write-Host '========================================'
Write-Host ' PrintKit Setup'
Write-Host '========================================'
Write-Host "Install folder: $InstallRoot"
Write-Host ''

if (-not (Test-Path (Join-Path $AppSource 'host\host.js'))) {
  Write-Error 'Missing app\host\host.js. Use the full PrintKit-Setup-windows.zip package.'
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Write-Host 'Copying files...'
robocopy $AppSource $InstallRoot /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) {
  Write-Error "Copy failed (robocopy exit $LASTEXITCODE)"
}

$NodeExe = Join-Path $InstallRoot 'runtime\node\node.exe'
$HostJs = Join-Path $InstallRoot 'host\host.js'
$Launcher = Join-Path $InstallRoot 'printkit-host.cmd'
$ManifestPath = Join-Path $InstallRoot "$NativeHostName.json"
$PdfHelper = Join-Path $InstallRoot 'bin\PDFtoPrinter.exe'

if (-not (Test-Path $NodeExe)) {
  Write-Error 'Bundled Node runtime not found in this package.'
}

$hostBin = Join-Path $InstallRoot 'host\bin'
New-Item -ItemType Directory -Force -Path $hostBin | Out-Null
if (Test-Path $PdfHelper) {
  Copy-Item $PdfHelper (Join-Path $hostBin 'PDFtoPrinter.exe') -Force
}

$launcherContent = "@echo off`r`n`"$NodeExe`" `"$HostJs`" %*`r`n"
[System.IO.File]::WriteAllText($Launcher, $launcherContent, [System.Text.Encoding]::ASCII)

$manifestJson = (@{
  name            = $NativeHostName
  description     = 'PrintKit Native Messaging Host'
  path            = $Launcher
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtId/")
} | ConvertTo-Json)
[System.IO.File]::WriteAllText($ManifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

function Register-NativeHost([string]$RegPath) {
  if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
  }
  New-ItemProperty -Path $RegPath -Name '(default)' -Value $ManifestPath -PropertyType String -Force | Out-Null
  Write-Host "Registered: $RegPath"
}

Register-NativeHost "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName"
Register-NativeHost "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$NativeHostName"
Register-NativeHost "HKCU:\Software\Chromium\NativeMessagingHosts\$NativeHostName"

Write-Host ''
Write-Host 'Self-check (native host)...'
& $NodeExe $HostJs --cli ping | Write-Host

$ExtDir = Join-Path $InstallRoot 'extension'
[System.IO.File]::WriteAllText(
  (Join-Path $InstallRoot 'EXTENSION_PATH.txt'),
  $ExtDir,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host ''
Write-Host 'Install finished.'
Write-Host '1) Open chrome://extensions in Chrome or Edge'
Write-Host '2) Turn ON Developer mode'
Write-Host '3) Load unpacked extension, select folder:'
Write-Host "   $ExtDir"
Write-Host "4) Extension ID must be: $ExtId"
Write-Host ''
Write-Host 'Tip: double-click Open-Extensions.bat to open the extensions page.'
Write-Host ''

try {
  Start-Process 'chrome.exe' 'chrome://extensions'
} catch {
  try { Start-Process 'msedge.exe' 'chrome://extensions' } catch { }
}

Write-Host 'Press any key to exit...'
[void][System.Console]::ReadKey($true)
