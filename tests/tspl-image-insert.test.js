const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TSPL image insertion: the preview picture is written into the label as a BITMAP command (imageCommand + insertCommand).
const PB = loadUpTo('js/drawing.js');
const tspl = PB.languages.get('tspl');

// 10 x 2 dots, 1 = black: row 0 all black, row 1 only the first dot
const BITMAP = { w: 10, h: 2, data: Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
const BASE = ['SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm', 'CLS', 'PRINT 1,1', ''].join('\r\n');

test('imageCommand writes BITMAP at the position in dots with inverted bits (0 = black)', () => {
  // 10 mm at 203 dpi = 80 dots, 5 mm = 40 dots
  const command = tspl.imageCommand({ xMm: '10', yMm: '5', ...BITMAP, dpi: 203 });
  assert.equal(command, `BITMAP 80,40,2,2,0,${String.fromCharCode(0x00, 0x3F, 0x7F, 0xFF)}`);
});

test('imageCommand accepts a comma decimal and treats an empty position as 0', () => {
  assert.match(tspl.imageCommand({ xMm: '2,5', yMm: '', ...BITMAP, dpi: 203 }), /^BITMAP 20,0,2,2,0,/);
});

test('a 0x0D byte of the payload is written as the editor placeholder', () => {
  // 8 dots wide: black dots 11110010 -> inverted byte 0x0D
  const data = Uint8Array.from([1, 1, 1, 1, 0, 0, 1, 0]);
  const command = tspl.imageCommand({ xMm: 0, yMm: 0, w: 8, h: 1, data, dpi: 203 });
  assert.equal(command, `BITMAP 0,0,1,1,0,${PB.tspl.CR_PLACEHOLDER}`);
});

test('inserted BITMAP goes before PRINT and parses back to the same bitmap', () => {
  const command = tspl.imageCommand({ xMm: '10', yMm: '5', ...BITMAP, dpi: 203 });
  const text = tspl.insertCommand(BASE, command);
  assert.ok(text.indexOf('BITMAP') < text.indexOf('PRINT'));
  const [item] = tspl.parse(text, { dpi: 203 }).items.filter(i => i.kind === 'image');
  assert.equal(item.bitmap.w, 16);
  assert.deepEqual(Array.from(item.bitmap.data.slice(0, 10)), Array.from(BITMAP.data.slice(0, 10)));
  assert.deepEqual(Array.from(item.bitmap.data.slice(16, 26)), Array.from(BITMAP.data.slice(10, 20)));
});
