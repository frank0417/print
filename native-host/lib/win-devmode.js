'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function backupPath(printer) {
  const safe = String(printer || 'default').replace(/[<>:"/\\|?*]/g, '_');
  return path.join(os.tmpdir(), 'printkit-devmode-' + safe + '.bin');
}

function scriptPath() {
  return path.join(os.tmpdir(), 'printkit-devmode.ps1');
}

const PS1 =
  'param([string]$Action,[string]$Printer,[string]$Bak,[int]$W,[int]$H)\n' +
  '$ErrorActionPreference = "Stop"\n' +
  'Add-Type -TypeDefinition @"\n' +
  'using System;\n' +
  'using System.IO;\n' +
  'using System.Runtime.InteropServices;\n' +
  'public class PkPaper {\n' +
  '  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]\n' +
  '  static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);\n' +
  '  [DllImport("winspool.drv", SetLastError=true)]\n' +
  '  static extern bool ClosePrinter(IntPtr h);\n' +
  '  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]\n' +
  '  static extern int DocumentProperties(IntPtr hwnd, IntPtr hPrn, string n, IntPtr dmOut, IntPtr dmIn, int mode);\n' +
  '  [DllImport("winspool.drv", SetLastError=true)]\n' +
  '  static extern bool SetPrinter(IntPtr h, int level, IntPtr pInfo, int cmd);\n' +
  '  const int DM_OUT_BUFFER=2, DM_IN_BUFFER=8;\n' +
  '  const int DM_ORIENTATION=1, DM_PAPERSIZE=2, DM_PAPERLENGTH=4, DM_PAPERWIDTH=8, DM_SCALE=16;\n' +
  '  public static string Apply(string printer, string bak, short wTenthMm, short hTenthMm) {\n' +
  '    IntPtr h;\n' +
  '    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "OPEN_FAIL";\n' +
  '    try {\n' +
  '      int sz = DocumentProperties(IntPtr.Zero, h, printer, IntPtr.Zero, IntPtr.Zero, 0);\n' +
  '      if (sz <= 0) return "SIZE_FAIL";\n' +
  '      IntPtr dm = Marshal.AllocHGlobal(sz);\n' +
  '      try {\n' +
  '        if (DocumentProperties(IntPtr.Zero, h, printer, dm, IntPtr.Zero, DM_OUT_BUFFER) < 0) return "GET_FAIL";\n' +
  '        byte[] raw = new byte[sz];\n' +
  '        Marshal.Copy(dm, raw, 0, sz);\n' +
  '        File.WriteAllBytes(bak, raw);\n' +
  '        int fields = Marshal.ReadInt32(dm, 72);\n' +
  '        fields |= DM_ORIENTATION | DM_PAPERSIZE | DM_PAPERLENGTH | DM_PAPERWIDTH | DM_SCALE;\n' +
  '        Marshal.WriteInt32(dm, 72, fields);\n' +
  '        Marshal.WriteInt16(dm, 76, 1);\n' +
  '        Marshal.WriteInt16(dm, 78, 256);\n' +
  '        Marshal.WriteInt16(dm, 80, hTenthMm);\n' +
  '        Marshal.WriteInt16(dm, 82, wTenthMm);\n' +
  '        Marshal.WriteInt16(dm, 84, 100);\n' +
  '        if (DocumentProperties(IntPtr.Zero, h, printer, dm, dm, DM_IN_BUFFER | DM_OUT_BUFFER) < 0) return "MERGE_FAIL";\n' +
  '        IntPtr pi9 = Marshal.AllocHGlobal(IntPtr.Size);\n' +
  '        try {\n' +
  '          Marshal.WriteIntPtr(pi9, dm);\n' +
  '          if (!SetPrinter(h, 9, pi9, 0)) return "SET_FAIL " + Marshal.GetLastWin32Error();\n' +
  '        } finally { Marshal.FreeHGlobal(pi9); }\n' +
  '        return "OK";\n' +
  '      } finally { Marshal.FreeHGlobal(dm); }\n' +
  '    } finally { ClosePrinter(h); }\n' +
  '  }\n' +
  '  public static string Restore(string printer, string bak) {\n' +
  '    if (!File.Exists(bak)) return "NOBAK";\n' +
  '    byte[] raw = File.ReadAllBytes(bak);\n' +
  '    IntPtr h;\n' +
  '    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "OPEN_FAIL";\n' +
  '    try {\n' +
  '      IntPtr dm = Marshal.AllocHGlobal(raw.Length);\n' +
  '      try {\n' +
  '        Marshal.Copy(raw, 0, dm, raw.Length);\n' +
  '        IntPtr pi9 = Marshal.AllocHGlobal(IntPtr.Size);\n' +
  '        try {\n' +
  '          Marshal.WriteIntPtr(pi9, dm);\n' +
  '          if (!SetPrinter(h, 9, pi9, 0)) return "SET_FAIL";\n' +
  '        } finally { Marshal.FreeHGlobal(pi9); }\n' +
  '        try { File.Delete(bak); } catch {}\n' +
  '        return "OK";\n' +
  '      } finally { Marshal.FreeHGlobal(dm); }\n' +
  '    } finally { ClosePrinter(h); }\n' +
  '  }\n' +
  '}\n' +
  '"@\n' +
  'if ($Action -eq "restore") { [PkPaper]::Restore($Printer, $Bak) }\n' +
  'else { [PkPaper]::Apply($Printer, $Bak, [int16]$W, [int16]$H) }\n';

function logLine(msg) {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'printkit-host.log'), '[' + new Date().toISOString() + '] ' + msg + '\n');
  } catch (_) {
    /* ignore */
  }
}

function runPs1(args) {
  const ps1 = scriptPath();
  fs.writeFileSync(ps1, PS1, 'utf8');
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 }
  );
}

function applyCustomPaperMm(printerName, widthMm, heightMm) {
  if (process.platform !== 'win32' || !printerName) return null;
  const bak = backupPath(printerName);
  const w = Math.max(1, Math.round(Number(widthMm) * 10));
  const h = Math.max(1, Math.round(Number(heightMm) * 10));
  const r = runPs1(['-Action', 'apply', '-Printer', printerName, '-Bak', bak, '-W', String(w), '-H', String(h)]);
  const out = String((r.stdout || '') + (r.stderr || '')).replace(/\s+/g, ' ').trim();
  const ok = /OK/.test(out);
  logLine('devmode apply printer=' + printerName + ' paper=' + widthMm + 'x' + heightMm + 'mm status=' + r.status + ' ' + out.slice(0, 240));
  if (!ok) return null;
  return function restore() {
    restoreCustomPaper(printerName);
  };
}

function restoreCustomPaper(printerName) {
  if (process.platform !== 'win32' || !printerName) return;
  const bak = backupPath(printerName);
  const r = runPs1(['-Action', 'restore', '-Printer', printerName, '-Bak', bak, '-W', '0', '-H', '0']);
  const out = String((r.stdout || '') + (r.stderr || '')).replace(/\s+/g, ' ').trim();
  logLine('devmode restore printer=' + printerName + ' ' + out.slice(0, 160));
}

module.exports = {
  applyCustomPaperMm,
  restoreCustomPaper,
};
