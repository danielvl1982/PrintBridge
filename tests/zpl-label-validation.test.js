const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// V9 ZPL label setup and shapes, checked against the ZPL II Programming Guide (docs/zpl; text lines of pdftotext -layout of Volume One 2003):
//   ^PWa   2 .. the label width, printer dependent (9287+); 32000 dots is the widest the viewer accepts
//   ^LLy   1 .. 32000 dots (8296+)
//   ^LHx,y 0 .. 32000 (8245+); ^LSa -9999 .. 9999 (8390+); ^LTx -120 .. 120 (8440+)
//   ^FOx,y / ^FTx,y  0 .. 32000 (5907+, 6021+)
//   ^GBw,h,t,c,r  t 1..32000, w / h t..32000, c B|W, r 0..8 (6224+); ^GC d 3..4095, t 2..4095 (6287+); ^GD w, h 3..32000, t 1..32000 (6320+)
//   ^GEw,h,t,c  w, h 3..4095, t 2..4095 (6366+); ^PQ q 1..99999999, p 1..99999999 (0 = no pause), r 0..99999999, o Y|N (9125+)
//   ^MDa  -30..30 (8487+); ^PRp,s,b speeds A..E, 2..12 (9200+); ^PMa Y|N (9034+); ^CIa 0..24 (4563+)
const PB = loadUpTo('js/ui.js');
const zpl = PB.languages.get('zpl');

const parse = (src, dpi = 203) => zpl.parse(src, { dpi });
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const dotsOf = (tenthMm, dpi = 203) => Math.round(tenthMm / (254 / dpi));
const emit = (size, items = [], dpi = 203) => PB.languages.emit('zpl', { language: 'zpl', size: { gap: null, pitch: null, native: {}, ...size }, items, diagnostics: [] }, { dpi });
const bar = (x1, y1, x2, y2, extra = {}) => ({ kind: 'line', rect: false, x1, y1, x2, y2, width: 10, ...extra });

// ---- ^PW, ^LL

test('^PW 2..32000 and ^LL 1..32000 raise no warning', () => {
  for (const src of ['^XA^PW2^LL1^XZ', '^XA^PW32000^LL32000^XZ', '^XA^PW800^LL1200^XZ']) assert.deepEqual(warnings(parse(src)), [], src);
});

test('^PW below 2 or above 32000 is read as written, drawn at the nearest limit and reported with the range', () => {
  const low = parse('^XA^PW1^LL100^XZ');
  assert.equal(low.size.native.pw, 1);
  assert.equal(dotsOf(low.size.width), 2);
  assert.equal(warnings(low).length, 1);
  assert.match(warnings(low)[0], /\^PW.*2\.\.32000/);
  const high = parse('^XA^PW40000^LL100^XZ');
  assert.equal(high.size.native.pw, 40000);
  assert.equal(dotsOf(high.size.width), 32000);
  assert.match(warnings(high)[0], /32000/);
  assert.equal(warnings(parse('^XA^PW0^XZ')).length, 1);
  assert.equal(warnings(parse('^XA^PW-5^XZ')).length, 1);
});

test('^LL below 1 or above 32000 is read as written, drawn at the nearest limit and reported with the range', () => {
  const zero = parse('^XA^PW100^LL0^XZ');
  assert.equal(zero.size.native.ll, 0);
  assert.equal(dotsOf(zero.size.height), 1);
  assert.match(warnings(zero)[0], /\^LL.*1\.\.32000/);
  const high = parse('^XA^PW100^LL32001^XZ');
  assert.equal(dotsOf(high.size.height), 32000);
  assert.equal(warnings(high).length, 1);
});

test('a ^PW or ^LL that is not a whole number is reported with the range and not applied', () => {
  for (const src of ['^XA^PWabc^XZ', '^XA^PW10.5^XZ', '^XA^PW^XZ']) {
    const model = parse(src);
    assert.equal(model.size.width, null, src);
    assert.match(warnings(model)[0], /2\.\.32000/, src);
  }
  const ll = parse('^XA^LLx^XZ');
  assert.equal(ll.size.height, null);
  assert.match(warnings(ll)[0], /1\.\.32000/);
});

// ---- ^LH, ^LS, ^LT

const firstBar = model => model.items.find(i => i.kind === 'line');

test('^LH, ^LS and ^LT inside their ranges raise no warning', () => {
  for (const src of ['^XA^LH0,0^XZ', '^XA^LH32000,32000^XZ', '^XA^LS-9999^XZ', '^XA^LS9999^XZ', '^XA^LT-120^XZ', '^XA^LT120^XZ', '^XA^LH10,20^LS5^LT-3^XZ']) {
    assert.deepEqual(warnings(parse(src)), [], src);
  }
});

test('^LH outside 0..32000 is reported with the range and applied at the nearest limit', () => {
  const model = parse('^XA^LH-5,40000^FO0,0^GB100,100,100^FS^XZ');
  const w = warnings(model);
  assert.equal(w.length, 2);
  assert.match(w[0], /\^LH.*0\.\.32000/);
  assert.equal(dotsOf(firstBar(model).y1 - 50 * (254 / 203), 203), 32000);
});

test('^LS outside -9999..9999 and ^LT outside -120..120 are reported and applied at the nearest limit', () => {
  const ls = parse('^XA^LS12000^FO20000,0^GB100,100,100^FS^XZ');
  assert.match(warnings(ls)[0], /\^LS.*-9999\.\.9999/);
  assert.equal(warnings(ls).length, 1);
  const x = firstBar(ls).x1 + 50 * (254 / 203); // centre of the bar -> its left edge
  assert.equal(dotsOf(x - 50 * (254 / 203)), 20000 - 9999);
  const lt = parse('^XA^LT-300^FO0,500^GB100,100,100^FS^XZ');
  assert.match(warnings(lt)[0], /\^LT.*-120\.\.120/);
  assert.equal(dotsOf(firstBar(lt).y1 - 50 * (254 / 203)), 500 - 120);
});

// ---- ^FO, ^FT

test('^FO and ^FT inside 0..32000 raise no warning', () => {
  assert.deepEqual(warnings(parse('^XA^FO0,0^GB10,10,10^FS^FT32000,32000^GB10,10,10^FS^XZ')), []);
});

test('^FO / ^FT outside 0..32000 or fractional are reported with the range and drawn at the nearest valid origin', () => {
  const model = parse('^XA^FO-20,40000^GB10,10,10^FS^XZ');
  const w = warnings(model);
  assert.equal(w.length, 2);
  assert.match(w[0], /\^FO.*0\.\.32000/);
  const item = firstBar(model);
  assert.equal(dotsOf(item.x1), 0);
  assert.equal(dotsOf(item.y1 - 5 * (254 / 203)), 32000);
  const ft = parse('^XA^FT50000,10.6^GB10,10,10^FS^XZ');
  assert.equal(warnings(ft).length, 2);
  assert.match(warnings(ft)[0], /\^FT/);
});

// ---- Shapes (the ranges were already checked; kept as a table so a regression shows)

test('shape parameters outside the manual ranges are reported with the range', () => {
  const cases = [
    ['^GB100,100,0,B,0', /grosor.*1\.\.32000/], ['^GB100,100,40000', /32000/], ['^GB100,100,3,B,9', /redondeo.*0\.\.8/],
    ['^GB100,100,3,X', /color/], ['^GC2,3', /diámetro.*3\.\.4095/], ['^GC5000,3', /4095/], ['^GC50,5000', /4095/],
    ['^GD2,100,3', /ancho.*3\.\.32000/], ['^GD100,100,0', /grosor/], ['^GD100,100,3,B,Q', /orientación/],
    ['^GE2,40,3', /ancho.*3\.\.4095/], ['^GE40,5000,3', /4095/], ['^GE40,40,5000', /4095/],
  ];
  for (const [shape, re] of cases) {
    const w = warnings(parse(`^XA^FO10,10${shape}^FS^XZ`));
    assert.ok(w.length >= 1 && w.some(t => re.test(t)), `${shape}: ${w.join(' | ')}`);
  }
});

test('^GC and ^GE thickness 1 is the default and is not reported on typed code, but the panel and the emit offer 2..4095', () => {
  assert.deepEqual(warnings(parse('^XA^FO10,10^GC50^FS^XZ')), []);
});

// ---- Other commands the viewer reads

test('^PQ, ^MD, ^PR, ^PM and ^CI inside their ranges raise no warning', () => {
  for (const src of ['^XA^PQ1^XZ', '^XA^PQ99999999,99999999,99999999,Y^XZ', '^XA^PQ5,0,0,N^XZ', '^XA^MD-30^XZ', '^XA^MD30^XZ', '^XA^PRA,B,2^XZ', '^XA^PR12^XZ',
    '^XA^PMY^XZ', '^XA^CI0^XZ', '^XA^CI24^XZ']) {
    assert.deepEqual(warnings(parse(src)), [], src);
  }
});

test('^PQ, ^MD, ^PR, ^PM and ^CI outside their ranges are reported with the valid values', () => {
  const cases = [
    ['^PQ0', /\^PQ.*1\.\.99999999/], ['^PQ100000000', /99999999/], ['^PQ5,100000000', /99999999/], ['^PQ5,1,100000000', /0\.\.99999999/], ['^PQ5,1,1,X', /Y o N/],
    ['^MD31', /-30\.\.30/], ['^MD-31', /-30\.\.30/], ['^MDx', /-30\.\.30/],
    ['^PRZ', /\^PR/], ['^PR13', /\^PR/], ['^PM1', /Y o N/], ['^CI25', /0\.\.24/], ['^CIx', /0\.\.24/],
  ];
  for (const [cmd, re] of cases) {
    const w = warnings(parse(`^XA${cmd}^XZ`));
    assert.equal(w.length, 1, `${cmd}: ${w.join(' | ')}`);
    assert.match(w[0], re, cmd);
  }
});

// ---- Emit

test('emit: ^PW is at least 2 and ^LL at most 32000, each reported once', () => {
  const tiny = emit({ width: 1, height: 600 });
  assert.match(tiny.text, /\^PW2\r/);
  assert.equal(tiny.diagnostics.filter(d => d.level === 'warning').length, 1);
  assert.match(tiny.diagnostics.find(d => d.level === 'warning').text, /\^PW.*2\.\.32000/);
  const huge = emit({ width: 1000, height: 100000 });
  assert.match(huge.text, /\^LL32000\r/);
  assert.match(huge.diagnostics.find(d => d.level === 'warning').text, /\^LL.*32000/);
  const both = emit({ width: 100000, height: 100000 });
  assert.match(both.text, /\^PW32000\r/);
  assert.equal(both.diagnostics.filter(d => d.level === 'warning').length, 2);
});

test('emit: a size inside the ranges is written without warning', () => {
  const out = emit({ width: 1000, height: 600 });
  assert.match(out.text, /\^PW\d+\r\n\^LL\d+\r\n/);
  assert.deepEqual(out.diagnostics.filter(d => d.level === 'warning'), []);
});

test('emit: a shape at a negative position is written at 0 and reported once; beyond 32000 it is limited and reported', () => {
  const out = emit({ width: 1000, height: 600 }, [bar(-50, 20, 200, 20), bar(-80, 40, 100, 40)]);
  assert.match(out.text, /\^FO0,/);
  assert.ok(!/\^FO-/.test(out.text));
  const w = out.diagnostics.filter(d => d.level === 'warning');
  assert.equal(w.length, 1);
  assert.match(w[0].text, /0\.\.32000/);
  const far = emit({ width: 1000, height: 600 }, [bar(500000, 20, 500100, 20)]);
  assert.match(far.text, /\^FO32000,/);
  assert.equal(far.diagnostics.filter(d => d.level === 'warning' && /0\.\.32000/.test(d.text)).length, 1);
});

test('emit: ellipse, area and box items at a negative position are reported through the same note', () => {
  const items = [
    { kind: 'ellipse', ref: 'ELLIPSE', x: -100, y: 5, width: 100, height: 50, thickness: 3 },
    { kind: 'area', mode: 'reverse', x: -100, y: 5, width: 100, height: 50 },
    { kind: 'line', rect: true, x1: -100, y1: 0, x2: 100, y2: 100, width: 5 },
  ];
  const out = emit({ width: 1000, height: 600 }, items);
  assert.ok(!/\^F[OT]-/.test(out.text));
  const w = out.diagnostics.filter(d => d.level === 'warning' && /0\.\.32000/.test(d.text));
  assert.equal(w.length, 1);
});

test('emit: a text item at a negative position is written at 0 and reported', () => {
  const out = emit({ width: 1000, height: 600 }, [{ kind: 'text', x: -50, y: 10, data: 'A', fontSize: 30, rotation: 0 }]);
  assert.ok(!/\^F[OT]-/.test(out.text));
  assert.equal(out.diagnostics.filter(d => d.level === 'warning' && /0\.\.32000/.test(d.text)).length, 1);
});

// ---- Formato row and applySize

test('zpl declares the size ranges the Formato row offers and fitSize clamps in dots at the resolution and reports it', () => {
  assert.deepEqual(zpl.sizeLimits.width, [50, Math.round(32000 * 254 / 203)]);
  assert.deepEqual(zpl.sizeLimits.height, [50, Math.round(32000 * 254 / 203)]);
  assert.deepEqual(zpl.sizeLimitsFor(300).width, [50, Math.round(32000 * 254 / 300)]);
  const ok = zpl.fitSize({ w: 1000, h: 600, p: 600, dpi: 203 });
  assert.deepEqual(ok.diagnostics, []);
  assert.equal(ok.size.w, 1000);
  const big = zpl.fitSize({ w: 100000, h: 50000, p: 50000, dpi: 300 });
  assert.equal(dotsOf(big.size.w, 300), 32000);
  assert.equal(dotsOf(big.size.h, 300), 32000);
  assert.equal(big.diagnostics.length, 1);
  assert.equal(big.diagnostics[0].level, 'warning');
  assert.match(big.diagnostics[0].text, /32000/);
  const tiny = zpl.fitSize({ w: 1, h: 1, p: 1, dpi: 203 });
  assert.equal(dotsOf(tiny.size.w, 203), 2);
  assert.equal(tiny.diagnostics.length, 1);
});

test('applySize writes the clamped ^PW / ^LL and sizes.apply reports it', () => {
  const result = PB.sizes.apply(zpl, '^XA^XZ', { w: 100000, h: 600, p: 600, dpi: 203 });
  assert.match(result.text, /\^PW32000/);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(PB.sizes.apply(zpl, '^XA^XZ', { w: 1000, h: 600, p: 600, dpi: 203 }).diagnostics, undefined);
});

function fakeInput() { return { value: '', min: '', max: '', addEventListener() {} }; }

test('the Formato row offers 5 mm up to the ZPL maximum of the resolution', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({}) } });
  try {
    const els = { select: { children: [], replaceChildren() {}, addEventListener() {} }, width: fakeInput(), height: fakeInput(), pitch: fakeInput() };
    const panel = PB.ui.createSizePanel(els, PB.sizes.createCatalog(PB.config.sizes), { onApply() {} });
    panel.setLanguage('zpl', zpl.sizeLimitsFor(300));
    assert.deepEqual([els.width.min, els.width.max], ['5', String(PB.units.toMm(Math.round(32000 * 254 / 300)))]);
    assert.deepEqual([els.height.min, els.height.max], ['5', String(PB.units.toMm(Math.round(32000 * 254 / 300)))]);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
});

// ---- Editing

test('moving a field never writes a coordinate above 32000', () => {
  const src = '^XA^FO100,100^GB100,100,3^FS^XZ';
  const item = parse(src).items[0];
  const moved = zpl.moveItem(src, item, 1000000, 1000000, { dpi: 203 });
  assert.match(moved, /\^FO32000,32000/);
});

test('a component dropped far away is built at 32000 at most', () => {
  const text = zpl.buildComponent('^XA^XZ', 'line', { x: 1000000, y: 1000000 }, { dpi: 203 });
  assert.match(text, /\^FO32000,32000/);
});
