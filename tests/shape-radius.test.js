const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// A1 rounded corners: TPCL LC rectangle radius (ggg, 3 digits, 0.1 mm; B-SV4 manual 6.3.6) and TSPL BOX radius (dots;
// from the TSPL2 manual v3.0, NOT verified on a printer). Neutral item field: `radius` in 0.1 mm on rect line items.
const PB = loadUpTo('js/drawing.js');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const DOT = PB.units.dotSize(203);

const keys = d => d.fields.map(f => f.key);
const field = (d, key) => d.fields.find(f => f.key === key);
const parseT = (text, dpi = 203) => tpcl.parse(text, { dpi }).items[0];
const parseS = (text, dpi = 203) => tspl.parse(text, { dpi }).items[0];
const editT = (text, changes) => tpcl.updateItem(text, parseT(text), changes, { dpi: 203 });
const editS = (text, changes) => tspl.updateItem(text, parseS(text), changes, { dpi: 203 });
const sDoc = (...lines) => `SIZE 100 mm,60 mm\r\nCLS\r\n${lines.join('\r\n')}\r\nPRINT 1,1\r\n`;

const RECT = '{LC;0100,0200,0500,0600,1,02|}';
const RECT_R = '{LC;0100,0200,0500,0600,1,02,050|}';
const RECT_R0 = '{LC;0100,0200,0500,0600,1,02,000|}';
const LINE_R = '{LC;0100,0200,0500,0600,0,02,050|}';

// ---- pure render geometry

test('cornerRadius: clamped to half of the shorter side, never negative or non-finite', () => {
  const { cornerRadius } = PB.slices.line;
  const rect = (radius, w = 400, h = 200) => ({ kind: 'line', rect: true, x1: 10, y1: 10, x2: 10 + w, y2: 10 + h, width: 3, radius });
  assert.equal(cornerRadius(rect(50)), 50);
  assert.equal(cornerRadius(rect(150)), 100, 'half of the 200 high side');
  assert.equal(cornerRadius(rect(150, 100, 300)), 50, 'half of the 100 wide side');
  assert.equal(cornerRadius(rect(-5)), 0);
  assert.equal(cornerRadius(rect(undefined)), 0);
  assert.equal(cornerRadius(rect(NaN)), 0);
  assert.equal(cornerRadius({ ...rect(50), x1: 410, x2: 10 }), 50, 'corners in any order');
});

test('render: a rounded rectangle gets rx/ry, a plain one and a line do not', () => {
  const draw = item => PB.slices.line.render(item, { n: v => Math.round(v * 100) / 100 }).markup;
  const base = { kind: 'line', x1: 100, y1: 200, x2: 500, y2: 400, width: 3 };
  assert.match(draw({ ...base, rect: true, radius: 50 }), /<rect x="100" y="200" width="400" height="200" rx="50" ry="50" class="stroke"/);
  assert.match(draw({ ...base, rect: true, radius: 500 }), /rx="100" ry="100"/, 'clamped');
  assert.doesNotMatch(draw({ ...base, rect: true }), /rx=/);
  assert.doesNotMatch(draw({ ...base, rect: true, radius: 0 }), /rx=/);
  assert.doesNotMatch(draw({ ...base, rect: false, radius: 50 }), /rx=/);
});

test('the SVG renderer draws the radius of a parsed rectangle', () => {
  const model = tpcl.parse(RECT_R, { dpi: 203 });
  const { svg } = PB.svgRenderer.render(model, PB.sizes.view(model), { textScale: 1, showGrid: false, showAnchors: false, values: {} });
  assert.match(svg, /<rect x="100" y="200" width="400" height="400" rx="50" ry="50"/);
});

// ---- TPCL parse / emit

test('TPCL: an LC rectangle keeps its radius (0.1 mm) and the native token', () => {
  const item = parseT(RECT_R);
  assert.equal(item.rect, true);
  assert.equal(item.radius, 50);
  assert.deepEqual(item.native, { width: 2, radius: 50 });
  assert.equal(parseT(RECT).radius, undefined);
  assert.equal(parseT(RECT_R0).radius, 0);
});

test('TPCL: a radius on a line (not a rectangle) is ignored', () => {
  const item = parseT(LINE_R);
  assert.equal(item.rect, false);
  assert.equal(item.radius, undefined);
  assert.equal(item.native.radius, undefined);
});

for (const eol of ['\r\n', '\n']) {
  const label = eol === '\n' ? 'LF' : 'CRLF';
  const text = `{D0500,0800,0600|}${eol}${RECT_R}${eol}{XS;I,0001,0002C5000|}${eol}`;

  test(`TPCL: radius round trip parse -> emit -> parse (${label})`, () => {
    const model = tpcl.parse(text, { dpi: 203 });
    const out = tpcl.emit(model, { dpi: 203 }).text;
    assert.match(out, /\{LC;0100,0200,0500,0600,1,02,050\|\}/);
    assert.equal(tpcl.parse(out, { dpi: 203 }).items[0].radius, 50);
  });

  test(`TPCL: updateItem inserts, changes and zeroes the radius keeping the rest byte for byte (${label})`, () => {
    const plain = `{D0500,0800,0600|}${eol}${RECT}${eol}{XS;I,0001,0002C5000|}${eol}`;
    const edit = (src, changes) => tpcl.updateItem(src, tpcl.parse(src, { dpi: 203 }).items[0], changes, { dpi: 203 });
    assert.equal(edit(plain, { radius: 30 }), plain.replace(RECT, '{LC;0100,0200,0500,0600,1,02,030|}'), 'insert');
    assert.equal(edit(text, { radius: 7 }), text.replace('02,050|', '02,007|'), 'change');
    assert.equal(edit(text, { radius: 0 }), text.replace('02,050|', '02,000|'), 'zero keeps the token');
    assert.equal(edit(plain, { radius: 0 }), plain, 'zero on an absent token writes nothing');
  });
}

test('TPCL: the emitter writes ,ggg only for a rectangle with radius > 0', () => {
  const emitLC = item => tpcl.emit({ language: 'tpcl', size: { width: 990, height: 550, pitch: 610, native: {} }, items: [{ kind: 'line', x1: 100, y1: 200, x2: 500, y2: 600, width: 2 * DOT, ...item }], diagnostics: [] }, { dpi: 203 }).text
    .split('\n').find(l => l.startsWith('{LC;'));
  assert.equal(emitLC({ rect: true, radius: 50 }), '{LC;0100,0200,0500,0600,1,02,050|}');
  assert.equal(emitLC({ rect: true, radius: 5 }), '{LC;0100,0200,0500,0600,1,02,005|}');
  assert.equal(emitLC({ rect: true, radius: 0 }), '{LC;0100,0200,0500,0600,1,02|}');
  assert.equal(emitLC({ rect: true }), '{LC;0100,0200,0500,0600,1,02|}');
  assert.equal(emitLC({ rect: false, radius: 50 }), '{LC;0100,0200,0500,0600,0,02|}');
  assert.equal(emitLC({ rect: true, radius: 5000 }), '{LC;0100,0200,0500,0600,1,02,999|}', 'clamped to 3 digits');
});

// ---- TPCL describe / update

test('TPCL: describeItem lists the radius for rectangles only, with and without text', () => {
  for (const [src, expected] of [[RECT, 0], [RECT_R, 50], [RECT_R0, 0]]) {
    const item = parseT(src);
    const withText = tpcl.describeItem(item, src);
    const without = tpcl.describeItem(item);
    assert.deepEqual(keys(withText), ['x2', 'y2', 'width', 'rect', 'radius']);
    assert.deepEqual(without, withText, src);
    assert.equal(field(withText, 'radius').value, expected);
    assert.deepEqual([field(withText, 'radius').min, field(withText, 'radius').max], [0, 999]);
  }
  const line = '{LC;0100,0200,0500,0600,0,02|}';
  assert.deepEqual(keys(tpcl.describeItem(parseT(line), line)), ['x2', 'y2', 'width', 'rect']);
  assert.deepEqual(keys(tpcl.describeItem(parseT(LINE_R), LINE_R)), ['x2', 'y2', 'width', 'rect']);
});

test('TPCL: updateItem ignores a radius on a line and clamps to 0..999', () => {
  assert.equal(editT(LINE_R, { radius: 9 }), LINE_R);
  assert.equal(editT('{LC;0100,0200,0500,0600,0,02|}', { radius: 9 }), '{LC;0100,0200,0500,0600,0,02|}');
  assert.equal(editT(RECT_R, { radius: 5000 }), RECT_R.replace('02,050|', '02,999|'));
  assert.equal(editT(RECT_R, { radius: -3 }), RECT_R.replace('02,050|', '02,000|'));
  assert.equal(editT(RECT_R, { radius: 'a' }), RECT_R);
});

test('TPCL: radius edit together with other fields, and with line breaks inside the command', () => {
  assert.equal(editT(RECT, { x2: 700, radius: 20 }), '{LC;0100,0200,0700,0600,1,02,020|}');
  assert.equal(editT('{LC;\r\n0100,0200,\r\n0500,0600,1,02|}', { radius: 20 }), '{LC;\r\n0100,0200,\r\n0500,0600,1,02,020|}');
});

// ---- TSPL parse / emit

test('TSPL: BOX keeps its radius in 0.1 mm (neutral) and in dots (native)', () => {
  const item = parseS(sDoc('BOX 10,20,210,120,4,80'));
  assert.equal(item.rect, true);
  assert.ok(Math.abs(item.radius - 80 * DOT) < 1e-9);
  assert.deepEqual(item.native, { width: 4, kind: 'BOX', radius: 80 });
  assert.equal(parseS(sDoc('BOX 10,20,210,120,4')).radius, undefined);
  assert.equal(parseS(sDoc('BOX 10,20,210,120,4,0')).radius, 0);
});

test('TSPL: the radius no longer reports an "unsupported" info (it is drawn)', () => {
  assert.equal(tspl.parse(sDoc('BOX 10,20,210,120,4,8'), { dpi: 203 }).diagnostics.length, 0);
});

for (const eol of ['\r\n', '\n']) {
  test(`TSPL: radius round trip parse -> emit -> parse (${eol === '\n' ? 'LF' : 'CRLF'})`, () => {
    const src = `SIZE 100 mm,60 mm${eol}CLS${eol}BOX 10,20,210,120,4,80${eol}PRINT 1,1${eol}`;
    const out = tspl.emit(tspl.parse(src, { dpi: 203 }), { dpi: 203 }).text;
    assert.match(out, /BOX 10,20,210,120,4,80/);
    assert.equal(tspl.parse(out, { dpi: 203 }).items[0].native.radius, 80);
  });
}

test('TSPL: the emitter writes the radius only when > 0', () => {
  const emitBox = item => tspl.emit({ language: 'tspl', size: { width: 1000, height: 600, native: {} }, diagnostics: [], items: [{ kind: 'line', rect: true, x1: 100, y1: 200, x2: 500, y2: 600, width: 3 * DOT, ...item }] }, { dpi: 203 }).text
    .split(/\r?\n/).find(l => l.startsWith('BOX '));
  assert.match(emitBox({ radius: 10 * DOT }), /^BOX \d+,\d+,\d+,\d+,3,10$/);
  assert.match(emitBox({ radius: 0 }), /^BOX \d+,\d+,\d+,\d+,3$/);
  assert.match(emitBox({}), /^BOX \d+,\d+,\d+,\d+,3$/);
});

// ---- TSPL describe / update

test('TSPL: describeItem always lists the radius of a BOX (0 when the command has none), with and without text', () => {
  for (const [line, expected] of [['BOX 10,20,300,200,4', 0], ['BOX 10,20,300,200,4,12', 12], ['BOX 10,20,300,200,4,0', 0]]) {
    const text = sDoc(line);
    const item = parseS(text);
    const withText = tspl.describeItem(item, text, { dpi: 203 });
    assert.deepEqual(keys(withText), ['thickness', 'radius'], line);
    assert.equal(field(withText, 'radius').value, expected);
    assert.deepEqual(tspl.describeItem(item, undefined, { dpi: 203 }), withText, line);
  }
});

test('TSPL: updateItem inserts the radius at the end of the command, changes it or zeroes it', () => {
  const plain = sDoc('BOX 10,20,300,200,4', 'BAR 1,2,3,4');
  assert.equal(editS(plain, { radius: 9 }), sDoc('BOX 10,20,300,200,4,9', 'BAR 1,2,3,4'), 'insert');
  assert.equal(editS(plain, { radius: 0 }), plain, 'zero on an absent argument writes nothing');
  assert.equal(editS(plain, { radius: 99999 }), sDoc('BOX 10,20,300,200,4,9999', 'BAR 1,2,3,4'), 'clamped');
  const withR = sDoc('BOX 10,20,300,200,4,12');
  assert.equal(editS(withR, { radius: 30 }), sDoc('BOX 10,20,300,200,4,30'));
  assert.equal(editS(withR, { radius: 0 }), sDoc('BOX 10,20,300,200,4,0'), 'zero keeps the argument');
  assert.equal(editS(plain, { radius: 'a' }), plain);
});

test('TSPL: the radius insertion works in LF files and keeps the following lines untouched', () => {
  const text = 'SIZE 100 mm,60 mm\nCLS\nBOX 10,20,300,200,4\nTEXT 1,2,"3",0,1,1,"a,b"\nPRINT 1,1\n';
  assert.equal(editS(text, { radius: 5 }), text.replace('BOX 10,20,300,200,4', 'BOX 10,20,300,200,4,5'));
});

// ---- cross conversion units

test('conversion TPCL -> TSPL: the radius goes from 0.1 mm to dots', () => {
  const src = `{D0500,0800,0600|}\n${RECT_R}\n{XS;I,0001,0002C5000|}\n`;
  for (const dpi of [203, 300]) {
    const r = PB.convert.run(src, 'tspl', { dpi });
    const dots = Math.round(50 / PB.units.dotSize(dpi));
    assert.match(r.text, new RegExp(`BOX \\d+,\\d+,\\d+,\\d+,\\d+,${dots}\\b`), `${dpi} dpi`);
    const back = tspl.parse(r.text, { dpi }).items[0];
    assert.ok(Math.abs(back.radius - 50) <= PB.units.dotSize(dpi), `${dpi} dpi radius back in 0.1 mm`);
  }
});

test('conversion TSPL -> TPCL: the radius goes from dots to 0.1 mm (3 digits)', () => {
  const src = sDoc('BOX 10,20,210,120,4,80');
  const r = PB.convert.run(src, 'tpcl', { dpi: 203 });
  assert.match(r.text, /\{LC;\d{4},\d{4},\d{4},\d{4},1,\d{2},100\|\}/);
  assert.equal(tpcl.parse(r.text, { dpi: 203 }).items[0].radius, 100);
});

test('conversion: no radius in the source writes no radius in the target', () => {
  assert.doesNotMatch(PB.convert.run(sDoc('BOX 10,20,210,120,4'), 'tpcl', { dpi: 203 }).text, /,1,\d{2},\d{3}/);
  assert.match(PB.convert.run(`{D0500,0800,0600|}\n${RECT}\n{XS;I,0001,0002C5000|}\n`, 'tspl', { dpi: 203 }).text, /BOX (\d+,){4}\d+\r?\n/);
});
