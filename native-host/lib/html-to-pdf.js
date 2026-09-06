'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { which } = require('./printers');

const PAPER_PRESETS = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  B4: { width: 250, height: 353 },
  B5: { width: 176, height: 250 },
  Letter: { width: 216, height: 279 },
  Legal: { width: 216, height: 356 },
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

function normalizePinSheetName(name) {
  if (name == null || name === '') return null;
  return PIN_SHEET_ALIASES[String(name).trim()] || null;
}

function isPinSheetName(name) {
  return !!normalizePinSheetName(name);
}

function matchPinSheet(width, height) {
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

function looksLikeOfficePaper(name, width, height) {
  const n = String(name || '');
  if (/^(A3|A4|A5|B4|B5|Letter|Legal|Tabloid)$/i.test(n)) return true;
  const w = Number(width);
  const h = Number(height);
  if (!w || !h) return true;
  const a = Math.min(w, h);
  const b = Math.max(w, h);
  return (
    (Math.abs(a - 210) <= 5 && Math.abs(b - 297) <= 5) ||
    (Math.abs(a - 148) <= 5 && Math.abs(b - 210) <= 5) ||
    (Math.abs(a - 176) <= 5 && Math.abs(b - 250) <= 5) ||
    (Math.abs(a - 216) <= 6 && Math.abs(b - 279) <= 6)
  );
}

/** Pin / dot-matrix printer by name (brand patterns; see printer-kind.js). */
function isPinPrinter(name) {
  return require('./printer-kind').pinByName(name);
}

/**
 * Pin layout for this job: resolved printer kind (driver probe or name),
 * or the user explicitly picked a 针式 sheet in the preview.
 */
function isPinSettings(settings) {
  const s = settings || {};
  if (s.printerKind === 'pin') return true;
  // A confident driver/name verdict wins (a laser feeding pre-cut 241×140
  // forms must not get the fanfold offsets). Unknown driver → trust the
  // user's 针式 sheet choice.
  if (s.printerKind && s.printerKindSource && s.printerKindSource !== 'unknown') return false;
  if (normalizePinSheetName(s.paperName || s.paper)) return true;
  return isPinPrinter(s.printer || s.printerName);
}

function applyPinFormPaper(settings) {
  const s = Object.assign({}, settings || {});
  if (!isPinSettings(s)) return s;
  const pinName = normalizePinSheetName(s.paperName || s.paper);
  if (pinName) {
    const preset = PAPER_PRESETS[pinName];
    s.paperName = pinName;
    s.pageWidth = preset.width;
    s.pageHeight = preset.height;
    s.orientation = 2;
    s.lockPageBox = true;
    return s;
  }
  const w = Number(s.pageWidth || s.width || 0);
  const h = Number(s.pageHeight || s.height || 0);
  if (matchPinSheet(w, h)) return s;
  if (looksLikeOfficePaper(s.paperName || s.paper, w, h)) {
    s.paperName = 'Pin2';
    s.pageWidth = 241;
    s.pageHeight = 140;
    s.orientation = 2;
    s.lockPageBox = true;
  }
  return s;
}

function resolveChromePath() {
  if (process.env.PRINTKIT_CHROME) return process.env.PRINTKIT_CHROME;

  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const pf = process.env.PROGRAMFILES || 'C\\\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C\\\\Program Files (x86)';
    const candidates = [
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return which(['chrome', 'msedge', 'chrome.exe', 'msedge.exe']);
  }

  return which(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']);
}

function truthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function resolvePaper(settings = {}) {
  settings = applyPinFormPaper(settings);
  const pinName = normalizePinSheetName(settings.paperName || settings.paper);
  const name = pinName || settings.paperName || settings.paper || 'A4';
  const preset = PAPER_PRESETS[name] || PAPER_PRESETS.A4;
  let width = Number(settings.pageWidth || settings.width || preset.width);
  let height = Number(settings.pageHeight || settings.height || preset.height);
  let orientation = Number(settings.orientation || 1) === 2 ? 2 : 1;
  // Preview sends the sheet mm it actually drew. Do not swap again.
  // Pin-feed sheets are already the physical ticket (241×140 二等分, etc.).
  if (pinName) {
    width = preset.width;
    height = preset.height;
    orientation = 2;
  } else if (!truthy(settings.lockPageBox)) {
    if (orientation === 2 && width < height) {
      [width, height] = [height, width];
    } else if (orientation === 1 && width > height) {
      [width, height] = [height, width];
    }
  }
  const margins = {
    top: num(settings.marginTop, 0),
    right: num(settings.marginRight, 0),
    bottom: num(settings.marginBottom, 0),
    left: num(settings.marginLeft, 0),
  };
  // Fanfold: the pins cannot reach the tractor strips / beyond the carriage,
  // so content there is simply lost. Keep margins at least that wide (the
  // preview enforces the same minimums, so 预览 == 纸).
  if (pinName && isPinSettings(settings)) {
    const zone = pinUnprintable(settings.printer || settings.printerName, width);
    margins.left = Math.max(margins.left, zone.left);
    margins.right = Math.max(margins.right, zone.right);
  }
  return { name, width, height, orientation, margins };
}

/** Mirror of extension/lib/paper.js pinUnprintable(). */
function pinUnprintable(printerName, sheetWidthMm) {
  const wide = /LQ[- ]?[12]\d{3}|FP[- ]?8[48]00|DS[- ]?(2600|5400|7860)|1600|1900|136|宽行|宽幅/i.test(
    String(printerName || '')
  );
  const left = 13;
  const printable = wide ? 345.4 : 203.2;
  const right = Math.max(12.7, Math.round((Number(sheetWidthMm || 241) - left - printable) * 10) / 10);
  return { left, right, strip: 12.7 };
}

function namedPresetMatches(paper) {
  const preset = PAPER_PRESETS[paper.name];
  if (!preset) return false;
  const a0 = Math.min(paper.width, paper.height);
  const a1 = Math.max(paper.width, paper.height);
  const b0 = Math.min(preset.width, preset.height);
  const b1 = Math.max(preset.width, preset.height);
  return Math.abs(a0 - b0) <= 3 && Math.abs(a1 - b1) <= 3;
}

/**
 * Map a resolved page box to printer DEVMODE / Chrome / Sumatra flags.
 *
 * resolvePaper() already swaps mm to the real printable box (e.g. 241×93).
 * Custom pin-feed / waybill forms ARE that box — sending "landscape" again
 * rotates another 90° and the preview (横) no longer matches the paper (竖).
 * Named A4/Letter/etc. still use the portrait preset + landscape flag.
 */
function printerMedia(paper) {
  if (
    isPinSheetName(paper && paper.name) ||
    matchPinSheet(paper && paper.width, paper && paper.height)
  ) {
    return {
      widthMm: Number(paper.width) || 241,
      heightMm: Number(paper.height) || 140,
      landscape: false,
      custom: true,
      name: paper.name || 'Pin2',
    };
  }
  const preset = PAPER_PRESETS[paper && paper.name];
  if (preset && namedPresetMatches(paper) && !isPinSheetName(paper.name)) {
    return {
      widthMm: preset.width,
      heightMm: preset.height,
      landscape: Number(paper.orientation) === 2 || paper.width > paper.height + 1,
      custom: false,
      name: paper.name,
    };
  }
  return {
    widthMm: Number(paper.width) || 210,
    heightMm: Number(paper.height) || 297,
    landscape: false,
    custom: true,
    name: 'CUSTOM',
  };
}

function num(v, fallback) {
  if (v === 0 || v === '0') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtmlDocument({ title, pages, stylesheets, settings }) {
  const paper = resolvePaper(settings);
  const styleTags = [];
  for (const sheet of stylesheets || []) {
    if (sheet.type === 'style' && sheet.css) {
      styleTags.push(`<style>${sheet.css}</style>`);
    } else if (sheet.type === 'link' && sheet.href) {
      styleTags.push(`<link rel="stylesheet" href="${escapeHtml(sheet.href)}" />`);
    }
  }

  const m = paper.margins;
  const pageHtml = (pages || [])
    .map((p, i) => {
      const html = typeof p === 'string' ? p : p.html || '';
      return `<section class="pk-page" data-page="${i + 1}"><div class="pk-fit">${html}</div></section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title || 'PrintKit')}</title>
  ${styleTags.join('\n')}
  <style>
    @page {
      size: ${paper.width}mm ${paper.height}mm;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
      /* Pin printers: soft ClearType edges become broken dots */
      -webkit-font-smoothing: none;
      font-smooth: never;
      text-rendering: optimizeSpeed;
      text-shadow: none;
    }
    body, table, td, th, div, span, p, font {
      font-smooth: never;
      -webkit-font-smoothing: none;
      text-shadow: none;
    }
    @media print {
      html, body, table, td, th, div, span, p, font {
        color: #000 !important;
        -webkit-font-smoothing: none !important;
        font-smooth: never !important;
        text-shadow: none !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
    .pk-page {
      width: ${paper.width}mm;
      height: ${paper.height}mm;
      box-sizing: border-box;
      padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
      position: relative;
      display: block;
      margin: 0;
    }
    .pk-fit {
      width: 100%;
      margin: 0;
      transform: none;
    }
    img, canvas, svg {
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
      max-width: 100%;
    }
    @media print {
      html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
    .pk-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    img, svg, canvas, video {
      max-width: 100%;
      height: auto;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    /* Keep barcodes / stamps sharp when marked */
    img.barcode, img.qrcode, img[data-sharp="1"], .barcode img, .qrcode img {
      image-rendering: crisp-edges;
      image-rendering: -webkit-optimize-contrast;
    }
    /* Pin: gray/ClearType becomes dithered double-strike. TXT is sharp
       because the driver uses ROM glyphs; stay as close as we can. */
    ${
      isPinSettings(settings)
        ? `html, body, table, td, th, div, span, p, font, b, strong, label {
      color: #000 !important;
      text-shadow: none !important;
      -webkit-text-stroke: 0 !important;
      font-family: SimSun, "宋体", NSimSun, "新宋体", serif !important;
    }
    html, body, table, td, th, div, section, .pk-page, .pk-fit {
      background: #fff !important;
      background-image: none !important;
    }
    * { box-shadow: none !important; filter: none !important; text-shadow: none !important; }`
        : ''
    }
    * {
      scrollbar-width: none !important;
    }
    *::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }
  </style>
</head>
<body>
${pageHtml}
<script>
// Fixed-width tables wider than the content box would be clipped; shrink
// them (CSS zoom stays vector on GDI). Same rule runs in the preview.
(function () {
  function fit() {
    var list = document.querySelectorAll('.pk-fit');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      el.style.zoom = '1';
      var cw = el.clientWidth, sw = el.scrollWidth;
      if (sw > cw + 1) el.style.zoom = String(cw / sw);
    }
  }
  fit();
  window.addEventListener('load', fit);
})();
</script>
</body>
</html>`;
}

async function htmlJobToPdf({ jobDir, title, pages, stylesheets, settings }) {
  const chrome = resolveChromePath();
  if (!chrome) {
    throw new Error(
      '未找到 Chrome/Edge。请安装 Google Chrome 或 Microsoft Edge，或设置环境变量 PRINTKIT_CHROME'
    );
  }

  const htmlPath = path.join(jobDir, 'job.html');
  const pdfPath = path.join(jobDir, 'job.pdf');
  const html = buildHtmlDocument({ title, pages, stylesheets, settings });
  fs.writeFileSync(htmlPath, html, 'utf8');

  try {
    // CDP path needs Node 18+ (fetch/WebSocket). On older Node (Win7/Node12) skip it.
    const major = parseInt(String(process.versions.node || '0').split('.')[0], 10) || 0;
    if (major >= 18) {
      const { htmlToPdfViaCdp } = require('./chrome-cdp');
      const t0 = Date.now();
      await htmlToPdfViaCdp({ htmlPath, pdfPath, settings });
      if (fs.existsSync(pdfPath)) {
        try {
          fs.appendFileSync(
            path.join(os.tmpdir(), 'printkit-host.log'),
            `[${new Date().toISOString()}] html-to-pdf cdp ${Date.now() - t0}ms\n`
          );
        } catch (_) {
          /* ignore */
        }
        return { pdfPath: pdfPath, htmlPath: htmlPath };
      }
    } else {
      try {
        fs.appendFileSync(
          path.join(os.tmpdir(), 'printkit-host.log'),
          `[${new Date().toISOString()}] html-to-pdf skip cdp (node ${process.versions.node})\n`
        );
      } catch (_) {
        /* ignore */
      }
    }
  } catch (err) {
    try {
      fs.appendFileSync(
        path.join(os.tmpdir(), 'printkit-host.log'),
        `[${new Date().toISOString()}] html-to-pdf cdp failed: ${err.message || err}\n`
      );
    } catch (_) {
      /* ignore */
    }
  }

  const fileUrl =
    process.platform === 'win32'
      ? 'file:///' + htmlPath.replace(/\\/g, '/')
      : 'file://' + htmlPath;

  const profileDir = path.join(os.tmpdir(), 'printkit-chrome-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    '--headless',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--disable-default-apps',
    '--disable-component-update',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-pings',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    // Sharper PDF text/fonts on Windows 7 Chrome
    '--font-render-hinting=none',
    '--run-all-compositor-stages-before-draw',
    '--disable-lcd-text',
    '--force-device-scale-factor=1',
    '--default-background-color=FFFFFFFF',
    `--user-data-dir=${profileDir}`,
    `--print-to-pdf=${pdfPath}`,
    '--no-pdf-header-footer',
    // Give fonts/images more time before snapshot
    '--virtual-time-budget=8000',
    fileUrl,
  ];

  const r = spawnSync(chrome, args, {
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!fs.existsSync(pdfPath)) {
    throw new Error(
      `HTML 转 PDF 失败: ${(r.stderr || r.stdout || `exit ${r.status}`).toString().trim()}`
    );
  }
  return { pdfPath: pdfPath, htmlPath: htmlPath };
}

function readPdfPageSize(pdfPath) {
  try {
    const buf = fs.readFileSync(pdfPath);
    const text = buf.toString('latin1');
    const m = /\/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/.exec(
      text
    );
    if (!m) return null;
    const wPt = Math.abs(Number(m[3]) - Number(m[1]));
    const hPt = Math.abs(Number(m[4]) - Number(m[2]));
    if (!wPt || !hPt) return null;
    return {
      widthMm: (wPt * 25.4) / 72,
      heightMm: (hPt * 25.4) / 72,
    };
  } catch (_) {
    return null;
  }
}

function isWideBox(width, height) {
  return Number(width) >= Number(height) - 0.5;
}

module.exports = {
  htmlJobToPdf,
  buildHtmlDocument,
  resolveChromePath,
  resolvePaper,
  printerMedia,
  readPdfPageSize,
  isWideBox,
  isPinPrinter,
  isPinSettings,
  pinUnprintable,
  isPinSheetName,
  matchPinSheet,
  PAPER_PRESETS,
};

