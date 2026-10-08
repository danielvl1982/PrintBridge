const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Task C2 of odd/tasks/component-candidates.md: Code 93, NW7 (Codabar), MSI and Industrial 2 of 5 (encoders and drawing).
// The expected patterns are typed out below from the symbology tables (Code 93 as 9-module strings, Codabar as 7-element
// strings, MSI as 2:1 module strings, Industrial 2 of 5 as bar widths); the check characters are worked out by hand in the comments.
const PB = loadApp();
const { code93, codabar, msi, industrial25 } = PB;

// --- Code 93: 9 modules per symbol, 1 = bar, 0 = space (typed out, independent of the encoder's width strings)
const C93 = {
  0: '100010100', 1: '101001000', 2: '101000100', 3: '101000010', 4: '100101000', 5: '100100100', 6: '100100010', 7: '101010000', 8: '100010010', 9: '100001010',
  A: '110101000', B: '110100100', C: '110100010', D: '110010100', E: '110010010', F: '110001010', G: '101101000', H: '101100100', I: '101100010',
  J: '100110100', K: '100011010', L: '101011000', M: '101001100', N: '101000110', O: '100101100', P: '100010110', Q: '110110100', R: '110110010',
  S: '110101100', T: '110100110', U: '110010110', V: '110011010', W: '101101100', X: '101100110', Y: '100110110', Z: '100111010',
  '-': '100101110', '.': '111010100', ' ': '111010010', $: '111001010', '/': '101101110', '+': '101110110', '%': '110101110',
  '*': '101011110',
};

/** Alternating bar / space widths (starting with a bar) -> module string. */
const modules = widths => widths.map((w, i) => (i % 2 === 0 ? '1' : '0').repeat(w)).join('');
const expected93 = text => `${[...`*${text}*`].map(c => C93[c]).join('')}1`;

test('code93: TEST93 without check characters is start + data + stop + termination bar', () => {
  const { widths, text, characters, warnings } = code93.encode('TEST93', { check: 'none' });
  assert.equal(modules(widths), expected93('TEST93'));
  assert.equal(widths.length % 2, 1, 'it ends with a bar (the termination bar)');
  assert.deepEqual([text, characters, warnings], ['TEST93', 6, []]);
});

// Check character C: weights 1, 2, 3... from the right over the data, modulo 47. Values: T = 29, E = 14, S = 28, 9 = 9, 3 = 3.
//   3 x1 + 9 x2 + T(29) x3 + S(28) x4 + E(14) x5 + T(29) x6 = 3 + 18 + 87 + 112 + 70 + 174 = 464; 464 = 9 x 47 + 41 -> C = 41 = '+'
// Check character K: weights 1, 2, 3... from the right over data + C, modulo 47.
//   +(41) x1 + 3 x2 + 9 x3 + T x4 + S x5 + E x6 + T x7 = 41 + 6 + 27 + 116 + 140 + 84 + 203 = 617; 617 = 13 x 47 + 6 -> K = 6 = '6'
test('code93: TEST93 gets the check characters + and 6 (worked out by hand), only with check auto', () => {
  assert.deepEqual(code93.checkValues('TEST93'), [41, 6]);
  const auto = code93.encode('TEST93', { check: 'auto' });
  assert.equal(modules(auto.widths), expected93('TEST93+6'));
  assert.equal(auto.text, 'TEST93', 'the text does not show the attached characters');
  assert.equal(auto.characters, 8);
  assert.notEqual(modules(code93.encode('TEST93', { check: 'none' }).widths), modules(auto.widths));
});

// The weights cycle 1..20 for C and 1..15 for K. Data '1' + twenty '0': C: the leftmost 1 is the 21st from the right, weight
// ((21 - 1) mod 20) + 1 = 1, the zeros add nothing -> sum 1 -> C = 1. K over data + C (22 values): C has weight 1, the leftmost 1 is the 22nd from
// the right, weight ((22 - 1) mod 15) + 1 = 7 -> sum 1 + 7 = 8 -> K = 8.
test('code93: the check weights wrap at 20 (C) and 15 (K)', () => {
  assert.deepEqual(code93.checkValues('1' + '0'.repeat(20)), [1, 8]);
  // Data twenty '0' + '1': the 1 has weight 1 for C -> C = 1; for K the C has weight 1 and the 1 weight 2 -> 1 + 2 = 3 -> K = 3
  assert.deepEqual(code93.checkValues('0'.repeat(20) + '1'), [1, 3]);
});

test('code93: check "check" draws the data as it is and verifies the two last characters; unsupported draws without them', () => {
  const ok = code93.encode('TEST93+6', { check: 'check' });
  assert.deepEqual(ok.warnings, []);
  assert.equal(modules(ok.widths), expected93('TEST93+6'));
  const wrong = code93.encode('TEST93+7', { check: 'check' });
  assert.equal(wrong.warnings.length, 1);
  assert.match(wrong.warnings[0], /Code93.*dígito de control/);
  assert.equal(modules(wrong.widths), expected93('TEST93+7'), 'it is drawn anyway');
  const odd = code93.encode('TEST93', { check: 'unsupported' });
  assert.equal(modules(odd.widths), expected93('TEST93'));
  assert.match(odd.warnings[0], /Code93: .*no soportada por el visor/);
});

test('code93: every standard character is 3 bars and 3 spaces of 9 modules; characters outside it are reported and not drawn', () => {
  for (const [ch, bits] of Object.entries(C93).filter(([ch]) => ch !== '*')) {
    const widths = code93.encode(ch).widths;
    assert.equal(widths.length, 6 * 3 + 1, ch);
    assert.equal(modules(widths.slice(6, 12)), bits, ch);
    assert.equal(modules(widths.slice(0, 6)), C93['*'], 'start');
    assert.equal(modules(widths.slice(12, 18)), C93['*'], 'stop');
  }
  for (const [ch, bits] of Object.entries(C93)) assert.match(bits, /^(1+0+){3}$/, ch);
  for (const bad of ['test', 'AB*', 'ñ', '\u0001']) {
    const out = code93.encode(bad);
    assert.deepEqual(out.widths, [], bad);
    assert.equal(out.warnings.length, 1);
    assert.match(out.warnings[0], /^Code93: no se puede codificar/);
  }
});

// --- Codabar / NW7: 7 elements (bar, space, bar, space, bar, space, bar), 1 = wide (typed out)
const NW7 = {
  0: '0000011', 1: '0000110', 2: '0001001', 3: '1100000', 4: '0010010', 5: '1000010', 6: '0100001', 7: '0100100', 8: '0110000', 9: '1001000',
  '-': '0001100', $: '0011000', ':': '1000101', '/': '1010001', '.': '1010100', '+': '0010101',
  A: '0011010', B: '0101001', C: '0001011', D: '0001110',
};
const nw = elements => elements.filter(e => !e.gap).map(e => (e.wide ? '1' : '0')).join('');
const expectedNw7 = text => [...text].map(c => NW7[c]).join('');

test('codabar: A40156B with its own start and stop letters, a gap between the characters', () => {
  const { elements, text, characters, warnings } = codabar.encode('A40156B');
  assert.equal(nw(elements), expectedNw7('A40156B'));
  assert.equal(elements.filter(e => e.gap).length, 6);
  assert.ok(elements.filter(e => e.gap).every(e => !e.bar && !e.wide));
  assert.equal(elements[0].bar, true);
  assert.equal(elements.at(-1).bar, true);
  assert.deepEqual(elements.filter(e => !e.gap).map(e => e.bar).slice(0, 8), [true, false, true, false, true, false, true, true], 'bars and spaces alternate inside a character');
  assert.deepEqual([text, characters, warnings], ['A40156B', 5, []]);
});

test('codabar: every symbol of the set (digits - $ : / . + and start / stop A-D) has its pattern', () => {
  assert.deepEqual(Object.keys(codabar.PATTERNS).sort(), Object.keys(NW7).sort());
  for (const [ch, bits] of Object.entries(NW7)) {
    assert.equal(codabar.PATTERNS[ch].replaceAll('n', '0').replaceAll('w', '1'), bits, ch);
  }
  const all = codabar.encode('A0123456789-$:/.+D');
  assert.equal(nw(all.elements), expectedNw7('A0123456789-$:/.+D'));
});

test('codabar: a missing start or stop letter is added as A (assumption: the manual only says the printer attaches them)', () => {
  assert.equal(nw(codabar.encode('123').elements), expectedNw7('A123A'));
  assert.equal(nw(codabar.encode('B123').elements), expectedNw7('B123A'));
  assert.equal(nw(codabar.encode('123D').elements), expectedNw7('A123D'));
  assert.equal(codabar.encode('123').text, '123', 'the text is the data as given');
});

test('codabar: other characters are reported and not drawn; an unsupported check option is reported', () => {
  for (const bad of ['A12x4B', 'A12E4B', 'a123a', 'A1 2B']) {
    const out = codabar.encode(bad);
    assert.deepEqual(out.elements, [], bad);
    assert.match(out.warnings[0], /^NW7: no se puede codificar/);
  }
  const odd = codabar.encode('A40156B', { check: 'unsupported' });
  assert.equal(nw(odd.elements), expectedNw7('A40156B'));
  assert.match(odd.warnings[0], /NW7: .*no soportada por el visor/);
});

// --- MSI: 4 bits per digit; module string with the narrow = 1, wide = 2 (bit 1 = 110, bit 0 = 100), start 110, stop 1001 (typed out)
const msiModules = elements => elements.map(e => (e.bar ? '1' : '0').repeat(e.wide ? 2 : 1)).join('');
const expectedMsi = digits => `110${[...digits].map(d => [...Number(d).toString(2).padStart(4, '0')].map(b => (b === '1' ? '110' : '100')).join('')).join('')}1001`;
const BITS = { 0: '0000', 1: '0001', 2: '0010', 3: '0011', 4: '0100', 5: '0101', 6: '0110', 7: '0111', 8: '1000', 9: '1001' };

test('msi: 1234567 without check digit: start 110, BCD digits (bit 1 = wide bar + narrow space), stop 1001', () => {
  const { elements, text, characters, warnings } = msi.encode('1234567', { check: 'none' });
  const bits = [...'1234567'].map(d => BITS[d]).join('');
  assert.equal(msiModules(elements), `110${[...bits].map(b => (b === '1' ? '110' : '100')).join('')}1001`);
  assert.equal(msiModules(elements), expectedMsi('1234567'));
  assert.equal(elements.length, 2 + 7 * 4 * 2 + 3);
  assert.ok(elements.every(e => !e.gap), 'no space between characters');
  assert.deepEqual([text, characters, warnings], ['1234567', 7, []]);
});

// IBM modulus 10 (check "auto") of 1234567: the digits at odd places from the right (7, 5, 3, 1: read in order 1357) make a number that is
// doubled: 1357 x 2 = 2714 -> 2 + 7 + 1 + 4 = 14; the others (6, 4, 2) add 12; 14 + 12 = 26 -> check = (10 - 6) mod 10 = 4 -> 12345674.
// Modulus 10 + modulus 10: the second digit is the same rule over 12345674: the odd places from the right are 4, 6, 4, 2 (read in order 2464):
// 2464 x 2 = 4928 -> 4 + 9 + 2 + 8 = 23; the others 7, 5, 3, 1 add 16; 23 + 16 = 39 -> check 1 -> 123456741.
// Modulus 11 (weights 2..7 from the right, 1234567): 7x2 + 6x3 + 5x4 + 4x5 + 3x6 + 2x7 + 1x2 = 14 + 18 + 20 + 20 + 18 + 14 + 2 = 106;
// 106 = 9 x 11 + 7 -> 11 - 7 = 4; then modulus 10 over 12345674 = 1 (above) -> 123456741.
test('msi: check digits of 1234567 by hand: IBM modulus 10 = 4, 10 + 10 = 41, 11 + 10 = 41', () => {
  assert.equal(msi.mod10('1234567'), 4);
  assert.equal(msi.mod10('12345674'), 1);
  assert.equal(msi.mod11('1234567'), 4);
  assert.equal(msi.checkDigits('1234567', 'auto').digits, '4');
  assert.equal(msi.checkDigits('1234567', 'mod1010').digits, '41');
  assert.equal(msi.checkDigits('1234567', 'mod1110').digits, '41');
  assert.equal(msi.checkDigits('1234567', 'none').digits, '');
  assert.equal(msiModules(msi.encode('1234567', { check: 'auto' }).elements), expectedMsi('12345674'));
  assert.equal(msiModules(msi.encode('1234567', { check: 'mod1010' }).elements), expectedMsi('123456741'));
  assert.equal(msiModules(msi.encode('1234567', { check: 'mod1110' }).elements), expectedMsi('123456741'));
});

// 9999: modulus 10: odd places 9, 9 (-> 99) x 2 = 198 -> 18; the others 9 + 9 = 18; 36 -> check 4.
//   modulus 10 + 10: over 99994: odd places 4, 9, 9 (read 994) x 2 = 1988 -> 26; the others 9 + 9 = 18; 44 -> check 6 -> 999946.
//   modulus 11: 9x2 + 9x3 + 9x4 + 9x5 = 126 = 11 x 11 + 5 -> 11 - 5 = 6; modulus 10 over 99996: odd places 6, 9, 9 (read 996) x 2 = 1992 -> 21;
//   the others 18; 39 -> check 1 -> 999961.
test('msi: a second hand-worked vector where modulus 10 and 11 differ: 9999 -> 4, 46, 61', () => {
  assert.equal(msi.checkDigits('9999', 'auto').digits, '4');
  assert.equal(msi.checkDigits('9999', 'mod1010').digits, '46');
  assert.equal(msi.checkDigits('9999', 'mod1110').digits, '61');
  assert.equal(msiModules(msi.encode('9999', { check: 'mod1110' }).elements), expectedMsi('999961'));
});

test('msi: check "check" verifies the last digit as IBM modulus 10, a modulus 11 result of 10 is reported, other data is rejected', () => {
  assert.deepEqual(msi.encode('12345674', { check: 'check' }).warnings, []);
  assert.match(msi.encode('12345675', { check: 'check' }).warnings[0], /MSI: .*dígito de control/);
  assert.equal(msiModules(msi.encode('12345675', { check: 'check' }).elements), expectedMsi('12345675'), 'drawn anyway');
  // Data '6': 6 x 2 = 12 = 1 mod 11 -> 11 - 1 = 10, which is not a digit
  const ten = msi.encode('6', { check: 'mod1110' });
  assert.equal(msi.mod11('6'), 10);
  assert.match(ten.warnings[0], /módulo 11 da 10/);
  for (const bad of ['12a4', '1 2', '-1']) {
    assert.deepEqual(msi.encode(bad).elements, [], bad);
    assert.equal(msi.encode(bad).warnings[0], 'MSI: solo admite dígitos, no se dibuja');
  }
  assert.match(msi.encode('123', { check: 'unsupported' }).warnings[0], /MSI: .*no soportada por el visor/);
});

// --- Industrial 2 of 5: bars encode (5 bars per digit, 2 wide), spaces are narrow; start wide wide narrow, stop wide narrow wide
const I25 = { 0: '00110', 1: '10001', 2: '01001', 3: '11000', 4: '00101', 5: '10100', 6: '01100', 7: '00011', 8: '10010', 9: '01010' };
const barsOf = elements => elements.filter(e => e.bar).map(e => (e.wide ? '1' : '0')).join('');
const expectedI25 = digits => `110${[...digits].map(d => I25[d]).join('')}101`;

test('industrial25: 12345 without check digit: start 110, five bars per digit, stop 101; narrow spaces, a gap between characters', () => {
  const { elements, text, characters, warnings } = industrial25.encode('12345', { check: 'none' });
  assert.equal(barsOf(elements), expectedI25('12345'));
  assert.ok(elements.filter(e => !e.bar && !e.gap).every(e => !e.wide), 'the spaces are never wide');
  assert.equal(elements.filter(e => e.gap).length, 6, '7 characters (start, 5 digits, stop)');
  assert.equal(elements.length, 5 + 5 * 9 + 5 + 6);
  assert.equal(elements[0].bar, true);
  assert.equal(elements.at(-1).bar, true);
  assert.deepEqual([text, characters, warnings], ['12345', 5, []]);
});

// Modulus 10 check digit (assumption: the manual only says "modulus check character"): weights 3, 1, 3, 1, 3 from the right:
// 5 x3 + 4 x1 + 3 x3 + 2 x1 + 1 x3 = 15 + 4 + 9 + 2 + 3 = 33 -> (10 - 3) mod 10 = 7 -> 123457
test('industrial25: the check digit of 12345 is 7 (modulus 10, by hand); "check" verifies it, unsupported draws without it', () => {
  assert.equal(industrial25.checkDigit('12345'), 7);
  assert.equal(barsOf(industrial25.encode('12345', { check: 'auto' }).elements), expectedI25('123457'));
  assert.deepEqual(industrial25.encode('123457', { check: 'check' }).warnings, []);
  assert.equal(barsOf(industrial25.encode('123457', { check: 'check' }).elements), expectedI25('123457'));
  assert.match(industrial25.encode('123458', { check: 'check' }).warnings[0], /2 de 5 industrial: .*dígito de control/);
  assert.equal(barsOf(industrial25.encode('12345', { check: 'unsupported' }).elements), expectedI25('12345'));
  assert.match(industrial25.encode('12345', { check: 'unsupported' }).warnings[0], /no soportada por el visor/);
  assert.equal(industrial25.encode('12345', { check: 'auto' }).text, '12345');
});

test('industrial25: digits only (an odd count is fine: nothing is interleaved)', () => {
  assert.equal(barsOf(industrial25.encode('123').elements), expectedI25('123'));
  for (const bad of ['12a', '1 2', '-5']) {
    assert.deepEqual(industrial25.encode(bad).elements, [], bad);
    assert.equal(industrial25.encode(bad).warnings[0], '2 de 5 industrial: solo admite dígitos, no se dibuja');
  }
});

// --- Neutral validator

test('validator: the four symbologies are exact now; unknown ones stay approximate', () => {
  const warns = symbology => PB.validator.validate({ language: 'tpcl', items: [{ kind: 'barcode', ref: 'B1', symbology, native: {}, data: '1' }], diagnostics: [] }, PB.languages.get('tpcl')).filter(d => /aproximado/.test(d.text));
  for (const s of ['code93', 'codabar', 'msi', 'industrial25']) assert.equal(warns(s).length, 0, s);
  assert.equal(warns('unknown').length, 1);
});

// --- Drawing at model level

const draw = (item, values = {}) => {
  const m = {
    language: 'x', size: { width: 900, height: 300, pitch: null, gap: null, native: {} }, diagnostics: [],
    items: [{ kind: 'barcode', ref: 'B1', x: 10, y: 20, rotation: 0, module: 2, height: 50, humanReadable: false, native: {}, ...item }],
  };
  return PB.svgRenderer.render(m, PB.sizes.view(m, null), { textScale: 1, showGrid: false, showAnchors: false, values });
};
const hitWidth = svg => Number(svg.match(/<rect class="hit" x="10" y="20" width="([\d.]+)"/)[1]);
const barRects = svg => (svg.match(/<path d="([^"]*)"/)[1].match(/M/g) || []).length;

test('drawing: Code 93 is module based (module 2): 73 modules for TEST93, 91 with the check characters', () => {
  const none = draw({ symbology: 'code93', check: 'none', data: 'TEST93' });
  assert.equal(hitWidth(none.svg), 73 * 2);
  assert.equal(barRects(none.svg), 8 * 3 + 1, '8 symbols of 3 bars + the termination bar');
  assert.match(none.diagnostics[0].text, /^B1: Code93: 73 módulos/);
  assert.equal(none.diagnostics[0].text.includes('aprox'), false);
  assert.equal(hitWidth(draw({ symbology: 'code93', check: 'auto', data: 'TEST93' }).svg), 91 * 2);
  const text = draw({ symbology: 'code93', check: 'auto', data: 'TEST93', humanReadable: true });
  assert.match(text.svg, /<text class="human-readable"[^>]*>TEST93<\/text>/);
  assert.equal(draw({ symbology: 'code93', check: 'none', data: 'TEST93' }).svg.includes('human-readable'), false);
});

test('drawing: Code 93 with a character it cannot draw is not drawn, with a warning', () => {
  const out = draw({ symbology: 'code93', check: 'none', data: 'test', humanReadable: true });
  assert.equal(out.svg.includes('class="not-generated"'), true);
  assert.equal(out.svg.includes('human-readable'), false);
  assert.ok(out.diagnostics.some(d => d.level === 'warning' && /Code93: no se puede codificar/.test(d.text)));
});

test('drawing: Code 93 draws the variable value of the data', () => {
  const out = draw({ symbology: 'code93', check: 'none', data: '<#A#>' }, { A: 'TEST93' });
  assert.equal(hitWidth(out.svg), 73 * 2);
});

// Codabar, module 2, wide = 3 x module (no explicit widths), gap = module: A40156B = 7 characters of 7 elements, 16 wide (3 + 2 + 2 + 2 + 2 + 2 + 3),
// 33 narrow, 6 gaps: 16 x 6 + 33 x 2 + 6 x 2 = 174
test('drawing: NW7 uses the wide / narrow widths; the text is the data as given', () => {
  const out = draw({ symbology: 'codabar', check: 'none', data: 'A40156B', humanReadable: true });
  assert.equal(hitWidth(out.svg), 174);
  assert.equal(barRects(out.svg), 7 * 4);
  assert.match(out.svg, /<text class="human-readable"[^>]*>A40156B<\/text>/);
  assert.match(out.diagnostics[0].text, /^B1: NW7: /);
  const explicit = draw({ symbology: 'codabar', data: 'A40156B', widths: { narrowBar: 2, narrowSpace: 3, wideBar: 5, wideSpace: 7 }, interCharGap: 4 });
  // Each bar is 5 (wide) or 2 (narrow), each space 7 (wide) or 3 (narrow), plus 6 gaps of 4
  const bars = [...'A40156B'].map(c => codabar.PATTERNS[c]);
  let expected = 6 * 4;
  for (const p of bars) for (const [i, e] of [...p].entries()) expected += i % 2 === 0 ? (e === 'w' ? 5 : 2) : (e === 'w' ? 7 : 3);
  assert.equal(hitWidth(explicit.svg), expected);
});

// MSI 1234567: 61 elements, 30 wide (28 bits, each with one wide element, + start + stop) and 31 narrow: 30 x 6 + 31 x 2 = 242; no gaps
test('drawing: MSI draws 4 bits per digit without gaps', () => {
  const out = draw({ symbology: 'msi', check: 'none', data: '1234567', humanReadable: true });
  assert.equal(hitWidth(out.svg), 242);
  assert.equal(barRects(out.svg), 1 + 28 + 2);
  assert.match(out.svg, /<text class="human-readable"[^>]*>1234567<\/text>/);
  assert.match(out.diagnostics[0].text, /^B1: MSI: /);
  assert.equal(barRects(draw({ symbology: 'msi', check: 'mod1010', data: '1234567' }).svg), 1 + 36 + 2);
});

// Industrial 2 of 5 12345: 55 elements + 6 gaps; 31 bars (14 wide), 24 narrow spaces: 14 x 6 + 17 x 2 + 24 x 2 + 6 x 2 = 178
test('drawing: Industrial 2 of 5 draws bars with narrow spaces', () => {
  const out = draw({ symbology: 'industrial25', check: 'none', data: '12345', humanReadable: true });
  assert.equal(hitWidth(out.svg), 178);
  assert.equal(barRects(out.svg), 31);
  assert.match(out.svg, /<text class="human-readable"[^>]*>12345<\/text>/);
  assert.match(out.diagnostics[0].text, /^B1: 2 de 5 industrial: /);
});

test('drawing: unencodable content of the wide / narrow symbologies is not drawn, with a warning, and does not throw', () => {
  for (const [symbology, data] of [['codabar', 'A1x'], ['msi', '12a'], ['industrial25', 'ab']]) {
    const out = draw({ symbology, data, humanReadable: true });
    assert.equal(out.svg.includes('class="not-generated"'), true, symbology);
    assert.equal(out.svg.includes('human-readable'), false, symbology);
    assert.ok(out.diagnostics.some(d => d.level === 'warning'), symbology);
  }
});
