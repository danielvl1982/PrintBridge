const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Task S2 of odd/tasks/gs1-128.md: the GS1 AI table of the logistic subset, the notation parser, the mod 10 check and the Code 128 data.
const PB = loadApp();
const { gs1 } = PB;
const FNC1 = PB.barcodeData.FNC1;

const levels = text => gs1.parse(text).diagnostics.map(d => d.level);
const texts = text => gs1.parse(text).diagnostics.map(d => d.text).join(' | ');

test('the AI table holds exactly the logistic subset', () => {
  assert.deepEqual(Object.keys(gs1.AIS).sort(), ['00', '01', '02', '10', '11', '13', '15', '17', '20', '21', '240', '241', '30', '37', '400', '410', '411', '412', '413', '414', '415']);
  assert.deepEqual({ ...gs1.AIS['00'] }, { kind: 'fixed', length: 18, charset: 'numeric', mod10: true });
  assert.deepEqual({ ...gs1.AIS['10'] }, { kind: 'variable', length: 20, charset: 'set82', mod10: false });
  assert.equal(gs1.AIS['37'].charset, 'numeric');
  assert.equal(gs1.AIS['400'].length, 30);
  assert.ok(gs1.AIS['414'].mod10 && gs1.AIS['414'].length === 13);
});

test('mod10: SSCC and GTIN-14 examples', () => {
  assert.equal(gs1.mod10('00042273000000113'), 1);
  assert.equal(gs1.mod10('1234567890123'), 1);
  assert.equal(gs1.mod10('0950110153000'), 3);
});

test('parse: the standard notation gives the AI / value pairs', () => {
  const r = gs1.parse('(01)09501101530003(17)250101(10)ABC123');
  assert.deepEqual(r.elements, [{ ai: '01', value: '09501101530003' }, { ai: '17', value: '250101' }, { ai: '10', value: 'ABC123' }]);
  assert.deepEqual(r.diagnostics, []);
  assert.deepEqual(gs1.parse('(00)000422730000001131').diagnostics, []);
  assert.deepEqual(gs1.parse('(01)12345678901231').diagnostics, []);
});

test('parse: structural problems are errors', () => {
  assert.deepEqual(levels(''), ['error']);
  assert.match(texts('0095011'), /paréntesis/);
  assert.match(texts('(01'), /paréntesis/);
  assert.match(texts('(99)123'), /99/);
  assert.equal(levels('(99)123')[0], 'error');
  assert.match(texts('(10)'), /vacío/);
  assert.match(texts('(01)123'), /14/);
  assert.match(texts('(17)2501011'), /6/);
  assert.match(texts('(10)ABCDEFGHIJKLMNOPQRSTU'), /20/);
  assert.match(texts('(20)1A'), /dígitos/);
  assert.match(texts('(10)AB CD'), /carácter/);
  assert.ok(levels('(10)AB CD').every(l => l === 'error'));
});

test('parse: bad mod 10 check digit is an error', () => {
  assert.deepEqual(levels('(00)000422730000001132'), ['error']);
  assert.match(texts('(00)000422730000001132'), /control/);
  assert.deepEqual(levels('(01)12345678901232'), ['error']);
  assert.deepEqual(levels('(410)1234567890128'), []);
  assert.deepEqual(levels('(410)1234567890123'), ['error']);
});

test('parse: dates, month 01-12 (error), day 00-31 (error above 31, warning for 00)', () => {
  assert.deepEqual(levels('(17)251301'), ['error']);
  assert.deepEqual(levels('(17)250001'), ['error']);
  assert.deepEqual(levels('(17)250132'), ['error']);
  assert.deepEqual(levels('(17)250131'), []);
  assert.deepEqual(levels('(15)250100'), ['warning']);
});

test('parse: more than 48 data characters is a warning (separators count, leading FNC1 does not)', () => {
  // 2+14 + 2+20 + 1 (FNC1) + 2+8 = 49
  const over = '(01)12345678901231(10)' + 'A'.repeat(20) + '(21)' + 'B'.repeat(8);
  assert.deepEqual(levels(over), ['warning']);
  assert.match(texts(over), /48/);
  assert.deepEqual(levels('(01)12345678901231(10)' + 'A'.repeat(20) + '(21)' + 'B'.repeat(7)), []);
});

test('toCode128Data: leading FNC1, no parentheses, FNC1 only after a variable AI that is not last', () => {
  assert.equal(gs1.toCode128Data('(00)000422730000001131'), FNC1 + '00000422730000001131');
  assert.equal(gs1.toCode128Data('(01)09501101530003(17)250101(10)ABC123'), FNC1 + '01095011015300031725010110ABC123');
  assert.equal(gs1.toCode128Data('(10)ABC(17)250101'), FNC1 + '10ABC' + FNC1 + '17250101');
  assert.equal(gs1.toCode128Data('(10)ABC(21)XY(37)5'), FNC1 + '10ABC' + FNC1 + '21XY' + FNC1 + '375');
  assert.equal(gs1.toCode128Data('(99)1'), null);
  assert.equal(gs1.toCode128Data('nonsense'), null);
});

test('fromCode128Data is the inverse; null without leading FNC1 or with an unknown / ambiguous AI', () => {
  for (const text of ['(00)000422730000001131', '(01)09501101530003(17)250101(10)ABC123', '(10)ABC(17)250101', '(10)ABC(21)XY(37)5', '(400)ORD1(410)1234567890128']) {
    assert.equal(gs1.fromCode128Data(gs1.toCode128Data(text)), text);
  }
  assert.equal(gs1.fromCode128Data('0100012'), null);
  assert.equal(gs1.fromCode128Data(FNC1 + '99123'), null);
  assert.equal(gs1.fromCode128Data(FNC1 + '0109501'), null, 'fixed AI cut short');
  assert.equal(gs1.fromCode128Data(FNC1), null);
  assert.equal(gs1.fromCode128Data(FNC1 + '10'), null, 'empty value');
  assert.equal(gs1.fromCode128Data(FNC1 + '17250101' + FNC1 + '10A'), null, 'FNC1 after a fixed AI');
});

test('readable: the parenthesized line', () => {
  assert.equal(gs1.readable('(01)09501101530003(17)250101'), '(01)09501101530003(17)250101');
  assert.equal(gs1.readable('(10)ABC'), '(10)ABC');
  assert.equal(gs1.readable('free text'), 'free text');
});
