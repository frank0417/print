import { PAPER_PRESETS } from './paper.js';

export const PREFS_KEY = 'printkit.previewPrefs';
export const TYPE_OVERRIDES_KEY = 'printkit.printerTypeOverrides';
export const PRINTER_TYPE_VALUES = ['pin', 'laser', 'inkjet', 'virtual'];

export async function loadPreviewPrefs() {
  try {
    const data = await chrome.storage.local.get(PREFS_KEY);
    return data[PREFS_KEY] || null;
  } catch (_) {
    return null;
  }
}

export async function savePreviewPrefs(prefs) {
  try {
    await chrome.storage.local.set({ [PREFS_KEY]: prefs });
  } catch (_) {
    /* ignore quota / private mode */
  }
}

export function isPrinterType(v) {
  return PRINTER_TYPE_VALUES.indexOf(v) >= 0;
}

export async function loadPrinterTypeOverrides() {
  try {
    const data = await chrome.storage.local.get(TYPE_OVERRIDES_KEY);
    const raw = data[TYPE_OVERRIDES_KEY] || {};
    const out = {};
    for (const key of Object.keys(raw)) {
      if (isPrinterType(raw[key])) out[key] = raw[key];
    }
    return out;
  } catch (_) {
    return {};
  }
}

/** type=null/'' clears the override for that printer (back to auto). */
export async function savePrinterTypeOverride(printerName, type) {
  const all = await loadPrinterTypeOverrides();
  const key = String(printerName || '');
  if (!key) return all;
  if (!type || !isPrinterType(type)) delete all[key];
  else all[key] = type;
  try {
    await chrome.storage.local.set({ [TYPE_OVERRIDES_KEY]: all });
  } catch (_) {
    /* ignore */
  }
  return all;
}

export function applyPrinterTypeOverride(settings, overrides) {
  const out = { ...(settings || {}) };
  const name = String(out.printer || out.printerName || '');
  const t = name && overrides ? overrides[name] : '';
  if (isPrinterType(t)) {
    out.printerKind = t;
    out.printerKindSource = 'explicit';
    out.printerType = t;
  }
  return out;
}

function applyNamedPaper(out, paperName, overlay) {
  out.paperName = paperName;
  if (PAPER_PRESETS[paperName]) {
    delete out.pageWidth;
    delete out.pageHeight;
    delete out.width;
    delete out.height;
    if (/^Pin/.test(paperName)) {
      const preset = PAPER_PRESETS[paperName];
      out.pageWidth = preset.width;
      out.pageHeight = preset.height;
      out.orientation = 2;
      out.lockPageBox = true;
    }
    return;
  }
  if (paperName === 'Custom' && overlay) {
    if (overlay.pageWidth != null) out.pageWidth = overlay.pageWidth;
    if (overlay.pageHeight != null) out.pageHeight = overlay.pageHeight;
  }
}

/**
 * Toolbar / last-used prefs overlay the captured page.
 * Named paper (针式二等分, A4, …) replaces inferred mm so the dropdown actually
 * changes the sheet. Pin sheets always win — that is the physical paper.
 */
export function mergeWithSavedPrefs(jobSettings, overlay) {
  const out = { ...(jobSettings || {}) };
  if (!overlay || typeof overlay !== 'object') return out;

  const printer = overlay.printer || overlay.printerName;
  if (Object.prototype.hasOwnProperty.call(overlay, 'printer') || overlay.printerName) {
    out.printer = printer || undefined;
  }
  if (overlay.copies != null) out.copies = overlay.copies;

  if (overlay.paperName != null && overlay.paperName !== '') {
    applyNamedPaper(out, overlay.paperName, overlay);
  }

  if (!/^Pin/.test(String(out.paperName || '')) &&
      (overlay.orientation === 1 || overlay.orientation === 2)) {
    out.orientation = overlay.orientation;
  }

  if (overlay.marginTop != null) out.marginTop = overlay.marginTop;
  if (overlay.marginRight != null) out.marginRight = overlay.marginRight;
  if (overlay.marginBottom != null) out.marginBottom = overlay.marginBottom;
  if (overlay.marginLeft != null) out.marginLeft = overlay.marginLeft;

  return out;
}
