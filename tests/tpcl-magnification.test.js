const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TPCL PC magnification (manuals B-SV4 2004, B-452-R 2012, B-452-TS12 ES 2001): one digit 1..9 (whole), or two digits 05..09 (0.5..0.9) and from 1 up
// in steps of 0.5 (10, 15, 20 ... 95). Anything else makes the printer skip the whole field. Reading draws the nearest valid value and warns; writing
// only ever produces valid tokens.
const PB = loadUpTo('js/properties.js');
const tpcl = PB.languages.get('tpcl');
const { isValidMagnification, magnificationToken, MAGNIFICATIONS } = PB.slices.text.tpcl;

const parse = text => tpcl.parse(text);
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const pc = (h, v) => `{D0500,0400,0400|}\n{C|}\n{PC01;0100,0200,${h},${v},J,00,B|}\n{RC01;HOLA|}`;

test('the valid set: 05..09, then 1..9.5 in steps of 0.5, in tenths', () => {
  assert.deepEqual([...MAGNIFICATIONS], [5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]);
});

test('isValidMagnification: single digits 1..9, 05..09 and the two digits ending in 0 or 5 from 10', () => {
  for (const ok of ['1', '5', '9', '05', '06', '09', '10', '15', '20', '25', '45', '90', '95']) assert.equal(isValidMagnification(ok), true, ok);
  for (const bad of ['0', '00', '01', '02', '03', '04', '11', '12', '13', '14', '16', '19', '21', '99', '96', '100', '123', '', 'A1', undefined, 5]) assert.equal(isValidMagnification(bad), false, String(bad));
});

test('magnificationToken: whole numbers in one digit, the rest in two digits, never an invalid token', () => {
  assert.deepEqual([5, 6, 9, 10, 15, 20, 90, 95].map(magnificationToken), ['05', '06', '09', '1', '15', '2', '9', '95']);
  for (let tenths = -5; tenths <= 140; tenths += 1) assert.equal(isValidMagnification(magnificationToken(tenths)), true, String(tenths));
  assert.equal(magnificationToken(14), '15');
  assert.equal(magnificationToken(12), '1');
  assert.equal(magnificationToken(3), '05');
  assert.equal(magnificationToken(400), '95');
  assert.equal(magnificationToken(NaN), '1');
});

test('reading a valid token keeps the magnification (single digit = whole, two digits = tenths)', () => {
  const [item] = parse(pc('15', '2')).items;
  assert.equal(item.font.scaleX / 1, 1.5 / 2);
  assert.equal(item.font.size, 12 * PB.units.UNITS_PER_POINT * 2);
  assert.deepEqual(warnings(parse(pc('15', '2'))), []);
  assert.deepEqual(warnings(parse(pc('09', '95'))), []);
});

test('an invalid magnification is drawn as the nearest valid one and reported once per text, with the ref and the valid values', () => {
  const model = parse(pc('14', '19'));
  const [item] = model.items;
  assert.equal(item.font.size, 12 * PB.units.UNITS_PER_POINT * 2); // 1.9 -> 2
  assert.ok(Math.abs(item.font.scaleX - 1.5 / 2) < 1e-9); // 1.4 -> 1.5
  const found = warnings(model);
  assert.equal(found.length, 1);
  assert.match(found[0], /^PC01: /);
  assert.match(found[0], /14/);
  assert.match(found[0], /19/);
  assert.match(found[0], /no imprime/);
  assert.match(found[0], /0,5 a 0,9/);
  assert.match(found[0], /1,5/);
});

test('the user case: 09,09 prints; 14,19 and 01 do not and are reported; only the invalid texts warn', () => {
  assert.deepEqual(warnings(parse(pc('09', '09'))), []);
  assert.equal(warnings(parse(pc('01', '1'))).length, 1);
  const two = parse('{D0500,0400,0400|}\n{C|}\n{PC01;0100,0200,14,19,J,00,B|}\n{PC02;0100,0300,09,09,J,00,B|}\n{RC01;A|}\n{RC02;B|}');
  assert.equal(warnings(two).length, 1);
  assert.match(warnings(two)[0], /^PC01/);
});

test('the invalid token stays as written in native, so nothing rewrites it silently', () => {
  const [item] = parse(pc('14', '19')).items;
  assert.deepEqual([item.native.hMag, item.native.vMag], ['14', '19']);
  assert.deepEqual(item.source.spans.length, 1);
});

test('the default offset of the attribute follows the drawn (valid) magnification', () => {
  const [item] = parse('{D0500,0400,0400|}\n{C|}\n{PC01;0100,0200,14,19,J,00,W|}\n{RC01;A|}').items;
  assert.equal(item.attribute.defaultDots, 2 * 6);
});
