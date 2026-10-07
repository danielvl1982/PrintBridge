const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TSPL moveItem (T2): every TSPL slice provides `coordinates`, so the generic move engine rewrites only the position
// arguments of the item's command (js/languages/tspl-edit.js, wired in js/languages/tspl.js).
const PB = loadUpTo('js/languages/tspl.js');
const tspl = PB.languages.get('tspl');

const DOT = { 203: PB.units.dotSize(203), 300: PB.units.dotSize(300) };
const HEAD = 'SIZE 100 mm,60 mm\r\nCLS\r\n';
const TAIL = 'PRINT 1,1\r\n';

/** Parses the document, moves item `index` by dx/dy dots (converted to 0.1 mm) and returns { out, before, after }. */
function move(text, dxDots, dyDots, { dpi = 203, index = 0 } = {}) {
  const model = tspl.parse(text, { dpi });
  const item = model.items[index];
  const out = tspl.moveItem(text, item, dxDots * DOT[dpi], dyDots * DOT[dpi], { dpi });
  return { out, before: item, after: tspl.parse(out, { dpi }).items[index] };
}

const doc = line => HEAD + line + '\r\n' + TAIL;

/** The re-parsed item moved by the delta (within one dot of rounding). */
function assertMoved({ before, after }, dxDots, dyDots, dpi) {
  const tolerance = DOT[dpi] + 1e-6;
  assert.ok(Math.abs(after.x - (before.x + dxDots * DOT[dpi])) <= tolerance, `x ${before.x} -> ${after.x}`);
  assert.ok(Math.abs(after.y - (before.y + dyDots * DOT[dpi])) <= tolerance, `y ${before.y} -> ${after.y}`);
}

test('the TSPL slices make text, barcode, qr, line and image items movable', () => {
  const composed = PB.composeSlices('tspl', PB.tspl.SLICE_HELPERS, {});
  for (const kind of ['text', 'barcode', 'qr', 'line', 'image']) assert.ok(composed.movable.includes(kind), kind);
});

test('moveItem through the registered language: the item has a source span and moves', () => {
  const text = doc('TEXT 100,200,"3",0,1,1,"Hello"');
  const model = tspl.parse(text, { dpi: 203 });
  assert.ok(PB.sources.rangeOf(model.items[0]), 'source span');
  const out = tspl.moveItem(text, model.items[0], 10 * DOT[203], 20 * DOT[203], { dpi: 203 });
  assert.equal(out, doc('TEXT 110,220,"3",0,1,1,"Hello"'));
});

// ---- TEXT and BLOCK

test('moveItem: TEXT moves x and y only, at 203 and 300 dpi', () => {
  const text = doc('TEXT 100,200,"3",0,1,1,"Hello"');
  for (const dpi of [203, 300]) {
    const r = move(text, 30, -50, { dpi });
    assert.equal(r.out, doc('TEXT 130,150,"3",0,1,1,"Hello"'));
    assertMoved(r, 30, -50, dpi);
  }
});

test('moveItem: TEXT with an alignment argument and a comma inside the content only changes x and y', () => {
  const text = doc('TEXT 100,200,"3",0,1,1,2,"a, b"');
  assert.equal(move(text, 5, 5).out, doc('TEXT 105,205,"3",0,1,1,2,"a, b"'));
});

test('moveItem: BLOCK moves x and y only and keeps width, height and content', () => {
  const text = doc('BLOCK 100,200,300,150,"3",0,1,1,"Some, long text"');
  const r = move(text, 12, 7);
  assert.equal(r.out, doc('BLOCK 112,207,300,150,"3",0,1,1,"Some, long text"'));
  assertMoved(r, 12, 7, 203);
});

test('moveItem: a counter (@1) in the content does not prevent the move and stays untouched', () => {
  const text = doc('TEXT 100,200,"3",0,1,1,"N"+@1');
  assert.equal(move(text, 10, 10).out, doc('TEXT 110,210,"3",0,1,1,"N"+@1'));
});

// ---- BARCODE and QRCODE

test('moveItem: BARCODE moves x and y only', () => {
  const text = doc('BARCODE 100,200,"128",80,1,0,2,2,"12345"');
  for (const dpi of [203, 300]) {
    const r = move(text, -40, 25, { dpi });
    assert.equal(r.out, doc('BARCODE 60,225,"128",80,1,0,2,2,"12345"'));
    assertMoved(r, -40, 25, dpi);
  }
});

test('moveItem: BARCODE with an alignment argument and a counter moves', () => {
  const text = doc('BARCODE 100,200,"128",80,1,0,2,2,1,@1');
  assert.equal(move(text, 10, 0).out, doc('BARCODE 110,200,"128",80,1,0,2,2,1,@1'));
});

test('moveItem: QRCODE moves x and y only', () => {
  const text = doc('QRCODE 100,200,H,4,A,0,"https://example.com"');
  for (const dpi of [203, 300]) {
    const r = move(text, 15, 15, { dpi });
    assert.equal(r.out, doc('QRCODE 115,215,H,4,A,0,"https://example.com"'));
    assertMoved(r, 15, 15, dpi);
  }
});

test('moveItem: QRCODE with optional parameters keeps them', () => {
  const text = doc('QRCODE 100,200,L,4,M,0,M2,S7,"B0004abcd"');
  assert.equal(move(text, 1, 2).out, doc('QRCODE 101,202,L,4,M,0,M2,S7,"B0004abcd"'));
});

// ---- BAR and BOX

test('moveItem: BAR shifts x and y and keeps width and height', () => {
  const text = doc('BAR 100,200,300,4');
  for (const dpi of [203, 300]) {
    const r = move(text, 20, -10, { dpi });
    assert.equal(r.out, doc('BAR 120,190,300,4'));
    assertMoved({ before: { x: r.before.x1, y: r.before.y1 }, after: { x: r.after.x1, y: r.after.y1 } }, 20, -10, dpi);
  }
});

test('moveItem: a vertical BAR (height larger than width) moves the same way', () => {
  const text = doc('BAR 100,200,4,300');
  const r = move(text, 8, 9);
  assert.equal(r.out, doc('BAR 108,209,4,300'));
  assert.ok(Math.abs(r.after.x1 - (r.before.x1 + 8 * DOT[203])) <= DOT[203] + 1e-6);
});

test('moveItem: BOX shifts both corners by the same dots and keeps thickness and radius', () => {
  const text = doc('BOX 100,200,500,400,3,8');
  for (const dpi of [203, 300]) {
    const r = move(text, 25, -30, { dpi });
    assert.equal(r.out, doc('BOX 125,170,525,370,3,8'));
    assert.ok(Math.abs(r.after.x2 - (r.before.x2 + 25 * DOT[dpi])) <= DOT[dpi] + 1e-6);
    assert.ok(Math.abs(r.after.y2 - (r.before.y2 - 30 * DOT[dpi])) <= DOT[dpi] + 1e-6);
    assertMoved({ before: { x: r.before.x1, y: r.before.y1 }, after: { x: r.after.x1, y: r.after.y1 } }, 25, -30, dpi);
  }
});

test('moveItem: BOX clamps each corner at 0 dots', () => {
  assert.equal(move(doc('BOX 10,20,500,400,3'), -100, -100).out, doc('BOX 0,0,400,300,3'));
});

// ---- BITMAP

test('moveItem: BITMAP changes only the header position and keeps a latin1 payload byte for byte', () => {
  // 2 bytes x 4 rows = 8 payload bytes that look like commas, line breaks and quotes
  const payload = String.fromCharCode(0x2C, 0x0D, 0x0A, 0x22, 0xFF, 0x80, 0x2C, 0x0A);
  const text = `${HEAD}BITMAP 100,200,2,4,0,${payload}\r\n${TAIL}`;
  const r = move(text, 10, 20);
  assert.equal(r.out, `${HEAD}BITMAP 110,220,2,4,0,${payload}\r\n${TAIL}`);
  assertMoved(r, 10, 20, 203);
  assert.deepEqual([...r.after.bitmap.data], [...r.before.bitmap.data]);
});

// ---- REFERENCE, SHIFT, clamp, CRLF, other lines

test('moveItem: REFERENCE and SHIFT are subtracted, so the item lands under the cursor', () => {
  const text = 'REFERENCE 10,20\r\nSHIFT 3,4\r\n' + doc('TEXT 100,200,"3",0,1,1,"Hi"');
  const model = tspl.parse(text, { dpi: 203 });
  const out = tspl.moveItem(text, model.items[0], 50 * DOT[203], 50 * DOT[203], { dpi: 203 });
  assert.equal(out, 'REFERENCE 10,20\r\nSHIFT 3,4\r\n' + doc('TEXT 150,250,"3",0,1,1,"Hi"'));
  const after = tspl.parse(out, { dpi: 203 }).items[0];
  assert.ok(Math.abs(after.x - (model.items[0].x + 50 * DOT[203])) <= DOT[203]);
});

test('moveItem: clamps at 0 dots', () => {
  assert.equal(move(doc('TEXT 10,20,"3",0,1,1,"Hi"'), -1000, -1000).out, doc('TEXT 0,0,"3",0,1,1,"Hi"'));
  assert.equal(move(doc('BARCODE 10,20,"128",80,1,0,2,2,"1"'), -1000, -1000).out, doc('BARCODE 0,0,"128",80,1,0,2,2,"1"'));
});

test('moveItem: only the targeted command changes and CRLF is preserved', () => {
  const text = HEAD + 'TEXT 1,2,"3",0,1,1,"first"\r\nBOX 10,10,50,50,2\r\nTEXT 100,200,"3",0,1,1,"second"\r\n' + TAIL;
  const out = tspl.moveItem(text, tspl.parse(text, { dpi: 203 }).items[2], 5 * DOT[203], 0, { dpi: 203 });
  assert.equal(out, HEAD + 'TEXT 1,2,"3",0,1,1,"first"\r\nBOX 10,10,50,50,2\r\nTEXT 105,200,"3",0,1,1,"second"\r\n' + TAIL);
  assert.ok(!/\r\r|(?<!\r)\n/.test(out));
});

test('moveItem: LF-only documents stay LF', () => {
  const text = 'SIZE 100 mm,60 mm\nTEXT 100,200,"3",0,1,1,"Hi"\nPRINT 1\n';
  const out = tspl.moveItem(text, tspl.parse(text, { dpi: 203 }).items[0], 10 * DOT[203], 0, { dpi: 203 });
  assert.equal(out, 'SIZE 100 mm,60 mm\nTEXT 110,200,"3",0,1,1,"Hi"\nPRINT 1\n');
});
