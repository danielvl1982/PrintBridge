const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUpTo, manifest } = require('./helpers/load');

const CORE_FILES = [
  'diagnostics', 'units', 'barcode-data', 'sources', 'variables', 'languages', 'validator', 'sizes',
].map(name => `js/core/${name}.js`);

const PB = loadUpTo('js/drawing.js');

test('core is split into js/core/*.js, all in the manifest, and js/core.js is gone', () => {
  const files = manifest();
  for (const file of CORE_FILES) {
    assert.ok(files.includes(file), `${file} missing from the manifest`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${file} missing on disk`);
  }
  assert.ok(!files.includes('js/core.js'));
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'js', 'core.js')));
});

test('every public PB core name is published', () => {
  for (const name of ['diagnostics', 'units', 'barcodeData', 'sources', 'variables', 'languages', 'validator', 'sizes']) {
    assert.ok(PB[name], `PB.${name}`);
  }
});

/** Minimal stand-in for the painted SVG: only what PB.layout.analyze touches. */
function fakeSvg(groups) {
  const overlaps = { innerHTML: '' };
  return {
    overlaps,
    querySelectorAll: () => groups,
    querySelector: () => overlaps,
  };
}
const group = (index, bbox, text) => ({
  dataset: { index: String(index) },
  getBBox: () => bbox,
  querySelector: sel => (sel === 'text' ? text : null),
});

test('layout hook: line and box skip the layout checks, text measures its own boxes', () => {
  assert.equal(PB.components.get('line').layout({}, { kind: 'line' }), null);
  assert.equal(PB.components.get('box').layout({}, { kind: 'line', rect: true }), null);
  const text = PB.components.get('text');
  assert.equal(typeof text.layout, 'function');
  // blank text has nothing to measure: skipped like before
  assert.equal(text.layout(group(0, null, { textContent: '   ' }), { kind: 'text' }), null);
});

test('layout.analyze is generic: slices without a hook use the group box, a hook returning null skips the item', () => {
  const model = {
    items: [
      { ref: 'A', kind: 'line' },
      { ref: 'B', kind: 'image' },
      { ref: 'C', kind: 'image' },
    ],
  };
  const svg = fakeSvg([
    group(0, { x: 0, y: 0, width: 10, height: 10 }),
    group(1, { x: 0, y: 0, width: 50, height: 50 }),
    group(2, { x: 20, y: 20, width: 50, height: 50 }),
  ]);
  const out = PB.layout.analyze(svg, model, { width: 200, height: 200 }, { markOverlaps: true });
  assert.deepEqual(out.map(d => d.text), ['B se solapa con C']);
  assert.match(svg.overlaps.innerHTML, /class="overlap"/);

  const outside = fakeSvg([group(0, { x: 190, y: 0, width: 50, height: 10 })]);
  const res = PB.layout.analyze(outside, { items: [{ ref: 'X', kind: 'image' }] }, { width: 200, height: 200 }, { markOverlaps: false });
  assert.equal(res.length, 1);
  assert.match(res[0].text, /^X se sale de la etiqueta/);
});

test('barcode slice owns the "approximate drawing" validation rule', () => {
  assert.equal(typeof PB.components.get('barcode').validate, 'function');
  const item = { ref: 'B1', kind: 'barcode', symbology: 'unknown', native: { type: 'Z' }, data: '1' };
  assert.equal(PB.components.get('barcode').validate(item).length, 1);
  assert.equal(PB.components.get('barcode').validate({ ...item, symbology: 'code128' }).length, 0);
});
