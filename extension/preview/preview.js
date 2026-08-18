import { PAPER_PRESETS, resolvePaper, normalizeMargins } from '../lib/paper.js';

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
  btnPrint: document.getElementById('btnPrint'),
  btnClose: document.getElementById('btnClose'),
};

let job = null;

function setStatus(text) {
  els.status.textContent = text;
}

function readSettingsFromUi() {
  return {
    paperName: els.paperName.value,
    orientation: Number(els.orientation.value),
    copies: Math.max(1, Number(els.copies.value) || 1),
    marginTop: Number(els.marginTop.value),
    marginRight: Number(els.marginRight.value),
    marginBottom: Number(els.marginBottom.value),
    marginLeft: Number(els.marginLeft.value),
  };
}

function applySettingsToUi(settings = {}) {
  if (settings.paperName && PAPER_PRESETS[settings.paperName]) {
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
}

function resolveSize(settings) {
  const paper = resolvePaper(settings);
  return { width: paper.widthMm, height: paper.heightMm };
}

function ensurePrintStyle(settings) {
  let style = document.getElementById('dynamic-print-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dynamic-print-style';
    document.head.appendChild(style);
  }
  const { width, height } = resolveSize(settings);
  const m = normalizeMargins(settings);
  style.textContent = `
    @page {
      size: ${width}mm ${height}mm;
      margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
    }
  `;
}

function renderJob() {
  const settings = { ...job.settings, ...readSettingsFromUi() };
  const size = resolveSize(settings);
  const margins = normalizeMargins(settings);
  ensurePrintStyle(settings);

  els.stage.innerHTML = '';

  document.querySelectorAll('[data-printkit-style]').forEach((n) => n.remove());
  for (const sheet of job.stylesheets || []) {
    if (sheet.type === 'style') {
      const s = document.createElement('style');
      s.dataset.printkitStyle = '1';
      s.textContent = sheet.css;
      document.head.appendChild(s);
    } else if (sheet.type === 'link' && sheet.href) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      link.dataset.printkitStyle = '1';
      document.head.appendChild(link);
    }
  }

  for (const page of job.pages) {
    const sheet = document.createElement('section');
    sheet.className = 'sheet';
    sheet.style.width = `${size.width}mm`;
    sheet.style.minHeight = `${size.height}mm`;
    sheet.style.padding = `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`;

    if (job.overlay && typeof job.overlay === 'string') {
      const overlay = document.createElement('div');
      overlay.className = 'overlay-layer';
      overlay.innerHTML = job.overlay;
      sheet.appendChild(overlay);
    }

    const inner = document.createElement('div');
    inner.className = 'sheet-inner';
    inner.innerHTML = page.html;
    sheet.appendChild(inner);

    const label = document.createElement('div');
    label.className = 'sheet-label no-print';
    label.textContent = `${page.id} · ${size.width}×${size.height}mm`;
    sheet.appendChild(label);

    els.stage.appendChild(sheet);
  }

  document.title = `${job.title || '打印预览'} · PrintKit`;
  setStatus(`共 ${job.pages.length} 页 · ${settings.paperName} · 任务 ${job.id}`);
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
  ]) {
    el.addEventListener('change', renderJob);
    el.addEventListener('input', renderJob);
  }

  els.btnPrint.addEventListener('click', () => {
    const settings = readSettingsFromUi();
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
  applySettingsToUi(job.settings || {});
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
