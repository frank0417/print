/** Paper presets in millimeters (width x height, portrait), plus pin-feed sheets. */
export const PAPER_PRESETS = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  B4: { width: 250, height: 353 },
  B5: { width: 176, height: 250 },
  Letter: { width: 216, height: 279 },
  Legal: { width: 216, height: 356 },
  Tabloid: { width: 279, height: 432 },
  // 针式连续纸：宽 9.5"（含孔）× 走纸方向一张的长度
  Pin2: { width: 241, height: 140 },
  Pin3: { width: 241, height: 93 },
  PinFull: { width: 241, height: 279 },
};

const PIN_SHEET_ALIASES = {
  Pin2: 'Pin2',
  Pin3: 'Pin3',
  PinFull: 'PinFull',
  二等分: 'Pin2',
  '2等分': 'Pin2',
  三联二等分: 'Pin2',
  三等分: 'Pin3',
  '3等分': 'Pin3',
  全页: 'PinFull',
  整页: 'PinFull',
};

export function normalizePinSheetName(name) {
  if (name == null || name === '') return null;
  return PIN_SHEET_ALIASES[String(name).trim()] || null;
}

export function isPinSheetName(name) {
  return !!normalizePinSheetName(name);
}

/**
 * Pin / dot-matrix printer by name. Mirror of native-host/lib/printer-kind.js
 * PIN_NAME_RE (the host additionally probes the driver, so an unknown brand
 * still prints right; here it only drives the preview defaults/overlay).
 */
const PIN_NAME_RE = new RegExp(
  [
    '针式', '平推', '票据打印', '滚筒',
    '\\bLQ[- ]?\\d', '\\bLX[- ]?\\d', '\\bFX[- ]?\\d', 'DLQ', 'EPSON\\s*(LQ|LX|FX)',
    '\\bOKI\\b', 'MICROLINE', '\\bML\\d{3,4}\\b', 'KX-P\\d',
    'STAR\\s*(NX|AR|CR|BP|LC)[- ]?\\d', 'CITIZEN\\s*(GSX|PRODOT|SWIFT)',
    'TALLY', 'PRINTRONIX', 'GENICOM', 'DOT[\\s-]?MATRIX', 'IMPACT',
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

export function isPinPrinter(name) {
  const s = String(name || '');
  if (!s) return false;
  if (NOT_PIN_RE.test(s) && !/针式|平推/.test(s)) return false;
  return PIN_NAME_RE.test(s);
}

/** Match a mm box to 9.5" pin-feed 二等分 / 三等分 / 全页. */
export function matchPinSheet(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!w || !h) return null;
  const wide = Math.max(w, h);
  const short = Math.min(w, h);
  if (Math.abs(wide - 241) > 8) return null;
  if (Math.abs(short - 140) <= 8) return 'Pin2';
  if (Math.abs(short - 93) <= 8) return 'Pin3';
  if (Math.abs(short - 279) <= 10) return 'PinFull';
  return null;
}

/**
 * Side zones of 9.5" fanfold a pin printer physically cannot reach, in mm
 * from the sheet edge: the head homes ~13mm in from the paper edge and an
 * 80-column carriage covers 8" (203.2mm); 136-column covers 13.6".
 */
export function pinUnprintable(printerName, sheetWidthMm = 241) {
  // 136-column carriages: Epson LQ-1xxx/2xxx, Jolimark FP-8400/8800, Dascom DS-2600/5400…
  const wide = /LQ[- ]?[12]\d{3}|FP[- ]?8[48]00|DS[- ]?(2600|5400|7860)|1600|1900|136|宽行|宽幅|宽行/i.test(
    String(printerName || '')
  );
  const left = 13;
  const printable = wide ? 345.4 : 203.2;
  const right = Math.max(12.7, Math.round((Number(sheetWidthMm) - left - printable) * 10) / 10);
  return { left, right, strip: 12.7 };
}

export function resolvePaper(settings = {}) {
  const pinName = normalizePinSheetName(settings.paperName || settings.paper);
  const name = pinName || settings.paperName || settings.paper || 'A4';
  const preset = PAPER_PRESETS[name] || PAPER_PRESETS.A4;
  let width = Number(settings.pageWidth || settings.width || preset.width);
  let height = Number(settings.pageHeight || settings.height || preset.height);

  let orientation = Number(settings.orientation || 1) === 2 ? 2 : 1;
  const lock =
    settings.lockPageBox === true ||
    settings.lockPageBox === 1 ||
    settings.lockPageBox === 'true' ||
    !!pinName;

  if (pinName) {
    width = preset.width;
    height = preset.height;
    orientation = 2;
  }

  if (!lock) {
    if (orientation === 2 && width < height) {
      [width, height] = [height, width];
    } else if (orientation === 1 && width > height) {
      [width, height] = [height, width];
    }
  }

  return {
    paperName: PAPER_PRESETS[name] ? name : 'Custom',
    widthMm: width,
    heightMm: height,
    orientation,
  };
}

export function mmToCss(mm) {
  return `${Number(mm)}mm`;
}

export function normalizeMargins(settings = {}) {
  // Default 0mm — label/waybill printers blur badly with 10mm + fit-to-page.
  const n = (v, fallback = 0) => {
    if (v === 0 || v === '0') return 0;
    const num = Number(v);
    return Number.isFinite(num) ? num : fallback;
  };
  return {
    top: n(settings.marginTop ?? settings.topMargin, 0),
    right: n(settings.marginRight ?? settings.rightMargin, 0),
    bottom: n(settings.marginBottom ?? settings.bottomMargin, 0),
    left: n(settings.marginLeft ?? settings.leftMargin, 0),
  };
}
