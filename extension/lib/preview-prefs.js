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

/**
 * Last toolbar config overlays the page job. Named paper (A4/B5/…)
 * drops inferred pageWidth/pageHeight so the preset actually applies.
 */
export function mergeWithSavedPrefs(jobSettings, saved) {
  const out = { ...(jobSettings || {}) };
  if (!saved || typeof saved !== 'object') return out;

  const printer = saved.printer || saved.printerName;
  if (saved.paperName != null) out.paperName = saved.paperName;
  if (saved.orientation === 1 || saved.orientation === 2) {
    out.orientation = saved.orientation;
  }
  if (saved.copies != null) out.copies = saved.copies;
  if (Object.prototype.hasOwnProperty.call(saved, 'printer') || saved.printerName) {
    out.printer = printer || undefined;
  }
  if (saved.marginTop != null) out.marginTop = saved.marginTop;
  if (saved.marginRight != null) out.marginRight = saved.marginRight;
  if (saved.marginBottom != null) out.marginBottom = saved.marginBottom;
  if (saved.marginLeft != null) out.marginLeft = saved.marginLeft;

  if (saved.paperName && PAPER_PRESETS[saved.paperName]) {
    delete out.pageWidth;
    delete out.pageHeight;
    delete out.width;
    delete out.height;
  } else if (saved.paperName === 'Custom') {
    if (saved.pageWidth != null) out.pageWidth = saved.pageWidth;
    if (saved.pageHeight != null) out.pageHeight = saved.pageHeight;
  }

  return out;
}
