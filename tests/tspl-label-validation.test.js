const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// V5 TSPL label setup and shapes, checked against the B-442/443 interface manual (docs/tspl, text lines of pdftotext -layout):
//   GAP m,n     0 <= m <= 1 inch (25.4 mm); [-]n <= label length (line 253+)
//   BLINE m,n   0.1 <= m <= 1 inch (2.54 .. 25.4 mm); 0 <= n <= label length (285+)
//   OFFSET m    0 <= m <= 1 inch (25.4 mm) (317+)
//   DENSITY n   0 (lightest) .. 15 (darkest) (362+)
//   FEED n      1 .. 65535 dots (520+); PRINT m[,n]  1 .. 65535 each (583+)
//   BOX / BAR / ERASE / REVERSE: dots, the manual gives no range
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');

const parse = src => tspl.parse(src, { dpi: 203 });
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const emit = (size, items = []) => PB.languages.emit('tspl', { language: 'tspl', size: { gap: null, pitch: null, native: {}, ...size }, items, diagnostics: [] }, { dpi: 203 });
const doc = (...cmds) => `SIZE 100 mm,60 mm\r\n${cmds.join('\r\n')}\r\nCLS\r\nPRINT 1,1\r\n`;

// ---- GAP / BLINE / OFFSET

test('GAP inside 0..25.4 mm raises no warning, in mm, inches and dots', () => {
  for (const g of ['GAP 3 mm,0 mm', 'GAP 0.12,0', 'GAP 0 mm,0 mm', 'GAP 25.4 mm,0', 'GAP 1,0', 'GAP 7.62 mm, -2.54 mm', 'GAP 24 dot,0']) {
    assert.deepEqual(warnings(parse(doc(g))), [], g);
  }
});

test('GAP above 25.4 mm is read as written, drawn at the limit and reported with the range', () => {
  const model = parse(doc('GAP 30 mm,0 mm'));
  assert.equal(model.size.native.gapRaw, 'GAP 30 mm,0 mm');
  assert.equal(model.size.gap, 254);
  const w = warnings(model);
  assert.equal(w.length, 1);
  assert.match(w[0], /GAP/);
  assert.match(w[0], /0\.\.25,4 mm/);
});

test('a negative GAP distance is reported and drawn as 0', () => {
  const model = parse(doc('GAP -1 mm,0 mm'));
  assert.equal(warnings(model).length, 1);
  assert.ok(!(model.size.gap < 0), 'the gap is never negative');
});

test('the GAP offset may not exceed the label length, whatever the order of SIZE and GAP', () => {
  assert.deepEqual(warnings(parse('GAP 3 mm,-50 mm\r\nSIZE 100 mm,60 mm\r\nCLS\r\n')), []);
  const w = warnings(parse('GAP 3 mm,70 mm\r\nSIZE 100 mm,60 mm\r\nCLS\r\n'));
  assert.equal(w.length, 1);
  assert.match(w[0], /desplazamiento/);
});

test('BLINE height is 2.54..25.4 mm and its extra feed 0..label length', () => {
  assert.deepEqual(warnings(parse(doc('BLINE 5.08 mm,12.7 mm'))), []);
  assert.deepEqual(warnings(parse(doc('BLINE 0.2,0.5'))), []);
  const low = warnings(parse(doc('BLINE 1 mm,0 mm')));
  assert.equal(low.length, 1);
  assert.match(low[0], /2,54\.\.25,4 mm/);
  assert.equal(warnings(parse(doc('BLINE 30 mm,0 mm'))).length, 1);
  assert.equal(warnings(parse(doc('BLINE 5 mm,-1 mm'))).length, 1);
  assert.equal(warnings(parse(doc('BLINE 5 mm,80 mm'))).length, 1);
});

test('OFFSET is 0..1 inch (25.4 mm) and is reported when outside or malformed', () => {
  for (const ok of ['OFFSET 0.5', 'OFFSET 12.7 mm', 'OFFSET 0', 'OFFSET 25.4 mm']) assert.deepEqual(warnings(parse(doc(ok))), [], ok);
  const w = warnings(parse(doc('OFFSET 30 mm')));
  assert.equal(w.length, 1);
  assert.match(w[0], /OFFSET/);
  assert.match(w[0], /0\.\.25,4 mm/);
  assert.equal(warnings(parse(doc('OFFSET -1 mm'))).length, 1);
  assert.equal(warnings(parse(doc('OFFSET abc'))).length, 1);
});

// ---- SIZE, DIRECTION

test('SIZE with a zero or negative measure is reported', () => {
  assert.deepEqual(warnings(parse('SIZE 100 mm,60 mm\r\nCLS\r\n')), []);
  assert.equal(warnings(parse('SIZE 0 mm,60 mm\r\nCLS\r\n')).length, 1);
  assert.equal(warnings(parse('SIZE 100 mm,-5 mm\r\nCLS\r\n')).length, 1);
});

test('DIRECTION outside 0 / 1 is reported with the valid values', () => {
  assert.deepEqual(warnings(parse(doc('DIRECTION 1'))), []);
  const w = warnings(parse(doc('DIRECTION 2')));
  assert.equal(w.length, 1);
  assert.match(w[0], /0 o 1/);
});

// ---- DENSITY, SPEED, FEED, PRINT

test('DENSITY is a whole number 0..15', () => {
  for (const ok of ['DENSITY 0', 'DENSITY 7', 'DENSITY 15']) assert.deepEqual(warnings(parse(doc(ok))), [], ok);
  for (const bad of ['DENSITY 16', 'DENSITY -1', 'DENSITY 7.5', 'DENSITY x', 'DENSITY']) {
    const w = warnings(parse(doc(bad)));
    assert.equal(w.length, 1, bad);
    assert.match(w[0], /0\.\.15/, bad);
  }
});

test('SPEED must be a positive number', () => {
  for (const ok of ['SPEED 1.5', 'SPEED 2', 'SPEED 3.0']) assert.deepEqual(warnings(parse(doc(ok))), [], ok);
  for (const bad of ['SPEED 0', 'SPEED -2', 'SPEED fast']) assert.equal(warnings(parse(doc(bad))).length, 1, bad);
});

test('FEED is 1..65535 dots', () => {
  for (const ok of ['FEED 1', 'FEED 40', 'FEED 65535']) assert.deepEqual(warnings(parse(doc(ok))), [], ok);
  for (const bad of ['FEED 0', 'FEED 65536', 'FEED -3', 'FEED 2.5']) {
    const w = warnings(parse(doc(bad)));
    assert.equal(w.length, 1, bad);
    assert.match(w[0], /1\.\.65535/, bad);
  }
});

test('PRINT sets and copies are whole numbers 1..65535', () => {
  for (const ok of ['PRINT 1', 'PRINT 3,2', 'PRINT 65535,65535']) assert.deepEqual(warnings(parse(`SIZE 100 mm,60 mm\r\n${ok}\r\n`)), [], ok);
  for (const bad of ['PRINT 0,1', 'PRINT 1,0', 'PRINT 65536', 'PRINT 1,65536', 'PRINT 1.5', 'PRINT']) {
    const w = warnings(parse(`SIZE 100 mm,60 mm\r\n${bad}\r\n`));
    assert.equal(w.length, 1, bad);
    assert.match(w[0], /PRINT/, bad);
  }
});

// ---- BOX end corner

test('a BOX whose end corner is before its start corner is reported and still drawn', () => {
  assert.deepEqual(warnings(parse(doc('BOX 10,10,100,100,3'))), []);
  const model = parse(doc('BOX 100,100,10,10,3'));
  assert.equal(model.items.length, 1);
  const w = warnings(model);
  assert.equal(w.length, 1);
  assert.match(w[0], /BOX/);
});

// ---- Emit: GAP

test('emit: a gap inside 0..25.4 mm is written as before with no warning', () => {
  const out = emit({ width: 1000, height: 600, gap: 30 });
  assert.match(out.text, /GAP 3 mm,0 mm/);
  assert.equal(out.diagnostics.filter(d => d.level === 'warning').length, 0);
});

test('emit: a gap above 25.4 mm (a converted TPCL pitch) is clamped and reported once', () => {
  const out = emit({ width: 1000, height: 600, pitch: 1600 });
  assert.match(out.text, /GAP 25\.4 mm,0 mm/);
  const w = out.diagnostics.filter(d => d.level === 'warning');
  assert.equal(w.length, 1);
  assert.match(w[0].text, /0\.\.25,4 mm/);
});

test('emit: a model gap above the limit is clamped too', () => {
  const out = emit({ width: 1000, height: 600, gap: 400 });
  assert.match(out.text, /GAP 25\.4 mm,0 mm/);
  assert.equal(out.diagnostics.filter(d => d.level === 'warning').length, 1);
});

test('emit: a zero or negative size is not written as SIZE and is reported', () => {
  const out = emit({ width: 0, height: 600 });
  assert.ok(!/^SIZE/m.test(out.text));
  assert.equal(out.diagnostics.filter(d => d.level === 'warning').length, 1);
});

// ---- Formato row and applySize

test('tspl declares the gap range the Formato row offers (0.1 mm) and fitSize clamps and reports it', () => {
  assert.deepEqual(tspl.sizeLimits, { gap: [0, 254] });
  const fit = tspl.fitSize({ w: 1000, h: 600, p: 1000 });
  assert.equal(fit.size.p, 854);
  assert.equal(fit.diagnostics.length, 1);
  assert.equal(fit.diagnostics[0].level, 'warning');
  assert.deepEqual(tspl.fitSize({ w: 1000, h: 600, p: 630 }).diagnostics, []);
});

test('applySize writes the clamped GAP and sizes.apply reports it', () => {
  const result = PB.sizes.apply(tspl, 'CLS\r\n', { w: 1000, h: 600, p: 1000 });
  assert.match(result.text, /GAP 25\.4 mm,0 mm/);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(PB.sizes.apply(tspl, 'CLS\r\n', { w: 1000, h: 600, p: 630 }).diagnostics, undefined);
});

function fakeInput() { return { value: '', min: '', max: '', addEventListener() {} }; }

test('the Formato row limits the GAP field to 0..25.4 mm for TSPL', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({}) } });
  try {
    const els = { select: { children: [], replaceChildren() {}, addEventListener() {} }, width: fakeInput(), height: fakeInput(), pitch: fakeInput() };
    const panel = PB.ui.createSizePanel(els, PB.sizes.createCatalog(PB.config.sizes), { onApply() {} });
    panel.setLanguage('tspl', tspl.sizeLimits);
    assert.deepEqual([els.pitch.min, els.pitch.max], ['0', '25.4']);
    assert.deepEqual([els.width.min, els.width.max], ['5', '']);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
});

// ---- Emit: shape adjustments are reported

const lineItem = { kind: 'line', x1: 0, y1: 0, x2: 200, y2: 0, width: 0.2, rect: false };
const ellipseItem = { kind: 'ellipse', ref: 'ELLIPSE', x: -10, y: 5, width: 100, height: 50, thickness: 3 };
const areaItem = { kind: 'area', mode: 'reverse', x: -10, y: 5, width: 100, height: 50 };

test('emit: a line thinner than one dot is written 1 dot thick and reported once', () => {
  const out = emit({ width: 1000, height: 600 }, [lineItem, { ...lineItem, y1: 100, y2: 100 }]);
  assert.match(out.text, /BAR 0,0,\d+,1/);
  const w = out.diagnostics.filter(d => d.level === 'warning');
  assert.equal(w.length, 1);
  assert.match(w[0].text, /1 punto/);
});

test('emit: an ellipse or area at a negative position is written at 0 and reported once', () => {
  const out = emit({ width: 1000, height: 600 }, [ellipseItem, areaItem]);
  assert.match(out.text, /ELLIPSE 0,/);
  assert.match(out.text, /REVERSE 0,/);
  const w = out.diagnostics.filter(d => d.level === 'warning');
  assert.equal(w.length, 1);
  assert.match(w[0].text, /negativ/);
});

test('emit: shapes inside the label add no warning', () => {
  const ok = [{ ...lineItem, width: 3 }, { ...ellipseItem, x: 10 }, { ...areaItem, x: 10 }];
  const out = emit({ width: 1000, height: 600 }, ok);
  assert.equal(out.diagnostics.filter(d => d.level === 'warning').length, 0);
});
