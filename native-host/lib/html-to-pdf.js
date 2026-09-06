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
};

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
  const name = settings.paperName || settings.paper || 'A4';
  const preset = PAPER_PRESETS[name] || PAPER_PRESETS.A4;
  let width = Number(settings.pageWidth || settings.width || preset.width);
  let height = Number(settings.pageHeight || settings.height || preset.height);
  const orientation = Number(settings.orientation || 1) === 2 ? 2 : 1;
  // Preview sends the sheet mm it actually drew. Do not swap again.
  if (!truthy(settings.lockPageBox)) {
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
  return { name, width, height, orientation, margins };
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
  const preset = PAPER_PRESETS[paper && paper.name];
  if (preset && namedPresetMatches(paper)) {
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

  const pageHtml = (pages || [])
    .map((p, i) => {
      const html = typeof p === 'string' ? p : p.html || '';
      return `<section class="pk-page" data-page="${i + 1}">${html}</section>`;
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
      margin: ${paper.margins.top}mm ${paper.margins.right}mm ${paper.margins.bottom}mm ${paper.margins.left}mm;
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
      width: 100%;
      box-sizing: border-box;
      page-break-after: always;
      break-after: page;
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
    '--enable-font-antialiasing',
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
  PAPER_PRESETS,
};

