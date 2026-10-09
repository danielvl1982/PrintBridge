const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// V1 TPCL shapes, checked against the manuals (B-SV4 2004 6.3.5/6.3.6, B-452-R 2012 6.3.6/6.3.7, B-452-TS12 ES 6.8/6.9):
//   {LC;x1,y1,x2,y2,e,f(,ggg)}  X fixed 4 digits, Y 4 or 5 digits (0.1 mm); type 0 line, 1 rectangle, 2 dashed line, 3 dashed rectangle;
//                               width 1..9 (B-452-R: 01..99) dots; radius ggg fixed 3 digits (0.1 mm), only for rectangles
//   {XR;x1,y1,x2,y2,e}          same coordinates; e = A (clear) or B (reverse)
//   TPCL has no ellipse or circle command in any of the four manuals (the emit already skips them with one warning).
const PB = loadUpTo('js/drawing.js');
const tpcl = PB.languages.get('tpcl');
const DOT = PB.units.dotSize(203);

const doc = (...cmds) => `{D0630,1000,0600|}\n{C|}\n${cmds.join('\n')}\n{XS;I,0001,0002C4100|}\n`;
const parse = (...cmds) => tpcl.parse(doc(...cmds), { dpi: 203 });
const at = (level, model) => model.diagnostics.filter(d => d.level === level).map(d => d.text);
const field = (d, key) => d.fields.find(f => f.key === key);

// ---- LC type

test('LC: types 0 and 1 raise nothing', () => {
  const model = parse('{LC;0100,0200,0500,0200,0,03|}', '{LC;0100,0300,0500,0600,1,03|}');
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.items.map(i => i.rect), [false, true]);
});

test('LC: type 2 is a dashed LINE (it used to be read as a rectangle) and type 3 a dashed rectangle, with one info each', () => {
  const model = parse('{LC;0100,0200,0500,0200,2,03|}', '{LC;0100,0300,0500,0600,3,03|}');
  assert.deepEqual(model.items.map(i => i.rect), [false, true]);
  assert.deepEqual(at('warning', model), []);
  const infos = at('info', model);
  assert.equal(infos.length, 2);
  assert.match(infos[0], /discontinua/);
  assert.match(infos[0], /continua/);
});

test('LC: a type beyond 0..3 is drawn as the nearest valid one (3) and reported with the range', () => {
  const model = parse('{LC;0100,0300,0500,0600,7,03|}');
  assert.equal(model.items[0].rect, true);
  assert.equal(model.items[0].native.type, 7);
  const w = at('warning', model);
  assert.equal(w.length, 1);
  assert.match(w[0], /tipo 7 fuera de 0\.\.3/);
});

test('LC: the Tipo select of a dashed line shows Línea and of a dashed rectangle shows Caja', () => {
  const dashed = '{LC;0100,0200,0500,0200,2,03|}';
  const item = tpcl.parse(doc(dashed), { dpi: 203 }).items[0];
  assert.equal(field(tpcl.describeItem(item, doc(dashed)), 'rect').value, 'line');
  const box = '{LC;0100,0300,0500,0600,3,03|}';
  const item2 = tpcl.parse(doc(box), { dpi: 203 }).items[0];
  assert.equal(field(tpcl.describeItem(item2, doc(box)), 'rect').value, 'box');
});

// ---- LC thickness and radius

test('LC: thickness 1..9 (one digit) and 01..99 (two digits) are valid', () => {
  const model = parse('{LC;0100,0200,0500,0200,0,1|}', '{LC;0100,0300,0500,0300,0,99|}', '{LC;0100,0400,0500,0400,0,05|}');
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.items.map(i => i.native.width), [1, 99, 5]);
});

test('LC: thickness 0 or beyond 99 is read as written, drawn as the nearest valid one and reported with the range', () => {
  const zero = parse('{LC;0100,0200,0500,0200,0,00|}');
  assert.equal(zero.items[0].native.width, 0);
  assert.ok(Math.abs(zero.items[0].width - DOT) < 1e-9, 'drawn as 1 dot');
  assert.match(at('warning', zero)[0], /grosor 00 fuera de 1\.\.99/);
  const big = parse('{LC;0100,0200,0500,0200,0,150|}');
  assert.equal(big.items[0].native.width, 150);
  assert.ok(Math.abs(big.items[0].width - 99 * DOT) < 1e-9, 'drawn as 99 dots');
  assert.match(at('warning', big)[0], /grosor 150 fuera de 1\.\.99/);
});

test('LC: the radius must have 3 digits; the value is read as written', () => {
  const ok = parse('{LC;0100,0200,0500,0600,1,03,050|}', '{LC;0100,0200,0500,0600,1,03,000|}');
  assert.deepEqual(ok.diagnostics, []);
  const bad = parse('{LC;0100,0200,0500,0600,1,03,50|}');
  assert.equal(bad.items[0].radius, 50);
  const w = at('warning', bad);
  assert.equal(w.length, 1);
  assert.match(w[0], /radio "50" debe llevar 3 dígitos/);
});

// ---- coordinates (LC and XR)

test('LC: X needs exactly 4 digits and Y 4 or 5; the values are read as written and reported', () => {
  assert.deepEqual(parse('{LC;0100,12345,0500,00600,0,03|}').diagnostics, [], 'a 5 digit Y is valid in B-SV4 and B-452-R');
  const model = parse('{LC;100,0200,12345,0600,0,03|}');
  assert.deepEqual([model.items[0].x1, model.items[0].x2], [100, 12345], 'read as written');
  const w = at('warning', model);
  assert.equal(w.length, 1);
  assert.match(w[0], /x1="100"/);
  assert.match(w[0], /x2="12345"/);
  assert.match(w[0], /X con 4 dígitos, Y con 4 o 5/);
  const y = at('warning', parse('{LC;0100,200,0500,123456,0,03|}'));
  assert.equal(y.length, 1);
  assert.match(y[0], /y1="200"/);
  assert.match(y[0], /y2="123456"/);
});

test('XR: the same coordinate rule, and a valid command raises nothing', () => {
  assert.deepEqual(parse('{XR;0050,0050,0200,12000,B|}').diagnostics, []);
  const w = at('warning', parse('{XR;50,0050,0200,0100,A|}'));
  assert.equal(w.length, 1);
  assert.match(w[0], /XR/);
  assert.match(w[0], /x1="50"/);
  const item = parse('{XR;50,0050,0200,0100,A|}').items[0];
  assert.deepEqual([item.x, item.width], [50, 150], 'read as written');
});

// ---- the properties panel offers only valid values (guard for the ranges of the manuals)

test('properties panel: LC and XR fields only offer the manual ranges', () => {
  const line = '{LC;0100,0200,0500,0200,0,03|}';
  const d = tpcl.describeItem(tpcl.parse(doc(line), { dpi: 203 }).items[0], doc(line));
  for (const key of ['x2', 'y2']) assert.deepEqual([field(d, key).min, field(d, key).max], [0, 9999], key);
  assert.deepEqual([field(d, 'width').min, field(d, 'width').max], [1, 99]);
  const box = '{LC;0100,0200,0500,0600,1,03|}';
  const b = tpcl.describeItem(tpcl.parse(doc(box), { dpi: 203 }).items[0], doc(box));
  assert.deepEqual([field(b, 'radius').min, field(b, 'radius').max], [0, 999]);
  const xr = '{XR;0100,0200,0500,0600,B|}';
  const a = tpcl.describeItem(tpcl.parse(doc(xr), { dpi: 203 }).items[0], doc(xr));
  for (const key of ['x2', 'y2']) assert.deepEqual([field(a, key).min, field(a, key).max], [0, 9999], key);
  assert.deepEqual(field(a, 'mode').options.map(o => o.value), ['reverse', 'clear']);
});

// ---- emit: nothing out of range is written (and every adjustment is reported once)

const lineModel = items => ({ language: 'tpcl', size: { width: 1000, height: 600, pitch: 630, gap: null, native: {} }, items, diagnostics: [] });
const emitted = items => PB.languages.emit('tpcl', lineModel(items), { dpi: 203 });

test('emit: LC and XR coordinates out of 0..9999 are clamped with ONE warning for the whole label', () => {
  const out = emitted([
    { kind: 'line', x1: -5, y1: 10, x2: 20000, y2: 30, rect: false, width: 3 },
    { kind: 'area', mode: 'reverse', x: 10, y: 20, width: 99999, height: 50 },
  ]);
  const body = out.text.split('\n').filter(l => /^\{(LC|XR)/.test(l));
  assert.deepEqual(body, ['{LC;0000,0010,9999,0030,0,02|}', '{XR;0010,0020,9999,0070,B|}']);
  assert.equal(out.diagnostics.filter(d => /fuera de 0\.\.9999/.test(d.text)).length, 1);
});

test('emit: thickness and radius beyond their ranges are clamped and reported', () => {
  const out = emitted([{ kind: 'line', x1: 10, y1: 10, x2: 500, y2: 400, rect: true, width: 5000, radius: 4000 }]);
  const lc = out.text.split('\n').find(l => l.startsWith('{LC'));
  assert.equal(lc, '{LC;0010,0010,0500,0400,1,99,999|}');
  assert.ok(out.diagnostics.some(d => /grosores de línea de más de 99/.test(d.text)));
  assert.ok(out.diagnostics.some(d => /radios de esquina de más de 999/.test(d.text)));
});

test('emit: ellipses and circles are skipped with one warning (TPCL has no such command)', () => {
  const out = emitted([{ kind: 'ellipse', x: 10, y: 10, width: 100, height: 50 }, { kind: 'circle', x: 10, y: 10, width: 50, height: 50 }]);
  assert.ok(!/ELLIPSE|CIRCLE|\{LC|\{XR/.test(out.text.split('\n').slice(2, -1).join('')));
  assert.equal(out.diagnostics.filter(d => /elipses y círculos/.test(d.text)).length, 1);
});
