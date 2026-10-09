const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// V12 ZPL images, checked against the ZPL II Programming Guide (docs/zpl): vol 1 (2003) ^GF at text line 6389:
//   ^GFa,b,c,d,data   a A / B / C (default A), b, c, d each 1..99999 ("out-of-range values are set to the nearest limit"; the command is ignored when
//   c or d is missing), c / d = the rows; ^FO / ^FT 0..32000 (vol 1 5907+, 6021+). Vol 2 (2005, p. 112) adds B64 / Z64 as ASCII hex replacements.
const PB = loadApp();
const zpl = PB.languages.get('zpl');
const DPI = 254;

const BASE = body => `^XA^PW800^LL480${body}^XZ`;
const parse = src => zpl.parse(BASE(src), { dpi: DPI });
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const emitResult = items => zpl.emit({ language: 'zpl', size: { width: 800, height: 480 }, items, diagnostics: [] }, { dpi: DPI });
const emitLines = items => emitResult(items).text.split('\r\n').filter(l => l && !/^\^(XA|XZ|PW|LL)/.test(l));
const emitWarnings = items => emitResult(items).diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const image = (x, y, bm, native) => ({ kind: 'image', ref: 'GF', x, y, width: bm.w, height: bm.h, bitmap: bm, native, data: null });
const bm = (w, h, fill = 1) => ({ w, h, data: new Uint8Array(w * h).fill(fill) });

// ---- Parsing

test('parse: counts inside 1..99999 and a matching total raise no warning', () => {
  assert.deepEqual(warnings(parse('^FO0,0^GFA,2,2,1,FF00^FS')), []);
});

test('parse: a count outside 1..99999 is drawn at the nearest limit and the warning states the range', () => {
  for (const src of ['^GFA,2,2,0,FF00', '^GFA,2,0,1,FF00', '^GFA,0,2,1,FF00']) {
    const w = warnings(parse(`^FO0,0${src}^FS`));
    assert.ok(w.some(t => /1\.\.99999/.test(t)), src);
  }
  const big = parse('^FO0,0^GFA,2,100000,1,FF00^FS');
  assert.ok(warnings(big).some(t => /100000/.test(t) && /99999/.test(t)));
});

test('parse: a count that is not a whole number or is missing says the command is ignored and states the range', () => {
  for (const src of ['^GFA,2,2.5,1,FF00', '^GFA,x,2,1,FF00', '^GFA,2,2,,FF00', '^GFA,2,2']) {
    const model = parse(`^FO0,0${src}^FS`);
    assert.equal(model.items.length, 0, src);
    const w = warnings(model);
    assert.equal(w.length, 1, src);
    assert.match(w[0], /1\.\.99999/, src);
  }
});

test('parse: a compression type outside A, B, C is refused with the valid values; B and C are reported as not drawable', () => {
  const bad = parse('^FO0,0^GFX,2,2,1,FF00^FS');
  assert.equal(bad.items.length, 0);
  assert.match(warnings(bad)[0], /A, B o C/);
  for (const t of ['B', 'C']) {
    const model = parse(`^FO0,0^GF${t},2,2,1,xx^FS`);
    assert.equal(model.items.length, 0);
    assert.equal(warnings(model).length, 1);
  }
});

test('parse: bytes sent different from the total in ASCII warns, the total decides', () => {
  const model = parse('^FO0,0^GFA,1,2,1,FF00^FS');
  assert.equal(model.items[0].bitmap.h, 2);
  assert.ok(warnings(model).some(t => /bytes enviados/.test(t)));
});

test('parse: a total that is not a multiple of the bytes per row warns and the last row is padded with white', () => {
  const model = parse('^FO0,0^GFA,3,3,2,FFFF00^FS');
  assert.equal(model.items[0].bitmap.h, 2);
  assert.ok(warnings(model).some(t => /múltiplo/.test(t)));
});

test('parse: a position of the field outside 0..32000 is reported with the range and the image is drawn at the nearest valid dot', () => {
  const model = parse('^FO-5,40000^GFA,2,2,1,FF00^FS');
  assert.ok(warnings(model).some(t => /32000/.test(t)));
  assert.equal(model.items.length, 1);
  assert.ok(model.items[0].x >= 0);
});

test('parse: data longer than the total is ignored with a warning; short data is padded with white with a warning', () => {
  assert.ok(warnings(parse('^FO0,0^GFA,1,1,1,FF00^FS')).some(t => /sobran/.test(t)));
  assert.ok(warnings(parse('^FO0,0^GFA,2,2,1,FF^FS')).some(t => /incompletos/.test(t)));
});

// ---- Emit

test('emit: an image at a negative position is written at 0 and reported once with the range', () => {
  const items = [image(-50, 10, bm(8, 2)), image(-10, 10, bm(8, 2))];
  const lines = emitLines(items);
  assert.match(lines[0], /^\^FO0,/);
  const w = emitWarnings(items);
  assert.equal(w.length, 1);
  assert.match(w[0], /0\.\.32000/);
});

test('emit: an image beyond 32000 dots is written at 32000 and reported once', () => {
  const items = [image(5000, 10, bm(8, 2))]; // 5000 x 0.1 mm = 500 mm = 5000 dots at 254 dpi: inside
  assert.deepEqual(emitWarnings(items), []);
  const far = [image(400000, 0, bm(8, 2))];
  assert.match(emitLines(far)[0], /^\^FO32000,0/);
  assert.match(emitWarnings(far)[0], /0\.\.32000/);
});

test('emit: an image from an ^FT field whose bottom-left corner passes 32000 is limited and reported', () => {
  const items = [image(0, 319995, bm(8, 100), { origin: 'FT' })];
  assert.match(emitLines(items)[0], /^\^FT0,32000\^GFA/);
  assert.match(emitWarnings(items)[0], /0\.\.32000/);
});

test('emit: total = rows * bytes per row and bytes sent = total for every size, rows of whole bytes', () => {
  for (const [w, h] of [[1, 1], [8, 3], [9, 3], [17, 5]]) {
    const line = emitLines([image(0, 0, bm(w, h))])[0];
    const m = /\^GFA,(\d+),(\d+),(\d+),/.exec(line);
    const [sent, total, row] = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.equal(sent, total);
    assert.equal(row, Math.ceil(w / 8));
    assert.equal(total, row * h);
  }
});

test('emit: a bitmap over 99999 bytes is not written and is reported once with the limit', () => {
  const items = [image(0, 0, bm(8, 100000))];
  assert.equal(emitLines(items).length, 0);
  assert.match(emitWarnings(items)[0], /99999/);
});

// ---- Insertion from the overlay (imageCommand)

const M = { w: 8, h: 2, data: new Uint8Array(16).fill(1) };

test('imageCommand: a negative position is refused with a Spanish error that states the range (never moved to 0 silently)', () => {
  assert.throws(() => zpl.imageCommand({ xMm: -3, yMm: 0, ...M, dpi: 203 }), e => e instanceof Error && /0\.\.32000/.test(e.message) && /posición/.test(e.message));
  assert.throws(() => zpl.imageCommand({ xMm: 0, yMm: '-1', ...M, dpi: 203 }), /0\.\.32000/);
});

test('imageCommand: a position over 32000 dots is refused with the range; exactly 32000 dots is accepted', () => {
  assert.throws(() => zpl.imageCommand({ xMm: 5000, yMm: 0, ...M, dpi: 203 }), /32000/);
  assert.match(zpl.imageCommand({ xMm: 3200, yMm: 0, ...M, dpi: 254 }), /^\^FO32000,0\^GFA/);
});

test('imageCommand: data that is not w x h dots is refused with a Spanish error', () => {
  assert.throws(() => zpl.imageCommand({ xMm: 0, yMm: 0, w: 8, h: 2, data: new Uint8Array(7), dpi: 203 }), /datos/);
  assert.throws(() => zpl.imageCommand({ xMm: 0, yMm: 0, w: 8, h: 2, data: null, dpi: 203 }), /datos/);
});

test('imageCommand: the limit error names the range of b, c and d', () => {
  assert.throws(() => zpl.imageCommand({ xMm: 0, yMm: 0, w: 8, h: 100000, data: new Uint8Array(800000), dpi: 203 }), /1\.\.99999/);
});
