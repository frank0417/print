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
  loadPrinterOffsets,
  savePrinterOffset,
  offsetForPrinter,
  normalizeOffset,
} from '../lib/preview-prefs.js';

const params = new URLSearchParams(location.search);
const jobId = params.get('jobId');
const demoKind = params.get('demo');
const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;

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
  printerKind: document.getElementById('printerKind'),
  pageWidth: document.getElementById('pageWidth'),
  pageHeight: document.getElementById('pageHeight'),
  pageNum: document.getElementById('pageNum'),
  pageTotal: document.getElementById('pageTotal'),
  zoomSelect: document.getElementById('zoomSelect'),
  paperModal: document.getElementById('paperModal'),
  offsetX: document.getElementById('offsetX'),
  offsetY: document.getElementById('offsetY'),
  offsetPrinter: document.getElementById('offsetPrinter'),
  bgPath: document.getElementById('bgPath'),
  bgFile: document.getElementById('bgFile'),
  bgOpacity: document.getElementById('bgOpacity'),
  bgOpacityVal: document.getElementById('bgOpacityVal'),
  btnBgClear: document.getElementById('btnBgClear'),
};

let job = null;
let printing = false;
let printerList = [];
let typeOverrides = {};
let printerOffsets = {};
let zoomMode = '100';
let currentPage = 0;
let saveTimer = 0;
let modalSnapshot = null;
let backgroundImage = '';
let backgroundName = '';
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

function send(message) {
  if (!hasRuntime) return Promise.reject(new Error('演示模式：未连接扩展'));
  return chrome.runtime.sendMessage(message);
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
  els.printerKind.title =
    override && override !== detected
      ? `已手动改为「${printerTypeLabel(override)}」，自动识别为「${printerTypeLabel(detected)}」`
      : `自动识别为「${printerTypeLabel(detected)}」，认错了可以改，只对当前打印机生效`;
}

function syncOffsetUi() {
  const name = resolvedPrinterName() || '默认打印机';
  const saved = offsetForPrinter(printerOffsets, resolvedPrinterName());
  if (els.offsetX) els.offsetX.value = String(saved.offsetX);
  if (els.offsetY) els.offsetY.value = String(saved.offsetY);
  if (els.offsetPrinter) {
    els.offsetPrinter.textContent = `当前打印机：${name}（换机不用重调）`;
  }
}

function orientationValue() {
  const checked = document.querySelector('input[name="orientation"]:checked');
  if (checked) return Number(checked.value);
  return Number(els.orientation?.value) || 1;
}

function setOrientation(v) {
  const n = Number(v) === 2 ? 2 : 1;
  if (els.orientation) els.orientation.value = String(n);
  const r = document.getElementById(`orient${n}`);
  if (r) r.checked = true;
}

function backgroundFit() {
  const el = document.querySelector('input[name="bgFit"]:checked');
  return el ? el.value : 'fill';
}

function setBackgroundFit(v) {
  const el = document.querySelector(`input[name="bgFit"][value="${v}"]`);
  if (el) el.checked = true;
}

function readSettingsFromUi() {
  const paperName = els.paperName.value;
  const ui = {
    paperName,
    orientation: orientationValue(),
    copies: Math.max(1, Number(els.copies.value) || 1),
    marginTop: Number(els.marginTop.value),
    marginRight: Number(els.marginRight.value),
    marginBottom: Number(els.marginBottom.value),
    marginLeft: Number(els.marginLeft.value),
    contentScale: normalizeContentScale(els.contentScale?.value),
    printer: els.printer?.value || '',
    offsetX: Number(els.offsetX?.value) || 0,
    offsetY: Number(els.offsetY?.value) || 0,
    backgroundImage: backgroundImage || '',
    backgroundOpacity: Number(els.bgOpacity?.value) || 35,
    backgroundFit: backgroundFit(),
    printBackground: false,
  };
  const w = Number(els.pageWidth?.value);
  const h = Number(els.pageHeight?.value);
  if (paperName === 'Custom') {
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
  delete prefs.backgroundImage;
  const name = resolvedPrinterName();
  printerOffsets = {
    ...printerOffsets,
    [name || '__default__']: normalizeOffset(ui),
  };
  savePrinterOffset(name, ui).catch(() => {});
  return savePreviewPrefs(prefs);
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistUiPrefs, 200);
}

function fillPaperSizeInputs(paperName, settings) {
  const named = PAPER_PRESETS[paperName];
  if (named) {
    if (els.pageWidth) els.pageWidth.value = String(named.width);
    if (els.pageHeight) els.pageHeight.value = String(named.height);
    return;
  }
  const w = Number(settings?.pageWidth || settings?.width);
  const h = Number(settings?.pageHeight || settings?.height);
  if (els.pageWidth) els.pageWidth.value = String(w || 210);
  if (els.pageHeight) els.pageHeight.value = String(h || 297);
}

function applySettingsToUi(settings = {}) {
  const pinMatch =
    matchPinSheet(settings.pageWidth || settings.width, settings.pageHeight || settings.height) ||
    (settings.paperName &&
    PAPER_PRESETS[settings.paperName] &&
    /^(Pin2|Pin3|PinFull)$/.test(settings.paperName)
      ? settings.paperName
      : null);
  const named = settings.paperName && PAPER_PRESETS[settings.paperName];
  if (pinMatch) {
    els.paperName.value = pinMatch;
    setOrientation(2);
  } else if (named) {
    els.paperName.value = settings.paperName;
    if (settings.orientation === 1 || settings.orientation === 2) {
      setOrientation(settings.orientation);
    }
  } else if (settings.paperName === 'Custom' || settings.pageWidth || settings.pageHeight) {
    els.paperName.value = 'Custom';
    if (settings.orientation === 1 || settings.orientation === 2) {
      setOrientation(settings.orientation);
    }
  } else if (settings.orientation === 1 || settings.orientation === 2) {
    setOrientation(settings.orientation);
  }
  fillPaperSizeInputs(els.paperName.value, settings);
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
  if (settings.offsetX != null && els.offsetX) els.offsetX.value = String(settings.offsetX);
  if (settings.offsetY != null && els.offsetY) els.offsetY.value = String(settings.offsetY);
  if (settings.backgroundImage) {
    backgroundImage = settings.backgroundImage;
    backgroundName = settings.backgroundName || '已选择底图';
    if (els.bgPath) els.bgPath.value = backgroundName;
    if (els.btnBgClear) els.btnBgClear.hidden = false;
  }
  if (settings.backgroundOpacity != null && els.bgOpacity) {
    els.bgOpacity.value = String(settings.backgroundOpacity);
    if (els.bgOpacityVal) els.bgOpacityVal.textContent = `${settings.backgroundOpacity}%`;
  }
  if (settings.backgroundFit) setBackgroundFit(settings.backgroundFit);
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

function pinZonesFor(settings, size) {
  const pinSheet =
    normalizePinSheetName(settings.paperName) || matchPinSheet(size.width, size.height);
  if (!pinSheet) return null;
  const printer = settings.printer || settings.printerName || resolvedPrinterName();
  if (resolvedPrinterType(printer) !== 'pin') return null;
  return pinUnprintable(printer, size.width);
}

function mappedLabel() {
  const ids = job?.mappedIds || job?.settings?.divMap?.ids || job?.pages?.map((p) => p.id);
  if (!ids || !ids.length) return 'DIV ID 映射';
  return `DIV ID 映射 ${ids.join(' → ')}`;
}

function statusLine(size) {
  const zoomLabel = zoomMode === 'fit' ? '适合窗口' : `${zoomMode}%`;
  const orientLabel = size.width >= size.height ? '横向' : '纵向';
  const off = normalizeOffset(readSettingsFromUi());
  const offText =
    off.offsetX || off.offsetY ? ` · 偏移 ${off.offsetX},${off.offsetY}mm` : '';
  return `${mappedLabel()} · ${job.pages.length} 页 · ${size.width}×${size.height}mm · ${orientLabel} · 预览 ${zoomLabel}${offText}`;
}

function bgSizeCss(fit) {
  if (fit === 'width') return '100% auto';
  if (fit === 'height') return 'auto 100%';
  return '100% 100%';
}

function renderSheet(page, settings, size, pad, zones, contentScale, offset) {
  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  sheet.style.width = `${size.width}mm`;
  sheet.style.height = `${size.height}mm`;
  sheet.style.minHeight = `${size.height}mm`;
  sheet.style.maxHeight = `${size.height}mm`;
  sheet.style.padding = `${pad.top}mm ${pad.right}mm ${pad.bottom}mm ${pad.left}mm`;

  if (backgroundImage) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg no-print';
    const opacity = Math.max(5, Math.min(100, Number(els.bgOpacity?.value) || 35)) / 100;
    bg.style.opacity = String(opacity);
    bg.style.backgroundImage = `url("${backgroundImage.replace(/"/g, '\\"')}")`;
    bg.style.backgroundSize = bgSizeCss(backgroundFit());
    bg.style.backgroundPosition = 'center top';
    sheet.appendChild(bg);
  }

  if (zones) {
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
  wrap.style.transform = `translate(${offset.offsetX || 0}mm, ${offset.offsetY || 0}mm)`;
  wrap.innerHTML = page.html;
  shadow.appendChild(wrap);
  sheet.appendChild(inner);
  for (const link of shadow.querySelectorAll('link[rel="stylesheet"]')) {
    link.addEventListener('load', () => fitContentWidth(wrap));
  }

  const label = document.createElement('div');
  label.className = 'sheet-label no-print';
  label.textContent = zones
    ? `#${page.id || 'page'} · ${size.width}×${size.height}mm · 斜纹区针头打不到`
    : `#${page.id || 'page'} · ${size.width}×${size.height}mm`;
  sheet.appendChild(label);

  const fit = document.createElement('div');
  fit.className = 'sheet-fit';
  fit.appendChild(sheet);
  return { fit, wrap };
}

function renderJob() {
  if (!job) return;
  const settings = mergedSettings();
  const size = resolveSize(settings);
  const margins = normalizeMargins(settings);
  ensurePrintStyle(settings);

  els.stage.innerHTML = '';

  const zones = pinZonesFor(settings, size);
  const pad = pinContentMargins(margins, zones);
  const contentScale = normalizeContentScale(settings.contentScale) / 100;
  const offset = normalizeOffset(settings);

  const pages = job.pages || [];
  if (!pages.length) {
    setStatus('没有可映射的 DIV 页');
    return;
  }
  currentPage = Math.max(0, Math.min(currentPage, pages.length - 1));
  if (els.pageNum) els.pageNum.value = String(currentPage + 1);
  if (els.pageTotal) els.pageTotal.textContent = String(pages.length);

  const page = pages[currentPage];
  const { fit, wrap } = renderSheet(page, settings, size, pad, zones, contentScale, offset);
  els.stage.appendChild(fit);
  fitContentWidth(wrap);

  document.title = job.title || 'PrintKit 打印';
  setStatus(statusLine(size));
  syncPagerButtons();
  requestAnimationFrame(fitSheets);
}

function fitContentWidth(el) {
  if (!el) return;
  const base = Number(el.dataset.scale) || 1;
  el.style.zoom = String(base);
  const cw = el.clientWidth;
  const sw = el.scrollWidth;
  if (sw > cw + 1) el.style.zoom = String((base * cw) / sw);
}

function normalizeContentScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(200, Math.max(50, Math.round(n)));
}

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

function officePaperSelected() {
  return /^(A3|A4|A5|B4|B5|Letter|Legal|Tabloid)$/i.test(els.paperName?.value || '');
}

function syncPaperForPrinter() {
  if (!els.printer || !els.paperName) return false;
  if (!isPinSelected()) return false;
  if (officePaperSelected()) {
    els.paperName.value = 'Pin2';
    setOrientation(2);
    fillPaperSizeInputs('Pin2');
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
        setOrientation(2);
        fillPaperSizeInputs('Pin2');
        return true;
      }
    }
  }
  return false;
}

function setZoomMode(mode) {
  zoomMode = mode;
  if (els.zoomSelect) els.zoomSelect.value = mode === 'fit' ? 'fit' : String(mode);
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

function syncPagerButtons() {
  const n = job?.pages?.length || 1;
  const atFirst = currentPage <= 0;
  const atLast = currentPage >= n - 1;
  const map = {
    btnFirst: atFirst,
    btnPrev: atFirst,
    btnNext: atLast,
    btnLast: atLast,
  };
  for (const [id, disabled] of Object.entries(map)) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  }
}

function goPage(index) {
  if (!job) return;
  const n = job.pages.length;
  currentPage = Math.max(0, Math.min(n - 1, index));
  renderJob();
}

function openModal() {
  modalSnapshot = {
    paperName: els.paperName.value,
    orientation: orientationValue(),
    pageWidth: els.pageWidth?.value,
    pageHeight: els.pageHeight?.value,
    copies: els.copies.value,
    marginTop: els.marginTop.value,
    marginRight: els.marginRight.value,
    marginBottom: els.marginBottom.value,
    marginLeft: els.marginLeft.value,
    contentScale: els.contentScale?.value,
    offsetX: els.offsetX?.value,
    offsetY: els.offsetY?.value,
    backgroundImage,
    backgroundName,
    bgOpacity: els.bgOpacity?.value,
    bgFit: backgroundFit(),
  };
  if (els.paperModal) els.paperModal.hidden = false;
}

function closeModal(revert) {
  if (revert && modalSnapshot) {
    els.paperName.value = modalSnapshot.paperName;
    setOrientation(modalSnapshot.orientation);
    if (els.pageWidth) els.pageWidth.value = modalSnapshot.pageWidth;
    if (els.pageHeight) els.pageHeight.value = modalSnapshot.pageHeight;
    els.copies.value = modalSnapshot.copies;
    els.marginTop.value = modalSnapshot.marginTop;
    els.marginRight.value = modalSnapshot.marginRight;
    els.marginBottom.value = modalSnapshot.marginBottom;
    els.marginLeft.value = modalSnapshot.marginLeft;
    if (els.contentScale) els.contentScale.value = modalSnapshot.contentScale;
    if (els.offsetX) els.offsetX.value = modalSnapshot.offsetX;
    if (els.offsetY) els.offsetY.value = modalSnapshot.offsetY;
    backgroundImage = modalSnapshot.backgroundImage;
    backgroundName = modalSnapshot.backgroundName;
    if (els.bgPath) els.bgPath.value = backgroundName || '';
    if (els.bgOpacity) els.bgOpacity.value = modalSnapshot.bgOpacity;
    if (els.bgOpacityVal) els.bgOpacityVal.textContent = `${modalSnapshot.bgOpacity}%`;
    setBackgroundFit(modalSnapshot.bgFit);
    if (els.btnBgClear) els.btnBgClear.hidden = !backgroundImage;
    renderJob();
  }
  if (els.paperModal) els.paperModal.hidden = true;
  modalSnapshot = null;
}

function bindUi() {
  printGuardUntil = Date.now() + PRINT_GUARD_MS;

  const liveEls = [
    els.paperName,
    els.copies,
    els.printer,
    els.marginTop,
    els.marginRight,
    els.marginBottom,
    els.marginLeft,
    els.contentScale,
    els.pageWidth,
    els.pageHeight,
    els.offsetX,
    els.offsetY,
    els.bgOpacity,
  ];
  for (const el of liveEls) {
    el?.addEventListener('change', () => {
      if (el === els.printer) {
        syncTypeSelect();
        syncPaperForPrinter();
        syncOffsetUi();
      }
      if (el === els.paperName) {
        if (/^(Pin2|Pin3|PinFull)$/.test(els.paperName.value)) setOrientation(2);
        fillPaperSizeInputs(els.paperName.value, job?.settings);
      }
      renderJob();
      persistUiPrefs();
    });
    el?.addEventListener('input', () => {
      if (el === els.bgOpacity && els.bgOpacityVal) {
        els.bgOpacityVal.textContent = `${els.bgOpacity.value}%`;
      }
      renderJob();
      schedulePersist();
    });
  }

  document.querySelectorAll('input[name="orientation"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      setOrientation(radio.value);
      renderJob();
      persistUiPrefs();
    });
  });
  document.querySelectorAll('input[name="bgFit"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      renderJob();
      schedulePersist();
    });
  });

  els.zoomSelect?.addEventListener('change', () => {
    setZoomMode(els.zoomSelect.value);
  });
  document.getElementById('btnZoomOut')?.addEventListener('click', () => {
    const steps = ['fit', '50', '75', '100', '125', '150', '200'];
    const i = Math.max(0, steps.indexOf(String(zoomMode)));
    if (i > 0) setZoomMode(steps[i - 1]);
  });
  document.getElementById('btnZoomIn')?.addEventListener('click', () => {
    const steps = ['fit', '50', '75', '100', '125', '150', '200'];
    const i = steps.indexOf(String(zoomMode));
    const next = i < 0 ? '100' : steps[Math.min(steps.length - 1, i + 1)];
    setZoomMode(next);
  });
  document.getElementById('btnFit')?.addEventListener('click', () => setZoomMode('fit'));
  document.getElementById('btnRotLeft')?.addEventListener('click', () => {
    setOrientation(orientationValue() === 1 ? 2 : 1);
    renderJob();
    persistUiPrefs();
  });
  document.getElementById('btnRotRight')?.addEventListener('click', () => {
    setOrientation(orientationValue() === 1 ? 2 : 1);
    renderJob();
    persistUiPrefs();
  });

  document.getElementById('btnFirst')?.addEventListener('click', () => goPage(0));
  document.getElementById('btnPrev')?.addEventListener('click', () => goPage(currentPage - 1));
  document.getElementById('btnNext')?.addEventListener('click', () => goPage(currentPage + 1));
  document.getElementById('btnLast')?.addEventListener('click', () => goPage((job?.pages?.length || 1) - 1));
  els.pageNum?.addEventListener('change', () => {
    goPage((Number(els.pageNum.value) || 1) - 1);
  });

  els.btnSettings?.addEventListener('click', (event) => {
    event.preventDefault();
    openModal();
  });
  document.getElementById('btnModalOk')?.addEventListener('click', () => {
    persistUiPrefs();
    closeModal(false);
  });
  document.getElementById('btnModalClose')?.addEventListener('click', () => closeModal(true));
  document.getElementById('btnModalX')?.addEventListener('click', () => closeModal(true));
  els.paperModal?.addEventListener('click', (event) => {
    if (event.target === els.paperModal) closeModal(true);
  });

  document.getElementById('btnBgPick')?.addEventListener('click', () => els.bgFile?.click());
  els.bgFile?.addEventListener('change', () => {
    const file = els.bgFile.files && els.bgFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      backgroundImage = String(reader.result || '');
      backgroundName = file.name;
      if (els.bgPath) els.bgPath.value = file.name;
      if (els.btnBgClear) els.btnBgClear.hidden = false;
      renderJob();
      schedulePersist();
    };
    reader.readAsDataURL(file);
  });
  els.btnBgClear?.addEventListener('click', () => {
    backgroundImage = '';
    backgroundName = '';
    if (els.bgPath) els.bgPath.value = '';
    if (els.bgFile) els.bgFile.value = '';
    els.btnBgClear.hidden = true;
    renderJob();
    schedulePersist();
  });

  document.querySelector('.nudge')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-nudge]');
    if (!btn) return;
    const [axis, dir] = btn.getAttribute('data-nudge').split(':');
    const step = event.shiftKey ? 1 : 0.1;
    const target = axis === 'x' ? els.offsetX : els.offsetY;
    if (!target) return;
    const next = Math.round((Number(target.value) + Number(dir) * step) * 10) / 10;
    target.value = String(next);
    renderJob();
    schedulePersist();
  });

  els.printerKind?.addEventListener('change', async () => {
    const name = resolvedPrinterName();
    const chosen = els.printerKind.value || '';
    const detected = detectedPrinterType(name) || 'laser';
    typeOverrides = await savePrinterTypeOverride(name, chosen === detected ? null : chosen);
    syncTypeSelect();
    syncPaperForPrinter();
    renderJob();
  });

  async function doPrint() {
    if (printing) return;
    if (keyboardPrintBlocked()) return;
    printing = true;
    if (els.btnPrint) els.btnPrint.disabled = true;
    try {
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
      settings.offsetX = ui.offsetX;
      settings.offsetY = ui.offsetY;
      settings.printBackground = false;
      delete settings.backgroundImage;
      delete settings.contentWidth;
      delete settings.contentHeight;
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
      if (!hasRuntime || !jobId) {
        setStatus('演示模式：DIV ID 映射预览已就绪，加载扩展后即可出纸');
        return;
      }
      const res = await send({
        type: 'PRINT_FROM_PREVIEW',
        jobId,
        settings,
      });
      if (res?.ok === false || res?.error) {
        setStatus(res.error || '打印失败');
        return;
      }
      const copies = res.copies || settings.copies || 1;
      setStatus(`已发送到 ${res.printer || '默认打印机'} · ${copies} 份 · ${res.method || '高清'}`);
      try {
        await send({ type: 'CLOSE_PREVIEW', jobId });
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

  els.btnPrint?.addEventListener('click', (event) => {
    event.preventDefault();
    if (event.detail === 0 && keyboardPrintBlocked()) return;
    releasePrintGuard();
    doPrint();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.paperModal && !els.paperModal.hidden) {
      closeModal(true);
      return;
    }
    if (event.key === 'ArrowLeft' && !event.target.closest('input, select, textarea')) {
      goPage(currentPage - 1);
      return;
    }
    if (event.key === 'ArrowRight' && !event.target.closest('input, select, textarea')) {
      goPage(currentPage + 1);
      return;
    }
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
      if (jobId) await send({ type: 'CLOSE_PREVIEW', jobId });
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
  if (!els.printer || !hasRuntime) return;
  try {
    const res = await send({ type: 'GET_PRINTERS' });
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
    syncOffsetUi();
    if (res?.hostAvailable === false) {
      els.printer.title = '未安装本地打印代理，点打印将打开安装说明';
    }
  } catch (_) {
    /* keep default */
  }
}

function demoJob() {
  const invoice = `
    <div id="page1" style="font-family:'Songti SC','SimSun',serif;color:#1a1a1a;padding:8mm;">
      <div style="text-align:center;color:#b23;font-size:22px;letter-spacing:.4em;font-weight:700;">增值税电子普通发票</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin:8px 0 12px;color:#444;">
        <span>发票号码：99999951</span>
        <span>开票日期：2026年09月19日</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr>
          <td style="border:1px solid #9aa;padding:6px;width:18%;background:#f7f3ea;">购买方</td>
          <td style="border:1px solid #9aa;padding:6px;">演示商贸有限公司<br/>税号：91110000DEMO00001X</td>
        </tr>
        <tr>
          <td style="border:1px solid #9aa;padding:6px;background:#f7f3ea;">项目名称</td>
          <td style="border:1px solid #9aa;padding:6px;">*信息技术服务*打印控件授权</td>
        </tr>
        <tr>
          <td style="border:1px solid #9aa;padding:6px;background:#f7f3ea;">金额 / 税额</td>
          <td style="border:1px solid #9aa;padding:6px;">¥300.00　税额 ¥18.00　价税合计 ¥318.00</td>
        </tr>
        <tr>
          <td style="border:1px solid #9aa;padding:6px;background:#f7f3ea;">销售方</td>
          <td style="border:1px solid #9aa;padding:6px;">PrintKit 演示开票方</td>
        </tr>
      </table>
      <p style="font-size:12px;color:#666;margin-top:16px;">本页由 DIV id="page1" 映射输出 · 屏幕什么样，纸上就是什么样</p>
    </div>`;
  const copy = invoice.replace('id="page1"', 'id="page2"').replace('发票号码：99999951', '发票号码：99999951（副本）');
  return {
    id: 'demo',
    title: 'DIV ID 映射打印演示',
    pages: [
      { index: 1, id: 'page1', html: invoice },
      { index: 2, id: 'page2', html: copy },
    ],
    mappedIds: ['page1', 'page2'],
    stylesheets: [],
    settings: {
      paperName: 'A5',
      orientation: 2,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
    },
  };
}

async function boot() {
  if (!jobId && !demoKind) {
    job = demoJob();
  } else if (!jobId && demoKind) {
    job = demoJob();
  } else if (!hasRuntime) {
    setStatus('缺少扩展运行时');
    job = demoJob();
  } else {
    send({ type: 'PREWARM_HOST' }).catch(() => {});
    const res = await send({ type: 'GET_JOB', jobId });
    if (res?.error) {
      setStatus(res.error);
      return;
    }
    job = res.job;
  }

  bindUi();
  if (hasRuntime) {
    typeOverrides = await loadPrinterTypeOverrides();
    printerOffsets = await loadPrinterOffsets();
  }
  const saved = hasRuntime ? await loadPreviewPrefs() : null;
  applySettingsToUi(job.settings || {});
  if (saved) {
    applySettingsToUi(saved);
    if (saved.zoomMode) zoomMode = saved.zoomMode;
  }
  const savedOff = offsetForPrinter(printerOffsets, resolvedPrinterName());
  if (els.offsetX && (savedOff.offsetX || savedOff.offsetY || !job.settings?.offsetX)) {
    els.offsetX.value = String(savedOff.offsetX);
    els.offsetY.value = String(savedOff.offsetY);
  }
  setZoomMode(zoomMode);
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
      syncOffsetUi();
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
