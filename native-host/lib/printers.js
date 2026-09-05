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
  const media = settings?.paperName;
  if (media) args.push('-o', `media=${media}`);
  if (Number(settings?.orientation) === 2) args.push('-o', 'landscape');
  if (settings?.duplex) args.push('-o', 'sides=two-sided-long-edge');

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
  const args = ['-silent', '-exit-when-done'];
  if (target) args.push('-print-to', target);
  else args.push('-print-to-default');
  if (copies > 1) args.push('-print-settings', `${copies}x`);
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
  return { printer: target || 'default', method: 'SumatraPDF' };
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

function printPdfWin({ pdfPath, printer, copies, settings }) {
  let target = resolveWinPrinterTarget(printer);
  if (!target) {
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
      target = (d.stdout || '').trim() || null;
    } catch (_) {
      target = null;
    }
  }

  const errors = [];
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
