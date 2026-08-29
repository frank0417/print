# PrintKit Windows installer (all-in-one / one-click)
# Run via Install-PrintKit.bat, NSIS exe, or:
#   powershell -ExecutionPolicy Bypass -File Install-PrintKit.ps1
param(
  [switch]$NoPause,
  [switch]$FromOneClick
)

$ErrorActionPreference = 'Stop'

$SetupRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppSource = Join-Path $SetupRoot 'app'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'PrintKit'
$NativeHostName = 'com.printkit.host'
$ExtId = 'memmopnlapcegennpipheiadaonehljd'

Write-Host '========================================'
Write-Host ' PrintKit One-Click Setup'
Write-Host '========================================'
Write-Host "Install folder: $InstallRoot"
Write-Host ''

if (-not (Test-Path (Join-Path $AppSource 'host\host.js'))) {
  Write-Error 'Missing app\host\host.js. Use PrintKit-Setup-windows.exe or the full ZIP package.'
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
$FinishHtml = Join-Path $InstallRoot 'finish.html'

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

# Desktop + Start Menu shortcuts (Open Extensions)
$WshShell = New-Object -ComObject WScript.Shell
$Programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\PrintKit'
New-Item -ItemType Directory -Force -Path $Programs | Out-Null

$openExtBat = Join-Path $InstallRoot 'Open-Extensions.bat'
if (-not (Test-Path $openExtBat)) {
  $bat = "@echo off`r`nstart chrome.exe chrome://extensions`r`nif errorlevel 1 start msedge.exe chrome://extensions`r`n"
  [System.IO.File]::WriteAllText($openExtBat, $bat, [System.Text.Encoding]::ASCII)
}

$sc1 = $WshShell.CreateShortcut((Join-Path $Programs 'Open Chrome Extensions.lnk'))
$sc1.TargetPath = $openExtBat
$sc1.WorkingDirectory = $InstallRoot
$sc1.Save()

$sc2 = $WshShell.CreateShortcut((Join-Path $Programs 'PrintKit Extension Folder.lnk'))
$sc2.TargetPath = $ExtDir
$sc2.Save()

try {
  $desk = [Environment]::GetFolderPath('Desktop')
  $sc3 = $WshShell.CreateShortcut((Join-Path $desk 'PrintKit Extension Folder.lnk'))
  $sc3.TargetPath = $ExtDir
  $sc3.Save()
} catch {}

# Clipboard: extension path
try {
  Set-Clipboard -Value $ExtDir
  Write-Host "Extension path copied to clipboard."
} catch {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Clipboard]::SetText($ExtDir)
    Write-Host "Extension path copied to clipboard."
  } catch {
    Write-Host "Could not copy path to clipboard."
  }
}

Write-Host ''
Write-Host 'Install finished.'
Write-Host 'Next: load unpacked extension in chrome://extensions'
Write-Host "Folder: $ExtDir"
Write-Host "Expected ID: $ExtId"
Write-Host ''

# Open Explorer on extension folder for easy "Load unpacked"
try { Start-Process explorer.exe $ExtDir } catch {}

try {
  Start-Process 'chrome.exe' 'chrome://extensions'
} catch {
  try { Start-Process 'msedge.exe' 'chrome://extensions' } catch { }
}

# Open finish guide
if (Test-Path $FinishHtml) {
  $uri = 'file:///' + ($FinishHtml -replace '\\', '/') + '?path=' + [uri]::EscapeDataString($ExtDir)
  try { Start-Process $uri } catch { Start-Process $FinishHtml }
}

if (-not $NoPause) {
  Write-Host 'Press any key to exit...'
  [void][System.Console]::ReadKey($true)
}
