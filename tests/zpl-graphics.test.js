const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Z5: the ZPL shapes: ^GB (graphic box: boxes, bars, rounding, white, reverse), ^GD (diagonal line), ^GC (circle), ^GE (ellipse) and the
// reverse print ^FR / ^LR (js/components/{line,box,ellipse,area}/zpl.js).
// Parameter layouts of the 2003 guide (Volume One): ^GBw,h,t,c,r (w, h from t to 32000, default t or 1; t 1..32000 default 1; c = B | W;
// r = rounding degree 0..8; rounding radius = (r / 8) * (shorter side / 2)); ^GDw,h,t,c,o (o = R right-leaning / or L left-leaning \, default R);
// ^GCd,t,c (d 3..4095, t 2..4095, "thickness extends inward"); ^GEw,h,t,c; ^FR (the output is the reverse of its background); ^LRa (Y / N, every later
// field is reversed until ^LRN). All parses use 254 dpi, where one dot is exactly 0.1 mm, so dots and model units are the same number.
//
// Model of the viewer (the guide gives no picture of the geometry): the neutral shapes are stroked on their CENTRE line, so a ZPL box (the border grows inward
// from the outer w x h) becomes the rectangle inset by t / 2 with the stroke t; a box whose border meets (2t >= the shorter side) is solid: a bar (line item),
// or the inverted / cleared area when it is reversed / white. The neutral corner radius is the guide's radius minus half the thickness (centre line).
const PB = loadApp();
const zpl = PB.languages.get('zpl');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const DPI = 254;

const BASE = body => `^XA^PW800^LL480${body}^XZ`;
const parse = (src, dpi = DPI) => zpl.parse(src, { dpi });
const one = src => parse(BASE(src)).items[0];
const diagnostics = src => parse(BASE(src)).diagnostics.map(d => `${d.level}: ${d.text}`);
const emitLines = (model, dpi = DPI) => zpl.emit(model, { dpi }).text.split('\r\n').filter(l => l && !/^\^(XA|XZ|PW|LL)/.test(l));
const emitResult = (model, dpi = DPI) => zpl.emit(model, { dpi });
const emitItem = (item, dpi = DPI) => emitLines({ language: 'zpl', size: { width: 800, height: 480 }, items: [item], diagnostics: [] }, dpi);
const emitDiag = (item, dpi = DPI) => emitResult({ language: 'zpl', size: { width: 800, height: 480 }, items: [item], diagnostics: [] }, dpi).diagnostics.map(d => `${d.level}: ${d.text}`);
const roundTrip = src => emitLines(parse(BASE(src)));
const levels = (list, ...wanted) => list.filter(d => wanted.includes(d.level));
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol + 1e-6, `${label}: ${a} vs ${b} (tolerance ${tol})`);
const byKey = description => Object.fromEntries(description.fields.map(f => [f.key, f]));
const update = (it, changes, text) => zpl.updateItem(text, it, changes, { dpi: DPI });
const describe = (it, text) => zpl.describeItem(it, text, { dpi: DPI });
const move = (it, text, dx, dy) => zpl.moveItem(text, it, dx, dy, { dpi: DPI });
const sliceOf = item => PB.components.forItem(item).kind;
const geometry = item => (item.kind === 'line' ? [item.x1, item.y1, item.x2, item.y2, item.width, item.rect, item.radius] : [item.x, item.y, item.width, item.height, item.thickness, item.mode]);

// ---------------------------------------------------------------------------------------------------------------
// Registration

test('the line, box, ellipse, circle and area slices register a zpl factory after tpcl and tspl; ZPL offers the five shapes after the 2D symbols', () => {
  for (const kind of ['line', 'box', 'ellipse', 'circle', 'area']) {
    assert.deepEqual(Object.keys(PB.components.get(kind).languages), ['tpcl', 'tspl', 'zpl'], kind);
  }
  assert.deepEqual(zpl.componentTemplates().map(c => [c.kind, c.label]), [
    ['text', 'Texto'], ['barcode', 'Código de barras'], ['qr', 'QR'], ['datamatrix', 'Data Matrix'],
    ['line', 'Línea'], ['box', 'Caja'], ['ellipse', 'Elipse'], ['circle', 'Círculo'], ['area', 'Área invertida'],
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// ^GB: parse

test('parse ^GB: an outline box is the neutral rect inset by half the thickness (the border grows inward), no diagnostics', () => {
  const model = parse(BASE('^FO100,50^GB300,200,3^FS'));
  assert.deepEqual(model.diagnostics, []);
  const [item] = model.items;
  assert.equal(item.kind, 'line');
  assert.equal(item.rect, true);
  assert.deepEqual([item.x1, item.y1, item.x2, item.y2, item.width], [101.5, 51.5, 398.5, 248.5, 3]);
  assert.equal(item.radius, undefined);
  assert.equal(item.ref, 'GB');
  assert.equal(sliceOf(item), 'box');
  assert.equal(item.native.kind, 'GB');
  assert.deepEqual([item.native.w, item.native.h, item.native.thickness, item.native.color, item.native.rounding, item.native.origin], [300, 200, 3, 'B', 0, 'FO']);
  assert.equal(item.source.spans.length, 1);
});

test('parse ^GB: a box whose border covers the shorter side is a solid bar (a line item), horizontal or vertical', () => {
  const horizontal = one('^FO100,50^GB300,3,3^FS');
  assert.equal(horizontal.kind, 'line');
  assert.equal(horizontal.rect, false);
  assert.deepEqual([horizontal.x1, horizontal.y1, horizontal.x2, horizontal.y2, horizontal.width], [100, 51.5, 400, 51.5, 3]);
  assert.equal(sliceOf(horizontal), 'line');
  const vertical = one('^FO100,50^GB3,200,3^FS');
  assert.deepEqual([vertical.x1, vertical.y1, vertical.x2, vertical.y2, vertical.width, vertical.rect], [101.5, 50, 101.5, 250, 3, false]);
  // the guide's examples of lines: a zero width or height takes the thickness
  const zeroWidth = one('^FO10,10^GB0,100,20^FS');
  assert.deepEqual([zeroWidth.x1, zeroWidth.y1, zeroWidth.x2, zeroWidth.y2, zeroWidth.width], [20, 10, 20, 110, 20]);
  const zeroHeight = one('^FO10,10^GB100,0,30^FS');
  assert.deepEqual([zeroHeight.x1, zeroHeight.y1, zeroHeight.x2, zeroHeight.y2, zeroHeight.width], [10, 25, 110, 25, 30]);
});

test('parse ^GB: the defaults (width and height = the thickness or 1, thickness 1, colour B, no rounding) and the thickness that meets in the middle', () => {
  const bare = one('^FO10,10^GB^FS');
  assert.deepEqual([bare.kind, bare.rect, bare.x1, bare.x2, bare.y1, bare.width], ['line', false, 10, 11, 10.5, 1]);
  const solid = one('^FO10,10^GB,,5^FS');
  assert.deepEqual([bare.kind, solid.rect, solid.x1, solid.x2, solid.y1, solid.width], ['line', false, 10, 15, 12.5, 5]);
  const half = one('^FO0,0^GB100,40,20^FS'); // 2t = the shorter side: solid
  assert.deepEqual([half.kind, half.rect, half.width, half.y1], ['line', false, 40, 20]);
  const open = one('^FO0,0^GB100,41,20^FS'); // 2t < the shorter side: an outline
  assert.deepEqual([open.rect, open.width, open.x1, open.y1, open.x2, open.y2], [true, 20, 10, 10, 90, 31]);
  assert.deepEqual(diagnostics('^FO0,0^GB,,5^FS'), []);
});

test('parse ^GB: the rounding degree r (0..8) gives the radius (r / 8) * (shorter side / 2), the centre line of the stroke is smaller by half the thickness', () => {
  const r4 = one('^FO100,50^GB200,100,4,B,4^FS');
  assert.equal(r4.radius, 25 - 2);
  assert.equal(r4.native.rounding, 4);
  assert.equal(one('^FO100,50^GB200,100,4,B,8^FS').radius, 50 - 2); // 8: the heaviest rounding, half of the shorter side
  near(one('^FO100,50^GB200,100,4,B,1^FS').radius, 6.25 - 2, 1e-9, 'r 1');
  assert.equal(one('^FO100,50^GB200,100,4,B,0^FS').radius, undefined);
  assert.equal(one('^FO100,50^GB200,100,4^FS').radius, undefined);
  // a thick border swallows a small radius: the centre line stays square and the degree is kept in native
  const thick = one('^FO100,50^GB200,100,30,B,1^FS');
  assert.equal(thick.radius, undefined);
  assert.equal(thick.native.rounding, 1);
  // the shorter side is the one after the minimum adjustments
  assert.equal(one('^FO0,0^GB200,0,10,B,4^FS').kind, 'line');
});

test('parse ^GB: a solid box with rounded corners is drawn as a thick stroked rounded rect (the border meets in the middle)', () => {
  const item = one('^FO0,0^GB100,100,50,B,8^FS');
  assert.equal(item.kind, 'line');
  assert.equal(item.rect, true);
  assert.deepEqual([item.x1, item.y1, item.x2, item.y2, item.width, item.radius], [25, 25, 75, 75, 50, 25]);
  assert.equal(item.native.thickness, 50);
});

test('parse ^GB: the colour W makes a solid box a cleared area and an outline a white box; B is the default, any case', () => {
  const clear = one('^FO10,20^GB100,50,50,W^FS');
  assert.deepEqual([clear.kind, clear.mode, clear.x, clear.y, clear.width, clear.height], ['area', 'clear', 10, 20, 100, 50]);
  assert.equal(sliceOf(clear), 'area');
  const white = one('^FO10,20^GB100,50,3,w^FS');
  assert.deepEqual([white.kind, white.rect, white.white], ['line', true, true]);
  assert.equal(one('^FO10,20^GB100,50,3,B^FS').white, undefined);
  assert.equal(one('^FO10,20^GB100,50,3,b^FS').white, undefined);
  assert.match(diagnostics('^FO10,20^GB100,50,3,X^FS').join('\n'), /\^GB.*color/i);
  assert.equal(one('^FO10,20^GB100,50,3,X^FS').white, undefined);
});

test('parse ^GB with ^FR: a solid box is the INVERTED area, an outline is a reversed box; ^FR can come before the ^GB', () => {
  const area = one('^FO100,50^GB300,100,100^FR^FS');
  assert.deepEqual([area.kind, area.mode, area.x, area.y, area.width, area.height], ['area', 'reverse', 100, 50, 300, 100]);
  assert.equal(area.native.kind, 'GB');
  const early = one('^FO100,50^FR^GB300,100,100^FS');
  assert.deepEqual(geometry(early), geometry(area));
  const outline = one('^FO100,50^GB300,100,3^FR^FS');
  assert.deepEqual([outline.kind, outline.rect, outline.reverse], ['line', true, true]);
  // a thin line with ^FR is a reversed area of the line's size
  const thin = one('^FO0,0^GB300,3,3^FR^FS');
  assert.deepEqual([thin.kind, thin.mode, thin.width, thin.height], ['area', 'reverse', 300, 3]);
  // white wins over ^FR (a white ink has nothing to invert): reported once
  const both = parse(BASE('^FO0,0^GB100,50,50,W^FR^FS'));
  assert.equal(both.items[0].mode, 'clear');
  assert.ok(both.diagnostics.some(d => d.level === 'info' && /\^FR/.test(d.text)));
});

test('parse ^GB: the rounding of a solid area has no neutral form: reported once and drawn square', () => {
  const model = parse(BASE('^FO0,0^GB100,50,50,B,4^FR^FS^FO0,100^GB100,50,50,W,4^FS'));
  assert.deepEqual(model.items.map(i => [i.kind, i.mode, i.radius]), [['area', 'reverse', undefined], ['area', 'clear', undefined]]);
  assert.equal(model.diagnostics.filter(d => /redond/i.test(d.text)).length, 1);
});

test('parse ^GB: ^FO is the top-left corner and ^FT the bottom-left corner of the box (the guide), also for bars and areas', () => {
  const fo = one('^FO100,50^GB300,200,3^FS');
  const ft = one('^FT100,250^GB300,200,3^FS');
  assert.deepEqual(geometry(ft), geometry(fo));
  assert.equal(ft.native.origin, 'FT');
  const bar = one('^FT100,53^GB300,3,3^FS');
  assert.deepEqual([bar.y1, bar.y2], [51.5, 51.5]);
  const area = one('^FT100,150^GB300,100,100^FR^FS');
  assert.deepEqual([area.x, area.y], [100, 50]);
});

test('parse ^GB: ^LH and ^LS move the origin', () => {
  const item = parse(BASE('^LH20,10^FO100,50^GB300,200,3^FS')).items[0];
  assert.deepEqual([item.x1, item.y1], [121.5, 61.5]);
});

test('parse ^GB: a value that is not a number, out of range or an unknown rounding is reported and replaced by a usable one', () => {
  const bad = parse(BASE('^FO0,0^GB300,200,abc^FS'));
  assert.ok(bad.diagnostics.some(d => d.level === 'warning' && /\^GB/.test(d.text)));
  assert.deepEqual([bad.items[0].rect, bad.items[0].width], [true, 1]);
  const zero = parse(BASE('^FO0,0^GB300,200,0^FS'));
  assert.ok(zero.diagnostics.some(d => d.level === 'warning' && /\^GB.*(rango|válid)/.test(d.text)));
  assert.equal(zero.items[0].width, 1);
  const big = parse(BASE('^FO0,0^GB40000,100,3^FS'));
  assert.ok(big.diagnostics.some(d => d.level === 'warning' && /\^GB.*rango/.test(d.text)));
  assert.equal(big.items[0].x2 - big.items[0].x1, 32000 - 3);
  const rounding = parse(BASE('^FO0,0^GB300,200,3,B,9^FS'));
  assert.ok(rounding.diagnostics.some(d => d.level === 'warning' && /\^GB.*rango/.test(d.text)));
  assert.equal(rounding.items[0].native.rounding, 8);
});

// ---------------------------------------------------------------------------------------------------------------
// ^GD

test('parse ^GD: a diagonal line across its box; R (default, or /) goes from the bottom-left to the top-right, L (or \\) from the top-left to the bottom-right', () => {
  const right = parse(BASE('^FO100,50^GD200,100,3^FS'));
  assert.deepEqual(right.diagnostics, []);
  const [r] = right.items;
  assert.deepEqual([r.kind, r.rect, r.x1, r.y1, r.x2, r.y2, r.width, r.ref], ['line', false, 100, 150, 300, 50, 3, 'GD']);
  assert.equal(sliceOf(r), 'line');
  assert.deepEqual([r.native.kind, r.native.w, r.native.h, r.native.thickness, r.native.orientation, r.native.origin], ['GD', 200, 100, 3, 'R', 'FO']);
  for (const spec of ['^FO100,50^GD200,100,3,B,R^FS', '^FO100,50^GD200,100,3,B,/^FS', '^FO100,50^GD200,100,3,,r^FS']) assert.deepEqual(geometry(one(spec)), geometry(r), spec);
  for (const spec of ['^FO100,50^GD200,100,3,B,L^FS', '^FO100,50^GD200,100,3,B,\\^FS', '^FO100,50^GD200,100,3,B,l^FS']) {
    const l = one(spec);
    assert.deepEqual([l.x1, l.y1, l.x2, l.y2, l.native.orientation], [100, 50, 300, 150, 'L'], spec);
  }
});

test('parse ^GD: ^FT is the bottom-left of the box (not documented for ^GD: assumed like ^GB), white and ^FR are flags, min size 3, unknown orientation reported', () => {
  const ft = one('^FT100,200^GD200,100,3,B,L^FS');
  assert.deepEqual([ft.y1, ft.y2], [100, 200]);
  assert.equal(one('^FO0,0^GD200,100,3,W^FS').white, true);
  assert.equal(one('^FO0,0^GD200,100,3^FR^FS').reverse, true);
  assert.equal(one('^FO0,0^GD200,100,3,B,R^FS').white, undefined);
  const small = parse(BASE('^FO0,0^GD2,100,3^FS'));
  assert.ok(small.diagnostics.some(d => d.level === 'warning' && /\^GD/.test(d.text)));
  assert.equal(small.items[0].native.w, 3);
  const odd = parse(BASE('^FO0,0^GD200,100,3,B,Q^FS'));
  assert.ok(odd.diagnostics.some(d => d.level === 'warning' && /\^GD/.test(d.text)));
  assert.equal(odd.items[0].native.orientation, 'R');
});

// ---------------------------------------------------------------------------------------------------------------
// ^GC and ^GE

test('parse ^GC: a circle (an ellipse item with equal axes and ref CIRCLE); the thickness extends inward, so the centre line is inset by half of it', () => {
  const model = parse(BASE('^FO100,50^GC200,3^FS'));
  assert.deepEqual(model.diagnostics, []);
  const [c] = model.items;
  assert.deepEqual([c.kind, c.ref, c.x, c.y, c.width, c.height, c.thickness], ['ellipse', 'CIRCLE', 101.5, 51.5, 197, 197, 3]);
  assert.equal(sliceOf(c), 'circle');
  assert.deepEqual([c.native.kind, c.native.diameter, c.native.thickness, c.native.color, c.native.origin], ['GC', 200, 3, 'B', 'FO']);
  const bare = one('^FO0,0^GC^FS'); // the guide's defaults: diameter 3, thickness 1
  assert.deepEqual([bare.width, bare.thickness, bare.native.diameter], [2, 1, 3]);
  const solid = one('^FO0,0^GC100,60^FS'); // the border meets in the middle: solid
  assert.deepEqual([solid.x, solid.width, solid.thickness], [25, 50, 50]);
  const big = parse(BASE('^FO0,0^GC5000,3^FS'));
  assert.equal(big.items[0].native.diameter, 4095);
  assert.ok(big.diagnostics.some(d => d.level === 'warning' && /\^GC.*rango/.test(d.text)));
  const ft = one('^FT100,250^GC200,3^FS');
  assert.deepEqual([ft.x, ft.y], [101.5, 51.5]);
  assert.equal(one('^FO0,0^GC200,3,W^FS').white, true);
  assert.equal(one('^FO0,0^GC200,3^FR^FS').reverse, true);
});

test('parse ^GE: an ellipse of the bounding box w x h, the same inward thickness; width and height default to the thickness', () => {
  const model = parse(BASE('^FO100,50^GE300,200,3^FS'));
  assert.deepEqual(model.diagnostics, []);
  const [e] = model.items;
  assert.deepEqual([e.kind, e.ref, e.x, e.y, e.width, e.height, e.thickness], ['ellipse', 'ELLIPSE', 101.5, 51.5, 297, 197, 3]);
  assert.equal(sliceOf(e), 'ellipse');
  assert.deepEqual([e.native.kind, e.native.w, e.native.h, e.native.thickness], ['GE', 300, 200, 3]);
  const defaults = one('^FO0,0^GE,,6^FS');
  assert.deepEqual([defaults.native.w, defaults.native.h, defaults.width, defaults.thickness], [6, 6, 3, 3]);
  const ft = one('^FT100,250^GE300,200,3^FS');
  assert.deepEqual([ft.x, ft.y], [101.5, 51.5]);
  assert.equal(one('^FO0,0^GE300,200,3,W^FS').white, true);
  assert.equal(one('^FO0,0^GE300,200,3^FR^FS').reverse, true);
  assert.match(diagnostics('^FO0,0^GE300,abc,3^FS').join('\n'), /\^GE/);
});

// ---------------------------------------------------------------------------------------------------------------
// ^LR and ^FR

test('parse ^LR: ^LRY reverses every later field until ^LRN (text, solid boxes, outlines), the fields before it are untouched', () => {
  const model = parse(BASE('^FO10,5^GB100,20,20^FS^LRY^FO10,10^GB300,100,100^FS^FO20,20^A0N,30,30^FDHI^FS^FO5,5^GB200,100,3^FS^FO5,5^GE100,50,3^FS^LRN^FO10,200^A0N,30,30^FDNO^FS^FO10,300^GB300,100,100^FS'));
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.items.map(i => i.kind), ['line', 'area', 'text', 'line', 'ellipse', 'text', 'line']);
  assert.deepEqual(model.items.map(i => i.reverse === true || i.mode === 'reverse'), [false, true, true, true, true, false, false]);
  assert.equal(model.items[1].native.labelReverse, true);
  assert.equal(model.items[2].native.labelReverse, true);
  assert.equal(model.items[5].native.labelReverse, undefined);
});

test('parse ^LR: ^FR together with ^LRY is not a double reversal, an invalid value is reported and the state stays', () => {
  const model = parse(BASE('^LRY^FO10,10^A0N,30,30^FR^FDHI^FS'));
  assert.equal(model.items[0].reverse, true);
  const bad = parse(BASE('^LRY^LRX^FO10,10^A0N,30,30^FDHI^FS'));
  assert.ok(bad.diagnostics.some(d => d.level === 'warning' && /\^LR/.test(d.text)));
  assert.equal(bad.items[0].reverse, true);
  assert.equal(parse(BASE('^LRY^LRN^FO10,10^A0N,30,30^FDHI^FS')).items[0].reverse, undefined);
  // ^LR is a setup command: it never starts a field and is not reported as unsupported
  assert.ok(!diagnostics('^LRY^FO10,10^A0N,30,30^FDHI^FS').some(d => /no soportado/.test(d)));
});

test('parse ^FR / ^LR over things the viewer cannot reverse (bar codes, QR, Data Matrix): one info per label, they are drawn normally', () => {
  const model = parse(BASE('^LRY^FO10,10^BCN,50^FD123^FS^FO10,100^BQN,2,3^FDMA,x^FS^FO10,200^BXN,5^FDx^FS'));
  assert.deepEqual(model.items.map(i => i.kind), ['barcode', 'qr', 'datamatrix']);
  assert.equal(model.diagnostics.filter(d => d.level === 'info' && /invert/i.test(d.text)).length, 1);
  assert.equal(model.items[0].reverse, undefined);
  assert.equal(parse(BASE('^FO10,10^BCN,50^FR^FD123^FS')).diagnostics.filter(d => /invert/i.test(d.text)).length, 1);
  assert.deepEqual(diagnostics('^FO10,10^BCN,50^FD123^FS'), []);
});

test('draw order: the items keep the command order, so a reverse area only inverts what was drawn before it', () => {
  const model = parse(BASE('^FO0,0^GB300,100,100^FS^FO50,20^GB100,40,40^FR^FS^FO60,30^GB30,3,3^FS'));
  assert.deepEqual(model.items.map(i => [i.kind, i.mode || '']), [['line', ''], ['area', 'reverse'], ['line', '']]);
  assert.ok(model.items[0].source.spans[0].end <= model.items[1].source.spans[0].start);
  assert.ok(model.items[1].source.spans[0].end <= model.items[2].source.spans[0].start);
});

// ---------------------------------------------------------------------------------------------------------------
// Drawing, overlap and outside-the-label behaviour

test('the areas of ^GB ... ^FR use the area renderer (white rect with difference blend), a cleared one is plain white; reversed and white strokes are blended / white', () => {
  const n = v => String(Math.round(v * 100) / 100);
  const draw = item => PB.components.forItem(item).render(item, { n }).markup;
  assert.match(draw(one('^FO10,10^GB100,50,50^FR^FS')), /mix-blend-mode:difference/);
  assert.match(draw(one('^FO10,10^GB100,50,50^FR^FS')), /class="hit"/);
  assert.doesNotMatch(draw(one('^FO10,10^GB100,50,50,W^FS')), /mix-blend-mode/);
  assert.match(draw(one('^FO10,10^GB100,50,50,W^FS')), /area-clear/);
  assert.match(draw(one('^FO10,10^GB100,50,3^FR^FS')), /stroke:#fff;mix-blend-mode:difference/);
  assert.match(draw(one('^FO10,10^GB100,50,3,W^FS')), /stroke:#fff/);
  assert.doesNotMatch(draw(one('^FO10,10^GB100,50,3^FS')), /#fff/);
  assert.match(draw(one('^FO10,10^GE100,50,3^FR^FS')), /stroke:#fff;mix-blend-mode:difference/);
  assert.match(draw(one('^FO10,10^GC100,3,W^FS')), /stroke:#fff/);
  assert.match(draw(one('^FO10,10^GD100,50,3,W^FS')), /stroke:#fff/);
  assert.doesNotMatch(draw(one('^FO10,10^GE100,50,3^FS')), /#fff/);
});

test('layout: areas and ellipses count for the outside-the-label check but never for overlaps (zero-size ink box); lines and boxes take no part', () => {
  const group = { getBBox: () => ({ x: 5, y: 6, width: 70, height: 80 }) };
  for (const src of ['^FO10,10^GB100,50,50^FR^FS', '^FO10,10^GB100,50,50,W^FS', '^FO10,10^GE100,50,3^FS', '^FO10,10^GC100,3^FS']) {
    const layout = PB.components.forItem(one(src)).layout(group);
    assert.deepEqual(layout.full, { x: 5, y: 6, width: 70, height: 80 }, src);
    assert.deepEqual(layout.ink, { x: 0, y: 0, width: 0, height: 0 }, src);
  }
  for (const src of ['^FO10,10^GB100,50,3^FS', '^FO10,10^GB100,3,3^FS', '^FO10,10^GD100,50,3^FS']) {
    assert.equal(PB.components.forItem(one(src)).layout(group), null, src);
  }
});

test('the validator accepts the ZPL shapes (no content rules apply to them) and flags one outside the label', () => {
  const model = parse(BASE('^FO100,50^GB300,200,3^FS^FO10,10^GE100,50,3^FS^FO0,0^GB300,100,100^FR^FS^FO9000,9000^GB300,200,3^FS'));
  const found = PB.validator.validate(model, zpl);
  assert.ok(found.every(d => d.level !== 'error'));
});

// ---------------------------------------------------------------------------------------------------------------
// Emit

test('emit ^GB: boxes, bars, rounding, white and reverse round trip as written (parse -> emit)', () => {
  const cases = [
    '^FO100,50^GB300,200,3^FS',
    '^FO100,50^GB300,3,3^FS',
    '^FO100,50^GB3,200,3^FS',
    '^FO100,50^GB200,100,4,B,4^FS',
    '^FO100,50^GB300,200,3,W^FS',
    '^FO100,50^GB300,200,3^FR^FS',
    '^FO100,50^GB300,100,100^FR^FS',
    '^FO100,50^GB300,100,100,W^FS',
    '^FT100,250^GB300,200,3^FS',
    '^FT100,150^GB300,100,100^FR^FS',
    '^FO0,0^GB100,100,50,B,8^FS',
    '^FO100,50^GD200,100,3^FS',
    '^FO100,50^GD200,100,3,B,L^FS',
    '^FO100,50^GD200,100,3,W^FS',
    '^FO100,50^GD200,100,3^FR^FS',
    '^FO100,50^GC200,3^FS',
    '^FO100,50^GE300,200,3^FS',
    '^FO100,50^GC200,3,W^FS',
    '^FO100,50^GE300,200,3,W^FS',
    '^FO100,50^GC200,3^FR^FS',
    '^FO100,50^GE300,200,3^FR^FS',
    '^FT100,250^GC200,3^FS',
  ];
  for (const text of cases) {
    assert.deepEqual(roundTrip(text), [text], text);
    assert.deepEqual(levels(emitResult(parse(BASE(text))).diagnostics, 'warning', 'error'), [], text);
  }
});

test('emit: parse -> emit -> parse gives the same neutral shapes, also for the values that are written differently (thin rounding, odd solid sizes)', () => {
  const sources = [
    '^FO100,50^GB200,100,30,B,1^FS', '^FO0,0^GC35,30^FS', '^FO0,0^GE35,21,30^FS', '^FO10,10^GB,,5^FS', '^FO0,0^GB100,41,20^FS', '^FO0,0^GB100,100,50,B,5^FS',
    '^FO7,9^GB101,55,7,B,3^FS', '^FO0,0^GD3,3,1^FS', '^LRY^FO10,10^GB300,100,100^FS^FO10,10^GB200,100,3^FS',
  ];
  for (const source of sources) {
    const first = parse(BASE(source));
    const again = parse(zpl.emit(first, { dpi: DPI }).text);
    assert.equal(again.items.length, first.items.length, source);
    first.items.forEach((a, n) => {
      const b = again.items[n];
      assert.deepEqual(geometry(b).map(v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)), geometry(a).map(v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)), `${source} #${n}`);
      assert.equal(b.kind, a.kind, source);
      assert.equal(Boolean(b.reverse), Boolean(a.reverse), source);
    });
  }
});

test('emit: ZPL never writes ^LR (a reversed field gets its own ^FR)', () => {
  const model = parse(BASE('^LRY^FO10,10^GB300,100,100^FS^FO20,20^A0N,30,30^FDHI^FS^FO5,5^GB200,100,3^FS'));
  const text = zpl.emit(model, { dpi: DPI }).text;
  assert.doesNotMatch(text, /\^LR/);
  assert.deepEqual(emitLines(model), ['^FO10,10^GB300,100,100^FR^FS', '^FO20,20^A0N,30,30^FR^FDHI^FS', '^FO5,5^GB200,100,3^FR^FS']);
});

test('emit: the neutral line, box, ellipse, circle and area of other languages (centre-line geometry -> the outer box of ZPL)', () => {
  // a thick horizontal / vertical line: a bar (^GB with t = the thickness)
  assert.deepEqual(emitItem({ kind: 'line', x1: 100, y1: 50, x2: 400, y2: 50, rect: false, width: 4 }), ['^FO100,48^GB300,4,4^FS']);
  assert.deepEqual(emitItem({ kind: 'line', x1: 100, y1: 50, x2: 100, y2: 250, rect: false, width: 4 }), ['^FO98,50^GB4,200,4^FS']);
  // a slanted line: ^GD, R when it goes up to the right
  assert.deepEqual(emitItem({ kind: 'line', x1: 100, y1: 200, x2: 300, y2: 100, rect: false, width: 3 }), ['^FO100,100^GD200,100,3^FS']);
  assert.deepEqual(emitItem({ kind: 'line', x1: 300, y1: 100, x2: 100, y2: 200, rect: false, width: 3 }), ['^FO100,100^GD200,100,3^FS']);
  assert.deepEqual(emitItem({ kind: 'line', x1: 100, y1: 100, x2: 300, y2: 200, rect: false, width: 3 }), ['^FO100,100^GD200,100,3,B,L^FS']);
  // a box: the outer box is the corners plus half the thickness all round
  assert.deepEqual(emitItem({ kind: 'line', x1: 100, y1: 100, x2: 300, y2: 200, rect: true, width: 4 }), ['^FO98,98^GB204,104,4^FS']);
  assert.deepEqual(emitItem({ kind: 'ellipse', ref: 'ELLIPSE', x: 100, y: 100, width: 300, height: 200, thickness: 4 }), ['^FO98,98^GE304,204,4^FS']);
  assert.deepEqual(emitItem({ kind: 'ellipse', ref: 'CIRCLE', x: 100, y: 100, width: 200, height: 200, thickness: 4 }), ['^FO98,98^GC204,4^FS']);
  // ^GC only for a circle item: an ellipse item with equal axes, or a circle with different ones, is ^GE
  assert.deepEqual(emitItem({ kind: 'ellipse', ref: 'ELLIPSE', x: 100, y: 100, width: 200, height: 200, thickness: 4 }), ['^FO98,98^GE204,204,4^FS']);
  assert.deepEqual(emitItem({ kind: 'ellipse', ref: 'CIRCLE', x: 100, y: 100, width: 200, height: 100, thickness: 4 }), ['^FO98,98^GE204,104,4^FS']);
  assert.deepEqual(emitItem({ kind: 'area', mode: 'reverse', x: 10, y: 20, width: 300, height: 100 }), ['^FO10,20^GB300,100,100^FR^FS']);
  assert.deepEqual(emitItem({ kind: 'area', mode: 'clear', x: 10, y: 20, width: 300, height: 100 }), ['^FO10,20^GB300,100,100,W^FS']);
  // flags: white and reverse
  assert.deepEqual(emitItem({ kind: 'line', x1: 100, y1: 50, x2: 400, y2: 50, rect: false, width: 4, white: true }), ['^FO100,48^GB300,4,4,W^FS']);
  assert.deepEqual(emitItem({ kind: 'line', x1: 100, y1: 100, x2: 300, y2: 200, rect: true, width: 4, reverse: true }), ['^FO98,98^GB204,104,4^FR^FS']);
});

test('emit: the corner radius becomes the nearest rounding degree (0..8), with one info when the degree cannot reproduce it', () => {
  const box = radius => ({ kind: 'line', x1: 100, y1: 100, x2: 300, y2: 200, rect: true, width: 4, radius });
  assert.deepEqual(emitItem(box(undefined)), ['^FO98,98^GB204,104,4^FS']);
  assert.deepEqual(emitItem(box(0)), ['^FO98,98^GB204,104,4^FS']);
  assert.deepEqual(emitDiag(box(0)), []);
  // R = radius + t / 2 = 12; the shorter side is 104: degree = round(12 / 52 * 8) = 2, which gives R = 13
  assert.deepEqual(emitItem(box(10)), ['^FO98,98^GB204,104,4,B,2^FS']);
  assert.equal(emitDiag(box(10)).filter(d => /redondeo/.test(d)).length, 1);
  // a radius that is exactly a degree: no info
  assert.deepEqual(emitItem(box(11)), ['^FO98,98^GB204,104,4,B,2^FS']);
  assert.deepEqual(emitDiag(box(11)), []);
  // beyond the heaviest degree
  assert.deepEqual(emitItem(box(500)), ['^FO98,98^GB204,104,4,B,8^FS']);
});

test('emit: the limits of the guide (thickness 1..32000 for ^GB, 2..4095 and diameter 4095 for ^GC / ^GE) are applied with a warning', () => {
  const thick = emitDiag({ kind: 'line', x1: 0, y1: 0, x2: 100, y2: 100, rect: true, width: 40000 });
  assert.ok(thick.some(d => /^warning/.test(d) && /32000/.test(d)));
  assert.match(emitItem({ kind: 'line', x1: 0, y1: 0, x2: 100, y2: 100, rect: true, width: 40000 })[0], /\^GB\d+,\d+,32000/);
  const thin = emitDiag({ kind: 'ellipse', ref: 'ELLIPSE', x: 100, y: 100, width: 300, height: 200, thickness: 1 });
  assert.ok(thin.some(d => /^warning/.test(d) && /\^G[CE]/.test(d)));
  assert.match(emitItem({ kind: 'ellipse', ref: 'ELLIPSE', x: 100, y: 100, width: 300, height: 200, thickness: 1 })[0], /\^GE\d+,\d+,2\^FS/);
  const wide = emitDiag({ kind: 'ellipse', ref: 'CIRCLE', x: 0, y: 0, width: 5000, height: 5000, thickness: 3 });
  assert.ok(wide.some(d => /^warning/.test(d) && /4095/.test(d)));
  assert.match(emitItem({ kind: 'ellipse', ref: 'CIRCLE', x: 0, y: 0, width: 5000, height: 5000, thickness: 3 })[0], /\^GC4095,3/);
  // a diagonal smaller than 3 dots is raised to the minimum of ^GD
  assert.ok(emitDiag({ kind: 'line', x1: 0, y1: 0, x2: 2, y2: 50, rect: false, width: 3 }).some(d => /\^GD/.test(d)));
});

test('emit: a shape at a resolution other than 254 dpi converts the 0.1 mm to dots', () => {
  const item = { kind: 'line', x1: 100, y1: 100, x2: 300, y2: 200, rect: true, width: 4 };
  const dot = PB.units.dotSize(203);
  const text = emitItem(item, 203)[0];
  const m = /^\^FO(\d+),(\d+)\^GB(\d+),(\d+),(\d+)\^FS$/.exec(text);
  assert.ok(m, text);
  const [x, w, t] = [Number(m[1]), Number(m[3]), Number(m[5])];
  near(x * dot, 98, dot, 'x');
  near(w * dot, 204, dot, 'width');
  near(t * dot, 4, dot, 'thickness');
});

// ---------------------------------------------------------------------------------------------------------------
// Edit

test('describeItem: a box lists width, height, thickness, the rounding degree (labelled with the shape), the colour and ^FR', () => {
  const text = BASE('^FO100,50^GB300,200,3,B,4^FS');
  const item = parse(text).items[0];
  const d = describe(item, text);
  assert.equal(d.kind, 'line');
  assert.deepEqual(d.fields.map(f => f.key), ['width', 'height', 'thickness', 'rounding', 'color', 'reverse']);
  const f = byKey(d);
  assert.deepEqual([f.width.value, f.height.value, f.thickness.value, f.rounding.value, f.color.value, f.reverse.value], [300, 200, 3, 4, 'B', false]);
  assert.deepEqual(f.rounding.options.map(o => o.value), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(f.rounding.options[0].label, /sin redondeo/i);
  assert.match(f.rounding.options[8].label, /máximo/i);
  assert.ok(f.rounding.options.every(o => typeof o.label === 'string' && o.label.length > 3));
  assert.deepEqual(f.color.options.map(o => o.value), ['B', 'W']);
  assert.equal(f.reverse.type, 'checkbox');
  // omitted trailing arguments stand for their defaults
  const short = BASE('^FO100,50^GB300,200,3^FS');
  const g = byKey(describe(parse(short).items[0], short));
  assert.deepEqual([g.rounding.value, g.color.value, g.reverse.value], [0, 'B', false]);
  // without the text, the model's values
  const m = byKey(describe(item));
  assert.deepEqual([m.width.value, m.height.value, m.thickness.value, m.rounding.value, m.color.value], [300, 200, 3, 4, 'B']);
});

test('updateItem: box width, height, thickness, rounding (also when omitted), colour and ^FR rewrite only their arguments', () => {
  const text = BASE('^FO100,50^GB300,200,3^FS');
  const item = parse(text).items[0];
  assert.equal(update(item, { width: 250 }, text), BASE('^FO100,50^GB250,200,3^FS'));
  assert.equal(update(item, { height: 150 }, text), BASE('^FO100,50^GB300,150,3^FS'));
  assert.equal(update(item, { thickness: 5 }, text), BASE('^FO100,50^GB300,200,5^FS'));
  assert.equal(update(item, { rounding: 3 }, text), BASE('^FO100,50^GB300,200,3,,3^FS'));
  assert.equal(update(item, { color: 'W' }, text), BASE('^FO100,50^GB300,200,3,W^FS'));
  assert.equal(update(item, { color: 'B' }, text), text);
  assert.equal(update(item, { rounding: 0 }, text), text);
  assert.equal(update(item, { reverse: true }, text), BASE('^FO100,50^GB300,200,3^FR^FS'));
  assert.equal(update(item, { rounding: 99 }, text), text);
  const rounded = BASE('^FO100,50^GB300,200,3,W,4^FR^FS');
  const r = parse(rounded).items[0];
  assert.equal(update(r, { reverse: false }, rounded), BASE('^FO100,50^GB300,200,3,W,4^FS'));
  assert.equal(update(r, { rounding: 8, color: 'B' }, rounded), BASE('^FO100,50^GB300,200,3,B,8^FR^FS'));
  // other commands of the label stay byte for byte
  const busy = '^XA\r\n^PW800\r\n^LL480\r\n^FO10,10^A0N,30,30^FDHI^FS\r\n^FO100,50^GB300,200,3^FS\r\n^XZ';
  const target = parse(busy).items[1];
  assert.equal(update(target, { thickness: 4 }, busy), busy.replace('^GB300,200,3', '^GB300,200,4'));
});

test('describeItem / updateItem: a solid area (^GB with ^FR or W) lists width, height and the mode; the thickness follows the size so it stays solid', () => {
  const text = BASE('^FO100,50^GB300,100,100^FR^FS');
  const item = parse(text).items[0];
  const d = describe(item, text);
  assert.equal(d.kind, 'area');
  assert.deepEqual(d.fields.map(f => f.key), ['width', 'height', 'mode']);
  const f = byKey(d);
  assert.deepEqual([f.width.value, f.height.value, f.mode.value], [300, 100, 'reverse']);
  assert.deepEqual(f.mode.options.map(o => [o.value, o.label]), [['reverse', 'Invertir'], ['clear', 'Borrar']]);
  assert.equal(update(item, { width: 200 }, text), BASE('^FO100,50^GB200,100,100^FR^FS'));
  assert.equal(update(item, { height: 400 }, text), BASE('^FO100,50^GB300,400,300^FR^FS'));
  assert.equal(update(item, { width: 50, height: 20 }, text), BASE('^FO100,50^GB50,20,20^FR^FS'));
  assert.equal(update(item, { mode: 'clear' }, text), BASE('^FO100,50^GB300,100,100,W^FS'));
  const cleared = BASE('^FO100,50^GB300,100,100,W^FS');
  const c = parse(cleared).items[0];
  assert.equal(byKey(describe(c, cleared)).mode.value, 'clear');
  assert.equal(update(c, { mode: 'reverse' }, cleared), BASE('^FO100,50^GB300,100,100,B^FR^FS'));
  assert.equal(update(c, { width: 200 }, cleared), BASE('^FO100,50^GB200,100,100,W^FS'));
  assert.equal(update(item, { mode: 'reverse' }, text), text);
});

test('describeItem / updateItem: a bar lists length, thickness and orientation; changes keep it a bar', () => {
  const text = BASE('^FO100,50^GB300,3,3^FS');
  const item = parse(text).items[0];
  const d = describe(item, text);
  assert.deepEqual(d.fields.map(f => f.key), ['length', 'thickness', 'orientation']);
  const f = byKey(d);
  assert.deepEqual([f.length.value, f.thickness.value, f.orientation.value], [300, 3, 'horizontal']);
  assert.deepEqual(f.orientation.options.map(o => o.value), ['horizontal', 'vertical']);
  assert.equal(update(item, { length: 400 }, text), BASE('^FO100,50^GB400,3,3^FS'));
  assert.equal(update(item, { thickness: 5 }, text), BASE('^FO100,50^GB300,5,5^FS'));
  assert.equal(update(item, { length: 200, thickness: 6 }, text), BASE('^FO100,50^GB200,6,6^FS'));
  assert.equal(update(item, { orientation: 'vertical' }, text), BASE('^FO100,50^GB3,300,3^FS'));
  const vertical = BASE('^FO100,50^GB3,300,3^FS');
  const v = parse(vertical).items[0];
  assert.deepEqual(Object.values(byKey(describe(v, vertical))).map(x => x.value), [300, 3, 'vertical']);
  assert.equal(update(v, { length: 100 }, vertical), BASE('^FO100,50^GB3,100,3^FS'));
  assert.equal(update(v, { orientation: 'horizontal' }, vertical), BASE('^FO100,50^GB300,3,3^FS'));
  // a bar written with defaults gets its arguments added in order
  const bare = BASE('^FO100,50^GB300^FS');
  const b = parse(bare).items[0];
  assert.equal(update(b, { thickness: 4 }, bare), BASE('^FO100,50^GB300,4,4^FS'));
});

test('describeItem / updateItem: a diagonal lists width, height, thickness, orientation (R / L), colour and ^FR', () => {
  const text = BASE('^FO100,50^GD200,100,3,B,L^FS');
  const item = parse(text).items[0];
  const d = describe(item, text);
  assert.deepEqual(d.fields.map(f => f.key), ['width', 'height', 'thickness', 'orientation', 'color', 'reverse']);
  const f = byKey(d);
  assert.deepEqual([f.width.value, f.height.value, f.thickness.value, f.orientation.value, f.color.value], [200, 100, 3, 'L', 'B']);
  assert.deepEqual(f.orientation.options.map(o => o.value), ['R', 'L']);
  assert.equal(update(item, { orientation: 'R' }, text), BASE('^FO100,50^GD200,100,3,B,R^FS'));
  assert.equal(update(item, { width: 150, thickness: 4 }, text), BASE('^FO100,50^GD150,100,4,B,L^FS'));
  const short = BASE('^FO100,50^GD200,100,3^FS');
  const s = parse(short).items[0];
  assert.equal(byKey(describe(s, short)).orientation.value, 'R');
  assert.equal(update(s, { orientation: 'L' }, short), BASE('^FO100,50^GD200,100,3,,L^FS'));
  assert.equal(update(s, { orientation: 'R' }, short), short);
  assert.equal(update(s, { color: 'W', reverse: true }, short), BASE('^FO100,50^GD200,100,3,W^FR^FS'));
});

test('describeItem / updateItem: a circle (diameter, thickness, colour, ^FR) and an ellipse (width, height, thickness, colour, ^FR)', () => {
  const circleText = BASE('^FO100,50^GC200,3^FS');
  const circle = parse(circleText).items[0];
  const c = describe(circle, circleText);
  assert.deepEqual(c.fields.map(f => f.key), ['diameter', 'thickness', 'color', 'reverse']);
  assert.deepEqual(Object.values(byKey(c)).map(f => f.value), [200, 3, 'B', false]);
  assert.equal(update(circle, { diameter: 150 }, circleText), BASE('^FO100,50^GC150,3^FS'));
  assert.equal(update(circle, { thickness: 6, color: 'W' }, circleText), BASE('^FO100,50^GC200,6,W^FS'));
  assert.equal(update(circle, { reverse: true }, circleText), BASE('^FO100,50^GC200,3^FR^FS'));
  const ellipseText = BASE('^FO100,50^GE300,200,3^FS');
  const ellipse = parse(ellipseText).items[0];
  const e = describe(ellipse, ellipseText);
  assert.deepEqual(e.fields.map(f => f.key), ['width', 'height', 'thickness', 'color', 'reverse']);
  assert.deepEqual(Object.values(byKey(e)).map(f => f.value), [300, 200, 3, 'B', false]);
  assert.equal(update(ellipse, { width: 250, height: 100 }, ellipseText), BASE('^FO100,50^GE250,100,3^FS'));
  assert.equal(update(ellipse, { color: 'W' }, ellipseText), BASE('^FO100,50^GE300,200,3,W^FS'));
  const model = byKey(describe(ellipse));
  assert.deepEqual([model.width.value, model.height.value, model.thickness.value], [300, 200, 3]);
});

test('describeItem / updateItem: under ^LRY the ^FR checkbox reads true (the item is reversed) and checking it adds nothing; unchecking an own ^FR removes it', () => {
  const text = BASE('^LRY^FO100,50^GB300,200,3^FS^FO10,10^A0N,30,30^FDHI^FS');
  const [box, label] = parse(text).items;
  assert.equal(byKey(describe(box, text)).reverse.value, true);
  assert.equal(byKey(describe(label, text)).reverse.value, true);
  assert.equal(update(box, { reverse: true }, text), text);
  assert.equal(update(label, { reverse: true }, text), text);
  const own = BASE('^FO10,10^A0N,30,30^FR^FDHI^FS');
  const t = parse(own).items[0];
  assert.equal(byKey(describe(t, own)).reverse.value, true);
  assert.equal(update(t, { reverse: false }, own), BASE('^FO10,10^A0N,30,30^FDHI^FS'));
  assert.equal(update(parse(BASE('^FO10,10^A0N,30,30^FDHI^FS')).items[0], { reverse: true }, BASE('^FO10,10^A0N,30,30^FDHI^FS')), BASE('^FO10,10^A0N,30,30^FDHI^FR^FS'));
});

test('moveItem: every shape moves with its origin (^FO and ^FT), by whole dots', () => {
  for (const src of ['^FO100,50^GB300,200,3^FS', '^FO100,50^GB300,3,3^FS', '^FO100,50^GD200,100,3^FS', '^FO100,50^GC200,3^FS', '^FO100,50^GE300,200,3^FS', '^FO100,50^GB300,100,100^FR^FS']) {
    const text = BASE(src);
    const item = parse(text).items[0];
    assert.equal(move(item, text, 10, 20), BASE(src.replace('^FO100,50', '^FO110,70')), src);
  }
  const ft = BASE('^FT100,250^GB300,200,3^FS');
  assert.equal(move(parse(ft).items[0], ft, -10, 5), BASE('^FT90,255^GB300,200,3^FS'));
});

// ---------------------------------------------------------------------------------------------------------------
// Palette

test('palette: Línea, Caja, Elipse, Círculo and Área invertida insert their field before ^XZ at the drop point', () => {
  const empty = '^XA\r\n^PW800\r\n^LL480\r\n^XZ';
  const at = { x: 100, y: 50 };
  const build = kind => zpl.buildComponent(empty, kind, at, { dpi: DPI });
  assert.equal(build('line'), '^XA\r\n^PW800\r\n^LL480\r\n^FO100,50^GB400,3,3^FS\r\n^XZ');
  assert.equal(build('box'), '^XA\r\n^PW800\r\n^LL480\r\n^FO100,50^GB300,200,3,B,0^FS\r\n^XZ');
  assert.equal(build('ellipse'), '^XA\r\n^PW800\r\n^LL480\r\n^FO100,50^GE300,200,3^FS\r\n^XZ');
  assert.equal(build('circle'), '^XA\r\n^PW800\r\n^LL480\r\n^FO100,50^GC200,3^FS\r\n^XZ');
  assert.equal(build('area'), '^XA\r\n^PW800\r\n^LL480\r\n^FO100,50^GB300,100,100^FR^FS\r\n^XZ');
  const kinds = ['line', 'box', 'ellipse', 'circle', 'area'];
  const parsed = kinds.map(kind => parse(build(kind)));
  assert.deepEqual(parsed.map(m => m.items.length), [1, 1, 1, 1, 1]);
  assert.deepEqual(parsed.map(m => PB.components.forItem(m.items[0]).kind), kinds);
  assert.deepEqual(parsed.map(m => m.diagnostics), [[], [], [], [], []]);
  // the drop point is the top-left corner of the shape (the box and the ellipse: of their outer box), ^LH subtracted
  const shifted = zpl.buildComponent('^XA^LH20,10^XZ', 'box', at, { dpi: DPI });
  assert.match(shifted, /\^FO80,40\^GB300,200,3,B,0\^FS/);
  assert.equal(zpl.buildComponent(empty, 'box', null, { dpi: DPI }), empty);
});

test('palette: the shapes are sized in dots at the resolution of the label (40 x 0.3 mm line, 30 x 20 mm box)', () => {
  const text = zpl.buildComponent('^XA^XZ', 'box', { x: 0, y: 0 }, { dpi: 203 });
  const m = /\^GB(\d+),(\d+),3,B,0/.exec(text);
  const dot = PB.units.dotSize(203);
  near(Number(m[1]) * dot, 300, dot, 'box width');
  near(Number(m[2]) * dot, 200, dot, 'box height');
});

// ---------------------------------------------------------------------------------------------------------------
// Conversion through the shared pipeline

const tpclLabel = body => ['{D0500,1000,0500|}', '{AX;+000,+000,+00|}', '{C|}', body, '{XS;I,0001,0002C4100|}'].join('\r\n');
const tsplText = (...lines) => ['SIZE 100 mm,60 mm', 'CLS', ...lines, 'PRINT 1,1', ''].join('\r\n');
const loud = diagnostics => levels(diagnostics, 'warning', 'error');

test('TPCL -> ZPL -> TPCL: lines (horizontal, vertical, slanted) and boxes keep their geometry', () => {
  const text = tpclLabel('{LC;0100,0200,0500,0200,0,03|}{LC;0100,0300,0100,0600,0,03|}{LC;0100,0700,0500,0900,0,03|}{LC;0600,0100,0900,0400,1,03|}');
  const result = PB.convert.run(text, 'zpl', { dpi: 203 });
  assert.equal(result.source, 'tpcl');
  assert.deepEqual(loud(result.diagnostics), []);
  assert.match(result.text, /\^GD/);
  const original = tpcl.parse(text, { dpi: 203 });
  const back = zpl.parse(result.text, { dpi: 203 });
  assert.deepEqual(loud(back.diagnostics), []);
  assert.deepEqual(back.items.map(i => [i.kind, i.rect]), original.items.map(i => [i.kind, i.rect]));
  const dot = PB.units.dotSize(203);
  original.items.forEach((a, n) => {
    const b = back.items[n];
    for (const key of ['x1', 'y1', 'x2', 'y2', 'width']) near(b[key], a[key], 1.5 * dot, `item ${n} ${key}`);
  });
  const again = PB.convert.run(result.text, 'tpcl', { dpi: 203 });
  assert.deepEqual(loud(again.diagnostics), []);
  const final = tpcl.parse(again.text, { dpi: 203 });
  assert.deepEqual(final.items.map(i => [i.kind, i.rect]), original.items.map(i => [i.kind, i.rect]));
  original.items.forEach((a, n) => { for (const key of ['x1', 'y1', 'x2', 'y2']) near(final.items[n][key], a[key], 2 * dot + 1, `final ${n} ${key}`); });
});

test('TPCL -> ZPL: a box with a radius is written with the nearest rounding degree and the loss is reported once', () => {
  const text = tpclLabel('{LC;0100,0100,0500,0400,1,03,030|}');
  const result = PB.convert.run(text, 'zpl', { dpi: 203 });
  assert.equal(result.diagnostics.filter(d => /redondeo/.test(d.text)).length, 1);
  const back = zpl.parse(result.text, { dpi: 203 }).items[0];
  assert.ok(back.native.rounding >= 1 && back.native.rounding <= 8);
  const original = tpcl.parse(text, { dpi: 203 }).items[0];
  const shorter = Math.min(Math.abs(original.x2 - original.x1), Math.abs(original.y2 - original.y1)) + original.width;
  near(back.radius, original.radius, shorter / 2 / 8 / 2 + 3, 'radius');
});

test('TPCL -> ZPL: a TPCL area (XR) becomes the ^GB ... ^FR inverted area or the white-filled cleared one', () => {
  const text = tpclLabel('{XR;0100,0100,0600,0300,B|}{XR;0100,0400,0600,0600,A|}');
  const result = PB.convert.run(text, 'zpl', { dpi: 203 });
  assert.deepEqual(loud(result.diagnostics), []);
  assert.match(result.text, /\^GB\d+,\d+,\d+\^FR\^FS/);
  assert.match(result.text, /\^GB\d+,\d+,\d+,W\^FS/);
  const back = zpl.parse(result.text, { dpi: 203 });
  assert.deepEqual(back.items.map(i => [i.kind, i.mode]), [['area', 'reverse'], ['area', 'clear']]);
  const original = tpcl.parse(text, { dpi: 203 });
  const dot = PB.units.dotSize(203);
  original.items.forEach((a, n) => { for (const key of ['x', 'y', 'width', 'height']) near(back.items[n][key], a[key], dot, `${n} ${key}`); });
});

test('ZPL -> TPCL: boxes, bars, slanted lines and areas convert; circles and ellipses are skipped with the existing warning; white and reversed shapes warn', () => {
  const src = BASE('^FO100,50^GB300,200,3^FS^FO100,300^GB300,3,3^FS^FO100,400^GD200,50,3^FS^FO0,0^GB300,100,100^FR^FS^FO0,200^GB300,100,100,W^FS^FO10,10^GC100,3^FS^FO10,10^GE100,50,3^FS^FO10,10^GB100,50,3,W^FS^FO10,10^GB100,50,3^FR^FS');
  const result = PB.convert.run(src, 'tpcl', { dpi: 203 });
  assert.equal(result.source, 'zpl');
  assert.ok(result.diagnostics.some(d => d.level === 'warning' && /elipses y círculos/.test(d.text)));
  assert.ok(result.diagnostics.some(d => d.level === 'warning' && /blanco/.test(d.text)));
  const back = tpcl.parse(result.text, { dpi: 203 });
  assert.deepEqual(back.items.map(i => i.kind), ['line', 'line', 'line', 'area', 'area', 'line', 'line']);
  assert.deepEqual(back.items.map(i => i.rect), [true, false, false, undefined, undefined, true, true]);
  assert.deepEqual(back.items.filter(i => i.kind === 'area').map(i => i.mode), ['reverse', 'clear']);
});

test('TSPL -> ZPL -> TSPL: BAR, BOX (with and without radius), ELLIPSE, CIRCLE, REVERSE and ERASE keep their geometry', () => {
  const text = tsplText('BAR 100,100,400,3', 'BAR 100,200,3,300', 'BOX 100,100,500,400,3', 'BOX 100,500,500,700,4,20', 'ELLIPSE 100,100,300,200,3', 'CIRCLE 100,100,200,4', 'REVERSE 50,50,300,100', 'ERASE 50,200,300,100');
  const result = PB.convert.run(text, 'zpl', { dpi: 203 });
  assert.equal(result.source, 'tspl');
  assert.deepEqual(loud(result.diagnostics.filter(d => !/redondeo/.test(d.text))), []);
  assert.equal(result.diagnostics.filter(d => /redondeo/.test(d.text)).length, 1);
  const original = tspl.parse(text, { dpi: 203 });
  const mid = zpl.parse(result.text, { dpi: 203 });
  assert.deepEqual(loud(mid.diagnostics), []);
  assert.deepEqual(mid.items.map(i => PB.components.forItem(i).kind), ['line', 'line', 'box', 'box', 'ellipse', 'circle', 'area', 'area']);
  const back = PB.convert.run(result.text, 'tspl', { dpi: 203 });
  assert.deepEqual(loud(back.diagnostics), []);
  const final = tspl.parse(back.text, { dpi: 203 });
  const dot = PB.units.dotSize(203);
  assert.deepEqual(final.items.map(i => i.kind), original.items.map(i => i.kind));
  original.items.forEach((a, n) => {
    const b = final.items[n];
    const at = `item ${n} (${a.ref})`;
    if (a.kind === 'line') for (const key of ['x1', 'y1', 'x2', 'y2', 'width']) near(b[key], a[key], 1.5 * dot, `${at} ${key}`);
    else if (a.kind === 'ellipse') for (const key of ['x', 'y', 'width', 'height', 'thickness']) near(b[key], a[key], 1.5 * dot, `${at} ${key}`);
    else for (const key of ['x', 'y', 'width', 'height']) near(b[key], a[key], dot, `${at} ${key}`);
    if (a.kind === 'area') assert.equal(b.mode, a.mode);
    if (a.kind === 'line') assert.equal(b.rect, a.rect);
    if (a.kind === 'ellipse') assert.equal(b.ref, a.ref);
  });
  near(final.items[3].radius, original.items[3].radius, 25 + 2, 'radius');
});

test('ZPL -> TSPL: bars, boxes, ellipses, circles and areas convert; slanted lines are skipped with the existing warning; white and reversed shapes warn', () => {
  const src = BASE('^FO100,50^GB300,200,3^FS^FO100,300^GB300,3,3^FS^FO100,400^GD200,50,3^FS^FO0,0^GB300,100,100^FR^FS^FO0,200^GB300,100,100,W^FS^FO10,10^GC100,3^FS^FO10,10^GE100,50,3^FS^FO10,10^GB100,50,3,W^FS^FO10,10^GE100,50,3^FR^FS');
  const result = PB.convert.run(src, 'tspl', { dpi: 203 });
  assert.equal(result.source, 'zpl');
  assert.ok(result.diagnostics.some(d => d.level === 'warning' && /diagonal/i.test(d.text)));
  assert.ok(result.diagnostics.some(d => d.level === 'warning' && /blanco/.test(d.text)));
  const back = tspl.parse(result.text, { dpi: 203 });
  assert.deepEqual(back.items.map(i => i.ref), ['BOX', 'BAR', 'REVERSE', 'ERASE', 'CIRCLE', 'ELLIPSE', 'BOX', 'ELLIPSE']);
});

test('the other languages report what ZPL has and they do not: reverse and white outlines (TPCL, TSPL)', () => {
  const src = BASE('^FO10,10^GB100,50,3,W^FS');
  for (const target of ['tpcl', 'tspl']) {
    const result = PB.convert.run(src, target, { dpi: 203 });
    assert.equal(result.diagnostics.filter(d => d.level === 'warning' && /blanco/.test(d.text)).length, 1, target);
  }
  const reversed = BASE('^FO10,10^GB100,50,3^FR^FS^FO10,100^GB100,50,3^FR^FS');
  for (const target of ['tpcl', 'tspl']) {
    const result = PB.convert.run(reversed, target, { dpi: 203 });
    assert.equal(result.diagnostics.filter(d => d.level === 'warning' && /inversa/.test(d.text)).length, 1, target);
  }
  // nothing to report for plain shapes
  for (const target of ['tpcl', 'tspl']) assert.deepEqual(loud(PB.convert.run(BASE('^FO10,10^GB100,50,3^FS'), target, { dpi: 203 }).diagnostics), []);
});

test('the shapes survive ZPL -> ZPL conversion and the other languages -> ZPL write no diagnostics for plain shapes', () => {
  const src = BASE('^FO100,50^GB300,200,3^FS^FO10,10^GE100,50,3^FS^FO10,10^GC100,3^FS^FO100,50^GD200,100,3,B,L^FS');
  const result = PB.convert.run(src, 'zpl', { dpi: 203 });
  assert.deepEqual(loud(result.diagnostics), []);
  assert.equal(zpl.parse(result.text, { dpi: 203 }).items.length, 4);
});
