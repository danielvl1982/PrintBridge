const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// V6 TSPL text, checked against the B-442/443 interface manual (docs/tspl, text lines of pdftotext -layout):
//   TEXT x,y,"font",rotation,x-mul,y-mul,"content"   (lines 1190-1245)
//     font 1..5 = 8x12, 12x20, 16x24, 24x32, 32x48 dots; rotation 0 / 90 / 180 / 270; multipliers 1~8 (the code keeps the wider 1..10 of v3.0)
//     a quote inside the text is written \["], CR \[R], LF \[L]
//   SET COUNTER @n step   (3116-3150): n 0..49 (50 counters), -999999999 <= step <= 999999999
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');

const parse = src => tspl.parse(src, { dpi: 203 });
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const doc = (...cmds) => `SIZE 100 mm,60 mm\r\n${cmds.join('\r\n')}\r\nCLS\r\nPRINT 1,1\r\n`;
const dot = 254 / 203;
const emit = items => PB.languages.emit('tspl', { language: 'tspl', size: { width: 1000, height: 600, gap: null, pitch: null, native: {} }, items, diagnostics: [] }, { dpi: 203 });
const mono = (cellW, cellH, xmul, ymul) => ({ size: cellH * ymul * dot, scaleX: (cellW * xmul) / (cellH * ymul * 0.6), family: 'mono', weight: 400, style: 'normal' });

// ---- multipliers

test('bitmap font multipliers 1..10 raise no warning', () => {
  for (const [x, y] of [[1, 1], [8, 8], [10, 10]]) assert.deepEqual(warnings(parse(doc(`TEXT 10,10,"3",0,${x},${y},"A"`))), [], `${x},${y}`);
});

test('a bitmap multiplier above 10 is read as written, drawn at 10 and reported with the range', () => {
  const model = parse(doc('TEXT 10,10,"3",0,15,1,"A"'));
  const item = model.items[0];
  assert.equal(item.native.xmul, 15);
  assert.equal(Math.round(item.font.size / dot), 24);
  assert.ok(Math.abs(item.font.scaleX - (16 * 10) / (24 * 0.6)) < 1e-9, 'drawn with x-mul 10');
  const w = warnings(model);
  assert.equal(w.length, 1);
  assert.match(w[0], /multiplicador X/);
  assert.match(w[0], /1 a 10/);
});

test('a fractional bitmap multiplier is reported and drawn as the nearest whole one', () => {
  const model = parse(doc('TEXT 10,10,"3",0,1,2.6,"A"'));
  assert.equal(Math.round(model.items[0].font.size / dot), 24 * 3);
  const w = warnings(model);
  assert.equal(w.length, 1);
  assert.match(w[0], /multiplicador Y/);
  assert.match(w[0], /entero/);
});

test('a zero or negative multiplier says it needs a whole number from 1', () => {
  const w = warnings(parse(doc('TEXT 10,10,"3",0,0,1,"A"')));
  assert.equal(w.length, 1);
  assert.match(w[0], /1 a 10/);
});

test('BLOCK multipliers are checked like TEXT ones', () => {
  const w = warnings(parse(doc('BLOCK 10,10,300,100,"3",0,11,1,"A"')));
  assert.equal(w.length, 1);
  assert.match(w[0], /1 a 10/);
});

test('scalable font sizes are not limited to 10', () => {
  assert.deepEqual(warnings(parse(doc('TEXT 10,10,"0",0,40,40,"A"'))), []);
});

// ---- rotation

test('an invalid rotation states the valid ones', () => {
  const w = warnings(parse(doc('TEXT 10,10,"3",45,1,1,"A"')));
  assert.equal(w.length, 1);
  assert.match(w[0], /0, 90, 180 o 270/);
});

// ---- font ids

test('font ids 1..5 of the manual are known', () => {
  for (const f of ['1', '2', '3', '4', '5']) {
    assert.equal(parse(doc(`TEXT 10,10,"${f}",0,1,1,"A"`)).diagnostics.length, 0, f);
  }
});

test('an unknown font id is reported once with the ids the viewer draws', () => {
  const model = parse(doc('TEXT 10,10,"9",0,1,1,"A"', 'TEXT 10,60,"9",0,1,1,"B"'));
  const d = model.diagnostics.filter(x => /fuente/.test(x.text));
  assert.equal(d.length, 1);
  assert.match(d[0].text, /1 a 8/);
});

// ---- content and quotes

test('a quote inside the content is written as \\["] and read back', () => {
  const out = emit([{ kind: 'text', x: 40 * dot, y: 30 * dot + 24 * dot, rotation: 0, data: 'say "hi"', font: mono(16, 24, 1, 1) }]).text;
  assert.match(out, /TEXT \d+,\d+,"3",0,1,1,"say \\\["\]hi\\\["\]"/);
  assert.equal(parse(out).items[0].data, 'say "hi"');
});

// ---- SET COUNTER

test('SET COUNTER inside @0..@49 and the step limits raises no warning', () => {
  for (const c of ['SET COUNTER @0 1', 'SET COUNTER @49 -1', 'SET COUNTER @1 999999999', 'SET COUNTER @1 -999999999', 'SET COUNTER @1 0']) {
    assert.deepEqual(warnings(parse(doc(c))), [], c);
  }
});

test('SET COUNTER with a counter number above 49 states the range', () => {
  const w = warnings(parse(doc('SET COUNTER @50 1')));
  assert.equal(w.length, 1);
  assert.match(w[0], /@0 a @49/);
});

test('SET COUNTER with a step beyond the limit states the range and declares nothing (the printer rejects it)', () => {
  const model = parse(doc('SET COUNTER @1 1000000000', '@1="0001"', 'TEXT 10,10,"3",0,1,1,@1'));
  const w = warnings(model);
  assert.equal(w.length, 1);
  assert.match(w[0], /999999999/);
  assert.equal(model.items[0].counter, undefined);
});

test('a malformed SET COUNTER explains the form', () => {
  const w = warnings(parse(doc('SET COUNTER @1 1.5')));
  assert.equal(w.length, 1);
  assert.match(w[0], /SET COUNTER @n paso/);
});

test('assigning a start value to a counter above 49 is reported', () => {
  const w = warnings(parse(doc('@60="0001"')));
  assert.equal(w.length, 1);
  assert.match(w[0], /@0 a @49/);
});

test('a TEXT that uses a counter above 49 is reported once', () => {
  const w = warnings(parse(doc('TEXT 10,10,"3",0,1,1,@77', 'TEXT 10,60,"3",0,1,1,@77')));
  assert.equal(w.length, 1);
  assert.match(w[0], /@0 a @49/);
});

test('emit never writes a counter number above 49 or a step beyond the limit', () => {
  const items = Array.from({ length: 52 }, (_, i) => ({
    kind: 'text', x: 40 * dot, y: (30 + i) * dot + 24 * dot, rotation: 0, data: String(i), font: mono(16, 24, 1, 1),
    counter: { step: i === 0 ? 2e9 : 1 },
  }));
  const result = emit(items);
  const counters = [...result.text.matchAll(/SET COUNTER @(\d+) (-?\d+)/g)];
  assert.equal(counters.length, 50);
  assert.ok(counters.every(c => Number(c[1]) <= 49 && Math.abs(Number(c[2])) <= 999999999));
  assert.ok(result.diagnostics.some(d => d.level === 'warning' && /contadores/.test(d.text)));
  assert.ok(result.diagnostics.some(d => d.level === 'warning' && /999999999/.test(d.text)));
});
