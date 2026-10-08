const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Z7: ZPL counters, the serialization data command ^SNv,n,z (js/languages/zpl.js, js/languages/zpl-edit.js, the text and barcode slices).
// The 2003 guide (Volume One) documents: ^SNv,n,z replaces ^FD; v = the starting value (default 1; "12 digits maximum for the portion to be indexed":
// the data may carry other characters, the right-most digits are the ones indexed), n = the increment or decrement (default 1, a minus sign
// decrements, 12 digits maximum), z = print the leading zeros Y / N (default N: they are suppressed, "replaced by spaces", the last zero of an
// all-zero number is not suppressed); text and bar code fields; the example ^SN001,1,Y prints 001, 002, 003 with ^PQ3. It does NOT document: what
// n = 0 does, the suppression on a mixed text, how the QR / Data Matrix data is serialized, nor ^SN with ^FN.
// All parses use 254 dpi, where one dot is exactly 0.1 mm.
const PB = loadApp();
const zpl = PB.languages.get('zpl');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const DPI = 254;

const wrap = body => `^XA^PW800^LL480${body}^XZ`;
const parse = body => zpl.parse(wrap(body), { dpi: DPI });
const one = body => parse(body).items[0];
const note = diagnostics => diagnostics.map(d => `${d.level}: ${d.text}`);
const emitOf = (model, dpi = DPI) => zpl.emit(model, { dpi });
const emitLines = (model, dpi = DPI) => emitOf(model, dpi).text.split('\r\n').filter(l => l && !/^\^(XA|XZ|PW|LL)/.test(l));
const roundTrip = body => emitLines(zpl.parse(wrap(body), { dpi: DPI }));

const TEXT = (data = '^SN001,1,Y') => `^FO100,50^A0N,40,40${data}^FS`;
const BARCODE = (data = '^SN0001,1,Y') => `^BY2,3,60^FO100,50^BCN,60,Y,N,N${data}^FS`;
const textItem = extra => ({ kind: 'text', ref: 'A', x: 100, y: 82, rotation: 0, data: '0007', font: { size: 40, scaleX: 1, family: 'sans', weight: 700, style: 'normal' }, ...extra });
const barcodeItem = extra => ({ kind: 'barcode', ref: 'BC', x: 100, y: 50, rotation: 0, symbology: 'code128', module: 2, height: 60, humanReadable: true, data: '0042', ...extra });
const modelOf = (...items) => ({ size: { width: 800, height: 480 }, items });

const field = (src, key, index = 0) => zpl.describeItem(zpl.parse(src, { dpi: DPI }).items[index], src).fields.find(f => f.key === key);
const keys = (src, index = 0) => zpl.describeItem(zpl.parse(src, { dpi: DPI }).items[index], src).fields.map(f => f.key);
const set = (src, changes, index = 0) => zpl.updateItem(src, zpl.parse(src, { dpi: DPI }).items[index], changes, { dpi: DPI });

// ---------------------------------------------------------------------------------------------------------------
// Parse

test('^SNv,n,z replaces ^FD: a text item with the start value as data, a counter and no zero suppression for z = Y', () => {
  const model = parse(TEXT());
  assert.equal(model.items.length, 1);
  const item = model.items[0];
  assert.equal(item.kind, 'text');
  assert.equal(item.data, '001');
  assert.deepEqual(item.counter, { step: 1, native: { n: '1', z: 'Y' } });
  assert.equal(item.zeroSuppress, undefined);
  assert.deepEqual(note(model.diagnostics), ['info: Los campos con incremento muestran su valor inicial: la impresora los incrementa en cada etiqueta']);
});

test('^SN defaults (guide): n = 1 and z = N; an empty start value is 1', () => {
  const only = one(TEXT('^SN007'));
  assert.deepEqual([only.data, only.counter.step, only.zeroSuppress], ['007', 1, 1]);
  const noN = one(TEXT('^SN007,,Y'));
  assert.deepEqual([noN.counter.step, noN.zeroSuppress], [1, undefined]);
  const noZ = one(TEXT('^SN007,3'));
  assert.deepEqual([noZ.counter.step, noZ.zeroSuppress], [3, 1]);
  const none = one(TEXT('^SN'));
  assert.deepEqual([none.data, none.counter.step, none.zeroSuppress], ['1', 1, 1]);
  assert.equal(one(TEXT('^SN,5,Y')).data, '1');
});

test('^SN: a minus sign decrements, a plus sign is read, z is case insensitive and N maps to the zero suppression that keeps the last digit', () => {
  assert.equal(one(TEXT('^SN100,-5,Y')).counter.step, -5);
  assert.equal(one(TEXT('^SN100,+7,Y')).counter.step, 7);
  assert.equal(one(TEXT('^SN100,2,y')).zeroSuppress, undefined);
  assert.equal(one(TEXT('^SN100,2,n')).zeroSuppress, 1);
  assert.equal(one(TEXT('^SN100,2,N')).zeroSuppress, 1);
  assert.equal(one(TEXT('^SN100,999999999999,Y')).counter.step, 999999999999);
});

test('^SN with an increment of 0 is a plain text (no counter, no info); the z = N suppression stays', () => {
  const model = parse(TEXT('^SN001,0,N'));
  const item = model.items[0];
  assert.equal(item.data, '001');
  assert.equal(item.counter, undefined);
  assert.equal(item.zeroSuppress, 1);
  assert.deepEqual(model.diagnostics, []);
});

test('^SN with invalid parameters: a warning and the default (n 1, z N); an increment over 12 digits is clamped with a warning', () => {
  const bad = parse(TEXT('^SN001,x,Q'));
  assert.deepEqual([bad.items[0].counter.step, bad.items[0].zeroSuppress], [1, 1]);
  assert.equal(note(bad.diagnostics).filter(t => /^warning: \^SN/.test(t)).length, 2);
  const big = parse(TEXT('^SN001,1234567890123,Y'));
  assert.equal(big.items[0].counter.step, 999999999999);
  assert.ok(note(big.diagnostics).some(t => /^warning: \^SN.*12 dígitos/.test(t)));
});

test('^SN with letters in the data: the text is the start value as written (the right-most digits are the ones indexed)', () => {
  const item = one(TEXT('^SNABCD1000EFGH,1,Y'));
  assert.deepEqual([item.data, item.counter.step], ['ABCD1000EFGH', 1]);
});

test('^SN may come before the font command and the origin order does not matter (the field is read when ^FS closes it)', () => {
  const item = one('^FO10,10^SN005,2,Y^A0N,30,30^FS');
  assert.deepEqual([item.kind, item.data, item.counter.step, item.font.size], ['text', '005', 2, 30]);
});

test('a field with ^SN and no font command is a text in the default font, like a ^FD field', () => {
  const item = one('^FO10,10^SN009,1,Y^FS');
  assert.deepEqual([item.kind, item.data, item.counter.step], ['text', '009', 1]);
});

test('^SN on a bar code: the start value is the data, the counter and the zero suppression go to the barcode item', () => {
  const item = one(BARCODE('^SN0001,2,N'));
  assert.equal(item.kind, 'barcode');
  assert.equal(item.symbology, 'code128');
  assert.equal(item.data, '0001');
  assert.deepEqual(item.counter, { step: 2, native: { n: '2', z: 'N' } });
  assert.equal(item.zeroSuppress, 1);
  const plain = one(BARCODE('^SN0001,1,Y'));
  assert.deepEqual([plain.counter.step, plain.zeroSuppress], [1, undefined]);
});

test('^SN on QR and Data Matrix: the start value is the data and one info says the counter is not modelled for 2D codes', () => {
  const qr = parse('^FO10,10^BQN,2,4^SN12345,1,Y^FS^FO10,100^BQN,2,4^SN67890,1,Y^FS^FO10,200^BXN,4,200^SN24680,1,Y^FS');
  assert.deepEqual(qr.items.map(i => i.kind), ['qr', 'qr', 'datamatrix']);
  assert.deepEqual(qr.items.map(i => i.data.replace(/^[A-Z]{2},/, '')), ['12345', '67890', '24680']);
  assert.ok(qr.items.every(i => i.counter === undefined && i.zeroSuppress === undefined));
  assert.equal(note(qr.diagnostics).filter(t => /^info: .*no se modela/.test(t) && /2D/.test(t)).length, 1);
});

test('the counter info is given once per label, however many counters there are', () => {
  const model = parse(`${TEXT('^SN001,1,Y')}${TEXT('^SN002,1,Y')}${BARCODE()}`);
  assert.equal(model.items.length, 3);
  assert.equal(model.diagnostics.filter(d => /valor inicial/.test(d.text)).length, 1);
});

test('^FD after ^SN in the same field: the last data command wins (no counter)', () => {
  const item = one('^FO10,10^A0N,30,30^SN001,1,Y^FDHola^FS');
  assert.deepEqual([item.data, item.counter], ['Hola', undefined]);
});

test('^SF (serialization format with a mask) is not modelled: the ^FD text is drawn as written, no counter, one warning', () => {
  const model = parse('^FO100,100^A0N,36,20^FDABCD1000EFGH^SF%%%%dddd%%%%,10000^FS');
  assert.equal(model.items.length, 1);
  assert.deepEqual([model.items[0].data, model.items[0].counter], ['ABCD1000EFGH', undefined]);
  assert.equal(note(model.diagnostics).filter(t => /^warning: \^SF/.test(t)).length, 1);
  assert.equal(note(model.diagnostics).filter(t => /no soportado/.test(t)).length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Preview: zero suppression (z = N) of the start value

test('z = N keeps the last digit and replaces the leading zeros by spaces; z = Y draws the start value as it is', () => {
  const draw = body => PB.svgRenderer.render(parse(body), { width: 800, height: 480 }, { textScale: 1, values: {} }).svg;
  assert.match(draw(TEXT('^SN001,1,N')), /xml:space="preserve">  1<\/text>/);
  assert.match(draw(TEXT('^SN000,1,N')), /xml:space="preserve">  0<\/text>/);
  assert.match(draw(TEXT('^SN100,1,N')), /xml:space="preserve">100<\/text>/);
  assert.match(draw(TEXT('^SN001,1,Y')), /xml:space="preserve">001<\/text>/);
  assert.match(draw(TEXT('^SN001')), /xml:space="preserve">  1<\/text>/, 'z defaults to N');
  assert.equal(PB.slices.text.suppressZeros('0042', one(TEXT('^SN0042,1,N')).zeroSuppress), '  42');
});

// ---------------------------------------------------------------------------------------------------------------
// Emit

test('emit: a counter is written as ^SNv,n,z instead of ^FD; z is Y without zero suppression and N with it', () => {
  assert.deepEqual(emitLines(modelOf(textItem({ counter: { step: 5 } }))), ['^FT100,82^A0N,40,40^SN0007,5,Y^FS']);
  assert.ok(emitOf(modelOf(textItem({ counter: { step: 5 } }))).text.includes('^SN0007,5,Y^FS'));
  assert.ok(emitOf(modelOf(textItem({ counter: { step: -3 }, zeroSuppress: 1 }))).text.includes('^SN0007,-3,N^FS'));
  assert.ok(emitOf(modelOf(barcodeItem({ counter: { step: 2 }, zeroSuppress: 1 }))).text.includes('^SN0042,2,N^FS'));
  assert.ok(emitOf(modelOf(barcodeItem({ counter: { step: 1 } }))).text.includes('^SN0042,1,Y^FS'));
});

test('emit: no ^FD is written for a counter, and a step of 0 or no counter is a plain ^FD', () => {
  const text = emitOf(modelOf(textItem({ counter: { step: 5 } }))).text;
  assert.ok(!text.includes('^FD'));
  assert.ok(emitOf(modelOf(textItem({ counter: { step: 0 } }))).text.includes('^FD0007^FS'));
  assert.ok(emitOf(modelOf(textItem())).text.includes('^FD0007^FS'));
});

test('emit: a counter step outside the 12 digits of ^SN is clamped with one warning', () => {
  const r = emitOf(modelOf(textItem({ counter: { step: 1e13 } }), textItem({ counter: { step: -1e13 }, y: 200 })));
  assert.ok(r.text.includes('^SN0007,999999999999,Y^FS'));
  assert.ok(r.text.includes('^SN0007,-999999999999,Y^FS'));
  assert.equal(note(r.diagnostics).filter(t => /^warning: .*12 dígitos/.test(t)).length, 1);
});

test('emit: a start value ^SN cannot carry (no digit, a comma, ^ or ~, surrounding blanks, a variable) is written as a plain ^FD with one warning', () => {
  for (const data of ['ABC', 'a,1', 'a^1', ' 12', '<#X1#>']) {
    const r = emitOf(modelOf(textItem({ data, counter: { step: 1 } })));
    assert.ok(!r.text.includes('^SN'), data);
    assert.ok(r.text.includes('^FD'), data);
    assert.equal(note(r.diagnostics).filter(t => /^warning: .*contador.*\^SN/.test(t)).length, 1, data);
  }
});

test('emit: a start value with more than 12 digits is written (the guide indexes the 12 right-most) with one info', () => {
  const r = emitOf(modelOf(textItem({ data: '12345678901234', counter: { step: 1 } })));
  assert.ok(r.text.includes('^SN12345678901234,1,Y^FS'));
  assert.equal(note(r.diagnostics).filter(t => /^info: .*12 dígitos/.test(t)).length, 1);
});

test('emit: a zero suppression of more than one character cannot be written (ZPL suppresses all of them) and has no counter-less form: one info each', () => {
  const kept = emitOf(modelOf(textItem({ counter: { step: 1 }, zeroSuppress: 3 })));
  assert.ok(kept.text.includes('^SN0007,1,N^FS'));
  assert.equal(note(kept.diagnostics).filter(t => /^info: .*ceros/.test(t)).length, 1);
  const bare = emitOf(modelOf(textItem({ zeroSuppress: 3 }), barcodeItem({ zeroSuppress: 2, y: 300 })));
  assert.ok(!bare.text.includes('^SN'));
  assert.equal(note(bare.diagnostics).filter(t => /^info: .*ceros/.test(t)).length, 1);
  const one1 = emitOf(modelOf(textItem({ counter: { step: 1 }, zeroSuppress: 1 })));
  assert.equal(note(one1.diagnostics).filter(t => /ceros/.test(t)).length, 0);
});

test('emit: counters of a bar code keep the data as the symbology writes it (Code 128 invocation escapes) and the ^BY / origin of the field', () => {
  const lines = emitLines(modelOf(barcodeItem({ counter: { step: 3 } })));
  assert.equal(lines[0], '^BY2');
  assert.match(lines[1], /^\^FO100,50\^BCN,60,Y,N,N\^SN0042,3,Y\^FS$/);
});

test('round trip parse -> emit -> parse keeps the counters of text and bar codes (step, zero suppression, data)', () => {
  const sources = [TEXT('^SN001,1,Y'), TEXT('^SN0007,-2,N'), TEXT('^SNABCD1000EFGH,5,Y'), BARCODE('^SN0001,2,N'), BARCODE('^SN12345,1,Y')];
  for (const body of sources) {
    const first = parse(body);
    const again = zpl.parse(emitOf(first).text, { dpi: DPI });
    assert.equal(again.items.length, 1, body);
    const [a, b] = [first.items[0], again.items[0]];
    assert.equal(b.kind, a.kind, body);
    assert.equal(b.data, a.data, body);
    assert.equal(b.counter && b.counter.step, a.counter && a.counter.step, body);
    assert.equal(b.zeroSuppress, a.zeroSuppress, body);
    assert.equal(b.x, a.x, body);
    assert.equal(b.y, a.y, body);
  }
  assert.equal(roundTrip(TEXT('^SN0007,-2,N')).length, 1);
  assert.match(roundTrip(TEXT('^SN0007,-2,N'))[0], /\^SN0007,-2,N\^FS$/);
});

// ---------------------------------------------------------------------------------------------------------------
// Edit

test('describeItem: Incremento (signed) for every text and bar code with digits, Ceros iniciales only for ^SN; with and without the text', () => {
  const src = wrap(TEXT('^SN0042,-3,N'));
  const withText = zpl.describeItem(zpl.parse(src, { dpi: DPI }).items[0], src).fields;
  const withoutText = zpl.describeItem(zpl.parse(src, { dpi: DPI }).items[0]).fields;
  for (const fields of [withText, withoutText]) {
    const counter = fields.find(f => f.key === 'counter');
    const zeros = fields.find(f => f.key === 'zeros');
    assert.deepEqual([counter.label, counter.type, counter.value, counter.min, counter.max], ['Incremento', 'number', -3, -999999999999, 999999999999]);
    assert.deepEqual([zeros.label, zeros.type, zeros.value], ['Ceros iniciales', 'checkbox', false]);
  }
  assert.equal(field(wrap(TEXT('^SN0042,1,Y')), 'zeros').value, true);
  assert.equal(field(wrap(TEXT('^SN0042')), 'counter').value, 1);
  assert.equal(field(wrap(TEXT('^SN0042')), 'zeros').value, false);
});

test('describeItem: a plain ^FD with digits offers Incremento 0 and no Ceros iniciales; without digits (or with a comma) neither', () => {
  const plain = wrap('^FO10,10^A0N,40,40^FD0042^FS');
  assert.equal(field(plain, 'counter').value, 0);
  assert.equal(field(plain, 'zeros'), undefined);
  for (const data of ['Hola', 'a,1']) {
    const src = wrap(`^FO10,10^A0N,40,40^FD${data}^FS`);
    assert.equal(field(src, 'counter'), undefined, data);
    assert.equal(field(src, 'zeros'), undefined, data);
  }
  const bare = wrap('^FO10,10^FD0042^FS');
  assert.equal(field(bare, 'counter').value, 0);
  const bar = wrap(BARCODE('^FD0042'));
  assert.equal(field(bar, 'counter').value, 0);
  assert.equal(field(wrap(BARCODE('^SN0042,4,N')), 'counter').value, 4);
  assert.equal(field(wrap(BARCODE('^SN0042,4,N')), 'zeros').value, false);
});

test('updateItem: Incremento on a ^SN rewrites only its second argument; an omitted one is added', () => {
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { counter: 5 }), wrap(TEXT('^SN0042,5,Y')));
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { counter: -12 }), wrap(TEXT('^SN0042,-12,Y')));
  assert.equal(set(wrap(TEXT('^SN0042')), { counter: 4 }), wrap(TEXT('^SN0042,4')));
  assert.equal(set(wrap(TEXT('^SN0042,,Y')), { counter: 4 }), wrap(TEXT('^SN0042,4,Y')));
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { counter: 1 }), wrap(TEXT('^SN0042,1,Y')), 'same value: nothing changes');
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { counter: 1e15 }), wrap(TEXT('^SN0042,999999999999,Y')), 'clamped');
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { counter: Number.NaN }), wrap(TEXT('^SN0042,1,Y')), 'invalid values are ignored');
});

test('updateItem: Incremento 0 turns a counter back into a plain ^FD with the start value; the zero suppression is gone with it', () => {
  assert.equal(set(wrap(TEXT('^SN0042,5,N')), { counter: 0 }), wrap(TEXT('^FD0042')));
  assert.equal(set(wrap(TEXT('^SN0042,0,Y')), { counter: 0 }), wrap(TEXT('^SN0042,0,Y')), 'already step 0: untouched');
  assert.equal(set(wrap(BARCODE('^SN0042,5,Y')), { counter: 0 }), wrap(BARCODE('^FD0042')));
});

test('updateItem: a non zero Incremento on a plain ^FD writes ^SN with the data, the step and z = Y (the text printed its zeros); other commands stay', () => {
  const src = wrap('^FO100,50^A0N,40,40^FR^FD0042^FS^FO10,10^A0N,20,20^FDotro^FS');
  assert.equal(set(src, { counter: 3 }), wrap('^FO100,50^A0N,40,40^FR^SN0042,3,Y^FS^FO10,10^A0N,20,20^FDotro^FS'));
  assert.equal(set(wrap(BARCODE('^FD0042')), { counter: -1 }), wrap(BARCODE('^SN0042,-1,Y')));
  // data the guide cannot serialize: refused (the field is not even offered)
  assert.equal(set(wrap('^FO10,10^A0N,40,40^FDHola^FS'), { counter: 3 }), wrap('^FO10,10^A0N,40,40^FDHola^FS'));
  assert.equal(set(wrap('^FO10,10^A0N,40,40^FDa,1^FS'), { counter: 3 }), wrap('^FO10,10^A0N,40,40^FDa,1^FS'));
  assert.equal(set(wrap('^FO10,10^A0N,40,40^FD0042^FS'), { counter: 0 }), wrap('^FO10,10^A0N,40,40^FD0042^FS'));
});

test('updateItem: the data escapes of ^FH are decoded when a ^FD becomes ^SN and encoded again when it goes back', () => {
  const src = wrap('^FO10,10^A0N,40,40^FH^FDA_2D00042^FS');
  const out = set(src, { counter: 2 });
  assert.equal(out, wrap('^FO10,10^A0N,40,40^FH^SNA-00042,2,Y^FS'));
  assert.equal(set(out, { counter: 0 }), wrap('^FO10,10^A0N,40,40^FH^FDA-00042^FS'));
});

test('updateItem: Ceros iniciales writes the z parameter (Y / N), adding the empty n when it is omitted', () => {
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { zeros: false }), wrap(TEXT('^SN0042,1,N')));
  assert.equal(set(wrap(TEXT('^SN0042,1,N')), { zeros: true }), wrap(TEXT('^SN0042,1,Y')));
  assert.equal(set(wrap(TEXT('^SN0042')), { zeros: true }), wrap(TEXT('^SN0042,,Y')));
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { zeros: true }), wrap(TEXT('^SN0042,1,Y')));
  assert.equal(set(wrap(TEXT('^FD0042')), { zeros: false }), wrap(TEXT('^FD0042')), 'a plain ^FD has no z');
});

test('updateItem: the content of a counter is its start value (first argument of ^SN), with and without other changes; data ^SN cannot carry is refused', () => {
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { content: '0100' }), wrap(TEXT('^SN0100,1,Y')));
  assert.equal(set(wrap(TEXT('^SN0042')), { content: 'AB77' }), wrap(TEXT('^SNAB77')));
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { content: 'abc' }), wrap(TEXT('^SN0042,1,Y')));
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { content: '1,2' }), wrap(TEXT('^SN0042,1,Y')));
  assert.equal(set(wrap(TEXT('^SN0042,1,Y')), { content: '1^2' }), wrap(TEXT('^SN0042,1,Y')));
  assert.equal(set(wrap(BARCODE('^SN0042,1,Y')), { content: '9999' }), wrap(BARCODE('^SN9999,1,Y')));
  const content = field(wrap(TEXT('^SN0042,1,Y')), 'content');
  assert.equal(content.value, '0042');
  assert.equal(field(wrap(TEXT('^SN0042,1,Y')), 'content', 0).type, 'text');
  // a plain ^FD keeps its own rules
  assert.equal(set(wrap(TEXT('^FD0042')), { content: 'abc, def' }), wrap(TEXT('^FDabc, def')));
});

test('updateItem: a counter edit keeps the field position (move still works on a ^SN field) and the other fields', () => {
  const src = wrap(TEXT('^SN0042,1,Y'));
  const item = zpl.parse(src, { dpi: DPI }).items[0];
  assert.equal(zpl.moveItem(src, item, 10, 5, { dpi: DPI }), wrap('^FO110,55^A0N,40,40^SN0042,1,Y^FS'));
  assert.equal(set(src, { height: 60 }), wrap('^FO100,50^A0N,60,40^SN0042,1,Y^FS'));
});

test('the 2D codes with ^SN offer no counter fields and keep editing their data', () => {
  const src = wrap('^FO10,10^BXN,4,200^SN24680,1,Y^FS');
  assert.equal(field(src, 'counter'), undefined);
  assert.equal(field(src, 'zeros'), undefined);
  const dm = field(src, 'content');
  assert.equal(dm && dm.value, '24680');
  assert.equal(set(src, { content: '13579' }), wrap('^FO10,10^BXN,4,200^SN13579,1,Y^FS'));
});

test('the field lists of text and bar codes: the counter fields come after the content (and before the reverse print of the text)', () => {
  assert.deepEqual(keys(wrap('^FO10,10^A0N,40,40^FD0042^FS')), ['font', 'height', 'width', 'rotation', 'content', 'counter', 'reverse']);
  assert.deepEqual(keys(wrap('^FO10,10^FD0042^FS')), ['content', 'counter', 'reverse']);
  assert.deepEqual(keys(wrap(TEXT('^SN0042,1,Y'))), ['font', 'height', 'width', 'rotation', 'content', 'counter', 'zeros', 'reverse']);
  assert.deepEqual(keys(wrap(BARCODE('^FD0042'))).slice(-2), ['content', 'counter']);
  assert.deepEqual(keys(wrap(BARCODE('^SN0042,1,Y'))).slice(-3), ['content', 'counter', 'zeros']);
});

// ---------------------------------------------------------------------------------------------------------------
// Conversions through the shared pipeline

const TPCL_HEAD = '{D0500,1000,0500|}\r\n{AX;+000,+000,+00|}\r\n{C|}\r\n';
const TPCL_TAIL = '\r\n{XS;I,0001,0002C4100|}';
const tpclText = (...bodies) => TPCL_HEAD + bodies.join('\r\n') + TPCL_TAIL;
const TPCL_PC = tail => `{PC001;0100,0200,10,10,J,00,B${tail}=0001|}`;
const TPCL_XB = tail => `{XB01;0100,0400,9,0,02,0,0100${tail}|}\r\n{RB01;0042|}`;
const tsplText = (...lines) => ['SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm', 'CLS', ...lines, 'PRINT 1,1'].join('\r\n');

test('TPCL -> ZPL: the increment and the zero suppression become ^SN (z = N when any zeros are suppressed, one info for the kept characters); no counter warning', () => {
  const result = PB.convert.run(tpclText(TPCL_PC(',+0000000005,Z03'), TPCL_XB(',-0000000002,000,1,00')), 'zpl', { dpi: 203 });
  assert.ok(result.text.includes('^SN0001,5,N^FS'), result.text);
  assert.ok(result.text.includes('^SN0042,-2,Y^FS'), result.text);
  assert.deepEqual(result.diagnostics.filter(d => d.level !== 'info'), []);
  assert.equal(result.diagnostics.filter(d => /ceros/.test(d.text)).length, 1);
  const back = zpl.parse(result.text, { dpi: 203 });
  assert.deepEqual(back.items.map(i => [i.counter.step, i.zeroSuppress]), [[5, 1], [-2, undefined]]);
  assert.deepEqual(back.items.map(i => i.data), ['0001', '0042']);
});

test('TPCL -> ZPL: a counter without zero suppression prints its zeros (z = Y) and a skip value of 0 is a plain field', () => {
  const result = PB.convert.run(tpclText(TPCL_PC(',+0000000001'), TPCL_PC(',+0000000000')), 'zpl', { dpi: 203 });
  assert.equal((result.text.match(/\^SN0001,1,Y\^FS/g) || []).length, 1);
  assert.equal((result.text.match(/\^FD0001\^FS/g) || []).length, 1);
});

test('TSPL -> ZPL: SET COUNTER and the @n start value become ^SN (z = Y: TSPL prints the zeros)', () => {
  const result = PB.convert.run(tsplText('SET COUNTER @0 2', '@0="0010"', 'TEXT 40,30,"3",0,1,1,@0'), 'zpl', { dpi: 203 });
  assert.ok(result.text.includes('^SN0010,2,Y^FS'), result.text);
  assert.deepEqual(result.diagnostics.filter(d => d.level !== 'info'), []);
  const back = zpl.parse(result.text, { dpi: 203 });
  assert.deepEqual([back.items[0].data, back.items[0].counter.step, back.items[0].zeroSuppress], ['0010', 2, undefined]);
});

test('TSPL -> ZPL: a counter of a bar code', () => {
  const result = PB.convert.run(tsplText('SET COUNTER @0 -1', '@0="000123"', 'BARCODE 40,30,"128",80,1,0,2,2,@0'), 'zpl', { dpi: 203 });
  assert.match(result.text, /\^SN000123,-1,Y\^FS/);
});

test('ZPL -> TPCL: the ^SN step is the skip value and z = N is the zero suppression keeping one character (Z01)', () => {
  const src = wrap(`${TEXT('^SN0001,5,N')}${BARCODE('^SN0042,-2,Y')}`);
  const result = PB.convert.run(src, 'tpcl', { dpi: 203 });
  assert.match(result.text, /,\+0000000005,Z01/);
  assert.match(result.text, /,-0000000002,/);
  const back = tpcl.parse(result.text, { dpi: 203 });
  assert.deepEqual(back.items.map(i => [i.counter.step, i.zeroSuppress]), [[5, 1], [-2, undefined]]);
  assert.deepEqual(back.items.map(i => i.data), ['0001', '0042']);
});

test('ZPL -> TSPL: SET COUNTER with the step and the start value; the zero suppression has no TSPL equivalent (one info)', () => {
  const src = wrap(`${TEXT('^SN0001,5,N')}${BARCODE('^SN0042,-2,Y')}`);
  const result = PB.convert.run(src, 'tspl', { dpi: 203 });
  assert.match(result.text, /SET COUNTER @0 5\r\n@0="0001"\r\nTEXT [^\r\n]*,@0/);
  assert.match(result.text, /SET COUNTER @1 -2\r\n@1="0042"/);
  assert.equal(result.diagnostics.filter(d => /ceros/i.test(d.text)).length, 1);
  const back = tspl.parse(result.text, { dpi: 203 });
  assert.deepEqual(back.items.map(i => [i.counter.step, i.data]), [[5, '0001'], [-2, '0042']]);
});

test('ZPL -> ZPL through the converter keeps the counters (the shared pipeline)', () => {
  const src = wrap(`${TEXT('^SN0001,5,N')}${BARCODE('^SN0042,-2,Y')}`);
  const result = PB.convert.run(src, 'zpl', { dpi: 203 });
  assert.ok(result.text.includes('^SN0001,5,N^FS') && result.text.includes('^SN0042,-2,Y^FS'));
});
