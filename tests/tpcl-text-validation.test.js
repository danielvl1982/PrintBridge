const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// V2 TPCL text, checked against the manuals (B-SV4 2004 6.3.7 / 6.3.8, B-452-R 2012 6.3.8 / 6.3.9, B-452-TS12 ES 6.10 / 6.11):
//   {PCaaa;bbbb,cccc,d,e,ff(,ghh),ii,j(,Jkkll)(,Mm)(,noooooooooo)(,Zpp)(,Pq)(=data)|}   aaa 000..199 (00..99 also), hh 00..99, kk / ll 00..16,
//     m 0..2, oooooooooo 0000000000..9999999999, pp 00..20, q 1 / 2 / 3 / 4aaaa (0050..1057) / 5aaaabbbcc, data max 255
//   {PVaa;bbbb,cccc,dddd,eeee,f(,ghhh),ii,j(,Mk)(,lmmmmmmmmmm)(,Znn)(,Po)(=data)|}      aa 00..99, dddd / eeee 0020..0850, hhh 000..512, o 1..4aaaa
//   attribute offsets W / F aabb, C aa: 01..99 dots. X is 4 digits, Y 4 or 5 digits (0.1 mm). The magnification and the P5 block have their own files.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const DPI = 203;
const DOT = PB.units.dotSize(DPI);

const parse = text => tpcl.parse(text, { dpi: DPI });
const warnings = text => parse(text).diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const itemOf = text => parse(text).items[0];
const describe = (text, index = 0) => tpcl.describeItem(parse(text).items[index], text);
const field = (text, key) => describe(text).fields.find(f => f.key === key);
const levels = (diagnostics, level) => diagnostics.filter(d => d.level === level).map(d => d.text);

const pc = (tail = '', { id = '00', head = '10,10,S,' } = {}) => `{PC${id};0100,0200,${head}00,B${tail}=HOLA|}`;
const pv = (tail = '', { id = '00', size = '0100,0120', font = 'B', spacing = '' } = {}) => `{PV${id};0100,0200,${size},${font},${spacing}00,B${tail}=HOLA|}`;

// ---- Parsing: string number

test('parse: PC number 00..99 (2 digits) and 000..199 (3 digits) are valid, others warn with the range', () => {
  for (const id of ['00', '99', '000', '150', '199']) assert.deepEqual(warnings(pc('', { id })), [], id);
  for (const id of ['0', '5', '200', '1000']) {
    const w = warnings(pc('', { id }));
    assert.equal(w.length, 1, id);
    assert.match(w[0], new RegExp(`PC${id}: número de campo "${id}" fuera de 00\\.\\.99 .* 000\\.\\.199`));
  }
});

test('parse: PV number is exactly 2 digits 00..99', () => {
  for (const id of ['00', '99']) assert.deepEqual(warnings(pv('', { id })), [], id);
  for (const id of ['5', '100']) {
    const w = warnings(pv('', { id }));
    assert.equal(w.length, 1, id);
    assert.match(w[0], /número de campo .* fuera de 00\.\.99/);
  }
});

// ---- Parsing: PV character width and height

test('parse: PV width and height 0020..0850 raise nothing at the limits', () => {
  assert.deepEqual(warnings(pv('', { size: '0020,0850' })), []);
  assert.deepEqual(warnings(pv('', { size: '0850,0020' })), []);
});

test('parse: PV width / height out of 0020..0850 are read as written, drawn as the nearest valid one and reported with the range', () => {
  const text = pv('', { size: '0010,0900' });
  const w = warnings(text);
  assert.equal(w.length, 2);
  assert.match(w[0], /ancho "0010" fuera de 0020\.\.0850/);
  assert.match(w[1], /alto "0900" fuera de 0020\.\.0850/);
  const { font } = itemOf(text);
  assert.equal(font.size, 850);
  assert.ok(Math.abs(font.scaleX - 20 / 850) < 1e-9);
  assert.equal(itemOf(text).source.spans[0].start, 0);
  // the code is untouched: the panel still reads the digits as written
  assert.equal(field(text, 'width').value, 10);
  assert.equal(field(text, 'height').value, 900);
});

test('parse: PV width without its 4 digits is reported (the printer needs dddd)', () => {
  const w = warnings(pv('', { size: '100,0120' }));
  assert.equal(w.length, 1);
  assert.match(w[0], /ancho "100".*4 dígitos/);
});

test('parse: a PV size of 0 is drawn with the minimum, not as NaN', () => {
  const { font } = itemOf(pv('', { size: '0000,0000' }));
  assert.equal(font.size, 20);
  assert.equal(font.scaleX, 1);
});

test('parse: PV font A, B and E..J are in the manuals; anything else warns', () => {
  for (const f of ['A', 'B', 'E', 'F', 'G', 'H', 'I', 'J']) assert.deepEqual(warnings(pv('', { font: f })), [], f);
  const w = warnings(pv('', { font: 'C' }));
  assert.equal(w.length, 1);
  assert.match(w[0], /fuente "C".*A, B, E\.\.J/);
});

// ---- Parsing: spacing

test('parse: PC spacing is +/-hh (2 digits, 00..99): other digit counts warn, the drawing uses the nearest valid dots, native keeps what was written', () => {
  assert.deepEqual(warnings(`{PC00;0100,0200,10,10,S,+99,00,B=A|}`), []);
  const text = `{PC00;0100,0200,10,10,S,+120,00,B=A|}`;
  const w = warnings(text);
  assert.equal(w.length, 1);
  assert.match(w[0], /espaciado "\+120" fuera de ±00\.\.99 \(2 dígitos/);
  const { spacing } = itemOf(text);
  assert.equal(spacing.native, 120);
  assert.ok(Math.abs(spacing.value - 99 * DOT) < 1e-9);
});

test('parse: PV spacing is +/-hhh (3 digits, 000..512): 513 and 2 digits warn', () => {
  assert.deepEqual(warnings(pv('', { spacing: '-512,' })), []);
  const over = warnings(pv('', { spacing: '+600,' }));
  assert.equal(over.length, 1);
  assert.match(over[0], /espaciado "\+600" fuera de ±000\.\.512 \(3 dígitos/);
  assert.match(warnings(pv('', { spacing: '+05,' }))[0], /espaciado "\+05"/);
  assert.equal(itemOf(pv('', { spacing: '+600,' })).spacing.native, 600);
  assert.ok(Math.abs(itemOf(pv('', { spacing: '+600,' })).spacing.value - 512 * DOT) < 1e-9);
});

// ---- Parsing: attribute offsets

test('parse: attribute offsets 01..99 raise nothing; 00 is reported and drawn as 1 dot, native keeps 0', () => {
  for (const a of ['B', 'W', 'F', 'C', 'W0101', 'F9999', 'C01', 'C99']) {
    assert.deepEqual(warnings(`{PC00;0100,0200,10,10,S,00,${a}=A|}`), [], a);
  }
  const text = `{PC00;0100,0200,10,10,S,00,W0005=A|}`;
  const w = warnings(text);
  assert.equal(w.length, 1);
  assert.match(w[0], /atributo W0005.*01\.\.99/);
  const { attribute } = itemOf(text);
  assert.deepEqual(attribute.native, { h: 0, v: 5 });
  assert.ok(Math.abs(attribute.h - DOT) < 1e-9);
  assert.ok(Math.abs(attribute.v - 5 * DOT) < 1e-9);
});

test('parse: attribute offsets with the wrong number of digits are reported (W / F need aabb, C needs aa, B none)', () => {
  for (const a of ['W05', 'F123', 'C0505', 'C5', 'B05']) {
    const w = warnings(`{PC00;0100,0200,10,10,S,00,${a}=A|}`);
    assert.equal(w.length, 1, a);
    assert.match(w[0], new RegExp(`atributo ${a}`), a);
  }
});

// ---- Parsing: bold, check digit, increment, zero suppression, alignment

test('parse: bold Jkkll 00..16: above 16 warns (drawn as 16), a malformed J warns, J on PV warns', () => {
  assert.deepEqual(warnings(pc(',J1616')), []);
  const over = warnings(pc(',J1700'));
  assert.equal(over.length, 1);
  assert.match(over[0], /J1700.*00\.\.16/);
  assert.match(warnings(pc(',J01'))[0], /J01.*Jkkll/);
  assert.match(warnings(pv(',J0101'))[0], /J.*solo existe en PC/);
});

test('parse: check digit Mm is 0, 1 or 2; M3 warns', () => {
  for (const m of ['M0', 'M1', 'M2']) assert.deepEqual(warnings(pc(`,${m}`)), [], m);
  assert.match(warnings(pc(',M3'))[0], /M3.*M0, M1 o M2/);
  assert.match(warnings(pv(',M7'))[0], /M7/);
});

test('parse: increment is a sign and 10 digits; other lengths warn', () => {
  assert.deepEqual(warnings(pc(',+9999999999')), []);
  assert.match(warnings(pc(',+001'))[0], /\+001.*10 dígitos/);
});

test('parse: zero suppression Zpp is 00..20 with 2 digits; Z25 warns (drawn as 20), Z5 warns', () => {
  assert.deepEqual(warnings(pc(',Z20')), []);
  const over = warnings(pc(',Z25'));
  assert.equal(over.length, 1);
  assert.match(over[0], /Z25.*00\.\.20/);
  assert.equal(itemOf(pc(',Z25')).zeroSuppress, 20);
  assert.match(warnings(pc(',Z5'))[0], /Z5/);
});

test('parse: alignment P1..P3 and P4aaaa (0050..1057) are valid; a width out of range is drawn as the nearest valid one, native keeps it', () => {
  for (const p of ['P1', 'P2', 'P3', 'P40050', 'P41057']) assert.deepEqual(warnings(pc(`,${p}`)), [], p);
  const text = pc(',P40010');
  const w = warnings(text);
  assert.equal(w.length, 1);
  assert.match(w[0], /P40010.*0050\.\.1057/);
  assert.deepEqual(itemOf(text).align, { kind: 'equal', width: 50, native: { width: 10 } });
  assert.equal(itemOf(pc(',P42000')).align.width, 1057);
  assert.equal(field(text, 'alignWidth').value, 10);
});

test('parse: an unknown or malformed alignment, P5 on PV and unknown optional parameters warn', () => {
  assert.match(warnings(pc(',P6'))[0], /P6.*alineación/);
  assert.match(warnings(pc(',P4300'))[0], /P4300.*alineación/);
  assert.match(warnings(pv(',P5030002003'))[0], /P5030002003.*solo existe en PC/);
  assert.match(warnings(pc(',Q1'))[0], /"Q1".*desconocido/);
  assert.deepEqual(warnings(pv(',P40500')), []);
});

// ---- Parsing: coordinates and data

test('parse: text coordinates are X 4 digits and Y 4 or 5 digits', () => {
  const check = text => tpcl.validate(parse(text)).map(d => d.text);
  assert.deepEqual(check(`{PC00;0100,10000,10,10,S,00,B=A|}`), []);
  assert.deepEqual(check(`{PV00;0100,0200,0100,0100,B,00,B=A|}`), []);
  assert.match(check(`{PC00;01000,0200,10,10,S,00,B=A|}`)[0], /x="01000"/);
  assert.match(check(`{PC00;0100,200,10,10,S,00,B=A|}`)[0], /y="200"/);
  assert.match(check(`{PC00;0100,102000,10,10,S,00,B=A|}`)[0], /y="102000"/);
});

test('parse: inline data of 255 characters is fine, 256 is cut to 255 (the printer discards the rest) with a warning', () => {
  assert.deepEqual(warnings(`{PC00;0100,0200,10,10,S,00,B=${'a'.repeat(255)}|}`), []);
  const text = `{PC00;0100,0200,10,10,S,00,B=${'a'.repeat(256)}|}`;
  const w = warnings(text);
  assert.equal(w.length, 1);
  assert.match(w[0], /256 caracteres.*255/);
  assert.equal(itemOf(text).data.length, 255);
});

test('parse: RC / RV data over 255 characters is cut with a warning', () => {
  for (const [format, data] of [['PC00;0100,0200,10,10,S,00,B', 'RC00'], ['PV00;0100,0200,0100,0100,B,00,B', 'RV00']]) {
    const text = `{${format}|}\n{${data};${'b'.repeat(300)}|}`;
    const w = warnings(text);
    assert.equal(w.length, 1, data);
    assert.match(w[0], /300 caracteres.*255/);
    assert.equal(itemOf(text).data.length, 255);
    assert.deepEqual(warnings(`{${format}|}\n{${data};${'b'.repeat(255)}|}`), []);
  }
});

test('parse: a fully valid PC and PV with every optional parameter raise no warning', () => {
  assert.deepEqual(warnings('{PC001;0100,10000,10,05,J,+05,11,W0507,J0102,M1,+0000000001,Z05,P40500=HOLA|}'), []);
  assert.deepEqual(warnings('{PV01;0100,0200,0850,0020,A,-120,22,F9901,M2,-0000000010,Z20,P3=HOLA|}'), []);
});

// ---- Panel fields

test('panel: PV width / height offer 20..850 and the other limits follow the manuals', () => {
  const pvText = pv(',Z05,+0000000001,P40500', { spacing: '+05,' });
  const get = key => field(pvText, key);
  for (const key of ['width', 'height']) assert.deepEqual([get(key).min, get(key).max], [20, 850], key);
  assert.deepEqual([get('spacing').min, get('spacing').max], [-512, 512]);
  assert.deepEqual([get('zeroSuppress').min, get('zeroSuppress').max], [0, 20]);
  assert.deepEqual([get('counter').min, get('counter').max], [-9999999999, 9999999999]);
  assert.deepEqual([get('alignWidth').min, get('alignWidth').max], [50, 1057]);
  const pcText = pc(',W0507,J0102', { head: '10,10,S,' });
  const wText = `{PC00;0100,0200,10,10,S,+05,00,W0507,J0102=HOLA|}`;
  assert.deepEqual([field(wText, 'spacing').min, field(wText, 'spacing').max], [-99, 99]);
  for (const key of ['boldH', 'boldV']) assert.deepEqual([field(wText, key).min, field(wText, key).max], [0, 16], key);
  for (const key of ['attrH', 'attrV']) assert.deepEqual([field(wText, key).min, field(wText, key).max], [1, 99], key);
  assert.ok(pcText);
});

test('panel: writing a PV size outside 20..850 stores the nearest valid one', () => {
  const text = pv('');
  const item = parse(text).items[0];
  assert.match(tpcl.updateItem(text, item, { width: 5 }, { dpi: DPI }), /;0100,0200,0020,0120,/);
  assert.match(tpcl.updateItem(text, item, { height: 5000 }, { dpi: DPI }), /;0100,0200,0100,0850,B,/);
});

// ---- Emit and conversion

const SANS_BOLD = { size: 500, scaleX: 1, family: 'sans', weight: 700, style: 'normal' };
const MONO12 = { size: 12 * PB.units.UNITS_PER_POINT, scaleX: 1, family: 'mono', weight: 400, style: 'normal' };
const neutral = items => ({ language: 'neutral', size: { width: 1000, height: 600, pitch: 630, gap: 30, native: {} }, items, diagnostics: [] });
const textItem = (o = {}) => ({ kind: 'text', x: 100, y: 200, rotation: 0, font: SANS_BOLD, data: 'ABC', ...o });
const emit = (...items) => tpcl.emit(neutral(items), { dpi: DPI });
const warn = out => levels(out.diagnostics, 'warning');

test('emit: a PV text wider or taller than 0850 / narrower than 0020 is clamped and reported once with the range', () => {
  const out = emit(textItem({ font: { ...SANS_BOLD, size: 1200 } }), textItem({ font: { ...SANS_BOLD, size: 5 } }));
  assert.match(out.text, /\{PV00;0100,0200,0850,0850,B,00,B\|\}/);
  assert.match(out.text, /\{PV01;0100,0200,0020,0020,B,00,B\|\}/);
  const w = warn(out).filter(t => /0020\.\.0850/.test(t));
  assert.equal(w.length, 1);
});

test('emit: a PV text inside the range raises nothing', () => {
  assert.deepEqual(warn(emit(textItem())), []);
});

test('emit: spacing beyond +/-99 (PC) or +/-512 (PV) is clamped with one warning', () => {
  const bitmap = emit(textItem({ font: MONO12, spacing: { value: 0, native: 150 } }));
  assert.match(bitmap.text, /\{PC00;0100,0200,10,10,S,\+99,00,B\|\}/);
  assert.equal(warn(bitmap).filter(t => /espaciado.*±99.*±512/.test(t)).length, 1);
  const vector = emit(textItem({ spacing: { value: 0, native: -900 } }));
  assert.match(vector.text, /,B,-512,00,B/);
  assert.equal(warn(vector).filter(t => /espaciado/.test(t)).length, 1);
  assert.deepEqual(warn(emit(textItem({ spacing: { value: 0, native: 120 } }))), []);
});

test('emit: attribute offsets beyond 99 dots are clamped with one warning', () => {
  const out = emit(textItem({ font: MONO12, attribute: { kind: 'reverse', h: 1500, v: 25, native: { h: 5, v: 5 } } }));
  assert.match(out.text, /,00,W9920\|\}/);
  assert.equal(warn(out).filter(t => /desplazamientos del atributo.*01\.\.99/.test(t)).length, 1);
});

test('emit: bold shifts beyond 16 dots are clamped with one warning', () => {
  const out = emit(textItem({ font: MONO12, bold: { h: 1000, v: 0 } }));
  assert.match(out.text, /,B,J1600\|\}/);
  assert.equal(warn(out).filter(t => /negrita.*00\.\.16/.test(t)).length, 1);
});

test('emit: an equal-space width outside 0050..1057 is clamped with one warning', () => {
  const out = emit(textItem({ align: { kind: 'equal', width: 20 } }), textItem({ align: { kind: 'equal', width: 5000 } }));
  assert.match(out.text, /,P40050\|\}/);
  assert.match(out.text, /,P41057\|\}/);
  assert.equal(warn(out).filter(t => /0050\.\.1057/.test(t)).length, 1);
});

test('emit: zero suppression beyond 20 is clamped with one warning', () => {
  const out = emit(textItem({ zeroSuppress: 30 }));
  assert.match(out.text, /,B,Z20\|\}/);
  assert.equal(warn(out).filter(t => /ceros.*00\.\.20/.test(t)).length, 1);
});

test('emit: data over 255 characters is cut to 255 with one warning', () => {
  const out = emit(textItem({ data: 'x'.repeat(300) }));
  assert.match(out.text, new RegExp(`\\{RV00;${'x'.repeat(255)}\\|\\}`));
  assert.equal(warn(out).filter(t => /255/.test(t)).length, 1);
  assert.deepEqual(warn(emit(textItem({ data: 'x'.repeat(255) }))), []);
});

test('emit: more than 100 PV texts go beyond the PV numbers 00..99 and say so once', () => {
  const out = emit(...Array.from({ length: 101 }, () => textItem()));
  assert.equal(warn(out).filter(t => /PV.*00\.\.99/.test(t)).length, 1);
  assert.deepEqual(warn(emit(...Array.from({ length: 100 }, () => textItem()))), []);
});

// ---- Palette and PC -> PV switch

test('build: a new text takes a free PV number inside 00..99, and refuses when all 100 are used', () => {
  const all = n => Array.from({ length: 100 }, (_, i) => (i === n ? '' : `{PV${String(i).padStart(2, '0')};0100,0200,0100,0100,B,00,B|}`)).filter(Boolean).join('\n');
  const text = '{D0630,1000,0600|}\n{C|}\n';
  const gap = tpcl.buildComponent(text + all(50), 'text', { x: 100, y: 100 });
  assert.match(gap, /\{PV50;0100,0100,/);
  const full = tpcl.buildComponent(text + all(-1), 'text', { x: 100, y: 100 });
  assert.equal(full, text + all(-1));
});

test('panel: the PC -> PV switch clamps a size below 0020 and the note says so', () => {
  const small = `{PC00;0100,0200,05,05,G,00,B=A|}`;
  const item = parse(small).items[0];
  const note = field(small, 'fontType').note;
  assert.match(note, /0020\.\.0850/);
  const switched = tpcl.updateItem(small, item, { fontType: 'vector' }, { dpi: DPI });
  assert.match(switched, /\{PV00;0100,0200,0020,0020,B,/);
  assert.doesNotMatch(field(`{PC00;0100,0200,10,10,S,00,B=A|}`, 'fontType').note ?? '', /0020/);
});
