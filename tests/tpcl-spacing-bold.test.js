const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// TPCL character spacing and bold (text/tpcl.js, text/render.js, text/tspl.js): "ghh" of PC / "ghhh" of PV (a sign and a number of
// dots, right after the font letter) and "Jkkll" of PC (horizontal / vertical shift dots 00..16 of the bold overprint, after the
// attribute). Parsed into item.spacing = { value (0.1 mm, signed), native (dots as written) } and item.bold = { h, v (0.1 mm),
// native: { h, v } (dots) }, drawn (pure geometry in render.js), written back by emit and edited from the panel.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const DOT = PB.units.dotSize(203);

const parse = text => tpcl.parse(text, { dpi: 203 });
const itemsOf = text => parse(text).items;
const describe = (text, index = 0) => tpcl.describeItem(itemsOf(text)[index], text);
const field = (text, key, index = 0) => describe(text, index).fields.find(f => f.key === key);
const set = (text, changes, index = 0) => tpcl.updateItem(text, itemsOf(text)[index], changes, { dpi: 203 });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !~ ${expected}`);

// pc(spacing, tail): spacing is "" or "+05," ; tail is what follows the attribute
const pc = (spacing, tail = '') => `{PC001;0100,0200,10,05,J,${spacing}00,B${tail}=HOLA|}`;
const pv = (spacing, tail = '') => `{PV01;0100,0200,0100,0120,B,${spacing}00,B${tail}=HOLA|}`;

// --- Parsing

test('parse: no spacing, +00 and -00 leave item.spacing undefined', () => {
  for (const s of ['', '+00,', '-00,']) assert.equal(itemsOf(pc(s))[0].spacing, undefined, s);
});

test('parse: PC +hh / -hh: native keeps the signed dots, value is in 0.1 mm', () => {
  const plus = itemsOf(pc('+05,'))[0].spacing;
  assert.equal(plus.native, 5);
  near(plus.value, 5 * DOT);
  const minus = itemsOf(pc('-12,'))[0].spacing;
  assert.equal(minus.native, -12);
  near(minus.value, -12 * DOT);
});

test('parse: PV +hhh / -hhh (up to 512 dots)', () => {
  assert.equal(itemsOf(pv('+120,'))[0].spacing.native, 120);
  assert.equal(itemsOf(pv('-512,'))[0].spacing.native, -512);
});

test('parse: the spacing does not disturb rotation, attribute, alignment or data', () => {
  const item = itemsOf('{PC001;0100,0200,10,05,J,-03,11,W0507,P2=A,B|}')[0];
  assert.equal(item.spacing.native, -3);
  assert.equal(item.rotation, 90);
  assert.deepEqual(item.attribute.native, { h: 5, v: 7 });
  assert.deepEqual(item.align, { kind: 'center' });
  assert.equal(item.data, 'A,B');
});

test('parse: bold J kkll in PC, with attribute and alignment around it', () => {
  const item = itemsOf('{PC001;0100,0200,10,05,J,+03,11,W0507,J0102,M0,P3=HOLA|}')[0];
  assert.deepEqual(item.bold.native, { h: 1, v: 2 });
  near(item.bold.h, DOT);
  near(item.bold.v, 2 * DOT);
  assert.deepEqual(item.attribute.native, { h: 5, v: 7 });
  assert.deepEqual(item.align, { kind: 'right' });
  assert.equal(item.spacing.native, 3);
  assert.equal(item.data, 'HOLA');
});

test('parse: J0000 is kept as written, a missing or malformed J gives no bold, PV never reads one', () => {
  assert.deepEqual(itemsOf(pc('', ',J0000'))[0].bold.native, { h: 0, v: 0 });
  for (const tail of ['', ',J01', ',J01020', ',Jab12']) assert.equal(itemsOf(pc('', tail))[0].bold, undefined, tail);
  assert.equal(itemsOf(pv('', ',J0101'))[0].bold, undefined);
});

test('parse: the form with a separate RC/RV command and inline data', () => {
  const loose = itemsOf('{PC001;0100,0200,10,05,J,-04,00,B,J0808|}\n{RC001;DATOS|}')[0];
  assert.equal(loose.spacing.native, -4);
  assert.deepEqual(loose.bold.native, { h: 8, v: 8 });
  assert.equal(loose.data, 'DATOS');
  const pvLoose = itemsOf('{PV01;0100,0200,0100,0100,B,+010,00,B|}\n{RV01;X|}')[0];
  assert.equal(pvLoose.spacing.native, 10);
});

test('parse: M, n and Z parameters stay untouched and are not read as bold or spacing', () => {
  const item = itemsOf('{PC001;0100,0200,10,05,J,00,B,M1,+0000000005,Z02=HOLA|}')[0];
  assert.equal(item.bold, undefined);
  assert.equal(item.spacing, undefined);
  assert.equal(item.data, 'HOLA');
});

// --- Pure geometry

const spacingGeometry = PB.slices.text.spacingAttributes;
const boldShifts = PB.slices.text.boldShifts;

test('geometry: letter spacing is the signed spacing divided by the horizontal scale, none without spacing', () => {
  assert.equal(spacingGeometry(undefined, undefined, 1), null);
  assert.equal(spacingGeometry({ value: 0 }, undefined, 1), null);
  assert.equal(spacingGeometry({ value: 12 }, undefined, 1), 12);
  assert.equal(spacingGeometry({ value: -12 }, { kind: 'center' }, 1.5), -8);
  assert.equal(spacingGeometry({ value: 12 }, undefined, 0), null);
});

test('geometry: with equal space the spacing is ignored (manual: invalid)', () => {
  assert.equal(spacingGeometry({ value: 12 }, { kind: 'equal', width: 300 }, 1), null);
});

test('geometry: bold overprints shifted copies (horizontal, vertical, both) and nothing for 0/0 or no bold', () => {
  assert.deepEqual(boldShifts(undefined), []);
  assert.deepEqual(boldShifts({ h: 0, v: 0 }), []);
  assert.deepEqual(boldShifts({ h: 3, v: 0 }), [{ dx: 3, dy: 0 }]);
  assert.deepEqual(boldShifts({ h: 0, v: 4 }), [{ dx: 0, dy: 4 }]);
  assert.deepEqual(boldShifts({ h: 3, v: 4 }), [{ dx: 3, dy: 0 }, { dx: 0, dy: 4 }, { dx: 3, dy: 4 }]);
});

const ctx = { n: v => Number(v.toFixed(2)), esc: s => String(s), value: s => s, textScale: 1 };
const textItem = extra => ({ kind: 'text', x: 10, y: 20, rotation: 90, data: 'A', font: { size: 40, scaleX: 1, family: 'sans', weight: 400, style: 'normal' }, ...extra });
const render = item => PB.slices.text.render(item, ctx).markup;

test('render: letter-spacing appears only with a spacing (negative allowed) and bold adds one marked copy per shift', () => {
  assert.doesNotMatch(render(textItem()), /letter-spacing|text-bold/);
  assert.match(render(textItem({ spacing: { value: 12, native: 5 } })), /<text class="[^"]*" letter-spacing="12" transform=/);
  assert.match(render(textItem({ spacing: { value: -9, native: -4 } })), /letter-spacing="-9"/);
  const bold = render(textItem({ bold: { h: 3, v: 4, native: { h: 1, v: 2 } } }));
  assert.equal((bold.match(/<text /g) || []).length, 4);
  assert.equal((bold.match(/text-bold/g) || []).length, 3);
  assert.match(bold, /^<rect class="hit"\/><text class="font-sans"/);
  assert.match(bold, /rotate\(90\) translate\(3 4\) scale\(1 1\)/);
  assert.doesNotMatch(render(textItem({ bold: { h: 0, v: 0, native: { h: 0, v: 0 } } })), /text-bold/);
});

test('render: the copies repeat the alignment and the spacing of the text; the origin stays the anchor', () => {
  const markup = render(textItem({ align: { kind: 'right' }, spacing: { value: 6, native: 3 }, bold: { h: 3, v: 0, native: { h: 1, v: 0 } } }));
  assert.equal((markup.match(/text-anchor="end"/g) || []).length, 2);
  assert.equal((markup.match(/letter-spacing="6"/g) || []).length, 2);
  assert.deepEqual(PB.slices.text.render(textItem({ bold: { h: 3, v: 4 } }), ctx).anchor, [10, 20]);
});

// --- Emit

const emitModel = items => ({ language: 'tpcl', size: { width: 1000, height: 600, native: {} }, items, diagnostics: [] });
const bitmapFont = { size: 12 * PB.units.UNITS_PER_POINT, scaleX: 1, family: 'sans', weight: 700, style: 'normal' };
const outlineFont = { size: 80, scaleX: 1, family: 'sans', weight: 700, style: 'normal' };
const emitItem = extra => ({ kind: 'text', x: 100, y: 200, rotation: 0, data: 'HOLA', font: bitmapFont, ...extra });
const emitResult = extra => tpcl.emit(emitModel([emitItem(extra)]), { dpi: 203 });
const emitted = extra => emitResult(extra).text;

test('emit: no spacing or bold writes nothing extra; a spacing is written after the font letter with 2 (PC) or 3 (PV) digits', () => {
  assert.match(emitted(), /\{PC\d+;0100,0200,\d+,\d+,[A-Z],00,B\|\}/);
  assert.match(emitted({ spacing: { value: 5 * DOT, native: 5 } }), /,[A-Z],\+05,00,B\|\}/);
  assert.match(emitted({ spacing: { value: -5 * DOT, native: -5 } }), /,[A-Z],-05,00,B\|\}/);
  assert.match(emitted({ font: outlineFont, spacing: { value: 12 * DOT, native: 12 } }), /\{PV\d+;[^|]*,B,\+012,00,B\|\}/);
  assert.doesNotMatch(emitted({ spacing: { value: 0, native: 0 } }), /,[+-]\d/);
});

test('emit: the spacing is clamped to the range of the command and falls back to the value when there is no native', () => {
  assert.match(emitted({ spacing: { value: 500, native: 500 } }), /,\+99,00/);
  assert.match(emitted({ font: outlineFont, spacing: { value: 900, native: 900 } }), /,\+512,00/);
  assert.match(emitted({ font: outlineFont, spacing: { value: -900, native: -900 } }), /,-512,00/);
  assert.match(emitted({ spacing: { value: 10 * DOT } }), /,\+10,00/);
});

test('emit: bold J kkll goes after the attribute and before the alignment; PV has none (with one info)', () => {
  assert.match(emitted({ bold: { h: DOT, v: 2 * DOT, native: { h: 1, v: 2 } } }), /,00,B,J0102\|\}/);
  assert.match(emitted({ bold: { h: 0, v: 0, native: { h: 0, v: 0 } } }), /,00,B,J0000\|\}/);
  assert.match(emitted({ bold: { h: 3 * DOT, v: 3 * DOT, native: { h: 3, v: 3 } }, align: { kind: 'center' }, attribute: { kind: 'reverse', h: 5, v: 5, native: { h: 5, v: 7 } } }), /,W\d{4},J0303,P2\|\}/);
  assert.match(emitted({ bold: { h: 40, v: 40, native: { h: 40, v: 40 } } }), /,J1616\|\}/);
  const pvResult = emitResult({ font: outlineFont, bold: { h: 3, v: 3, native: { h: 3, v: 3 } } });
  assert.doesNotMatch(pvResult.text, /,J\d{4}/);
  assert.equal(pvResult.diagnostics.filter(d => /negrita/i.test(d.text)).length, 1);
});

test('emit: round trip through parse keeps spacing and bold (PC and PV)', () => {
  const pcItem = itemsOf(emitted({ spacing: { value: -7 * DOT, native: -7 }, bold: { h: 2 * DOT, v: 3 * DOT, native: { h: 2, v: 3 } }, align: { kind: 'right' } }))[0];
  assert.equal(pcItem.spacing.native, -7);
  assert.deepEqual(pcItem.bold.native, { h: 2, v: 3 });
  assert.deepEqual(pcItem.align, { kind: 'right' });
  assert.equal(itemsOf(emitted({ font: outlineFont, spacing: { value: 33 * DOT, native: 33 } }))[0].spacing.native, 33);
  const plain = itemsOf(emitted())[0];
  assert.equal(plain.spacing, undefined);
  assert.equal(plain.bold, undefined);
});

test('emit: a parsed label with spacing and bold survives parse -> emit -> parse', () => {
  const src = '{D0500,0400,0400|}\n{C|}\n{PC001;0100,0200,10,10,J,+04,00,F0305,J0507,P2|}\n{RC001;HOLA|}\n{PV01;0100,0300,0100,0100,B,-010,00,B|}\n{RV01;X|}\n{XS;I,0001,0002C4100|}';
  const items = parse(tpcl.emit(parse(src), { dpi: 203 }).text).items;
  assert.equal(items[0].spacing.native, 4);
  assert.deepEqual(items[0].bold.native, { h: 5, v: 7 });
  assert.deepEqual(items[0].attribute.native, { h: 3, v: 5 });
  assert.equal(items[1].spacing.native, -10);
});

// --- describeItem / updateItem

test('describe: spacing is a number field (PC -99..99, PV -512..512) and bold only exists for PC (0..16)', () => {
  const s = field(pc('+05,'), 'spacing');
  assert.deepEqual([s.type, s.label, s.value, s.min, s.max], ['number', 'Espaciado entre caracteres', 5, -99, 99]);
  assert.deepEqual([field(pv('-100,'), 'spacing').value, field(pv('-100,'), 'spacing').min, field(pv('-100,'), 'spacing').max], [-100, -512, 512]);
  assert.equal(field(pc(''), 'spacing').value, 0);
  const [h, v] = [field(pc('', ',J0102'), 'boldH'), field(pc('', ',J0102'), 'boldV')];
  assert.deepEqual([h.type, h.label, h.value, h.min, h.max], ['number', 'Negrita horizontal', 1, 0, 16]);
  assert.deepEqual([v.label, v.value, v.min, v.max], ['Negrita vertical', 2, 0, 16]);
  assert.equal(field(pc(''), 'boldH').value, 0);
  assert.equal(field(pv(''), 'boldH'), undefined);
  assert.equal(field(pv(''), 'boldV'), undefined);
});

test('describe: with and without the command text the fields are the same', () => {
  for (const [text, keys] of [[pc(''), ['spacing', 'boldH', 'boldV']], [pc('-07,', ',J0102,P2'), ['spacing', 'boldH', 'boldV']], [pv('+020,'), ['spacing']], [pv(''), ['spacing']]]) {
    const item = itemsOf(text)[0];
    const [withText, withoutText] = [tpcl.describeItem(item, text), tpcl.describeItem(item)];
    for (const key of keys) assert.deepEqual(withText.fields.find(f => f.key === key), withoutText.fields.find(f => f.key === key), `${text} ${key}`);
  }
});

test('update: setting the spacing on an absent token inserts only ±hh (PC) / ±hhh (PV) after the font letter', () => {
  assert.equal(set(pc(''), { spacing: 5 }), pc('+05,'));
  assert.equal(set(pc(''), { spacing: -5 }), pc('-05,'));
  assert.equal(set(pv(''), { spacing: 12 }), pv('+012,'));
  assert.equal(set(pv(''), { spacing: -300 }), pv('-300,'));
  assert.equal(set('{PC001;0100,0200,10,05,J,11,W0507,J0101,P2|}\n{RC001;HOLA|}', { spacing: 3 }), '{PC001;0100,0200,10,05,J,+03,11,W0507,J0101,P2|}\n{RC001;HOLA|}');
});

test('update: changing an existing token rewrites only it and keeps its width and its comma', () => {
  assert.equal(set(pc('+05,'), { spacing: -9 }), pc('-09,'));
  assert.equal(set(pc('-05,'), { spacing: 40 }), pc('+40,'));
  assert.equal(set(pv('+012,'), { spacing: 7 }), pv('+007,'));
  assert.equal(set(pv('+012,'), { spacing: 450 }), pv('+450,'));
  assert.equal(set(pc('+05,'), { spacing: 0 }), pc('+00,'));
});

test('update: an absent spacing set to 0 writes nothing', () => {
  assert.equal(set(pc(''), { spacing: 0 }), pc(''));
  assert.equal(set(pv(''), { spacing: 0 }), pv(''));
});

test('update: the spacing is rounded and clamped to the range of the command', () => {
  assert.equal(set(pc(''), { spacing: 500 }), pc('+99,'));
  assert.equal(set(pc(''), { spacing: -500 }), pc('-99,'));
  assert.equal(set(pv(''), { spacing: 900 }), pv('+512,'));
  assert.equal(set(pv(''), { spacing: -900 }), pv('-512,'));
  assert.equal(set(pc(''), { spacing: 4.6 }), pc('+05,'));
});

test('update: invalid spacing values leave the text unchanged', () => {
  for (const v of ['a', NaN, null, undefined, Infinity]) assert.equal(set(pc('+05,'), { spacing: v }), pc('+05,'), String(v));
});

test('update: bold inserts J kkll between the attribute and the other parameters, in the right slot', () => {
  assert.equal(set(pc(''), { boldH: 3 }), pc('', ',J0300'));
  assert.equal(set(pc(''), { boldV: 4 }), pc('', ',J0004'));
  assert.equal(set(pc(''), { boldH: 3, boldV: 4 }), pc('', ',J0304'));
  assert.equal(set(pc('', ',M1,Z02'), { boldH: 2, boldV: 2 }), pc('', ',J0202,M1,Z02'));
  assert.equal(set(pc('', ',P2'), { boldH: 2, boldV: 2 }), pc('', ',J0202,P2'));
  assert.equal(set(pc('', ',Z02'), { boldH: 2, align: 'right' }), pc('', ',J0200,Z02,P3'));
  assert.equal(set('{PC001;0100,0200,10,05,J,00,W0507|}\n{RC001;X|}', { boldH: 1 }), '{PC001;0100,0200,10,05,J,00,W0507,J0100|}\n{RC001;X|}');
});

test('update: changing one bold value keeps the other; both zero keep an existing J0000 and write nothing otherwise', () => {
  assert.equal(set(pc('', ',J0102'), { boldH: 9 }), pc('', ',J0902'));
  assert.equal(set(pc('', ',J0102'), { boldV: 0 }), pc('', ',J0100'));
  assert.equal(set(pc('', ',J0102,P2'), { boldH: 0, boldV: 0 }), pc('', ',J0000,P2'));
  assert.equal(set(pc('', ',J0100'), { boldH: 0 }), pc('', ',J0000'));
  assert.equal(set(pc(''), { boldH: 0, boldV: 0 }), pc(''));
  assert.equal(set(pc(''), { boldH: 0 }), pc(''));
});

test('update: bold values are rounded and clamped to 0..16; invalid ones change nothing; PV has no bold', () => {
  assert.equal(set(pc(''), { boldH: 99, boldV: -4 }), pc('', ',J1600'));
  assert.equal(set(pc('', ',J0102'), { boldH: 3.6 }), pc('', ',J0402'));
  for (const v of ['a', NaN, null]) assert.equal(set(pc('', ',J0102'), { boldH: v, boldV: v }), pc('', ',J0102'), String(v));
  assert.equal(set(pv(''), { boldH: 3, boldV: 3 }), pv(''));
});

test('update: spacing, bold, attribute, alignment and rotation can change together without touching each other', () => {
  const text = '{PC001;0100,0200,10,05,J,00,W0507,J0102,P2=HOLA|}';
  assert.equal(set(text, { spacing: -3, boldH: 6, attrH: 9, align: 'right', rotation: 90 }), '{PC001;0100,0200,10,05,J,-03,11,W0907,J0602,P3=HOLA|}');
  assert.equal(set('{PC001;0100,0200,10,05,J,00,B=HOLA|}', { spacing: 2, rotation: 90, boldV: 1, align: 'center', font: 'A' }), '{PC001;0100,0200,10,05,A,+02,11,B,J0001,P2=HOLA|}');
});

test('update: the rest of the command, the data command and other items are kept (CRLF and LF)', () => {
  for (const eol of ['\r\n', '\n']) {
    const text = `{D0500,0400,0400|}${eol}{PC001;0100,0200,10,05,J,+03,11,W0507,J0101,Z02|}${eol}{RC001;HOLA|}${eol}{PV01;0100,0300,0100,0100,B,00,B,P2=X|}${eol}`;
    assert.equal(set(text, { spacing: -8, boldV: 5 }), text.replace(',+03,', ',-08,').replace('J0101', 'J0105'));
    assert.equal(set(text, { spacing: 20 }, 1), text.replace('B,00,B,P2=X', 'B,+020,00,B,P2=X'));
    assert.equal(set(text, { spacing: 20, content: 'ZZ' }, 1), text.replace('B,00,B,P2=X', 'B,+020,00,B,P2=ZZ'));
  }
});

test('update: the line-broken command keeps its breaks around an inserted spacing', () => {
  const text = '{PC001;0100,0200,10,05,J,\r\n00,B=HOLA|}';
  assert.equal(set(text, { spacing: 4 }), '{PC001;0100,0200,10,05,J,\r\n+04,00,B=HOLA|}');
});

test('palette: a new text has no spacing or bold', () => {
  const built = tpcl.buildComponent('', 'text', { x: 100, y: 100 }, { dpi: 203 });
  const item = itemsOf(built)[0];
  assert.equal(item.spacing, undefined);
  assert.equal(item.bold, undefined);
  assert.equal(field(built, 'spacing').value, 0);
});

// --- Cross conversion: TSPL TEXT has neither

test('TSPL: a text with spacing or bold is written plain with one info for each, plain texts with none', () => {
  const tspl = PB.languages.get('tspl');
  const item = (extra, data) => ({ kind: 'text', x: 100, y: 100, rotation: 0, data, font: { size: 80, scaleX: 1, family: 'sans', weight: 400, style: 'normal' }, ...extra });
  const out = tspl.emit(emitModel([item({ spacing: { value: 5, native: 2 } }, 'A'), item({ spacing: { value: 7, native: 3 } }, 'B'), item({ bold: { h: 1, v: 1, native: { h: 1, v: 1 } } }, 'C'), item({}, 'D')]), { dpi: 203 });
  assert.equal(out.diagnostics.filter(d => /entre caracteres/i.test(d.text)).length, 1);
  assert.equal(out.diagnostics.filter(d => /negrita/i.test(d.text)).length, 1);
  assert.ok(out.diagnostics.filter(d => /entre caracteres|negrita/i.test(d.text)).every(d => d.level === 'info'));
  assert.equal(out.text.split('\n').filter(l => l.startsWith('TEXT')).length, 4);
  const plain = tspl.emit(emitModel([item({}, 'D')]), { dpi: 203 });
  assert.equal(plain.diagnostics.filter(d => /entre caracteres|negrita/i.test(d.text)).length, 0);
});

test('convert: a TPCL label with spacing and bold converted to TSPL keeps the text', () => {
  const src = '{D0500,0400,0400|}\n{C|}\n{PC001;0100,0200,10,10,J,+04,00,B,J0101=HOLA|}\n{PV01;0100,0300,0100,0100,B,-010,00,B=ADIOS|}\n{XS;I,0001,0002C4100|}';
  const result = PB.convert.run(src, 'tspl', { dpi: 203 });
  assert.equal(result.diagnostics.filter(d => /entre caracteres|negrita/i.test(d.text)).length, 2);
  assert.match(result.text, /"HOLA"/);
  assert.match(result.text, /"ADIOS"/);
});
