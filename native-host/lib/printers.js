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
  if (!wanted) return null;
  let printers = [];
  try {
    printers = listPrintersWin();
  } catch (_) {
    return wanted;
  }
  const exact = printers.find((p) => p.name === wanted);
  if (exact) return exact.name;

  // Allow selecting network printers by IP / port text, e.g. 192.168.1.69
  const byPort = printers.find(
    (p) => p.port && (p.port === wanted || p.port.indexOf(wanted) >= 0)
  );
  if (byPort) return byPort.name;

  const byName = printers.find(
    (p) =>
      p.name.toLowerCase().indexOf(wanted.toLowerCase()) >= 0 ||
      (p.description && p.description.toLowerCase().indexOf(wanted.toLowerCase()) >= 0)
  );
  if (byName) return byName.name;

  return wanted;
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
  const media = settings && settings.paperName;
  if (media) args.push('-o', 'media=' + media);
  if (Number(settings && settings.orientation) === 2) args.push('-o', 'landscape');
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
  const pdfToPrinter = path.join(binDir, 'PDFtoPrinter.exe');
  const pdfium = path.join(binDir, 'pdfium.dll');
  // Current mendelson.org PDFtoPrinter.exe is a pdfium wrapper; without
  // pdfium.dll it crashes with 0xC0000135 and an empty error string.
  if (fs.existsSync(pdfToPrinter) && fs.existsSync(pdfium)) {
    helpers.push({ kind: 'PDFtoPrinter', path: pdfToPrinter });
  }
  for (const name of ['SumatraPDF.exe', 'SumatraPDF-32.exe']) {
    const full = path.join(binDir, name);
    if (fs.existsSync(full)) helpers.push({ kind: 'SumatraPDF', path: full });
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

function printWithSumatra(helper, pdfPath, target, copies) {
  // noscale avoids blurry stretch-to-fit on Windows drivers
  const printSettings = [];
  if (copies > 1) printSettings.push(String(copies) + 'x');
  printSettings.push('noscale');
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
    // Fallback: allow shrink if noscale is rejected by some drivers
    const args2 = ['-silent', '-exit-when-done'];
    if (target) args2.push('-print-to', target);
    else args2.push('-print-to-default');
    const settings2 = [];
    if (copies > 1) settings2.push(String(copies) + 'x');
    settings2.push('shrink');
    args2.push('-print-settings', settings2.join(','));
    args2.push(pdfPath);
    const r2 = spawnSync(helper, args2, {
      encoding: 'utf8',
      windowsHide: true,
      cwd: path.dirname(helper),
      timeout: 120000,
    });
    if (r2.status !== 0) {
      throw new Error(`SumatraPDF 打印失败: ${spawnDetail(r2) || spawnDetail(r) || '无输出'}`);
    }
    return { printer: target || 'default', method: 'SumatraPDF-shrink' };
  }
  return { printer: target || 'default', method: 'SumatraPDF-noscale' };
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
 * Print via Chrome/Edge kiosk-printing.
 * Uses the printer driver directly (vector/text stays sharp), unlike Sumatra's bitmap path.
 */
function printWithChromeKiosk(filePath, target, copies) {
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
        '--enable-font-antialiasing',
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
      // Chrome may return non-zero even after successful print; only fail if it clearly crashed early
      if (r.error) {
        throw new Error('Chrome 打印启动失败: ' + r.error.message);
      }
    }
    return {
      printer: target || prevDefault || 'default',
      method: 'Chrome-kiosk-printing',
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
  let target = resolveWinPrinterTarget(printer);
  if (!target) {
    target = getDefaultPrinterNameWin();
  }

  const errors = [];
  const htmlPath =
    (settings && settings.htmlPath) ||
    (pdfPath ? pdfPath.replace(/\.pdf$/i, '.html') : null);

  // 1) Prefer Chrome kiosk print of HTML (sharpest on Win7)
  if (htmlPath && fs.existsSync(htmlPath)) {
    try {
      return printWithChromeKiosk(htmlPath, target, copies);
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  // 2) Chrome kiosk print of PDF (still better than Sumatra bitmap)
  try {
    return printWithChromeKiosk(pdfPath, target, copies);
  } catch (err) {
    errors.push(err.message || String(err));
  }

  // 3) Legacy helpers
  for (const helper of listWinPrintHelpers()) {
    try {
      if (helper.kind === 'PDFtoPrinter') {
        return printWithPdfToPrinter(helper.path, pdfPath, target, copies);
      }
      if (helper.kind === 'SumatraPDF') {
        return printWithSumatra(helper.path, pdfPath, target, copies);
      }
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  try {
    return printWithShellVerb(pdfPath, target, copies);
  } catch (err) {
    errors.push(err.message || String(err));
  }

  throw new Error(errors.filter(Boolean).join(' | ') || 'Windows 打印失败');
}

module.exports = {
  listPrinters,
  getDefaultPrinter,
  printPdf,
  which,
  listWinPrintHelpers,
  resolveWinPrinterTarget,
};
