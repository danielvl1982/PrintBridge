const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// V10 ZPL text, checked against the ZPL II Programming Guide (docs/zpl; text lines of pdftotext -layout of Volume One 2003, Volume Two 2005 as V2):
//   ^Af,o,h,w  f A..Z, 0..9; o N R I B; scalable h, w 10..32000 (0 or missing = the standard), bitmapped whole multiples 1..10 of the matrix (V1 1064+, V2 2517+)
//   ^CFf,h,w   f A..Z, 0..9; h, w 0..32000 (V1 4520+)        ^FWr  N R I B (V1 6142+)
//   ^FBa,b,c,d,e  a 0..9999, b 1..9999, c -9999..9999, d L C R J, e 0..9999 (V1 5575+)
//   ^FD / ^FV  up to 3072 characters (V1 5722+, 6096+)       ^FNn  0..9999 (V1 5873+)       ^SNv,n,z  12 digits indexed (V1 9588+)
// All parses use 254 dpi unless said otherwise: one dot is 0.1 mm, so dots and model units are the same number.
const PB = loadUpTo('js/ui.js');
const zpl = PB.languages.get('zpl');

const parse = (src, dpi = 254) => zpl.parse(`^XA${src}^XZ`, { dpi });
const one = (src, dpi) => parse(src, dpi).items[0];
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const emitText = (items, dpi = 254) => PB.languages.emit('zpl', { language: 'zpl', size: { width: 1000, height: 600, gap: null, pitch: null, native: {} }, items, diagnostics: [] }, { dpi });
const textItem = (extra = {}) => ({
  kind: 'text', x: 100, y: 100, data: 'Hi', rotation: 0, font: { size: 30, scaleX: 1, family: 'sans', weight: 700, style: 'normal' }, native: { origin: 'FT', font: '0' }, ...extra,
});

// ---- ^A

test('valid ^A, ^CF, ^FW, ^FB, ^FN and ^SN values raise no warning', () => {
  for (const src of [
    '^FO10,10^A0N,10,10^FDx^FS', '^FO10,10^A0N,32000,32000^FDx^FS', '^FO10,10^A0N,0,0^FDx^FS', '^FO10,10^A0N^FDx^FS', '^FO10,10^A0N,30^FDx^FS',
    '^FO10,10^AAN,9,5^FDx^FS', '^FO10,10^AAN,90,50^FDx^FS', '^FO10,10^AAN^FDx^FS', '^FO10,10^AAN,18^FDx^FS', '^FO10,10^AZN,40,40^FDx^FS',
    '^CF0,10,10^FO10,10^FDx^FS', '^CFA,0,0', '^CF0,32000', '^FWR', '^FO10,10^FB400,9999,-9999,J,9999^FDx^FS', '^FO10,10^FB0,1,0,L,0^FDx^FS',
    '^FO10,10^FN9999^FS', '^FO10,10^SN000000000001,1,Y^FS',
  ]) assert.deepEqual(warnings(parse(src)), [], src);
});

test('^A with a scalable size out of 10..32000 is read as written, drawn at the nearest limit and reported with the range', () => {
  const low = parse('^FO10,10^A0N,5,5^FDx^FS');
  assert.equal(low.items[0].native.height, 5);
  assert.equal(low.items[0].font.size, 10);
  assert.equal(warnings(low).length, 2);
  assert.match(warnings(low)[0], /\^A.*alto.*10\.\.32000/);
  const high = parse('^FO10,10^A0N,40000,10^FDx^FS');
  assert.equal(high.items[0].native.height, 40000);
  assert.equal(high.items[0].font.size, 32000);
  assert.match(warnings(high)[0], /alto.*32000/);
  const wide = parse('^FO10,10^A0N,20,9^FDx^FS');
  assert.match(warnings(wide)[0], /\^A.*ancho.*10\.\.32000/);
  assert.equal(wide.items[0].native.width, 9);
});

test('^A sizes that are not whole numbers (or are negative) are reported, the font keeps its standard size', () => {
  for (const src of ['^FO10,10^A0N,abc,10^FDx^FS', '^FO10,10^A0N,10.5,10^FDx^FS', '^FO10,10^A0N,-5,10^FDx^FS', '^FO10,10^AAN,x^FDx^FS']) {
    const model = parse(src);
    assert.equal(warnings(model).length, 1, src);
    assert.match(warnings(model)[0], /\^A/, src);
  }
});

test('^A with a bitmapped size that is not a whole multiple of the matrix (1..10 times) is drawn at the nearest multiple and reported', () => {
  const odd = parse('^FO10,10^AAN,20,10^FDx^FS');
  assert.equal(odd.items[0].font.size, 18);
  assert.equal(odd.items[0].native.height, 20);
  assert.equal(warnings(odd).length, 1);
  assert.match(warnings(odd)[0], /\^A.*alto.*múltiplo.*A/);
  const big = parse('^FO10,10^AAN,100,5^FDx^FS');
  assert.equal(big.items[0].font.size, 90);
  assert.match(warnings(big)[0], /1 a 10/);
});

test('the matrix of the bitmapped font follows the resolution: E is 42 x 20 at 300 dpi and 28 x 15 at 203 dpi', () => {
  assert.deepEqual(warnings(parse('^FO10,10^AEN,42,20^FDx^FS', 300)), []);
  assert.equal(warnings(parse('^FO10,10^AEN,42,20^FDx^FS', 203)).length, 2);
});

test('^A with a font that is not A..Z or 0..9 is reported and the default font is used', () => {
  for (const src of ['^FO10,10^A#N,10,10^FDx^FS', '^FO10,10^A-N^FDx^FS']) {
    const model = parse(src);
    assert.equal(model.items[0].native.font, 'A', src);
    assert.ok(warnings(model).some(t => /\^A.*fuente.*A\.\.Z.*0\.\.9/.test(t)), src);
  }
});

// ---- ^CF, ^FW

test('^CF with a height or width out of 0..32000, not a whole number, or a bad font is reported with the range', () => {
  for (const [src, pattern] of [
    ['^CFA,50000,5', /\^CF.*alto.*0\.\.32000/], ['^CFA,5,-1', /\^CF.*ancho.*0\.\.32000/], ['^CF0,abc', /\^CF.*alto/], ['^CF#,10,10', /\^CF.*fuente.*A\.\.Z.*0\.\.9/],
  ]) {
    const model = parse(src);
    assert.equal(warnings(model).length, 1, src);
    assert.match(warnings(model)[0], pattern, src);
  }
});

test('^FW with an orientation that is not N, R, I or B is reported with the values', () => {
  const model = parse('^FWX');
  assert.equal(warnings(model).length, 1);
  assert.match(warnings(model)[0], /\^FW.*N, R, I o B/);
});

// ---- ^FB

test('^FB values out of their ranges are reported with the range and drawn at the nearest limit', () => {
  const field = (fb, data = 'Hello') => parse(`^FO10,10^A0N,30,30${fb}^FD${data}^FS`);
  const width = field('^FB10000,2');
  assert.match(warnings(width)[0], /\^FB.*ancho.*0\.\.9999/);
  assert.equal(width.items[0].block.width, 9999);
  assert.match(warnings(field('^FB400,0'))[0], /\^FB.*líneas.*1\.\.9999/);
  assert.match(warnings(field('^FB400,10000'))[0], /\^FB.*líneas.*1\.\.9999/);
  assert.match(warnings(field('^FB400,2,10000'))[0], /\^FB.*interlineado.*-9999\.\.9999/);
  assert.match(warnings(field('^FB400,2,-10000'))[0], /\^FB.*interlineado.*-9999\.\.9999/);
  assert.match(warnings(field('^FB400,2,0,L,10000'))[0], /\^FB.*sangría.*0\.\.9999/);
  assert.match(warnings(field('^FB400,x'))[0], /\^FB.*líneas/);
  assert.match(warnings(field('^FB-5'))[0], /\^FB.*ancho/);
});

test('^FB with a justification that is not L, C, R or J is a warning with the letters', () => {
  const model = parse('^FO10,10^A0N,30,30^FB400,2,0,X^FDHello^FS');
  assert.equal(model.items[0].block.align, 'left');
  assert.equal(warnings(model).length, 1);
  assert.match(warnings(model)[0], /justificación.*L, C, R o J/);
});

// ---- ^FD, ^FV, ^FN, ^SN

test('^FD / ^FV data of 3072 characters raises no warning; longer data is read whole and reported with the limit', () => {
  assert.deepEqual(warnings(parse(`^FO10,10^A0N,30,30^FD${'a'.repeat(3072)}^FS`)), []);
  for (const tag of ['FD', 'FV']) {
    const model = parse(`^FO10,10^A0N,30,30^${tag}${'a'.repeat(3073)}^FS`);
    assert.equal(model.items[0].data.length, 3073);
    assert.equal(warnings(model).length, 1);
    assert.match(warnings(model)[0], /3072/);
  }
});

test('^FN outside 0..9999 or not a number says the valid range', () => {
  for (const bad of ['^FN10000', '^FNabc', '^FN-1']) {
    const model = parse(`^FO10,10^A0N,30,30${bad}^FDx^FS`);
    assert.match(warnings(model)[0], /\^FN.*0\.\.9999/, bad);
  }
});

test('^SN start value with more than 12 digits is reported: only the 12 right-most are indexed', () => {
  const model = parse('^FO10,10^A0N,30,30^SN1234567890123,1,Y^FS');
  assert.equal(warnings(model).length, 1);
  assert.match(warnings(model)[0], /\^SN.*12 dígitos/);
  assert.deepEqual(warnings(parse('^FO10,10^A0N,30,30^SN123456789012,1,Y^FS')), []);
});

// ---- Emit

test('a text written with ^FO or with a block never has an origin above 32000, and says so once', () => {
  const far = emitText([textItem({ x: 40000, y: 40000, native: { origin: 'FO', font: '0' } }), textItem({ x: 41000, y: 41000, native: { origin: 'FO', font: '0' } })]);
  assert.match(far.text, /\^FO32000,32000\^A0N/);
  assert.equal(far.diagnostics.filter(d => /32000/.test(d.text)).length, 1);
  const block = emitText([textItem({ x: 40000, y: 40000, block: { width: 300, lines: 3, align: 'left', lineSpace: 0 } })]);
  assert.match(block.text, /\^FT32000,32000\^A0N/);
  const blockFo = emitText([textItem({ x: 40000, y: 40000, native: { origin: 'FO', font: '0' }, block: { width: 300, lines: 3, align: 'left', lineSpace: 0 } })]);
  assert.match(blockFo.text, /\^FO32000,32000\^A0N/);
});

test('^FB values of a block are limited to their ranges and reported once', () => {
  const item = textItem({ block: { width: 20000, lines: 20000, align: 'center', lineSpace: 20000 } });
  const result = emitText([item, { ...item }]);
  assert.match(result.text, /\^FB9999,9999,9999,C/);
  const notes = result.diagnostics.filter(d => /\^FB/.test(d.text));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].level, 'warning');
  assert.match(notes[0].text, /9999/);
  const ok = emitText([textItem({ block: { width: 400, lines: 3, align: 'left', lineSpace: -5 } })]);
  assert.match(ok.text, /\^FB400,3,-5,L/);
  assert.equal(ok.diagnostics.filter(d => /\^FB/.test(d.text)).length, 0);
});

test('data longer than 3072 characters is cut to the limit and reported once', () => {
  const result = emitText([textItem({ data: 'a'.repeat(3100) }), textItem({ data: 'b'.repeat(3100), y: 200 })]);
  assert.match(result.text, new RegExp(`\\^FD${'a'.repeat(3072)}\\^FS`));
  assert.equal(result.diagnostics.filter(d => d.level === 'warning' && /3072/.test(d.text)).length, 1);
  const exact = emitText([textItem({ data: 'a'.repeat(3072) })]);
  assert.equal(exact.diagnostics.filter(d => /3072/.test(d.text)).length, 0);
});

test('data with ^ or ~ is written with the ^FH escapes, never raw', () => {
  const result = emitText([textItem({ data: 'a^b~c_d' })]);
  assert.match(result.text, /\^FH\^FDa_5Eb_7Ec_5Fd\^FS/);
});

test('a scalable size under 10 dots is written as 10 and reported once', () => {
  const result = emitText([textItem({ font: { size: 5, scaleX: 1, family: 'sans', weight: 700, style: 'normal' } })]);
  assert.match(result.text, /\^A0N,10,10/);
  assert.equal(result.diagnostics.filter(d => /10 y 32000/.test(d.text)).length, 1);
});

// ---- Properties panel

const DPI = 254;
const describe = (item, text, dpi = DPI) => zpl.describeItem(item, text, { dpi });
const update = (item, changes, text, dpi = DPI) => zpl.updateItem(text, item, changes, { dpi });
const SCALABLE = '^XA^FO10,10^A0N,50,40^FDHello^FS^XZ';
const BITMAP = '^XA^FO10,10^AAN,18,10^FDHello^FS^XZ';

test('the size fields offer 0 (standard) up to 32000 and the block fields their ranges', () => {
  const item = zpl.parse(SCALABLE, { dpi: DPI }).items[0];
  const fields = Object.fromEntries(describe(item, SCALABLE).fields.map(f => [f.key, f]));
  assert.deepEqual([fields.height.min, fields.height.max, fields.width.min, fields.width.max], [0, 32000, 0, 32000]);
  const blockText = '^XA^FO10,10^A0N,50,40^FB400,3,0,L^FDHello^FS^XZ';
  const block = zpl.parse(blockText, { dpi: DPI }).items[0];
  const bf = Object.fromEntries(describe(block, blockText).fields.map(f => [f.key, f]));
  assert.deepEqual([bf.blockWidth.min, bf.blockWidth.max, bf.blockLines.min, bf.blockLines.max, bf.blockSpace.min, bf.blockSpace.max], [1, 9999, 1, 9999, -9999, 9999]);
});

test('a scalable size typed in the panel is written as 0 or 10..32000', () => {
  const item = zpl.parse(SCALABLE, { dpi: DPI }).items[0];
  assert.match(update(item, { height: 5 }, SCALABLE), /\^A0N,10,40/);
  assert.match(update(item, { width: 3 }, SCALABLE), /\^A0N,50,10/);
  assert.match(update(item, { height: 0 }, SCALABLE), /\^A0N,0,40/);
  assert.match(update(item, { height: 99999 }, SCALABLE), /\^A0N,32000,40/);
  assert.match(update(item, { height: 120 }, SCALABLE), /\^A0N,120,40/);
});

test('a bitmapped size typed in the panel is written as a whole multiple of the matrix (1..10 times)', () => {
  const item = zpl.parse(BITMAP, { dpi: DPI }).items[0];
  assert.match(update(item, { height: 20 }, BITMAP), /\^AAN,18,10/);
  assert.match(update(item, { height: 500 }, BITMAP), /\^AAN,90,10/);
  assert.match(update(item, { width: 12 }, BITMAP), /\^AAN,18,10/);
  assert.match(update(item, { width: 14 }, BITMAP), /\^AAN,18,15/);
  assert.match(update(item, { height: 0 }, BITMAP), /\^AAN,0,10/);
  const e300 = '^XA^FO10,10^AEN,42,20^FDHello^FS^XZ';
  const item300 = zpl.parse(e300, { dpi: 300 }).items[0];
  assert.match(update(item300, { height: 80 }, e300, 300), /\^AEN,84,20/);
});
