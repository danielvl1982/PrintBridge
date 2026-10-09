const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// TPCL text alignment (text/tpcl.js, text/render.js, text/tspl.js): the "Pq" option of PC / "Po" of PV is P1 (left, the default),
// P2 (center), P3 (right) or P4aaaa (equal space over a string area aaaa wide, 0050..1057 in 0.1 mm). It is parsed into
// item.align = { kind, width? } (absent = left), drawn through text-anchor / textLength (pure geometry in render.js), written
// back by emit and edited from the panel. The other optional parameters (J, M, n, Z) are never interpreted, only kept.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');

const parse = text => tpcl.parse(text, { dpi: 203 });
const itemsOf = text => parse(text).items;
const alignOf = (text, index = 0) => itemsOf(text)[index].align;
const describe = (text, index = 0) => tpcl.describeItem(itemsOf(text)[index], text);
const field = (text, key, index = 0) => describe(text, index).fields.find(f => f.key === key);
const set = (text, changes, index = 0) => tpcl.updateItem(text, itemsOf(text)[index], changes, { dpi: 203 });

const pc = tail => `{PC001;0100,0200,10,05,J,00,B${tail}=HOLA|}`;
const pv = tail => `{PV01;0100,0200,0100,0120,B,00,B${tail}=HOLA|}`;

// --- Parsing

test('parse: no P option, P1 and malformed values leave item.align undefined (left)', () => {
  for (const tail of ['', ',P1', ',P5', ',P4', ',P412', ',P', ',PX']) assert.equal(alignOf(pc(tail)), undefined, tail);
});

test('parse: P2 is center, P3 right, P4aaaa equal space with the area width in 0.1 mm', () => {
  assert.deepEqual(alignOf(pc(',P2')), { kind: 'center' });
  assert.deepEqual(alignOf(pc(',P3')), { kind: 'right' });
  assert.deepEqual(alignOf(pc(',P40300')), { kind: 'equal', width: 300 });
  assert.deepEqual(alignOf(pv(',P2')), { kind: 'center' });
  assert.deepEqual(alignOf(pv(',P41057')), { kind: 'equal', width: 1057 });
});

test('parse: the P option is found among the other optional parameters (J, M, n, Z) and after a W/F/C attribute', () => {
  assert.deepEqual(alignOf(pc(',J0101,M0,+0000000001,Z05,P3')), { kind: 'right' });
  assert.deepEqual(alignOf(pc(',J0101,P2,Z05')), { kind: 'center' });
  assert.deepEqual(alignOf('{PC001;0100,0200,10,05,J,00,W0507,P40200,Z03=HOLA|}'), { kind: 'equal', width: 200 });
  assert.deepEqual(alignOf('{PC001;0100,0200,10,05,J,+03,11,C05,M1,P2=HOLA|}'), { kind: 'center' });
  // Other parameters never turn into an alignment
  assert.equal(alignOf(pc(',J0101,M2,-0000000005,Z02')), undefined);
});

test('parse: the data, with or without =, and the attribute are not disturbed by the option', () => {
  const item = itemsOf('{PC001;0100,0200,10,05,J,00,W0507,P2=A,P3=B|}')[0];
  assert.equal(item.data, 'A,P3=B');
  assert.deepEqual(item.align, { kind: 'center' });
  assert.deepEqual(item.attribute.native, { h: 5, v: 7 });
  const loose = itemsOf('{PC001;0100,0200,10,05,J,00,B,P3|}\n{RC001;DATOS,P2|}')[0];
  assert.deepEqual(loose.align, { kind: 'right' });
  assert.equal(loose.data, 'DATOS,P2');
});

test('parse: an RC/RV data command with its own text does not change the alignment of its format command', () => {
  const items = itemsOf('{PV01;0100,0200,0100,0100,B,00,B,P2|}\n{RV01;HOLA|}\n{PV02;0100,0300,0100,0100,B,00,B|}\n{RV02;X|}');
  assert.deepEqual(items[0].align, { kind: 'center' });
  assert.equal(items[1].align, undefined);
});

// --- Pure geometry

const geometry = PB.slices.text.alignAttributes;

test('geometry: left (or no alignment) anchors at the start, center in the middle, right at the end', () => {
  assert.deepEqual(geometry(undefined, 1), { anchor: 'start' });
  assert.deepEqual(geometry({ kind: 'left' }, 1), { anchor: 'start' });
  assert.deepEqual(geometry({ kind: 'center' }, 1), { anchor: 'middle' });
  assert.deepEqual(geometry({ kind: 'right' }, 1), { anchor: 'end' });
  assert.deepEqual(geometry({ kind: 'weird' }, 1), { anchor: 'start' });
});

test('geometry: equal space stretches the string over the area (in the text own frame, so divided by the horizontal scale)', () => {
  assert.deepEqual(geometry({ kind: 'equal', width: 300 }, 1), { anchor: 'start', textLength: 300 });
  assert.deepEqual(geometry({ kind: 'equal', width: 300 }, 1.5), { anchor: 'start', textLength: 200 });
  assert.deepEqual(geometry({ kind: 'equal' }, 1), { anchor: 'start' });
  assert.deepEqual(geometry({ kind: 'equal', width: 300 }, 0), { anchor: 'start' });
});

const ctx = { n: v => Number(v.toFixed(2)), esc: s => String(s), value: s => s, textScale: 1 };
const textItem = extra => ({ kind: 'text', x: 10, y: 20, rotation: 90, data: 'A', font: { size: 40, scaleX: 1, family: 'sans', weight: 400, style: 'normal' }, ...extra });

test('render: the text element carries the anchor and the stretch, and a left text carries none', () => {
  const render = item => PB.slices.text.render(item, ctx).markup;
  assert.doesNotMatch(render(textItem()), /text-anchor|textLength/);
  assert.match(render(textItem({ align: { kind: 'center' } })), /<text class="[^"]*" text-anchor="middle" transform=/);
  assert.match(render(textItem({ align: { kind: 'right' } })), /text-anchor="end"/);
  const equal = render(textItem({ align: { kind: 'equal', width: 300 } }));
  assert.match(equal, /textLength="300" lengthAdjust="spacing"/);
  assert.doesNotMatch(equal, /text-anchor/);
  assert.match(render(textItem({ align: { kind: 'equal', width: 300 }, font: { ...textItem().font, scaleX: 1.5 } })), /textLength="200"/);
});

test('render: the origin of the item stays the anchor of the drawing for every alignment', () => {
  for (const kind of ['left', 'center', 'right']) assert.deepEqual(PB.slices.text.render(textItem({ align: { kind } }), ctx).anchor, [10, 20]);
});

// --- Emit

const emitModel = items => ({ language: 'tpcl', size: { width: 1000, height: 600, native: {} }, items, diagnostics: [] });
const emitItem = extra => ({ kind: 'text', x: 100, y: 200, rotation: 0, data: 'HOLA', font: { size: 80, scaleX: 1, family: 'sans', weight: 700, style: 'normal' }, ...extra });
const emitted = extra => tpcl.emit(emitModel([emitItem(extra)]), { dpi: 203 }).text;

test('emit: left or no alignment writes nothing, center/right/equal write ,P2 ,P3 ,P4aaaa after the attribute', () => {
  assert.doesNotMatch(emitted(), /,P\d/);
  assert.doesNotMatch(emitted({ align: { kind: 'left' } }), /,P\d/);
  assert.match(emitted({ align: { kind: 'center' } }), /,B,P2\|\}/);
  assert.match(emitted({ align: { kind: 'right' } }), /,B,P3\|\}/);
  assert.match(emitted({ align: { kind: 'equal', width: 300 } }), /,B,P40300\|\}/);
  assert.match(emitted({ align: { kind: 'center' }, attribute: { kind: 'reverse', h: 5, v: 5, native: { h: 5, v: 7 } } }), /,W\d{4},P2\|\}/);
});

test('emit: the equal space width is clamped to 50..1057 and defaults when missing', () => {
  assert.match(emitted({ align: { kind: 'equal', width: 10 } }), /,P40050\|\}/);
  assert.match(emitted({ align: { kind: 'equal', width: 5000 } }), /,P41057\|\}/);
  assert.match(emitted({ align: { kind: 'equal' } }), /,P40500\|\}/);
});

test('emit: round trip through parse keeps the alignment', () => {
  for (const align of [{ kind: 'center' }, { kind: 'right' }, { kind: 'equal', width: 300 }]) {
    assert.deepEqual(alignOf(emitted({ align })), align);
  }
  assert.equal(alignOf(emitted()), undefined);
});

test('emit: the PC form (bitmap font) writes the alignment too', () => {
  const text = emitted({ font: { size: 12 * PB.units.UNITS_PER_POINT, scaleX: 1, family: 'sans', weight: 700, style: 'normal' }, align: { kind: 'right' } });
  assert.match(text, /\{PC\d+;[^|]*,B,P3\|\}/);
});

// --- describeItem / updateItem

test('describe: align is a select over the four kinds (left when omitted) and alignWidth only appears for equal space', () => {
  const f = field(pc(''), 'align');
  assert.equal(f.type, 'select');
  assert.equal(f.label, 'Alineación');
  assert.deepEqual(f.options.map(o => o.value), ['left', 'center', 'right', 'equal']);
  assert.equal(f.value, 'left');
  assert.equal(field(pc(''), 'alignWidth'), undefined);
  assert.equal(field(pc(',P1'), 'align').value, 'left');
  assert.equal(field(pc(',P2'), 'align').value, 'center');
  assert.equal(field(pv(',P3'), 'align').value, 'right');
  assert.equal(field(pc(',P2'), 'alignWidth'), undefined);
  const w = field(pc(',Z05,P40300'), 'alignWidth');
  assert.equal(field(pc(',Z05,P40300'), 'align').value, 'equal');
  assert.deepEqual([w.type, w.value, w.min, w.max, w.label], ['number', 300, 50, 1057, 'Ancho del área']);
});

test('describe: with and without the command text the fields are the same', () => {
  for (const tail of ['', ',P2', ',J0101,M0,P3', ',P40300', ',Z02,P41057']) {
    const item = itemsOf(pc(tail))[0];
    const [withText, withoutText] = [tpcl.describeItem(item, pc(tail)), tpcl.describeItem(item)];
    for (const key of ['align', 'alignWidth']) {
      assert.deepEqual(withText.fields.find(f => f.key === key), withoutText.fields.find(f => f.key === key), `${tail} ${key}`);
    }
  }
});

test('update: changing the kind inserts the token after the other optional parameters, before the data', () => {
  assert.equal(set(pc(''), { align: 'center' }), pc(',P2'));
  assert.equal(set(pc(',J0101,M0,Z05'), { align: 'right' }), pc(',J0101,M0,Z05,P3'));
  assert.equal(set(pv(''), { align: 'center' }), pv(',P2'));
  assert.equal(set('{PC001;0100,0200,10,05,J,+03,11,W0507,J0101|}\n{RC001;HOLA|}', { align: 'right' }), '{PC001;0100,0200,10,05,J,+03,11,W0507,J0101,P3|}\n{RC001;HOLA|}');
  assert.equal(set('{PC001;0100,0200,10,05,J,00,B|}', { align: 'center' }), '{PC001;0100,0200,10,05,J,00,B,P2|}');
});

test('update: changing an existing token rewrites only it, equal space gets its width', () => {
  assert.equal(set(pc(',J0101,P2,Z05'), { align: 'right' }), pc(',J0101,P3,Z05'));
  assert.equal(set(pc(',P3'), { align: 'center' }), pc(',P2'));
  assert.equal(set(pc(',P2'), { align: 'equal', alignWidth: 400 }), pc(',P40400'));
  assert.equal(set(pc(''), { align: 'equal', alignWidth: 400 }), pc(',P40400'));
  assert.equal(set(pc(',P2'), { align: 'equal' }), pc(',P40500'));
  assert.equal(set(pc(',P40300'), { align: 'equal' }), pc(',P40300'));
  assert.equal(set(pc(',P40300'), { align: 'right' }), pc(',P3'));
});

test('update: the width of an equal space is clamped to 50..1057 and written with 4 digits', () => {
  assert.equal(set(pc(',P40300'), { alignWidth: 640 }), pc(',P40640'));
  assert.equal(set(pc(',P40300'), { alignWidth: 20 }), pc(',P40050'));
  assert.equal(set(pc(',P40300'), { alignWidth: 5000 }), pc(',P41057'));
  assert.equal(set(pc(',P40300'), { alignWidth: 99.6 }), pc(',P40100'));
});

test('update: left keeps an explicit P1, removes nothing it did not write and an absent token stays absent', () => {
  assert.equal(set(pc(',P2'), { align: 'left' }), pc(',P1'));
  assert.equal(set(pc(',P40300'), { align: 'left' }), pc(',P1'));
  assert.equal(set(pc(',P1'), { align: 'left' }), pc(',P1'));
  assert.equal(set(pc(''), { align: 'left' }), pc(''));
});

test('update: invalid values and a width on a non-equal alignment leave the text unchanged', () => {
  for (const changes of [{ align: 'X' }, { align: 5 }, { align: null }, { alignWidth: 'a' }, { alignWidth: NaN }]) {
    assert.equal(set(pc(',P40300'), changes), pc(',P40300'), JSON.stringify(changes));
  }
  assert.equal(set(pc(',P2'), { alignWidth: 400 }), pc(',P2'));
  assert.equal(set(pc(''), { alignWidth: 400 }), pc(''));
});

test('update: the rest of the command, the attribute, the data command and other items are kept (CRLF and LF)', () => {
  for (const eol of ['\r\n', '\n']) {
    const text = `{D0500,0400,0400|}${eol}{PC001;0100,0200,10,05,J,+03,11,W0507,J0101,Z02|}${eol}{RC001;HOLA|}${eol}{PV01;0100,0300,0100,0100,B,00,B,P2=X|}${eol}`;
    assert.equal(set(text, { align: 'right' }), text.replace(',Z02|}', ',Z02,P3|}'));
    assert.equal(set(text, { align: 'right', attribute: 'box' }), text.replace(',Z02|}', ',Z02,P3|}').replace('W0507', 'F0507'));
    assert.equal(set(text, { align: 'equal', alignWidth: 250 }, 1), text.replace(',P2=X', ',P40250=X'));
    assert.equal(set(text, { align: 'left', content: 'ZZ' }, 1), text.replace(',P2=X', ',P1=ZZ'));
  }
});

test('update: the attribute offsets and the alignment can change together without touching each other', () => {
  assert.equal(set(pc(',P2').replace('B,P2', 'W0507,P2'), { attrH: 9, align: 'right' }), pc(',P3').replace('B,P3', 'W0907,P3'));
});

test('palette: a new text still has no alignment', () => {
  const built = tpcl.buildComponent('', 'text', { x: 100, y: 100 }, { dpi: 203 });
  assert.equal(itemsOf(built)[0].align, undefined);
  assert.equal(field(built, 'align').value, 'left');
});

// --- Cross conversion: TSPL TEXT has no alignment argument

test('TSPL: an aligned text is written left with one info, left texts with none', () => {
  const tspl = PB.languages.get('tspl');
  const item = (align, data) => ({ kind: 'text', x: 100, y: 100, rotation: 0, data, font: { size: 80, scaleX: 1, family: 'sans', weight: 400, style: 'normal' }, ...(align && { align }) });
  const model = items => ({ language: 'tpcl', size: { width: 1000, height: 600, native: {} }, items, diagnostics: [] });
  const out = tspl.emit(model([item({ kind: 'center' }, 'A'), item({ kind: 'right' }, 'B'), item({ kind: 'equal', width: 300 }, 'C'), item(null, 'D')]), { dpi: 203 });
  const infos = out.diagnostics.filter(d => /alineaci/i.test(d.text));
  assert.equal(infos.length, 1);
  assert.equal(infos[0].level, 'info');
  assert.equal(out.text.split('\n').filter(l => l.startsWith('TEXT')).length, 4);
  assert.equal(tspl.emit(model([item(null, 'D'), item({ kind: 'left' }, 'E')]), { dpi: 203 }).diagnostics.filter(d => /alineaci/i.test(d.text)).length, 0);
});

test('convert: a TPCL label with alignment converted to TSPL keeps the text and says it once', () => {
  const src = '{D0500,0400,0400|}\n{C|}\n{PC001;0100,0200,10,10,J,00,B,P2=HOLA|}\n{PV01;0100,0300,0100,0100,B,00,B,P40300=ADIOS|}\n{XS;I,0001,0002C4100|}';
  const result = PB.convert.run(src, 'tspl', { dpi: 203 });
  assert.equal(result.diagnostics.filter(d => /alineaci/i.test(d.text)).length, 1);
  assert.match(result.text, /"HOLA"/);
  assert.match(result.text, /"ADIOS"/);
});
