const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// ZPL ^SFa,b: serialization with a mask (js/languages/zpl.js, js/languages/zpl-edit.js, the text and barcode slices). Volume One (2003) pages 298-300 and
// exercise 4 of the Basic ZPL Exercises: a = the mask (its length is the number of right-most characters of the ^FD data that are serialized; D / d decimal,
// H / h hexadecimal, O / o octal, A / a alphabetic, N / n alphanumeric, % ignore the position), b = the increment, a POSITIONAL string aligned with the mask
// from the right (default: decimal 1). Only the decimal masks (d, D, %) are modelled; any other placeholder keeps the old behaviour: a plain ^FD, one warning
// that names the placeholder, no counter. The manual is silent on a ^FD shorter than the mask, on ^PQ, ^FN, ^FB and QR / Data Matrix.
// Parses use 254 dpi, where one dot is exactly 0.1 mm.
const PB = loadApp();
const zpl = PB.languages.get('zpl');
const DPI = 254;

const wrap = body => `^XA^PW800^LL480${body}^XZ`;
const parse = body => zpl.parse(wrap(body), { dpi: DPI });
const one = body => parse(body).items[0];
const note = diagnostics => diagnostics.map(d => `${d.level}: ${d.text}`);
const warnings = model => note(model.diagnostics).filter(t => t.startsWith('warning'));
const emitOf = model => zpl.emit(model, { dpi: DPI });
const roundTrip = (body, dpi = DPI) => zpl.emit(zpl.parse(wrap(body), { dpi }), { dpi }).text;

const TEXT = data => `^FO100,50^A0N,40,40${data}^FS`;
const BARCODE = data => `^BY2,3,60^FO100,50^BCN,60,Y,N,N${data}^FS`;

// ---------------------------------------------------------------------------------------------------------------
// Parse (S2)

test('^SF with a decimal mask: the ^FD data is the first value, serialMask keeps the mask and the increment string, no warning', () => {
  const model = parse(TEXT('^FD00100^SFddddd,1'));
  assert.equal(model.items.length, 1);
  const item = model.items[0];
  assert.equal(item.kind, 'text');
  assert.equal(item.data, '00100');
  assert.deepEqual(item.serialMask, { mask: 'ddddd', increment: '1' });
  assert.equal(item.zeroSuppress, undefined);
  assert.deepEqual(warnings(model), []);
  assert.equal(note(model.diagnostics).filter(t => /^info: .*valor inicial/.test(t)).length, 1);
});

test('exercise 4 of the manual: %%%%dddd%%%% with the increment 10000 is modelled as written; the % positions make no counter of it', () => {
  const model = parse('^FO100,100^A0N,36,20^FDABCD1000EFGH^SF%%%%dddd%%%%,10000^FS');
  const item = model.items[0];
  assert.equal(item.data, 'ABCD1000EFGH');
  assert.deepEqual(item.serialMask, { mask: '%%%%dddd%%%%', increment: '10000' });
  assert.equal(item.counter, undefined);
  assert.deepEqual(warnings(model), []);
});

test('the increment is a string, not an integer: it is kept as written (leading zeros, %, omitted)', () => {
  assert.deepEqual(one(TEXT('^FD0100^SFdddd,0010')).serialMask, { mask: 'dddd', increment: '0010' });
  assert.deepEqual(one(TEXT('^FD0100^SFdddd,%1')).serialMask, { mask: 'dddd', increment: '%1' });
  assert.deepEqual(one(TEXT('^FD0100^SFdddd')).serialMask, { mask: 'dddd', increment: '' });
  assert.deepEqual(one(TEXT('^FD0100^SFDDDD,1')).serialMask, { mask: 'DDDD', increment: '1' });
});

test('counter bridge: a d run that covers the whole trailing digit run with an all-digit increment also sets counter.step (the integer value)', () => {
  assert.equal(one(TEXT('^FD00100^SFddddd,1')).counter.step, 1);
  assert.equal(one(TEXT('^FDBL0000^SFdddd,1')).counter.step, 1, 'a non-digit prefix is allowed');
  assert.equal(one(TEXT('^FD0100^SFDDDD,0010')).counter.step, 10);
  assert.equal(one(TEXT('^FD0100^SFdddd')).counter.step, 1, 'the default increment is decimal 1');
  assert.equal(one(TEXT('^FD000000000100^SFdddddddddddd,999999999999')).counter.step, 999999999999);
  assert.equal(one(BARCODE('^FD0042^SFdddd,2')).counter.step, 2);
});

test('counter bridge: no counter for a partial run, a mask longer than the run, a zero or a huge increment, a % in the mask or in the increment', () => {
  assert.equal(one(TEXT('^FDBL0000^SFdd,1')).counter, undefined, 'the mask covers part of the digit run');
  assert.equal(one(TEXT('^FDBL0000^SFddddd,1')).counter, undefined, 'the mask covers more than the digit run');
  assert.equal(one(TEXT('^FD0100^SFdddd,0')).counter, undefined);
  assert.equal(one(TEXT('^FD0100^SFdddd,0000')).counter, undefined);
  assert.equal(one(TEXT('^FD0000000000000^SFddddddddddddd,1000000000000')).counter, undefined, 'more than 12 digits');
  assert.equal(one(TEXT('^FD0100^SFdddd,%1')).counter, undefined);
  assert.equal(one(TEXT('^FD01%0^SFd%dd,1')).counter, undefined);
  assert.equal(one(TEXT('^FD0100EF^SFdddd,1')).counter, undefined, 'the data does not end with the digits');
  // every one of them is still a modelled mask
  assert.deepEqual(one(TEXT('^FDBL0000^SFdd,1')).serialMask, { mask: 'dd', increment: '1' });
});

test('^SF may come before ^FD and before the font command: the field is read when ^FS closes it', () => {
  const item = one('^FO10,10^SFdddd,3^A0N,30,30^FD0100^FS');
  assert.deepEqual([item.kind, item.data, item.serialMask, item.counter.step, item.font.size], ['text', '0100', { mask: 'dddd', increment: '3' }, 3, 30]);
});

test('a mask with another placeholder is not modelled: plain ^FD, no counter, one warning that names the placeholder (the manual examples with letters)', () => {
  const cases = [
    ['^FDBL0000^SFAAdddd,1', /"A"/],
    ['^FDBL00-0^SFAAdd%d,1%1', /"A"/],
    ['^FD12A^SFnnA,F', /"n"/],
    ['^FD00FF^SFhhhh,1', /"h"/],
    ['^FD0077^SFOOOO,1', /"O"/],
  ];
  for (const [data, named] of cases) {
    const model = parse(TEXT(data));
    const item = model.items[0];
    assert.equal(item.data, /\^FD([^^]*)/.exec(data)[1], data);
    assert.equal(item.serialMask, undefined, data);
    assert.equal(item.counter, undefined, data);
    assert.equal(model.items.length, 1, data);
    const w = warnings(model);
    assert.equal(w.length, 1, data);
    assert.match(w[0], /^warning: \^SF/, data);
    assert.match(w[0], named, data);
    assert.ok(!note(model.diagnostics).some(t => /no soportado/.test(t)), data);
  }
});

test('a mask or increment that cannot be read is not modelled either (one warning each): empty, other characters, an increment with letters or longer than the mask', () => {
  for (const data of ['^FD0100^SF', '^FD0100^SFdd d,1', '^FD0100^SFdddd,x', '^FD0100^SFdd,111', '^FD0100^SFdd,-1']) {
    const model = parse(TEXT(data));
    assert.equal(model.items[0].serialMask, undefined, data);
    assert.equal(model.items[0].counter, undefined, data);
    assert.equal(model.items[0].data, '0100', data);
    assert.equal(warnings(model).filter(t => /^warning: \^SF/.test(t)).length, 1, data);
  }
});

test('a mask longer than the data is modelled with one warning (the manual does not say what the printer does)', () => {
  const model = parse(TEXT('^FD12^SFdddd,1'));
  assert.deepEqual(model.items[0].serialMask, { mask: 'dddd', increment: '1' });
  assert.equal(warnings(model).length, 1);
  assert.match(warnings(model)[0], /^warning: \^SF.*más larga/);
});

test('^SF on a bar code: the data is the first value, serialMask and the bridged counter go to the barcode item', () => {
  const item = one(BARCODE('^FD0042^SFdddd,1'));
  assert.equal(item.kind, 'barcode');
  assert.equal(item.symbology, 'code128');
  assert.equal(item.data, '0042');
  assert.deepEqual(item.serialMask, { mask: 'dddd', increment: '1' });
  assert.equal(item.counter.step, 1);
});

test('^SF on QR and Data Matrix (as ^SN does): the data is read, no mask or counter is modelled, one info', () => {
  const model = parse('^FO10,10^BQN,2,4^FDQA,12345^SFddddd,1^FS^FO10,100^BXN,4,200^FD24680^SFddddd,1^FS');
  assert.deepEqual(model.items.map(i => i.kind), ['qr', 'datamatrix']);
  assert.ok(model.items.every(i => i.serialMask === undefined && i.counter === undefined));
  assert.deepEqual(warnings(model), []);
  assert.equal(note(model.diagnostics).filter(t => /^info: .*\^SF.*2D/.test(t)).length, 1);
});

test('^SF with ^FN (as ^SN does): the variable wins, one warning, no mask', () => {
  const model = parse('^FO10,10^A0N,30,30^FN1^FD0100^SFdddd,1^FS');
  assert.equal(model.items[0].data, '<#FN1#>');
  assert.equal(model.items[0].serialMask, undefined);
  assert.equal(note(model.diagnostics).filter(t => /^warning: .*\^FN.*\^SF/.test(t)).length, 1);
});

test('^SN and ^SF in one field: the ^SN counter wins (the mask is ignored with one warning)', () => {
  const model = parse('^FO10,10^A0N,30,30^SN0100,2,Y^SFdddd,1^FS');
  assert.equal(model.items[0].counter.step, 2);
  assert.equal(model.items[0].serialMask, undefined);
  assert.equal(note(model.diagnostics).filter(t => /^warning: .*\^SN.*\^SF/.test(t)).length, 1);
});

test('the field is drawn with the first value exactly as plain data', () => {
  const draw = body => PB.svgRenderer.render(parse(body), { width: 800, height: 480 }, { textScale: 1, values: {} }).svg;
  assert.match(draw(TEXT('^FD00100^SFddddd,1')), /xml:space="preserve">00100<\/text>/);
  assert.match(draw(TEXT('^FDABCD1000EFGH^SF%%%%dddd%%%%,10000')), />ABCD1000EFGH<\/text>/);
});

test('^SF on a block of text (^FB): kept as the manual is silent, drawn with the first value', () => {
  const model = parse('^FO10,10^A0N,30,30^FB300,2,0,L^FD0100^SFdddd,1^FS');
  assert.equal(model.items[0].data, '0100');
  assert.deepEqual(model.items[0].serialMask, { mask: 'dddd', increment: '1' });
});

// ---------------------------------------------------------------------------------------------------------------
// Emit (S3)

const textItem = extra => ({ kind: 'text', ref: 'A', x: 100, y: 82, rotation: 0, data: '00100', font: { size: 40, scaleX: 1, family: 'sans', weight: 700, style: 'normal' }, ...extra });
const barcodeItem = extra => ({ kind: 'barcode', ref: 'BC', x: 100, y: 50, rotation: 0, symbology: 'code128', module: 2, height: 60, humanReadable: true, data: '0042', ...extra });
const modelOf = (...items) => ({ size: { width: 800, height: 480 }, items });

test('emit: ^SF is written after the ^FD data exactly as the item holds it; the increment is omitted only when it is empty', () => {
  assert.ok(emitOf(modelOf(textItem({ serialMask: { mask: 'ddddd', increment: '1' } }))).text.includes('^FD00100^SFddddd,1^FS'));
  assert.ok(emitOf(modelOf(textItem({ serialMask: { mask: 'ddddd', increment: '' } }))).text.includes('^FD00100^SFddddd^FS'));
  assert.ok(emitOf(modelOf(textItem({ serialMask: { mask: 'DDd%d', increment: '%1' } }))).text.includes('^FD00100^SFDDd%d,%1^FS'));
  assert.ok(emitOf(modelOf(barcodeItem({ serialMask: { mask: 'dddd', increment: '2' } }))).text.includes('^FD0042^SFdddd,2^FS'));
});

test('emit: the counter bridged from a mask is not written as ^SN (the mask wins), and a counter without a mask still is', () => {
  const text = emitOf(modelOf(textItem({ serialMask: { mask: 'ddddd', increment: '1' }, counter: { step: 1 } }))).text;
  assert.ok(text.includes('^SFddddd,1') && !text.includes('^SN'));
  assert.ok(emitOf(modelOf(textItem({ counter: { step: 1 } }))).text.includes('^SN00100,1,Y^FS'));
});

test('emit: data that needs the ^FH escapes keeps its ^SF; a mask longer than the data and a mask the app cannot write give one warning each', () => {
  const hex = emitOf(modelOf(textItem({ data: 'A^0100', serialMask: { mask: 'dddd', increment: '1' } }))).text;
  assert.ok(hex.includes('^FH^FDA_5E0100^SFdddd,1^FS'), hex);
  const longer = emitOf(modelOf(textItem({ data: '12', serialMask: { mask: 'dddd', increment: '1' } })));
  assert.ok(longer.text.includes('^FD12^SFdddd,1^FS'));
  assert.equal(note(longer.diagnostics).filter(t => /^warning: .*\^SF.*más largas/.test(t)).length, 1);
  const bad = emitOf(modelOf(textItem({ serialMask: { mask: 'AAdd', increment: '1' } })));
  assert.ok(bad.text.includes('^FD00100^FS') && !bad.text.includes('^SF'));
  assert.equal(note(bad.diagnostics).filter(t => /^warning: .*\^SF.*no se pueden escribir/.test(t)).length, 1);
});

test('round trip parse -> emit -> parse at 203 and 300 dpi: the manual masks come back as they were read (mask, increment, counter, data)', () => {
  const sources = [
    TEXT('^FD00100^SFddddd,1'), TEXT('^FDABCD1000EFGH^SF%%%%dddd%%%%,10000'), TEXT('^FDBL0000^SFdddd'), TEXT('^FD0100^SFDDDD,0010'), TEXT('^FD0100^SFdddd,%1'),
    TEXT('^FD12^SFdddd,1'), BARCODE('^FD0042^SFdddd,2'), '^FO10,10^SFdddd,3^A0N,30,30^FD0100^FS',
  ];
  for (const dpi of [203, 300]) {
    for (const body of sources) {
      const first = zpl.parse(wrap(body), { dpi });
      const out = zpl.emit(first, { dpi }).text;
      const again = zpl.parse(out, { dpi });
      assert.equal(again.items.length, 1, body);
      const [a, b] = [first.items[0], again.items[0]];
      assert.deepEqual(b.serialMask, a.serialMask, `${dpi} ${body}`);
      assert.deepEqual(b.counter, a.counter, `${dpi} ${body}`);
      assert.equal(b.data, a.data, `${dpi} ${body}`);
      assert.equal(b.kind, a.kind, body);
      assert.ok(out.includes(`^SF${a.serialMask.mask}${a.serialMask.increment === '' ? '' : `,${a.serialMask.increment}`}^FS`), `${dpi} ${body}\n${out}`);
      // writing it twice is stable
      assert.equal(zpl.emit(again, { dpi }).text, out, `${dpi} ${body}`);
    }
  }
  // the decimal mask of the manual's exercise 4 is written exactly as it was read
  assert.match(roundTrip('^FO100,100^A0N,36,20^FDABCD1000EFGH^SF%%%%dddd%%%%,10000^FS'), /\^FDABCD1000EFGH\^SF%%%%dddd%%%%,10000\^FS/);
});

test('an unsupported mask still round trips as before: written as its plain ^FD (the old behaviour), warned once on the read', () => {
  const out = roundTrip(TEXT('^FDBL0000^SFAAdddd,1'));
  assert.match(out, /\^FDBL0000\^FS/);
  assert.ok(!out.includes('^SF'));
});

test('the ZPL to ZPL conversion keeps the mask', () => {
  const result = PB.convert.run(wrap(TEXT('^FD00100^SFddddd,1')), 'zpl', { dpi: 203 });
  assert.ok(result.text.includes('^FD00100^SFddddd,1^FS'), result.text);
});

test('a text block (^FB) keeps its ^SF when written back', () => {
  assert.match(roundTrip('^FO10,10^A0N,30,30^FB300,2,0,L^FD0100^SFdddd,1^FS'), /\^FD0100\^SFdddd,1\^FS/);
});

// ---------------------------------------------------------------------------------------------------------------
// Edit (S3)

const field = (src, key, index = 0) => zpl.describeItem(zpl.parse(src, { dpi: DPI }).items[index], src).fields.find(f => f.key === key);
const keys = (src, index = 0) => zpl.describeItem(zpl.parse(src, { dpi: DPI }).items[index], src).fields.map(f => f.key);
const set = (src, changes, index = 0) => zpl.updateItem(src, zpl.parse(src, { dpi: DPI }).items[index], changes, { dpi: DPI });
const SRC = wrap(TEXT('^FD00100^SFddddd,1'));

test('describeItem: a field with a decimal ^SF offers the mask and the increment (Spanish labels), no Incremento / Ceros iniciales, and the content stays', () => {
  for (const text of [SRC, undefined]) {
    const fields = zpl.describeItem(zpl.parse(SRC, { dpi: DPI }).items[0], text).fields;
    const mask = fields.find(f => f.key === 'serialMask');
    const increment = fields.find(f => f.key === 'serialIncrement');
    assert.deepEqual([mask.type, mask.value, mask.label], ['text', 'ddddd', 'Máscara de serie (^SF)']);
    assert.deepEqual([increment.type, increment.value, increment.label], ['text', '1', 'Incremento de la máscara']);
    assert.equal(fields.find(f => f.key === 'content').value, '00100');
    assert.equal(fields.some(f => f.key === 'counter' || f.key === 'zeros'), false);
  }
  assert.equal(field(wrap(TEXT('^FD0100^SFdddd')), 'serialIncrement').value, '');
  assert.deepEqual(keys(SRC), ['kind', 'font', 'height', 'width', 'rotation', 'content', 'serialMask', 'serialIncrement', 'reverse']);
  assert.deepEqual(keys(wrap(BARCODE('^FD0042^SFdddd,2'))).slice(-3), ['content', 'serialMask', 'serialIncrement']);
});

test('describeItem: fields without a decimal mask keep their lists (plain ^FD, ^SN); a mask with letters offers neither the mask nor Incremento; 2D codes none', () => {
  assert.deepEqual(keys(wrap('^FO10,10^A0N,40,40^FD0042^FS')), ['kind', 'font', 'height', 'width', 'rotation', 'content', 'counter', 'reverse']);
  assert.equal(field(wrap(TEXT('^SN0042,1,Y')), 'serialMask'), undefined);
  assert.deepEqual(keys(wrap(TEXT('^FDBL0000^SFAAdddd,1'))), ['kind', 'font', 'height', 'width', 'rotation', 'content', 'reverse']);
  const qr = wrap('^FO10,10^BQN,2,4^FDQA,12345^SFddddd,1^FS');
  assert.equal(field(qr, 'serialMask'), undefined);
  assert.equal(field(qr, 'counter'), undefined);
});

test('updateItem: the mask and the increment are rewritten in place, only their own argument changes, the rest of the field stays', () => {
  assert.equal(set(SRC, { serialMask: 'dddd%' }), wrap(TEXT('^FD00100^SFdddd%,1')));
  assert.equal(set(SRC, { serialMask: 'DDDDD' }), wrap(TEXT('^FD00100^SFDDDDD,1')));
  assert.equal(set(SRC, { serialIncrement: '10' }), wrap(TEXT('^FD00100^SFddddd,10')));
  assert.equal(set(SRC, { serialIncrement: '%1' }), wrap(TEXT('^FD00100^SFddddd,%1')));
  assert.equal(set(SRC, { serialMask: 'ddd', serialIncrement: '2' }), wrap(TEXT('^FD00100^SFddd,2')));
  assert.equal(set(wrap(TEXT('^FD0100^SFdddd')), { serialIncrement: '5' }), wrap(TEXT('^FD0100^SFdddd,5')), 'an omitted increment is added');
  assert.equal(set(SRC, { serialMask: 'ddddd' }), SRC, 'same value: nothing changes');
  assert.equal(set(wrap(BARCODE('^FD0042^SFdddd,2')), { serialIncrement: '3' }), wrap(BARCODE('^FD0042^SFdddd,3')));
});

test('updateItem: an empty increment goes back to the default (the argument is removed); an empty mask removes ^SF and offers the counter again', () => {
  assert.equal(set(SRC, { serialIncrement: '' }), wrap(TEXT('^FD00100^SFddddd')));
  const without = set(SRC, { serialMask: '' });
  assert.equal(without, wrap(TEXT('^FD00100')));
  assert.equal(field(without, 'counter').value, 0);
  assert.equal(field(without, 'serialMask'), undefined);
  assert.equal(zpl.parse(without, { dpi: DPI }).items[0].serialMask, undefined);
  assert.equal(set(SRC, { serialMask: '', serialIncrement: '3' }), wrap(TEXT('^FD00100')), 'a mask removed together with an increment change: the removal wins');
});

test('updateItem validation: mask only d D %, increment only digits and %, increment not longer than the mask; invalid values change nothing', () => {
  for (const mask of ['ddAd', 'dd d', 'hh', 'nnA', 'd,d', 'd^d', 5, null]) assert.equal(set(SRC, { serialMask: mask }), SRC, String(mask));
  for (const inc of ['x', '-1', '1,2', '1.5', '123456', ' 1', 7, null]) assert.equal(set(SRC, { serialIncrement: inc }), SRC, String(inc));
  const long = wrap(TEXT('^FD00100^SFddddd,12'));
  assert.equal(set(long, { serialMask: 'd' }), long, 'a mask shorter than the current increment is refused');
  assert.equal(set(long, { serialMask: 'dd' }), wrap(TEXT('^FD00100^SFdd,12')));
  assert.equal(set(SRC, { serialMask: 'dd', serialIncrement: '' }), wrap(TEXT('^FD00100^SFdd')), 'checked against the increment of the same update');
});

test('updateItem: a mask longer than the data is written (the panel note warns, nothing refuses); the content stays editable and keeps ^SF', () => {
  assert.equal(set(wrap(TEXT('^FD12^SFdd,1')), { serialMask: 'dddd' }), wrap(TEXT('^FD12^SFdddd,1')));
  assert.match(field(SRC, 'serialMask').note, /dato/);
  assert.equal(set(SRC, { content: '00200' }), wrap(TEXT('^FD00200^SFddddd,1')));
  assert.equal(set(SRC, { content: 'A^B' }), wrap(TEXT('^FH^FDA_5EB^SFddddd,1')));
  assert.equal(field(SRC, 'content').value, '00100');
});

test('updateItem: Incremento is not offered on a ^SF field, so it can never turn the field into ^SN', () => {
  assert.equal(set(SRC, { counter: 3 }), SRC);
  assert.equal(set(SRC, { counter: 0 }), SRC);
  assert.equal(set(SRC, { zeros: false }), SRC);
  const alpha = wrap(TEXT('^FDBL0000^SFAAdddd,1'));
  assert.equal(set(alpha, { counter: 3 }), alpha, 'an unmodelled mask is never mixed with ^SN');
});

test('the edit engines keep working on a ^SF field: move, height, symbology change and the parse and re-emit of the result', () => {
  const item = zpl.parse(SRC, { dpi: DPI }).items[0];
  assert.equal(zpl.moveItem(SRC, item, 10, 5, { dpi: DPI }), wrap('^FO110,55^A0N,40,40^FD00100^SFddddd,1^FS'));
  assert.equal(set(SRC, { height: 60 }), wrap('^FO100,50^A0N,60,40^FD00100^SFddddd,1^FS'));
  const bars = wrap(BARCODE('^FD0042^SFdddd,2'));
  const barItem = zpl.parse(bars, { dpi: DPI }).items[0];
  assert.equal(zpl.moveItem(bars, barItem, 10, 5, { dpi: DPI }), wrap('^BY2,3,60^FO110,55^BCN,60,Y,N,N^FD0042^SFdddd,2^FS'));
  assert.equal(set(bars, { height: 80 }), wrap('^BY2,3,60^FO100,50^BCN,80,Y,N,N^FD0042^SFdddd,2^FS'));
  const typed = set(bars, { symbology: 'code39' });
  assert.notEqual(typed, bars);
  assert.ok(typed.includes('^FD0042^SFdddd,2^FS'), typed);
  const edited = set(set(SRC, { serialMask: 'dddd', serialIncrement: '2' }), { content: '0100' });
  const again = zpl.parse(edited, { dpi: DPI }).items[0];
  assert.deepEqual([again.data, again.serialMask, again.counter.step], ['0100', { mask: 'dddd', increment: '2' }, 2]);
  assert.ok(zpl.emit(zpl.parse(edited, { dpi: DPI }), { dpi: DPI }).text.includes('^FD0100^SFdddd,2^FS'));
});

test('an item without source text (the model only) describes the mask and the increment', () => {
  const fields = zpl.describeItem(textItem({ serialMask: { mask: 'dddd', increment: '' } })).fields;
  assert.deepEqual(fields.filter(f => /^serial/.test(f.key)).map(f => [f.key, f.value]), [['serialMask', 'dddd'], ['serialIncrement', '']]);
  assert.equal(fields.some(f => f.key === 'counter'), false);
});

// ---------------------------------------------------------------------------------------------------------------
// S5: the manual's examples, parse -> emit -> parse at 203 and 300 dpi

for (const dpi of [203, 300]) {
  for (const [name, data, mask] of [
    ['exercise 4 (the % around the digits)', '^FDABCD1000EFGH^SF%%%%dddd%%%%,10000', { mask: '%%%%dddd%%%%', increment: '10000' }],
    ['a decimal run with the default increment', '^FDBL0000^SFdddd', { mask: 'dddd', increment: '' }],
    ['a decimal run with an increment of 1', '^FDBL0000^SFdddd,1', { mask: 'dddd', increment: '1' }],
    ['a mask shorter than the digit run', '^FD00100^SFddd,1', { mask: 'ddd', increment: '1' }],
  ]) {
    test(`round trip at ${dpi} dpi: ${name} is written back as read and keeps its mask`, () => {
      const first = zpl.parse(wrap(TEXT(data)), { dpi });
      assert.deepEqual(first.items[0].serialMask, mask);
      const text = zpl.emit(first, { dpi }).text;
      assert.ok(text.includes(data), text);
      const second = zpl.parse(text, { dpi });
      assert.deepEqual(second.items[0].serialMask, mask);
      assert.equal(second.items[0].data, first.items[0].data);
      assert.equal(zpl.emit(second, { dpi }).text, text);
      assert.deepEqual(second.diagnostics.filter(d => d.level === 'warning'), []);
    });
  }

  // The manual's samples with letter placeholders are not modelled: plain ^FD with a warning, stable on a second round
  for (const [name, data] of [['^FD12A^SFnnA,F (mask nnA)', '^FD12A^SFnnA,F'], ['^FDBL0000^SFAAdddd,1', '^FDBL0000^SFAAdddd,1'], ['^FDBL00-0^SFAAdd%d,1%1', '^FDBL00-0^SFAAdd%d,1%1']]) {
    test(`round trip at ${dpi} dpi: the manual's ${name} stays a plain ^FD with one warning and no mask`, () => {
      const first = zpl.parse(wrap(TEXT(data)), { dpi });
      assert.equal(first.items[0].serialMask, undefined);
      assert.equal(first.items[0].counter, undefined);
      assert.equal(first.diagnostics.filter(d => d.level === 'warning' && /\^SF/.test(d.text)).length, 1);
      const text = zpl.emit(first, { dpi }).text;
      assert.doesNotMatch(text, /\^SF/);
      assert.equal(zpl.emit(zpl.parse(text, { dpi }), { dpi }).text, text);
    });
  }
}
