const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tpcl.js');
const example = PB.examples[0];
const tpcl = PB.languages.get('tpcl');
const parse = src => tpcl.parse(src);
const standard = PB.sizes.resolve({ w: 99, h: 55, p: 61 });

test('neutral model: language and size of the reference spool example', () => {
  const model = parse(example.source);
  assert.equal(model.language, 'tpcl');
  assert.deepEqual(
    [model.size.width, model.size.height, model.size.pitch, model.size.gap],
    [990, 550, 610, null],
  );
  assert.deepEqual(model.size.native, { dRaw: 'D0610,0990,0550', axRaw: 'AX;+010,+000,+00' });
  assert.equal('dRaw' in model.size, false);
});

test('neutral model: label without size commands', () => {
  const model = parse('{PC001;0010,0010,05,05,J,00,B=A|}');
  assert.deepEqual([model.size.width, model.size.height, model.size.pitch, model.size.gap], [null, null, null, null]);
  assert.deepEqual(model.size.native, { dRaw: null, axRaw: null });
});

test('neutral model: symbology and native.type', () => {
  const bars = type => parse(`{XB01;0010,0010,${type},0,02,0,0100,0,000,0,00|}{RB01;a|}`).items[0];
  for (const [type, symbology] of [['9', 'code128'], ['A', 'code128'], ['Z', 'unknown'], ['0', 'unknown']]) {
    assert.equal(bars(type).symbology, symbology, type);
    assert.deepEqual(bars(type).native, { type, module: 2 }, type);
  }
  const qr = parse(example.source).items.find(i => i.kind === 'qr');
  assert.equal(qr.symbology, 'qr');
  assert.deepEqual(qr.native, { type: 'T', cell: 4 });
});

test('neutral model: the font keeps its neutral shape', () => {
  const texts = parse(example.source).items.filter(i => i.kind === 'text');
  for (const t of texts) assert.deepEqual(Object.keys(t.font).sort(), ['family', 'scaleX', 'size', 'style', 'weight']);
  assert.equal(PB.config.bitmapFonts, undefined);
  assert.equal(PB.config.outlineFont, undefined);
  assert.equal(PB.config.controlCommands, undefined);
});

test('sizes: the catalog finds by neutral size', () => {
  const catalog = PB.sizes.createCatalog(PB.config.sizes);
  assert.equal(catalog.findBySize(parse('{D0630,1000,0600|}').size).id, '100x60');
  assert.equal(catalog.findBySize(parse(example.source).size), null);
  assert.equal(catalog.findBySize(parse('{D0500,0900,0500|}').size), null);
  assert.equal(catalog.findBySize(parse('{C|}').size), null);
});

test('sizes: sizeCommands and applySize write only D and keep the AX, idempotent', () => {
  assert.deepEqual(tpcl.sizeCommands(standard), ['{D0610,0990,0550|}']);
  const once = tpcl.applySize('{D0500,0900,0500|}\n{AX;+001,+000,+00|}\n{C|}', standard);
  assert.equal(once, '{D0610,0990,0550|}\n{AX;+001,+000,+00|}\n{C|}');
  assert.equal(tpcl.applySize(once, standard), once);
  assert.equal(PB.sizes.apply(tpcl, once, standard).text, once);
});

test('neutral validator: uses symbology', () => {
  const messages = model => PB.validator.validate(model).map(d => d.text);
  const item = symbology => ({ kind: 'barcode', ref: 'X1', data: 'a', symbology, native: { type: 'Z' } });
  assert.deepEqual(messages({ items: [item('code128')] }), []);
  assert.ok(messages({ items: [item('ean13')] }).some(t => /aproximado/.test(t)));
  assert.ok(messages({ items: [item('unknown')] }).some(t => /aproximado/.test(t)));
});
