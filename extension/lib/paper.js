/** Paper presets in millimeters (width x height, portrait). */
export const PAPER_PRESETS = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  B4: { width: 250, height: 353 },
  B5: { width: 176, height: 250 },
  Letter: { width: 216, height: 279 },
  Legal: { width: 216, height: 356 },
  Tabloid: { width: 279, height: 432 },
};

export function resolvePaper(settings = {}) {
  const name = settings.paperName || settings.paper || 'A4';
  const preset = PAPER_PRESETS[name] || PAPER_PRESETS.A4;
  let width = Number(settings.pageWidth || settings.width || preset.width);
  let height = Number(settings.pageHeight || settings.height || preset.height);

  // jatools: orientation 1 = portrait, 2 = landscape
  const orientation = Number(settings.orientation || 1);
  if (orientation === 2 && width < height) {
    [width, height] = [height, width];
  } else if (orientation === 1 && width > height && !settings.pageWidth) {
    // keep preset portrait unless custom size provided
  }

  return {
    paperName: PAPER_PRESETS[name] ? name : 'Custom',
    widthMm: width,
    heightMm: height,
    orientation: orientation === 2 ? 2 : 1,
  };
}

export function mmToCss(mm) {
  return `${Number(mm)}mm`;
}

export function normalizeMargins(settings = {}) {
  // Default 0mm — label/waybill printers blur badly with 10mm + fit-to-page.
  const n = (v, fallback = 0) => {
    if (v === 0 || v === '0') return 0;
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
