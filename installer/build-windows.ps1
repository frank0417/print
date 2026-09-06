# Build PrintKit Windows setup package (Win7-compatible Node 12).
# Output: dist/PrintKit-Setup-windows.zip  (+ .exe if makensis is available)
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Installer = Join-Path $Root 'installer'
$Dist = Join-Path $Root 'dist'
$Cache = if ($env:PRINTKIT_CACHE) { $env:PRINTKIT_CACHE } else { Join-Path $Dist '.cache' }
$WinNode = if ($env:PRINTKIT_WIN_NODE_VERSION) { $env:PRINTKIT_WIN_NODE_VERSION } else { '12.22.12' }
$Version = '0.5.29'
$Name = 'PrintKit-Setup-windows'
$Stage = Join-Path $Dist ".stage\$Name"
$ZipOut = Join-Path $Dist "$Name.zip"
$Artifacts = if ($env:PRINTKIT_ARTIFACTS) { $env:PRINTKIT_ARTIFACTS } else { Join-Path $Dist 'artifacts' }

function Log([string]$msg) { Write-Host "[build] $msg" }

function Download([string]$Url, [string]$Out) {
  if ((Test-Path $Out) -and $env:PRINTKIT_FORCE_DOWNLOAD -ne '1') {
    Log "cache hit: $Out"
    return
  }
  Log "download: $Url"
  $partial = "$Out.partial"
  curl.exe -fsSL --retry 3 --retry-delay 2 -o $partial $Url
  if ($LASTEXITCODE -ne 0) { throw "download failed: $Url" }
  Move-Item -Force $partial $Out
}

function Expand-Zip([string]$Zip, [string]$Dest) {
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  # tar.exe on Win10+ can extract zip
  tar.exe -xf $Zip -C $Dest
  if ($LASTEXITCODE -ne 0) {
    Expand-Archive -Path $Zip -DestinationPath $Dest -Force
  }
}

New-Item -ItemType Directory -Force -Path $Dist, $Cache, $Artifacts | Out-Null
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$App = Join-Path $Stage 'app'
New-Item -ItemType Directory -Force -Path "$App\extension", "$App\host", "$App\bin", "$App\runtime" | Out-Null

Log "copy extension + host (v$Version, Node $WinNode win7)"
Copy-Item -Recurse -Force (Join-Path $Root 'extension\*') "$App\extension\"
Copy-Item -Recurse -Force (Join-Path $Root 'native-host\*') "$App\host\"
Remove-Item -Force -ErrorAction SilentlyContinue `
  "$App\host\printkit-host", "$App\host\printkit-host.cmd", `
  "$App\host\com.printkit.host.json", "$App\host\dev-key.pem"

Copy-Item -Force (Join-Path $Installer 'common\finish.html') "$App\finish.html"

$built = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
@"
PrintKit Setup
version=$Version
node=$WinNode (win7-compatible)
win_node=$WinNode
built=$built
repo=https://github.com/frank0417/print
one-click=yes
"@ | Set-Content -Encoding UTF8 "$App\VERSION.txt"

# Node 12 for Win7
$nodeZip = Join-Path $Cache "node-v$WinNode-win-x64.zip"
Download "https://nodejs.org/dist/v$WinNode/node-v$WinNode-win-x64.zip" $nodeZip
$nodeExtract = Join-Path $Cache 'node-win-extract'
Expand-Zip $nodeZip $nodeExtract
$nodeSrc = Join-Path $nodeExtract "node-v$WinNode-win-x64"
New-Item -ItemType Directory -Force -Path "$App\runtime\node" | Out-Null
Copy-Item -Recurse -Force "$nodeSrc\*" "$App\runtime\node\"

# Helpers
New-Item -ItemType Directory -Force -Path "$App\host\bin", "$App\bin" | Out-Null
$pdfToPrinter = Join-Path $Cache 'PDFtoPrinter.exe'
Download 'https://mendelson.org/PDFtoPrinter.exe' $pdfToPrinter
Copy-Item -Force $pdfToPrinter "$App\bin\PDFtoPrinter.exe"
Copy-Item -Force $pdfToPrinter "$App\host\bin\PDFtoPrinter.exe"

$pdfiumTgz = Join-Path $Cache 'pdfium-win-x64.tgz'
Download 'https://github.com/bblanchon/pdfium-binaries/releases/latest/download/pdfium-win-x64.tgz' $pdfiumTgz
$pdfiumDir = Join-Path $Cache 'pdfium-x64'
if (Test-Path $pdfiumDir) { Remove-Item -Recurse -Force $pdfiumDir }
New-Item -ItemType Directory -Force -Path $pdfiumDir | Out-Null
tar.exe -xzf $pdfiumTgz -C $pdfiumDir
$pdfiumDll = Join-Path $pdfiumDir 'bin\pdfium.dll'
if (Test-Path $pdfiumDll) {
  Copy-Item -Force $pdfiumDll "$App\bin\pdfium.dll"
  Copy-Item -Force $pdfiumDll "$App\host\bin\pdfium.dll"
} else {
  Log 'WARN: pdfium.dll not found in tgz'
}

$sumatraZip = Join-Path $Cache 'SumatraPDF-3.5.2-64.zip'
Download 'https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.zip' $sumatraZip
$sumatraDir = Join-Path $Cache 'sumatra-extract'
Expand-Zip $sumatraZip $sumatraDir
$sumatraExe = Get-ChildItem -Path $sumatraDir -Recurse -Filter 'SumatraPDF*.exe' | Select-Object -First 1
if ($sumatraExe) {
  Copy-Item -Force $sumatraExe.FullName "$App\host\bin\SumatraPDF.exe"
  Copy-Item -Force $sumatraExe.FullName "$App\bin\SumatraPDF.exe"
} else {
  Log 'WARN: SumatraPDF.exe not found in zip'
}

$win = Join-Path $Installer 'win'
@(
  'Install-PrintKit.bat', 'Install-PrintKit-Cmd.bat', 'Install-PrintKit.ps1',
  'Uninstall-PrintKit.ps1', 'Uninstall-PrintKit.bat', 'Update-PrintKit.bat',
  'Open-Extensions.bat', 'Diagnose-PrintKit.bat', 'README.txt'
) | ForEach-Object { Copy-Item -Force (Join-Path $win $_) (Join-Path $Stage $_) }

Copy-Item -Force (Join-Path $win 'Update-PrintKit.bat') "$App\"
Copy-Item -Force (Join-Path $win 'Uninstall-PrintKit.bat') "$App\"
Copy-Item -Force (Join-Path $win 'Uninstall-PrintKit.ps1') "$App\"

Log "zip $ZipOut"
if (Test-Path $ZipOut) { Remove-Item -Force $ZipOut }
# Compress-Archive follows .NET path limits; use tar if available for reliability
Push-Location (Join-Path $Dist '.stage')
try {
  tar.exe -a -cf $ZipOut $Name
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ZipOut)) {
    Compress-Archive -Path $Name -DestinationPath $ZipOut -Force
  }
} finally {
  Pop-Location
}

Copy-Item -Force $ZipOut (Join-Path $Artifacts (Split-Path $ZipOut -Leaf))

$makensis = Get-Command makensis -ErrorAction SilentlyContinue
if ($makensis) {
  $exe = Join-Path $Dist "$Name.exe"
  $nsi = Join-Path $Dist '.stage\PrintKit-Setup.nsi'
  $stageFwd = $Stage -replace '\\', '/'
  $exeFwd = $exe -replace '\\', '/'
  (Get-Content (Join-Path $win 'PrintKit-Setup.nsi') -Raw) `
    -replace '@@SETUP_STAGE@@', $stageFwd `
    -replace '@@OUT_FILE@@', $exeFwd |
    Set-Content -Encoding ASCII $nsi
  Log 'compiling NSIS one-click EXE...'
  & makensis -V2 $nsi
  if (Test-Path $exe) {
    Copy-Item -Force $exe (Join-Path $Artifacts (Split-Path $exe -Leaf))
    Log "wrote $exe"
  }
} else {
  Log 'WARN: makensis not found; ZIP only (Win7 can use Install-PrintKit.bat)'
}

$sha = Get-FileHash -Algorithm SHA256 $ZipOut
$shaLine = "$($sha.Hash.ToLower())  $(Split-Path $ZipOut -Leaf)"
$shaLine | Set-Content -Encoding ASCII (Join-Path $Dist 'SHA256SUMS.txt')
Log $shaLine
Log "done. size=$((Get-Item $ZipOut).Length) bytes"
Get-Item $ZipOut | Format-List FullName, Length, LastWriteTime
Get-Content "$App\VERSION.txt"
