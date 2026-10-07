const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tpcl.js');

test('text registers as a slice with palette entry, renderer and a TPCL hook factory', () => {
  const text = PB.components.get('text');
  assert.ok(text);
  assert.deepEqual([text.label, text.glyph], ['Texto', 'Aa']);
  assert.equal(typeof text.render, 'function');
  assert.equal(typeof text.languages.tpcl, 'function');
});

test('forItem resolves text items to the text slice', () => {
  assert.equal(PB.components.forItem({ kind: 'text', ref: 'PV01' }).kind, 'text');
  assert.equal(PB.components.forItem({ kind: 'text', ref: 'PC01' }).kind, 'text');
});

test('TPCL hooks of text: PC and PV parse, move, edit and build', () => {
  const hooks = PB.components.get('text').languages.tpcl({
    sourceOf: () => ({}), insertCommand: (t, c) => t + c, pad4: n => String(n).padStart(4, '0'),
    clampCoord: n => n, numberField: () => ({}), rotationField: () => ({}),
    nextId: () => '01', freePlaceholder: () => '<#TEXTO1#>',
    ROTATIONS: {}, ROTATION_STEPS: [0, 90, 180, 270], ROTATION_CODES: { 0: '00', 90: '11', 180: '22', 270: '33' }, MAX_COORD: 9999,
  });
  assert.equal(hooks.handlers.length, 2);
  assert.equal(hooks.coordinates.length, 1);
  assert.equal(hooks.editable.length, 2);
  assert.equal(hooks.build('', { x: 10, y: 20 }), '{PV01;0010,0020,0060,0080,B,00,B|}{RV01;<#TEXTO1#>|}');
});

test('slice order is a number that sorts the registry and the palette deterministically', () => {
  assert.equal(typeof PB.components.get('text').order, 'number');
  const orders = PB.components.all().map(def => def.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.deepEqual(PB.components.kinds(), ['text', 'barcode', 'line', 'box']);
  assert.deepEqual(PB.languages.get('tpcl').componentTemplates().map(c => c.kind), ['text', 'barcode', 'qr', 'line', 'box']);
});
