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

function listPrintersWin() {
  const script = `
$ErrorActionPreference = 'Stop'
try {
  Get-Printer | Select-Object Name, DriverName, PortName, Shared, Type |
    ConvertTo-Json -Compress
} catch {
  # Fallback WMI
  Get-WmiObject -Class Win32_Printer | Select-Object Name, DriverName, PortName, Shared |
    ConvertTo-Json -Compress
}
`;
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`列举打印机失败: ${(r.stderr || r.stdout || '').trim()}`);
  }

  let defaultName = null;
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
    defaultName = (d.stdout || '').trim() || null;
  } catch (_) {
    /* ignore */
  }

  const raw = (r.stdout || '').trim();
  if (!raw) return [];
  let data = JSON.parse(raw);
  if (!Array.isArray(data)) data = [data];
  return data
    .filter((p) => p && p.Name)
    .map((p) => ({
      name: p.Name,
      id: p.Name,
      description: p.DriverName || '',
      port: p.PortName || '',
      isDefault: p.Name === defaultName,
      source: 'windows',
    }));
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

function findWinPrintHelper() {
  const binDir = path.join(__dirname, '..', 'bin');
  const candidates = [
    path.join(binDir, 'PDFtoPrinter.exe'),
    path.join(binDir, 'SumatraPDF.exe'),
    path.join(binDir, 'SumatraPDF-32.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function printPdfWin({ pdfPath, printer, copies, settings }) {
  const helper = findWinPrintHelper();
  let target = printer;
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

  if (helper && /PDFtoPrinter\.exe$/i.test(helper)) {
    // https://www.columbia.edu/~em36/pdftoprinter.html
    // PDFtoPrinter.exe file.pdf "Printer Name"
    for (let i = 0; i < copies; i++) {
      const args = [pdfPath];
      if (target) args.push(target);
      const r = spawnSync(helper, args, { encoding: 'utf8', windowsHide: true });
      if (r.status !== 0) {
        throw new Error(`PDFtoPrinter 失败: ${(r.stderr || r.stdout || '').trim()}`);
      }
    }
    return { printer: target || 'default', method: 'PDFtoPrinter' };
  }

  if (helper && /SumatraPDF/i.test(helper)) {
    const args = ['-print-to', target || 'default', '-silent', '-exit-when-done'];
    if (copies > 1) args.push('-print-settings', `${copies}x`);
    args.push(pdfPath);
    const r = spawnSync(helper, args, { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) {
      throw new Error(`SumatraPDF 打印失败: ${(r.stderr || r.stdout || '').trim()}`);
    }
    return { printer: target || 'default', method: 'SumatraPDF' };
  }

  // Fallback: PrintTo verb (may briefly flash depending on PDF association)
  const script = `
$ErrorActionPreference = 'Stop'
$pdf = '${pdfPath.replace(/'/g, "''")}'
$printer = '${(target || '').replace(/'/g, "''")}'
$copies = ${copies}
for ($i = 0; $i -lt $copies; $i++) {
  if ([string]::IsNullOrWhiteSpace($printer)) {
    Start-Process -FilePath $pdf -Verb Print -WindowStyle Hidden -Wait
  } else {
    # PrintTo is available for many PDF handlers
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
    throw new Error(
      `Windows 打印失败（建议将 PDFtoPrinter.exe 放到 native-host/bin/）: ${(r.stderr || r.stdout || '').trim()}`
    );
  }
  return { printer: target || 'default', method: 'PrintTo/Print verb' };
}

module.exports = {
  listPrinters,
  getDefaultPrinter,
  printPdf,
  which,
};
