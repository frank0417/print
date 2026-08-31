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
$InstallLog = Join-Path $env:TEMP 'PrintKit-install.log'

function Write-InstallLog([string]$Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Add-Content -Path $InstallLog -Value $line -Encoding UTF8
  Write-Host $Message
}

function Write-InstallWarn([string]$Message) {
  Write-InstallLog "WARN: $Message"
}

function Invoke-RobocopyInstall([string]$Source, [string]$Target) {
  $args = @(
    $Source, $Target,
    '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np',
    '/R:2', '/W:2'
  )
  Write-InstallLog "robocopy $($args -join ' ')"
  & robocopy @args | Out-Null
  $code = $LASTEXITCODE
  Write-InstallLog "robocopy exit code: $code"
  if ($code -ge 8) {
    throw "Copy failed (robocopy exit $code). Close Chrome/Edge and retry, or delete $Target then run installer again."
  }
}

function New-FolderShortcut([object]$WshShell, [string]$LinkPath, [string]$FolderPath) {
  $sc = $WshShell.CreateShortcut($LinkPath)
  $sc.TargetPath = "$env:SystemRoot\explorer.exe"
  $sc.Arguments = "/E,`"$FolderPath`""
  $sc.WorkingDirectory = $FolderPath
  $sc.Save()
}

try {
  Set-Content -Path $InstallLog -Value "PrintKit Windows install log" -Encoding UTF8
  Write-InstallLog "Setup root: $SetupRoot"
  Write-InstallLog "Install folder: $InstallRoot"

  Write-Host '========================================'
  Write-Host ' PrintKit One-Click Setup'
  Write-Host '========================================'
  Write-Host "Install folder: $InstallRoot"
  Write-Host "Install log: $InstallLog"
  Write-Host ''

  if (-not (Test-Path (Join-Path $AppSource 'host\host.js'))) {
    throw 'Missing app\host\host.js. Extract the full PrintKit-Setup-windows ZIP, or use PrintKit-Setup-windows.exe.'
  }

  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  Write-InstallLog 'Copying files...'
  Invoke-RobocopyInstall -Source $AppSource -Target $InstallRoot

  $NodeExe = Join-Path $InstallRoot 'runtime\node\node.exe'
  $HostJs = Join-Path $InstallRoot 'host\host.js'
  $Launcher = Join-Path $InstallRoot 'printkit-host.cmd'
  $ManifestPath = Join-Path $InstallRoot "$NativeHostName.json"
  $PdfHelper = Join-Path $InstallRoot 'bin\PDFtoPrinter.exe'
  $FinishHtml = Join-Path $InstallRoot 'finish.html'

  if (-not (Test-Path $NodeExe)) {
    throw 'Bundled Node runtime not found in this package.'
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
  } | ConvertTo-Json -Compress)
  [System.IO.File]::WriteAllText($ManifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

  function Register-NativeHost([string]$RegPath) {
    if (-not (Test-Path $RegPath)) {
      New-Item -Path $RegPath -Force | Out-Null
    }
    New-ItemProperty -Path $RegPath -Name '(default)' -Value $ManifestPath -PropertyType String -Force | Out-Null
    Write-InstallLog "Registered: $RegPath"
  }

  Register-NativeHost "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName"
  Register-NativeHost "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$NativeHostName"
  Register-NativeHost "HKCU:\Software\Chromium\NativeMessagingHosts\$NativeHostName"

  Write-InstallLog 'Self-check (native host)...'
  try {
    $pingJson = & $NodeExe $HostJs --cli ping 2>&1 | Out-String
    Write-InstallLog $pingJson.Trim()
    if ($LASTEXITCODE -ne 0) {
      Write-InstallWarn "Self-check returned exit code $LASTEXITCODE (install files are in place; you can retry after closing Chrome)."
    }
  } catch {
    Write-InstallWarn "Self-check failed: $($_.Exception.Message)"
  }

  $ExtDir = Join-Path $InstallRoot 'extension'
  [System.IO.File]::WriteAllText(
    (Join-Path $InstallRoot 'EXTENSION_PATH.txt'),
    $ExtDir,
    [System.Text.UTF8Encoding]::new($false)
  )

  try {
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

    New-FolderShortcut -WshShell $WshShell -LinkPath (Join-Path $Programs 'PrintKit Extension Folder.lnk') -FolderPath $ExtDir

    $desk = [Environment]::GetFolderPath('Desktop')
    if ($desk) {
      New-FolderShortcut -WshShell $WshShell -LinkPath (Join-Path $desk 'PrintKit Extension Folder.lnk') -FolderPath $ExtDir
    }
  } catch {
    Write-InstallWarn "Shortcut creation skipped: $($_.Exception.Message)"
  }

  try {
    Set-Clipboard -Value $ExtDir
    Write-InstallLog 'Extension path copied to clipboard.'
  } catch {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.Clipboard]::SetText($ExtDir)
      Write-InstallLog 'Extension path copied to clipboard.'
    } catch {
      Write-InstallWarn 'Could not copy path to clipboard.'
    }
  }

  Write-InstallLog 'Install finished.'
  Write-Host ''
  Write-Host 'Install finished.'
  Write-Host 'Next: load unpacked extension in chrome://extensions'
  Write-Host "Folder: $ExtDir"
  Write-Host "Expected ID: $ExtId"
  Write-Host "Log file: $InstallLog"
  Write-Host ''

  try { Start-Process explorer.exe $ExtDir } catch {
    Write-InstallWarn "Could not open extension folder: $($_.Exception.Message)"
  }

  try {
    Start-Process 'chrome.exe' 'chrome://extensions'
  } catch {
    try { Start-Process 'msedge.exe' 'chrome://extensions' } catch {
      Write-InstallWarn 'Could not open browser extensions page automatically.'
    }
  }

  if (Test-Path $FinishHtml) {
    $uri = 'file:///' + ($FinishHtml -replace '\\', '/') + '?path=' + [uri]::EscapeDataString($ExtDir)
    try { Start-Process $uri } catch {
      try { Start-Process $FinishHtml } catch {
        Write-InstallWarn 'Could not open finish guide.'
      }
    }
  }

  if (-not $NoPause) {
    Write-Host 'Press any key to exit...'
    [void][System.Console]::ReadKey($true)
  }
  exit 0
} catch {
  $msg = $_.Exception.Message
  Write-InstallLog "ERROR: $msg"
  Write-Host ''
  Write-Host "Install failed: $msg" -ForegroundColor Red
  Write-Host "See log: $InstallLog"
  Write-Host ''
  Write-Host 'Tips:'
  Write-Host '1) Re-download from GitHub Releases (do NOT forward via WeChat).'
  Write-Host '2) Extract ZIP fully, then run Install-PrintKit.bat.'
  Write-Host '3) Close Chrome/Edge, delete %LOCALAPPDATA%\PrintKit, retry.'
  if (-not $NoPause) {
    Write-Host 'Press any key to exit...'
    try { [void][System.Console]::ReadKey($true) } catch { }
  }
  exit 1
}
