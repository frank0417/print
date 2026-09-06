'use strict';

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
  Form241x140: { width: 241, height: 140 },
  Form241x93: { width: 241, height: 93 },
  Form241x280: { width: 241, height: 280 },
  Form210x140: { width: 210, height: 140 },
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

function num(v, fallback) {
  if (v === 0 || v === '0') return 0;
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function resolvePaper(settings = {}) {
  const name = settings.paperName || settings.paper || 'A4';
  const preset = PAPER_PRESETS[name] || PAPER_PRESETS.A4;
  let width = Number(settings.pageWidth || settings.width || preset.width);
  let height = Number(settings.pageHeight || settings.height || preset.height);
  const orientation = Number(settings.orientation || 1);
  if (orientation === 2 && width < height) {
    [width, height] = [height, width];
  }
  // Default margins 0 for form overlay (套打). Non-zero margins shift absolute content.
  const margins = {
    top: num(settings.marginTop, 0),
    right: num(settings.marginRight, 0),
    bottom: num(settings.marginBottom, 0),
    left: num(settings.marginLeft, 0),
  };
  const offsets = {
    x: num(settings.offsetX ?? settings.printOffsetX, 0),
    y: num(settings.offsetY ?? settings.printOffsetY, 0),
  };
  return { name, width, height, orientation, margins, offsets };
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
    } else if ((sheet.type === 'link' || sheet.type === 'stylesheet') && sheet.href) {
      styleTags.push(`<link rel="stylesheet" href="${escapeHtml(sheet.href)}" />`);
    }
  }

  // Content origin = paper edge (@page margin 0). Apply margin+offset once via translate.
  const tx = paper.margins.left + paper.offsets.x;
  const ty = paper.margins.top + paper.offsets.y;

  const pageHtml = (pages || [])
    .map((p, i) => {
      const html = typeof p === 'string' ? p : p.html || '';
      return `<section class="pk-page" data-page="${i + 1}">
  <div class="pk-page-inner">${html}</div>
</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title || 'PrintKit')}</title>
  <style>
    @page {
      size: ${paper.width}mm ${paper.height}mm;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pk-page {
      width: ${paper.width}mm;
      height: ${paper.height}mm;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
      box-sizing: border-box;
      position: relative;
    }
    .pk-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .pk-page-inner {
      position: absolute;
      left: 0;
      top: 0;
      width: ${paper.width}mm;
      min-height: ${paper.height}mm;
      box-sizing: border-box;
      transform: translate(${tx}mm, ${ty}mm);
    }
  </style>
  ${styleTags.join('\n')}
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

  const fileUrl =
    process.platform === 'win32'
      ? 'file:///' + htmlPath.replace(/\\/g, '/')
      : 'file://' + htmlPath;

  const paper = resolvePaper(settings);
  // Prefer virtual time + no margins; @page size drives paper dimensions.
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--hide-scrollbars',
    `--print-to-pdf=${pdfPath}`,
    '--no-pdf-header-footer',
    // Hint paper size via window size roughly matching aspect (helps some Chrome builds)
    `--force-device-scale-factor=1`,
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

  // Attach paper meta for debugging
  try {
    fs.writeFileSync(
      path.join(jobDir, 'paper.json'),
      JSON.stringify(paper, null, 2),
      'utf8'
    );
  } catch (_) {
    /* ignore */
  }

  return pdfPath;
}

module.exports = {
  htmlJobToPdf,
  buildHtmlDocument,
  resolveChromePath,
  resolvePaper,
  PAPER_PRESETS,
};
