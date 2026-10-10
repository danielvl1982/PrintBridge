const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// V1 TPCL label setup, checked against the manuals (B-SV4 2004 6.3.1/6.3.2/6.3.13, B-452-R 2012 6.3.1/6.3.2/6.3.14, B-452-TS12 ES 6.3/6.4/6.16):
//   {D pitch,width,length}  pitch 0100..9999, width 0100..1080 (4 digits), length 0060..9970 (4 or 5 digits for pitch / length);
//                           out of range values are changed internally to the limit by the printer (B-SV4 note 8); pitch < length is a
//                           command error and pitch - length < 2 mm shrinks the length to pitch - 2 mm
//   {AX;abbb,cddd,eff(,ghhh)}  feed 000..500, cut 000..500, back feed 00..99, correction 000..100, each with a sign
//   {XS;I,aaaa,bbbcdefgh}   count 0001..9999, cut interval 000..100, sensor 0..5, mode C|D|E, speed 1..9|A, ribbon 0..2, rotation 0..3, status 0..1
const PB = loadUpTo('js/ui.js');
const tpcl = PB.languages.get('tpcl');

const parse = text => tpcl.parse(text, { dpi: 203 });
const doc = (...cmds) => `${cmds.join('\n')}\n{C|}\n{XS;I,0001,0002C4100|}\n`;
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const emit = (size, native = {}) => PB.languages.emit('tpcl', { language: 'tpcl', size: { gap: null, pitch: null, native, ...size }, items: [], diagnostics: [] }, { dpi: 203 });

// ---- {D parse

test('D: a size inside the manual ranges raises no warning', () => {
  for (const d of ['D0630,1000,0600', 'D0100,0100,0060', 'D9999,1080,9970', 'D00630,1000,00600']) {
    assert.deepEqual(warnings(parse(doc(`{${d}|}`))), [], d);
  }
});

test('D: a width above 1080 is read clamped for drawing (as the printer does), kept as written and reported with the range', () => {
  const model = parse(doc('{D0630,2000,0600|}'));
  assert.equal(model.size.width, 1080);
  assert.equal(model.size.native.dRaw, 'D0630,2000,0600');
  const w = warnings(model);
  assert.equal(w.length, 1);
  assert.match(w[0], /ancho 2000 fuera de 0100\.\.1080/);
  assert.match(w[0], /la impresora lo ajusta al límite/);
});

test('D: pitch and length out of range are clamped for drawing and reported, each with its own range', () => {
  const high = parse(doc('{D10000,1000,09999|}'));
  assert.equal(high.size.pitch, 9999);
  assert.equal(high.size.height, 9970);
  const w = warnings(high);
  assert.ok(w.some(t => /paso 10000 fuera de 0100\.\.9999/.test(t)), w.join('|'));
  assert.ok(w.some(t => /alto 09999 fuera de 0060\.\.9970/.test(t)), w.join('|'));
  const low = parse(doc('{D0050,0050,0050|}'));
  assert.deepEqual([low.size.pitch, low.size.width, low.size.height], [100, 100, 60]);
  assert.equal(warnings(low).length, 3);
});

test('D: the number of digits is checked (width 4, pitch and length 4 or 5) and the values are read as written', () => {
  const model = parse(doc('{D610,990,550|}'));
  assert.deepEqual([model.size.pitch, model.size.width, model.size.height], [610, 990, 550]);
  assert.ok(warnings(model).some(t => /paso y alto con 4 o 5 dígitos, ancho con 4/.test(t)));
  assert.deepEqual(warnings(parse(doc('{D0630,01000,0600|}'))).length, 1, 'a 5 digit width is not allowed');
});

test('D: a pitch below the length is a command error (warning); a gap under 2 mm shortens the length (information)', () => {
  const below = warnings(parse(doc('{D0500,1000,0600|}')));
  assert.equal(below.length, 1);
  assert.match(below[0], /paso \(0500\) es menor que el alto \(0600\)/);
  assert.match(below[0], /error de comando/);
  const tight = parse(doc('{D0610,1000,0600|}'));
  assert.deepEqual(warnings(tight), [], 'only information: the printer fixes it itself');
  const infos = tight.diagnostics.filter(d => d.level === 'info').map(d => d.text);
  assert.equal(infos.length, 1);
  assert.match(infos[0], /menos de 2 mm/);
  assert.match(infos[0], /paso - 2 mm/);
  assert.deepEqual(parse(doc('{D0620,1000,0600|}')).diagnostics, [], 'exactly 2 mm is valid');
});

// ---- {D emit and the Formato row

test('D emit: an in-range size is written as before, with no new warning', () => {
  const out = emit({ width: 1000, height: 600, pitch: 630 });
  assert.equal(out.text.split('\n')[0], '{D0630,1000,0600|}');
  assert.equal(out.diagnostics.filter(d => d.level === 'warning').length, 0);
});

test('D emit: values out of range are clamped and reported once', () => {
  const out = emit({ width: 1200, height: 20000, pitch: 630 });
  assert.equal(out.text.split('\n')[0], '{D9970,1080,9970|}');
  const w = out.diagnostics.filter(d => d.level === 'warning');
  assert.equal(w.length, 1);
  assert.match(w[0].text, /paso 0100\.\.9999, ancho 0100\.\.1080, alto 0060\.\.9970/);
  const small = emit({ width: 30, height: 20, pitch: 25 });
  assert.equal(small.text.split('\n')[0], '{D0100,0100,0060|}');
});

test('D emit: a pitch below the length is raised to the length (it would be a command error)', () => {
  const out = emit({ width: 1000, height: 600, pitch: 500 });
  assert.equal(out.text.split('\n')[0], '{D0600,1000,0600|}');
  assert.equal(out.diagnostics.filter(d => d.level === 'warning').length, 1);
});

test('D emit: the source command is reused only while it still equals the (valid) size', () => {
  const parsed = parse(doc('{D0630,2000,0600|}', '{AX;+010,+000,+00|}'));
  const out = PB.languages.emit('tpcl', parsed, { dpi: 203 });
  assert.equal(out.text.split('\n')[0], '{D0630,1080,0600|}');
});

test('tpcl declares the ranges the Formato row offers (0.1 mm)', () => {
  assert.deepEqual(tpcl.sizeLimits, { width: [100, 1080], height: [60, 9970], pitch: [100, 9999] });
});

test('applySize clamps to the manual ranges and sizes.apply reports it', () => {
  const text = '{C|}';
  assert.equal(tpcl.applySize(text, { w: 2000, h: 600, p: 630 }), '{D0630,1080,0600|}\n{C|}');
  const result = PB.sizes.apply(tpcl, text, { w: 2000, h: 600, p: 630 });
  assert.equal(result.text, '{D0630,1080,0600|}\n{C|}');
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].level, 'warning');
  assert.match(result.diagnostics[0].text, /ancho 0100\.\.1080/);
  const fine = PB.sizes.apply(tpcl, text, { w: 1000, h: 600, p: 630 });
  assert.equal(fine.diagnostics, undefined, 'no diagnostics when nothing is adjusted');
});

function fakeInput() { return { value: '', min: '', max: '', addEventListener() {} }; }

test('the Formato row offers only the valid range of the language of the label (min / max of each field)', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({}) } });
  try {
    const els = { select: { children: [], replaceChildren() {}, addEventListener() {} }, width: fakeInput(), height: fakeInput(), pitch: fakeInput() };
    const panel = PB.ui.createSizePanel(els, PB.sizes.createCatalog(PB.config.sizes), { onApply() {} });
    panel.setLanguage('tpcl', tpcl.sizeLimits);
    assert.deepEqual([els.width.min, els.width.max], ['10', '108']);
    assert.deepEqual([els.height.min, els.height.max], ['6', '997']);
    assert.deepEqual([els.pitch.min, els.pitch.max], ['10', '999.9']);
    panel.setLanguage('tspl');
    assert.deepEqual([els.width.min, els.width.max, els.height.min, els.height.max], ['5', '', '5', '']);
    assert.deepEqual([els.pitch.min, els.pitch.max], ['0', '']);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
});

// ---- {AX

test('AX: values inside the manual ranges raise no warning (the optional correction too)', () => {
  for (const ax of ['AX;+010,+000,+00', 'AX;-500,+500,-99', 'AX;+001,+002,+03,+100', 'AX;+000,-000,+00,-000']) {
    assert.deepEqual(warnings(parse(doc(`{${ax}|}`))), [], ax);
  }
});

test('AX: a value out of range or a malformed command is reported with the range and kept as written', () => {
  const feed = parse(doc('{AX;+600,+000,+00|}'));
  assert.equal(feed.size.native.axRaw, 'AX;+600,+000,+00');
  assert.ok(warnings(feed).some(t => /alimentación 600 fuera de 000\.\.500/.test(t)), warnings(feed).join('|'));
  assert.ok(warnings(parse(doc('{AX;+000,+501,+00|}'))).some(t => /corte 501 fuera de 000\.\.500/.test(t)));
  assert.ok(warnings(parse(doc('{AX;+000,+000,+00,+101|}'))).some(t => /corrección 101 fuera de 000\.\.100/.test(t)));
  for (const bad of ['AX;+000,+000,+100', 'AX;010,000,00', 'AX;+0000,+000,+00', 'AX;+000,+000']) {
    const w = warnings(parse(doc(`{${bad}|}`)));
    assert.equal(w.length, 1, bad);
    assert.match(w[0], /AX no válido/, bad);
  }
});

test('AX emit: a source AX that is not valid is not written (reported once), a valid one is kept', () => {
  const good = emit({ width: 1000, height: 600, pitch: 630 }, { dRaw: 'D0630,1000,0600', axRaw: 'AX;+010,+000,+00' });
  assert.equal(good.text.split('\n')[1], '{AX;+010,+000,+00|}');
  const bad = emit({ width: 1000, height: 600, pitch: 630 }, { dRaw: 'D0630,1000,0600', axRaw: 'AX;+900,+000,+00' });
  assert.ok(!bad.text.includes('AX;'));
  assert.ok(bad.diagnostics.some(d => d.level === 'warning' && /AX/.test(d.text) && /000\.\.500/.test(d.text)));
});

// ---- {XS

test('XS: the reference command and every value of the manuals raise no warning', () => {
  for (const xs of ['XS;I,0001,0002C4100', 'XS;I,9999,1000D1210', 'XS;I,0001,0005EA201', 'XS;I,0001,0000C6000', 'XS;I,0001,1003C9231']) {
    assert.deepEqual(warnings(parse(doc(`{${xs}|}`))), [], xs);
  }
});

test('XS: each parameter out of its range is reported with the valid values', () => {
  const cases = [
    ['XS;I,0000,0002C4100', /cantidad de etiquetas 0000 fuera de 0001\.\.9999/],
    ['XS;I,0001,1012C4100', /intervalo de corte 101 fuera de 000\.\.100/],
    ['XS;I,0001,0006C4100', /sensor 6 fuera de 0\.\.5/],
    ['XS;I,0001,0002F4100', /modo de emisión F fuera de C, D o E/],
    ['XS;I,0001,0002C0100', /velocidad 0 fuera de 1\.\.9 o A/],
    ['XS;I,0001,0002C4300', /cinta 3 fuera de 0\.\.2/],
    ['XS;I,0001,0002C4140', /giro 4 fuera de 0\.\.3/],
    ['XS;I,0001,0002C4102', /respuesta de estado 2 fuera de 0\.\.1/],
  ];
  for (const [xs, re] of cases) {
    const w = warnings(parse(doc(`{${xs}|}`)));
    assert.equal(w.length, 1, xs);
    assert.match(w[0], re, xs);
  }
});

test('XS: a malformed command is reported', () => {
  for (const bad of ['XS', 'XS;', 'XS;I,1,0002C4100', 'XS;I,0001,0002C410']) {
    const w = warnings(parse(doc(`{${bad}|}`)));
    assert.equal(w.length, 1, bad);
    assert.match(w[0], /XS no válido/, bad);
  }
});

test('the XS written by the emit is valid for the parser', () => {
  const out = emit({ width: 1000, height: 600, pitch: 630 });
  assert.deepEqual(warnings(parse(out.text)), []);
});
