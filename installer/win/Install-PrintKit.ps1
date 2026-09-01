# PrintKit Windows installer (all-in-one / one-click)
# Compatible with Windows PowerShell 2.0+
# Run via Install-PrintKit.bat, NSIS exe, or:
#   powershell -ExecutionPolicy Bypass -File Install-PrintKit.ps1
param(
  [switch]$NoPause,
  [switch]$FromOneClick
)

$ErrorActionPreference = 'Stop'

# Resolve setup root (PSScriptRoot is PS 3+)
$SetupRoot = $null
if ($MyInvocation.MyCommand.Path) {
  $SetupRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
  $SetupRoot = (Get-Location).Path
}

$AppSource = Join-Path $SetupRoot 'app'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'PrintKit'
$NativeHostName = 'com.printkit.host'
$ExtId = 'memmopnlapcegennpipheiadaonehljd'
$InstallLog = Join-Path $env:TEMP 'PrintKit-install.log'

function Get-Utf8NoBomEncoding {
  return (New-Object System.Text.UTF8Encoding $false)
}

function Write-InstallLog([string]$Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  try {
    Add-Content -Path $InstallLog -Value $line -ErrorAction SilentlyContinue
  } catch {}
  Write-Host $Message
}

function Write-InstallWarn([string]$Message) {
  Write-InstallLog "WARN: $Message"
}

function New-NativeHostManifestJson([string]$LauncherPath, [string]$HostName, [string]$ExtensionId) {
  $escapedPath = $LauncherPath.Replace('\', '\\').Replace('"', '\"')
  $json = "{`r`n"
  $json += "  `"name`": `"$HostName`",`r`n"
  $json += "  `"description`": `"PrintKit Native Messaging Host`",`r`n"
  $json += "  `"path`": `"$escapedPath`",`r`n"
  $json += "  `"type`": `"stdio`",`r`n"
  $json += "  `"allowed_origins`": [`r`n"
  $json += "    `"chrome-extension://$ExtensionId/`"`r`n"
  $json += "  ]`r`n"
  $json += "}`r`n"
  return $json
}

function Invoke-RobocopyInstall([string]$Source, [string]$Target) {
  # IMPORTANT: do not use $args (reserved automatic variable in PowerShell)
  $roboArgs = @(
    $Source, $Target,
    '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np',
    '/R:2', '/W:2'
  )
  Write-InstallLog ("robocopy " + ($roboArgs -join ' '))
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & robocopy.exe @roboArgs | Out-Null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  Write-InstallLog "robocopy exit code: $code"
  # robocopy: 0-7 = success/partial, >=8 = failure
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

function Register-NativeHost([string]$RegPath, [string]$ManifestPath) {
  if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
  }
  New-ItemProperty -Path $RegPath -Name '(default)' -Value $ManifestPath -PropertyType String -Force | Out-Null
  Write-InstallLog "Registered: $RegPath"
}

function Copy-TextToClipboard([string]$Text) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Clipboard]::SetText($Text)
    return $true
  } catch {
    return $false
  }
}

try {
  Set-Content -Path $InstallLog -Value "PrintKit Windows install log"
  Write-InstallLog "Setup root: $SetupRoot"
  Write-InstallLog "Install folder: $InstallRoot"
  Write-InstallLog "FromOneClick=$FromOneClick NoPause=$NoPause PSVersion=$($PSVersionTable.PSVersion)"

  Write-Host '========================================'
  Write-Host ' PrintKit One-Click Setup'
  Write-Host '========================================'
  Write-Host "Install folder: $InstallRoot"
  Write-Host "Install log: $InstallLog"
  Write-Host ''

  if (-not (Test-Path (Join-Path $AppSource 'host\host.js'))) {
    throw 'Missing app\host\host.js. Extract the full PrintKit-Setup-windows ZIP, or use PrintKit-Setup-windows.exe from GitHub Releases (not WeChat).'
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
  $utf8 = Get-Utf8NoBomEncoding

  if (-not (Test-Path $NodeExe)) {
    throw 'Bundled Node runtime not found in this package.'
  }
  if (-not (Test-Path $HostJs)) {
    throw 'host\host.js missing after copy.'
  }

  $hostBin = Join-Path $InstallRoot 'host\bin'
  New-Item -ItemType Directory -Force -Path $hostBin | Out-Null
  if (Test-Path $PdfHelper) {
    Copy-Item -Path $PdfHelper -Destination (Join-Path $hostBin 'PDFtoPrinter.exe') -Force
  }

  $launcherContent = "@echo off`r`n`"$NodeExe`" `"$HostJs`" %*`r`n"
  [System.IO.File]::WriteAllText($Launcher, $launcherContent, [System.Text.Encoding]::ASCII)

  $manifestJson = New-NativeHostManifestJson -LauncherPath $Launcher -HostName $NativeHostName -ExtensionId $ExtId
  [System.IO.File]::WriteAllText($ManifestPath, $manifestJson, $utf8)

  Register-NativeHost "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName" $ManifestPath
  Register-NativeHost "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$NativeHostName" $ManifestPath
  Register-NativeHost "HKCU:\Software\Chromium\NativeMessagingHosts\$NativeHostName" $ManifestPath

  Write-InstallLog 'Self-check (native host)...'
  try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $pingOut = & $NodeExe $HostJs --cli ping 2>&1 | Out-String
    $pingCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Write-InstallLog $pingOut.Trim()
    if ($pingCode -ne 0) {
      Write-InstallWarn "Self-check returned exit code $pingCode (files installed; can retry later)."
    }
  } catch {
    Write-InstallWarn "Self-check failed: $($_.Exception.Message)"
  }

  $ExtDir = Join-Path $InstallRoot 'extension'
  [System.IO.File]::WriteAllText(
    (Join-Path $InstallRoot 'EXTENSION_PATH.txt'),
    $ExtDir,
    $utf8
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

  if (Copy-TextToClipboard $ExtDir) {
    Write-InstallLog 'Extension path copied to clipboard.'
  } else {
    Write-InstallWarn 'Could not copy path to clipboard.'
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
    try { [void][System.Console]::ReadKey($true) } catch {}
  }
  exit 0
} catch {
  $msg = $_.Exception.Message
  Write-InstallLog "ERROR: $msg"
  Write-Host ''
  Write-Host "Install failed: $msg"
  Write-Host "See log: $InstallLog"
  Write-Host ''
  Write-Host 'Tips:'
  Write-Host '1) Download from GitHub Releases (do NOT use WeChat file transfer).'
  Write-Host '2) Copy installer to C:\PrintKit-Setup then run.'
  Write-Host '3) Prefer ZIP: extract and run Install-PrintKit.bat.'
  Write-Host '4) Close Chrome/Edge, delete %LOCALAPPDATA%\PrintKit, retry.'
  if (-not $NoPause) {
    Write-Host 'Press any key to exit...'
    try { [void][System.Console]::ReadKey($true) } catch {}
  }
  exit 1
}
