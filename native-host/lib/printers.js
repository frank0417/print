'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function which(cmds) {
  for (const cmd of cmds) {
    try {
      const r =
        process.platform === 'win32'
          ? spawnSync('where', [cmd], { encoding: 'utf8' })
          : spawnSync('which', [cmd], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) {
        return r.stdout.trim().split(/\r?\n/)[0];
      }
    } catch (_) {
      /* continue */
    }
  }
  return null;
}

async function listPrinters() {
  if (process.platform === 'darwin') return listPrintersMac();
  if (process.platform === 'win32') return listPrintersWin();
  return listPrintersLinux();
}

async function getDefaultPrinter() {
  const printers = await listPrinters();
  return printers.find((p) => p.isDefault) || printers[0] || null;
}

function listPrintersMac() {
  const printers = [];
  let defaultName = null;
  try {
    const def = spawnSync('lpstat', ['-d'], { encoding: 'utf8' });
    const m = /system default destination:\s*(.+)$/m.exec(def.stdout || '');
    if (m) defaultName = m[1].trim();
  } catch (_) {
    /* ignore */
  }

  const r = spawnSync('lpstat', ['-a'], { encoding: 'utf8' });
  if (r.status !== 0) {
    // fallback
    const r2 = spawnSync('lpstat', ['-p'], { encoding: 'utf8' });
    const lines = (r2.stdout || '').split(/\r?\n/);
    for (const line of lines) {
      const m = /^printer\s+(\S+)/i.exec(line);
      if (m) {
        printers.push({
          name: m[1],
          id: m[1],
          isDefault: m[1] === defaultName,
          source: 'cups',
        });
      }
    }
    return printers;
  }

  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const name = line.trim().split(/\s+/)[0];
    if (!name) continue;
    printers.push({
      name,
      id: name,
      isDefault: name === defaultName,
      source: 'cups',
    });
  }
  return printers;
}

function parseWinPrinterLines(raw) {
  const printers = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.indexOf('|') < 0) continue;
    const parts = text.split('|');
    if (parts.length < 4) continue;
    const name = (parts[0] || '').trim();
    if (!name || name.toLowerCase() === 'name') continue;
    const driver = (parts[1] || '').trim();
    const port = (parts[2] || '').trim();
    const isDefault = /^(true|1|yes)$/i.test((parts[3] || '').trim());
    printers.push({
      name,
      id: name,
      description: driver,
      port,
      isDefault,
      source: 'windows',
    });
  }
  return printers;
}

function listPrintersWinWmic() {
  // Very old Windows fallback. Output is UTF-16LE on many systems.
  const r = spawnSync(
    'wmic',
    [
      'printer',
      'get',
      'Name,DriverName,PortName,Default',
      '/format:csv',
    ],
    { encoding: 'buffer', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`wmic 列举打印机失败: ${(r.stderr || r.stdout || Buffer.alloc(0)).toString('utf8').trim()}`);
  }
  let text = '';
  try {
    text = r.stdout.toString('utf16le');
    if (text.indexOf('\u0000') >= 0 || !/Name/.test(text)) {
      text = r.stdout.toString('utf8');
    }
  } catch (_) {
    text = Buffer.from(r.stdout || []).toString('utf8');
  }
  const printers = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(',').map((c) => c.trim());
    // CSV: Node,Default,DriverName,Name,PortName  (order can vary)
    if (cols.length < 4) continue;
    if (/^Node$/i.test(cols[0]) || /Name/i.test(cols.join(',')) && /DriverName/i.test(cols.join(',')) && cols[0] === 'Node') {
      // header row — detect indexes once
      continue;
    }
  }
  // Parse with header awareness
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const idxName = header.indexOf('name');
  const idxDriver = header.indexOf('drivername');
  const idxPort = header.indexOf('portname');
  const idxDefault = header.indexOf('default');
  if (idxName < 0) {
    // Fallback: assume Name is near the end
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      if (cols.length < 2) continue;
      const name = cols[cols.length - 2] ? cols[cols.length - 2].trim() : '';
      const port = cols[cols.length - 1] ? cols[cols.length - 1].trim() : '';
      if (!name || /^name$/i.test(name)) continue;
      printers.push({
        name,
        id: name,
        description: '',
        port,
        isDefault: false,
        source: 'windows-wmic',
      });
    }
    return printers;
  }
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const name = (cols[idxName] || '').trim();
    if (!name) continue;
    printers.push({
      name,
      id: name,
      description: idxDriver >= 0 ? (cols[idxDriver] || '').trim() : '',
      port: idxPort >= 0 ? (cols[idxPort] || '').trim() : '',
      isDefault: idxDefault >= 0 ? /TRUE/i.test(cols[idxDefault] || '') : false,
      source: 'windows-wmic',
    });
  }
  return printers;
}

function listPrintersWin() {
  // PowerShell 2.0 compatible: avoid Get-CimInstance / ConvertTo-Json.
  // Emit pipe-delimited rows so Node can parse without JSON.
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
function Get-PrintKitPrinters {
  try { return @(Get-WmiObject -Class Win32_Printer) } catch {}
  try { return @(Get-CimInstance -ClassName Win32_Printer) } catch {}
  return @()
}
$list = Get-PrintKitPrinters
foreach ($p in $list) {
  $name = [string]$p.Name
  if ([string]::IsNullOrEmpty($name)) { continue }
  $driver = [string]$p.DriverName
  $port = [string]$p.PortName
  $def = 'false'
  if ($p.Default) { $def = 'true' }
  Write-Output ($name + '|' + $driver + '|' + $port + '|' + $def)
}
`;

  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
  );

  let printers = [];
  if (r.status === 0) {
    printers = parseWinPrinterLines(r.stdout);
  }

  if (!printers.length) {
    try {
      printers = listPrintersWinWmic();
    } catch (err) {
      const detail = ((r.stderr || r.stdout || '') + ' | ' + (err.message || String(err))).trim();
      throw new Error(`列举打印机失败: ${detail}`);
    }
  }

  if (!printers.some((p) => p.isDefault) && printers.length) {
    printers[0].isDefault = true;
  }
  return printers;
}

function resolveWinPrinterTarget(printer) {
  const wanted = String(printer || '').trim();
  return wanted || null;
}

function listPrintersLinux() {
  // Optional Linux support via CUPS (bonus; primary targets are Win/Mac)
  return listPrintersMac();
}

async function printPdf({ pdfPath, printer, copies, settings }) {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    throw new Error('PDF 文件不存在');
  }
  if (process.platform === 'darwin') {
    return printPdfMac({ pdfPath, printer, copies, settings });
  }
  if (process.platform === 'win32') {
    return printPdfWin({ pdfPath, printer, copies, settings });
  }
  return printPdfMac({ pdfPath, printer, copies, settings });
}

function printPdfMac({ pdfPath, printer, copies, settings }) {
  const args = [];
  let target = printer;
  if (!target) {
    const def = spawnSync('lpstat', ['-d'], { encoding: 'utf8' });
    const m = /system default destination:\s*(.+)$/m.exec(def.stdout || '');
    target = m ? m[1].trim() : null;
  }
  if (target) args.push('-d', target);
  if (copies > 1) args.push('-n', String(copies));

  // Paper / orientation hints when possible
  const paperName = settings && settings.paperName;
  if (paperName) args.push('-o', 'media=' + paperName);
  try {
    const paper = require('./html-to-pdf').resolvePaper(settings || {});
    const media = require('./html-to-pdf').printerMedia(paper);
    if (media.landscape) args.push('-o', 'landscape');
  } catch (_) {
    if (Number(settings && settings.orientation) === 2) args.push('-o', 'landscape');
  }
  if (settings && settings.duplex) args.push('-o', 'sides=two-sided-long-edge');

  args.push(pdfPath);
  const r = spawnSync('lp', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`macOS 打印失败: ${(r.stderr || r.stdout || 'lp error').trim()}`);
  }
  return { printer: target || 'default', method: 'lp', stdout: (r.stdout || '').trim() };
}

function winBinDir() {
  return path.join(__dirname, '..', 'bin');
}

function spawnDetail(r) {
  const status =
    r.status == null ? '' : `exit ${r.status} (0x${(r.status >>> 0).toString(16)})`;
  return [r.error && r.error.message, (r.stderr || '').trim(), (r.stdout || '').trim(), status]
    .filter(Boolean)
    .join(' · ');
}

function listWinPrintHelpers() {
  const binDir = winBinDir();
  const helpers = [];
  for (const name of ['SumatraPDF.exe', 'SumatraPDF-32.exe']) {
    const full = path.join(binDir, name);
    if (fs.existsSync(full)) helpers.push({ kind: 'SumatraPDF', path: full });
  }
  const pdfToPrinter = path.join(binDir, 'PDFtoPrinter.exe');
  const pdfium = path.join(binDir, 'pdfium.dll');
  // Current mendelson.org PDFtoPrinter.exe is a pdfium wrapper; without
  // pdfium.dll it crashes with 0xC0000135 and an empty error string.
  if (fs.existsSync(pdfToPrinter) && fs.existsSync(pdfium)) {
    helpers.push({ kind: 'PDFtoPrinter', path: pdfToPrinter });
  }
  return helpers;
}

function printWithPdfToPrinter(helper, pdfPath, target, copies) {
  for (let i = 0; i < copies; i++) {
    const args = [pdfPath];
    if (target) args.push(target);
    const r = spawnSync(helper, args, {
      encoding: 'utf8',
      windowsHide: true,
      cwd: path.dirname(helper),
    });
    if (r.status !== 0) {
      throw new Error(`PDFtoPrinter 失败: ${spawnDetail(r) || '无输出'}`);
    }
  }
  return { printer: target || 'default', method: 'PDFtoPrinter' };
}

function printWithSumatra(helper, pdfPath, target, copies, settings) {
  const htmlToPdf = require('./html-to-pdf');
  const paper = htmlToPdf.resolvePaper(settings || {});
  const pdfBox = htmlToPdf.readPdfPageSize(pdfPath);
  const previewWide = htmlToPdf.isWideBox(paper.width, paper.height);
  const pin = htmlToPdf.isPinPrinter(target) || htmlToPdf.isPinSettings(settings);
  // Laser: 100% noscale (fit-to-page is the usual blur cause).
  // Pin / 80-col: A4-landscape 297mm will not fit ~210mm printable width.
  // noscale then left-aligns → 不居中、右边切掉. shrink scales down and centers.
  // monochrome avoids gray ClearType edges that look like 重影 on pins.
  const printSettings = [];
  if (copies > 1) printSettings.push(String(copies) + 'x');
  printSettings.push('noscale');
  const userLand =
    Number(paper.orientation) === 2 ||
    Number(settings && settings.orientation) === 2;
  let landscape = userLand || previewWide;
  // Pin: only noscale+landscape actually comes out of the EPSON LQ.
  // paper= custom form and monochrome are dropped by the driver (queue
  // empty, no page). Do not send them.
  if (pin) landscape = true;
  printSettings.push(landscape ? 'landscape' : 'portrait');

  try {
    fs.appendFileSync(
      path.join(require('os').tmpdir(), 'printkit-host.log'),
      '[' +
        new Date().toISOString() +
        '] Sumatra preview=' +
        paper.width +
        'x' +
        paper.height +
        'mm pdf=' +
        (pdfBox
          ? pdfBox.widthMm.toFixed(1) + 'x' + pdfBox.heightMm.toFixed(1) + 'mm'
          : '?') +
        ' printer=' +
        (landscape ? 'landscape' : 'portrait') +
        (pin ? ' pin=1' : '') +
        ' margin=' +
        paper.margins.top +
        '/' +
        paper.margins.right +
        '/' +
        paper.margins.bottom +
        '/' +
        paper.margins.left +
        ' settings=' +
        printSettings.join(',') +
        '\n'
    );
  } catch (_) {
    /* ignore */
  }

  const args = ['-silent', '-exit-when-done'];
  if (target) args.push('-print-to', target);
  else args.push('-print-to-default');
  args.push('-print-settings', printSettings.join(','));
  args.push(pdfPath);
  const r = spawnSync(helper, args, {
    encoding: 'utf8',
    windowsHide: true,
    cwd: path.dirname(helper),
    timeout: 120000,
  });
  if (r.status !== 0) {
    throw new Error(`SumatraPDF 打印失败: ${spawnDetail(r) || '无输出'}`);
  }
  return {
    printer: target || 'default',
    method: 'SumatraPDF-noscale-' + (landscape ? 'landscape' : 'portrait') + (pin ? '-pin100' : ''),
  };
}

function printWithShellVerb(pdfPath, target, copies) {
  const script = `
$ErrorActionPreference = 'Stop'
$pdf = '${pdfPath.replace(/'/g, "''")}'
$printer = '${(target || '').replace(/'/g, "''")}'
$copies = ${copies}
for ($i = 0; $i -lt $copies; $i++) {
  if ([string]::IsNullOrWhiteSpace($printer)) {
    Start-Process -FilePath $pdf -Verb Print -WindowStyle Hidden -Wait
  } else {
    try {
      Start-Process -FilePath $pdf -Verb PrintTo -ArgumentList $printer -WindowStyle Hidden -Wait
    } catch {
      Start-Process -FilePath $pdf -Verb Print -WindowStyle Hidden -Wait
    }
  }
}
`;
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 }
  );
  if (r.status !== 0) {
    throw new Error(`Windows 打印失败: ${spawnDetail(r) || '无输出'}`);
  }
  return { printer: target || 'default', method: 'PrintTo/Print verb' };
}

function getDefaultPrinterNameWin() {
  try {
    const d = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "(Get-WmiObject -Query \"SELECT * FROM Win32_Printer WHERE Default=$true\").Name",
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    return (d.stdout || '').trim() || null;
  } catch (_) {
    return null;
  }
}

function setDefaultPrinterWin(printerName) {
  if (!printerName) return false;
  const name = String(printerName).replace(/"/g, '');
  // PrintUI works on Windows 7+
  const r = spawnSync(
    'rundll32',
    ['printui.dll,PrintUIEntry', '/y', '/n', name],
    { encoding: 'utf8', windowsHide: true }
  );
  if (r.status === 0) return true;
  const ps = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "$p=Get-WmiObject -Query \"SELECT * FROM Win32_Printer WHERE Name='" +
        name.replace(/'/g, "''") +
        "'\"; if($p){$p.SetDefaultPrinter()}",
    ],
    { encoding: 'utf8', windowsHide: true }
  );
  return ps.status === 0;
}

function toFileUrl(filePath) {
  const abs = path.resolve(filePath);
  if (process.platform === 'win32') {
    return 'file:///' + abs.replace(/\\/g, '/');
  }
  return 'file://' + abs;
}

/**
 * Chrome --kiosk-printing only auto-accepts the print dialog when window.print()
 * runs. Opening a bare HTML/PDF file does nothing useful, so inject print-on-load.
 */
function prepareKioskPrintFile(filePath) {
  const abs = path.resolve(filePath);
  const ext = path.extname(abs).toLowerCase();
  const dir = path.dirname(abs);
  const outPath = path.join(dir, 'job-kiosk-print.html');

  if (ext === '.html' || ext === '.htm') {
    let html = fs.readFileSync(abs, 'utf8');
    const inject =
      '<script>(function(){function go(){try{window.focus();window.print();}catch(e){}' +
      'setTimeout(function(){try{window.close();}catch(e){}},1500);}' +
      'if(document.readyState==="complete")setTimeout(go,400);' +
      'else window.addEventListener("load",function(){setTimeout(go,400);});})();</script>';
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, inject + '</body>');
    } else {
      html = html + inject;
    }
    fs.writeFileSync(outPath, html, 'utf8');
    return outPath;
  }

  // PDF: wrap in a minimal HTML that opens the PDF and prints (best-effort).
  const pdfUrl = toFileUrl(abs).replace(/"/g, '%22');
  const wrap =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>PrintKit</title>' +
    '<style>html,body{margin:0;height:100%;}embed{width:100%;height:100%;border:0;}</style></head><body>' +
    '<embed src="' +
    pdfUrl +
    '" type="application/pdf" />' +
    '<script>(function(){function go(){try{window.focus();window.print();}catch(e){}' +
    'setTimeout(function(){try{window.close();}catch(e){}},2000);}' +
    'setTimeout(go,1200);})();</script></body></html>';
  fs.writeFileSync(outPath, wrap, 'utf8');
  return outPath;
}

/**
 * Force Chrome silent print to 100% scale (not "fit to page").
 * Fit-to-page is the #1 blur cause on continuous-form / pin printers.
 */
function seedChromePrintProfile(profileDir, opts) {
  opts = opts || {};
  const defDir = path.join(profileDir, 'Default');
  try {
    fs.mkdirSync(defDir, { recursive: true });
  } catch (_) {
    /* ignore */
  }
  const paper = opts.paper || {};
  const widthMm = Number(paper.width) || Number(opts.pageWidth) || 210;
  const heightMm = Number(paper.height) || Number(opts.pageHeight) || 297;
  const wMicrons = Math.round(widthMm * 1000);
  const hMicrons = Math.round(heightMm * 1000);
  const printerName = opts.printer || '';

  const appState = {
    version: 2,
    isHeaderFooterEnabled: false,
    isCssBackgroundEnabled: true,
    marginsType: 1, // NO_MARGINS
    scalingType: 3, // CUSTOM → use scaling %
    scaling: '100',
    // Do NOT infer landscape from width>height. Custom tickets are already
    // a wide mm box; landscape=true would rotate them to portrait on pin printers.
    isLandscapeEnabled: !!opts.landscape,
    mediaSize: {
      height_microns: hMicrons,
      width_microns: wMicrons,
      name: 'CUSTOM',
      custom_display_name: String(widthMm) + 'x' + String(heightMm) + 'mm',
    },
  };
  if (printerName) {
    appState.selectedDestinationId = printerName;
    appState.recentDestinations = [
      { id: printerName, origin: 'local', account: '' },
    ];
  }

  const prefs = {
    printing: {
      print_preview_sticky_settings: {
        appState: JSON.stringify(appState),
      },
    },
    browser: {
      has_seen_welcome_page: true,
      check_default_browser: false,
    },
    profile: {
      exit_type: 'Normal',
      exited_cleanly: true,
    },
  };
  fs.writeFileSync(path.join(defDir, 'Preferences'), JSON.stringify(prefs));
  try {
    fs.writeFileSync(path.join(profileDir, 'First Run'), '');
  } catch (_) {
    /* ignore */
  }
}

/**
 * Rewrite @page size so IE/Chrome honor portrait vs landscape.
 * Returns a temp HTML path (does not mutate the original job file).
 */
function materializeOrientedHtml(htmlPath, settings) {
  const paper = require('./html-to-pdf').resolvePaper(settings || {});
  const abs = path.resolve(htmlPath);
  const outPath = path.join(
    path.dirname(abs),
    'job-orient-' + (paper.orientation === 2 ? 'land' : 'port') + '.html'
  );
  let html = fs.readFileSync(abs, 'utf8');
  const media = require('./html-to-pdf').printerMedia(paper);
  const css =
    '<style id="printkit-orientation-fix">' +
    '@page{size:' +
    paper.width +
    'mm ' +
    paper.height +
    'mm;margin:' +
    paper.margins.top +
    'mm ' +
    paper.margins.right +
    'mm ' +
    paper.margins.bottom +
    'mm ' +
    paper.margins.left +
    'mm;}' +
    'html,body{margin:0;padding:0;background:#fff;}' +
    /* Pin printers: antialiased gray edges become broken dots ("点状不连续"). */
    'html,body,table,td,th,div,span,p,font,input,textarea{' +
    '-webkit-font-smoothing:none!important;font-smooth:never!important;' +
    'text-rendering:optimizeSpeed!important;text-shadow:none!important;}' +
    '@media print{' +
    '*{-webkit-font-smoothing:none!important;font-smooth:never!important;' +
    'text-shadow:none!important;}' +
    'body,table,td,th,div,span,p,font{color:#000!important;}' +
    '}' +
    '</style>';
  if (/id="printkit-orientation-fix"/.test(html)) {
    html = html.replace(
      /<style id="printkit-orientation-fix">[\s\S]*?<\/style>/i,
      css
    );
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, css + '</head>');
  } else {
    html = css + html;
  }
  fs.writeFileSync(outPath, html, 'utf8');
  return {
    htmlPath: outPath,
    paper: paper,
    landscape: media.landscape,
    media: media,
  };
}

/**
 * IE/WebBrowser COM print — same path classic Chinese print plugins use on Win7.
 * Sends GDI to the pin-printer driver (sharp text/lines), not a scaled bitmap.
 */
function printWithIeCom(htmlPath, target, copies, settings) {
  const prevDefault = getDefaultPrinterNameWin();
  let changed = false;
  if (target && prevDefault && target !== prevDefault) {
    changed = setDefaultPrinterWin(target);
  } else if (target && !prevDefault) {
    changed = setDefaultPrinterWin(target);
  }

  const oriented = materializeOrientedHtml(htmlPath, settings || {});
  const abs = path.resolve(oriented.htmlPath).replace(/'/g, "''");
  const n = Math.max(1, copies || 1);
  const land = oriented.landscape ? '$true' : '$false';
  const paperW = Number(oriented.paper && oriented.paper.width) || 210;
  const paperH = Number(oriented.paper && oriented.paper.height) || 297;
  // PowerShell 2.0 compatible (Win7).
  // Disable ClearType/font smoothing so GDI glyphs stay solid on pin printers,
  // then restore. Zero IE page margins for continuous forms.
  const script =
    "$ErrorActionPreference='Stop';" +
    "$smoothWas=1;" +
    "try{" +
    "$spi=Add-Type -PassThru -Name PkSpi" +
    String(Date.now() % 100000) +
    " -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"user32.dll\")] public static extern bool SystemParametersInfo(uint a,uint b,System.IntPtr c,uint d); [System.Runtime.InteropServices.DllImport(\"user32.dll\")] public static extern bool SystemParametersInfo(uint a,uint b,ref int c,uint d);';" +
    "$tmp=1; $spi::SystemParametersInfo(0x4A,0,[ref]$tmp,0)|Out-Null; $smoothWas=$tmp;" +
    "$spi::SystemParametersInfo(0x4B,0,[IntPtr]::Zero,3)|Out-Null;" +
    "}catch{};" +
    "New-Item -Path 'HKCU:\\Software\\Microsoft\\Internet Explorer\\PageSetup' -Force | Out-Null;" +
    "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Internet Explorer\\PageSetup' -Name margin_left -Value '0.000000' -Force;" +
    "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Internet Explorer\\PageSetup' -Name margin_right -Value '0.000000' -Force;" +
    "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Internet Explorer\\PageSetup' -Name margin_top -Value '0.000000' -Force;" +
    "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Internet Explorer\\PageSetup' -Name margin_bottom -Value '0.000000' -Force;" +
    "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Internet Explorer\\PageSetup' -Name header -Value '' -Force;" +
    "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Internet Explorer\\PageSetup' -Name footer -Value '' -Force;" +
    "try{Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue;" +
    "$pd=New-Object System.Drawing.Printing.PrintDocument;" +
    "if(-not [string]::IsNullOrEmpty($PrinterName))$pd.PrinterSettings.PrinterName=$PrinterName;" +
    "$pd.DefaultPageSettings.Landscape=" +
    land +
    ';' +
    'try{$w=[int][math]::Round(' +
    String(paperW) +
    '/25.4*100);$h=[int][math]::Round(' +
    String(paperH) +
    '/25.4*100);' +
    '$sz=New-Object System.Drawing.Printing.PaperSize("PrintKit",$w,$h);$sz.RawKind=256;' +
    '$pd.DefaultPageSettings.PaperSize=$sz;}catch{};' +
    '}catch{};' +
    "$html='" +
    abs +
    "';" +
    "$uri=(New-Object System.Uri ((Resolve-Path -LiteralPath $html).Path)).AbsoluteUri;" +
    "$copies=" +
    String(n) +
    ';' +
    'try{for($c=0;$c -lt $copies;$c++){' +
    "$ie=New-Object -ComObject InternetExplorer.Application;" +
    '$ie.Visible=$false;' +
    '$ie.Navigate($uri);' +
    'while($ie.Busy -or $ie.ReadyState -ne 4){Start-Sleep -Milliseconds 200};' +
    'Start-Sleep -Milliseconds 800;' +
    '$ie.ExecWB(6,2);' +
    'Start-Sleep -Seconds 4;' +
    '$ie.Quit();' +
    '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ie)|Out-Null;' +
    '}} finally {' +
    'try{if($spi -and $smoothWas -ne 0){$spi::SystemParametersInfo(0x4B,1,[IntPtr]::Zero,3)|Out-Null}}catch{}' +
    '}';

  try {
    const r = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "$PrinterName='" + String(target || '').replace(/'/g, "''") + "';" + script,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 180000 }
    );
    if (r.status !== 0) {
      throw new Error('IE 打印失败: ' + spawnDetail(r));
    }
    return {
      printer: target || prevDefault || 'default',
      method: 'IE-COM-GDI-' + (oriented.landscape ? 'landscape' : 'portrait') + '-crisp',
    };
  } finally {
    if (changed && prevDefault) {
      try {
        setDefaultPrinterWin(prevDefault);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/**
 * Print via Chrome/Edge kiosk-printing at forced 100% scale.
 * Uses the printer driver directly (vector/text stays sharp), unlike Sumatra's bitmap path.
 */
function printWithChromeKiosk(filePath, target, copies, settings) {
  const chrome = require('./html-to-pdf').resolveChromePath();
  if (!chrome || !fs.existsSync(chrome)) {
    throw new Error('未找到 Chrome/Edge，无法高清打印');
  }
  const prevDefault = getDefaultPrinterNameWin();
  let changed = false;
  if (target && prevDefault && target !== prevDefault) {
    changed = setDefaultPrinterWin(target);
  } else if (target && !prevDefault) {
    changed = setDefaultPrinterWin(target);
  }

  const profileDir = path.join(
    require('os').tmpdir(),
    'printkit-chrome-print-' + String(process.pid) + '-' + String(Date.now())
  );
  try {
    fs.mkdirSync(profileDir, { recursive: true });
  } catch (_) {
    /* ignore */
  }

  const paper = require('./html-to-pdf').resolvePaper(settings || {});
  const media = require('./html-to-pdf').printerMedia(paper);
  seedChromePrintProfile(profileDir, {
    printer: target || prevDefault || '',
    paper: { width: media.widthMm, height: media.heightMm },
    pageWidth: media.widthMm,
    pageHeight: media.heightMm,
    landscape: media.landscape,
  });

  const printFile = prepareKioskPrintFile(filePath);
  const url = toFileUrl(printFile);
  const n = Math.max(1, copies || 1);
  try {
    for (let i = 0; i < n; i++) {
      const args = [
        '--kiosk-printing',
        '--disable-print-preview',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-popup-blocking',
        '--disable-session-crashed-bubble',
        '--disable-infobars',
        '--allow-file-access-from-files',
        '--font-render-hinting=none',
        '--force-device-scale-factor=1',
        '--user-data-dir=' + profileDir,
        '--new-window',
        url,
      ];
      const r = spawnSync(chrome, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 5 * 1024 * 1024,
      });
      if (r.error) {
        throw new Error('Chrome 打印启动失败: ' + r.error.message);
      }
    }
    return {
      printer: target || prevDefault || 'default',
      method:
        'Chrome-kiosk-100pct-' + (media.landscape ? 'landscape' : 'portrait'),
    };
  } finally {
    if (changed && prevDefault) {
      try {
        setDefaultPrinterWin(prevDefault);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

function printPdfWin({ pdfPath, printer, copies, settings }) {
  // Use the name from the preview dropdown as-is. Do not WMI-enumerate
  // printers here — that alone costs several seconds per job.
  const target = resolveWinPrinterTarget(printer);
  const errors = [];

  try {
    fs.appendFileSync(
      path.join(require('os').tmpdir(), 'printkit-host.log'),
      '[' +
        new Date().toISOString() +
        '] printPdfWin silent printer=' +
        String(target || '(default)') +
        '\n'
    );
  } catch (_) {
    /* ignore */
  }

  // Default path for every Windows printer: GDI direct (pdfium → printer DC),
  // the same pipeline Chrome itself uses. Vectors reach the driver, so pins
  // print like Notepad/TXT and lasers stay exact at 100%. Paper is matched
  // against what the driver actually offers (any brand); pin kind adds the
  // fanfold layout (Letter = 2×二等分, no rotation, head-home offset).
  // Sumatra (bitmap) remains the fallback / opt-in (printMode: 'sumatra').
  const htmlToPdf = require('./html-to-pdf');
  const s = require('./printer-kind').applyPrinterKind(Object.assign({}, settings || {}));
  const pin = htmlToPdf.isPinSettings(s);
  const mode = String(s.printMode || (s.gdi === false || s.gdi === 'false' ? 'sumatra' : 'gdi'));
  if (mode !== 'sumatra') {
    try {
      return require('./win-gdi-print').printPdfGdi({
        pdfPath,
        printer: target,
        copies,
        fanfold: pin,
        leftEdgeMm: s.pinLeftEdgeMm,
        resolution: s.pinResolution,
      });
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  // Silent helpers only. Chrome kiosk / IE / PrintTo verb open extra windows
  // and the system print dialog — preview already is the only UI we want.
  for (const helper of listWinPrintHelpers()) {
    try {
      if (helper.kind === 'SumatraPDF') {
        return printWithSumatra(helper.path, pdfPath, target, copies, settings);
      }
      if (helper.kind === 'PDFtoPrinter') {
        return printWithPdfToPrinter(helper.path, pdfPath, target, copies);
      }
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  throw new Error(
    errors.filter(Boolean).join(' | ') ||
      '未找到静默打印组件（SumatraPDF）。请重新安装 PrintKit。'
  );
}

module.exports = {
  listPrinters,
  getDefaultPrinter,
  printPdf,
  which,
  listWinPrintHelpers,
  resolveWinPrinterTarget,
};
