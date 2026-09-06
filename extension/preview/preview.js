import {
  PAPER_PRESETS,
  resolvePaper,
  normalizeMargins,
  normalizeOffsets,
  pxToMm,
} from '../lib/paper.js';

const params = new URLSearchParams(location.search);
const jobId = params.get('jobId');

const els = {
  stage: document.getElementById('stage'),
  status: document.getElementById('status'),
  paperName: document.getElementById('paperName'),
  orientation: document.getElementById('orientation'),
  copies: document.getElementById('copies'),
  marginTop: document.getElementById('marginTop'),
  marginRight: document.getElementById('marginRight'),
  marginBottom: document.getElementById('marginBottom'),
  marginLeft: document.getElementById('marginLeft'),
  offsetX: document.getElementById('offsetX'),
  offsetY: document.getElementById('offsetY'),
  btnPrint: document.getElementById('btnPrint'),
  btnClose: document.getElementById('btnClose'),
};

let job = null;

function setStatus(text) {
  els.status.textContent = text;
}

function readSettingsFromUi() {
  const settings = {
    paperName: els.paperName.value,
    orientation: Number(els.orientation.value),
    copies: Math.max(1, Number(els.copies.value) || 1),
    marginTop: Number(els.marginTop.value),
    marginRight: Number(els.marginRight.value),
    marginBottom: Number(els.marginBottom.value),
    marginLeft: Number(els.marginLeft.value),
    offsetX: Number(els.offsetX.value),
    offsetY: Number(els.offsetY.value),
  };
  // Preserve custom page size if present on job
  if (job?.settings?.pageWidth) settings.pageWidth = job.settings.pageWidth;
  if (job?.settings?.pageHeight) settings.pageHeight = job.settings.pageHeight;
  return settings;
}

function applySettingsToUi(settings = {}) {
  if (settings.paperName && (PAPER_PRESETS[settings.paperName] || settings.paperName === 'Custom')) {
    els.paperName.value = settings.paperName;
  }
  if (settings.orientation === 1 || settings.orientation === 2) {
    els.orientation.value = String(settings.orientation);
  }
  if (settings.copies) els.copies.value = String(settings.copies);
  const margins = normalizeMargins(settings);
  els.marginTop.value = String(margins.top);
  els.marginRight.value = String(margins.right);
  els.marginBottom.value = String(margins.bottom);
  els.marginLeft.value = String(margins.left);
  const offsets = normalizeOffsets(settings);
  els.offsetX.value = String(offsets.x);
  els.offsetY.value = String(offsets.y);
}

/**
 * Infer page size from captured page element px size when custom/form size not set.
 */
function enrichSettingsFromPages(settings, pages) {
  const next = { ...settings };
  const first = pages?.[0];
  if (!first) return next;

  const wMm = pxToMm(first.width);
  const hMm = pxToMm(first.height);
  if (!next.pageWidth && wMm && wMm > 50) {
    next.pageWidth = wMm;
    if (!PAPER_PRESETS[next.paperName]) next.paperName = 'Custom';
    // If content is clearly wider than tall and orientation not set landscape for forms
  }
  if (!next.pageHeight && hMm && hMm > 30) {
    next.pageHeight = hMm;
  }
  // Prefer matching continuous-form presets when close
  if (next.pageWidth && next.pageHeight) {
    for (const [name, preset] of Object.entries(PAPER_PRESETS)) {
      if (!name.startsWith('Form')) continue;
      if (
        Math.abs(preset.width - next.pageWidth) < 3 &&
        Math.abs(preset.height - next.pageHeight) < 3
      ) {
        next.paperName = name;
        delete next.pageWidth;
        delete next.pageHeight;
        break;
      }
    }
  }
  return next;
}

function resolveSize(settings) {
  const paper = resolvePaper(settings);
  return { width: paper.widthMm, height: paper.heightMm };
}

/**
 * Print CSS: @page margin MUST be 0 for 套打.
 * Margins + offsets are applied once via transform on .sheet-inner.
 * Avoids the old double-margin bug (padding + @page) that shifted content right.
 */
function ensurePrintStyle(settings) {
  let style = document.getElementById('dynamic-print-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dynamic-print-style';
    document.head.appendChild(style);
  }
  const { width, height } = resolveSize(settings);
  const m = normalizeMargins(settings);
  const o = normalizeOffsets(settings);
  const tx = m.left + o.x;
  const ty = m.top + o.y;
  style.textContent = `
    @page {
      size: ${width}mm ${height}mm;
      margin: 0 !important;
    }
    @media print {
      .sheet {
        width: ${width}mm !important;
        height: ${height}mm !important;
        min-height: ${height}mm !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
      }
      .sheet-inner {
        transform: translate(${tx}mm, ${ty}mm);
      }
    }
  `;
}

function renderJob() {
  let settings = { ...job.settings, ...readSettingsFromUi() };
  settings = enrichSettingsFromPages(settings, job.pages);
  const size = resolveSize(settings);
  const margins = normalizeMargins(settings);
  const offsets = normalizeOffsets(settings);
  ensurePrintStyle(settings);

  els.stage.innerHTML = '';

  document.querySelectorAll('[data-printkit-style]').forEach((n) => n.remove());
  for (const sheet of job.stylesheets || []) {
    if (sheet.type === 'style') {
      const s = document.createElement('style');
      s.dataset.printkitStyle = '1';
      s.textContent = sheet.css;
      document.head.appendChild(s);
    } else if ((sheet.type === 'link' || sheet.type === 'stylesheet') && sheet.href) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      link.dataset.printkitStyle = '1';
      document.head.appendChild(link);
    }
  }

  const tx = margins.left + offsets.x;
  const ty = margins.top + offsets.y;

  for (const page of job.pages) {
    const sheet = document.createElement('section');
    sheet.className = 'sheet';
    sheet.style.width = `${size.width}mm`;
    sheet.style.minHeight = `${size.height}mm`;
    // Screen preview: no padding — position via transform only (same as print)
    sheet.style.padding = '0';

    if (job.overlay && typeof job.overlay === 'string') {
      const overlay = document.createElement('div');
      overlay.className = 'overlay-layer';
      overlay.innerHTML = job.overlay;
      sheet.appendChild(overlay);
    }

    const inner = document.createElement('div');
    inner.className = 'sheet-inner';
    inner.style.transform = `translate(${tx}mm, ${ty}mm)`;
    inner.innerHTML = page.html;
    sheet.appendChild(inner);

    const label = document.createElement('div');
    label.className = 'sheet-label no-print';
    label.textContent = `${page.id} · ${size.width}×${size.height}mm · 偏移 ${offsets.x},${offsets.y}`;
    sheet.appendChild(label);

    els.stage.appendChild(sheet);
  }

  document.title = `${job.title || '打印预览'} · PrintKit`;
  setStatus(
    `共 ${job.pages.length} 页 · ${settings.paperName || 'Custom'} ${size.width}×${size.height}mm · 偏移(${offsets.x},${offsets.y})`
  );
}

function bindUi() {
  for (const el of [
    els.paperName,
    els.orientation,
    els.copies,
    els.marginTop,
    els.marginRight,
    els.marginBottom,
    els.marginLeft,
    els.offsetX,
    els.offsetY,
  ]) {
    el.addEventListener('change', renderJob);
    el.addEventListener('input', renderJob);
  }

  els.btnPrint.addEventListener('click', () => {
    const settings = { ...job.settings, ...readSettingsFromUi() };
    ensurePrintStyle(settings);
    const copies = Math.max(1, settings.copies || 1);
    if (copies > 1) {
      setStatus(`请在系统打印对话框中选择份数：${copies}`);
    }
    window.print();
  });

  els.btnClose.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'CLOSE_PREVIEW', jobId });
    } catch (_) {
      /* ignore */
    }
    window.close();
  });
}

async function boot() {
  if (!jobId) {
    setStatus('缺少 jobId');
    return;
  }

  const res = await chrome.runtime.sendMessage({ type: 'GET_JOB', jobId });
  if (res?.error) {
    setStatus(res.error);
    return;
  }
  job = res.job;
  // Auto-size from captured DOM before applying to UI
  job.settings = enrichSettingsFromPages(job.settings || {}, job.pages);
  applySettingsToUi(job.settings);
  bindUi();
  renderJob();

  if (job.mode === 'print') {
    setTimeout(() => {
      ensurePrintStyle({ ...job.settings, ...readSettingsFromUi() });
      window.print();
    }, 350);
  }
}

boot().catch((err) => setStatus(err.message || String(err)));
