const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TPCL font selection (text/tpcl.js): the font letter of PC (6th field) and PV (5th field) is a select field of the panel;
// writing replaces only that character and a letter the code does not know is ignored.
const PB = loadUpTo('js/properties.js');
const tpcl = PB.languages.get('tpcl');

const itemsOf = text => tpcl.parse(text).items;
const describe = (text, index = 0) => tpcl.describeItem(itemsOf(text)[index], text);
const fontField = (text, index = 0) => describe(text, index).fields.find(f => f.key === 'font');
const set = (text, changes, index = 0) => tpcl.updateItem(text, itemsOf(text)[index], changes, { dpi: 203 });

const PC = '{PC001;0100,0200,05,06,J,00,B=HOLA|}';
const PV = '{PV01;0100,0200,0100,0120,B,00,B=HOLA|}';

test('PC font: a select with the 20 known letters, the current one selected and described by family, size and weight', () => {
  const f = fontField(PC);
  assert.deepEqual([f.label, f.type, f.value], ['Fuente', 'select', 'J']);
  assert.deepEqual(f.options.map(o => o.value), 'ABCDEFGHIJKLMNOPQRST'.split(''));
  assert.equal(f.options.find(o => o.value === 'J').label, 'J · Sans 12 pt negrita');
  assert.equal(f.options.find(o => o.value === 'F').label, 'F · Serif 12 pt cursiva');
  assert.equal(f.options.find(o => o.value === 'N').label, 'N · Mono 9,5 pt');
});

test('PC font: writing replaces only the letter, with or without spacing and with CRLF or LF', () => {
  assert.equal(set(PC, { font: 'A' }), '{PC001;0100,0200,05,06,A,00,B=HOLA|}');
  const spaced = '{PC001;0100,0200,05,06,J,+05,11,B=HOLA|}';
  assert.equal(fontField(spaced).value, 'J');
  assert.equal(set(spaced, { font: 'T' }), '{PC001;0100,0200,05,06,T,+05,11,B=HOLA|}');
  for (const eol of ['\r\n', '\n']) {
    const text = `{D0500,0400,0400|}${eol}{PC001;0100,0200,05,06,J,00,B|}${eol}{RC001;HOLA|}${eol}{PC002;0100,0300,01,01,H,00,B=X|}${eol}`;
    assert.equal(fontField(text, 1).value, 'H');
    assert.equal(set(text, { font: 'M' }, 1), text.replace(',H,', ',M,'));
    assert.equal(set(text, { font: 'K' }), text.replace(',J,', ',K,'));
  }
});

test('PC font: an unknown letter or a non-string is ignored, and the other fields keep working', () => {
  for (const font of ['Z', 'a', '', 'AB', 5, null]) assert.equal(set(PC, { font }), PC);
  const f = Object.fromEntries(describe(PC).fields.map(x => [x.key, x.value]));
  assert.deepEqual([f.hMag, f.vMag, f.rotation, f.font, f.content], [5, 6, 0, 'J', 'HOLA']);
  assert.equal(set(PC, { hMag: 9, vMag: 8, rotation: 90, font: 'B' }), '{PC001;0100,0200,09,08,B,11,B=HOLA|}');
});

test('PC font: a letter outside the table is listed as an extra option so the select shows the real value', () => {
  const text = '{PC001;0100,0200,05,06,5,00,B=HOLA|}';
  const f = fontField(text);
  assert.equal(f.value, '5');
  assert.equal(f.options.length, 21);
  assert.ok(f.options.some(o => o.value === '5'));
  assert.equal(set(text, { font: 'C' }), '{PC001;0100,0200,05,06,C,00,B=HOLA|}');
  assert.equal(set(text, { font: '5' }), text);
});

test('PV font: A and B outlines, writing replaces only the letter and other letters are kept and shown', () => {
  const f = fontField(PV);
  assert.deepEqual([f.label, f.value, f.options.map(o => o.value)], ['Fuente', 'B', ['A', 'B']]);
  assert.match(f.options[0].label, /^A · Helvetica negrita/);
  assert.match(f.options[1].label, /^B · Helvetica negrita proporcional/);
  assert.equal(set(PV, { font: 'A' }), '{PV01;0100,0200,0100,0120,A,00,B=HOLA|}');
  assert.equal(set(PV, { font: 'C' }), PV);
  const other = '{PV01;0100,0200,0100,0120,C,+03,00,B=HOLA|}';
  const g = fontField(other);
  assert.deepEqual([g.value, g.options.map(o => o.value)], ['C', ['A', 'B', 'C']]);
  assert.equal(set(other, { font: 'A' }), '{PV01;0100,0200,0100,0120,A,+03,00,B=HOLA|}');
  assert.equal(set(other, { width: 90, rotation: 270 }), '{PV01;0100,0200,0090,0120,C,+03,33,B=HOLA|}');
});

test('PV font: width, height and rotation still work from the extended pattern', () => {
  const f = Object.fromEntries(describe(PV).fields.map(x => [x.key, x.value]));
  assert.deepEqual([f.width, f.height, f.rotation, f.font], [100, 120, 0, 'B']);
  assert.equal(set(PV, { width: 50, height: 60, rotation: 180, font: 'A' }), '{PV01;0100,0200,0050,0060,A,22,B=HOLA|}');
});

test('the select of a string option round-trips through the panel coercion', () => {
  const f = fontField(PC);
  assert.equal(PB.ui.coerceFieldValue(f, 'K'), 'K');
  assert.equal(PB.ui.coerceFieldValue(f, 'Z'), undefined);
  assert.equal(PB.ui.coerceFieldValue({ type: 'select', options: [{ value: '3', label: '3' }] }, '3'), '3');
});
