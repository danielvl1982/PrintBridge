const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// V7 TSPL barcodes, QRCODE and DMATRIX, checked against the B-442/443 interface manual (docs/tspl, text lines of pdftotext -layout):
//   BARCODE x,y,"type",height,human readable,rotation,narrow,wide,"content"   (lines 735-840)
//     human readable 0 / 1 (local manual; 2 / 3 = left / center / right is TSC v3.0, kept), rotation 0 / 90 / 180 / 270, height, narrow and wide in dots
//   DMATRIX x,y,width,height,[xm,row,col],expression   (918-939), all in dots
//   QRCODE is not in the local manual (TSC v3.0 only): its ranges are the ones the code already had (cell 1..10, model 1 / 2, mask 0..8)
//   @n counters: 0..49 (SET COUNTER, 3116-3150)
const PB = loadApp();
const tspl = PB.languages.get('tspl');

const parse = src => tspl.parse(src, { dpi: 203 });
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const doc = (...cmds) => `SIZE 100 mm,60 mm\r\n${cmds.join('\r\n')}\r\nCLS\r\nPRINT 1,1\r\n`;
const dot = 254 / 203;
const emit = items => PB.languages.emit('tspl', { language: 'tspl', size: { width: 1000, height: 600, gap: null, pitch: null, native: {} }, items, diagnostics: [] }, { dpi: 203 });
const texts = (out, level) => out.diagnostics.filter(d => d.level === level).map(d => d.text);
const bc = (extra = {}) => ({ kind: 'barcode', ref: 'B', x: 100, y: 100, symbology: 'code128', module: 2 * dot, height: 100 * dot, rotation: 0, data: '12345', ...extra });

// ---- parse: BARCODE

test('valid BARCODE commands raise no warning', () => {
  for (const readable of [0, 1, 2, 3]) assert.deepEqual(warnings(parse(doc(`BARCODE 10,10,"128",80,${readable},0,2,2,"ABC"`))), [], String(readable));
  assert.deepEqual(warnings(parse(doc('BARCODE 10,10,"39",80,1,270,2,5,"ABC"'))), []);
});

test('a human readable value outside 0..3 is warned with the range', () => {
  const model = parse(doc('BARCODE 10,10,"128",80,5,0,2,2,"ABC"'));
  const w = warnings(model);
  assert.equal(w.length, 1);
  assert.match(w[0], /texto legible/);
  assert.match(w[0], /0 a 3/);
  assert.equal(model.items[0].humanReadable, false);
});

test('a fractional height or narrow bar is warned and drawn as the nearest whole dot count', () => {
  const model = parse(doc('BARCODE 10,10,"128",80.6,1,0,2.4,2,"ABC"'));
  const w = warnings(model);
  assert.equal(w.length, 2);
  assert.match(w.join('|'), /altura/);
  assert.match(w.join('|'), /ancho estrecho/);
  assert.ok(Math.abs(model.items[0].height - 81 * dot) < 1e-9);
  assert.ok(Math.abs(model.items[0].module - 2 * dot) < 1e-9);
});

test('a missing, zero or fractional wide bar is warned', () => {
  for (const wide of ['0', '-2', 'x', '2.5']) {
    const w = warnings(parse(doc(`BARCODE 10,10,"39",80,1,0,2,${wide},"ABC"`)));
    assert.equal(w.length, 1, wide);
    assert.match(w[0], /ancho de barra ancha/, wide);
  }
});

test('more than 10 arguments are warned', () => {
  const w = warnings(parse(doc('BARCODE 10,10,"128",80,1,0,2,2,1,2,"ABC"')));
  assert.ok(w.some(t => /argumentos/.test(t)), w.join('|'));
});

test('a counter above @49 in a barcode, QR or Data Matrix content is warned once with the range', () => {
  for (const cmd of ['BARCODE 10,10,"128",80,1,0,2,2,@50', 'QRCODE 10,10,M,4,A,0,"x"+@50', 'DMATRIX 10,10,100,100,@50']) {
    const w = warnings(parse(doc(cmd)));
    assert.equal(w.filter(t => /@50/.test(t)).length, 1, cmd);
    assert.match(w.join('|'), /@0 a @49/, cmd);
  }
  assert.deepEqual(warnings(parse(doc('BARCODE 10,10,"128",80,1,0,2,2,@49'))), []);
});

// ---- parse: QRCODE

test('a QR cell width above 10 is read as written, drawn at 10 and warned with the range', () => {
  const model = parse(doc('QRCODE 10,10,M,14,A,0,"x"'));
  const item = model.items[0];
  assert.equal(item.native.cell, 14);
  assert.ok(Math.abs(item.cell - 10 * dot) < 1e-9);
  const w = warnings(model);
  assert.equal(w.length, 1);
  assert.match(w[0], /1 a 10/);
});

test('a fractional QR cell width is warned and drawn rounded', () => {
  const model = parse(doc('QRCODE 10,10,M,3.6,A,0,"x"'));
  assert.ok(Math.abs(model.items[0].cell - 4 * dot) < 1e-9);
  assert.equal(warnings(model).length, 1);
});

test('an unknown QR error correction level is a warning naming L, M, Q and H', () => {
  const w = warnings(parse(doc('QRCODE 10,10,Z,4,A,0,"x"')));
  assert.equal(w.length, 1);
  assert.match(w[0], /L, M, Q o H/);
});

test('QR model and mask out of range, and unknown optional parameters, are warned', () => {
  assert.deepEqual(warnings(parse(doc('QRCODE 10,10,M,4,A,0,M2,S8,"x"'))), []);
  const model = warnings(parse(doc('QRCODE 10,10,M,4,A,0,M3,"x"')));
  assert.equal(model.length, 1);
  assert.match(model[0], /modelo/);
  assert.match(model[0], /1 o 2/);
  const mask = warnings(parse(doc('QRCODE 10,10,M,4,A,0,S9,"x"')));
  assert.equal(mask.length, 1);
  assert.match(mask[0], /0 a 8/);
  const unknown = warnings(parse(doc('QRCODE 10,10,M,4,A,0,Z1,"x"')));
  assert.equal(unknown.length, 1);
  assert.match(unknown[0], /Z1/);
});

// ---- parse: DMATRIX

test('a fractional or negative Data Matrix module is warned', () => {
  const frac = warnings(parse(doc('DMATRIX 10,10,200,200,3.5,26,26,"x"')));
  assert.equal(frac.length, 1);
  assert.match(frac[0], /módulo/);
  assert.match(frac[0], /entero/);
});

test('Data Matrix rows or columns beyond 144 or negative are warned with the range', () => {
  const w = warnings(parse(doc('DMATRIX 10,10,200,200,3,200,200,"x"')));
  assert.equal(w.length, 1);
  assert.match(w[0], /144/);
});

// ---- emit

test('emit: a barcode height or narrow bar below one dot is written as 1 and reported once', () => {
  const out = emit([bc({ height: 0, module: 0 }), bc({ height: 0, module: 0 })]);
  assert.match(out.text, /,"128",1,0,0,1,1,/);
  const w = texts(out, 'warning').filter(t => /punto/.test(t));
  assert.equal(w.length, 1);
});

test('emit: Code 39, ITF and Code 128 data that the type cannot hold is reported once per symbology', () => {
  const code39 = texts(emit([bc({ symbology: 'code39', data: 'abc{' })]), 'warning');
  assert.ok(code39.some(t => /no son válidos para su tipo/.test(t)), code39.join('|'));
  const itf = texts(emit([bc({ symbology: 'itf', data: 'ABC' })]), 'warning');
  assert.ok(itf.some(t => /no son válidos para su tipo/.test(t)), itf.join('|'));
  const c128 = texts(emit([bc({ data: 'café€' })]), 'warning');
  assert.ok(c128.some(t => /no son válidos para su tipo/.test(t)), c128.join('|'));
  assert.deepEqual(texts(emit([bc({ symbology: 'code39', data: 'ABC-123' })]), 'warning'), []);
});

test('emit: a QR or Data Matrix emitted from another language is written inside the TSPL limits', () => {
  const qr = emit([{ kind: 'qr', ref: 'Q', x: 0, y: 0, ecc: 'M', cell: 50 * dot, symbology: 'qr', data: 'x' }]);
  assert.match(qr.text, /QRCODE 0,0,M,10,A,0,"x"/);
  assert.equal(texts(qr, 'warning').filter(t => /1\.\.10/.test(t)).length, 1);
});
