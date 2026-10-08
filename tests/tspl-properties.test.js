const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TSPL properties (T3): every TSPL slice provides `editable`, so describeItem/updateItem (js/languages/tspl-edit.js,
// wired in js/languages/tspl.js) list and rewrite the numeric/choice arguments of the item's command.
const PB = loadUpTo('js/languages/tspl.js');
const tspl = PB.languages.get('tspl');

const HEAD = 'SIZE 100 mm,60 mm\r\nCLS\r\n';
const TAIL = 'PRINT 1,1\r\n';
const doc = (...lines) => HEAD + lines.map(l => l + '\r\n').join('') + TAIL;

const itemOf = (text, index = 0) => tspl.parse(text, { dpi: 203 }).items[index];
const describe = (text, index = 0) => tspl.describeItem(itemOf(text, index), text, { dpi: 203 });
const byKey = (description, key) => description.fields.find(f => f.key === key);
const pairs = description => description.fields.map(f => [f.key, f.value]);
const update = (text, changes, index = 0) => tspl.updateItem(text, itemOf(text, index), changes, { dpi: 203 });

test('the TSPL slices provide editable definitions for text, barcode, qr and line items', () => {
  const composed = PB.composeSlices('tspl', PB.tspl.SLICE_HELPERS, {});
  assert.ok(composed.editable.length >= 5);
});

// ---- TEXT

test('describeItem: TEXT lists rotation and both multipliers with the values of the command', () => {
  const d = describe(doc('TEXT 100,200,"3",90,2,3,"Hello, world"'));
  assert.equal(d.kind, 'text');
  assert.deepEqual(pairs(d), [['rotation', 90], ['xmul', 2], ['ymul', 3], ['font', '3'], ['content', 'Hello, world']]);
  assert.equal(byKey(d, 'rotation').type, 'select');
  assert.deepEqual(byKey(d, 'rotation').options.map(o => o.value), [0, 90, 180, 270]);
  assert.equal(byKey(d, 'xmul').type, 'number');
  assert.equal(byKey(d, 'xmul').min, 1);
  assert.equal(byKey(d, 'xmul').max, 10);
});

test('describeItem: TEXT with an alignment argument is described the same way', () => {
  assert.deepEqual(pairs(describe(doc('TEXT 100,200,"3",180,1,2,2,"Hi"'))), [['rotation', 180], ['xmul', 1], ['ymul', 2], ['font', '3'], ['content', 'Hi']]);
});

test('describeItem: a scalable font (point sizes) allows multipliers above 10', () => {
  const d = describe(doc('TEXT 100,200,"0",0,24,30,"Hi"'));
  assert.deepEqual(pairs(d), [['rotation', 0], ['xmul', 24], ['ymul', 30], ['font', '0'], ['content', 'Hi']]);
  assert.ok(byKey(d, 'ymul').max > 10);
});

test('font: TEXT lists the ids the viewer knows as a string select and shows the current one', () => {
  const f = byKey(describe(doc('TEXT 100,200,"3",0,1,1,"Hi"')), 'font');
  assert.deepEqual([f.label, f.type, f.value], ['Fuente', 'select', '3']);
  assert.deepEqual(f.options.map(o => o.value), ['1', '2', '3', '4', '5', '6', '7', '8', '0', 'ROMAN.TTF']);
  assert.equal(f.options.find(o => o.value === '3').label, '3 · 16×24 puntos (monoespaciada)');
  assert.equal(f.options.find(o => o.value === '0').label, '0 · Escalable (sans)');
  assert.equal(byKey(describe(doc('TEXT 100,200,"ROMAN.TTF",0,10,10,"Hi"')), 'font').value, 'ROMAN.TTF');
});

test('font: updateItem rewrites only the quoted id, with and without the alignment argument', () => {
  assert.equal(update(doc('TEXT 100,200,"3",0,1,1,"Hi"'), { font: '5' }), doc('TEXT 100,200,"5",0,1,1,"Hi"'));
  assert.equal(update(doc('TEXT 100,200,"3",90,2,2,2,"Hi, there"'), { font: '0' }), doc('TEXT 100,200,"0",90,2,2,2,"Hi, there"'));
  assert.equal(update(doc('TEXT 100,200,"3",0,1,1,"Hi"'), { font: 'ROMAN.TTF', xmul: 4 }), doc('TEXT 100,200,"ROMAN.TTF",0,4,1,"Hi"'));
});

test('font: an id outside the list is ignored when written, and shown as an extra option when it is the current one', () => {
  const text = doc('TEXT 100,200,"3",0,1,1,"Hi"');
  for (const font of ['9', 'x', '', 3, null]) assert.equal(update(text, { font }), text);
  const odd = doc('TEXT 100,200,"9",0,1,1,"Hi"');
  const f = byKey(describe(odd), 'font');
  assert.equal(f.value, '9');
  assert.deepEqual(f.options.map(o => o.value).slice(-1), ['9']);
  assert.equal(update(odd, { font: '2' }), doc('TEXT 100,200,"2",0,1,1,"Hi"'));
  assert.equal(update(odd, { font: '9' }), odd);
});

test('font: an id that is not a plain quoted string leaves the field out and is never edited', () => {
  const bare = doc('TEXT 100,200,3,0,1,1,"Hi"');
  assert.equal(byKey(describe(bare), 'font'), undefined);
  assert.equal(update(bare, { font: '2' }), bare);
});

test('font: LF line endings behave like CRLF', () => {
  const text = 'SIZE 100 mm,60 mm\nCLS\nTEXT 100,200,"3",0,1,1,"Hi"\nPRINT 1,1\n';
  assert.equal(update(text, { font: '4' }), text.replace('"3"', '"4"'));
});

test('describeItem: BLOCK has no editable fields (its content and layout are never touched)', () => {
  const text = doc('BLOCK 100,200,300,150,"3",0,1,1,"Some, long text"');
  assert.deepEqual(describe(text), { kind: 'text', fields: [] });
  assert.equal(update(text, { rotation: 90, xmul: 3 }), text);
});

test('updateItem: TEXT rewrites only the changed arguments; the content (commas, counters) and other lines stay', () => {
  const text = doc('REFERENCE 5,5', 'TEXT 100,200,"3",0,1,1,"Hello, world"', 'TEXT 10,10,"3",0,1,1,"Other"');
  const out = update(text, { rotation: 270, ymul: 4 }, 0);
  assert.equal(out, doc('REFERENCE 5,5', 'TEXT 100,200,"3",270,1,4,"Hello, world"', 'TEXT 10,10,"3",0,1,1,"Other"'));
  const model = itemOf(out);
  assert.equal(model.rotation, 270);
  assert.equal(model.native.ymul, 4);
  assert.equal(model.data, 'Hello, world');
});

test('updateItem: TEXT with a counter and an alignment keeps them untouched', () => {
  const text = doc('TEXT 100,200,"3",0,1,1,2,"N"+@1');
  assert.equal(update(text, { xmul: 5 }), doc('TEXT 100,200,"3",0,5,1,2,"N"+@1'));
});

test('updateItem: TEXT multipliers are clamped to 1..10 for a bitmap font and rounded', () => {
  const text = doc('TEXT 100,200,"3",0,2,2,"Hi"');
  assert.equal(update(text, { xmul: 99, ymul: 0 }), doc('TEXT 100,200,"3",0,10,1,"Hi"'));
  assert.equal(update(text, { xmul: 3.4 }), doc('TEXT 100,200,"3",0,3,2,"Hi"'));
});

test('updateItem: TEXT rotation outside the options, unknown keys and a missing key change nothing', () => {
  const text = doc('TEXT 100,200,"3",0,2,2,"Hi"');
  assert.equal(update(text, { rotation: 45 }), text);
  assert.equal(update(text, { nope: 1, font: 'x', data: 'y' }), text);
  assert.equal(update(text, {}), text);
});

test('updateItem: CRLF is preserved and no stray CR appears', () => {
  const out = update(doc('TEXT 1,2,"3",0,1,1,"Hi"'), { xmul: 2 });
  assert.ok(!/\r\r/.test(out));
  assert.equal(out.split('\r\n').length, doc('TEXT 1,2,"3",0,1,1,"Hi"').split('\r\n').length);
  assert.ok(!/(^|[^\r])\n/.test(out));
});

// ---- BARCODE

test('describeItem: BARCODE lists height, readable, rotation and narrow (wide only for Code 39 / ITF)', () => {
  const code128 = describe(doc('BARCODE 100,200,"128",80,1,0,2,2,"ABC,123"'));
  assert.deepEqual(pairs(code128), [['height', 80], ['readable', 1], ['rotation', 0], ['narrow', 2], ['content', 'ABC,123']]);
  assert.equal(byKey(code128, 'readable').type, 'select');
  assert.deepEqual(byKey(code128, 'readable').options.map(o => o.value), [0, 1, 2, 3]);
  const code39 = describe(doc('BARCODE 100,200,"39",60,0,90,3,6,"ABC"'));
  assert.deepEqual(pairs(code39), [['height', 60], ['readable', 0], ['rotation', 90], ['narrow', 3], ['wide', 6], ['content', 'ABC']]);
  const itf = describe(doc('BARCODE 100,200,"25",60,0,0,2,5,"1234"'));
  assert.equal(byKey(itf, 'wide').value, 5);
});

test('describeItem: BARCODE with an alignment argument is described the same way', () => {
  assert.deepEqual(pairs(describe(doc('BARCODE 100,200,"128",50,2,180,2,2,1,"X"'))), [['height', 50], ['readable', 2], ['rotation', 180], ['narrow', 2], ['content', 'X']]);
});

test('updateItem: BARCODE rewrites only the requested arguments; content with commas untouched', () => {
  const text = doc('BARCODE 100,200,"128",80,1,0,2,2,"A,B,C"', 'TEXT 1,1,"1",0,1,1,"keep"');
  const out = update(text, { height: 120, readable: 0, rotation: 90, narrow: 3 });
  assert.equal(out, doc('BARCODE 100,200,"128",120,0,90,3,2,"A,B,C"', 'TEXT 1,1,"1",0,1,1,"keep"'));
  const model = itemOf(out);
  const dot = PB.units.dotSize(203);
  assert.equal(model.rotation, 90);
  assert.equal(model.humanReadable, false);
  assert.ok(Math.abs(model.height - 120 * dot) < 1e-6);
  assert.ok(Math.abs(model.module - 3 * dot) < 1e-6);
  assert.equal(model.data, 'A,B,C');
});

test('updateItem: BARCODE wide on a Code 39 label, clamped; a counter content stays', () => {
  const text = doc('BARCODE 100,200,"39",60,0,0,2,5,"N"+@1');
  assert.equal(update(text, { wide: 6 }), doc('BARCODE 100,200,"39",60,0,0,2,6,"N"+@1'));
  assert.equal(update(text, { height: 0, narrow: 99 }), doc('BARCODE 100,200,"39",1,0,0,10,5,"N"+@1'));
});

test('updateItem: BARCODE wide is ignored when the type is not Code 39 / ITF', () => {
  const text = doc('BARCODE 100,200,"128",80,1,0,2,2,"ABC"');
  assert.equal(update(text, { wide: 9 }), text);
});

test('updateItem: BARCODE readable outside the options changes nothing', () => {
  const text = doc('BARCODE 100,200,"128",80,1,0,2,2,"ABC"');
  assert.equal(update(text, { readable: 7 }), text);
});

// ---- QRCODE

test('describeItem: QRCODE lists ECC level, cell width and rotation', () => {
  const d = describe(doc('QRCODE 100,200,Q,5,A,90,"https://x.y/?a=1,2"'));
  assert.deepEqual(pairs(d), [['ecc', 'Q'], ['cell', 5], ['rotation', 90], ['content', 'https://x.y/?a=1,2']]);
  assert.equal(byKey(d, 'ecc').type, 'select');
  assert.deepEqual(byKey(d, 'ecc').options.map(o => o.value), ['L', 'M', 'Q', 'H']);
  assert.equal(byKey(d, 'cell').min, 1);
  assert.equal(byKey(d, 'cell').max, 10);
});

test('describeItem: QRCODE skips an ECC level it does not know', () => {
  assert.deepEqual(pairs(describe(doc('QRCODE 100,200,Z,5,A,0,"x"'))).map(p => p[0]), ['cell', 'rotation', 'content']);
});

test('updateItem: QRCODE rewrites ECC and cell only; mode, extras and content (commas) stay', () => {
  const text = doc('QRCODE 100,200,M,4,A,0,M2,S7,"a,b"');
  const out = update(text, { ecc: 'H', cell: 8 });
  assert.equal(out, doc('QRCODE 100,200,H,8,A,0,M2,S7,"a,b"'));
  const model = itemOf(out);
  assert.equal(model.ecc, 'H');
  assert.ok(Math.abs(model.cell - 8 * PB.units.dotSize(203)) < 1e-6);
  assert.equal(model.data, 'a,b');
});

test('updateItem: QRCODE cell is clamped to 1..10 and an invalid ECC level is ignored', () => {
  const text = doc('QRCODE 100,200,M,4,A,0,"x"');
  assert.equal(update(text, { cell: 50 }), doc('QRCODE 100,200,M,10,A,0,"x"'));
  assert.equal(update(text, { cell: -3 }), doc('QRCODE 100,200,M,1,A,0,"x"'));
  assert.equal(update(text, { ecc: 'Z' }), text);
});

test('updateItem: QRCODE rotation is rewritten and re-parsed in native', () => {
  const out = update(doc('QRCODE 100,200,M,4,A,0,"x"'), { rotation: 180 });
  assert.equal(out, doc('QRCODE 100,200,M,4,A,180,"x"'));
  assert.equal(itemOf(out).native.rotation, 180);
});

// ---- BAR

test('describeItem: BAR lists width and height in dots', () => {
  const d = describe(doc('BAR 100,200,300,4'));
  assert.deepEqual(pairs(d), [['width', 300], ['height', 4]]);
  assert.equal(d.kind, 'line');
});

test('updateItem: BAR rewrites width and height only (x and y untouched)', () => {
  const text = doc('BAR 100,200,300,4', 'BAR 1,2,3,4');
  const out = update(text, { width: 250, height: 9 }, 0);
  assert.equal(out, doc('BAR 100,200,250,9', 'BAR 1,2,3,4'));
  const model = itemOf(out);
  assert.equal(model.native.width, 250);
  assert.equal(model.native.height, 9);
});

test('updateItem: BAR clamps to at least 1 dot and ignores x/y keys', () => {
  const text = doc('BAR 100,200,300,4');
  assert.equal(update(text, { width: 0, height: -2 }), doc('BAR 100,200,1,1'));
  assert.equal(update(text, { x: 5, y: 5 }), text);
});

// ---- BOX

test('describeItem: BOX lists thickness, and the radius only when the command has one', () => {
  assert.deepEqual(pairs(describe(doc('BOX 10,20,300,200,4'))), [['thickness', 4]]);
  assert.deepEqual(pairs(describe(doc('BOX 10,20,300,200,4,12'))), [['thickness', 4], ['radius', 12]]);
});

test('updateItem: BOX rewrites thickness and radius, never the corners', () => {
  const text = doc('BOX 10,20,300,200,4,12');
  const out = update(text, { thickness: 6, radius: 0, x_end: 5, xEnd: 5 });
  assert.equal(out, doc('BOX 10,20,300,200,6,0'));
  assert.equal(itemOf(out).native.width, 6);
});

test('updateItem: BOX thickness is clamped to at least 1 and a radius is not invented', () => {
  const text = doc('BOX 10,20,300,200,4');
  assert.equal(update(text, { thickness: 0 }), doc('BOX 10,20,300,200,1'));
  assert.equal(update(text, { radius: 5 }), text);
});

// ---- generic

test('updateItem only touches the item it was given, in a multi-item document with REFERENCE and SHIFT', () => {
  const text = doc('REFERENCE 10,20', 'SHIFT 3,4', 'TEXT 100,200,"3",0,1,1,"A"', 'BARCODE 1,2,"128",50,1,0,2,2,"B"', 'BAR 5,6,7,8');
  const out = update(text, { ymul: 2 }, 0);
  assert.equal(out, doc('REFERENCE 10,20', 'SHIFT 3,4', 'TEXT 100,200,"3",0,1,2,"A"', 'BARCODE 1,2,"128",50,1,0,2,2,"B"', 'BAR 5,6,7,8'));
  assert.equal(update(text, { height: 99 }, 1), doc('REFERENCE 10,20', 'SHIFT 3,4', 'TEXT 100,200,"3",0,1,1,"A"', 'BARCODE 1,2,"128",99,1,0,2,2,"B"', 'BAR 5,6,7,8'));
});

test('describeItem without text falls back to the item model (kind decides the fields)', () => {
  const model = tspl.parse(doc('TEXT 1,2,"3",90,2,3,"Hi"', 'BAR 1,2,30,4'), { dpi: 203 });
  assert.deepEqual(pairs(tspl.describeItem(model.items[0], undefined, { dpi: 203 })), [['rotation', 90], ['xmul', 2], ['ymul', 3], ['font', '3'], ['content', 'Hi']]);
  assert.deepEqual(pairs(tspl.describeItem(model.items[1], undefined, { dpi: 203 })), [['width', 30], ['height', 4]]);
});

// ---- content (text field)

const contentOf = (text, index = 0) => byKey(describe(text, index), 'content');

test('describeItem: TEXT lists its content as a text field (with and without an alignment argument)', () => {
  const f = contentOf(doc('TEXT 100,200,"3",0,1,1,"Hello, world"'));
  assert.equal(f.type, 'text');
  assert.equal(f.label, 'Contenido');
  assert.equal(f.value, 'Hello, world');
  assert.equal(contentOf(doc('TEXT 100,200,"3",0,1,1,2,"Aligned"')).value, 'Aligned');
});

test('describeItem: content is left out for counters, BLOCK, 128M / EAN128 barcodes and manual-mode QR', () => {
  assert.equal(contentOf(doc('TEXT 100,200,"3",0,1,1,"N"+@1')), undefined);
  assert.equal(contentOf(doc('BARCODE 100,200,"128",80,1,0,2,2,"N"+@1')), undefined);
  assert.equal(contentOf(doc('QRCODE 100,200,M,4,A,0,"N"+@1')), undefined);
  assert.equal(contentOf(doc('BLOCK 100,200,300,150,"3",0,1,1,"Some text"')), undefined);
  assert.equal(contentOf(doc('BARCODE 100,200,"128M",80,1,0,2,2,"!104AB"')), undefined);
  assert.equal(contentOf(doc('BARCODE 100,200,"EAN128",80,1,0,2,2,"0012"')), undefined);
  assert.equal(contentOf(doc('QRCODE 100,200,M,4,M,0,"AHELLO"')), undefined);
});

test('describeItem: BARCODE and QRCODE list their content (alignment argument included); the other fields keep their order', () => {
  assert.equal(contentOf(doc('BARCODE 100,200,"128",80,1,0,2,2,"ABC,123"')).value, 'ABC,123');
  assert.equal(contentOf(doc('BARCODE 100,200,"128",50,2,180,2,2,1,"X"')).value, 'X');
  assert.equal(contentOf(doc('BARCODE 100,200,"39",60,0,90,3,6,"CODE"')).value, 'CODE');
  assert.equal(contentOf(doc('QRCODE 100,200,Q,5,A,90,"https://x.y/?a=1,2"')).value, 'https://x.y/?a=1,2');
  assert.equal(contentOf(doc('QRCODE 100,200,M,4,A,0,M2,S7,"a,b"')).value, 'a,b');
});

test('describeItem without text: content comes from the item (and is left out for a counter)', () => {
  const text = doc('TEXT 1,1,"3",0,1,1,"Hi"', 'TEXT 1,1,"3",0,1,1,"N"+@1');
  assert.equal(byKey(tspl.describeItem(itemOf(text, 0), undefined, { dpi: 203 }), 'content').value, 'Hi');
  assert.equal(byKey(tspl.describeItem(itemOf(text, 1), undefined, { dpi: 203 }), 'content'), undefined);
});

test('updateItem: content rewrites only that argument of that command', () => {
  const text = doc('TEXT 100,200,"3",0,1,1,"Old"', 'TEXT 10,10,"3",0,1,1,"Other"');
  assert.equal(update(text, { content: 'New one' }, 0), doc('TEXT 100,200,"3",0,1,1,"New one"', 'TEXT 10,10,"3",0,1,1,"Other"'));
  assert.equal(update(doc('TEXT 100,200,"3",0,1,1,2,"Old"'), { content: 'x' }), doc('TEXT 100,200,"3",0,1,1,2,"x"'));
  assert.equal(update(doc('BARCODE 100,200,"128",80,1,0,2,2,"Old"'), { content: '12345' }), doc('BARCODE 100,200,"128",80,1,0,2,2,"12345"'));
  assert.equal(update(doc('BARCODE 100,200,"128",50,2,180,2,2,1,"Old"'), { content: 'Z' }), doc('BARCODE 100,200,"128",50,2,180,2,2,1,"Z"'));
  assert.equal(update(doc('QRCODE 100,200,M,4,A,0,M2,S7,"Old"'), { content: 'a,b' }), doc('QRCODE 100,200,M,4,A,0,M2,S7,"a,b"'));
});

test('updateItem: content with quotes, backslashes and commas re-parses to the same string', () => {
  for (const value of ['say "hi", ok', 'a\\b', 'c:\\dir\\"x"', '\\["]', 'x\\', '\u00f1,;+x ']) {
    for (const line of ['TEXT 1,2,"3",0,1,1,"Old"', 'BARCODE 1,2,"128",80,1,0,2,2,"Old"', 'QRCODE 1,2,M,4,A,0,"Old"']) {
      const out = update(doc(line), { content: value });
      if (value.endsWith('\\')) { assert.equal(out, doc(line), 'a trailing backslash is rejected'); continue; }
      assert.equal(itemOf(out).data, value,`${line} <- ${value}`);
    }
  }
});

test('updateItem: line breaks become spaces and the command stays on one line', () => {
  const out = update(doc('TEXT 1,2,"3",0,1,1,"Old"'), { content: 'a\r\nb\nc\rd' });
  assert.equal(out, doc('TEXT 1,2,"3",0,1,1,"a b c d"'));
});

test('updateItem: an empty string is allowed for TEXT; a non-string is ignored', () => {
  const text = doc('TEXT 1,2,"3",0,1,1,"Old"');
  assert.equal(update(text, { content: '' }), doc('TEXT 1,2,"3",0,1,1,""'));
  assert.equal(itemOf(update(text, { content: '' })).data, '');
  assert.equal(update(text, { content: 5 }), text);
  assert.equal(update(text, { content: null }), text);
});

test('updateItem: content is ignored for counters, BLOCK, 128M / EAN128 and manual-mode QR (the text is never touched)', () => {
  for (const line of [
    'TEXT 1,2,"3",0,1,1,"N"+@1', 'BLOCK 1,2,300,150,"3",0,1,1,"Some text"', 'BARCODE 1,2,"128M",80,1,0,2,2,"!104AB"',
    'BARCODE 1,2,"EAN128",80,1,0,2,2,"0012"', 'QRCODE 1,2,M,4,M,0,"AHELLO"', 'BARCODE 1,2,"128",80,1,0,2,2,"N"+@1',
  ]) {
    const text = doc(line);
    assert.equal(update(text, { content: 'changed' }), text, line);
  }
});

test('updateItem: content and numeric fields can change together', () => {
  const out = update(doc('TEXT 1,2,"3",0,1,1,"Old"'), { content: 'New', xmul: 3 });
  assert.equal(out, doc('TEXT 1,2,"3",0,3,1,"New"'));
});
