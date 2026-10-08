const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Z4: the ZPL 2D symbols: ^BQ (QR Code) and ^BX (Data Matrix) (js/components/qr/zpl.js, js/components/datamatrix/zpl.js).
// Parameter layouts of the 2003 guide (Volume One): ^BQa,b,c (a = orientation, fixed N; b = model 1 / 2; c = magnification 1..10, default by dpi)
// with the field data `<ECC><A|M>,<data>` (and the mixed mode with the `D<code><divisions><parity>,` header); ^BXo,h,s,c,r,f,g (o = orientation,
// h = module in dots (0: from ^BY h), s = quality 0 / 50 / 80 / 100 / 140 / 200 (default 0), c / r = columns / rows, f = format ID, g = escape character).
// All parses use 254 dpi, where one dot is exactly 0.1 mm, so dots and model units are the same number.
const PB = loadApp();
const zpl = PB.languages.get('zpl');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const DPI = 254;
const dm = PB.datamatrix;

const BASE = body => `^XA^PW800^LL480${body}^XZ`;
const parse = (src, dpi = DPI) => zpl.parse(src, { dpi });
const one = src => parse(BASE(src)).items[0];
const diagnostics = src => parse(BASE(src)).diagnostics.map(d => `${d.level}: ${d.text}`);
const emitLines = (model, dpi = DPI) => zpl.emit(model, { dpi }).text.split('\r\n').filter(l => l && !/^\^(XA|XZ|PW|LL)/.test(l));
const emitResult = (model, dpi = DPI) => zpl.emit(model, { dpi });
const roundTrip = src => emitLines(parse(BASE(src)));
const levels = (list, ...wanted) => list.filter(d => wanted.includes(d.level));
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol + 1e-6, `${label}: ${a} vs ${b} (tolerance ${tol})`);
const byKey = description => Object.fromEntries(description.fields.map(f => [f.key, f]));
const itemsOf = text => parse(text).items;
const update = (it, changes, text) => zpl.updateItem(text, it, changes, { dpi: DPI });
const describe = (it, text) => zpl.describeItem(it, text, { dpi: DPI });
const move = (it, text, dx, dy) => zpl.moveItem(text, it, dx, dy, { dpi: DPI });

/** Side in 0.1 mm of the drawn symbols (what the renderer draws; ^FT and the rotated ^FO need it). */
const qrSide = (data, ecc, cell) => PB.qr.matrix(data, ecc).size * cell;
const dmSide = (data, cell, size) => dm.encode(data, size ? { size } : undefined).side * cell;

// ---------------------------------------------------------------------------------------------------------------
// Registration

test('the qr and datamatrix slices register a zpl factory after tpcl and tspl; ZPL offers QR and Data Matrix in the palette after the barcode', () => {
  assert.deepEqual(Object.keys(PB.components.get('qr').languages), ['tpcl', 'tspl', 'zpl']);
  assert.deepEqual(Object.keys(PB.components.get('datamatrix').languages), ['tpcl', 'tspl', 'zpl']);
  assert.deepEqual(zpl.componentTemplates().map(c => [c.kind, c.label]), [['text', 'Texto'], ['barcode', 'Código de barras'], ['qr', 'QR'], ['datamatrix', 'Data Matrix']]);
});

// ---------------------------------------------------------------------------------------------------------------
// QR: parse

test('parse ^BQ: a QR item with model, magnification, error correction level and data, no diagnostics', () => {
  const model = parse(BASE('^FO100,50^BQN,2,4^FDQA,HELLO^FS'));
  assert.deepEqual(model.diagnostics, []);
  const [item] = model.items;
  assert.equal(item.kind, 'qr');
  assert.deepEqual([item.symbology, item.ecc, item.cell, item.data, item.x, item.y], ['qr', 'Q', 4, 'HELLO', 100, 50]);
  assert.equal(item.native.type, 'BQ');
  assert.deepEqual([item.native.model, item.native.cell, item.native.mode, item.native.origin], [2, 4, 'A', 'FO']);
  assert.ok(item.source.spans.length === 1);
});

test('parse ^BQ: each error correction level of the field data (H Q M L)', () => {
  for (const level of ['H', 'Q', 'M', 'L']) {
    const item = one(`^FO10,10^BQN,2,3^FD${level}A,DATA^FS`);
    assert.deepEqual([item.ecc, item.data], [level, 'DATA'], level);
  }
});

test('parse ^BQ: the orientation is fixed to N (^FW has no effect); another letter is reported once and ignored', () => {
  const rotated = parse(BASE('^FWR^FO10,10^BQR,2,4^FDMA,A^FS^FO10,100^BQI,2,4^FDMA,B^FS^FO10,200^BQ,2,4^FDMA,C^FS'));
  assert.equal(rotated.items.length, 3);
  assert.ok(rotated.items.every(i => i.rotation === undefined && i.kind === 'qr'));
  const infos = rotated.diagnostics.filter(d => d.level === 'info' && /orientaci/.test(d.text));
  assert.equal(infos.length, 1);
  assert.deepEqual(diagnostics('^FO10,10^BQN,2,4^FDMA,A^FS'), []);
});

test('parse ^BQ: the magnification defaults by resolution (150: 1, 200: 2, 300: 3, 600: 6) and an invalid one is reported', () => {
  const dot = dpi => PB.units.dotSize(dpi);
  for (const [dpi, mag] of [[150, 1], [203, 2], [300, 3], [600, 6]]) {
    const item = parse(BASE('^FO10,10^BQN,2^FDMA,A^FS'), dpi).items[0];
    near(item.cell, mag * dot(dpi), 1e-6, `dpi ${dpi}`);
    assert.equal(item.native.cell, mag, `dpi ${dpi}`);
  }
  assert.equal(one('^FO10,10^BQ^FDMA,A^FS').native.cell, 3);
  for (const bad of ['0', '11', 'x']) {
    const model = parse(BASE(`^FO10,10^BQN,2,${bad}^FDMA,A^FS`));
    assert.ok(model.diagnostics.some(d => d.level === 'warning' && /\^BQ/.test(d.text) && /magnificaci/.test(d.text)), bad);
    assert.equal(model.items[0].native.cell, 3, bad);
  }
});

test('parse ^BQ: model 1 is drawn as model 2 (info once); a model other than 1 / 2 is a warning and model 2', () => {
  const m1 = parse(BASE('^FO10,10^BQN,1,4^FDMA,A^FS^FO10,100^BQN,1,4^FDMA,B^FS'));
  assert.equal(m1.items[0].native.model, 1);
  assert.equal(m1.diagnostics.filter(d => d.level === 'info' && /modelo 1/.test(d.text)).length, 1);
  const m3 = parse(BASE('^FO10,10^BQN,3,4^FDMA,A^FS'));
  assert.equal(m3.items[0].native.model, 2);
  assert.ok(m3.diagnostics.some(d => d.level === 'warning' && /modelo/.test(d.text)));
  assert.equal(one('^FO10,10^BQN,,4^FDMA,A^FS').native.model, 2);
});

test('parse ^BQ: manual input (M) strips the character mode prefixes; the guide examples', () => {
  const numeric = one('^FO20,20^BQ,2,10^FDHM,N123456789012345^FS');
  assert.deepEqual([numeric.ecc, numeric.data, numeric.native.mode, numeric.native.cell], ['H', '123456789012345', 'M', 10]);
  assert.equal(one('^FO20,20^BQ,2,10^FDMM,AAC-42^FS').data, 'AC-42');
  assert.equal(one('^FO20,20^BQN,2,10^FDQM,B0006qrcode^FS').data, 'qrcode');
  assert.deepEqual(diagnostics('^FO20,20^BQ,2,10^FDMM,AAC-42^FS'), []);
});

test('parse ^BQ: the mixed mode (D header) is reported; the data segments are drawn joined (not verified)', () => {
  const manual = parse(BASE('^FO20,20^BQ,2,10^FDD03048F,LM,N0123456789,A12AABB,B0006qrcode^FS'));
  assert.deepEqual([manual.items[0].ecc, manual.items[0].data, manual.items[0].native.mixed], ['L', '012345678912AABBqrcode', true]);
  assert.ok(manual.diagnostics.some(d => d.level === 'info' && /mixto/.test(d.text)));
  const auto = parse(BASE('^FO20,20^BQ,2,10^FDD03048F,LA,012345678912AABBqrcode^FS'));
  assert.deepEqual([auto.items[0].ecc, auto.items[0].data], ['L', '012345678912AABBqrcode']);
});

test('parse ^BQ: field data without the ECC prefix is drawn as written with level M and reported once', () => {
  const model = parse(BASE('^FO10,10^BQN,2,4^FDplain data^FS^FO10,100^BQN,2,4^FDmore^FS'));
  assert.deepEqual(model.items.map(i => [i.ecc, i.data, i.native.mode]), [['M', 'plain data', null], ['M', 'more', null]]);
  assert.equal(model.diagnostics.filter(d => d.level === 'warning' && /prefijo/.test(d.text)).length, 1);
});

test('parse ^BQ: ^FO is the top-left corner of the symbol, ^FT its bottom-left corner (not verified for 2D symbols); ^LH is added', () => {
  const fo = one('^FO100,50^BQN,2,4^FDQA,HELLO^FS');
  const ft = one('^FT100,200^BQN,2,4^FDQA,HELLO^FS');
  near(ft.y, 200 - qrSide('HELLO', 'Q', 4), 1e-6, 'FT y');
  assert.equal(ft.x, 100);
  assert.equal(ft.native.origin, 'FT');
  assert.equal(fo.native.origin, 'FO');
  const lh = one('^LH20,10^FO100,50^BQN,2,4^FDQA,HELLO^FS');
  assert.deepEqual([lh.x, lh.y], [120, 60]);
});

test('parse ^BQ: ^FH escapes in the data are decoded; a field without data draws nothing; the neighbouring commands are untouched', () => {
  assert.equal(one('^FO10,10^BQN,2,4^FH^FDMA,a_5Eb_7Ec^FS').data, 'a^b~c');
  assert.deepEqual(parse(BASE('^FO10,10^BQN,2,4^FS')).items, []);
  const two = parse(BASE('^FO10,10^A0N,30,30^FDHi^FS^FO10,100^BQN,2,4^FDMA,X^FS'));
  assert.deepEqual(two.items.map(i => i.kind), ['text', 'qr']);
  assert.ok(!two.diagnostics.some(d => /no soportado/.test(d.text)));
});

// ---------------------------------------------------------------------------------------------------------------
// QR: emit

test('emit ^BQ: round trips of what the parser reads (^FO, ^FT, each level, manual and mixed modes kept as written)', () => {
  for (const src of [
    '^FO100,50^BQN,2,4^FDQA,HELLO^FS',
    '^FO100,50^BQN,2,10^FDHA,HELLO WORLD^FS',
    '^FT100,200^BQN,2,4^FDMA,HELLO^FS',
    '^FO20,20^BQN,2,10^FDHM,N123456789012345^FS',
    '^FO20,20^BQN,2,10^FDD03048F,LM,N0123456789,A12AABB,B0006qrcode^FS',
    '^FO20,20^BQN,1,3^FDLA,x^FS',
  ]) assert.deepEqual(roundTrip(src), [src], src);
  // every case parses to the same item after the round trip
  const first = one('^FT100,200^BQN,2,4^FDQA,HELLO^FS');
  const again = parse(zpl.emit(parse(BASE('^FT100,200^BQN,2,4^FDQA,HELLO^FS')), { dpi: DPI }).text).items[0];
  assert.deepEqual([again.x, again.y, again.ecc, again.cell, again.data], [first.x, first.y, first.ecc, first.cell, first.data]);
});

test('emit ^BQ: a neutral item (another language) is written as ^FO ^BQN,2,<mag> ^FD<ECC>A,<data> with the escapes of ^ and ~', () => {
  const qr = (extra = {}) => ({ kind: 'qr', ref: 'QRCODE', x: 100, y: 50, ecc: 'H', cell: 3, symbology: 'qr', native: {}, data: 'AB', ...extra });
  const model = extra => ({ size: { width: 800, height: 480 }, items: [qr(extra)] });
  assert.deepEqual(emitLines(model()), ['^FO100,50^BQN,2,3^FDHA,AB^FS']);
  assert.deepEqual(emitLines(model({ data: 'a^b~c' })), ['^FO100,50^BQN,2,3^FH^FDHA,a_5Eb_7Ec^FS']);
  assert.deepEqual(emitLines(model({ data: 'a\r\nb' })), ['^FO100,50^BQN,2,3^FDHA,a b^FS']);
  assert.deepEqual(emitLines(model({ native: { model: 1 } })), ['^FO100,50^BQN,1,3^FDHA,AB^FS']);
  assert.deepEqual(emitLines(model({ native: { mode: 'M', zplData: 'HM,NAB' } })), ['^FO100,50^BQN,2,3^FDHA,AB^FS'], 'a stale written form is not reused');
  const big = emitResult(model({ cell: 20 }));
  assert.match(big.text, /\^BQN,2,10\^/);
  assert.equal(levels(big.diagnostics, 'warning').filter(d => /1\.\.10/.test(d.text)).length, 1);
  const unknown = emitResult(model({ ecc: 'Z' }));
  assert.match(unknown.text, /\^FDMA,AB/);
  assert.ok(levels(unknown.diagnostics, 'warning').some(d => /corrección de errores/.test(d.text)));
  assert.deepEqual(emitLines(model({ cell: 0.04 })).length, 1);
});

test('emit ^BQ: a field that came from ^FT is written with ^FT at the bottom-left of the symbol', () => {
  const model = parse(BASE('^FT100,200^BQN,2,4^FDQA,HELLO^FS'));
  assert.deepEqual(emitLines(model), ['^FT100,200^BQN,2,4^FDQA,HELLO^FS']);
  model.items[0].native.origin = 'FO';
  assert.match(emitLines(model)[0], /^\^FO100,1\d\d\^BQ/);
});

// ---------------------------------------------------------------------------------------------------------------
// QR: editing

const QR = '^XA\r\n^PW800\r\n^LL480\r\n^CF0,30\r\n^FO100,50^BQN,2,4^FDQA,HELLO^FS\r\n^FO100,200^A0N,30,30^FDText^FS\r\n^XZ';

test('describeItem ^BQ: magnification, error correction level, model and content', () => {
  const [it] = itemsOf(QR).filter(i => i.kind === 'qr');
  const d = describe(it, QR);
  assert.equal(d.kind, 'qr');
  assert.deepEqual(d.fields.map(f => f.key), ['cell', 'ecc', 'model', 'content']);
  const f = byKey(d);
  assert.deepEqual([f.cell.value, f.cell.min, f.cell.max], [4, 1, 10]);
  assert.equal(f.ecc.value, 'Q');
  assert.deepEqual(f.ecc.options.map(o => o.value), ['L', 'M', 'Q', 'H']);
  assert.equal(f.model.value, 2);
  assert.equal(f.content.value, 'HELLO');
  // without the text the model is used
  assert.deepEqual(zpl.describeItem(it, undefined, { dpi: DPI }).fields.map(x => x.key), ['cell', 'ecc', 'model', 'content']);
});

test('updateItem ^BQ: each field rewrites only its argument and leaves the rest byte for byte', () => {
  const [it] = itemsOf(QR).filter(i => i.kind === 'qr');
  assert.equal(update(it, { cell: 6 }, QR), QR.replace('^BQN,2,4', '^BQN,2,6'));
  assert.equal(update(it, { cell: 99 }, QR), QR.replace('^BQN,2,4', '^BQN,2,10'));
  assert.equal(update(it, { cell: 0 }, QR), QR.replace('^BQN,2,4', '^BQN,2,1'));
  assert.equal(update(it, { ecc: 'H' }, QR), QR.replace('^FDQA,HELLO', '^FDHA,HELLO'));
  assert.equal(update(it, { ecc: 'Z' }, QR), QR);
  assert.equal(update(it, { model: 1 }, QR), QR.replace('^BQN,2,4', '^BQN,1,4'));
  assert.equal(update(it, { model: 3 }, QR), QR);
  assert.equal(update(it, { content: 'WORLD 2' }, QR), QR.replace('^FDQA,HELLO', '^FDQA,WORLD 2'));
  assert.equal(update(it, { content: 'a^b~c' }, QR), QR.replace('^FDQA,HELLO', '^FH^FDQA,a_5Eb_7Ec'));
  assert.equal(update(it, { ecc: 'L', content: 'ZZ', cell: 5 }, QR), QR.replace('^BQN,2,4', '^BQN,2,5').replace('^FDQA,HELLO', '^FDLA,ZZ'));
  assert.equal(update(it, { ecc: 'M', content: 'ZZ' }, QR), QR.replace('^FDQA,HELLO', '^FDMA,ZZ'));
  assert.equal(update(it, {}, QR), QR);
  // the result parses to the edited item
  const out = itemsOf(update(it, { ecc: 'H', cell: 7, content: 'NEW' }, QR)).find(i => i.kind === 'qr');
  assert.deepEqual([out.ecc, out.native.cell, out.data], ['H', 7, 'NEW']);
});

test('updateItem ^BQ: a field with ^FH already on keeps it; the manual mode keeps its prefix and its content is not editable', () => {
  const hex = '^XA^FO10,10^BQN,2,4^FH^FDQA,a_5Eb^FS^XZ';
  const [it] = itemsOf(hex);
  assert.equal(byKey(describe(it, hex)).content.value, 'a^b');
  assert.equal(update(it, { content: 'x~y_z' }, hex), '^XA^FO10,10^BQN,2,4^FH^FDQA,x_7Ey_5Fz^FS^XZ');
  const manual = '^XA^FO10,10^BQN,2,4^FDMM,AAC-42^FS^XZ';
  const [m] = itemsOf(manual);
  assert.deepEqual(describe(m, manual).fields.map(f => f.key), ['cell', 'ecc', 'model']);
  assert.equal(update(m, { content: 'ZZ' }, manual), manual);
  assert.equal(update(m, { ecc: 'H' }, manual), '^XA^FO10,10^BQN,2,4^FDHM,AAC-42^FS^XZ');
});

test('updateItem ^BQ: omitted arguments (^BQ alone): the model is listed with its default and written with the empty ones before it', () => {
  const text = '^XA^FO10,10^BQ^FDMA,X^FS^XZ';
  const [it] = itemsOf(text);
  assert.deepEqual(describe(it, text).fields.map(f => f.key), ['ecc', 'model', 'content']);
  assert.equal(update(it, { model: 1 }, text), '^XA^FO10,10^BQ,1^FDMA,X^FS^XZ');
});

test('moveItem ^BQ: only the origin changes (^FO and ^FT), with ^LH taken into account', () => {
  const [it] = itemsOf(QR).filter(i => i.kind === 'qr');
  assert.equal(move(it, QR, 30, 20), QR.replace('^FO100,50^BQ', '^FO130,70^BQ'));
  const ft = '^XA^FT100,200^BQN,2,4^FDMA,X^FS^XZ';
  assert.equal(move(itemsOf(ft)[0], ft, -30, 10), '^XA^FT70,210^BQN,2,4^FDMA,X^FS^XZ');
  const lh = '^XA^LH20,10^FO100,50^BQN,2,4^FDMA,X^FS^XZ';
  assert.equal(move(itemsOf(lh)[0], lh, 10, 10), '^XA^LH20,10^FO110,60^BQN,2,4^FDMA,X^FS^XZ');
});

// ---------------------------------------------------------------------------------------------------------------
// QR: palette

test('buildComponent qr: ^FO x,y ^BQN,2,4 ^FDMA,<#QRn#> ^FS before ^XZ, unrotated whatever the view rotation, ^LH subtracted', () => {
  const build = (text, options) => zpl.buildComponent(text, 'qr', { x: 100, y: 50 }, { dpi: DPI, ...options });
  const base = '^XA\r\n^PW400\r\n^XZ\r\n';
  const once = build(base);
  assert.equal(once, '^XA\r\n^PW400\r\n^FO100,50^BQN,2,4^FDMA,<#QR1#>^FS\r\n^XZ\r\n');
  assert.match(build(once), /\^FDMA,<#QR2#>\^FS/);
  assert.equal(build(base, { viewRotation: 90 }), once);
  assert.match(zpl.buildComponent('^XA^LH10,20^XZ', 'qr', { x: 100, y: 50 }, { dpi: DPI }), /\^FO90,30\^BQN,2,4\^FDMA,<#QR1#>\^FS/);
  const item = parse(once).items[0];
  assert.deepEqual([item.kind, item.ecc, item.data, item.x, item.y, item.native.cell], ['qr', 'M', '<#QR1#>', 100, 50, 4]);
  assert.deepEqual(parse(once).diagnostics, []);
  assert.equal(zpl.buildComponent(base, 'qr', { x: NaN, y: 1 }, {}), base);
});

// ---------------------------------------------------------------------------------------------------------------
// QR: rendering, validation and conversions

test('the ZPL QR items flow through the shared renderer and validator', () => {
  const model = parse(BASE('^FO10,10^BQN,2,4^FDQA,HELLO^FS^FO10,200^BQN,2,3^FDMM,AAC-42^FS'));
  const svg = PB.svgRenderer.render(model, { width: 800, height: 480 }, { textScale: 1, values: {} }).svg;
  assert.equal((svg.match(/class="hit"/g) || []).length, 2);
  assert.ok(svg.includes('<path'));
  assert.deepEqual(PB.validator.validate(model, zpl), []);
});

const tpclLabel = body => ['{D0500,1000,0500|}', '{AX;+000,+000,+00|}', '{C|}', body, '{XS;I,0001,0002C4100|}'].join('\r\n');
const tsplText = line => ['SIZE 100 mm,60 mm', 'CLS', line, 'PRINT 1,1', ''].join('\r\n');

for (const ecc of ['L', 'M', 'Q', 'H']) {
  test(`TPCL -> ZPL -> TPCL: a QR with level ${ecc} keeps position, module, level and data`, () => {
    const text = tpclLabel(`{XB01;0300,0200,T,${ecc},05,A,0,M2|}{RB01;ABC123|}`);
    const result = PB.convert.run(text, 'zpl', { dpi: 203 });
    assert.equal(result.source, 'tpcl');
    assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), []);
    assert.match(result.text, new RegExp(`\\^BQN,2,5\\^FD${ecc}A,ABC123\\^FS`));
    const original = tpcl.parse(text, { dpi: 203 }).items[0];
    const back = zpl.parse(result.text, { dpi: 203 });
    assert.deepEqual(levels(back.diagnostics, 'warning', 'error'), []);
    const item = back.items[0];
    assert.deepEqual([item.ecc, item.data], [original.ecc, 'ABC123']);
    near(item.cell, original.cell, 0.7, 'cell');
    near(item.x, original.x, 2, 'x');
    near(item.y, original.y, 2, 'y');
    const again = PB.convert.run(result.text, 'tpcl', { dpi: 203 });
    assert.deepEqual(levels(again.diagnostics, 'warning', 'error'), []);
    const final = tpcl.parse(again.text, { dpi: 203 }).items[0];
    assert.deepEqual([final.ecc, final.native.cell, final.data], [ecc, 5, 'ABC123']);
  });
}

test('TSPL -> ZPL -> TSPL: a QR keeps position, module, level and data (the rotation is not in the neutral item and was reported when read)', () => {
  const text = tsplText('QRCODE 200,50,Q,6,A,90,"HELLO 1"');
  const parsed = tspl.parse(text, { dpi: 203 });
  assert.ok(parsed.diagnostics.some(d => /rotación de QR/.test(d.text)));
  const result = PB.convert.run(text, 'zpl', { dpi: 203 });
  assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), []);
  assert.match(result.text, /\^BQN,2,6\^FDQA,HELLO 1\^FS/);
  const back = zpl.parse(result.text, { dpi: 203 }).items[0];
  near(back.x, parsed.items[0].x, 2, 'x');
  assert.deepEqual([back.ecc, back.data], ['Q', 'HELLO 1']);
  const again = PB.convert.run(result.text, 'tspl', { dpi: 203 });
  assert.deepEqual(levels(again.diagnostics, 'warning', 'error'), []);
  assert.match(again.text, /QRCODE \d+,\d+,Q,6,A,0,"HELLO 1"/);
});

test('ZPL -> TPCL / TSPL: the QR level, module and data are written; a module above the target limit is reported', () => {
  const src = BASE('^FO100,50^BQN,2,7^FDHA,DATA 9^FS');
  const toTpcl = PB.convert.run(src, 'tpcl', { dpi: 203 });
  assert.deepEqual(levels(toTpcl.diagnostics, 'warning', 'error'), []);
  assert.match(toTpcl.text, /XB\d+;\d+,\d+,T,H,07,A,0,M2/);
  assert.match(toTpcl.text, /RB\d+;DATA 9/);
  const toTspl = PB.convert.run(src, 'tspl', { dpi: 203 });
  assert.deepEqual(levels(toTspl.diagnostics, 'warning', 'error'), []);
  assert.match(toTspl.text, /QRCODE \d+,\d+,H,7,A,0,"DATA 9"/);
  const big = PB.convert.run(tpclLabel('{XB01;0300,0200,T,M,20,A,0,M2|}{RB01;A|}'), 'zpl', { dpi: 203 });
  assert.ok(levels(big.diagnostics, 'warning').some(d => /1\.\.10/.test(d.text)));
  assert.match(big.text, /\^BQN,2,10\^/);
});

test('ZPL -> ZPL through Convertir keeps the QR (level, module, model, data with ^ and ~, manual mode)', () => {
  const src = BASE('^FO100,50^BQN,2,4^FH^FDQA,a_5Eb^FS^FT100,300^BQN,1,6^FDLM,N0123^FS');
  const result = PB.convert.run(src, 'zpl', { dpi: 203 });
  assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), []);
  const [a, b] = zpl.parse(result.text, { dpi: 203 }).items;
  assert.deepEqual([a.ecc, a.data, a.native.cell], ['Q', 'a^b', 4]);
  assert.deepEqual([b.ecc, b.data, b.native.model, b.native.origin], ['L', '0123', 1, 'FT']);
});

// ---------------------------------------------------------------------------------------------------------------
// Data Matrix: parse

test('parse ^BX: a Data Matrix item with module, quality 200 and data, no diagnostics', () => {
  const model = parse(BASE('^FO100,50^BXN,5,200^FDHELLO^FS'));
  assert.deepEqual(model.diagnostics, []);
  const [item] = model.items;
  assert.equal(item.kind, 'datamatrix');
  assert.deepEqual([item.symbology, item.ecc, item.cell, item.data, item.x, item.y, item.rotation, item.size], ['datamatrix', 200, 5, 'HELLO', 100, 50, 0, undefined]);
  assert.equal(item.native.type, 'BX');
  assert.deepEqual([item.native.h, item.native.module, item.native.quality, item.native.cols, item.native.rows, item.native.origin], [5, 5, 200, 0, 0, 'FO']);
  assert.deepEqual(PB.validator.validate(model, zpl), []);
});

test('parse ^BX: the orientation N R I B gives the rotation 0 / 90 / 180 / 270; an empty one follows ^FW; an invalid one is reported', () => {
  for (const [letter, rotation] of [['N', 0], ['R', 90], ['I', 180], ['B', 270]]) {
    assert.equal(one(`^FO100,50^BX${letter},5,200^FDHELLO^FS`).rotation, rotation, letter);
  }
  assert.equal(one('^FWR^FO100,50^BX,5,200^FDHELLO^FS').rotation, 90);
  assert.equal(one('^FWR^FO100,50^BXN,5,200^FDHELLO^FS').rotation, 0);
  const bad = parse(BASE('^FO100,50^BXZ,5,200^FDHELLO^FS'));
  assert.equal(bad.items[0].rotation, 0);
  assert.ok(bad.diagnostics.some(d => d.level === 'warning' && /\^BX/.test(d.text) && /orientaci/.test(d.text)));
});

test('parse ^BX: ^FO is the bounding box of the rotated symbol, ^FT the bottom-left corner of the symbol (not verified for 2D symbols)', () => {
  const S = dmSide('HELLO', 5);
  const at = (cmd, o) => { const i = one(`${cmd}100,200^BX${o},5,200^FDHELLO^FS`); return [i.x, i.y]; };
  assert.deepEqual(at('^FO', 'N'), [100, 200]);
  assert.deepEqual(at('^FO', 'R'), [100 + S, 200]);
  assert.deepEqual(at('^FO', 'I'), [100 + S, 200 + S]);
  assert.deepEqual(at('^FO', 'B'), [100, 200 + S]);
  assert.deepEqual(at('^FT', 'N'), [100, 200 - S]);
  assert.deepEqual(at('^FT', 'R'), [100 + S, 200]);
  assert.deepEqual(at('^FT', 'I'), [100, 200 + S]);
  assert.deepEqual(at('^FT', 'B'), [100 - S, 200]);
  assert.equal(one('^FT100,200^BXN,5,200^FDHELLO^FS').native.origin, 'FT');
  assert.deepEqual([one('^LH20,10^FO100,50^BXN,5,200^FDHELLO^FS').x, one('^LH20,10^FO100,50^BXN,5,200^FDHELLO^FS').y], [120, 60]);
});

test('parse ^BX: the module is h in dots; without h (or 0) the ^BY height divided by the symbol side, rounded, at least 1', () => {
  assert.equal(one('^BY2,3,24^FO10,10^BXN,,200^FDHELLO^FS').cell, Math.round(24 / dm.encode('HELLO').side));
  const side = dm.encode('HELLO').side;
  const byHeight = one(`^BY2,3,${side * 3}^FO10,10^BXN,0,200^FDHELLO^FS`);
  assert.deepEqual([byHeight.cell, byHeight.native.h, byHeight.native.module], [3, 0, 3]);
  assert.equal(one('^FO10,10^BXN,,200^FDHELLO^FS').cell, 1, 'the power-up ^BY height 10 gives at least 1');
  assert.equal(one('^FO10,10^BX^FDHELLO^FS').native.quality, 0);
  const wide = one('^FO10,10^BXN,9999,200^FDHELLO^FS');
  assert.equal(wide.cell, 9999);
  const invalid = parse(BASE('^FO10,10^BXN,x,200^FDHELLO^FS'));
  assert.ok(invalid.diagnostics.some(d => d.level === 'warning' && /\^BX/.test(d.text) && /módulo/.test(d.text)));
});

test('parse ^BX: quality 200 is drawn; 0 (the default), 50, 80, 100 and 140 keep the value and the viewer reports that it cannot draw them; an invalid one is a warning', () => {
  for (const q of [0, 50, 80, 100, 140]) {
    const model = parse(BASE(`^FO10,10^BXN,5,${q}^FDHELLO^FS`));
    assert.equal(model.items[0].ecc, q, `quality ${q}`);
    const found = PB.validator.validate(model, zpl).filter(d => d.level === 'warning');
    assert.equal(found.length, 1, `quality ${q}`);
    assert.match(found[0].text, new RegExp(`ECC ${q} no soportado`));
  }
  assert.equal(one('^FO10,10^BXN,5^FDHELLO^FS').ecc, 0);
  assert.equal(one('^FO10,10^BXN,5,^FDHELLO^FS').ecc, 0);
  const bad = parse(BASE('^FO10,10^BXN,5,7^FDHELLO^FS'));
  assert.equal(bad.items[0].ecc, 0);
  assert.ok(bad.diagnostics.some(d => d.level === 'warning' && /calidad/.test(d.text)));
});

test('parse ^BX: columns and rows (quality 200): both equal and a square size of the table force the size; the others are reported and automatic', () => {
  const forced = parse(BASE('^FO10,10^BXN,5,200,24,24^FDHI^FS'));
  assert.deepEqual(forced.diagnostics, []);
  assert.deepEqual([forced.items[0].size, forced.items[0].native.cols, forced.items[0].native.rows], [24, 24, 24]);
  assert.equal(one('^FO10,10^BXN,5,200,144,144^FDHI^FS').size, 144);
  assert.equal(one('^FO10,10^BXN,5,200,0,0^FDHI^FS').size, undefined);
  assert.deepEqual(parse(BASE('^FO10,10^BXN,5,200,0,0^FDHI^FS')).diagnostics, []);
  // a rectangle of ISO 16022 (columns x rows): the "rectangular reported" path
  const rect = parse(BASE('^FO10,10^BXN,5,200,18,8^FDHI^FS'));
  assert.equal(rect.items[0].size, undefined);
  assert.ok(rect.diagnostics.some(d => d.level === 'warning' && /rectangular 18×8/.test(d.text)));
  // other sizes, or only one of the two
  for (const tail of ['25,25', '24,26', '24,0', '0,24', '24']) {
    const m = parse(BASE(`^FO10,10^BXN,5,200,${tail}^FDHI^FS`));
    assert.equal(m.items[0].size, undefined, tail);
    assert.ok(m.diagnostics.some(d => d.level === 'warning' && /\^BX/.test(d.text)), tail);
  }
  // other qualities: the sizes are the odd ones of the older ECC (the item is not drawn anyway): kept in native only
  const old = one('^FO10,10^BXN,5,140,25,25^FDHI^FS');
  assert.deepEqual([old.size, old.native.cols, old.native.rows], [undefined, 25, 25]);
});

test('parse ^BX: the format ID and the escape character are kept in native; the escape sequences of quality 200 are reported', () => {
  const item = one('^FO10,10^BXN,5,200,,,6,#^FDa##b^FS');
  assert.deepEqual([item.native.formatId, item.native.escape, item.data], ['6', '#', 'a#b']);
  assert.equal(one('^FO10,10^BXN,5,200^FDa__b^FS').data, 'a_b');
  const seq = parse(BASE('^FO10,10^BXN,5,200^FDa_1b^FS^FO10,100^BXN,5,200^FDc_dx^FS'));
  assert.deepEqual(seq.items.map(i => i.data), ['a_1b', 'c_dx']);
  assert.equal(seq.diagnostics.filter(d => d.level === 'warning' && /secuencias de escape/.test(d.text)).length, 1);
  // quality below 200 has no escape character
  assert.equal(one('^FO10,10^BXN,5,100^FDa__b^FS').data, 'a__b');
  assert.equal(one('^FO10,10^BXN,5,200^FH^FDa_5Eb^FS').data, 'a^b');
});

test('parse ^BX: a field without data draws nothing; a Data Matrix beside a barcode and a QR keeps each kind', () => {
  assert.deepEqual(parse(BASE('^FO10,10^BXN,5,200^FS')).items, []);
  const model = parse(BASE('^FO10,10^BCN,50,Y,N,N^FDabc^FS^FO10,100^BQN,2,4^FDMA,x^FS^FO10,200^BXN,5,200^FDy^FS'));
  assert.deepEqual(model.items.map(i => i.kind), ['barcode', 'qr', 'datamatrix']);
  assert.deepEqual(model.diagnostics, []);
});

// ---------------------------------------------------------------------------------------------------------------
// Data Matrix: emit

test('emit ^BX: round trips of what the parser reads (^FO, ^FT, rotations, forced size, qualities, escape character)', () => {
  for (const src of [
    '^FO100,50^BXN,5,200^FDHELLO^FS',
    '^FO100,50^BXR,5,200^FDHELLO^FS',
    '^FO100,50^BXI,5,200^FDHELLO^FS',
    '^FO100,50^BXB,5,200^FDHELLO^FS',
    '^FT100,200^BXN,5,200^FDHELLO^FS',
    '^FT100,200^BXB,5,200^FDHELLO^FS',
    '^FO100,50^BXN,5,200,24,24^FDHI^FS',
    '^FO100,50^BXN,5,140^FDHELLO^FS',
    '^FO100,50^BXN,5,100,25,25^FDHELLO^FS',
    '^FO100,50^BXN,5,200,,,,#^FDa##b^FS',
    '^FO100,50^BXN,5,200^FDa__b^FS',
  ]) assert.deepEqual(roundTrip(src), [src], src);
  // the round trip reads back as the same item
  const text = BASE('^FT100,200^BXR,5,200,24,24^FDHI^FS');
  const a = parse(text).items[0];
  const b = parse(zpl.emit(parse(text), { dpi: DPI }).text).items[0];
  assert.deepEqual([b.x, b.y, b.rotation, b.cell, b.size, b.ecc, b.data], [a.x, a.y, a.rotation, a.cell, a.size, a.ecc, a.data]);
});

test('emit ^BX: the module of a module read from ^BY is written explicitly; quality 0 with the default is kept', () => {
  assert.deepEqual(roundTrip('^BY2,3,24^FO10,10^BXN,,200^FDHELLO^FS'), [`^FO10,10^BXN,${Math.round(24 / dm.encode('HELLO').side)},200^FDHELLO^FS`]);
  assert.deepEqual(roundTrip('^FO10,10^BXN,5^FDHELLO^FS'), ['^FO10,10^BXN,5,0^FDHELLO^FS']);
});

test('emit ^BX: a neutral item (another language) is written as ^FO ^BXo,h,200[,c,r] ^FD with the escapes of ^ ~ and _', () => {
  const item = (extra = {}) => ({ kind: 'datamatrix', ref: 'XB01', x: 200, y: 50, rotation: 0, cell: 5, ecc: 200, symbology: 'datamatrix', native: {}, data: 'HI', ...extra });
  const model = extra => ({ size: { width: 800, height: 480 }, items: [item(extra)] });
  assert.deepEqual(emitLines(model()), ['^FO200,50^BXN,5,200^FDHI^FS']);
  assert.deepEqual(emitLines(model({ size: 24 })), ['^FO200,50^BXN,5,200,24,24^FDHI^FS']);
  const S = 24 * 5;
  assert.deepEqual(emitLines(model({ size: 24, rotation: 90 })), [`^FO${200 - S},50^BXR,5,200,24,24^FDHI^FS`]);
  assert.deepEqual(emitLines(model({ rotation: 180, size: 24 })), ['^FO80,0^BXI,5,200,24,24^FDHI^FS']);
  assert.deepEqual(emitLines(model({ data: 'a^b~c' })), ['^FO200,50^BXN,5,200^FH^FDa_5Eb_7Ec^FS']);
  assert.deepEqual(emitLines(model({ data: 'a_b' })), ['^FO200,50^BXN,5,200^FDa__b^FS']);
  assert.deepEqual(emitLines(model({ data: 'a_^' })), ['^FO200,50^BXN,5,200^FH^FDa_5F_5F_5E^FS']);
  assert.equal(parse(zpl.emit(model({ data: 'a_^' }), { dpi: DPI }).text).items[0].data, 'a_^');
  assert.deepEqual(emitLines(model({ cell: null, area: { width: 240, height: 240 }, native: { width: 240, height: 240 } })), ['^FO200,50^BXN,24,200^FDHI^FS']);
});

test('emit ^BX: items ZPL cannot hold are reported once: module 0 (skipped), a quality that does not exist, a rotation off the quarter turns, an out of range module', () => {
  const item = (extra = {}) => ({ kind: 'datamatrix', ref: 'XB01', x: 200, y: 50, rotation: 0, cell: 5, ecc: 200, symbology: 'datamatrix', native: {}, data: 'HI', ...extra });
  const model = extra => ({ size: { width: 800, height: 480 }, items: [item(extra), item(extra)] });
  const zero = emitResult(model({ cell: 0 }));
  assert.deepEqual(emitLines(model({ cell: 0 })), []);
  assert.equal(levels(zero.diagnostics, 'warning').filter(d => /módulo 0/.test(d.text)).length, 1);
  const quality = emitResult(model({ ecc: 10 }));
  assert.match(quality.text, /\^BXN,5,200\^/);
  assert.equal(levels(quality.diagnostics, 'warning').filter(d => /ECC/.test(d.text)).length, 1);
  assert.match(emitResult(model({ ecc: 140 })).text, /\^BXN,5,140\^/);
  const turn = emitResult(model({ rotation: 100 }));
  assert.match(turn.text, /\^BXR,5,200/);
  assert.equal(levels(turn.diagnostics, 'warning').filter(d => /múltiplo de 90/.test(d.text)).length, 1);
  const huge = emitResult(model({ cell: 200000 }));
  assert.match(huge.text, /\^BXN,\d+,200/);
  assert.equal(levels(huge.diagnostics, 'warning').filter(d => /módulo/.test(d.text)).length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Data Matrix: editing

const DMX = '^XA\r\n^PW800\r\n^LL480\r\n^CF0,30\r\n^FO100,50^BXN,5,200,24,24^FDHELLO^FS\r\n^FO100,200^A0N,30,30^FDText^FS\r\n^XZ';
const dmItem = text => itemsOf(text).find(i => i.kind === 'datamatrix');

test('describeItem ^BX: module, symbol size, rotation and content', () => {
  const it = dmItem(DMX);
  const d = describe(it, DMX);
  assert.equal(d.kind, 'datamatrix');
  assert.deepEqual(d.fields.map(f => f.key), ['cell', 'size', 'rotation', 'content']);
  const f = byKey(d);
  assert.deepEqual([f.cell.value, f.cell.min], [5, 1]);
  assert.equal(f.size.value, 24);
  assert.deepEqual(f.size.options.map(o => o.value), [0, 10, 12, 14, 16, 18, 20, 22, 24, 26, 32, 36, 40, 44, 48, 52, 64, 72, 80, 88, 96, 104, 120, 132, 144]);
  assert.equal(f.size.options[0].label, 'Automático');
  assert.equal(f.rotation.value, 0);
  assert.deepEqual(f.rotation.options.map(o => o.value), [0, 90, 180, 270]);
  assert.equal(f.content.value, 'HELLO');
  // automatic size, no size arguments
  const auto = '^XA^FO10,10^BXN,5,200^FDHELLO^FS^XZ';
  assert.equal(byKey(describe(dmItem(auto), auto)).size.value, 0);
  // only the qualities the viewer draws have a size; the others are not editable that way
  const old = '^XA^FO10,10^BXN,5,140^FDHELLO^FS^XZ';
  assert.deepEqual(describe(dmItem(old), old).fields.map(x => x.key), ['cell', 'rotation', 'content']);
  // a size that is not in the table is not listed
  const odd = '^XA^FO10,10^BXN,5,200,18,8^FDHELLO^FS^XZ';
  assert.ok(!describe(dmItem(odd), odd).fields.some(x => x.key === 'size'));
});

test('describeItem ^BX: an omitted module shows the one derived from ^BY, an empty orientation the rotation of ^FW', () => {
  const text = '^XA^FWR^BY2,3,24^FO10,10^BX,,200^FDHELLO^FS^XZ';
  const it = dmItem(text);
  const f = byKey(describe(it, text));
  assert.equal(f.cell.value, it.native.module);
  assert.equal(f.rotation.value, 90);
  assert.equal(update(it, { cell: 4 }, text), '^XA^FWR^BY2,3,24^FO10,10^BX,4,200^FDHELLO^FS^XZ');
  assert.equal(update(it, { rotation: 0 }, text), '^XA^FWR^BY2,3,24^FO10,10^BXN,,200^FDHELLO^FS^XZ');
});

test('updateItem ^BX: each field rewrites only its arguments and leaves the rest byte for byte', () => {
  const it = dmItem(DMX);
  assert.equal(update(it, { cell: 8 }, DMX), DMX.replace('^BXN,5,200', '^BXN,8,200'));
  assert.equal(update(it, { cell: 99999 }, DMX), DMX.replace('^BXN,5,200', '^BXN,9999,200'));
  assert.equal(update(it, { cell: 0 }, DMX), DMX.replace('^BXN,5,200', '^BXN,1,200'));
  assert.equal(update(it, { size: 36 }, DMX), DMX.replace('24,24', '36,36'));
  assert.equal(update(it, { size: 0 }, DMX), DMX.replace('24,24', '0,0'));
  assert.equal(update(it, { size: 25 }, DMX), DMX);
  assert.equal(update(it, { rotation: 90 }, DMX), DMX.replace('^BXN,', '^BXR,'));
  assert.equal(update(it, { rotation: 45 }, DMX), DMX);
  assert.equal(update(it, { content: 'WORLD' }, DMX), DMX.replace('^FDHELLO', '^FDWORLD'));
  assert.equal(update(it, { content: 'a^b~c' }, DMX), DMX.replace('^FDHELLO', '^FH^FDa_5Eb_7Ec'));
  assert.equal(update(it, {}, DMX), DMX);
  const out = dmItem(update(it, { cell: 6, rotation: 270, content: 'NEW' }, DMX));
  assert.deepEqual([out.cell, out.size, out.rotation, out.data], [6, 24, 270, 'NEW']);
  // the size is written by the type hook: one change at a time
  assert.equal(dmItem(update(it, { size: 32, content: 'NEW' }, DMX)).size, 32);
});

test('updateItem ^BX: the size is appended when the command has no columns and rows, with the empty arguments before them', () => {
  const auto = '^XA^FO10,10^BXN,5,200^FDHELLO^FS^XZ';
  assert.equal(update(dmItem(auto), { size: 36 }, auto), '^XA^FO10,10^BXN,5,200,36,36^FDHELLO^FS^XZ');
  assert.equal(update(dmItem(auto), { size: 0 }, auto), auto);
  const cols = '^XA^FO10,10^BXN,5,200,24^FDHELLO^FS^XZ';
  assert.equal(update(itemsOf(cols)[0], { size: 36 }, cols), cols, 'a half size is not a size of the table: not listed, not written');
  const withTail = '^XA^FO10,10^BXN,5,200,24,24,6,#^FDHELLO^FS^XZ';
  assert.equal(update(dmItem(withTail), { size: 48 }, withTail), '^XA^FO10,10^BXN,5,200,48,48,6,#^FDHELLO^FS^XZ');
});

test('moveItem ^BX: only the origin changes (^FO and ^FT)', () => {
  assert.equal(move(dmItem(DMX), DMX, 30, 20), DMX.replace('^FO100,50^BXN', '^FO130,70^BXN'));
  const ft = '^XA^FT100,200^BXR,5,200^FDHI^FS^XZ';
  assert.equal(move(itemsOf(ft)[0], ft, -30, 10), '^XA^FT70,210^BXR,5,200^FDHI^FS^XZ');
});

// ---------------------------------------------------------------------------------------------------------------
// Data Matrix: palette

test('buildComponent datamatrix: ^FO x,y ^BXo,4,200 ^FD<#DATAMATRIXn#> ^FS before ^XZ, rotated against the view, ^LH subtracted', () => {
  const build = (text, options) => zpl.buildComponent(text, 'datamatrix', { x: 100, y: 50 }, { dpi: DPI, ...options });
  const base = '^XA\r\n^PW400\r\n^XZ\r\n';
  const once = build(base);
  assert.equal(once, '^XA\r\n^PW400\r\n^FO100,50^BXN,4,200^FD<#DATAMATRIX1#>^FS\r\n^XZ\r\n');
  assert.match(build(once), /\^FD<#DATAMATRIX2#>\^FS/);
  assert.match(build(base, { viewRotation: 90 }), /\^BXB,4,200\^FD/);
  assert.match(build(base, { viewRotation: 180 }), /\^BXI,4,200\^FD/);
  assert.match(build(base, { viewRotation: 270 }), /\^BXR,4,200\^FD/);
  assert.match(zpl.buildComponent('^XA^LH10,20^XZ', 'datamatrix', { x: 100, y: 50 }, { dpi: DPI }), /\^FO90,30\^BXN,4,200\^FD<#DATAMATRIX1#>\^FS/);
  const item = parse(once).items[0];
  assert.deepEqual([item.kind, item.ecc, item.cell, item.data, item.x, item.y], ['datamatrix', 200, 4, '<#DATAMATRIX1#>', 100, 50]);
  assert.deepEqual(parse(once).diagnostics, []);
  assert.equal(zpl.buildComponent(base, 'datamatrix', { x: 1, y: NaN }, {}), base);
});

// ---------------------------------------------------------------------------------------------------------------
// Data Matrix: rendering, validation and conversions

test('the ZPL Data Matrix items flow through the shared renderer and validator: symbols, rotation, hatched placeholder, warnings', () => {
  const draw = src => PB.svgRenderer.render(parse(BASE(src)), { width: 800, height: 480 }, { textScale: 1, values: {} }).svg;
  const ok = draw('^FO10,10^BXN,5,200^FDHELLO^FS');
  assert.ok(ok.includes('<path') && ok.includes('class="hit"') && !ok.includes('class="not-generated"'));
  assert.ok(draw('^FO10,10^BXR,5,200^FDHELLO^FS').includes('rotate(90 '));
  assert.ok(draw('^FO10,10^BXN,5,140^FDHELLO^FS').includes('class="not-generated"'));
  assert.ok(draw('^FO10,10^BXN,5^FDHELLO^FS').includes('class="not-generated"'));
  // a forced size that is too small for the data: the validator reports it
  const small = parse(BASE('^FO10,10^BXN,5,200,10,10^FD0123456789ABCDEF^FS'));
  assert.ok(PB.validator.validate(small, zpl).some(d => d.level === 'warning' && /no alcanza/.test(d.text)));
  const rendered = PB.components.get('datamatrix').render(small.items[0], { n: v => v, rectsPath: r => r.map(x => x.join(' ')).join(';'), value: v => v });
  assert.match(rendered.info, /Data Matrix/);
  assert.deepEqual(PB.validator.validate(parse(BASE('^FO10,10^BXN,5,200^FD<#X#>^FS')), zpl), []);
});

test('TPCL -> ZPL -> TPCL: a Data Matrix keeps position, module, rotation, forced size and data', () => {
  for (const [tail, rotation] of [['00,0', 0], ['00,1', 90], ['00,2', 180], ['00,3', 270]]) {
    const text = tpclLabel(`{XB01;0300,0200,Q,20,04,${tail},C024024|}{RB01;HELLO|}`);
    const result = PB.convert.run(text, 'zpl', { dpi: 203 });
    assert.equal(result.source, 'tpcl');
    assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), [], tail);
    assert.match(result.text, new RegExp(`\\^BX${'NRIB'[rotation / 90]},4,200,24,24\\^FDHELLO\\^FS`));
    const original = tpcl.parse(text, { dpi: 203 }).items[0];
    const back = zpl.parse(result.text, { dpi: 203 });
    assert.deepEqual(levels(back.diagnostics, 'warning', 'error'), [], tail);
    const item = back.items[0];
    assert.deepEqual([item.rotation, item.size, item.data, item.ecc], [original.rotation, 24, 'HELLO', 200]);
    near(item.cell, original.cell, 0.7, 'cell');
    near(item.x, original.x, 2, 'x');
    near(item.y, original.y, 2, 'y');
    const again = PB.convert.run(result.text, 'tpcl', { dpi: 203 });
    assert.deepEqual(levels(again.diagnostics, 'warning', 'error'), [], tail);
    const final = tpcl.parse(again.text, { dpi: 203 }).items[0];
    assert.deepEqual([final.rotation, final.size, final.data, final.native.cell], [original.rotation, 24, 'HELLO', 4]);
  }
});

test('TPCL -> ZPL: an automatic size writes no columns and rows; ECC 140 is kept; ECC 120 (12) has no quality in ZPL and is written as 200; module 0 is not written', () => {
  const to = body => PB.convert.run(tpclLabel(body), 'zpl', { dpi: 203 });
  assert.match(to('{XB01;0300,0200,Q,20,04,00,0|}{RB01;HI|}').text, /\^BXN,4,200\^FDHI\^FS/);
  const ecc140 = to('{XB01;0300,0200,Q,14,04,00,0|}{RB01;HI|}');
  assert.match(ecc140.text, /\^BXN,4,140\^FDHI/);
  assert.match(to('{XB01;0300,0200,Q,10,04,00,0|}{RB01;HI|}').text, /\^BXN,4,100\^FDHI/);
  const ecc12 = to('{XB01;0300,0200,Q,12,04,00,0|}{RB01;HI|}');
  assert.match(ecc12.text, /\^BXN,4,200\^FDHI/);
  assert.ok(levels(ecc12.diagnostics, 'warning').some(d => /ECC/.test(d.text)));
  const zero = to('{XB01;0300,0200,Q,20,00,00,0|}{RB01;HI|}');
  assert.ok(!zero.text.includes('^BX'));
  assert.ok(levels(zero.diagnostics, 'warning').some(d => /módulo 0/.test(d.text)));
});

test('TSPL -> ZPL -> TSPL: a Data Matrix keeps position, module, forced size and data (the area form too)', () => {
  const full = tsplText('DMATRIX 100,50,48,48,4,12,12,"HELLO"');
  const result = PB.convert.run(full, 'zpl', { dpi: 203 });
  assert.equal(result.source, 'tspl');
  assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), []);
  assert.match(result.text, /\^BXN,4,200,12,12\^FDHELLO\^FS/);
  const back = zpl.parse(result.text, { dpi: 203 }).items[0];
  assert.deepEqual([back.size, back.data, back.rotation], [12, 'HELLO', 0]);
  const again = PB.convert.run(result.text, 'tspl', { dpi: 203 });
  assert.deepEqual(levels(again.diagnostics, 'warning', 'error'), []);
  assert.match(again.text, /DMATRIX \d+,\d+,\d+,\d+,4,12,12,"HELLO"/);
  // the area form: the module fits the area (whole dots)
  const area = PB.convert.run(tsplText('DMATRIX 10,20,200,200,"HELLO"'), 'zpl', { dpi: 203 });
  assert.deepEqual(levels(area.diagnostics, 'warning', 'error'), []);
  const side = dm.encode('HELLO').side;
  assert.match(area.text, new RegExp(`\\^BXN,${Math.floor(200 / side)},200\\^FDHELLO`));
});

test('ZPL -> TPCL / TSPL: rotation, module, size and data are written; TSPL reports the rotation and the quality it cannot hold', () => {
  const src = BASE('^FO100,50^BXR,5,200,24,24^FDHELLO^FS');
  const toTpcl = PB.convert.run(src, 'tpcl', { dpi: 203 });
  assert.deepEqual(levels(toTpcl.diagnostics, 'warning', 'error'), []);
  assert.match(toTpcl.text, /XB\d+;\d+,\d+,Q,20,05,00,1,C024024/);
  assert.match(toTpcl.text, /RB\d+;HELLO/);
  const toTspl = PB.convert.run(src, 'tspl', { dpi: 203 });
  assert.ok(levels(toTspl.diagnostics, 'warning').some(d => /rotación/.test(d.text)));
  assert.match(toTspl.text, /DMATRIX \d+,\d+,\d+,\d+,5,24,24,"HELLO"/);
  const q = PB.convert.run(BASE('^FO100,50^BXN,5,140^FDHELLO^FS'), 'tspl', { dpi: 203 });
  assert.ok(levels(q.diagnostics, 'warning').some(d => /ECC/.test(d.text)));
});

test('ZPL -> ZPL through Convertir keeps the Data Matrix (rotation, forced size, quality, escape character, data with ^ and _)', () => {
  const src = BASE('^FO300,50^BXR,5,200,24,24^FH^FDa_5Eb^FS^FT100,300^BXN,4,140^FDHELLO^FS^FO10,10^BXN,3,200,,,,#^FDq##r^FS');
  const result = PB.convert.run(src, 'zpl', { dpi: 203 });
  assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), []);
  const [a, b, c] = zpl.parse(result.text, { dpi: 203 }).items;
  assert.deepEqual([a.rotation, a.size, a.data], [90, 24, 'a^b']);
  near(a.cell, 5 * PB.units.dotSize(203), 1e-6, 'cell');
  assert.deepEqual([b.ecc, b.native.origin, b.data], [140, 'FT', 'HELLO']);
  assert.deepEqual([c.native.escape, c.data], ['#', 'q#r']);
});
