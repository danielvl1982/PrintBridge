const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// V8 TSPL images, checked against the B-442/443 interface manual (docs/tspl, BITMAP at text line 848):
//   BITMAP X, Y, width, height, mode, bitmap data   width in bytes, height in dots, mode 0 overwrite, 1 OR, 2 XOR.
// The manual gives no range for X, Y, width or height; the code keeps its own safety limits (1250 bytes, 9999 dots).
const PB = loadUpTo('js/drawing.js');
const tspl = PB.languages.get('tspl');

const bytes = (...values) => String.fromCharCode(...values);
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const bitmap = (w, h, fill = 1) => ({ w, h, data: new Uint8Array(w * h).fill(fill) });

// ---- Parsing

test('parse: a BITMAP with mode 0, 1 or 2 and the whole payload raises no warning', () => {
  for (const mode of [0, 1, 2]) {
    assert.deepEqual(warnings(tspl.parse(`BITMAP 0,0,1,1,${mode},${bytes(0xFF)}`)), [], `mode ${mode}`);
  }
});

test('parse: a mode outside 0..2 warns with the valid modes and the image is drawn as overwrite', () => {
  for (const mode of ['3', '-1', '7', '1.5']) {
    const model = tspl.parse(`BITMAP 0,0,1,1,${mode},${bytes(0x00)}`);
    const w = warnings(model);
    assert.equal(w.length, 1, mode);
    assert.match(w[0], /modo/, mode);
    assert.match(w[0], /0, 1 o 2/, mode);
    assert.equal(model.items.length, 1, `${mode} is still drawn`);
    assert.equal(model.items[0].bitmap.data[0], 1, 'black dot drawn as overwrite');
  }
  assert.equal(tspl.parse(`BITMAP 0,0,1,1,3,${bytes(0x00)}`).items[0].native.mode, 3, 'native keeps the mode as written');
});

test('parse: a mode that is not a number is refused with a warning that states the modes', () => {
  const model = tspl.parse(`BITMAP 0,0,1,1,z,${bytes(0x00)}`);
  assert.equal(model.items.length, 0);
  assert.equal(warnings(model).length, 1);
  assert.match(warnings(model)[0], /0, 1 o 2/);
});

test('parse: a width or height below 1 (or not a whole number) is refused and the warning states the range', () => {
  for (const src of ['BITMAP 0,0,0,5,0,x', 'BITMAP 0,0,1,0,0,x', 'BITMAP 0,0,1.5,2,0,x', 'BITMAP 0,0,1,-2,0,x']) {
    const model = tspl.parse(src);
    assert.equal(model.items.length, 0, src);
    assert.equal(warnings(model).length, 1, src);
    assert.match(warnings(model)[0], /ancho en bytes/, src);
    assert.match(warnings(model)[0], /1\.\.1250/, src);
    assert.match(warnings(model)[0], /1\.\.9999/, src);
  }
});

test('parse: a size over the limits of the viewer is not drawn and the warning states the range', () => {
  const model = tspl.parse('BITMAP 0,0,1251,1,0,x');
  assert.equal(model.items.length, 0);
  assert.match(warnings(model)[0], /1\.\.1250/);
  assert.match(warnings(model)[0], /1\.\.9999/);
});

test('parse: a missing argument or payload keeps its own warning', () => {
  const model = tspl.parse('BITMAP 10,10');
  assert.equal(model.items.length, 0);
  assert.equal(warnings(model).length, 1);
  assert.match(warnings(model)[0], /BITMAP/);
});

// ---- Insertion from the overlay (imageCommand)

test('imageCommand: a size that is not a positive whole number of dots is refused with a Spanish error', () => {
  for (const [w, h] of [[0, 4], [4, 0], [-8, 2], [2.5, 2], [8, NaN]]) {
    assert.throws(() => tspl.imageCommand({ xMm: 0, yMm: 0, w, h, data: new Uint8Array(8), dpi: 203 }), /puntos/, `${w}x${h}`);
  }
});

test('imageCommand: data that does not hold w x h dots is refused (no payload mismatch is ever written)', () => {
  assert.throws(() => tspl.imageCommand({ xMm: 0, yMm: 0, w: 8, h: 2, data: new Uint8Array(10), dpi: 203 }), /w×h|datos/);
  assert.throws(() => tspl.imageCommand({ xMm: 0, yMm: 0, w: 8, h: 2, data: null, dpi: 203 }), /w×h|datos/);
});

test('imageCommand: a negative position is refused with an error naming the unit instead of being moved to 0', () => {
  assert.throws(() => tspl.imageCommand({ xMm: '-3', yMm: '0', ...bitmap(8, 1), dpi: 203 }), /posición X/);
  assert.throws(() => tspl.imageCommand({ xMm: '0', yMm: '-0,5', ...bitmap(8, 1), dpi: 203 }), /posición Y/);
  assert.doesNotThrow(() => tspl.imageCommand({ xMm: '', yMm: '0', ...bitmap(8, 1), dpi: 203 }), 'empty counts as 0');
});

test('imageCommand: a size over the viewer limit names the range in the error', () => {
  assert.throws(() => tspl.imageCommand({ xMm: 0, yMm: 0, w: 10001, h: 1, data: new Uint8Array(10001), dpi: 203 }), /1250/);
});

test('imageCommand: a width that is not a whole number of bytes is padded and the header counts the padded bytes', () => {
  const command = tspl.imageCommand({ xMm: 0, yMm: 0, ...bitmap(10, 2), dpi: 203 });
  const [, widthBytes, height, mode, payload] = /^BITMAP 0,0,(\d+),(\d+),(\d),([\s\S]*)$/.exec(command);
  assert.equal(widthBytes, '2');
  assert.equal(height, '2');
  assert.equal(mode, '0');
  assert.equal(payload.length, 4);
});

// ---- Emit

test('emit: an image of an out-of-range size is skipped once with a warning that states the limits', () => {
  const model = {
    language: 'tspl', size: { width: 1000, height: 600, pitch: null, gap: null, native: {} },
    items: [{ kind: 'image', x: 0, y: 0, width: 10, height: 10, bitmap: bitmap(10001, 1), data: null },
      { kind: 'image', x: 0, y: 0, width: 10, height: 10, bitmap: bitmap(8, 10000), data: null }],
    diagnostics: [],
  };
  const out = PB.languages.emit('tspl', model, { dpi: 203 });
  assert.ok(!/BITMAP/.test(out.text));
  const w = out.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
  assert.equal(w.length, 1);
  assert.match(w[0], /10000×9999/);
});

test('emit: a negative position of an image is written as 0 and reported once', () => {
  const model = {
    language: 'tspl', size: { width: 1000, height: 600, pitch: null, gap: null, native: {} },
    items: [{ kind: 'image', x: -50, y: -20, width: 10, height: 10, bitmap: bitmap(8, 1), data: null }],
    diagnostics: [],
  };
  const out = PB.languages.emit('tspl', model, { dpi: 203 });
  assert.match(out.text, /BITMAP 0,0,1,1,0,/);
  assert.ok(out.diagnostics.some(d => d.level === 'warning' && /BITMAP/.test(d.text) && /0/.test(d.text)));
});
