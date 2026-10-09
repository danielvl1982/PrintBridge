const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tpcl.js');
const example = PB.examples.find(e => e.id === 'spool-99x55');
const tpcl = PB.languages.get('tpcl');
const parse = src => tpcl.parse(src);

test('language registry: tpcl registered', () => {
  assert.equal(tpcl.id, 'tpcl');
  assert.equal(tpcl.name, 'TPCL (Toshiba TEC)');
  assert.deepEqual(PB.languages.all().map(l => l.id), ['tpcl']);
  assert.equal(PB.languages.get('nope'), null);
});

test('language registry: detect', () => {
  assert.equal(PB.languages.detect(example.source).id, 'tpcl');
  assert.equal(PB.languages.detect('^XA^FO10,10^FDhello^FS^XZ'), null);
  assert.equal(PB.languages.detect(''), null);
});

test('parse of the reference spool example: item count by kind', () => {
  const model = parse(example.source);
  const count = kind => model.items.filter(i => i.kind === kind).length;
  assert.equal(count('text'), 13);
  assert.equal(count('barcode'), 0);
  assert.equal(count('qr'), 1);
  assert.equal(count('line'), 0);
  assert.equal(model.items.length, 14);
  assert.deepEqual(model.diagnostics, []);
});

test('parse of the reference spool example: D/AX size and coordinates', () => {
  const model = parse(example.source);
  assert.equal(model.size.native.dRaw, 'D0610,0990,0550');
  assert.equal(model.size.native.axRaw, 'AX;+010,+000,+00');
  assert.deepEqual([model.size.pitch, model.size.width, model.size.height], [610, 990, 550]);
  const pn = model.items.find(i => i.ref === 'PC007');
  assert.deepEqual([pn.x, pn.y, pn.data], [170, 160, '#PN#']);
  const bar = model.items.find(i => i.kind === 'qr');
  assert.deepEqual([bar.ref, bar.x, bar.y, bar.ecc, bar.native.cell], ['XB01', 700, 160, 'H', 4]);
});

test('parse: unknown command and RC without PC give a diagnostic', () => {
  const model = parse('{ZZ;1|}{RC009;x|}');
  assert.equal(model.diagnostics.length, 2);
  assert.equal(model.diagnostics[0].level, 'warning');
  assert.equal(model.diagnostics[1].level, 'error');
});

test('variables: names and substitution', () => {
  const model = parse(example.source);
  assert.deepEqual(PB.variables.namesInModel(model).slice(0, 3), ['MFRDATE', 'PN', 'LOT']);
  assert.equal(PB.variables.substitute('#QTY# mts <#LOT#> #X#', { QTY: '400', LOT: '200001' }), '400 mts 200001 #X#');
});

test('sizes: the drawing follows the size the label declares, with no mismatch diagnostics', () => {
  const ok = PB.sizes.view(parse(example.source));
  assert.deepEqual(ok.diagnostics, []);
  assert.deepEqual([ok.width, ok.height, ok.pitch], [990, 550, 610]);
  const other = PB.sizes.view(parse('{D0500,0900,0500|}'));
  assert.deepEqual([other.width, other.height, other.pitch], [900, 500, 500]);
  assert.deepEqual(other.diagnostics, []);
});

test('sizes: without D uses the fallback with a warning', () => {
  const v = PB.sizes.view(parse('{PC001;0010,0010,05,05,J,00,B=A|}'));
  assert.equal(v.width, 990);
  assert.equal(v.diagnostics[0].level, 'warning');
});

test('sizes: apply writes only D', () => {
  const size = PB.sizes.resolve({ w: 99, h: 55, p: 61 });
  const out = PB.sizes.apply(tpcl, '{PC001;0010,0010,05,05,J,00,B=A|}', size).text;
  assert.match(out, /^\{D0610,0990,0550\|\}\n\{PC001/);
  assert.doesNotMatch(out, /AX/);
});

test('validator: TPCL and neutral rules', () => {
  const messages = src => PB.validator.validate(parse(src), tpcl).map(d => d.text);
  assert.deepEqual(messages(example.source), []);
  assert.ok(messages('{PC001;10,0010,05,05,J,00,B=A|}').some(t => /no tiene 4 dígitos/.test(t)));
  assert.ok(messages('{PC001;0010,0010,05,05,J,00,B|}').some(t => /sin texto/.test(t)));
  assert.ok(messages('{XB01;0010,0010,T,H,4|}{RB01;a|}').some(t => /módulo/.test(t)));
  assert.ok(messages('{XB01;0010,0010,Z,0,02,0,0100,0,000,0,00|}{RB01;a|}').some(t => /aproximado/.test(t)));
});
