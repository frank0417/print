import { PAPER_PRESETS, resolvePaper, normalizeMargins } from '../lib/paper.js';

const params = new URLSearchParams(location.search);
const jobId = params.get('jobId');

const els = {
  stage: document.getElementById('stage'),
  status: document.getElementById('status'),
  paperName: document.getElementById('paperName'),
  orientation: document.getElementById('orientation'),
  copies: document.getElementById('copies'),
  printer: document.getElementById('printer'),
  marginTop: document.getElementById('marginTop'),
  marginRight: document.getElementById('marginRight'),
  marginBottom: document.getElementById('marginBottom'),
  marginLeft: document.getElementById('marginLeft'),
  btnPrint: document.getElementById('btnPrint'),
  btnClose: document.getElementById('btnClose'),
  btnSettings: document.getElementById('btnSettings'),
  settingsMenu: document.getElementById('settingsMenu'),
};

let job = null;
let printing = false;

function setStatus(text) {
  els.status.textContent = text;
}

function readSettingsFromUi() {
  const printer = els.printer?.value || '';
  return {
    paperName: els.paperName.value,
    orientation: Number(els.orientation.value),
    copies: Math.max(1, Number(els.copies.value) || 1),
    marginTop: Number(els.marginTop.value),
    marginRight: Number(els.marginRight.value),
    marginBottom: Number(els.marginBottom.value),
    marginLeft: Number(els.marginLeft.value),
    printer: printer || undefined,
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
  const wanted = settings.printer || settings.printerName;
  if (wanted && els.printer) {
    if (![...els.printer.options].some((o) => o.value === wanted)) {
      const opt = document.createElement('option');
      opt.value = wanted;
      opt.textContent = wanted;
      els.printer.appendChild(opt);
    }
    els.printer.value = wanted;
  }
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
    const shadow = inner.attachShadow({ mode: 'open' });
    const reset = document.createElement('style');
    reset.textContent = `
      :host { display: block; width: 100%; height: 100%; overflow: hidden; }
      * { box-sizing: border-box; scrollbar-width: none !important; }
      *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      html, body, div, table { overflow: hidden !important; }
    `;
    shadow.appendChild(reset);
    for (const cssSheet of job.stylesheets || []) {
      if (cssSheet.type === 'style' && cssSheet.css) {
        const s = document.createElement('style');
        s.textContent = cssSheet.css;
        shadow.appendChild(s);
      } else if (cssSheet.type === 'link' && cssSheet.href) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssSheet.href;
        shadow.appendChild(link);
      }
    }
    const wrap = document.createElement('div');
    wrap.innerHTML = page.html;
    shadow.appendChild(wrap);
    sheet.appendChild(inner);

    const label = document.createElement('div');
    label.className = 'sheet-label no-print';
    label.textContent = `${page.id} · ${size.width}×${size.height}mm`;
    sheet.appendChild(label);

    const fit = document.createElement('div');
    fit.className = 'sheet-fit';
    fit.appendChild(sheet);
    els.stage.appendChild(fit);
  }

  document.title = job.title || 'PrintKit';
  setStatus(`共 ${job.pages.length} 页 · ${settings.paperName} · 任务 ${job.id}`);
  requestAnimationFrame(fitSheets);
}

function fitSheets() {
  const stage = els.stage;
  if (!stage) return;
  const sheets = [...stage.querySelectorAll('.sheet')];
  if (!sheets.length) return;

  const availW = Math.max(1, stage.clientWidth - 32);
  const availH = Math.max(1, stage.clientHeight - 24);
  const gap = 16;

  const sizes = sheets.map((sheet) => {
    sheet.style.transform = 'none';
    return { sheet, w: sheet.offsetWidth, h: sheet.offsetHeight };
  });
  const maxW = Math.max(...sizes.map((s) => s.w), 1);
  const totalH = sizes.reduce((sum, s) => sum + s.h, 0) + gap * (sizes.length - 1);
  const scale = Math.min(1, availW / maxW, availH / Math.max(totalH, 1));

  for (const { sheet, w, h } of sizes) {
    const fit = sheet.parentElement;
    if (fit && fit.classList.contains('sheet-fit')) {
      fit.style.width = `${Math.round(w * scale)}px`;
      fit.style.height = `${Math.round(h * scale)}px`;
    }
    sheet.style.transformOrigin = 'top left';
    sheet.style.transform = `scale(${scale})`;
  }
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

  function closeSettings() {
    if (!els.settingsMenu) return;
    els.settingsMenu.hidden = true;
  }

  els.btnSettings?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!els.settingsMenu) return;
    els.settingsMenu.hidden = !els.settingsMenu.hidden;
  });

  els.settingsMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  document.addEventListener('click', closeSettings);

  async function doPrint() {
    closeSettings();
    if (printing) return;
    printing = true;
    els.btnPrint.disabled = true;
    const settings = readSettingsFromUi();
    setStatus('正在打印…');
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'PRINT_FROM_PREVIEW',
        jobId,
        settings,
      });
      if (res?.ok === false || res?.error) {
        setStatus(res.error || '打印失败');
        return;
      }
      const copies = res.copies || settings.copies || 1;
      setStatus(`已发送到 ${res.printer || '默认打印机'} · ${copies} 份`);
      try {
        await chrome.runtime.sendMessage({ type: 'CLOSE_PREVIEW', jobId });
      } catch (_) {
        /* ignore */
      }
      window.close();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      printing = false;
      els.btnPrint.disabled = false;
    }
  }

  document.getElementById('printForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    doPrint();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || printing) return;
    if (event.target === els.btnClose) return;
    if (event.target?.closest?.('#printForm')) return;
    event.preventDefault();
    doPrint();
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

  chrome.runtime.sendMessage({ type: 'PREWARM_HOST' }).catch(() => {});

  const res = await chrome.runtime.sendMessage({ type: 'GET_JOB', jobId });
  if (res?.error) {
    setStatus(res.error);
    return;
  }
  job = res.job;
  applySettingsToUi(job.settings || {});
  bindUi();
  renderJob();
  focusPrint();
  if (window.ResizeObserver) {
    new ResizeObserver(() => fitSheets()).observe(els.stage);
  } else {
    window.addEventListener('resize', fitSheets);
  }
  loadPrinters()
    .then(() => {
      applySettingsToUi(job.settings || {});
      focusPrint();
    })
    .catch(() => {});
}

function focusPrint() {
  const btn = document.getElementById('btnPrint');
  if (!btn) return;
  try {
    btn.focus({ preventScroll: true });
  } catch (_) {
    btn.focus();
  }
}

async function loadPrinters() {
  if (!els.printer) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_PRINTERS' });
    const list = Array.isArray(res?.printers) ? res.printers : [];
    const current = els.printer.value;
    els.printer.innerHTML = '<option value="">默认打印机</option>';
    for (const p of list) {
      const opt = document.createElement('option');
      opt.value = p.name;
      const portHint = p.port ? ` · ${p.port}` : '';
      opt.textContent = p.isDefault ? `${p.name}（默认）${portHint}` : `${p.name}${portHint}`;
      els.printer.appendChild(opt);
    }
    if (current) els.printer.value = current;
    if (res?.hostAvailable === false) {
      els.printer.title = '未安装本地打印代理，点打印将打开安装说明';
    }
  } catch (_) {
    /* keep default option */
  }
}

boot().catch((err) => setStatus(err.message || String(err)));
