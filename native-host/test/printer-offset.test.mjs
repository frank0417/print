import assert from 'assert';
import { normalizeOffset, offsetForPrinter, applyPrinterOffset } from '../../extension/lib/offsets.js';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok  ' + name);
  } catch (err) {
    failures += 1;
    console.log('FAIL  ' + name);
    console.log('  ' + (err && err.stack ? err.stack : err));
  }
}

check('normalizeOffset defaults to 0,0', () => {
  assert.deepStrictEqual(normalizeOffset(null), { offsetX: 0, offsetY: 0 });
});

check('offsetForPrinter is keyed by printer name', () => {
  const all = {
    'HP LaserJet': { offsetX: 1.2, offsetY: -0.5 },
    'EPSON LQ-630K': { offsetX: 0, offsetY: 2 },
  };
  assert.deepStrictEqual(offsetForPrinter(all, 'HP LaserJet'), { offsetX: 1.2, offsetY: -0.5 });
  assert.deepStrictEqual(offsetForPrinter(all, 'EPSON LQ-630K'), { offsetX: 0, offsetY: 2 });
  assert.deepStrictEqual(offsetForPrinter(all, 'Other'), { offsetX: 0, offsetY: 0 });
});

check('applyPrinterOffset fills only missing values', () => {
  const filled = applyPrinterOffset(
    { printer: 'HP LaserJet' },
    { 'HP LaserJet': { offsetX: 3, offsetY: 4 } }
  );
  assert.strictEqual(filled.offsetX, 3);
  assert.strictEqual(filled.offsetY, 4);
  const kept = applyPrinterOffset(
    { printer: 'HP LaserJet', offsetX: 9, offsetY: 0 },
    { 'HP LaserJet': { offsetX: 3, offsetY: 4 } }
  );
  assert.strictEqual(kept.offsetX, 9);
  assert.strictEqual(kept.offsetY, 0);
});

if (failures) {
  console.log(failures + ' failed');
  process.exit(1);
}
console.log('all passed');
