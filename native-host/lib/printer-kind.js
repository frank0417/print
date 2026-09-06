'use strict';

/**
 * Printer classification shared by the PDF builder and the print path.
 *   pin     – impact / dot-matrix on fanfold (针式平推/滚筒)
 *   thermal – receipt / label (热敏小票、标签)
 *   page    – laser / inkjet / virtual PDF
 *
 * Name patterns catch the common brands; the driver probe (max resolution +
 * widest paper) catches everything else, so a printer we have never heard of
 * still gets the right layout. Probe results are cached per printer name.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PIN_NAME_RE = new RegExp(
  [
    '针式', '平推', '票据打印', '滚筒',
    // Epson / OKI / Panasonic / Star / Citizen / line printers
    '\\bLQ[- ]?\\d', '\\bLX[- ]?\\d', '\\bFX[- ]?\\d', 'DLQ', 'EPSON\\s*(LQ|LX|FX)',
    '\\bOKI\\b', 'MICROLINE', '\\bML\\d{3,4}\\b', 'KX-P\\d',
    'STAR\\s*(NX|AR|CR|BP|LC)[- ]?\\d', 'CITIZEN\\s*(GSX|PRODOT|SWIFT)',
    'TALLY', 'PRINTRONIX', 'GENICOM', 'DOT[\\s-]?MATRIX', 'IMPACT',
    // Chinese brands: 映美 / 得实 / 实达 / 富士通 / 中盈 / 南天 / 航天信息 / 联想 / 汇美 / 沈阳新松
    'JOLIMARK', '映美', '\\bFP[- ]?\\d{3}', '\\bBP[- ]?\\d{3}', '\\bCFP[- ]?\\d{3}',
    'DASCOM', '得实', '\\bDS[- ]?\\d{3,4}', '\\bAR[- ]?\\d{3}[A-Z]*\\b',
    '实达', 'START\\s*(BP|NX|AR)', '\\bNX[- ]?\\d{3}',
    'FUJITSU\\s*DPK', '\\bDPK[- ]?\\d', '富士通',
    'ZONEWIN', '中盈', 'NANTIAN', '南天', '\\bPR[29]\\b',
    'AISINO', '航天信息', '\\bSK[- ]?\\d{3}', '\\bTY[- ]?\\d{3}',
    'LENOVO\\s*DP', '联想\\s*DP', '\\bDP[- ]?\\d{3}[A-Z]*\\b',
    '汇美', '新松', '\\bTH[- ]?\\d{3}\\b',
  ].join('|'),
  'i'
);

const NOT_PIN_RE = /LASER|INKJET|DESKJET|OFFICEJET|PIXMA|IMAGECLASS|BROTHER\s*(HL|DCP|MFC)|PDF|XPS|FAX|ONENOTE|SHARP|夏普|KYOCERA|RICOH|激光|喷墨/i;

const VIRTUAL_NAME_RE =
  /PDF|XPS|ONENOTE|FAX|传真|虚拟|VIRTUAL|PRINT\s*TO\s*PDF|文档编写器|WPS\s*PDF|金山/i;
const VIRTUAL_PORT_RE = /PORTPROMPT:|NUL:|FILE:|SHRFAX:|KINGSOFT/i;
const INKJET_RE =
  /INKJET|DESKJET|OFFICEJET|PIXMA|STYLUS|ECOTANK|MAXIFY|\bENVY\b|喷墨|EPSON\s*L\d/i;
const LASER_RE =
  /LASER|LASERJET|IMAGECLASS|激光|KYOCERA|RICOH|\bSHARP\b|夏普|BROTHER\s*HL|MFP\s*11[0-9]/i;

const KIND_LABEL = {
  pin: '针式',
  laser: '激光',
  inkjet: '喷墨',
  virtual: '虚拟',
  thermal: '热敏',
};

function pinByName(name) {
  const s = String(name || '');
  if (!s) return false;
  if (NOT_PIN_RE.test(s) && !/针式|平推/.test(s)) return false;
  return PIN_NAME_RE.test(s);
}

function printKindOf(type) {
  if (type === 'pin') return 'pin';
  if (type === 'thermal') return 'thermal';
  return 'page';
}

function kindLabel(type) {
  return KIND_LABEL[type] || KIND_LABEL.laser;
}

/** Name / driver / port only — no driver probe. null if still unknown. */
function deviceTypeFromText(name, driver, port) {
  const blob = [name, driver, port].filter(Boolean).join(' ');
  if (!blob) return null;
  if (VIRTUAL_PORT_RE.test(String(port || '')) || VIRTUAL_NAME_RE.test(blob)) {
    return 'virtual';
  }
  if (pinByName(name) || pinByName(driver)) return 'pin';
  const laser = LASER_RE.test(blob);
  const inkjet = INKJET_RE.test(blob);
  if (laser && !inkjet) return 'laser';
  if (inkjet && !laser) return 'inkjet';
  if (laser) return 'laser';
  if (inkjet) return 'inkjet';
  return null;
}

function cachePath() {
  return path.join(os.tmpdir(), 'printkit-printer-caps.json');
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(cache), 'utf8');
  } catch (_) {
    /* ignore */
  }
}

const PROBE_PS1 = String.raw`param([string]$Printer = '')
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$ps = New-Object System.Drawing.Printing.PrinterSettings
if (-not [string]::IsNullOrEmpty($Printer)) { $ps.PrinterName = $Printer }
if (-not $ps.IsValid) { Write-Output 'INVALID'; exit 0 }
$maxDpi = 0
foreach ($r in $ps.PrinterResolutions) {
  if ($r.X -gt $maxDpi) { $maxDpi = $r.X }
  if ($r.Y -gt $maxDpi) { $maxDpi = $r.Y }
}
$maxW = 0
$papers = New-Object System.Collections.ArrayList
foreach ($p in $ps.PaperSizes) {
  $w = [math]::Round($p.Width * 0.254, 1); $h = [math]::Round($p.Height * 0.254, 1)
  if ($w -gt $maxW) { $maxW = $w }
  [void]$papers.Add([string]$p.RawKind + ':' + $w + 'x' + $h)
}
Write-Output ('CAPS|' + $ps.PrinterName + '|' + $maxDpi + '|' + $maxW + '|' + ($papers -join ','))
`;

/** Ask the Windows driver for resolutions and paper sizes. null when unknown. */
function probeWinCaps(name) {
  if (process.platform !== 'win32') return null;
  const ps1 = path.join(os.tmpdir(), 'printkit-probe-caps.ps1');
  try {
    fs.writeFileSync(ps1, '\ufeff' + PROBE_PS1, 'utf8');
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Printer', String(name || '')],
      { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 }
    );
    const m = /^CAPS\|(.*?)\|(\d+)\|([\d.]+)\|(.*)$/m.exec(r.stdout || '');
    if (!m) return null;
    return {
      name: m[1],
      maxDpi: Number(m[2]) || 0,
      maxPaperWmm: Number(m[3]) || 0,
      papers: m[4] ? m[4].split(',') : [],
      probedAt: Date.now(),
    };
  } catch (_) {
    return null;
  }
}

function classify(name, caps) {
  const label = String((caps && caps.name) || name || '');
  if (pinByName(label)) return 'pin';
  if (!caps || !(caps.maxDpi > 0)) return 'page';
  const dpi = caps.maxDpi;
  // Impact heads: 120/180/240/360 (24-pin), 216/240 (9-pin). Lasers and
  // IPP/class-driver lasers report 300/600+, receipts/labels 203/300.
  const impactRes = dpi <= 360 && dpi % 300 !== 0 && dpi !== 150;
  if (impactRes) {
    if (NOT_PIN_RE.test(label)) return 'page';
    return caps.maxPaperWmm >= 180 ? 'pin' : 'thermal';
  }
  if (dpi <= 300 && caps.maxPaperWmm > 0 && caps.maxPaperWmm < 120) return 'thermal';
  return 'page';
}

/**
 * Fine-grained device type for the preview dropdown.
 * extra.skipProbe: listing printers must stay fast — guess 激光 if unknown.
 */
function deviceKindInfo(name, extra) {
  extra = extra || {};
  const typed = deviceTypeFromText(name, extra.driver, extra.port);
  if (typed) {
    return {
      type: typed,
      label: kindLabel(typed),
      printKind: printKindOf(typed),
      source: 'name',
      caps: extra.caps || null,
    };
  }
  if (extra.skipProbe || process.platform !== 'win32') {
    return {
      type: 'laser',
      label: kindLabel('laser'),
      printKind: 'page',
      source: extra.skipProbe ? 'guess' : 'unknown',
      caps: extra.caps || null,
    };
  }
  const key = String(name || '') || '(default)';
  const cache = loadCache();
  let caps = cache[key];
  if (!caps || !caps.probedAt) {
    caps = probeWinCaps(name) || { maxDpi: 0, maxPaperWmm: 0, papers: [], probedAt: Date.now(), unknown: true };
    cache[key] = caps;
    saveCache(cache);
  }
  const coarse = classify(key, caps);
  const type = coarse === 'page' ? 'laser' : coarse;
  return {
    type: type,
    label: kindLabel(type),
    printKind: printKindOf(type),
    source: caps.maxDpi > 0 ? 'probe' : 'unknown',
    caps: caps,
  };
}

/**
 * { kind: 'pin' | 'thermal' | 'page', source: 'name' | 'probe' | 'unknown' }
 * for a printer name (empty = system default).
 */
function printerKindInfo(name) {
  const info = deviceKindInfo(name, {});
  return { kind: info.printKind, source: info.source, caps: info.caps, type: info.type, label: info.label };
}

function printerKind(name) {
  return printerKindInfo(name).kind;
}

/** Resolve settings.printerKind once per job (explicit value wins). */
function applyPrinterKind(settings) {
  const s = settings || {};
  if (s.printerKind === 'laser' || s.printerKind === 'inkjet' || s.printerKind === 'virtual') {
    s.printerType = s.printerKind;
    s.printerTypeLabel = kindLabel(s.printerKind);
    s.printerKind = 'page';
    s.printerKindSource = s.printerKindSource || 'explicit';
    return s;
  }
  if (s.printerKind === 'pin' || s.printerKind === 'thermal' || s.printerKind === 'page') {
    s.printerKindSource = s.printerKindSource || 'explicit';
    if (!s.printerType) {
      s.printerType = s.printerKind === 'page' ? 'laser' : s.printerKind;
      s.printerTypeLabel = kindLabel(s.printerType);
    }
    return s;
  }
  try {
    const info = deviceKindInfo(s.printer || s.printerName || '', {});
    s.printerKind = info.printKind;
    s.printerKindSource = info.source;
    s.printerType = info.type;
    s.printerTypeLabel = info.label;
  } catch (_) {
    s.printerKind = pinByName(s.printer || s.printerName) ? 'pin' : 'page';
    s.printerKindSource = 'name';
    s.printerType = s.printerKind === 'pin' ? 'pin' : 'laser';
    s.printerTypeLabel = kindLabel(s.printerType);
  }
  return s;
}

module.exports = {
  pinByName,
  printerKind,
  printerKindInfo,
  deviceKindInfo,
  deviceTypeFromText,
  applyPrinterKind,
  classify,
  probeWinCaps,
  kindLabel,
  KIND_LABEL,
  PIN_NAME_RE,
};
