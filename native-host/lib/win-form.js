'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function formName(widthMm, heightMm) {
  return 'PrintKit-' + Math.round(widthMm) + 'x' + Math.round(heightMm);
}

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

const PS1 =
  'param([string]$Printer,[string]$Form,[int]$Wmm,[int]$Hmm)\n' +
  '$ErrorActionPreference = "Stop"\n' +
  'Add-Type -TypeDefinition @"\n' +
  'using System;\n' +
  'using System.Runtime.InteropServices;\n' +
  '[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]\n' +
  'public struct PkSize { public int cx; public int cy; }\n' +
  '[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]\n' +
  'public struct PkRect { public int left; public int top; public int right; public int bottom; }\n' +
  '[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]\n' +
  'public struct PkForm1 {\n' +
  '  public int Flags;\n' +
  '  public string pName;\n' +
  '  public PkSize Size;\n' +
  '  public PkRect ImageableArea;\n' +
  '}\n' +
  'public class PkForm {\n' +
  '  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]\n' +
  '  static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);\n' +
  '  [DllImport("winspool.drv", SetLastError=true)]\n' +
  '  static extern bool ClosePrinter(IntPtr h);\n' +
  '  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]\n' +
  '  static extern bool AddForm(IntPtr h, int level, ref PkForm1 form);\n' +
  '  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]\n' +
  '  static extern bool DeleteForm(IntPtr h, string name);\n' +
  '  public static string Ensure(string printer, string formName, int wMm, int hMm) {\n' +
  '    IntPtr h;\n' +
  '    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "OPEN_FAIL " + Marshal.GetLastWin32Error();\n' +
  '    try {\n' +
  '      int w = wMm * 1000;\n' +
  '      int hh = hMm * 1000;\n' +
  '      PkForm1 f = new PkForm1();\n' +
  '      f.Flags = 0;\n' +
  '      f.pName = formName;\n' +
  '      f.Size.cx = w; f.Size.cy = hh;\n' +
  '      f.ImageableArea.left = 0; f.ImageableArea.top = 0;\n' +
  '      f.ImageableArea.right = w; f.ImageableArea.bottom = hh;\n' +
  '      DeleteForm(h, formName);\n' +
  '      if (!AddForm(h, 1, ref f)) return "ADD_FAIL " + Marshal.GetLastWin32Error();\n' +
  '      return "OK";\n' +
  '    } finally { ClosePrinter(h); }\n' +
  '  }\n' +
  '}\n' +
  '"@\n' +
  '[PkForm]::Ensure($Printer, $Form, $Wmm, $Hmm)\n';

function ensurePinForm(printerName, widthMm, heightMm) {
  if (process.platform !== 'win32' || !printerName) return null;
  const name = formName(widthMm, heightMm);
  const ps1 = path.join(os.tmpdir(), 'printkit-form.ps1');
  fs.writeFileSync(ps1, PS1, 'utf8');
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ps1,
      '-Printer',
      printerName,
      '-Form',
      name,
      '-Wmm',
      String(Math.round(widthMm)),
      '-Hmm',
      String(Math.round(heightMm)),
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 }
  );
  const out = String((r.stdout || '') + (r.stderr || '')).replace(/\s+/g, ' ').trim();
  const ok = /\bOK\b/.test(out);
  logLine('pin form ' + name + ' printer=' + printerName + ' status=' + r.status + ' ' + out.slice(0, 200));
  return ok ? name : null;
}

module.exports = {
  ensurePinForm,
  formName,
};
