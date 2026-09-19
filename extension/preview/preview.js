import {
  PAPER_PRESETS,
  resolvePaper,
  normalizeMargins,
  printerTypeLabel,
  classifyPrinterType,
  matchPinSheet,
  normalizePinSheetName,
  pinContentMargins,
  pinUnprintable,
} from '../lib/paper.js';
import {
  loadPreviewPrefs,
  savePreviewPrefs,
  mergeWithSavedPrefs,
  loadPrinterTypeOverrides,
  savePrinterTypeOverride,
} from '../lib/preview-prefs.js';

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
  contentScale: document.getElementById('contentScale'),
  btnPrint: document.getElementById('btnPrint'),
  btnClose: document.getElementById('btnClose'),
  btnSettings: document.getElementById('btnSettings'),
  settingsMenu: document.getElementById('settingsMenu'),
  printerKind: document.getElementById('printerKind'),
  zoomBar: document.getElementById('zoomBar'),
};

let job = null;
let printing = false;
let printerList = [];
let typeOverrides = {};
/** 'fit' | '100' | '150' | '200' — default 100% so preview stays sharp (no blurry downscale). */
let zoomMode = '100';
let saveTimer = 0;
/**
 * Opening the preview from an ERP page that used Enter (确认/打印) can
 * deliver that same key to this popup and immediately submit 「打印」.
 * Ignore keyboard/submit until the opener's key has settled, or the user clicks.
 */
const PRINT_GUARD_MS = 700;
let printGuardUntil = Date.now() + PRINT_GUARD_MS;

function keyboardPrintBlocked() {
  return Date.now() < printGuardUntil;
}

function releasePrintGuard() {
  printGuardUntil = 0;
}

function setStatus(text) {
  if (els.status) els.status.textContent = text;
}

function printerRecord(name) {
  return printerList.find((p) => p.name === name) || { name: name || '' };
}

function resolvedPrinterName() {
  const v = els.printer?.value || '';
  if (v) return v;
  const def = printerList.find((p) => p.isDefault);
  return def ? def.name : '';
}

function detectedPrinterType(name) {
  const n = name || resolvedPrinterName();
  const p = printerRecord(n);
  return p.kind || classifyPrinterType(n, { driver: p.description, port: p.port });
}

function resolvedPrinterType(name) {
  const n = name || resolvedPrinterName();
  if (!n) return detectedPrinterType(n);
  return typeOverrides[n] || detectedPrinterType(n);
}

function isPinSelected() {
  return resolvedPrinterType() === 'pin';
}

function printerOptionText(p) {
  return p.isDefault ? `${p.name}（默认）` : p.name;
}

function syncTypeSelect() {
  if (!els.printerKind) return;
  const name = resolvedPrinterName();
  const detected = detectedPrinterType(name) || 'laser';
  const override = typeOverrides[name] || '';
  els.printerKind.value = override || detected;
  els.printerKind.classList.toggle('overridden', !!override && override !== detected);
  els.printerKind.title = override && override !== detected
    ? `已手动改为「${printerTypeLabel(override)}」，自动识别为「${printerTypeLabel(detected)}」`
    : `自动识别为「${printerTypeLabel(detected)}」，认错了可以改，只对当前打印机生效`;
}

function ensureCustomPaperOption() {
  if (![...els.paperName.options].some((o) => o.value === 'Custom')) {
    const opt = document.createElement('option');
    opt.value = 'Custom';
    opt.textContent = '自定义';
    els.paperName.appendChild(opt);
  }
}

function readSettingsFromUi() {
  const paperName = els.paperName.value;
  const ui = {
    paperName,
    orientation: Number(els.orientation.value),
    copies: Math.max(1, Number(els.copies.value) || 1),
    marginTop: Number(els.marginTop.value),
    marginRight: Number(els.marginRight.value),
    marginBottom: Number(els.marginBottom.value),
    marginLeft: Number(els.marginLeft.value),
    contentScale: normalizeContentScale(els.contentScale?.value),
    printer: els.printer?.value || '',
  };
  if (paperName === 'Custom') {
    const w = Number(job?.settings?.pageWidth);
    const h = Number(job?.settings?.pageHeight);
    if (Number.isFinite(w) && w > 0) ui.pageWidth = w;
    if (Number.isFinite(h) && h > 0) ui.pageHeight = h;
  } else if (PAPER_PRESETS[paperName] && /^Pin/.test(paperName)) {
    ui.pageWidth = PAPER_PRESETS[paperName].width;
    ui.pageHeight = PAPER_PRESETS[paperName].height;
    ui.orientation = 2;
    ui.lockPageBox = true;
  }
  return ui;
}

function persistUiPrefs() {
  const ui = readSettingsFromUi();
  const prefs = {
    ...ui,
    zoomMode,
    savedAt: Date.now(),
  };
  if (prefs.paperName === 'Custom') {
    const size = resolveSize(ui);
    prefs.pageWidth = size.width;
    prefs.pageHeight = size.height;
  } else {
    delete prefs.pageWidth;
    delete prefs.pageHeight;
  }
  return savePreviewPrefs(prefs);
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistUiPrefs, 200);
}

function applySettingsToUi(settings = {}) {
  const pinMatch =
    matchPinSheet(settings.pageWidth || settings.width, settings.pageHeight || settings.height) ||
    (settings.paperName && PAPER_PRESETS[settings.paperName] && /^(Pin2|Pin3|PinFull)$/.test(settings.paperName)
      ? settings.paperName
      : null);
  const named = settings.paperName && PAPER_PRESETS[settings.paperName];
  if (pinMatch) {
    els.paperName.value = pinMatch;
    els.orientation.value = '2';
  } else if (named) {
    els.paperName.value = settings.paperName;
    if (settings.orientation === 1 || settings.orientation === 2) {
      els.orientation.value = String(settings.orientation);
    }
  } else if (
    settings.paperName === 'Custom' ||
    settings.pageWidth ||
    settings.pageHeight
  ) {
    ensureCustomPaperOption();
    els.paperName.value = 'Custom';
    if (settings.orientation === 1 || settings.orientation === 2) {
      els.orientation.value = String(settings.orientation);
    }
  } else if (settings.orientation === 1 || settings.orientation === 2) {
    els.orientation.value = String(settings.orientation);
  }
  if (settings.copies) els.copies.value = String(settings.copies);
  const wanted = settings.printer || settings.printerName;
  if (wanted && els.printer) {
    if (![...els.printer.options].some((o) => o.value === wanted)) {
      const opt = document.createElement('option');
      opt.value = wanted;
      opt.textContent = printerOptionText({ name: wanted });
      els.printer.appendChild(opt);
    }
    els.printer.value = wanted;
  } else if (settings.printer === '' || settings.printer === undefined) {
    if (Object.prototype.hasOwnProperty.call(settings, 'printer') && els.printer) {
      els.printer.value = '';
    }
  }
  const margins = normalizeMargins(settings);
  els.marginTop.value = String(margins.top);
  els.marginRight.value = String(margins.right);
  els.marginBottom.value = String(margins.bottom);
  els.marginLeft.value = String(margins.left);
  if (els.contentScale && settings.contentScale != null) {
    els.contentScale.value = String(normalizeContentScale(settings.contentScale));
  }
}

function mergedSettings(ui = readSettingsFromUi()) {
  return mergeWithSavedPrefs(job?.settings || {}, ui);
}

function resolveSize(settings) {
  const merged = mergedSettings(settings);
  if (merged.paperName === 'Custom') delete merged.paperName;
  const paper = resolvePaper(merged);
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
  const m = pinContentMargins(normalizeMargins(settings), pinZonesFor(settings, { width, height }));
  style.textContent = `
    @page {
      size: ${width}mm ${height}mm;
      margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
    }
  `;
}

/**
 * Tractor/carriage zones for this render, or null. Only a pin printer on a
 * 针式 sheet gets them — a laser feeding pre-cut 241×140 forms has no head
 * limit (the host applies the same rule in resolvePaper()).
 */
function pinZonesFor(settings, size) {
  const pinSheet =
    normalizePinSheetName(settings.paperName) || matchPinSheet(size.width, size.height);
  if (!pinSheet) return null;
  const printer = settings.printer || settings.printerName || resolvedPrinterName();
  if (resolvedPrinterType(printer) !== 'pin') return null;
  return pinUnprintable(printer, size.width);
}

function statusLine(size) {
  const zoomLabel = zoomMode === 'fit' ? '适合窗口' : `${zoomMode}%`;
  const orientLabel = size.width >= size.height ? '横向' : '纵向';
  return `共 ${job.pages.length} 页 · ${size.width}×${size.height}mm · ${orientLabel} · 预览 ${zoomLabel} · 任务 ${job.id}`;
}

function renderJob() {
  const settings = mergedSettings();
  const size = resolveSize(settings);
  const margins = normalizeMargins(settings);
  ensurePrintStyle(settings);

  els.stage.innerHTML = '';

  const zones = pinZonesFor(settings, size);
  // Content sits inside the hatch; the user's margin is added on top of it.
  const pad = pinContentMargins(margins, zones);
  const contentScale = normalizeContentScale(settings.contentScale) / 100;

  for (const page of job.pages) {
    const sheet = document.createElement('section');
    sheet.className = 'sheet';
    sheet.style.width = `${size.width}mm`;
    sheet.style.height = `${size.height}mm`;
    sheet.style.minHeight = `${size.height}mm`;
    sheet.style.maxHeight = `${size.height}mm`;
    sheet.style.padding = `${pad.top}mm ${pad.right}mm ${pad.bottom}mm ${pad.left}mm`;

    if (zones) {
      // Show the tractor strips + head limit so 预览 == 纸上: anything under
      // the hatch is physically unreachable by the pins.
      for (const side of ['left', 'right']) {
        const zone = document.createElement('div');
        zone.className = `pin-zone ${side} no-print`;
        zone.style.width = `${zones[side]}mm`;
        const holes = document.createElement('div');
        holes.className = 'pin-holes';
        holes.style.width = `${zones.strip}mm`;
        zone.appendChild(holes);
        sheet.appendChild(zone);
      }
    }

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
      html, body { overflow: visible !important; }
      img, canvas, svg, .barcode, [class*="barcode"] {
        image-rendering: -webkit-optimize-contrast;
        image-rendering: crisp-edges;
      }
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
    wrap.className = 'pk-fit';
    wrap.dataset.scale = String(contentScale);
    wrap.innerHTML = page.html;
    shadow.appendChild(wrap);
    sheet.appendChild(inner);
    for (const link of shadow.querySelectorAll('link[rel="stylesheet"]')) {
      link.addEventListener('load', () => fitContentWidth(wrap));
    }

    const label = document.createElement('div');
    label.className = 'sheet-label no-print';
    label.textContent = zones
      ? `${page.id || 'page'} · ${size.width}×${size.height}mm · 斜纹区（左 ${zones.left} / 右 ${zones.right}mm）针头打不到，边距从斜纹区内侧起算`
      : `${page.id || 'page'} · ${size.width}×${size.height}mm`;
    sheet.appendChild(label);

    const fit = document.createElement('div');
    fit.className = 'sheet-fit';
    fit.appendChild(sheet);
    els.stage.appendChild(fit);
  }

  for (const wrap of els.stage.querySelectorAll('.sheet-inner')) {
    const inner = wrap.shadowRoot && wrap.shadowRoot.querySelector('.pk-fit');
    if (inner) fitContentWidth(inner);
  }

  document.title = job.title || 'PrintKit';
  setStatus(statusLine(size));
  requestAnimationFrame(fitSheets);
}

/**
 * Same rule as the host's PDF page: content wider than the box (fixed-px
 * tables) is shrunk with CSS zoom instead of being clipped on the right.
 */
function fitContentWidth(el) {
  if (!el) return;
  const base = Number(el.dataset.scale) || 1;
  el.style.zoom = String(base);
  const cw = el.clientWidth;
  const sw = el.scrollWidth;
  if (sw > cw + 1) el.style.zoom = String((base * cw) / sw);
}

/** User content scale in percent; 100 = the page's own CSS sizes. */
function normalizeContentScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(200, Math.max(50, Math.round(n)));
}

/**
 * Prefer CSS `zoom` over transform:scale.
 * transform rasterizes then scales → blurry; zoom keeps glyphs/lines sharp.
 */
function fitSheets() {
  const stage = els.stage;
  if (!stage) return;
  const sheets = [...stage.querySelectorAll('.sheet')];
  if (!sheets.length) return;

  const availW = Math.max(1, stage.clientWidth - 32);
  const availH = Math.max(1, stage.clientHeight - 24);
  const gap = 16;

  for (const sheet of sheets) {
    sheet.style.transform = 'none';
    sheet.style.zoom = '1';
  }

  const sizes = sheets.map((sheet) => ({
    sheet,
    w: sheet.offsetWidth,
    h: sheet.offsetHeight,
  }));
  const maxW = Math.max(...sizes.map((s) => s.w), 1);
  const totalH = sizes.reduce((sum, s) => sum + s.h, 0) + gap * (sizes.length - 1);

  let scale;
  if (zoomMode === 'fit') {
    scale = Math.min(1, availW / maxW, availH / Math.max(totalH, 1));
  } else {
    scale = Math.max(0.25, Number(zoomMode) / 100 || 1);
  }

  for (const { sheet, w, h } of sizes) {
    const fit = sheet.parentElement;
    sheet.style.transform = 'none';
    sheet.style.zoom = String(scale);
    if (fit && fit.classList.contains('sheet-fit')) {
      fit.style.width = `${Math.round(w * scale)}px`;
      fit.style.height = `${Math.round(h * scale)}px`;
    }
  }
}

/** Zones the pins cannot reach for the current sheet/printer, or null. */
function currentPinZones() {
  if (!els.paperName) return null;
  const name = els.paperName.value;
  if (!normalizePinSheetName(name)) return null;
  const preset = PAPER_PRESETS[normalizePinSheetName(name)];
  return pinUnprintable(els.printer?.value, preset.width);
}

/**
 * Left/right margins on fanfold are offsets inside the hatch (see
 * pinContentMargins), so 0 is valid and no minimum is imposed here.
 */
function enforcePinMargins() {
  for (const el of [els.marginLeft, els.marginRight]) {
    if (el) el.removeAttribute('min');
  }
  return false;
}

function officePaperSelected() {
  return /^(A3|A4|A5|B4|B5|Letter|Legal|Tabloid)$/i.test(els.paperName?.value || '');
}

/** 针式机默认三联二等分，避免仍按 A4 297mm 出纸。 */
function syncPaperForPrinter() {
  if (!els.printer || !els.paperName) return false;
  if (!isPinSelected()) return false;
  if (officePaperSelected()) {
    els.paperName.value = 'Pin2';
    els.orientation.value = '2';
    return true;
  }
  if (els.paperName.value === 'Custom' && job && job.settings) {
    const w = Number(job.settings.pageWidth || job.settings.width);
    const h = Number(job.settings.pageHeight || job.settings.height);
    if (w && h) {
      const a = Math.min(w, h);
      const b = Math.max(w, h);
      if (Math.abs(a - 210) <= 5 && Math.abs(b - 297) <= 5) {
        els.paperName.value = 'Pin2';
        els.orientation.value = '2';
        return true;
      }
    }
  }
  return false;
}

function setZoomMode(mode) {
  zoomMode = mode;
  if (els.zoomBar) {
    for (const btn of els.zoomBar.querySelectorAll('button[data-zoom]')) {
      btn.classList.toggle('active', btn.getAttribute('data-zoom') === mode);
    }
  }
  if (els.stage) {
    els.stage.classList.toggle('scrollable', mode !== 'fit');
    els.stage.style.overflow = mode === 'fit' ? 'hidden' : 'auto';
  }
  fitSheets();
  if (job) {
    const size = resolveSize();
    setStatus(statusLine(size));
  }
  schedulePersist();
}

function bindUi() {
  printGuardUntil = Date.now() + PRINT_GUARD_MS;
  for (const el of [
    els.paperName,
    els.orientation,
    els.copies,
    els.printer,
    els.marginTop,
    els.marginRight,
    els.marginBottom,
    els.marginLeft,
    els.contentScale,
  ]) {
    el?.addEventListener('change', () => {
      if (el === els.printer) {
        syncTypeSelect();
        syncPaperForPrinter();
      }
      if (el === els.paperName && /^(Pin2|Pin3|PinFull)$/.test(els.paperName.value)) {
        els.orientation.value = '2';
      }
      enforcePinMargins();
      renderJob();
      persistUiPrefs();
    });
    el?.addEventListener('input', () => {
      renderJob();
      schedulePersist();
    });
  }

  els.zoomBar?.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-zoom]');
    if (!btn) return;
    event.preventDefault();
    setZoomMode(btn.getAttribute('data-zoom'));
  });

  function closeSettings() {
    if (!els.settingsMenu) return;
    els.settingsMenu.hidden = true;
  }

  els.btnSettings?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!els.settingsMenu) return;
    els.settingsMenu.hidden = !els.settingsMenu.hidden;
  });
  els.settingsMenu?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', closeSettings);

  els.printerKind?.addEventListener('change', async () => {
    const name = resolvedPrinterName();
    const chosen = els.printerKind.value || '';
    const detected = detectedPrinterType(name) || 'laser';
    // Picking the detected type again just clears the override.
    typeOverrides = await savePrinterTypeOverride(name, chosen === detected ? null : chosen);
    syncTypeSelect();
    syncPaperForPrinter();
    enforcePinMargins();
    renderJob();
  });

  async function doPrint() {
    closeSettings();
    if (printing) return;
    if (keyboardPrintBlocked()) return;
    printing = true;
    if (els.btnPrint) els.btnPrint.disabled = true;
    try {
      if (enforcePinMargins()) renderJob();
      const ui = readSettingsFromUi();
      const size = resolveSize(ui);
      const settings = mergedSettings(ui);
      settings.pageWidth = size.width;
      settings.pageHeight = size.height;
      settings.lockPageBox = true;
      settings.orientation = size.width >= size.height ? 2 : 1;
      settings.paperName = ui.paperName || settings.paperName;
      settings.marginTop = ui.marginTop;
      settings.marginRight = ui.marginRight;
      settings.marginBottom = ui.marginBottom;
      settings.marginLeft = ui.marginLeft;
      settings.contentScale = ui.contentScale;
      delete settings.contentWidth;
      delete settings.contentHeight;
      // "默认打印机" → send the real name so the host can route by driver
      // (IPP/WSD vs pin) and verify the job instead of printing blind.
      if (!settings.printer) {
        const def = resolvedPrinterName();
        if (def) settings.printer = def;
      }
      const kind = resolvedPrinterType();
      if (kind) {
        settings.printerKind = kind;
        settings.printerKindSource = typeOverrides[resolvedPrinterName()] ? 'explicit' : 'name';
        settings.printerType = kind;
      }
      setStatus(
        `正在打印（${settings.orientation === 2 ? '横向' : '纵向'} ${size.width}×${size.height}mm）…`
      );
      persistUiPrefs().catch(() => {});
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
      setStatus(
        `已发送到 ${res.printer || '默认打印机'} · ${copies} 份 · ${res.method || '高清'}`
      );
      try {
        await chrome.runtime.sendMessage({ type: 'CLOSE_PREVIEW', jobId });
      } catch (_) {
        /* ignore */
      }
      window.close();
    } catch (err) {
      setStatus('打印失败：' + (err?.message || String(err)));
    } finally {
      printing = false;
      if (els.btnPrint) els.btnPrint.disabled = false;
    }
  }

  document.getElementById('printForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (keyboardPrintBlocked()) return;
    doPrint();
  });

  // Belt and braces: if the form submit is ever swallowed (validation, focus
  // quirks), the button click still prints.
  els.btnPrint?.addEventListener('click', (event) => {
    event.preventDefault();
    // Keyboard activation (leftover Enter from the opener) has detail === 0.
    if (event.detail === 0 && keyboardPrintBlocked()) return;
    releasePrintGuard();
    doPrint();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || printing) return;
    if (keyboardPrintBlocked()) {
      event.preventDefault();
      return;
    }
    if (event.target === els.btnClose) return;
    if (event.target?.closest?.('#printForm')) return;
    event.preventDefault();
    doPrint();
  });

  els.btnClose?.addEventListener('click', async () => {
    persistUiPrefs();
    try {
      await chrome.runtime.sendMessage({ type: 'CLOSE_PREVIEW', jobId });
    } catch (_) {
      /* ignore */
    }
    window.close();
  });
}

function focusPrint() {
  const btn = els.btnPrint;
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
    printerList = list;
    const current = els.printer.value;
    els.printer.innerHTML = '<option value="">默认打印机</option>';
    for (const p of list) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = printerOptionText(p);
      const hint = [p.description, p.port].filter(Boolean).join(' · ');
      if (hint) opt.title = hint;
      els.printer.appendChild(opt);
    }
    if (current) els.printer.value = current;
    const def = list.find((p) => p.isDefault);
    if (def && els.printer.options[0]) {
      els.printer.options[0].textContent = `默认打印机（${def.name}）`;
    }
    syncTypeSelect();
    if (res?.hostAvailable === false) {
      els.printer.title = '未安装本地打印代理，点打印将打开安装说明';
    }
  } catch (_) {
    /* keep default */
  }
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
  bindUi();
  typeOverrides = await loadPrinterTypeOverrides();
  const saved = await loadPreviewPrefs();
  applySettingsToUi(job.settings || {});
  if (saved) {
    applySettingsToUi(saved);
    if (saved.zoomMode) zoomMode = saved.zoomMode;
  }
  setZoomMode(zoomMode);
  enforcePinMargins();
  renderJob();
  persistUiPrefs();
  try {
    document.body.tabIndex = -1;
    document.body.focus({ preventScroll: true });
  } catch (_) {
    /* ignore */
  }
  setTimeout(focusPrint, PRINT_GUARD_MS);
  if (window.ResizeObserver) {
    new ResizeObserver(() => fitSheets()).observe(els.stage);
  } else {
    window.addEventListener('resize', fitSheets);
  }
  loadPrinters()
    .then(() => {
      const wanted =
        saved?.printer ||
        saved?.printerName ||
        (job.settings || {}).printer ||
        (job.settings || {}).printerName;
      if (wanted && els.printer) {
        if (![...els.printer.options].some((o) => o.value === wanted)) {
          const opt = document.createElement('option');
          opt.value = wanted;
          opt.textContent = printerOptionText({ name: wanted });
          els.printer.appendChild(opt);
        }
        els.printer.value = wanted;
      } else if (saved && Object.prototype.hasOwnProperty.call(saved, 'printer')) {
        els.printer.value = saved.printer || '';
      }
      syncTypeSelect();
      syncPaperForPrinter();
      enforcePinMargins();
      // Printer type is only known now and it decides the hatch offsets.
      renderJob();
      persistUiPrefs();
      if (!keyboardPrintBlocked()) focusPrint();
    })
    .catch(() => {});
}

window.addEventListener('error', (event) => {
  setStatus('页面出错：' + (event.error?.message || event.message || '未知错误'));
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  setStatus('页面出错：' + (reason?.message || String(reason)));
});

boot().catch((err) => setStatus(err.message || String(err)));
