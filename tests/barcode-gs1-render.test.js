const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Task S2 of odd/tasks/gs1-128.md: gs1-128 items are drawn through the Code 128 encoder and validated.
const PB = loadApp();
const { render, validate, measure } = PB.slices.barcode;
const FNC1 = PB.barcodeData.FNC1;
const ctx = { n: v => Math.round(v * 100) / 100, esc: s => s, rectsPath: rects => rects.map(r => r.join(' ')).join(';'), value: s => s };
const item = (data, extra = {}) => ({ kind: 'barcode', ref: 'B1', x: 0, y: 0, rotation: 0, module: 3, height: 100, humanReadable: true, symbology: 'gs1-128', data, ...extra });

test('gs1-128 is drawn exactly with the bars of Code 128 over the FNC1 data', () => {
  const data = '(01)09501101530003(17)250101(10)ABC123';
  const out = render(item(data), ctx);
  const plain = render(item(PB.gs1.toCode128Data(data), { symbology: 'code128' }), ctx);
  assert.equal(out.markup.match(/<path d="([^"]*)"/)[1], plain.markup.match(/<path d="([^"]*)"/)[1]);
  assert.match(out.info, /^GS1-128: /);
  assert.ok(!out.info.includes('aprox'));
});

test('the human readable line keeps the parentheses and no FNC1', () => {
  const out = render(item('(10)ABC(17)250101'), ctx);
  assert.match(out.markup, />\(10\)ABC\(17\)250101<\/text>/);
  assert.ok(!out.markup.includes(FNC1));
});

test('content that cannot be encoded draws the hatched box; measure is 0', () => {
  const out = render(item('(99)123'), ctx);
  assert.match(out.markup, /not-generated/);
  assert.equal(measure(item('(99)123')), 0);
  assert.ok(measure(item('(00)000422730000001131')) > 0);
});

test('validate: valid gs1-128 has no diagnostics, structural problems are errors', () => {
  assert.deepEqual(validate(item('(00)000422730000001131')), []);
  const bad = validate(item('(00)000422730000001132'));
  assert.equal(bad.length, 1);
  assert.equal(bad[0].level, 'error');
  assert.match(bad[0].text, /^B1: /);
  assert.equal(validate(item('(99)1'))[0].level, 'error');
});

test('validate: warnings for the unverified rules; variables are not validated', () => {
  assert.deepEqual(validate(item('(15)250100')).map(d => d.level), ['warning']);
  assert.deepEqual(validate(item('(10)#lot#')), []);
});

test('the selector label lists gs1-128', () => {
  assert.equal(PB.slices.barcode.selector.LABELS['gs1-128'], 'GS1-128');
});
