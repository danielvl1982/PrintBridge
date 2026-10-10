const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// A3 inverted / cleared area. Both act on the image buffer content ALREADY drawn when they run, in command order.
//   TPCL  {XR;x1,y1,x2,y2,A|B|}  (0.1 mm corners; A clears to white, B reverses white/black; B-SV4 manual 6.3.5)
//   TSPL  REVERSE x,y,w,h / ERASE x,y,w,h  (dots; B-442/443 manual; NOT verified on a printer)
// Neutral item: { kind: 'area', ref: 'XR' | 'REVERSE' | 'ERASE', mode: 'reverse' | 'clear', x, y, width, height } in 0.1 mm.
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');
const tpcl = PB.languages.get('tpcl');
const DOT = { 203: PB.units.dotSize(203), 300: PB.units.dotSize(300) };

const HEAD = 'SIZE 100 mm,60 mm\r\nCLS\r\n';
const TAIL = 'PRINT 1,1\r\n';
const doc = (...lines) => HEAD + lines.join('\r\n') + '\r\n' + TAIL;
const tdoc = (...cmds) => `{D0630,0800,0600|}\n{C|}\n${cmds.join('\n')}\n{XS;I,0001,0002C4100|}\n`;
const parseS = (text, dpi = 203) => tspl.parse(text, { dpi });
const parseP = text => tpcl.parse(text, { dpi: 203 });
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} vs ${b}`);
const keys = d => d.fields.map(f => f.key);
const field = (d, key) => d.fields.find(f => f.key === key);
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);

// ---- TSPL parse

test('REVERSE and ERASE parse into a neutral area item (top-left, size in 0.1 mm, native in dots)', () => {
  const model = parseS(doc('REVERSE 10,20,300,200', 'ERASE 5,6,40,30'));
  assert.deepEqual(model.diagnostics, []);
  const [rev, era] = model.items;
  assert.equal(rev.kind, 'area');
  assert.equal(rev.ref, 'REVERSE');
  assert.equal(rev.mode, 'reverse');
  near(rev.x, 10 * DOT[203], 'x');
  near(rev.y, 20 * DOT[203], 'y');
  near(rev.width, 300 * DOT[203], 'width');
  near(rev.height, 200 * DOT[203], 'height');
  assert.deepEqual(rev.native, { width: 300, height: 200, kind: 'REVERSE' });
  assert.equal(rev.source.label, 'REVERSE 10,20,300,200');
  assert.equal(era.ref, 'ERASE');
  assert.equal(era.mode, 'clear');
  assert.deepEqual(era.native, { width: 40, height: 30, kind: 'ERASE' });
});

test('TSPL: REFERENCE and SHIFT move the position, not the size; commands are case-insensitive', () => {
  const item = parseS(doc('REFERENCE 5,6', 'SHIFT 1,2', 'reverse 10, 20, 300, 200')).items[0];
  near(item.x, 16 * DOT[203], 'x');
  near(item.y, 28 * DOT[203], 'y');
  near(item.width, 300 * DOT[203], 'width');
  assert.equal(item.mode, 'reverse');
});

test('TSPL: short or invalid arguments give one Spanish warning and no item', () => {
  const bad = [
    ['REVERSE 10,20,300', /^REVERSE incompleto: /],
    ['ERASE 10,20', /^ERASE incompleto: /],
    ['REVERSE 10,20,abc,200', /^REVERSE con valores no válidos: /],
    ['ERASE 10,20,0,200', /^ERASE con valores no válidos: /],
    ['ERASE 10,20,30,-5', /^ERASE con valores no válidos: /],
  ];
  for (const [line, pattern] of bad) {
    const model = parseS(doc(line));
    assert.equal(model.items.length, 0, line);
    assert.equal(warnings(model).length, 1, line);
    assert.match(warnings(model)[0], pattern, line);
  }
});

test('REVERSE and ERASE are no longer unsupported commands', () => {
  for (const line of ['REVERSE 10,10,100,50', 'ERASE 10,10,100,50']) {
    assert.doesNotMatch(parseS(doc(line)).diagnostics.map(d => d.text).join('|'), /no soportado/, line);
  }
});

// ---- TPCL parse

test('XR parses into a neutral area item: type B reverses, A clears; corners become x, y, width, height', () => {
  const model = parseP(tdoc('{XR;0100,0200,0400,0350,B|}', '{XR;0010,0020,0050,0060,A|}'));
  assert.deepEqual(model.diagnostics, []);
  const [rev, clr] = model.items;
  assert.equal(rev.kind, 'area');
  assert.equal(rev.ref, 'XR');
  assert.equal(rev.mode, 'reverse');
  assert.deepEqual([rev.x, rev.y, rev.width, rev.height], [100, 200, 300, 150]);
  assert.deepEqual(rev.native, { x1: 100, y1: 200, x2: 400, y2: 350, type: 'B' });
  assert.equal(rev.source.label, '{XR;0100,0200,0400,0350,B|}');
  assert.equal(clr.mode, 'clear');
  assert.equal(clr.native.type, 'A');
});

test('XR: reversed corners give the same rectangle (manual notes 1 and 2) and the Y values may have 5 digits', () => {
  const item = parseP(tdoc('{XR;0400,00350,0100,00200,B|}')).items[0];
  assert.deepEqual([item.x, item.y, item.width, item.height], [100, 200, 300, 150]);
  assert.deepEqual(item.native, { x1: 400, y1: 350, x2: 100, y2: 200, type: 'B' });
});

test('XR: an unknown type letter or a malformed command gives one warning and no item', () => {
  for (const cmd of ['{XR;0100,0200,0400,0350,C|}', '{XR;0100,0200,0400|}', '{XR;0100,0200,0400,0350|}', '{XR;a,b,c,d,B|}']) {
    const model = parseP(tdoc(cmd));
    assert.equal(model.items.length, 0, cmd);
    assert.equal(warnings(model).length, 1, cmd);
    assert.match(warnings(model)[0], /^XR /, cmd);
    assert.doesNotMatch(warnings(model)[0], /no soportado por el visor/, cmd);
  }
  assert.match(warnings(parseP(tdoc('{XR;0100,0200,0400,0350,C|}')))[0], /tipo/);
});

// ---- order semantics (the area only affects what is drawn BEFORE it)

test('model order is command order: items before the area are affected, items after are not', () => {
  const s = parseS(doc('TEXT 10,10,"3",0,1,1,"A"', 'REVERSE 5,5,100,50', 'BOX 1,1,50,50,2'));
  assert.deepEqual(s.items.map(i => i.kind), ['text', 'area', 'line']);
  const p = parseP(tdoc('{PC000;0100,0100,05,05,J,00,B=A|}', '{XR;0050,0050,0200,0100,B|}', '{LC;0010,0010,0100,0100,1,03|}'));
  assert.deepEqual(p.items.map(i => i.kind), ['text', 'area', 'line']);
});

test('the SVG paints the area at its position in command order (after what came before, before what follows)', () => {
  const model = parseS(doc('TEXT 10,10,"3",0,1,1,"A"', 'REVERSE 5,5,100,50', 'BOX 1,1,50,50,2'));
  const { svg } = PB.svgRenderer.render(model, { width: 1000, height: 600 }, { textScale: 1 });
  const at = i => svg.indexOf(`data-index="${i}"`);
  assert.ok(at(0) >= 0 && at(0) < at(1) && at(1) < at(2), 'items are painted in model order');
  const group = svg.slice(at(1), at(2));
  assert.match(group, /mix-blend-mode:\s*difference/);
});

// ---- registry

test('the area slice is registered after the circle and before the image, without data', () => {
  const def = PB.components.get('area');
  assert.ok(def);
  assert.equal(def.modelKind, 'area');
  assert.equal(def.carriesData, false);
  assert.ok(def.glyph);
  assert.equal(def.label, 'Área invertida');
  const kinds = PB.components.kinds();
  assert.ok(kinds.indexOf('circle') < kinds.indexOf('area') && kinds.indexOf('area') < kinds.indexOf('image'));
  assert.equal(PB.components.forItem({ kind: 'area', ref: 'REVERSE' }).kind, 'area');
});

test('the neutral validator has nothing to say about a parsed area', () => {
  assert.deepEqual(PB.validator.validate(parseS(doc('REVERSE 10,20,300,200', 'ERASE 5,5,4,4')), tspl), []);
});

// ---- render

const draw = item => PB.components.forItem(item).render(item, { n: v => Math.round(v * 100) / 100 });

test('render: reverse is a white rect that blends with difference over what is underneath, plus a hit area', () => {
  const { markup } = draw({ kind: 'area', ref: 'REVERSE', mode: 'reverse', x: 100, y: 200, width: 300, height: 150 });
  assert.equal(markup,
    '<rect class="area area-reverse" x="100" y="200" width="300" height="150" fill="#fff" style="mix-blend-mode:difference"/>' +
    '<rect class="hit" x="100" y="200" width="300" height="150"/>');
});

test('render: clear is a plain white rect over what is already drawn, plus a hit area', () => {
  const { markup } = draw({ kind: 'area', ref: 'ERASE', mode: 'clear', x: 10, y: 20, width: 30, height: 40 });
  assert.equal(markup,
    '<rect class="area area-clear" x="10" y="20" width="30" height="40" fill="#fff"/>' +
    '<rect class="hit" x="10" y="20" width="30" height="40"/>');
  assert.doesNotMatch(markup, /blend/);
});

test('the SVG renderer draws a parsed area without diagnostics and keeps the label background first', () => {
  const model = parseS(doc('REVERSE 10,20,300,200'));
  const { svg, diagnostics } = PB.svgRenderer.render(model, { width: 1000, height: 600 }, { textScale: 1 });
  assert.deepEqual(diagnostics, []);
  assert.match(svg, /<g class="item" data-index="0"><title>REVERSE 10,20,300,200<\/title><rect class="area area-reverse"/);
  assert.ok(svg.indexOf('label-background') < svg.indexOf('area-reverse'));
});

// ---- layout (overlap and outside-the-label checks)

const fakeSvg = groups => {
  const overlaps = { innerHTML: '' };
  return { overlaps, querySelectorAll: () => groups, querySelector: () => overlaps };
};
const group = (index, bbox) => ({ dataset: { index: String(index) }, getBBox: () => bbox });

test('layout: the area counts for the outside-the-label check', () => {
  const model = { items: [{ kind: 'area', ref: 'REVERSE' }] };
  const out = PB.layout.analyze(fakeSvg([group(0, { x: 900, y: 10, width: 200, height: 100 })]), model, { width: 1000, height: 600 }, { markOverlaps: false });
  assert.equal(out.length, 1);
  assert.match(out[0].text, /^REVERSE se sale de la etiqueta/);
  assert.deepEqual(PB.layout.analyze(fakeSvg([group(0, { x: 10, y: 10, width: 200, height: 100 })]), model, { width: 1000, height: 600 }, { markOverlaps: false }), []);
});

test('layout: an area over other content is never reported as an overlap', () => {
  const model = { items: [{ kind: 'image', ref: 'IMG' }, { kind: 'area', ref: 'REVERSE' }, { kind: 'area', ref: 'ERASE' }] };
  const svg = fakeSvg([group(0, { x: 0, y: 0, width: 300, height: 300 }), group(1, { x: 100, y: 100, width: 50, height: 50 }), group(2, { x: 110, y: 110, width: 50, height: 50 })]);
  const out = PB.layout.analyze(svg, model, { width: 1000, height: 600 }, { markOverlaps: true });
  assert.deepEqual(out.filter(d => /solapa/.test(d.text)), []);
});

// ---- emit

test('TSPL emit: parsed REVERSE and ERASE are written back identically (round trip)', () => {
  for (const dpi of [203, 300]) {
    const src = doc('REVERSE 10,20,300,200', 'ERASE 40,50,160,40');
    const out = tspl.emit(parseS(src, dpi), { dpi });
    assert.deepEqual(out.diagnostics.filter(d => d.level !== 'info'), [], `@${dpi}`);
    const lines = out.text.split('\r\n');
    assert.ok(lines.includes('REVERSE 10,20,300,200'), `@${dpi}: ${out.text}`);
    assert.ok(lines.includes('ERASE 40,50,160,40'), `@${dpi}: ${out.text}`);
    assert.ok(lines.indexOf('REVERSE 10,20,300,200') < lines.indexOf('ERASE 40,50,160,40'));
    const back = parseS(out.text, dpi);
    assert.deepEqual(back.items.map(i => [i.kind, i.ref, i.mode, i.native]), parseS(src, dpi).items.map(i => [i.kind, i.ref, i.mode, i.native]));
  }
});

test('TSPL emit: the area keeps its position in command order among the other items', () => {
  const src = doc('TEXT 10,10,"3",0,1,1,"A"', 'REVERSE 5,5,100,50', 'BOX 1,1,50,50,2');
  const lines = tspl.emit(parseS(src), { dpi: 203 }).text.split('\r\n');
  const at = prefix => lines.findIndex(l => l.startsWith(prefix));
  assert.ok(at('TEXT') < at('REVERSE') && at('REVERSE') < at('BOX'), lines.join('|'));
});

test('TSPL emit: REFERENCE is folded into the coordinates; size is at least one dot; mode picks the command', () => {
  assert.ok(tspl.emit(parseS(doc('REFERENCE 5,6', 'REVERSE 10,20,30,40')), { dpi: 203 }).text.includes('REVERSE 15,26,30,40'));
  const item = { kind: 'area', mode: 'clear', x: 0, y: 0, width: 0, height: 0 };
  assert.ok(tspl.emit({ size: { width: 1000, height: 600 }, items: [item] }, { dpi: 203 }).text.split('\r\n').includes('ERASE 0,0,1,1'));
});

test('TPCL emit: a parsed XR is written back identically (round trip), in command order', () => {
  const src = tdoc('{LC;0010,0010,0100,0100,1,03|}', '{XR;0100,0200,0400,0350,B|}', '{XR;0010,0020,0050,0060,A|}');
  const out = tpcl.emit(parseP(src), { dpi: 203 });
  assert.deepEqual(out.diagnostics.filter(d => d.level === 'warning'), []);
  const lines = out.text.split('\n');
  assert.ok(lines.includes('{XR;0100,0200,0400,0350,B|}'), out.text);
  assert.ok(lines.includes('{XR;0010,0020,0050,0060,A|}'), out.text);
  assert.ok(lines.findIndex(l => l.startsWith('{LC')) < lines.indexOf('{XR;0100,0200,0400,0350,B|}'));
  const back = parseP(out.text);
  assert.deepEqual(back.items.map(i => [i.kind, i.mode, i.native]), parseP(src).items.map(i => [i.kind, i.mode, i.native]));
});

test('TPCL emit: native values are kept (reversed corners; a 5-digit Y is written with 4 digits); a model without native is written from x, y, width, height', () => {
  const kept = tpcl.emit(parseP(tdoc('{XR;0400,00350,0100,00200,B|}')), { dpi: 203 });
  assert.ok(kept.text.split('\n').includes('{XR;0400,0350,0100,0200,B|}'), kept.text);
  const fresh = tpcl.emit({ size: { width: 600, height: 800, pitch: 800 }, items: [{ kind: 'area', mode: 'clear', x: 100, y: 200, width: 300, height: 150 }] }, { dpi: 203 });
  assert.ok(fresh.text.split('\n').includes('{XR;0100,0200,0400,0350,A|}'), fresh.text);
});

// ---- move

test('TPCL move: both corners shift, the type letter stays; clamped to 0..9999 with the digit width kept', () => {
  const text = tdoc('{XR;0100,0200,0400,0350,B|}');
  const item = parseP(text).items[0];
  assert.equal(tpcl.moveItem(text, item, 50, -30, { dpi: 203 }), tdoc('{XR;0150,0170,0450,0320,B|}'));
  assert.equal(tpcl.moveItem(text, item, -500, 0, { dpi: 203 }), tdoc('{XR;0000,0200,0000,0350,B|}'));
});

test('TSPL move: only x and y change (arguments 0 and 1), size stays; both commands; REFERENCE honoured', () => {
  for (const line of ['REVERSE 10,20,300,200', 'ERASE 10,20,300,200']) {
    const text = doc(line);
    const out = tspl.moveItem(text, parseS(text).items[0], 5 * DOT[203], 7 * DOT[203], { dpi: 203 });
    assert.equal(out, doc(`${line.split(' ')[0]} 15,27,300,200`), line);
  }
  const text = doc('REFERENCE 5,5', 'REVERSE 2,3,50,40');
  assert.equal(tspl.moveItem(text, parseS(text).items[0], -100 * DOT[203], 10 * DOT[203], { dpi: 203 }), doc('REFERENCE 5,5', 'REVERSE 0,13,50,40'));
});

// ---- describeItem / updateItem

test('TPCL describeItem: x2, y2 and the mode select, with and without the text', () => {
  const text = tdoc('{XR;0100,0200,0400,0350,B|}');
  const item = parseP(text).items[0];
  const withText = tpcl.describeItem(item, text);
  assert.equal(withText.kind, 'area');
  assert.deepEqual(keys(withText), ['x2', 'y2', 'mode']);
  assert.deepEqual(withText.fields.map(f => f.value), [400, 350, 'reverse']);
  assert.deepEqual(field(withText, 'mode').options, [{ value: 'reverse', label: 'Invertir' }, { value: 'clear', label: 'Borrar' }]);
  assert.equal(field(withText, 'mode').label, 'Tipo');
  assert.deepEqual(tpcl.describeItem(item), withText);
  const clear = tdoc('{XR;0100,0200,0400,0350,A|}');
  assert.equal(field(tpcl.describeItem(parseP(clear).items[0], clear), 'mode').value, 'clear');
});

test('TPCL updateItem rewrites only the edited fields; the mode changes the type letter only', () => {
  const text = tdoc('{PC001;0010,0010,05,05,J,00,B=A|}', '{XR;0100,0200,0400,0350,B|}');
  const area = parseP(text).items[1];
  assert.equal(tpcl.updateItem(text, area, { x2: 450, y2: 300 }), tdoc('{PC001;0010,0010,05,05,J,00,B=A|}', '{XR;0100,0200,0450,0300,B|}'));
  assert.equal(tpcl.updateItem(text, area, { mode: 'clear' }), tdoc('{PC001;0010,0010,05,05,J,00,B=A|}', '{XR;0100,0200,0400,0350,A|}'));
  assert.equal(tpcl.updateItem(text, area, { mode: 'nope', x2: 'abc', zzz: 1 }), text);
  assert.equal(tpcl.updateItem(text, area, {}), text);
  const back = parseP(tpcl.updateItem(text, area, { mode: 'clear', x2: 500 })).items[1];
  assert.equal(back.mode, 'clear');
  assert.equal(back.width, 400);
});

test('TSPL describeItem: width and height in dots, with and without the text', () => {
  for (const name of ['REVERSE', 'ERASE']) {
    const text = doc(`${name} 10,20,300,200`);
    const item = parseS(text).items[0];
    const d = tspl.describeItem(item, text, { dpi: 203 });
    assert.equal(d.kind, 'area');
    assert.deepEqual(keys(d), ['width', 'height']);
    assert.deepEqual(d.fields.map(f => f.value), [300, 200]);
    assert.deepEqual(d.fields.map(f => f.label), ['Ancho (puntos)', 'Alto (puntos)']);
    assert.ok(d.fields.every(f => f.type === 'number' && f.min === 1 && f.step === 1));
    assert.deepEqual(tspl.describeItem(item, undefined, { dpi: 203 }), d);
  }
});

test('TSPL updateItem rewrites only the edited arguments and keeps every other line', () => {
  const text = doc('TEXT 10,10,"3",0,1,1,"A,B"', 'REVERSE 10,20,300,200', 'ERASE 5,5,100,30');
  const [, rev, era] = parseS(text).items;
  assert.equal(tspl.updateItem(text, rev, { width: 250, height: 150 }, { dpi: 203 }), doc('TEXT 10,10,"3",0,1,1,"A,B"', 'REVERSE 10,20,250,150', 'ERASE 5,5,100,30'));
  assert.equal(tspl.updateItem(text, era, { height: 0 }, { dpi: 203 }), doc('TEXT 10,10,"3",0,1,1,"A,B"', 'REVERSE 10,20,300,200', 'ERASE 5,5,100,1'));
  assert.equal(tspl.updateItem(text, rev, { width: 'abc', nope: 1 }, { dpi: 203 }), text);
});

// ---- palette

test('both languages offer ONE area entry, Área invertida, after the other components', () => {
  for (const lang of [tspl, tpcl]) {
    const entries = lang.componentTemplates();
    assert.deepEqual(entries[entries.length - 1], { kind: 'area', label: 'Área invertida' });
    assert.equal(entries.filter(e => e.kind === 'area').length, 1);
  }
  assert.deepEqual(PB.ui.paletteEntries(tspl, { kind: 'image', label: 'Imagen' }).slice(-3).map(e => e.kind), ['circle', 'area', 'image']);
  assert.equal(tspl.componentTemplates().at(-2).kind, 'circle');
  assert.equal(tpcl.componentTemplates().at(-2).kind, 'box');
});

test('TSPL build inserts one REVERSE (30 x 10 mm) after the drawn items and right before PRINT, at the drop point', () => {
  for (const dpi of [203, 300]) {
    const dot = DOT[dpi];
    const mm = n => Math.max(1, Math.round(n / dot));
    const x = Math.round(100 / dot);
    const out = tspl.buildComponent(doc('TEXT 10,10,"3",0,1,1,"A"'), 'area', { x: 100, y: 100 }, { dpi });
    const lines = out.split('\r\n');
    assert.ok(lines.includes(`REVERSE ${x},${x},${mm(300)},${mm(100)}`), `@${dpi}: ${out}`);
    assert.match(lines[lines.indexOf('PRINT 1,1') - 1], /^REVERSE /);
    assert.ok(lines.findIndex(l => l.startsWith('TEXT')) < lines.findIndex(l => l.startsWith('REVERSE')));
    const model = parseS(out, dpi);
    assert.deepEqual(model.diagnostics, []);
    assert.equal(model.items[1].mode, 'reverse');
    assert.ok(Math.abs(model.items[1].x - 100) <= dot);
  }
  const ref = tspl.buildComponent(doc('REFERENCE 10,10'), 'area', { x: 100, y: 5 }, { dpi: 203 });
  assert.match(ref.split('\r\n').find(l => l.startsWith('REVERSE')), /^REVERSE 70,0,/);
});

test('TPCL build inserts one {XR;...,B|} 30 x 10 mm at the drop point, before the print command and after the drawn items', () => {
  const text = tdoc('{LC;0010,0010,0100,0100,1,03|}');
  const out = tpcl.buildComponent(text, 'area', { x: 100, y: 200 }, { dpi: 203 });
  const lines = out.split('\n');
  assert.ok(lines.includes('{XR;0100,0200,0400,0300,B|}'), out);
  assert.ok(lines.findIndex(l => l.startsWith('{LC')) < lines.indexOf('{XR;0100,0200,0400,0300,B|}'));
  assert.ok(lines.indexOf('{XR;0100,0200,0400,0300,B|}') < lines.findIndex(l => l.startsWith('{XS')));
  const model = parseP(out);
  assert.deepEqual(model.diagnostics, []);
  assert.equal(model.items[1].mode, 'reverse');
  // Clamped so that it stays inside 0..9999
  assert.ok(tpcl.buildComponent(text, 'area', { x: 9990, y: 9990 }, { dpi: 203 }).includes('{XR;9699,9899,9999,9999,B|}'));
});

test('the palette glyph comes from the slice', () => {
  assert.ok(PB.components.get('area').glyph);
});

// ---- conversion

test('TSPL -> TPCL: REVERSE becomes XR type B and ERASE type A, with the unit conversion at the dpi', () => {
  for (const dpi of [203, 300]) {
    const out = PB.convert.run(doc('REVERSE 10,20,300,200', 'ERASE 40,50,160,40'), 'tpcl', { dpi });
    assert.deepEqual(out.diagnostics.filter(d => d.level === 'warning'), [], `@${dpi}`);
    const back = parseP2(out.text, dpi);
    const [rev, era] = back.items;
    assert.deepEqual([rev.kind, rev.mode, era.mode], ['area', 'reverse', 'clear']);
    assert.ok(Math.abs(rev.x - 10 * DOT[dpi]) <= 0.5 + 1e-6 && Math.abs(rev.width - 300 * DOT[dpi]) <= 1 + 1e-6, `@${dpi}`);
    assert.ok(Math.abs(era.height - 40 * DOT[dpi]) <= 1 + 1e-6, `@${dpi}`);
    assert.match(out.text, /\{XR;\d{4},\d{4,5},\d{4},\d{4,5},B\|\}/);
    assert.match(out.text, /\{XR;\d{4},\d{4,5},\d{4},\d{4,5},A\|\}/);
  }
});
const parseP2 = (text, dpi) => tpcl.parse(text, { dpi });

test('TPCL -> TSPL: XR type B becomes REVERSE and type A ERASE, in dots at the dpi', () => {
  for (const dpi of [203, 300]) {
    const dot = DOT[dpi];
    const out = PB.convert.run(tdoc('{XR;0100,0200,0400,0350,B|}', '{XR;0010,0020,0050,0060,A|}'), 'tspl', { dpi });
    assert.deepEqual(out.diagnostics.filter(d => d.level === 'warning'), [], `@${dpi}`);
    const lines = out.text.split('\r\n');
    const d = v => Math.round(v / dot);
    assert.ok(lines.includes(`REVERSE ${d(100)},${d(200)},${Math.max(1, d(300))},${Math.max(1, d(150))}`), `@${dpi}: ${out.text}`);
    assert.ok(lines.includes(`ERASE ${d(10)},${d(20)},${Math.max(1, d(40))},${Math.max(1, d(40))}`), `@${dpi}: ${out.text}`);
  }
});

test('TPCL -> TPCL and TSPL -> TSPL conversions keep the areas', () => {
  assert.ok(PB.convert.run(tdoc('{XR;0100,0200,0400,0350,B|}'), 'tpcl', { dpi: 203 }).text.includes('{XR;0100,0200,0400,0350,B|}'));
  const t = PB.convert.run(doc('REVERSE 10,20,300,200', 'ERASE 1,2,3,4'), 'tspl', { dpi: 203 }).text;
  assert.ok(t.includes('REVERSE 10,20,300,200') && t.includes('ERASE 1,2,3,4'));
});
