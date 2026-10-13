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
