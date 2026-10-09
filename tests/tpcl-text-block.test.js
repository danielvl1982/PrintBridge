const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// TPCL text block (text/tpcl.js): the PC option "P5aaaabbbcc" (automatic line feed) = aaaa width of the string area (0050..1040, 0.1 mm), bbb line feed
// spacing (010..500; UNVERIFIED unit, taken as 0.1 mm) and cc number of lines (01..99). It is read into the neutral item.block (the same one TSPL BLOCK and
// ZPL ^FB use), drawn with the shared word wrap, written back by emit and edited from the panel through the Tipo select (line <-> block) and three fields.
// PV (outline font) has no such option; the rotations 01 / 12 / 23 / 30 (which the viewer does not support) make the printer ignore it.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const zpl = PB.languages.get('zpl');

const DPI = 203;
const parse = text => tpcl.parse(text, { dpi: DPI });
const itemsOf = text => parse(text).items;
const describe = (text, index = 0) => tpcl.describeItem(itemsOf(text)[index], text);
const field = (text, key, index = 0) => describe(text, index).fields.find(f => f.key === key);
const keys = (text, index = 0) => describe(text, index).fields.map(f => f.key);
const set = (text, changes, index = 0) => tpcl.updateItem(text, itemsOf(text)[index], changes, { dpi: DPI });
const levels = (diagnostics, level) => diagnostics.filter(d => d.level === level).map(d => d.text);

// S is the bitmap font of 12 pt mono: at magnification 1.0 the neutral mono 12 pt font is exactly PC font S
const PC = tail => `{PC001;0100,0200,10,10,S,00,B${tail}=alpha beta gamma delta epsilon|}`;
const PV = tail => `{PV01;0100,0200,0100,0120,B,00,B${tail}=alpha beta|}`;

// ---- Parsing

test('parse: P5aaaabbbcc is a block with width and line space in 0.1 mm, the lines, no alignment, and the digits as written in native', () => {
  const [item] = itemsOf(PC(',P5030002003'));
  assert.deepEqual(item.block, { width: 300, lines: 3, align: 'left', lineSpace: 20 });
  assert.deepEqual(item.native, { block: { width: 300, space: 20, lines: 3 }, hMag: '10', vMag: '10' });
  assert.equal(item.align, undefined);
  assert.equal(item.data, 'alpha beta gamma delta epsilon');
});

test('parse: the block is found among the other optional parameters (J, M, n, Z) and with a rotation', () => {
  assert.equal(itemsOf(PC(',J0101,M0,+0000000001,Z05,P5010000501'))[0].block.lines, 1);
  const rotated = itemsOf('{PC001;0100,0200,10,10,S,11,B,P5030002003=abc|}')[0];
  assert.equal(rotated.rotation, 90);
  assert.equal(rotated.block.width, 300);
});

test('parse: cc = 00 is a block without a line limit; a value out of range is read as written with one warning', () => {
  const unlimited = parse(PC(',P5030002000'));
  assert.equal(unlimited.items[0].block.lines, undefined);
  assert.equal(levels(unlimited.diagnostics, 'warning').length, 1);
  const wide = parse(PC(',P5200000103'));
  assert.equal(wide.items[0].block.width, 2000);
  assert.match(levels(wide.diagnostics, 'warning')[0], /P5 fuera de rango/);
  assert.deepEqual(levels(parse(PC(',P5030002003')).diagnostics, 'warning'), []);
});

test('parse: with a rotation 01 / 12 / 23 / 30 the printer ignores the block: a line, with one info', () => {
  const model = parse('{PC001;0100,0200,10,10,S,01,B,P5030002003=abc|}');
  assert.equal(model.items[0].block, undefined);
  assert.equal(levels(model.diagnostics, 'info').filter(t => /ignora el salto de línea automático/.test(t)).length, 1);
});

test('parse: PV has no automatic line feed: P5 on an outline text stays a line', () => {
  assert.equal(itemsOf(PV(',P5030002003'))[0].block, undefined);
  assert.equal(itemsOf(PC(',P2'))[0].block, undefined);
  assert.equal(itemsOf(PC(',P2'))[0].align.kind, 'center');
});

// ---- Drawing

test('render: a PC block wraps in its width and advances by the character height plus the line feed spacing', () => {
  const [item] = itemsOf(PC(',P5030002003'));
  const { wrapBlock } = PB.slices.text;
  const wrapped = wrapBlock(item.data, item.block, item.font);
  assert.ok(wrapped.lines.length > 1 && wrapped.lines.length <= 3);
  assert.equal(wrapped.pitch, item.font.size + 20);
  const model = parse(`{D0630,1000,0600|}\n{C|}\n${PC(',P5030002003')}`);
  const svg = PB.svgRenderer.render(model, PB.sizes.view(model, null), { textScale: 1, showGrid: false, showAnchors: false, values: {} }).svg;
  assert.ok((svg.match(/<tspan /g) || []).length >= 2);
});

// ---- Emit and conversion

const MONO12 = { size: 12 * PB.units.UNITS_PER_POINT, scaleX: 1, family: 'mono', weight: 400, style: 'normal' };
const neutral = (items, size = { width: 1000, height: 600, pitch: 630, gap: 30, native: {} }) => ({ language: 'neutral', size, items, diagnostics: [] });
const textItem = (o = {}) => ({ kind: 'text', x: 100, y: 200, rotation: 0, font: MONO12, data: 'alpha beta gamma', ...o });
const emit = items => tpcl.emit(neutral(items), { dpi: DPI });

test('emit: a block with a bitmap font is PC ...,P5aaaabbbcc (the model values in 0.1 mm), with the data in RC and the unit information', () => {
  const out = emit([textItem({ block: { width: 300, lines: 3, align: 'left', lineSpace: 20 } })]);
  assert.match(out.text, /\{PC00;0100,0200,1,1,S,00,B,P5030002003\|\}\n\{RC00;alpha beta gamma\|\}/);
  assert.deepEqual(levels(out.diagnostics, 'warning'), []);
  assert.ok(levels(out.diagnostics, 'info').some(t => /interlineado.*0,1 mm.*1 mm/.test(t)));
});

test('emit: no lines in the block writes what the wrapped text needs; width, spacing and lines are clamped with one warning', () => {
  const needed = emit([textItem({ data: 'aaaa bbbb cccc dddd', block: { width: 150, align: 'left', lineSpace: 20 } })]);
  assert.match(needed.text, /,P50150020\d\d\|/);
  const clamped = emit([textItem({ block: { width: 5, lines: 300, align: 'left', lineSpace: 0 } }), textItem({ block: { width: 2000, lines: 2, align: 'left', lineSpace: 900 } })]);
  assert.match(clamped.text, /,P5005001099\|/);
  assert.match(clamped.text, /,P5104050002\|/);
  assert.equal(levels(clamped.diagnostics, 'warning').filter(t => /fuera de los rangos de TPCL/.test(t)).length, 1);
});

test('emit: a block has no alignment token; a centred one is written left with one info; the breaks of the data become spaces', () => {
  const out = emit([textItem({ data: 'one\ntwo', align: { kind: 'center' }, block: { width: 300, lines: 2, align: 'center', lineSpace: 20 } })]);
  assert.match(out.text, /\{PC00;[^|]*,B,P5030002002\|\}\n\{RC00;one two\|\}/);
  assert.ok(!/,P2/.test(out.text));
  assert.equal(levels(out.diagnostics, 'info').filter(t => /no tiene alineación/.test(t)).length, 1);
});

test('emit: a rotated block keeps its P5 (the rotations 00, 11, 22, 33 keep the block); spacing and bold stay', () => {
  const out = emit([textItem({ rotation: 90, spacing: { value: 12, native: 3 }, bold: { h: 1, v: 1, native: { h: 1, v: 1 } }, block: { width: 300, lines: 2, align: 'left', lineSpace: 20 } })]);
  assert.match(out.text, /\{PC00;0100,0200,1,1,S,\+03,11,B,J0101,P5030002002\|\}/);
});

test('emit: a block with a vector-only font (PV) is one line with ONE warning that says the block needs the bitmap font (PC)', () => {
  const sans = { size: 100, scaleX: 1, family: 'sans', weight: 400, style: 'normal' };
  const out = emit([textItem({ font: sans, block: { width: 300, lines: 2, align: 'left', lineSpace: 20 } }), textItem({ font: sans, y: 300, block: { width: 300, lines: 2, align: 'left', lineSpace: 20 } })]);
  assert.match(out.text, /\{PV00;/);
  assert.ok(!/P5/.test(out.text));
  const warnings = levels(out.diagnostics, 'warning').filter(t => /necesita una fuente de mapa de bits \(PC\)/.test(t));
  assert.equal(warnings.length, 1);
  assert.ok(!/TPCL no tiene bloque de texto/.test(out.diagnostics.map(d => d.text).join('|')));
});

test('a PC block survives TPCL -> TSPL BLOCK and TPCL -> ZPL ^FB (width, lines and line space; left)', () => {
  const src = `{D0630,1000,0600|}\n{C|}\n${PC(',P5030002003')}\n{XS;I,0001,0002C4100|}`;
  const original = itemsOf(src)[0];
  for (const [id, language, command] of [['tspl', tspl, /BLOCK /], ['zpl', zpl, /\^FB/]]) {
    const converted = PB.convert.run(src, id, 'tpcl');
    assert.match(converted.text, command);
    const back = language.parse(converted.text, { dpi: DPI }).items[0];
    assert.equal(back.block.lines, 3, id);
    assert.equal(back.block.align, 'left', id);
    assert.ok(Math.abs(back.block.width - original.block.width) <= 2, id);
    assert.ok(Math.abs(back.block.lineSpace - 20) <= 2, id);
  }
});

test('a TSPL BLOCK with a bitmap font becomes PC ...,P5 (and a block read from PC goes back to TPCL unchanged)', () => {
  const src = 'SIZE 100 mm,60 mm\r\nBLOCK 40,60,300,100,"3",0,1,1,4,"alpha beta gamma delta"\r\nPRINT 1,1\r\n';
  const converted = PB.convert.run(src, 'tpcl', 'tspl');
  assert.match(converted.text, /\{PC\d+;[^|]*,P5\d{9}\|\}/);
  assert.ok(!converted.diagnostics.some(d => /necesita una fuente de mapa de bits/.test(d.text)));
  const again = PB.convert.run(converted.text, 'tpcl', 'tpcl');
  assert.match(again.text, /,P5\d{9}\|\}/);
});

// ---- Properties: Tipo and the block fields

test('describeItem: a PC line offers both Tipo values, no block fields; a block adds width, lines and line spacing and hides the alignment', () => {
  const line = describe(PC(''));
  assert.deepEqual(line.fields.map(f => f.key).slice(0, 3), ['fontType', 'kind', 'hMag']);
  assert.deepEqual(field(PC(''), 'kind').options, [{ value: 'line', label: 'Línea de texto' }, { value: 'block', label: 'Bloque de texto' }]);
  assert.equal(field(PC(''), 'kind').value, 'line');
  assert.equal(field(PC(''), 'kind').note, undefined);
  assert.ok(keys(PC('')).includes('align'));
  const text = PC(',P5030002003');
  assert.deepEqual(keys(text).slice(0, 5), ['fontType', 'kind', 'blockWidth', 'blockLines', 'blockSpace']);
  assert.equal(field(text, 'kind').value, 'block');
  assert.deepEqual(['blockWidth', 'blockLines', 'blockSpace'].map(k => field(text, k).value), [300, 3, 20]);
  assert.deepEqual(['blockWidth', 'blockLines', 'blockSpace'].map(k => field(text, k).label), ['Ancho del área (0,1 mm)', 'Líneas', 'Interlineado (0,1 mm)']);
  assert.deepEqual([field(text, 'blockWidth').min, field(text, 'blockWidth').max, field(text, 'blockSpace').min, field(text, 'blockSpace').max, field(text, 'blockLines').max], [50, 1040, 10, 500, 99]);
  assert.ok(!keys(text).includes('align') && !keys(text).includes('alignWidth'));
});

test('describeItem: a PV text offers only "Línea de texto" with the note that the block needs the bitmap font (PC)', () => {
  const kind = field(PV(''), 'kind');
  assert.deepEqual(kind.options, [{ value: 'line', label: 'Línea de texto' }]);
  assert.equal(kind.note, 'Bloque de texto solo con fuente de mapa de bits (PC)');
  assert.equal(tpcl.updateItem(PV(''), itemsOf(PV(''))[0], { kind: 'block' }, { dpi: DPI }), PV(''));
});

test('describeItem: a PC text with a rotation code 01 / 12 / 23 / 30 offers only the line, with a note', () => {
  const text = '{PC001;0100,0200,10,10,S,01,B,P5030002003=abc|}';
  const kind = field(text, 'kind');
  assert.deepEqual(kind.options.map(o => o.value), ['line']);
  assert.match(kind.note, /01 \/ 12 \/ 23 \/ 30/);
  assert.equal(set(text, { kind: 'block' }), text);
  const plain = '{PC001;0100,0200,10,10,S,12,B=abc|}';
  assert.equal(set(plain, { kind: 'block' }), plain);
});

test('Tipo = block writes one default P5 in the alignment slot (it replaces P2...P4), keeping the rest of the command byte for byte', () => {
  const out = set(PC(',J0102,+0000000001,Z03,P2'), { kind: 'block' });
  const [item] = itemsOf(out);
  assert.match(out, /^\{PC001;0100,0200,10,10,S,00,B,J0102,\+0000000001,Z03,P5\d{9}=alpha beta gamma delta epsilon\|\}$/);
  assert.equal(item.align, undefined);
  assert.equal(item.block.align, 'left');
  assert.equal(item.block.lineSpace, 10);
  assert.ok(item.block.width >= 50 && item.block.width <= 1040);
  assert.ok(item.block.lines >= 1);
  // The default is 20 characters of the font wide
  const { advanceOf } = PB.slices.text;
  assert.ok(Math.abs(item.block.width - 20 * item.font.size * advanceOf(item.font) * item.font.scaleX) <= 1);
  assert.equal(set('{PC001;0100,0200,10,10,S,00,B|}', { kind: 'block' }).match(/P5\d{9}/)[0].slice(-2), '01');
});

test('Tipo = line removes the P5 token and nothing else', () => {
  assert.equal(set(PC(',J0102,P5030002003'), { kind: 'line' }), PC(',J0102'));
  assert.equal(set(PC(',P5030002003'), { kind: 'block' }), PC(',P5030002003'));
  assert.equal(set(PC(''), { kind: 'line' }), PC(''));
});

test('Tipo keeps the data command and the other items; a block text keeps its RC data', () => {
  const text = '{PC001;0100,0200,10,10,S,00,B|}\n{RC001;one two three|}\n{PV01;0100,0400,0100,0100,B,00,B|}\n{RV01;x|}';
  const out = set(text, { kind: 'block' });
  assert.ok(out.endsWith('\n{RC001;one two three|}\n{PV01;0100,0400,0100,0100,B,00,B|}\n{RV01;x|}'));
  assert.equal(itemsOf(out)[0].data, 'one two three');
  assert.ok(itemsOf(out)[0].block);
});

test('width, lines and line spacing edit the P5 token in place (each clamped to the manual range), alone or together', () => {
  const text = PC(',J0102,P5030002003');
  assert.equal(set(text, { blockWidth: 450 }), PC(',J0102,P5045002003'));
  assert.equal(set(text, { blockLines: 5 }), PC(',J0102,P5030002005'));
  assert.equal(set(text, { blockSpace: 35 }), PC(',J0102,P5030003503'));
  assert.equal(set(text, { blockWidth: 10, blockLines: 500, blockSpace: 1 }), PC(',J0102,P5005001099'));
  assert.equal(set(text, { blockWidth: 5000, blockSpace: 900 }), PC(',J0102,P5104050003'));
  assert.equal(set(text, { blockWidth: 'x' }), text);
  assert.equal(set(PC(''), { blockWidth: 450 }), PC(''));
});

test('a text with a block in the middle of the label moves with its P5 intact', () => {
  const text = `{D0630,1000,0600|}\n{C|}\n${PC(',P5030002003')}\n{XS;I,0001,0002C4100|}`;
  const moved = tpcl.moveItem(text, itemsOf(text)[0], 50, -30, { dpi: DPI });
  assert.ok(moved.includes('{PC001;0150,0170,10,10,S,00,B,P5030002003=alpha'));
});

test('the Tipo and block edits are one rewritten text each (one undoable change): the text differs only in the command', () => {
  const text = `{D0630,1000,0600|}\n{C|}\n${PC('')}\n{XS;I,0001,0002C4100|}`;
  const block = set(text, { kind: 'block' });
  assert.equal(block.split('\n').length, text.split('\n').length);
  assert.equal(set(block, { kind: 'line' }), text);
});
