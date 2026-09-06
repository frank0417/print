/** Paper presets in millimeters (width x height, portrait unless noted). */
export const PAPER_PRESETS = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  B4: { width: 250, height: 353 },
  B5: { width: 176, height: 250 },
  Letter: { width: 216, height: 279 },
  Legal: { width: 216, height: 356 },
  Tabloid: { width: 279, height: 432 },
  // Chinese continuous / pin-feed forms (common 套打 sizes)
  Form241x140: { width: 241, height: 140 }, // 二等分
  Form241x93: { width: 241, height: 93 }, // 三等分
  Form241x280: { width: 241, height: 280 }, // 整张
  Form210x140: { width: 210, height: 140 },
};

/** CSS px → mm at 96dpi (browser default). */
export function pxToMm(px) {
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n * 25.4) / 96 * 100) / 100;
}

export function resolvePaper(settings = {}) {
  const name = settings.paperName || settings.paper || 'A4';
  const preset = PAPER_PRESETS[name] || PAPER_PRESETS.A4;
  let width = Number(settings.pageWidth || settings.width || preset.width);
  let height = Number(settings.pageHeight || settings.height || preset.height);

  // jatools: orientation 1 = portrait, 2 = landscape
  const orientation = Number(settings.orientation || 1);
  if (orientation === 2 && width < height) {
    [width, height] = [height, width];
  }

  return {
    paperName: PAPER_PRESETS[name] ? name : 'Custom',
    widthMm: width,
    heightMm: height,
    orientation: orientation === 2 ? 2 : 1,
  };
}

/**
 * Margins in mm.
 * Default is 0 — critical for 套打/absolute-positioned forms.
 * (Previously defaulted to 10mm, which shifted content right and clipped the right edge.)
 */
export function normalizeMargins(settings = {}) {
  const n = (v, fallback = 0) => {
    if (v === 0 || v === '0') return 0;
    if (v === undefined || v === null || v === '') return fallback;
    const num = Number(v);
    return Number.isFinite(num) ? num : fallback;
  };
  return {
    top: n(settings.marginTop ?? settings.topMargin, 0),
    right: n(settings.marginRight ?? settings.rightMargin, 0),
    bottom: n(settings.marginBottom ?? settings.bottomMargin, 0),
    left: n(settings.marginLeft ?? settings.leftMargin, 0),
  };
}

/** Fine-tune print position (mm). Positive offsetX moves content right. */
export function normalizeOffsets(settings = {}) {
  const n = (v) => {
    if (v === 0 || v === '0') return 0;
    const num = Number(v);
    return Number.isFinite(num) ? num : 0;
  };
  return {
    x: n(settings.offsetX ?? settings.printOffsetX ?? settings.leftOffset),
    y: n(settings.offsetY ?? settings.printOffsetY ?? settings.topOffset),
  };
}

export function mmToCss(mm) {
  return `${Number(mm)}mm`;
}
