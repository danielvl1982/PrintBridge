const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tpcl.js');
const tpcl = PB.languages.get('tpcl');

test('qr registers as a slice with palette entry, renderer and a TPCL hook factory', () => {
  const qr = PB.components.get('qr');
  assert.ok(qr);
  assert.deepEqual([qr.label, qr.glyph, qr.order], ['QR', '▦', 30]);
  assert.equal(typeof qr.render, 'function');
  assert.equal(typeof qr.languages.tpcl, 'function');
  assert.equal(PB.components.forItem({ kind: 'qr', ref: 'XB02' }).kind, 'qr');
});

test('PB.qr keeps its public name and lives in the slice', () => {
  assert.equal(typeof PB.qr.matrix, 'function');
});

test('palette order is text, barcode, qr, line, box and every palette kind is a slice', () => {
  assert.deepEqual(PB.components.kinds(), ['text', 'barcode', 'qr', 'datamatrix', 'line', 'box', 'ellipse', 'circle', 'area', 'image']);
  assert.deepEqual(tpcl.componentTemplates().map(c => c.kind), ['text', 'barcode', 'qr', 'datamatrix', 'line', 'box', 'area']);
});

test('a QR command is parsed as QR and a 1D barcode as barcode (handler order does not matter)', () => {
  const model = tpcl.parse('{XB01;0010,0010,T,H,04,A,0,M2|}\n{XB02;0010,0200,9,1,02,0,0080,+0000000000,000,0,00|}');
  assert.deepEqual(model.items.map(i => [i.ref, i.kind]), [['XB01', 'qr'], ['XB02', 'barcode']]);
  assert.equal(model.items[0].ecc, 'H');
  assert.equal(model.items[1].symbology, 'code128');
});

test('a malformed type T command still falls to the generic barcode handler, as before the slice', () => {
  const model = tpcl.parse('{XB01;0010,0010,T,|}');
  assert.equal(model.items[0].kind, 'barcode');
  assert.equal(model.items[0].symbology, 'qr');
});

test('the 2-digit module rule comes from the qr slice', () => {
  const warn = src => tpcl.validate(tpcl.parse(src)).map(d => d.text);
  assert.deepEqual(warn('{XB01;0010,0010,T,H,4,A,0,M2|}'), ['XB01: tamaño de módulo "4" no tiene 2 dígitos']);
  assert.deepEqual(warn('{XB01;0010,0010,T,H,04,A,0,M2|}'), []);
});
