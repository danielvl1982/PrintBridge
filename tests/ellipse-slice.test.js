const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// A2 ellipse and circle (TSPL only): ELLIPSE x,y,width,height,thickness and CIRCLE x,y,diameter,thickness (dots).
// NOT VERIFIED ON A PRINTER: both commands come from the TSC TSPL2 manual v3.0, which is not available locally.
// Neutral item: { kind: 'ellipse', ref: 'ELLIPSE' | 'CIRCLE', x, y, width, height, thickness } in 0.1 mm (x, y = top-left).
// The circle is the same model kind with ref CIRCLE, so the emitter writes CIRCLE back; two slices (`ellipse`, `circle`)
// share the kind, the way line and box do.
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');
const tpcl = PB.languages.get('tpcl');
const DOT = { 203: PB.units.dotSize(203), 300: PB.units.dotSize(300) };

const HEAD = 'SIZE 100 mm,60 mm\r\nCLS\r\n';
const TAIL = 'PRINT 1,1\r\n';
const doc = (...lines) => HEAD + lines.join('\r\n') + '\r\n' + TAIL;
const parse = (text, dpi = 203) => tspl.parse(text, { dpi });
const first = (text, dpi = 203) => parse(text, dpi).items[0];
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} vs ${b}`);
const keys = d => d.fields.map(f => f.key);
const field = (d, key) => d.fields.find(f => f.key === key);
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);

// ---- parse

test('ELLIPSE parses into a neutral ellipse item (top-left, size and thickness in 0.1 mm, native in dots)', () => {
  const model = parse(doc('ELLIPSE 10,20,300,200,3'));
  assert.deepEqual(model.diagnostics, []);
  assert.equal(model.items.length, 1);
  const item = model.items[0];
  assert.equal(item.kind, 'ellipse');
  assert.equal(item.ref, 'ELLIPSE');
  near(item.x, 10 * DOT[203], 'x');
  near(item.y, 20 * DOT[203], 'y');
  near(item.width, 300 * DOT[203], 'width');
  near(item.height, 200 * DOT[203], 'height');
  near(item.thickness, 3 * DOT[203], 'thickness');
  assert.deepEqual(item.native, { width: 300, height: 200, thickness: 3, kind: 'ELLIPSE' });
  assert.equal(item.source.label, 'ELLIPSE 10,20,300,200,3');
});

test('CIRCLE parses into an ellipse item with equal axes that keeps ref CIRCLE', () => {
  const model = parse(doc('CIRCLE 10,20,160,4'), 300);
  assert.deepEqual(model.diagnostics, []);
  const item = model.items[0];
  assert.equal(item.kind, 'ellipse');
  assert.equal(item.ref, 'CIRCLE');
  near(item.width, 160 * DOT[300], 'width');
  near(item.height, 160 * DOT[300], 'height');
  near(item.thickness, 4 * DOT[300], 'thickness');
  assert.deepEqual(item.native, { diameter: 160, thickness: 4, kind: 'CIRCLE' });
});

test('commands are case-insensitive and tolerate blanks around the arguments', () => {
  assert.equal(first(doc('ellipse 10, 20, 300, 200, 3')).ref, 'ELLIPSE');
  assert.equal(first(doc('circle 10 ,20 ,100 ,2')).ref, 'CIRCLE');
});

test('REFERENCE and SHIFT move the position, not the size', () => {
  const item = first(doc('REFERENCE 5,6', 'SHIFT 1,2', 'ELLIPSE 10,20,300,200,3'));
  near(item.x, 16 * DOT[203], 'x');
  near(item.y, 28 * DOT[203], 'y');
  near(item.width, 300 * DOT[203], 'width');
  const circle = first(doc('REFERENCE 5,6', 'CIRCLE 10,20,100,3'));
  near(circle.x, 15 * DOT[203], 'circle x');
  near(circle.y, 26 * DOT[203], 'circle y');
});

test('short or invalid arguments give one Spanish warning and no item', () => {
  const bad = [
    ['ELLIPSE 10,20,300,200', /^ELLIPSE incompleto: /],
    ['ELLIPSE 10,20', /^ELLIPSE incompleto: /],
    ['ELLIPSE 10,20,abc,200,3', /^ELLIPSE con valores no válidos: /],
    ['ELLIPSE 10,20,0,200,3', /^ELLIPSE con valores no válidos: /],
    ['ELLIPSE 10,20,300,-5,3', /^ELLIPSE con valores no válidos: /],
    ['ELLIPSE 10,20,300,200,0', /^ELLIPSE con valores no válidos: /],
    ['CIRCLE 10,20,100', /^CIRCLE incompleto: /],
    ['CIRCLE 10,20,x,3', /^CIRCLE con valores no válidos: /],
    ['CIRCLE 10,20,0,3', /^CIRCLE con valores no válidos: /],
    ['CIRCLE 10,20,100,0', /^CIRCLE con valores no válidos: /],
  ];
  for (const [line, pattern] of bad) {
    const model = parse(doc(line));
    assert.equal(model.items.length, 0, line);
    assert.equal(warnings(model).length, 1, line);
    assert.match(warnings(model)[0], pattern, line);
  }
});

test('ELLIPSE and CIRCLE are no longer unsupported commands', () => {
  for (const line of ['ELLIPSE 10,10,100,50,3', 'CIRCLE 10,10,80,3']) {
    assert.doesNotMatch(parse(doc(line)).diagnostics.map(d => d.text).join('|'), /no soportado/, line);
  }
  // ERASE and REVERSE still are (task A3)
  for (const line of ['ERASE 10,10,100,50', 'REVERSE 10,10,100,50']) {
    assert.match(warnings(parse(doc(line)))[0], /^Comando no soportado por el visor: /, line);
  }
});

test('the other items of the label are untouched next to an ellipse, in command order', () => {
  const model = parse(doc('TEXT 10,10,"3",0,1,1,"A"', 'ELLIPSE 10,50,100,60,2', 'BOX 1,1,50,50,2', 'CIRCLE 5,5,40,2'));
  assert.deepEqual(model.items.map(i => i.kind), ['text', 'ellipse', 'line', 'ellipse']);
});

// ---- registry

test('two slices share the ellipse model kind: ellipse and circle (selected by ref)', () => {
  const ellipse = PB.components.get('ellipse');
  const circle = PB.components.get('circle');
  assert.ok(ellipse && circle);
  assert.equal(ellipse.modelKind, 'ellipse');
  assert.equal(circle.modelKind, 'ellipse');
  assert.equal(PB.components.forItem({ kind: 'ellipse', ref: 'ELLIPSE' }).kind, 'ellipse');
  assert.equal(PB.components.forItem({ kind: 'ellipse', ref: 'CIRCLE' }).kind, 'circle');
  assert.equal(ellipse.carriesData, false);
  assert.equal(circle.carriesData, false);
  // After the box (50) and before the image (60) in the registry order
  const kinds = PB.components.kinds();
  assert.ok(kinds.indexOf('box') < kinds.indexOf('ellipse') && kinds.indexOf('ellipse') < kinds.indexOf('circle') && kinds.indexOf('circle') < kinds.indexOf('image'));
});

test('the neutral validator has nothing to say about a parsed ellipse or circle', () => {
  assert.deepEqual(PB.validator.validate(parse(doc('ELLIPSE 10,20,300,200,3', 'CIRCLE 5,5,40,2')), tspl), []);
});

// ---- render

const draw = item => PB.components.forItem(item).render(item, { n: v => Math.round(v * 100) / 100 });

test('render: a stroke-only <ellipse> inside the bounding box, the stroke centred on the box edge', () => {
  const { markup } = draw({ kind: 'ellipse', ref: 'ELLIPSE', x: 100, y: 200, width: 400, height: 200, thickness: 3 });
  assert.equal(markup, '<ellipse cx="300" cy="300" rx="200" ry="100" class="stroke" stroke-width="3"/>');
});

test('render: a circle is drawn with equal radii and a thickness below 1 is drawn as 1', () => {
  const { markup } = draw({ kind: 'ellipse', ref: 'CIRCLE', x: 50, y: 50, width: 200, height: 200, thickness: 0.2 });
  assert.equal(markup, '<ellipse cx="150" cy="150" rx="100" ry="100" class="stroke" stroke-width="1"/>');
});

test('the SVG renderer draws a parsed ellipse and circle without diagnostics', () => {
  const model = parse(doc('ELLIPSE 10,20,300,200,3', 'CIRCLE 400,20,100,3'));
  const { svg, diagnostics } = PB.svgRenderer.render(model, { width: 1000, height: 600 }, { textScale: 1 });
  assert.deepEqual(diagnostics, []);
  assert.equal((svg.match(/<ellipse /g) || []).length, 2);
  assert.match(svg, /<g class="item" data-index="0"><title>ELLIPSE 10,20,300,200,3<\/title><ellipse /);
});

// ---- layout (overlap and outside-the-label checks)

const fakeSvg = groups => {
  const overlaps = { innerHTML: '' };
  return { overlaps, querySelectorAll: () => groups, querySelector: () => overlaps };
};
const group = (index, bbox) => ({ dataset: { index: String(index) }, getBBox: () => bbox });

test('layout: the bounding box takes part in the outside-the-label check', () => {
  const model = { items: [{ kind: 'ellipse', ref: 'ELLIPSE' }] };
  const svg = fakeSvg([group(0, { x: 900, y: 10, width: 200, height: 100 })]);
  const out = PB.layout.analyze(svg, model, { width: 1000, height: 600 }, { markOverlaps: false });
  assert.equal(out.length, 1);
  assert.match(out[0].text, /^ELLIPSE se sale de la etiqueta/);
  const inside = fakeSvg([group(0, { x: 10, y: 10, width: 200, height: 100 })]);
  assert.deepEqual(PB.layout.analyze(inside, model, { width: 1000, height: 600 }, { markOverlaps: false }), []);
});

test('layout: like boxes, an ellipse around other content is not reported as an overlap', () => {
  const model = { items: [{ kind: 'ellipse', ref: 'CIRCLE' }, { kind: 'image', ref: 'IMG' }] };
  const svg = fakeSvg([group(0, { x: 0, y: 0, width: 300, height: 300 }), group(1, { x: 100, y: 100, width: 50, height: 50 })]);
  assert.deepEqual(PB.layout.analyze(svg, model, { width: 1000, height: 600 }, { markOverlaps: true }), []);
});

// ---- emit

test('emit: a parsed ELLIPSE and CIRCLE are written back identically (round trip)', () => {
  for (const dpi of [203, 300]) {
    const src = doc('ELLIPSE 10,20,300,200,3', 'CIRCLE 40,50,160,4');
    const out = tspl.emit(parse(src, dpi), { dpi });
    assert.deepEqual(out.diagnostics.filter(d => d.level !== 'info'), [], `@${dpi}`);
    const lines = out.text.split('\r\n');
    assert.ok(lines.includes('ELLIPSE 10,20,300,200,3'), `@${dpi}: ${out.text}`);
    assert.ok(lines.includes('CIRCLE 40,50,160,4'), `@${dpi}: ${out.text}`);
    const back = parse(out.text, dpi);
    assert.deepEqual(back.items.map(i => [i.kind, i.ref, i.native]), parse(src, dpi).items.map(i => [i.kind, i.ref, i.native]), `@${dpi}`);
  }
});

test('emit: REFERENCE is folded into the coordinates and never written', () => {
  const out = tspl.emit(parse(doc('REFERENCE 5,6', 'ELLIPSE 10,20,300,200,3')), { dpi: 203 });
  assert.ok(out.text.includes('ELLIPSE 15,26,300,200,3'));
  assert.doesNotMatch(out.text, /REFERENCE/);
});

test('emit: a circle whose axes differ is written as ELLIPSE; an item without ref is an ELLIPSE', () => {
  const dot = DOT[203];
  const item = { kind: 'ellipse', ref: 'CIRCLE', x: 10 * dot, y: 10 * dot, width: 100 * dot, height: 60 * dot, thickness: 2 * dot };
  const out = tspl.emit({ size: { width: 1000, height: 600 }, items: [item, { ...item, ref: undefined }] }, { dpi: 203 });
  const lines = out.text.split('\r\n');
  assert.equal(lines.filter(l => l === 'ELLIPSE 10,10,100,60,2').length, 2, out.text);
  assert.ok(!lines.some(l => l.startsWith('CIRCLE')));
});

test('emit: size and thickness are at least one dot', () => {
  const item = { kind: 'ellipse', ref: 'ELLIPSE', x: 0, y: 0, width: 0, height: 0, thickness: 0 };
  const out = tspl.emit({ size: { width: 1000, height: 600 }, items: [item] }, { dpi: 203 });
  assert.ok(out.text.split('\r\n').includes('ELLIPSE 0,0,1,1,1'), out.text);
});

// ---- move

test('move: only x and y change (arguments 0 and 1), size and thickness stay; both commands', () => {
  for (const line of ['ELLIPSE 10,20,300,200,3', 'CIRCLE 10,20,100,3']) {
    const text = doc(line);
    const item = first(text);
    const out = tspl.moveItem(text, item, 5 * DOT[203], 7 * DOT[203], { dpi: 203 });
    const [name, args] = line.split(' ');
    const rest = args.split(',').slice(2).join(',');
    assert.equal(out, doc(`${name} 15,27,${rest}`), line);
  }
});

test('move: never goes below 0 and honours REFERENCE', () => {
  const text = doc('REFERENCE 5,5', 'ELLIPSE 2,3,50,40,1');
  const out = tspl.moveItem(text, first(text), -100 * DOT[203], 10 * DOT[203], { dpi: 203 });
  assert.equal(out, doc('REFERENCE 5,5', 'ELLIPSE 0,13,50,40,1'));
});

// ---- describeItem / updateItem

test('describeItem: ELLIPSE lists width, height and thickness in dots', () => {
  const text = doc('ELLIPSE 10,20,300,200,3');
  const d = tspl.describeItem(first(text), text, { dpi: 203 });
  assert.equal(d.kind, 'ellipse');
  assert.deepEqual(keys(d), ['width', 'height', 'thickness']);
  assert.deepEqual(d.fields.map(f => f.value), [300, 200, 3]);
  assert.ok(d.fields.every(f => f.type === 'number' && f.min === 1 && f.step === 1));
  assert.deepEqual(d.fields.map(f => f.label), ['Ancho (puntos)', 'Alto (puntos)', 'Grosor (puntos)']);
});

test('describeItem: CIRCLE lists diameter and thickness', () => {
  const text = doc('CIRCLE 10,20,100,3');
  const d = tspl.describeItem(first(text), text, { dpi: 203 });
  assert.deepEqual(keys(d), ['diameter', 'thickness']);
  assert.deepEqual(d.fields.map(f => f.value), [100, 3]);
  assert.equal(field(d, 'diameter').label, 'Diámetro (puntos)');
});

test('describeItem without the text falls back to the native values', () => {
  const e = tspl.describeItem(first(doc('ELLIPSE 10,20,300,200,3')), undefined, { dpi: 203 });
  assert.deepEqual(e.fields.map(f => f.value), [300, 200, 3]);
  const c = tspl.describeItem(first(doc('CIRCLE 10,20,100,3')), undefined, { dpi: 203 });
  assert.deepEqual(c.fields.map(f => f.value), [100, 3]);
});

test('updateItem rewrites only the edited arguments and keeps every other line', () => {
  const text = doc('TEXT 10,10,"3",0,1,1,"A,B"', 'ELLIPSE 10,20,300,200,3', 'CIRCLE 5,5,100,3');
  const model = parse(text);
  const [, ellipse, circle] = model.items;
  const changed = tspl.updateItem(text, ellipse, { width: 250, height: 150, thickness: 5 }, { dpi: 203 });
  assert.equal(changed, doc('TEXT 10,10,"3",0,1,1,"A,B"', 'ELLIPSE 10,20,250,150,5', 'CIRCLE 5,5,100,3'));
  const round = tspl.updateItem(text, circle, { diameter: 80, thickness: 2 }, { dpi: 203 });
  assert.equal(round, doc('TEXT 10,10,"3",0,1,1,"A,B"', 'ELLIPSE 10,20,300,200,3', 'CIRCLE 5,5,80,2'));
});

test('updateItem clamps to the valid range, ignores unknown keys and non-numbers', () => {
  const text = doc('ELLIPSE 10,20,300,200,3');
  const item = first(text);
  assert.equal(tspl.updateItem(text, item, { width: 0 }, { dpi: 203 }), doc('ELLIPSE 10,20,1,200,3'));
  assert.equal(tspl.updateItem(text, item, { width: 'abc', diameter: 5, nope: 1 }, { dpi: 203 }), text);
  assert.equal(tspl.updateItem(text, item, {}, { dpi: 203 }), text);
});

test('an edited circle parses back as the same circle with the new diameter', () => {
  const text = doc('CIRCLE 10,20,100,3');
  const out = tspl.updateItem(text, first(text), { diameter: 64 }, { dpi: 203 });
  const back = first(out);
  assert.equal(back.ref, 'CIRCLE');
  near(back.width, 64 * DOT[203], 'width');
  near(back.height, 64 * DOT[203], 'height');
});

// ---- palette

test('TSPL offers Elipse and Círculo after Caja; TPCL offers neither', () => {
  const tsplKinds = tspl.componentTemplates();
  assert.deepEqual(tsplKinds.slice(-2), [{ kind: 'ellipse', label: 'Elipse' }, { kind: 'circle', label: 'Círculo' }]);
  assert.equal(tsplKinds[tsplKinds.length - 3].kind, 'box');
  assert.ok(!tpcl.componentTemplates().some(c => /ellipse|circle/.test(c.kind)));
  const entries = PB.ui.paletteEntries(tspl, { kind: 'image', label: 'Imagen' });
  assert.deepEqual(entries.slice(-3).map(e => e.kind), ['ellipse', 'circle', 'image']);
  assert.equal(tpcl.buildComponent('{D0100,0100,0100|}\r\n', 'ellipse', { x: 100, y: 100 }, { dpi: 203 }), '{D0100,0100,0100|}\r\n');
});

test('the palette glyphs of both entries come from their slices', () => {
  assert.ok(PB.components.get('ellipse').glyph);
  assert.ok(PB.components.get('circle').glyph);
});

test('build inserts one ELLIPSE (30 x 20 mm, 3 dots) or CIRCLE (20 mm, 3 dots) right before PRINT at the drop point', () => {
  for (const dpi of [203, 300]) {
    const dot = DOT[dpi];
    const mm = n => Math.max(1, Math.round(n / dot));
    const point = { x: 100, y: 100 };
    const x = Math.round(100 / dot);

    const e = tspl.buildComponent(doc('TEXT 10,10,"3",0,1,1,"A"'), 'ellipse', point, { dpi });
    assert.ok(e.split('\r\n').includes(`ELLIPSE ${x},${x},${mm(300)},${mm(200)},3`), `@${dpi}: ${e}`);
    const lines = e.split('\r\n');
    assert.match(lines[lines.indexOf('PRINT 1,1') - 1], /^ELLIPSE /);
    assert.deepEqual(parse(e, dpi).diagnostics, []);
    const item = parse(e, dpi).items[1];
    assert.equal(item.ref, 'ELLIPSE');
    assert.ok(Math.abs(item.x - 100) <= dot && Math.abs(item.y - 100) <= dot);

    const c = tspl.buildComponent(doc('TEXT 10,10,"3",0,1,1,"A"'), 'circle', point, { dpi });
    assert.ok(c.split('\r\n').includes(`CIRCLE ${x},${x},${mm(200)},3`), `@${dpi}: ${c}`);
    const circle = parse(c, dpi).items[1];
    assert.equal(circle.ref, 'CIRCLE');
    assert.ok(Math.abs(circle.width - 200) <= dot);
  }
});

test('build subtracts REFERENCE and SHIFT like the other entries and never goes below 0', () => {
  const out = tspl.buildComponent(doc('REFERENCE 10,10'), 'circle', { x: 100, y: 5 }, { dpi: 203 });
  const line = out.split('\r\n').find(l => l.startsWith('CIRCLE'));
  assert.match(line, /^CIRCLE 70,0,/);
});

// ---- TPCL conversion

test('TSPL -> TPCL skips ellipses and circles with one warning, once', () => {
  const src = doc('TEXT 10,10,"3",0,1,1,"A"', 'ELLIPSE 10,50,100,60,2', 'CIRCLE 5,5,40,2', 'ELLIPSE 1,1,10,10,1');
  const out = PB.convert.run(src, 'tpcl', { dpi: 203 });
  const bad = out.diagnostics.filter(d => d.level === 'warning');
  assert.equal(bad.length, 1, JSON.stringify(out.diagnostics));
  assert.match(bad[0].text, /elipses y círculos/i);
  assert.doesNotMatch(out.text, /ELLIPSE|CIRCLE/);
  assert.doesNotMatch(bad[0].text, /sin emisor/);
  // The rest of the label is still converted
  assert.equal(PB.languages.get('tpcl').parse(out.text, { dpi: 203 }).items.length, 1);
});

test('a label without ellipses converts without that warning', () => {
  const out = PB.convert.run(doc('TEXT 10,10,"3",0,1,1,"A"'), 'tpcl', { dpi: 203 });
  assert.ok(!out.diagnostics.some(d => /elipses/i.test(d.text)));
});

test('TSPL -> TSPL conversion keeps ellipses and circles', () => {
  const out = PB.convert.run(doc('ELLIPSE 10,20,300,200,3', 'CIRCLE 40,50,160,4'), 'tspl', { dpi: 203 });
  assert.ok(out.text.includes('ELLIPSE 10,20,300,200,3'));
  assert.ok(out.text.includes('CIRCLE 40,50,160,4'));
});
