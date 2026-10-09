const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// V11 ZPL barcodes, QR and Data Matrix, checked against the ZPL II Programming Guide (docs/zpl; text lines of pdftotext -layout of Volume One 2003, Volume Two 2005 as V2):
//   ^BYw,r,h        w 1..10, r 2.0..3.0 in 0.1 steps, h default height (V1 4302+; V2 3941+ gives 1..9999, 32000 is used: the bar codes take 1..32000)
//   ^B*o,h,f,g,e..  o N R I B, h 1..32000, f g Y / N, e Y / N (^BM: A B C D, ^BK: fixed N), ^BC m N U A (V1 1285+ .. 4046+)
//   ^BQa,b,c        a fixed N, b 1 / 2, c 1..10 (V1 3500+)       ^BXo,h,s,c,r,f,g  s 0 50 80 100 140 200, c / r 9..49 odd (0..140), 10..144 even (200), f 1..6, g any one character (V1 4114+)
// All parses use 254 dpi: one dot is 0.1 mm, so dots and model units are the same number.
const PB = loadApp();
const zpl = PB.languages.get('zpl');
const DPI = 254;

const BASE = body => `^XA^PW800^LL480${body}^XZ`;
const parse = body => zpl.parse(BASE(body), { dpi: DPI });
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const emit = (...items) => zpl.emit({ language: 'tpcl', size: { width: 800, height: 480 }, items, diagnostics: [] }, { dpi: DPI });
const barcode = (extra = {}) => ({ kind: 'barcode', x: 100, y: 200, symbology: 'code128', data: 'ABC', module: 2, rotation: 0, height: 80, humanReadable: true, ...extra });

// ---- ^BY

test('valid ^BY values raise no warning', () => {
  for (const by of ['^BY1', '^BY10', '^BY2,2.0,10', '^BY3,3.0,32000', '^BY2,2.5', '^BY,,50', '^BY4,2.3,1']) {
    assert.deepEqual(warnings(parse(`${by}^FO10,10^BCN,50,Y,N,N^FDabc^FS`)), [], by);
  }
});

test('^BY module out of 1..10 is drawn at the nearest limit and reported with the range', () => {
  const low = parse('^BY0^FO10,10^B3N,N,50,Y,N^FDA^FS');
  assert.equal(low.items[0].module, 1);
  assert.match(warnings(low)[0], /\^BY.*módulo.*1\.\.10/);
  const high = parse('^BY99^FO10,10^B3N,N,50,Y,N^FDA^FS');
  assert.equal(high.items[0].module, 10);
  assert.equal(warnings(high).length, 1);
  assert.match(warnings(high)[0], /\^BY.*módulo.*1\.\.10/);
});

test('^BY ratio out of 2.0..3.0 or not in 0.1 steps is drawn at the nearest valid one and reported with the range', () => {
  const low = parse('^BY4,1.5^FO10,10^B3N,N,50,Y,N^FDA^FS');
  assert.equal(low.items[0].native.ratio, 2);
  assert.match(warnings(low)[0], /\^BY.*relación.*2\.0\.\.3\.0/);
  const high = parse('^BY4,4^FO10,10^B3N,N,50,Y,N^FDA^FS');
  assert.equal(high.items[0].native.ratio, 3);
  assert.match(warnings(high)[0], /relación/);
  const step = parse('^BY4,2.55^FO10,10^B3N,N,50,Y,N^FDA^FS');
  assert.equal(step.items[0].native.ratio, 2.6);
  assert.match(warnings(step)[0], /0\.1/);
});

test('^BY height out of 1..32000 is drawn at the nearest limit; a value that is not a number is reported and ignored', () => {
  const high = parse('^BY2,3,40000^FO10,10^BCN,,Y,N,N^FDabc^FS');
  assert.equal(high.items[0].height, 32000);
  assert.match(warnings(high)[0], /\^BY.*altura.*1\.\.32000/);
  const zero = parse('^BY2,3,0^FO10,10^BCN,,Y,N,N^FDabc^FS');
  assert.equal(zero.items[0].height, 1);
  assert.equal(warnings(zero).length, 1);
  const text = parse('^BY2,3,abc^FO10,10^BCN,,Y,N,N^FDabc^FS');
  assert.equal(text.items[0].height, 10);
  assert.match(warnings(text)[0], /\^BY.*altura/);
});

// ---- Linear barcodes

test('a barcode height above 32000 is drawn at 32000 and reported with the range; 0 or text falls back to ^BY and says the range', () => {
  const high = parse('^FO10,10^BCN,40000,Y,N,N^FDabc^FS');
  assert.equal(high.items[0].height, 32000);
  assert.equal(high.items[0].native.height, 40000);
  assert.match(warnings(high)[0], /\^BC.*altura.*1\.\.32000/);
  for (const h of ['0', 'x', '-5']) {
    const model = parse(`^BY2,3,70^FO10,10^BCN,${h},Y,N,N^FDabc^FS`);
    assert.equal(model.items[0].height, 70, h);
    assert.match(warnings(model)[0], /altura.*1\.\.32000/, h);
  }
});

test('flag parameters f, g and e that are not Y / N are reported with the valid values', () => {
  for (const [src, label] of [
    ['^BCN,50,X,N,N', 'f'], ['^BCN,50,Y,2,N', 'g'], ['^BCN,50,Y,N,Q', 'e'], ['^B3N,Z,50,Y,N', 'e'], ['^B2N,50,Y,N,5', 'e'], ['^BUN,50,Y,N,x', 'e'],
    ['^B9N,50,Y,N,x', 'e'], ['^BAN,50,Y,N,x', 'e'], ['^BMN,B,50,Y,N,x', 'e2'], ['^BEN,50,maybe,N', 'f'], ['^BIN,50,Y,yes', 'g'],
  ]) {
    const model = parse(`^FO10,10${src}^FD1234^FS`);
    const found = warnings(model).find(text => new RegExp(`parámetro ${label}\\b`).test(text));
    assert.ok(found, `${src}: ${warnings(model).join(' | ')}`);
    assert.match(found, /Y o N/, src);
  }
});

test('^BM e outside A..D, ^BK e other than N and ^BC m outside N, U, A, D are reported', () => {
  assert.match(warnings(parse('^FO10,10^BMN,Z,50,Y,N^FD1234^FS')).join('|'), /\^BM.*parámetro e.*A, B, C o D/);
  assert.match(warnings(parse('^FO10,10^BKN,Y,50,Y,N^FD1234^FS')).join('|'), /\^BK.*parámetro e.*N/);
  assert.match(warnings(parse('^FO10,10^BCN,50,Y,N,N,Z^FDabc^FS')).join('|'), /\^BC.*modo.*N, U, A o D/);
  assert.deepEqual(warnings(parse('^FO10,10^BCN,50,Y,N,N,D^FDabc^FS')), []);
  assert.deepEqual(warnings(parse('^FO10,10^BMN,D,50,Y,N,Y^FD1234^FS')), []);
});

test('emit: a bar height outside 1..32000 is written at the limit with one warning', () => {
  const high = emit(barcode({ height: 40000 }));
  assert.ok(high.text.includes('^BCN,32000,'));
  assert.equal(high.diagnostics.filter(d => d.level === 'warning' && /1\.\.32000/.test(d.text) && /altura/.test(d.text)).length, 1);
  const twice = emit(barcode({ height: 40000 }), barcode({ height: 50000, y: 300 }));
  assert.equal(twice.diagnostics.filter(d => /altura/.test(d.text)).length, 1);
  assert.equal(emit(barcode({ height: 400 })).diagnostics.filter(d => /altura/.test(d.text)).length, 0);
});

test('emit: data that Code 39, Interleaved 2 of 5 or Code 128 cannot hold is reported once per symbology', () => {
  const c39 = emit(barcode({ symbology: 'code39', data: 'abc', check: 'none', widths: { narrowBar: 2, narrowSpace: 2, wideBar: 6, wideSpace: 6 } }));
  assert.equal(c39.diagnostics.filter(d => d.level === 'warning' && /no son válidos/.test(d.text)).length, 1);
  const itf = emit(barcode({ symbology: 'itf', data: '12AB', check: 'none', widths: { narrowBar: 2, narrowSpace: 2, wideBar: 6, wideSpace: 6 } }));
  assert.equal(itf.diagnostics.filter(d => d.level === 'warning' && /no son válidos/.test(d.text)).length, 1);
  const c128 = emit(barcode({ data: 'ñandú' }));
  assert.equal(c128.diagnostics.filter(d => d.level === 'warning' && /no son válidos/.test(d.text)).length, 1);
  const ok = emit(barcode({ data: 'ABC123' }), barcode({ symbology: 'code39', data: 'ABC-1', check: 'none', widths: { narrowBar: 2, narrowSpace: 2, wideBar: 6, wideSpace: 6 }, y: 300 }));
  assert.deepEqual(ok.diagnostics.filter(d => d.level === 'warning'), []);
});

// ---- QR (^BQ)

test('valid ^BQ values raise no warning', () => {
  for (const src of ['^BQN,2,10', '^BQN,1,1', '^BQ,2,5', '^BQ']) assert.deepEqual(warnings(parse(`^FO10,10${src}^FDQA,hello^FS`)), [], src);
});

test('^BQ magnification out of 1..10 is drawn at the nearest limit and reported with the range', () => {
  const high = parse('^FO10,10^BQN,2,25^FDQA,hello^FS');
  assert.equal(high.items[0].cell, 10);
  assert.equal(high.items[0].native.cell, 10);
  assert.match(warnings(high)[0], /\^BQ.*magnificación.*1\.\.10/);
  const zero = parse('^FO10,10^BQN,2,0^FDQA,hello^FS');
  assert.equal(zero.items[0].cell, 1);
  assert.equal(warnings(zero).length, 1);
  const text = parse('^FO10,10^BQN,2,x^FDQA,hello^FS');
  assert.equal(warnings(text).length, 1);
  assert.match(warnings(text)[0], /1\.\.10/);
});

test('^BQ model outside 1 / 2 and the error correction level letter are reported', () => {
  assert.match(warnings(parse('^FO10,10^BQN,3,5^FDQA,hello^FS'))[0], /modelo.*1 o 2/);
  const level = parse('^FO10,10^BQN,2,5^FDXA,hello^FS');
  assert.ok(warnings(level).some(text => /nivel de corrección/.test(text)));
});

// ---- Data Matrix (^BX)

test('valid ^BX values raise no warning', () => {
  for (const src of ['^BXN,4,200', '^BXN,4,200,24,24', '^BXN,4,0,21,21,6', '^BXN,4,50,9,9,1', '^BXN,4,200,,,,#', '^BXN,10,140,49,49,3', '^BXR,1,100,,,2']) {
    assert.deepEqual(warnings(parse(`^FO10,10${src}^FDabc^FS`)), [], src);
  }
});

test('^BX columns and rows of quality 0..140 must be odd 9..49: the others are reported with what the printer does', () => {
  const big = warnings(parse('^FO10,10^BXN,4,50,51,51^FDabc^FS')).join('|');
  assert.match(big, /columnas.*9\.\.49.*impar/);
  assert.match(big, /filas.*9\.\.49/);
  assert.match(warnings(parse('^FO10,10^BXN,4,0,20,21^FDabc^FS')).join('|'), /columnas.*20.*impar/);
  assert.match(warnings(parse('^FO10,10^BXN,4,100,7,7^FDabc^FS')).join('|'), /columnas.*menor de 9/);
  assert.match(warnings(parse('^FO10,10^BXN,4,,5,5^FDabc^FS')).join('|'), /columnas/, 'quality defaults to 0');
});

test('^BX format ID outside 1..6 and an escape character of more than one character are reported', () => {
  assert.match(warnings(parse('^FO10,10^BXN,4,50,9,9,7^FDabc^FS')).join('|'), /formato.*1\.\.6/);
  assert.match(warnings(parse('^FO10,10^BXN,4,0,,,x^FDabc^FS')).join('|'), /formato.*1\.\.6/);
  assert.match(warnings(parse('^FO10,10^BXN,4,200,,,,ab^FDabc^FS')).join('|'), /carácter de escape/);
});

test('^BX module that is negative or text says the valid range', () => {
  assert.match(warnings(parse('^FO10,10^BXN,-3,200^FDabc^FS'))[0], /módulo.*1\.\.9999/);
  assert.match(warnings(parse('^FO10,10^BXN,x,200^FDabc^FS'))[0], /módulo.*1\.\.9999/);
});
