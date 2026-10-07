const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tpcl.js');

test('line and box register as slices keyed by component id, both with the line model kind', () => {
  const line = PB.components.get('line');
  const box = PB.components.get('box');
  assert.ok(line && box);
  assert.equal(line.modelKind, 'line');
  assert.equal(box.modelKind, 'line');
  assert.deepEqual([line.label, line.glyph, box.label, box.glyph], ['Línea', '─', 'Caja', '▭']);
});

test('forItem resolves a model item to its slice', () => {
  assert.equal(PB.components.forItem({ kind: 'line', rect: false }).kind, 'line');
  assert.equal(PB.components.forItem({ kind: 'line', rect: true }).kind, 'box');
  assert.equal(PB.components.forItem({ kind: 'line' }).kind, 'line');
  assert.equal(PB.components.forItem({ kind: 'image' }), undefined);
  assert.equal(PB.components.forItem(null), undefined);
});

test('slices provide render, validation flag and a TPCL hook factory', () => {
  for (const id of ['line', 'box']) {
    const def = PB.components.get(id);
    assert.equal(typeof def.render, 'function');
    assert.equal(def.carriesData, false);
    assert.equal(typeof def.languages.tpcl, 'function');
  }
});

test('TPCL hooks: line owns parse, move and edit; both build', () => {
  const stub = {
    sourceOf: () => ({}), insertCommand: (t, c) => t + c, pad4: n => String(n).padStart(4, '0'),
    clampCoord: n => n, numberField: () => ({}), MAX_COORD: 9999,
  };
  const line = PB.components.get('line').languages.tpcl(stub);
  const box = PB.components.get('box').languages.tpcl(stub);
  assert.equal(line.handlers.length, 1);
  assert.equal(line.coordinates.length, 1);
  assert.equal(line.editable.length, 1);
  assert.equal(line.build('', { x: 10, y: 20 }), '{LC;0010,0020,0410,0020,0,03|}');
  assert.equal(box.build('', { x: 10, y: 20 }), '{LC;0010,0020,0310,0220,1,03|}');
  assert.equal(box.handlers, undefined);
});

test('the TPCL language offers line and box in the palette after the not yet migrated kinds', () => {
  const kinds = PB.languages.get('tpcl').componentTemplates().map(c => c.kind);
  assert.deepEqual(kinds, ['text', 'barcode', 'qr', 'line', 'box']);
});
