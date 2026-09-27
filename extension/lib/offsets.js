/** Per-printer 套打偏移（毫米）。换机不用重调。 */

function numOr(v, fallback) {
  if (v === 0 || v === '0') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeOffset(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    offsetX: numOr(src.offsetX ?? src.offsetLeft, 0),
    offsetY: numOr(src.offsetY ?? src.offsetTop, 0),
  };
}

export function printerKey(name) {
  return String(name || '') || '__default__';
}

export function offsetForPrinter(offsets, printerName) {
  const all = offsets || {};
  const key = printerKey(printerName);
  return normalizeOffset(all[key] || all[printerName] || {});
}

export function applyPrinterOffset(settings, offsets) {
  const out = { ...(settings || {}) };
  const name = String(out.printer || out.printerName || '');
  const saved = offsetForPrinter(offsets, name);
  if (out.offsetX == null) out.offsetX = saved.offsetX;
  if (out.offsetY == null) out.offsetY = saved.offsetY;
  return out;
}
