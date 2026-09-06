'use strict';

/**
 * Windows GDI print path: pdfium draws the PDF straight onto the printer DC
 * (text as mono glyph masks, rules as GDI paths). The driver rasterizes at
 * its own resolution, which is what Notepad/TXT printing does — no
 * antialiased bitmap for the pin driver to dither into fuzz.
 *
 * Fanfold handling: the in-box "Epson ESC/P V4 Class Driver" only knows
 * Letter/A4 (custom sizes silently become Letter). Letter 279.4mm is exactly
 * two 二等分 (139.7) or three 三等分 (93.1) sheets, so we keep the driver on
 * Letter portrait, never rotate, and stack tickets down the page.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function logLine(msg) {
  try {
    fs.appendFileSync(
      path.join(os.tmpdir(), 'printkit-host.log'),
      '[' + new Date().toISOString() + '] ' + msg + '\n'
    );
  } catch (_) {
    /* ignore */
  }
}

function findPdfium() {
  const candidates = [
    path.join(__dirname, '..', 'bin', 'pdfium.dll'),
    path.join(__dirname, '..', '..', 'bin', 'pdfium.dll'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const PS1 = String.raw`param(
  [string]$Pdf,
  [string]$Printer = '',
  [int]$Copies = 1,
  [string]$Pdfium,
  [int]$Fanfold = 0,
  [double]$LeftEdgeMm = 13,
  [string]$OutFile = '',
  [string]$Resolution = ''
)
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 8) { Write-Output 'ERR 64-bit PowerShell required'; exit 3 }
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PkPdf {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr LoadLibraryW(string path);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr hdc, int index);
  [DllImport("pdfium.dll")] public static extern void FPDF_InitLibrary();
  [DllImport("pdfium.dll")] public static extern void FPDF_DestroyLibrary();
  [DllImport("pdfium.dll")] public static extern IntPtr FPDF_LoadMemDocument(IntPtr data, int size, IntPtr password);
  [DllImport("pdfium.dll")] public static extern void FPDF_CloseDocument(IntPtr doc);
  [DllImport("pdfium.dll")] public static extern int FPDF_GetPageCount(IntPtr doc);
  [DllImport("pdfium.dll")] public static extern IntPtr FPDF_LoadPage(IntPtr doc, int index);
  [DllImport("pdfium.dll")] public static extern void FPDF_ClosePage(IntPtr page);
  [DllImport("pdfium.dll")] public static extern double FPDF_GetPageWidth(IntPtr page);
  [DllImport("pdfium.dll")] public static extern double FPDF_GetPageHeight(IntPtr page);
  [DllImport("pdfium.dll")] public static extern void FPDF_RenderPage(IntPtr dc, IntPtr page, int x, int y, int w, int h, int rotate, int flags);
  [DllImport("pdfium.dll")] public static extern uint FPDF_GetLastError();
}
"@

$hLib = [PkPdf]::LoadLibraryW($Pdfium)
if ($hLib -eq [IntPtr]::Zero) {
  Write-Output ('ERR LoadLibrary pdfium ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  exit 3
}
[PkPdf]::FPDF_InitLibrary()
$bytes = [IO.File]::ReadAllBytes($Pdf)
$gch = [Runtime.InteropServices.GCHandle]::Alloc($bytes, [Runtime.InteropServices.GCHandleType]::Pinned)
$doc = [PkPdf]::FPDF_LoadMemDocument($gch.AddrOfPinnedObject(), $bytes.Length, [IntPtr]::Zero)
if ($doc -eq [IntPtr]::Zero) { Write-Output ('ERR load pdf ' + [PkPdf]::FPDF_GetLastError()); exit 4 }
$pageCount = [PkPdf]::FPDF_GetPageCount($doc)
if ($pageCount -lt 1) { Write-Output 'ERR empty pdf'; exit 4 }
$p0 = [PkPdf]::FPDF_LoadPage($doc, 0)
$sheetWmm = [PkPdf]::FPDF_GetPageWidth($p0) * 25.4 / 72.0
$sheetHmm = [PkPdf]::FPDF_GetPageHeight($p0) * 25.4 / 72.0
[PkPdf]::FPDF_ClosePage($p0)

$pd = New-Object System.Drawing.Printing.PrintDocument
if (-not [string]::IsNullOrEmpty($Printer)) { $pd.PrinterSettings.PrinterName = $Printer }
if (-not $pd.PrinterSettings.IsValid) { Write-Output ('ERR printer invalid: ' + $Printer); exit 5 }
$pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$pd.DocumentName = 'PrintKit ' + [IO.Path]::GetFileNameWithoutExtension($Pdf)
$pd.OriginAtMargins = $false
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$pd.DefaultPageSettings.Landscape = $false
if (-not [string]::IsNullOrEmpty($OutFile)) {
  $pd.PrinterSettings.PrintToFile = $true
  $pd.PrinterSettings.PrintFileName = $OutFile
}
if (-not [string]::IsNullOrEmpty($Resolution)) {
  $parts = $Resolution.Split('x')
  foreach ($r in $pd.PrinterSettings.PrinterResolutions) {
    if ($r.X -eq [int]$parts[0] -and $r.Y -eq [int]$parts[1]) { $pd.DefaultPageSettings.PrinterResolution = $r }
  }
}

function PkPhysical($pd) {
  $g = $pd.PrinterSettings.CreateMeasurementGraphics($pd.DefaultPageSettings)
  $hdc = $g.GetHdc()
  $dx = [PkPdf]::GetDeviceCaps($hdc, 88); $dy = [PkPdf]::GetDeviceCaps($hdc, 90)
  $pw = [PkPdf]::GetDeviceCaps($hdc, 110); $ph = [PkPdf]::GetDeviceCaps($hdc, 111)
  $ox = [PkPdf]::GetDeviceCaps($hdc, 112); $oy = [PkPdf]::GetDeviceCaps($hdc, 113)
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  if ($dx -le 0) { $dx = 180 }
  if ($dy -le 0) { $dy = 180 }
  return @{
    Wmm = $pw / $dx * 25.4; Hmm = $ph / $dy * 25.4;
    OffXmm = $ox / $dx * 25.4; OffYmm = $oy / $dy * 25.4;
    DpiX = $dx; DpiY = $dy
  }
}
function PkClose($a, $b, $tol) { return ([math]::Abs($a - $b) -le $tol) }
function PkMatches($pd, $w, $h) {
  $phys = PkPhysical $pd
  return ((PkClose $phys.Wmm $w 3) -and (PkClose $phys.Hmm $h 3))
}

# 1) driver-listed paper equal to the sheet, either way round (official pin
#    drivers list user forms; lasers list A4/A5/...; landscape via the driver).
$exact = $false
$chosen = $null
foreach ($ps in $pd.PrinterSettings.PaperSizes) {
  $pw = $ps.Width * 0.254; $ph = $ps.Height * 0.254
  if ((PkClose $pw $sheetWmm 3) -and (PkClose $ph $sheetHmm 3)) {
    $pd.DefaultPageSettings.Landscape = $false
    $pd.DefaultPageSettings.PaperSize = $ps
    if (PkMatches $pd $sheetWmm $sheetHmm) { $chosen = $ps; $exact = $true; break }
  }
  if ((PkClose $pw $sheetHmm 3) -and (PkClose $ph $sheetWmm 3)) {
    $pd.DefaultPageSettings.Landscape = $true
    $pd.DefaultPageSettings.PaperSize = $ps
    if (PkMatches $pd $sheetWmm $sheetHmm) { $chosen = $ps; $exact = $true; break }
    $pd.DefaultPageSettings.Landscape = $false
  }
}
# 2) DEVMODE custom size (label / receipt / official pin drivers accept it)
if (-not $exact) {
  $pd.DefaultPageSettings.Landscape = $false
  $custom = New-Object System.Drawing.Printing.PaperSize('PrintKit', [int][math]::Round($sheetWmm / 0.254), [int][math]::Round($sheetHmm / 0.254))
  $custom.RawKind = 256
  $pd.DefaultPageSettings.PaperSize = $custom
  if (PkMatches $pd $sheetWmm $sheetHmm) { $exact = $true; $chosen = $custom }
}
# 3) fallback to a stock paper
if (-not $exact) {
  $best = $null; $bestN = 0; $bestLand = $false
  if ($Fanfold -eq 1) {
    # fanfold: a paper whose length is a whole number of sheets (Letter = 2x140 / 3x93), portrait
    foreach ($ps in $pd.PrinterSettings.PaperSizes) {
      $hmm = $ps.Height * 0.254
      $n = [math]::Round($hmm / $sheetHmm)
      if ($n -lt 1) { continue }
      if (PkClose $hmm ($n * $sheetHmm) 4) {
        if ($best -eq $null -or $n -lt $bestN) { $best = $ps; $bestN = $n }
      }
    }
  } else {
    # page printers: smallest stock paper that contains the sheet, rotating if needed
    $bestArea = 0
    foreach ($ps in $pd.PrinterSettings.PaperSizes) {
      $pw = $ps.Width * 0.254; $ph = $ps.Height * 0.254
      $area = $pw * $ph
      if ($pw + 1 -ge $sheetWmm -and $ph + 1 -ge $sheetHmm) {
        if ($best -eq $null -or $area -lt $bestArea) { $best = $ps; $bestArea = $area; $bestLand = $false }
      } elseif ($ph + 1 -ge $sheetWmm -and $pw + 1 -ge $sheetHmm) {
        if ($best -eq $null -or $area -lt $bestArea) { $best = $ps; $bestArea = $area; $bestLand = $true }
      }
    }
  }
  if ($best -eq $null) {
    foreach ($ps in $pd.PrinterSettings.PaperSizes) {
      $hmm = $ps.Height * 0.254
      if ($hmm + 1 -ge $sheetHmm) { if ($best -eq $null -or $hmm -lt ($best.Height * 0.254)) { $best = $ps } }
    }
  }
  $pd.DefaultPageSettings.Landscape = $bestLand
  if ($best -ne $null) { $pd.DefaultPageSettings.PaperSize = $best; $chosen = $best }
}
$phys = PkPhysical $pd

$dpiX = $phys.DpiX; $dpiY = $phys.DpiY
$wPx = [int][math]::Round($sheetWmm / 25.4 * $dpiX)
$hPx = [int][math]::Round($sheetHmm / 25.4 * $dpiY)
# Fanfold on a stock paper: sheets stacked down the page (Letter holds two 二等分).
$perPage = 1
if ($Fanfold -eq 1 -and -not $exact) {
  $perPage = [int][math]::Floor(($phys.Hmm + 2) / $sheetHmm)
  if ($perPage -lt 1) { $perPage = 1 }
}
# X: sheet edge = page edge, except fanfold on a stock paper: the driver's
# page edge is fake there; the tractor strip puts the head home ~LeftEdgeMm
# in from the real paper edge, so the sheet's x=0 sits that far left of it.
$edgeMm = $phys.OffXmm
if ($Fanfold -eq 1 -and -not $exact) { $edgeMm = [math]::Max($phys.OffXmm, $LeftEdgeMm) }
$pxX = -[int][math]::Round($edgeMm / 25.4 * $dpiX)
$pxY0 = -[int][math]::Round($phys.OffYmm / 25.4 * $dpiY)
# FPDF_PRINTING | FPDF_ANNOT; pins also drop smoothing so any raster stays 1-bit.
$flags = 0x800 -bor 0x1
if ($Fanfold -eq 1) { $flags = $flags -bor 0x1000 -bor 0x2000 -bor 0x4000 }

$slots = New-Object System.Collections.ArrayList
for ($c = 0; $c -lt [math]::Max(1, $Copies); $c++) {
  for ($p = 0; $p -lt $pageCount; $p++) { [void]$slots.Add($p) }
}
$state = @{ idx = 0 }
$onPage = {
  param($sender, $e)
  $g = $e.Graphics
  $hdc = $g.GetHdc()
  try {
    for ($k = 0; $k -lt $perPage -and $state.idx -lt $slots.Count; $k++) {
      $pg = [PkPdf]::FPDF_LoadPage($doc, [int]$slots[$state.idx])
      if ($pg -ne [IntPtr]::Zero) {
        [PkPdf]::FPDF_RenderPage($hdc, $pg, $pxX, ($pxY0 + $k * $hPx), $wPx, $hPx, 0, $flags)
        [PkPdf]::FPDF_ClosePage($pg)
      }
      $state.idx = $state.idx + 1
    }
  } finally {
    $g.ReleaseHdc($hdc)
  }
  $e.HasMorePages = ($state.idx -lt $slots.Count)
}
$pd.add_PrintPage($onPage)
try {
  $pd.Print()
} finally {
  [PkPdf]::FPDF_CloseDocument($doc)
  $gch.Free()
  [PkPdf]::FPDF_DestroyLibrary()
}
$paperName = ''
if ($chosen -ne $null) { $paperName = $chosen.PaperName }
Write-Output ('OK paper=' + $paperName + ' exact=' + $exact + ' landscape=' + $pd.DefaultPageSettings.Landscape + ' fanfold=' + $Fanfold + ' phys=' + [math]::Round($phys.Wmm, 1) + 'x' + [math]::Round($phys.Hmm, 1) + 'mm sheet=' + [math]::Round($sheetWmm, 1) + 'x' + [math]::Round($sheetHmm, 1) + 'mm perPage=' + $perPage + ' slots=' + $slots.Count + ' dpi=' + $dpiX + 'x' + $dpiY + ' origin=' + $pxX + ',' + $pxY0 + 'px')
`;

function scriptPath() {
  const p = path.join(os.tmpdir(), 'printkit-gdi-print.ps1');
  // Rewrite each time so host upgrades never run a stale script.
  fs.writeFileSync(p, '\ufeff' + PS1, 'utf8');
  return p;
}

/**
 * @param {object} o
 * @param {string} o.pdfPath
 * @param {string} [o.printer]
 * @param {number} [o.copies]
 * @param {boolean} [o.fanfold]     pin printer on continuous paper (stacking + head-home offset)
 * @param {number} [o.leftEdgeMm]   head-home distance from the fanfold paper edge (default 13)
 * @param {string} [o.resolution]   e.g. '360x180' to override the driver default
 * @param {string} [o.outFile]      PrintToFile target (testing with XPS/PDF writers)
 */
function printPdfGdi(o) {
  const pdfium = findPdfium();
  if (!pdfium) throw new Error('缺少 pdfium.dll，无法 GDI 直打');
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath(),
    '-Pdf',
    o.pdfPath,
    '-Printer',
    String(o.printer || ''),
    '-Copies',
    String(Math.max(1, Number(o.copies) || 1)),
    '-Pdfium',
    pdfium,
    '-Fanfold',
    o.fanfold ? '1' : '0',
    '-LeftEdgeMm',
    String(Number.isFinite(Number(o.leftEdgeMm)) ? Number(o.leftEdgeMm) : 13),
  ];
  if (o.outFile) args.push('-OutFile', o.outFile);
  if (o.resolution) args.push('-Resolution', String(o.resolution));

  const r = spawnSync('powershell.exe', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const out = String((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  const okLine = /^OK .*$/m.exec(out);
  logLine('gdi print printer=' + (o.printer || '(default)') + ' status=' + r.status + ' ' + out.replace(/\s+/g, ' ').slice(0, 400));
  if (r.status !== 0 || !okLine) {
    throw new Error('GDI 直打失败: ' + (out.replace(/\s+/g, ' ').slice(0, 300) || ('exit ' + r.status)));
  }
  return { printer: o.printer || 'default', method: 'GDI-pdfium ' + okLine[0].slice(3) };
}

module.exports = { printPdfGdi, findPdfium };
