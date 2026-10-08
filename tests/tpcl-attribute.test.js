const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// TPCL text attribute (text/tpcl.js, text/render.js, text/tspl.js): the "j" option of PC/PV is B (black), W[aabb] (reverse),
// F[aabb] (boxed) or C[aa] (stroked out), offsets in dots (01..99). It is parsed into item.attribute, drawn (pure geometry in
// render.js; the browser only measures the text), written back by emit and edited from the panel.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const DOT = PB.units.dotSize(203);

const parse = (text, dpi = 203) => tpcl.parse(text, { dpi });
const itemsOf = text => parse(text).items;
const attrOf = (text, index = 0) => itemsOf(text)[index].attribute;
const describe = (text, index = 0) => tpcl.describeItem(itemsOf(text)[index], text);
const field = (text, key, index = 0) => describe(text, index).fields.find(f => f.key === key);
const set = (text, changes, index = 0) => tpcl.updateItem(text, itemsOf(text)[index], changes, { dpi: 203 });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !~ ${expected}`);

const pc = j => `{PC001;0100,0200,10,05,J,00,${j}=HOLA|}`;
const pv = j => `{PV01;0100,0200,0100,0120,B,00,${j}=HOLA|}`;

test('parse: B or no attribute leaves item.attribute undefined', () => {
  assert.equal(attrOf(pc('B')), undefined);
});

test('parse: W and F with aabb give the dots of the string to the background/box (native keeps the dots, h/v are 0.1 mm)', () => {
  for (const [letter, kind] of [['W', 'reverse'], ['F', 'box']]) {
    const a = attrOf(pc(`${letter}0507`));
    assert.equal(a.kind, kind);
    assert.deepEqual(a.native, { h: 5, v: 7 });
    near(a.h, 5 * DOT);
    near(a.v, 7 * DOT);
  }
});

test('parse: C takes one value, applied as h (v is not used)', () => {
  const a = attrOf(pc('C05'));
  assert.equal(a.kind, 'strike');
  assert.deepEqual(a.native, { h: 5 });
  near(a.h, 5 * DOT);
  assert.equal(a.v, undefined);
});

test('parse: the offsets follow the dpi', () => {
  const a = itemsOf(pc('W1010'))[0].attribute;
  const b = parse(pc('W1010'), 300).items[0].attribute;
  near(a.h, 10 * PB.units.dotSize(203));
  near(b.h, 10 * PB.units.dotSize(300));
});

test('parse: omitted offsets use the manual default (PC: larger magnification x 6 dots), native stays empty', () => {
  const a = attrOf(pc('W')); // 10 / 05 -> magnification 1.0 and 0.5
  assert.equal(a.kind, 'reverse');
  assert.equal(a.native, undefined);
  assert.equal(a.defaultDots, 6);
  near(a.h, 6 * DOT);
  near(a.v, 6 * DOT);
  assert.equal(attrOf(pc('C')).defaultDots, 6);
});

test('parse: omitted offsets of PV use the larger character size (in mm) x 8 dots, clamped to 99', () => {
  assert.equal(attrOf(pv('F')).defaultDots, 96); // 12 mm * 8
  assert.equal(attrOf('{PV01;0100,0200,0300,0300,B,00,F|}').defaultDots, 99);
  assert.equal(attrOf('{PV01;0100,0200,0030,0020,B,00,F|}').defaultDots, 24);
});

test('parse: PC and PV, with spacing, bold or alignment after the attribute, inline data or RC/RV', () => {
  assert.equal(attrOf('{PC001;0100,0200,10,10,J,+03,11,W0102J0101=HOLA|}').kind, 'reverse');
  assert.equal(itemsOf('{PC001;0100,0200,10,10,J,+03,11,W0102J0101=HOLA|}')[0].data, 'HOLA');
  const rc = '{PC001;0100,0200,10,10,J,00,F0203|}\n{RC001;HOLA|}';
  assert.deepEqual([attrOf(rc).kind, attrOf(rc).native, itemsOf(rc)[0].data], ['box', { h: 2, v: 3 }, 'HOLA']);
  const rv = '{PV01;0100,0200,0100,0100,B,00,C09|}\n{RV01;HOLA|}';
  assert.deepEqual([attrOf(rv).kind, attrOf(rv).native, itemsOf(rv)[0].data], ['strike', { h: 9 }, 'HOLA']);
});

test('parse: B, W, F and C are not reported; C is no longer an unsupported command; the item keeps its source', () => {
  for (const j of ['B', 'W', 'W0505', 'F', 'F1010', 'C', 'C05']) {
    for (const text of [pc(j), pv(j)]) {
      const model = parse(text);
      assert.equal(model.items.length, 1, text);
      assert.deepEqual(model.diagnostics, [], text);
      assert.equal(model.items[0].source.spans.length, 1);
    }
  }
});

test('parse: an unknown attribute letter is still an unsupported command', () => {
  const model = parse(pc('X'));
  assert.equal(model.items.length, 0);
  assert.match(model.diagnostics[0].text, /Comando no soportado/);
});

test('emit: black writes B, the attributes are written back with their dots and round-trip through parse', () => {
  const emit = text => tpcl.emit(parse(text), { dpi: 203 }).text;
  const first = text => emit(text).split('\n').find(l => /^\{P[CV]/.test(l));
  assert.match(first(pc('B')), /,00,B\|\}$/);
  assert.match(first(pc('W0507')), /,W0507\|\}$/);
  assert.match(first(pv('F0102')), /,F0102\|\}$/);
  assert.match(first(pc('C09')), /,C09\|\}$/);
  assert.match(first(pc('W')), /,W\|\}$/);
  for (const j of ['W0507', 'F0102', 'C09', 'W', 'C']) {
    const a = attrOf(pc(j));
    const back = itemsOf(emit(pc(j)))[0].attribute;
    assert.equal(back.kind, a.kind);
    assert.deepEqual(back.native, a.native, j);
  }
});

test('emit: an attribute of a model without native offsets is written without them and offsets are clamped to 1..99', () => {
  const base = { kind: 'text', x: 600, y: 75, rotation: 0, data: 'X', font: { size: 80, scaleX: 0.75, family: 'sans', weight: 700, style: 'normal' } };
  const model = attribute => ({ language: 'tpcl', size: { width: 990, height: 550, pitch: 610, native: {} }, items: [{ ...base, attribute }], diagnostics: [] });
  const line = attribute => tpcl.emit(model(attribute), { dpi: 203 }).text.split('\n').find(l => /^\{PV/.test(l));
  assert.match(line({ kind: 'reverse' }), /,W\|\}$/);
  assert.match(line({ kind: 'strike', h: 5 * DOT, native: { h: 5 } }), /,C05\|\}$/);
  assert.match(line({ kind: 'box', h: 500 * DOT, v: 0, native: { h: 500, v: 0 } }), /,F9901\|\}$/);
});

test('describe: attribute select plus the offsets of the current kind (dots), with and without the text', () => {
  const text = pc('W0507');
  const item = itemsOf(text)[0];
  const f = field(text, 'attribute');
  assert.deepEqual([f.label, f.type, f.value], ['Atributo', 'select', 'reverse']);
  assert.deepEqual(f.options.map(o => [o.value, o.label]), [['black', 'Negro'], ['reverse', 'Invertido'], ['box', 'Con marco'], ['strike', 'Tachado']]);
  assert.deepEqual([field(text, 'attrH').label, field(text, 'attrH').value, field(text, 'attrV').label, field(text, 'attrV').value], ['Margen horizontal', 5, 'Margen vertical', 7]);
  assert.deepEqual(field(text, 'attrH'), { key: 'attrH', label: 'Margen horizontal', type: 'number', value: 5, min: 1, max: 99, step: 1 });
  const keys = fields => fields.map(x => [x.key, x.value]).filter(([k]) => /^attr/.test(k));
  assert.deepEqual(keys(tpcl.describeItem(item).fields), keys(tpcl.describeItem(item, text).fields));
});

test('describe: black shows no offsets, strike only the horizontal one, and a bare W shows the default dots', () => {
  const keys = text => describe(text).fields.map(f => f.key).filter(k => /^attr/.test(k));
  assert.deepEqual(keys(pc('B')), ['attribute']);
  assert.equal(field(pc('B'), 'attribute').value, 'black');
  assert.deepEqual(keys(pc('C05')), ['attribute', 'attrH']);
  assert.deepEqual(keys(pc('F0102')), ['attribute', 'attrH', 'attrV']);
  assert.equal(field(pc('W'), 'attrH').value, 6);
  assert.equal(field(pc('W'), 'attrV').value, 6);
  const item = itemsOf(pc('W'))[0];
  assert.deepEqual(tpcl.describeItem(item).fields.filter(f => /^attr/.test(f.key)).map(f => f.value), ['reverse', 6, 6]);
});

test('describe: the content, font and the other fields keep working with the attribute fields', () => {
  const f = Object.fromEntries(describe(pc('W0507')).fields.map(x => [x.key, x.value]));
  assert.deepEqual([f.hMag, f.vMag, f.rotation, f.font, f.content], [10, 5, 0, 'J', 'HOLA']);
});

test('update: changing the kind rewrites only the attribute token and keeps the offsets', () => {
  assert.equal(set(pc('W0507'), { attribute: 'box' }), pc('F0507'));
  assert.equal(set(pc('W0507'), { attribute: 'strike' }), pc('C05'));
  assert.equal(set(pc('W0507'), { attribute: 'black' }), pc('B'));
  assert.equal(set(pc('C09'), { attribute: 'reverse' }), pc('W0909'));
  assert.equal(set(pc('B'), { attribute: 'reverse' }), pc('W'));
  assert.equal(set(pc('B'), { attribute: 'box', attrH: 3, attrV: 4 }), pc('F0304'));
  assert.equal(set(pv('F0102'), { attribute: 'reverse' }), pv('W0102'));
});

test('update: the offsets are clamped to 1..99 and written with 2 digits each', () => {
  assert.equal(set(pc('W0507'), { attrH: 9 }), pc('W0907'));
  assert.equal(set(pc('W0507'), { attrV: 120 }), pc('W0599'));
  assert.equal(set(pc('W0507'), { attrH: 0 }), pc('W0107'));
  assert.equal(set(pc('W0507'), { attrH: 2, attrV: 3 }), pc('W0203'));
  assert.equal(set(pc('C05'), { attrH: 12 }), pc('C12'));
  assert.equal(set(pc('C05'), { attrH: 4.6 }), pc('C05'));
});

test('update: invalid values, black offsets and a vertical offset of a strike leave the text unchanged', () => {
  for (const changes of [{ attribute: 'X' }, { attribute: 5 }, { attribute: null }, { attrH: 'a' }, { attrH: NaN }, { attrV: null }]) {
    assert.equal(set(pc('W0507'), changes), pc('W0507'), JSON.stringify(changes));
  }
  assert.equal(set(pc('B'), { attrH: 5 }), pc('B'));
  assert.equal(set(pc('C05'), { attrV: 5 }), pc('C05'));
});

test('update: the rest of the command, the font group, the data command and other items are kept (CRLF and LF)', () => {
  for (const eol of ['\r\n', '\n']) {
    const text = `{D0500,0400,0400|}${eol}{PC001;0100,0200,10,05,J,+03,11,W0507J0101|}${eol}{RC001;HOLA|}${eol}{PV01;0100,0300,0100,0100,B,00,B=X|}${eol}`;
    assert.equal(set(text, { attribute: 'box' }), text.replace('W0507', 'F0507'));
    assert.equal(set(text, { attribute: 'strike', font: 'A', rotation: 90 }), text.replace('W0507', 'C05').replace(',J,', ',A,').replace(',11,', ',11,'));
    assert.equal(set(text, { attribute: 'reverse' }, 1), text.replace(',00,B=X', ',00,W=X'));
  }
});

test('update: with the format and data in different commands the attribute edit leaves RC/RV alone', () => {
  const text = '{PV01;0100,0200,0100,0100,B,00,B|}\n{RV01;HOLA|}';
  assert.equal(set(text, { attribute: 'reverse', attrH: 5, attrV: 5 }), '{PV01;0100,0200,0100,0100,B,00,W0505|}\n{RV01;HOLA|}');
  assert.equal(set(text, { attribute: 'reverse', content: 'ADIOS' }), '{PV01;0100,0200,0100,0100,B,00,W|}\n{RV01;ADIOS|}');
});

test('palette: a new text still writes the black attribute', () => {
  const built = tpcl.buildComponent('', 'text', { x: 100, y: 100 }, { dpi: 203 });
  assert.match(built, /,B\|\}/);
  assert.equal(itemsOf(built)[0].attribute, undefined);
});

// --- Rendering geometry (pure, text/render.js): the browser only provides the measured box of the string

const geometry = PB.slices.text.attributeShapes;
const BOX = { x: 0, y: -50, width: 200, height: 60 };

test('geometry: black has no shapes', () => {
  assert.deepEqual(geometry(undefined, BOX), []);
  assert.deepEqual(geometry({ kind: 'black' }, BOX), []);
});

test('geometry: reverse is a filled rectangle that grows h to each side and v above and below', () => {
  assert.deepEqual(geometry({ kind: 'reverse', h: 10, v: 6 }, BOX), [{ type: 'rect', role: 'fill', x: -10, y: -56, width: 220, height: 72 }]);
});

test('geometry: box is the same rectangle drawn as an outline', () => {
  assert.deepEqual(geometry({ kind: 'box', h: 10, v: 6 }, BOX), [{ type: 'rect', role: 'outline', x: -10, y: -56, width: 220, height: 72 }]);
});

test('geometry: strike is a line through the middle of the string that extends h past both ends', () => {
  assert.deepEqual(geometry({ kind: 'strike', h: 10 }, BOX), [{ type: 'line', x1: -10, y1: -20, x2: 210, y2: -20 }]);
});

test('geometry: a missing offset counts as zero and an unknown kind draws nothing', () => {
  assert.deepEqual(geometry({ kind: 'box' }, BOX), [{ type: 'rect', role: 'outline', x: 0, y: -50, width: 200, height: 60 }]);
  assert.deepEqual(geometry({ kind: 'weird', h: 1, v: 1 }, BOX), []);
});

test('markup: shapes become SVG elements with classes (reverse text is white through a class)', () => {
  const markup = PB.slices.text.attributeMarkup(geometry({ kind: 'reverse', h: 10, v: 6 }, BOX), v => Number(v.toFixed(2)));
  assert.equal(markup, '<rect class="attr-fill" x="-10" y="-56" width="220" height="72"/>');
  assert.equal(PB.slices.text.attributeMarkup(geometry({ kind: 'strike', h: 10 }, BOX), v => v), '<line class="attr-line" x1="-10" y1="-20" x2="210" y2="-20"/>');
});

test('render: a text with an attribute carries a group the layout fills, and reverse text gets the white class', () => {
  const ctx = { n: v => Number(v.toFixed(2)), esc: s => String(s), value: s => s, textScale: 1 };
  const item = { kind: 'text', x: 10, y: 20, rotation: 90, data: 'A', font: { size: 40, scaleX: 1, family: 'sans', weight: 400, style: 'normal' } };
  const plain = PB.slices.text.render(item, ctx).markup;
  assert.doesNotMatch(plain, /text-attr|attr-reverse/);
  const reverse = PB.slices.text.render({ ...item, attribute: { kind: 'reverse', h: 5, v: 5 } }, ctx).markup;
  assert.match(reverse, /<g class="text-attr" data-kind="reverse" transform="translate\(10 20\) rotate\(90\)"><\/g>/);
  assert.match(reverse, /<text class="[^"]*attr-reverse/);
  assert.ok(reverse.indexOf('text-attr') < reverse.indexOf('<text'), 'the shape goes behind the text');
  assert.doesNotMatch(PB.slices.text.render({ ...item, attribute: { kind: 'box', h: 5, v: 5 } }, ctx).markup, /attr-reverse/);
});

// --- Cross conversion: TSPL has no text attribute

test('TSPL: a reverse, boxed or stroked text is written plain with one warning, black texts with none', () => {
  const tspl = PB.languages.get('tspl');
  const item = (attribute, data) => ({ kind: 'text', x: 100, y: 100, rotation: 0, data, font: { size: 80, scaleX: 1, family: 'sans', weight: 400, style: 'normal' }, ...(attribute && { attribute }) });
  const model = items => ({ language: 'tpcl', size: { width: 1000, height: 600, native: {} }, items, diagnostics: [] });
  const out = tspl.emit(model([item({ kind: 'reverse', h: 5, v: 5 }, 'A'), item({ kind: 'box', h: 5, v: 5 }, 'B'), item({ kind: 'strike', h: 5 }, 'C'), item(null, 'D')]), { dpi: 203 });
  const warnings = out.diagnostics.filter(d => /atributo/i.test(d.text));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /atributo/);
  assert.equal(out.text.split('\n').filter(l => l.startsWith('TEXT')).length, 4);
  const clean = tspl.emit(model([item(null, 'D'), item({ kind: 'black' }, 'E')]), { dpi: 203 });
  assert.equal(clean.diagnostics.filter(d => /atributo/i.test(d.text)).length, 0);
});

test('convert: a TPCL label with attributes converted to TSPL warns once and keeps the text', () => {
  const src = '{D0500,0400,0400|}\n{C|}\n{PC001;0100,0200,10,10,J,00,W0505=HOLA|}\n{PV01;0100,0300,0100,0100,B,00,F=ADIOS|}\n{XS;I,0001,0002C4100|}';
  const result = PB.convert.run(src, 'tspl', { dpi: 203 });
  assert.equal(result.diagnostics.filter(d => /atributo/i.test(d.text)).length, 1);
  assert.match(result.text, /"HOLA"/);
  assert.match(result.text, /"ADIOS"/);
});
