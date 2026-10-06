const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// TPCL moveItem (tpcl.js): rewrites only the coordinate fields of one item's command.
const PB = load(['js/lib/qrcode-generator.min.js', 'js/config.js', 'js/core.js', 'js/languages/tpcl.js', 'js/barcodes.js']);
const tpcl = PB.languages.get('tpcl');

/** Parses the text, moves its first item and returns { out, before, after } (items before and after the move). */
function move(text, dx, dy, dpi = 203, index = 0) {
  const model = tpcl.parse(text, { dpi });
  const out = tpcl.moveItem(text, model.items[index], dx, dy, { dpi });
  return { out, before: model.items[index], after: tpcl.parse(out, { dpi }).items[index] };
}

const PC = '{PC001;0100,0200,05,05,A,00,B|}';
const PV = '{PV01;0100,0200,0100,0100,B,00,B|}';
const XB = '{XB01;0100,0200,9,0,2,0,100,0,000,1,00|}';
const QR = '{XB02;0100,0200,T,H,05|}';
const LC = '{LC;0100,0200,0500,0600,0,02|}';
const SG = '{SG;0100,0200,8,1,0,?0|}';
const SGD = '{SG;0100D,0200D,8,1,0,?0|}';

test('moveItem is exposed as an optional language hook', () => {
  assert.equal(typeof tpcl.moveItem, 'function');
});

test('moveItem: PC text moves x and y only', () => {
  const { out, after } = move(PC, 50, -30);
  assert.equal(out, '{PC001;0150,0170,05,05,A,00,B|}');
  assert.deepEqual([after.x, after.y], [150, 170]);
});

test('moveItem: PV text moves x and y only', () => {
  assert.equal(move(PV, 10, 20).out, '{PV01;0110,0220,0100,0100,B,00,B|}');
});

test('moveItem: XB 1D barcode moves x and y only', () => {
  const { out, after } = move(XB, -100, 5);
  assert.equal(out, '{XB01;0000,0205,9,0,2,0,100,0,000,1,00|}');
  assert.deepEqual([after.x, after.y], [0, 205]);
});

test('moveItem: XB QR moves x and y only', () => {
  const { out, after } = move(QR, 25, 25);
  assert.equal(out, '{XB02;0125,0225,T,H,05|}');
  assert.deepEqual([after.x, after.y], [125, 225]);
});

test('moveItem: LC shifts both points and keeps type and thickness', () => {
  const { out, after } = move(LC, 40, -50);
  assert.equal(out, '{LC;0140,0150,0540,0550,0,02|}');
  assert.deepEqual([after.x1, after.y1, after.x2, after.y2], [140, 150, 540, 550]);
});

test('moveItem: LC clamps each point independently', () => {
  assert.equal(move(LC, -150, 0).out, '{LC;0000,0200,0350,0600,0,02|}');
});

test('moveItem: SG without D is written in 0.1 mm', () => {
  const { out, after } = move(SG, 30, 40);
  assert.equal(out, '{SG;0130,0240,8,1,0,?0|}');
  assert.deepEqual([after.x, after.y], [130, 240]);
});

test('moveItem: SG with D converts 0.1 mm to dots and keeps the D flag (203 dpi)', () => {
  // dot = 254/203 = 1.2512 (0.1 mm): 125 -> 100 dots
  const { out, after } = move(SGD, 125.12, -125.12, 203);
  assert.equal(out, '{SG;0200D,0100D,8,1,0,?0|}');
  assert.deepEqual([after.x, after.y], [Math.round(200 * 254 / 203), Math.round(100 * 254 / 203)]);
});

test('moveItem: SG with D at 300 dpi uses that dpi for the conversion', () => {
  // dot = 254/300 = 0.8467: 84.67 -> 100 dots
  assert.equal(move(SGD, 84.6667, 0, 300).out, '{SG;0200D,0200D,8,1,0,?0|}');
});

test('moveItem: SG with only one D suffix converts only that axis', () => {
  const text = '{SG;0100D,0200,8,1,0,?0|}';
  assert.equal(move(text, 125.12, 10, 203).out, '{SG;0200D,0210,8,1,0,?0|}');
});

test('moveItem: SG data after the 5th comma stays untouched', () => {
  const text = '{SG;0100,0200,8,2,0,?0;:0?|}';
  const { out } = move(text, 10, 10);
  assert.equal(out, '{SG;0110,0210,8,2,0,?0;:0?|}');
});

test('moveItem: keeps 4 digits when the result has fewer', () => {
  assert.equal(move('{PC001;0100,0200,05,05,A,00,B|}', -95, -195).out, '{PC001;0005,0005,05,05,A,00,B|}');
});

test('moveItem: clamps to 0..9999', () => {
  assert.equal(move(PC, -5000, 99999).out, '{PC001;0000,9999,05,05,A,00,B|}');
});

test('moveItem: SG with D clamps the dot value to 0..9999', () => {
  assert.equal(move(SGD, -99999, 99999, 203).out, '{SG;0000D,9999D,8,1,0,?0|}');
});

test('moveItem: rounds to integers', () => {
  assert.equal(move(PC, 10.4, 10.6).out, '{PC001;0110,0211,05,05,A,00,B|}');
});

test('moveItem: works with CR/LF inside the command', () => {
  const text = '{PC001;0100,0200,\r\n05,05,A,00,B|}';
  const { out, after } = move(text, 10, 10);
  assert.equal(out, '{PC001;0110,0210,\r\n05,05,A,00,B|}');
  assert.deepEqual([after.x, after.y], [110, 210]);
});

test('moveItem: CR/LF between the command name and the coordinates', () => {
  const text = '{LC;\r\n0100,0200,\r\n0500,0600,0,02|}';
  assert.equal(move(text, 10, 10).out, '{LC;\r\n0110,0210,\r\n0510,0610,0,02|}');
});

test('moveItem: neighbouring commands and text are untouched', () => {
  const text = `{D0500,0800,0600|}\r\n${PC}\r\n{RC001;HELLO|}\r\n${LC}\r\n{XS;I,0001,0002C5000|}\r\n`;
  const model = tpcl.parse(text);
  const pc = model.items.find(i => i.ref === 'PC001');
  const out = tpcl.moveItem(text, pc, 10, 10, { dpi: 203 });
  assert.equal(out, text.replace(PC, '{PC001;0110,0210,05,05,A,00,B|}'));
  const lc = tpcl.parse(out).items.find(i => i.kind === 'line');
  assert.deepEqual([lc.x1, lc.y1], [100, 200]);
});

test('moveItem: moves the right command when several share the text', () => {
  const text = `${PC}\n{PC002;0300,0400,05,05,A,00,B|}`;
  const { out } = move(text, 10, 10, 203, 1);
  assert.equal(out, `${PC}\n{PC002;0310,0410,05,05,A,00,B|}`);
});

test('moveItem: item without source (overlay image) returns the text unchanged', () => {
  assert.equal(tpcl.moveItem(PC, { kind: 'image', x: 0, y: 0 }, 10, 10, { dpi: 203 }), PC);
});

test('moveItem: unknown kind returns the text unchanged', () => {
  const item = { kind: 'other', source: { spans: [{ start: 0, end: PC.length }] } };
  assert.equal(tpcl.moveItem(PC, item, 10, 10, { dpi: 203 }), PC);
});
