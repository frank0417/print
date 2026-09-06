import { PAPER_PRESETS } from './paper.js';

export const PREFS_KEY = 'printkit.previewPrefs';

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
