# Register the C++ host for Chrome on Windows (per-user, no admin).
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-win.ps1 [-Bin path\to\printkit-host.exe]
param(
  [string]$Bin = ""
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Bin) { $Bin = Join-Path $Here "build\printkit-host.exe" }
if (-not (Test-Path $Bin)) {
  Write-Error "host binary not found: $Bin  (build with Qt5 + qtwebkit first)"
}

$Manifest = Join-Path $Here "com.printkit.host.json"
(Get-Content (Join-Path $Here "com.printkit.host.json.template") -Raw) `
  -replace "__HOST_PATH__", ($Bin -replace "\\", "\\\\") |
  Set-Content -Encoding UTF8 $Manifest

$Key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.printkit.host"
New-Item -Path $Key -Force | Out-Null
Set-ItemProperty -Path $Key -Name "(default)" -Value $Manifest

Write-Host "registered: $Key -> $Manifest"
& $Bin --cli ping
