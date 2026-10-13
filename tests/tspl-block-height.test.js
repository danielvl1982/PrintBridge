const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// tspl-small-fixes T1: "Alto (mm)" of the TSPL text block = lines * pitch (what emitBlock writes), edited as whole lines.
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');
const DPI = 203;
const DOT_MM = 25.4 / DPI;
const MAX_LINES = 999;

const doc = (...lines) => `SIZE 100 mm,60 mm\r\nCLS\r\n${lines.map(l => l + '\r\n').join('')}PRINT 1,1\r\n`;
const item = (text, i = 0) => tspl.parse(text, { dpi: DPI }).items[i];
const describe = (text, dpi = DPI) => tspl.describeItem(item(text), text, { dpi });
const byKey = (d, key) => d.fields.find(f => f.key === key);
const update = (text, changes, i = 0) => tspl.updateItem(text, item(text, i), changes, { dpi: DPI });
const mm = dots => Math.round(dots * DOT_MM * 100) / 100;

// font "3" is 24 dots high at x1: pitch 24 (28 with a space of 4)
const BLOCK = doc('BLOCK 100,200,300,150,"3",0,1,1,"x"'); // floor(150 / 24) = 6 lines

test('the field comes right after Líneas máx. and shows lines * pitch in mm', () => {
  const d = describe(BLOCK);
  const keys = d.fields.map(f => f.key);
  assert.equal(keys[keys.indexOf('blockLines') + 1], 'blockHeight');
  const field = byKey(d, 'blockHeight');
  assert.deepEqual([field.label, field.type, field.value], ['Alto (mm)', 'number', mm(6 * 24)]);
  assert.equal(field.min, 0);
  // the space of the command is part of the pitch
  assert.equal(byKey(describe(doc('BLOCK 100,200,300,150,"3",0,1,1,4,1,"x"')), 'blockHeight').value, mm(5 * 28));
});

test('without the text the field comes from the model and agrees with the one read from the text', () => {
  const it = item(BLOCK);
  assert.equal(byKey(tspl.describeItem(it, undefined, { dpi: DPI }), 'blockHeight').value, byKey(describe(BLOCK), 'blockHeight').value);
});

test('the height at 300 dpi uses the dot of that resolution', () => {
  const text = doc('BLOCK 100,200,300,150,"3",0,1,1,"x"');
  const it = tspl.parse(text, { dpi: 300 }).items[0];
  const d = tspl.describeItem(it, text, { dpi: 300 });
  const lines = byKey(d, 'blockLines').value;
  assert.equal(byKey(d, 'blockHeight').value, Math.round(lines * 24 * (25.4 / 300) * 100) / 100);
});

test('editing the height writes lines = round(height / pitch) whole lines, as height = lines * pitch', () => {
  assert.equal(update(BLOCK, { blockHeight: mm(4 * 24) }), doc('BLOCK 100,200,300,96,"3",0,1,1,"x"'));
  // between two lines it goes to the nearest one
  assert.equal(update(BLOCK, { blockHeight: mm(4 * 24) + 0.3 * 24 * DOT_MM }), doc('BLOCK 100,200,300,96,"3",0,1,1,"x"'));
  assert.equal(update(BLOCK, { blockHeight: mm(4 * 24) + 0.7 * 24 * DOT_MM }), doc('BLOCK 100,200,300,120,"3",0,1,1,"x"'));
  // with a space the pitch is 28
  const spaced = doc('BLOCK 100,200,300,150,"3",0,1,1,4,1,"x"');
  assert.equal(update(spaced, { blockHeight: mm(3 * 28) }), doc('BLOCK 100,200,300,84,"3",0,1,1,4,1,"x"'));
  // the field then shows the rounded height
  const after = update(BLOCK, { blockHeight: mm(4 * 24) + 0.7 * 24 * DOT_MM });
  assert.equal(byKey(describe(after), 'blockHeight').value, mm(5 * 24));
  assert.equal(byKey(describe(after), 'blockLines').value, 5);
});

test('the height is clamped like the lines: at least 1 line, at most 999', () => {
  assert.equal(update(BLOCK, { blockHeight: 0 }), doc('BLOCK 100,200,300,24,"3",0,1,1,"x"'));
  assert.equal(update(BLOCK, { blockHeight: -5 }), doc('BLOCK 100,200,300,24,"3",0,1,1,"x"'));
  assert.equal(update(BLOCK, { blockHeight: 100000 }), doc(`BLOCK 100,200,300,${MAX_LINES * 24},"3",0,1,1,"x"`));
});

test('a non-numeric height changes nothing; Líneas máx. wins when both are given', () => {
  for (const bad of ['abc', '', NaN, Infinity, null, undefined]) assert.equal(update(BLOCK, { blockHeight: bad }), BLOCK, String(bad));
  assert.equal(update(BLOCK, { blockHeight: mm(2 * 24), blockLines: 5 }), doc('BLOCK 100,200,300,120,"3",0,1,1,"x"'));
});

test('the height that already is the one written leaves the text alone, and other fields are untouched', () => {
  assert.equal(update(BLOCK, { blockHeight: mm(6 * 24) }), doc('BLOCK 100,200,300,144,"3",0,1,1,"x"'));
  const text = doc('BLOCK 100,200,300,144,"3",0,1,1,"x"');
  assert.equal(update(text, { blockHeight: mm(6 * 24) }), text);
});

test('a scalable font uses the pitch of its point size', () => {
  const text = doc('BLOCK 100,200,300,150,"0",0,8,10,"x"');
  const pitch = Math.round(10 * PB.units.UNITS_PER_POINT / (254 / DPI));
  assert.equal(update(text, { blockHeight: mm(3 * pitch) }), doc(`BLOCK 100,200,300,${3 * pitch},"0",0,8,10,"x"`));
});

test('a line has no height field; once made a block it has one (Tipo -> Bloque de texto)', () => {
  const line = doc('TEXT 100,200,"3",0,1,1,"Hello world"');
  assert.equal(byKey(describe(line), 'blockHeight'), undefined);
  const made = update(line, { kind: 'block' });
  assert.match(made, /BLOCK /);
  const field = byKey(describe(made), 'blockHeight');
  const lines = byKey(describe(made), 'blockLines').value;
  assert.equal(field.value, mm(lines * 24));
  assert.equal(update(made, { blockHeight: mm(3 * 24) }).includes(',72,"3"'), true);
});

test('a block without a valid height argument shows neither Líneas máx. nor Alto (mm)', () => {
  const text = doc('BLOCK 100,200,300,0,"3",0,1,1,"x"');
  assert.equal(byKey(describe(text), 'blockHeight'), undefined);
});
