const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tpcl.js');
const example = PB.examples.find(e => e.id === 'spool-99x55');
const tpcl = PB.languages.get('tpcl');

const BARCODE = '{XB02;0100,0200,9,0,03,0,0100,0,000,1,00|}{RB02;>8AB>8CD|}';
const LINE = '{LC;0100,0100,0500,0300,1,03|}';

test('example: declares its language and uses source', () => {
  assert.equal(example.language, 'tpcl');
  assert.equal(typeof example.source, 'string');
  assert.equal('ter' in example, false);
});

test('dpi: the QR module comes out in real 0.1 mm and changes with the resolution', () => {
  const qr = dpi => tpcl.parse(example.source, { dpi }).items.find(i => i.kind === 'qr');
  const [a, b] = [qr(203), qr(300)];
  assert.equal(a.cell, 4 * PB.units.dotSize(203));
  assert.equal(b.cell, 4 * PB.units.dotSize(300));
  assert.notEqual(a.cell, b.cell);
  assert.deepEqual([a.x, a.y], [b.x, b.y]);
  assert.deepEqual([a.native, b.native], [{ type: 'T', cell: 4 }, { type: 'T', cell: 4 }]);
});

test('dpi: barcode module and line thickness in 0.1 mm; height already comes in 0.1 mm', () => {
  const [bar] = tpcl.parse(BARCODE, { dpi: 300 }).items;
  assert.equal(bar.module, 3 * PB.units.dotSize(300));
  assert.deepEqual(bar.native, { type: '9', module: 3 });
  assert.equal(bar.height, 100);
  const [line] = tpcl.parse(LINE, { dpi: 203 }).items;
  assert.equal(line.width, 3 * PB.units.dotSize(203));
  assert.deepEqual(line.native, { width: 3, type: 1 });
  assert.deepEqual([line.x1, line.y1, line.x2, line.y2], [100, 100, 500, 300]);
});

test('dpi: without options uses the first resolution of the configuration', () => {
  const qr = tpcl.parse(example.source).items.find(i => i.kind === 'qr');
  assert.equal(qr.cell, 4 * PB.units.dotSize(PB.config.resolutions[0]));
});

test('source: TPCL items carry spans and label', () => {
  const model = tpcl.parse(example.source, { dpi: 203 });
  const pn = model.items.find(i => i.ref === 'PC007');
  const [span] = pn.source.spans;
  assert.equal(pn.source.spans.length, 1);
  assert.equal(example.source.slice(span.start, span.end), '{PC007;0170,0160,08,08,J,00,B|}');
  assert.equal(pn.source.label, '{PC007;0170,0160,08,08,J,00,B|}');
  assert.equal('cmd' in pn, false);
  assert.ok(model.items.every(i => i.source && i.source.spans.length && typeof i.source.label === 'string'));
});

test('source: rangeOf and labelOf are null-safe', () => {
  const item = { source: { spans: [{ start: 3, end: 9 }, { start: 20, end: 30 }], label: 'x' } };
  assert.deepEqual(PB.sources.rangeOf(item), { start: 3, end: 30 });
  assert.equal(PB.sources.labelOf(item), 'x');
  for (const bare of [{}, { source: null }, { source: { spans: [] } }]) assert.equal(PB.sources.rangeOf(bare), null);
  assert.equal(PB.sources.labelOf({}), null);
});

test('FNC1: the TPCL parser translates ">8" to the neutral marker and Code128 comes out the same', () => {
  const [bar] = tpcl.parse(BARCODE, { dpi: 203 }).items;
  assert.equal(PB.barcodeData.FNC1, '\u001d');
  assert.equal(bar.data, '\u001dAB\u001dCD');
  assert.deepEqual(PB.code128.values(bar.data), [105, 102, 100, 33, 34, 102, 35, 36, 69, 106]);
  assert.deepEqual(PB.code128.values('\u001d12345678'), [105, 102, 12, 34, 56, 78, 20, 106]);
});

test('FNC1: only translated in barcodes, not in texts', () => {
  const [text] = tpcl.parse('{PC001;0010,0010,05,05,J,00,B=a>8b|}', { dpi: 203 }).items;
  assert.equal(text.data, 'a>8b');
});

test('ecc: the QR carries a neutral level; an unknown one warns and uses M', () => {
  const qr = src => tpcl.parse(src, { dpi: 203 });
  assert.equal(qr('{XB01;0010,0010,T,Q,04,A,0,M2|}').items[0].ecc, 'Q');
  const odd = qr('{XB01;0010,0010,T,Z,04,A,0,M2|}');
  assert.equal(odd.items[0].ecc, 'M');
  assert.equal(odd.diagnostics[0].level, 'warning');
});
