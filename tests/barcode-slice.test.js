const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tpcl.js');

test('barcode registers as a slice with palette entry, renderer and a TPCL hook factory', () => {
  const barcode = PB.components.get('barcode');
  assert.ok(barcode);
  assert.deepEqual([barcode.label, barcode.glyph, barcode.order], ['Código de barras', '|||', 20]);
  assert.equal(typeof barcode.render, 'function');
  assert.equal(typeof barcode.languages.tpcl, 'function');
});

test('forItem resolves barcode items to the barcode slice; qr to its own slice', () => {
  assert.equal(PB.components.forItem({ kind: 'barcode', ref: 'XB01' }).kind, 'barcode');
  assert.equal(PB.components.forItem({ kind: 'qr', ref: 'XB02' }).kind, 'qr');
});

test('the 1D encoders keep their public PB names and live in the slice', () => {
  for (const name of ['code128', 'code39', 'itf']) assert.equal(typeof PB[name].encode, 'function');
});

test('TPCL hooks of barcode: two parse handlers, move, two edit shapes and build', () => {
  const hooks = PB.components.get('barcode').languages.tpcl({
    sourceOf: () => ({}), insertCommand: (t, c) => t + c, pad4: n => String(n).padStart(4, '0'),
    clampCoord: n => n, numberField: () => ({}), rotationField: () => ({}),
    nextId: () => '01', freePlaceholder: () => '<#CODIGOBARRAS1#>', DIGITS: /^\d+$/,
    ROTATIONS: {}, ROTATION_STEPS: [0, 90, 180, 270], ROTATION_CODES: { 0: '00', 90: '11', 180: '22', 270: '33' }, MAX_COORD: 9999,
  });
  assert.equal(hooks.handlers.length, 2);
  assert.equal(hooks.coordinates.length, 1);
  assert.equal(hooks.editable.length, 2);
  assert.equal(hooks.build('', { x: 10, y: 20 }), '{XB01;0010,0020,9,1,02,0,0080,+0000000000,000,0,00|}{RB01;<#CODIGOBARRAS1#>|}');
});

test('barcode keeps the second palette position', () => {
  assert.deepEqual(PB.components.kinds(), ['text', 'barcode', 'qr', 'datamatrix', 'line', 'box', 'ellipse', 'circle', 'area', 'image']);
  assert.deepEqual(PB.languages.get('tpcl').componentTemplates().map(c => c.kind), ['text', 'barcode', 'qr', 'datamatrix', 'line', 'box', 'area']);
});
