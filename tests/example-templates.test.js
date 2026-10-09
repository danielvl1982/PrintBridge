const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, shippedExamples } = require('./helpers/load');

// The blank templates and the templates of js/config.js, plus the complete sample labels that tests/helpers/load.js appends.
const PB = loadApp();
const DPI = 203;
const LANGUAGES = ['tpcl', 'tspl', 'zpl'];
const problems = model => model.diagnostics.filter(d => d.level === 'error' || d.level === 'warning');
const parse = e => PB.languages.get(e.language).parse(e.source, { dpi: DPI });
const byGroup = group => PB.examples.filter(e => e.group === group);
const near100x60 = size => Math.abs(size.width - 1000) <= 2 && Math.abs(size.height - 600) <= 2;

test('every example is detected as its language and parses with no error or warning', () => {
  for (const e of PB.examples) {
    assert.equal(PB.languages.detect(e.source).id, e.language, e.id);
    assert.deepEqual(problems(parse(e)), [], e.id);
  }
});

test('the app ships exactly three blank templates then three templates, and no complete example', () => {
  const shipped = [...shippedExamples()]; // spread: the array comes from another vm context
  assert.deepEqual(shipped.map(e => e.group), ['blank', 'blank', 'blank', 'template', 'template', 'template']);
  assert.deepEqual(shipped.map(e => e.id), LANGUAGES.map(l => 'blank-' + l).concat(LANGUAGES.map(l => 'template-' + l)));
  assert.equal(shipped.some(e => e.group === 'full'), false);
  assert.equal(new Set(shipped.map(e => e.id)).size, shipped.length);
});

test('the test fixture appends the four complete examples after the shipped ones, with unique ids', () => {
  assert.deepEqual(PB.examples.slice(6).map(e => e.id), ['spool-99x55', 'barcodes-code39-itf-code128', 'tspl-label-100x60', 'zpl-label-100x60']);
  assert.equal(new Set(PB.examples.map(e => e.id)).size, PB.examples.length);
});

test('there is one blank template and one template per language, with the agreed names', () => {
  for (const group of ['blank', 'template']) assert.deepEqual(byGroup(group).map(e => e.language), LANGUAGES, group);
  assert.deepEqual(byGroup('blank').map(e => e.name), ['En blanco — TPCL (TEC)', 'En blanco — TSPL (TSC)', 'En blanco — ZPL (Zebra)']);
  assert.deepEqual(byGroup('template').map(e => e.name), ['Plantilla — TPCL (TEC)', 'Plantilla — TSPL (TSC)', 'Plantilla — ZPL (Zebra)']);
});

test('the blank templates have no items, no variables, no values and a 100 x 60 mm label', () => {
  for (const e of byGroup('blank')) {
    const model = parse(e);
    assert.deepEqual(model.items, [], e.id);
    assert.deepEqual(e.values, {}, e.id);
    assert.doesNotMatch(e.source, /#\w+#/, e.id);
    // 0.1 mm; ZPL derives the size from dots (800 x 480 at 203 dpi), within its documented rounding
    assert.ok(near100x60(model.size), `${e.id}: ${model.size.width}x${model.size.height}`);
  }
});

test('the templates are 100 x 60 mm too', () => {
  for (const e of byGroup('template')) assert.ok(near100x60(parse(e).size), e.id);
});

test('the three templates have the same item kinds in the same order', () => {
  // Frame (a box), title and three text lines, a horizontal line, a Code128 bar code and a QR. The languages only differ in how
  // they write them (TPCL {LC} draws both the box and the line, TSPL uses BOX / BAR, ZPL ^GB), not in the kinds the model reads.
  const KINDS = ['line', 'text', 'text', 'text', 'text', 'line', 'barcode', 'qr'];
  for (const e of byGroup('template')) assert.deepEqual(parse(e).items.map(i => i.kind), KINDS, e.id);
});

test('the templates read as the same label: a framed box, a straight line, the same texts and a Code128 with a variable', () => {
  const models = byGroup('template').map(parse);
  for (const model of models) {
    assert.equal(Boolean(model.items[0].rect), true, 'the frame is a box');
    assert.equal(Boolean(model.items[5].rect), false, 'the rule is a straight line');
    const barcode = model.items.find(i => i.kind === 'barcode');
    assert.match(String(barcode.symbology || barcode.type), /128/);
    assert.equal(barcode.data, '#CODIGO#');
  }
  const texts = models.map(m => m.items.filter(i => i.kind === 'text').map(i => i.text));
  assert.deepEqual(texts[0], texts[1]);
  assert.deepEqual(texts[1], texts[2]);
});

test('every #VARIABLE# of a template has a test value, and the three share the same values', () => {
  const basics = byGroup('template');
  for (const e of basics) {
    const names = [...new Set([...e.source.matchAll(/#(\w+)#/g)].map(m => m[1]))];
    assert.ok(names.length >= 4, e.id);
    for (const name of names) assert.ok(String(e.values[name] || '').length > 0, `${e.id}: ${name}`);
    assert.deepEqual(Object.keys(e.values).sort(), names.sort(), `${e.id}: no unused value`);
  }
  assert.deepEqual(basics[1].values, basics[0].values);
  assert.deepEqual(basics[2].values, basics[0].values);
});

test('the blank and template sources are ASCII only (the printer code page decides what other characters print)', () => {
  for (const e of byGroup('blank').concat(byGroup('template'))) assert.match(e.source, /^[\x09\x0a\x0d\x20-\x7e]*$/, e.id);
});

test('inserting a Texto, a Código de barras and a QR into each blank template writes a command of its language', () => {
  const SIGNATURE = {
    text: { tpcl: /\{P[CV]\d\d;/, tspl: /^TEXT /m, zpl: /\^FO[^\n]*\^A/ },
    barcode: { tpcl: /\{XB\d\d;/, tspl: /^BARCODE /m, zpl: /\^B[A-Z]/ },
    qr: { tpcl: /\{XB\d\d;[^|]*,M2\|/, tspl: /^QRCODE /m, zpl: /\^BQ/ },
  };
  for (const e of byGroup('blank')) {
    const language = PB.languages.detect(e.source);
    assert.equal(language.id, e.language, e.id);
    const size = parse(e).size;
    for (const kind of ['text', 'barcode', 'qr']) {
      const at = `${e.id} ${kind}`;
      const built = language.buildComponent(e.source, kind, { x: 200, y: 150 }, { dpi: DPI, viewRotation: 0 });
      assert.notEqual(built, e.source, at);
      assert.match(built, SIGNATURE[kind][e.language], at);
      const model = language.parse(built, { dpi: DPI });
      assert.deepEqual(problems(model), [], at);
      assert.deepEqual(model.items.map(i => i.kind), [kind], at);
      // The label still belongs to the template's language and keeps its size
      assert.equal(PB.languages.detect(built).id, e.language, at);
      assert.deepEqual([model.size.width, model.size.height], [size.width, size.height], at);
    }
  }
});

test('the palette of each blank template offers that language\'s components', () => {
  for (const e of byGroup('blank')) {
    const kinds = PB.languages.get(e.language).componentTemplates().map(c => c.kind);
    for (const kind of ['text', 'barcode', 'qr', 'line', 'box']) assert.ok(kinds.includes(kind), `${e.id} ${kind}`);
  }
});

test('the templates convert to the other two languages with no error or warning', () => {
  for (const e of byGroup('template')) {
    for (const target of LANGUAGES.filter(id => id !== e.language)) {
      const result = PB.convert.run(e.source, target, { dpi: DPI });
      assert.deepEqual(result.diagnostics.filter(d => d.level === 'error' || d.level === 'warning'), [], `${e.id} -> ${target}`);
    }
  }
});
