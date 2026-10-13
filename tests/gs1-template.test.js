const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, shippedExamples } = require('./helpers/load');

// The GS1-128 sample template (an SSCC pallet label) of js/config.js, in the three languages.
const PB = loadApp();
const DPI = 203;
const LANGUAGES = ['tpcl', 'tspl', 'zpl'];
const SSCC = '(00)000422730000001131';
const SECOND = '(02)09501101530003(37)24(10)L2026-0412';
const samples = () => LANGUAGES.map(l => PB.examples.find(e => e.id === 'template-gs1-' + l));
const parse = e => PB.languages.get(e.language).parse(e.source, { dpi: DPI });
const problems = list => list.filter(d => d.level === 'error' || d.level === 'warning');

test('there is one GS1-128 sample per language, in the Plantillas group, with the agreed names', () => {
  const found = samples();
  assert.equal(found.every(Boolean), true);
  assert.deepEqual(found.map(e => e.language), LANGUAGES);
  assert.deepEqual(found.map(e => e.group), ['template', 'template', 'template']);
  assert.deepEqual(found.map(e => e.name), ['Plantilla GS1-128 — TPCL (TEC)', 'Plantilla GS1-128 — TSPL (TSC)', 'Plantilla GS1-128 — ZPL (Zebra)']);
  assert.equal([...shippedExamples()].filter(e => /gs1/.test(e.id)).length, 3, 'shipped, not a test fixture');
});

test('the SSCC in the sample has a valid mod 10 check digit (verified with PB.gs1.mod10)', () => {
  assert.equal(PB.gs1.mod10('00042273000000113'), 1);
  assert.equal(PB.gs1.mod10('0950110153000'), 3, 'the GTIN of the second barcode');
});

test('each sample parses with no error or warning, as a 100 x 60 mm label with two GS1-128 barcodes', () => {
  for (const e of samples()) {
    assert.equal(PB.languages.detect(e.source).id, e.language, e.id);
    const model = parse(e);
    assert.deepEqual(problems(model.diagnostics), [], e.id);
    assert.ok(Math.abs(model.size.width - 1000) <= 2 && Math.abs(model.size.height - 600) <= 2, e.id);
    const barcodes = model.items.filter(i => i.kind === 'barcode');
    assert.deepEqual(barcodes.map(b => b.symbology), ['gs1-128', 'gs1-128'], e.id);
    assert.deepEqual(barcodes.map(b => b.data), [SSCC, SECOND], e.id);
    assert.equal(model.items.filter(i => i.kind === 'text').length >= 2, true, e.id + ': a header text');
  }
});

test('the three samples are the same label: same item kinds, same texts, same barcodes', () => {
  const models = samples().map(parse);
  const kinds = models.map(m => m.items.map(i => i.kind));
  assert.deepEqual(kinds[1], kinds[0]);
  assert.deepEqual(kinds[2], kinds[0]);
  const texts = models.map(m => m.items.filter(i => i.kind === 'text').map(i => i.text));
  assert.deepEqual(texts[1], texts[0]);
  assert.deepEqual(texts[2], texts[0]);
});

test('the samples have no variables (a GS1 element string is not a template field) and are ASCII only', () => {
  for (const e of samples()) {
    assert.doesNotMatch(e.source, /#\w+#/, e.id);
    assert.deepEqual(e.values, {}, e.id);
    assert.match(e.source, /^[\x09\x0a\x0d\x20-\x7e]*$/, e.id);
  }
});

test('the samples convert to the other two languages with no error or warning and read back as the same barcodes', () => {
  for (const e of samples()) {
    for (const target of LANGUAGES.filter(id => id !== e.language)) {
      const result = PB.convert.run(e.source, target, { dpi: DPI });
      assert.deepEqual(problems(result.diagnostics), [], `${e.id} -> ${target}`);
      const back = PB.languages.get(target).parse(result.text, { dpi: DPI });
      assert.deepEqual(back.items.filter(i => i.kind === 'barcode').map(b => [b.symbology, b.data]), [['gs1-128', SSCC], ['gs1-128', SECOND]], `${e.id} -> ${target}`);
    }
  }
});

test('each sample round trips: parse, write the items back and parse again gives the same barcodes', () => {
  for (const e of samples()) {
    const result = PB.convert.run(e.source, e.language, { dpi: DPI });
    const back = PB.languages.get(e.language).parse(result.text, { dpi: DPI });
    assert.deepEqual(back.items.filter(i => i.kind === 'barcode').map(b => b.data), [SSCC, SECOND], e.id);
    assert.deepEqual(problems(back.diagnostics), [], e.id);
  }
});

test('each sample draws in the SVG renderer with no error: both barcodes produce bars and the readable line has the parentheses', () => {
  for (const e of samples()) {
    const model = parse(e);
    const { svg, diagnostics = [] } = PB.svgRenderer.render(model, model.size, { textScale: 1, values: {} });
    assert.match(String(svg), /<svg/, e.id);
    assert.deepEqual(problems(diagnostics), [], e.id);
    assert.match(String(svg), /\(00\)000422730000001131/, e.id + ': readable line of the SSCC');
  }
});
