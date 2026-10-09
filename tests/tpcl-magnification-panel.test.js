const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TPCL PC magnification in the properties panel: a select of the values the printer accepts (0,5 .. 0,9 and 1 .. 9,5 in steps of 0,5); the value of
// the command is shown as its valid value, an invalid token is listed as an extra "no válido" option, and picking a valid one rewrites only that token.
const PB = loadUpTo('js/properties.js');
const tpcl = PB.languages.get('tpcl');
const { coerceFieldValue } = PB.ui;

const VALID_LABELS = ['0,5×', '0,6×', '0,7×', '0,8×', '0,9×', '1×', '1,5×', '2×', '2,5×', '3×', '3,5×', '4×', '4,5×', '5×', '5,5×', '6×', '6,5×', '7×', '7,5×', '8×', '8,5×', '9×', '9,5×'];
const VALID_VALUES = [5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
const pc = (h, v) => `{PC001;0100,0200,${h},${v},J,00,B=HOLA|}`;
const itemOf = text => tpcl.parse(text).items[0];
const field = (text, key) => tpcl.describeItem(itemOf(text), text).fields.find(f => f.key === key);
const set = (text, changes) => tpcl.updateItem(text, itemOf(text), changes, { dpi: 203 });

test('the two magnifications are selects of the 23 valid values with Spanish labels', () => {
  for (const [key, label] of [['hMag', 'Ampliación horizontal'], ['vMag', 'Ampliación vertical']]) {
    const f = field(pc('09', '1'), key);
    assert.deepEqual([f.type, f.label], ['select', label]);
    assert.deepEqual(f.options.map(o => o.value), VALID_VALUES);
    assert.deepEqual(f.options.map(o => o.label), VALID_LABELS);
  }
});

test('the value shown is the valid value of the token: one digit = whole, two digits = tenths', () => {
  const values = (h, v) => [field(pc(h, v), 'hMag').value, field(pc(h, v), 'vMag').value];
  assert.deepEqual(values('1', '9'), [10, 90]);
  assert.deepEqual(values('09', '05'), [9, 5]);
  assert.deepEqual(values('10', '15'), [10, 15]);
  assert.deepEqual(values('25', '95'), [25, 95]);
  for (const f of ['hMag', 'vMag']) assert.ok(field(pc('2', '15'), f).options.some(o => o.value === field(pc('2', '15'), f).value));
});

test('an invalid token is shown as an extra option marked "no válido" (its value is the token), the valid ones stay', () => {
  const f = field(pc('14', '19'), 'hMag');
  assert.equal(f.value, '14');
  assert.equal(f.options.length, 24);
  assert.deepEqual(f.options.slice(0, 23).map(o => o.value), VALID_VALUES);
  assert.deepEqual(f.options[23], { value: '14', label: '14 (no válido)' });
  assert.equal(field(pc('14', '19'), 'vMag').options[23].label, '19 (no válido)');
  // a valid token lists no extra option
  assert.equal(field(pc('15', '2'), 'hMag').options.length, 23);
});

test('picking the invalid option again changes nothing; picking a valid one rewrites only that token, in its valid form', () => {
  const text = pc('14', '19');
  assert.equal(set(text, { hMag: '14' }), text);
  assert.equal(set(text, { hMag: 15 }), pc('15', '19'));
  assert.equal(set(text, { hMag: 30, vMag: 5 }), pc('3', '05'));
  assert.equal(set(pc('09', '09'), { vMag: 10 }), pc('09', '1'));
  assert.equal(set(pc('09', '09'), { hMag: 95 }), pc('95', '09'));
});

test('the form control round trip: the string of the select option comes back as the option value', () => {
  const f = field(pc('14', '19'), 'hMag');
  assert.equal(coerceFieldValue(f, '15'), 15);
  assert.equal(coerceFieldValue(f, '5'), 5);
  assert.equal(coerceFieldValue(f, '14'), '14');
  assert.equal(coerceFieldValue(f, '16'), undefined);
});

test('the other fields keep working: the order of the fields, the counter and the font are as before', () => {
  const keys = tpcl.describeItem(itemOf(pc('09', '09')), pc('09', '09')).fields.map(f => f.key);
  assert.deepEqual(keys, ['fontType', 'kind', 'hMag', 'vMag', 'rotation', 'font', 'spacing', 'attribute', 'boldH', 'boldV', 'counter', 'zeroSuppress', 'align', 'content']);
  assert.equal(set(pc('14', '19'), { font: 'B', rotation: 90 }), '{PC001;0100,0200,14,19,B,11,B=HOLA|}');
});

test('switching PC <-> PV through the radio keeps producing valid magnifications and valid sizes', () => {
  const src = `{D0630,1000,0600|}\n{C|}\n{PC01;0100,0200,14,19,J,00,B|}\n{RC01;x|}`;
  const vector = tpcl.updateItem(src, tpcl.parse(src).items[0], { fontType: 'vector' }, { dpi: 203 });
  assert.match(vector, /\{PV01;/);
  const back = tpcl.updateItem(vector, tpcl.parse(vector).items[0], { fontType: 'bitmap' }, { dpi: 203 });
  const m = /\{PC01;0100,0200,([^,]+),([^,]+),/.exec(back);
  for (const token of [m[1], m[2]]) assert.match(token, /^(?:[1-9]|0[5-9]|[1-9][05])$/);
  assert.deepEqual(tpcl.parse(back).diagnostics.filter(d => d.level === 'warning'), []);
});
