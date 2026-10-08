const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Task C1 of odd/tasks/component-candidates.md: EAN-13, EAN-8, UPC-A and UPC-E with +2 / +5 add-ons (encoder, neutral model, drawing).
// The expected values are computed independently of the encoder from the GS1 / ISO 15420 tables typed out below.
const PB = loadApp();
const { ean } = PB;

// --- Independent reference data (GS1 General Specifications, EAN/UPC symbol tables)
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const FIRST_DIGIT = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const UPCE_NS0 = ['GGGLLL', 'GGLGLL', 'GGLLGL', 'GGLLLG', 'GLGGLL', 'GLLGGL', 'GLLLGG', 'GLGLGL', 'GLGLLG', 'GLLGLG'];
const ADDON5 = ['GGLLL', 'GLGLL', 'GLLGL', 'GLLLG', 'LGGLL', 'LLGGL', 'LLLGG', 'LGLGL', 'LGLLG', 'LLGLG'];
const ADDON2 = ['LL', 'LG', 'GL', 'GG'];
const code = (kind, digit) => ({ L, G, R }[kind][digit]);
const side = (digits, parity) => [...digits].map((d, i) => code(parity[i], d)).join('');
const flip = parity => [...parity].map(c => (c === 'G' ? 'L' : 'G')).join('');

const expectEan13 = d => `101${side(d.slice(1, 7), FIRST_DIGIT[d[0]])}01010${side(d.slice(7), 'RRRRRR')}101`;
const expectEan8 = d => `101${side(d.slice(0, 4), 'LLLL')}01010${side(d.slice(4), 'RRRR')}101`;
const expectUpcE = (ns, six, check) => `101${side(six, ns === '1' ? flip(UPCE_NS0[check]) : UPCE_NS0[check])}010101`;
const expectAddon = (digits, parity) => `1011${[...digits].map((d, i) => code(parity[i], d)).join('01')}`;

// --- Check digit (modulus 10), known vectors

test('check digit: EAN-13 / EAN-8 / UPC-A known vectors', () => {
  assert.equal(ean.checkDigit('590123412345'), '7');
  assert.equal(ean.checkDigit('400638133393'), '1');
  assert.equal(ean.checkDigit('9638507'), '4');
  assert.equal(ean.checkDigit('03600029145'), '2');
  assert.equal(ean.checkDigit('04210000526'), '4');
  assert.equal(ean.checkDigit('0'), '0');
});

// --- UPC-E <-> UPC-A expansion

test('UPC-E expands to UPC-A: the rule of each last digit of the six', () => {
  assert.equal(ean.upceToUpca('04252614'), '042100005264');
  assert.equal(ean.upceToUpca('0425261'), '042100005264', '7 digits: the check digit is computed');
  assert.equal(ean.upceToUpca('425261'), '042100005264', '6 digits: number system 0');
  // d6 = 0, 1, 2: manufacturer d1 d2 d6 00, product 00 d3 d4 d5
  assert.equal(ean.upceToUpca('0123450').slice(0, 11), '01200000345');
  assert.equal(ean.upceToUpca('0123451').slice(0, 11), '01210000345');
  assert.equal(ean.upceToUpca('0123452').slice(0, 11), '01220000345');
  // d6 = 3: manufacturer d1 d2 d3 00, product 000 d4 d5
  assert.equal(ean.upceToUpca('0123453').slice(0, 11), '01230000045');
  // d6 = 4: manufacturer d1 d2 d3 d4 0, product 0000 d5
  assert.equal(ean.upceToUpca('0123454').slice(0, 11), '01234000005');
  // d6 = 5..9: manufacturer d1..d5, product 0000 d6
  for (const d6 of '56789') assert.equal(ean.upceToUpca(`012345${d6}`).slice(0, 11), `012345${'0000'}${d6}`);
  // number system 1 is kept
  assert.equal(ean.upceToUpca('1425261').slice(0, 11), '14210000526');
});

test('UPC-E check digit comes from the equivalent UPC-A', () => {
  for (const six of ['425261', '123450', '123453', '123456', '999999']) {
    const upcA = ean.upceToUpca('0' + six);
    assert.equal(upcA[11], ean.checkDigit(upcA.slice(0, 11)), six);
  }
});

// --- Add-ons

test('EAN-5 add-on: the weighted checksum (3 x odd + 9 x even positions) picks the parity', () => {
  assert.equal(ean.addonChecksum('90000'), 7);
  assert.equal(ean.addonChecksum('52495'), 1);
  assert.equal(ean.addonChecksum('55995'), 3);
  assert.equal(ean.addonChecksum('00000'), 0);
  for (const digits of ['90000', '52495', '55995', '12345', '99999']) {
    const encoded = ean.encode('ean13', '590123412345' + digits, { addon: 5 });
    assert.equal(encoded.addonPattern, expectAddon(digits, ADDON5[ean.addonChecksum(digits)]), digits);
    assert.equal(encoded.addonPattern.length, 47);
  }
  assert.equal(ean.encode('ean13', '59012341234590000', { addon: 5 }).addonPattern, expectAddon('90000', 'LGLGL'));
});

test('EAN-2 add-on: the parity follows the value modulo 4', () => {
  for (const value of ['00', '01', '02', '03', '12', '13', '14', '15', '47', '99']) {
    const encoded = ean.encode('ean8', '96385074' + value, { addon: 2 });
    assert.equal(encoded.addonPattern, expectAddon(value, ADDON2[Number(value) % 4]), value);
    assert.equal(encoded.addonPattern.length, 20);
  }
});

// --- Full symbols

test('EAN-13 5901234123457: 95 modules, parity from the first digit', () => {
  const encoded = ean.encode('ean13', '5901234123457');
  assert.equal(encoded.ok, true);
  assert.equal(encoded.pattern.length, 95);
  assert.equal(encoded.width, 95);
  assert.equal(encoded.pattern, expectEan13('5901234123457'));
  assert.equal(encoded.text, '5901234123457');
  assert.deepEqual(encoded.warnings, []);
  // first digit 5: L G G L L G
  assert.equal(encoded.pattern.slice(3, 10), L[9]);
  assert.equal(encoded.pattern.slice(10, 17), G[0]);
  assert.equal(encoded.pattern.slice(17, 24), G[1]);
  assert.equal(encoded.pattern.slice(24, 31), L[2]);
  assert.equal(encoded.pattern.slice(45, 50), '01010');
});

test('EAN-13 4006381333931 and every first digit use the right parity pattern', () => {
  assert.equal(ean.encode('ean13', '4006381333931').pattern, expectEan13('4006381333931'));
  for (let first = 0; first <= 9; first++) {
    const base = `${first}12345678901`;
    const full = base + ean.checkDigit(base);
    assert.equal(ean.encode('ean13', full).pattern, expectEan13(full), String(first));
  }
});

test('EAN-8 96385074: a hand written pattern of 67 modules', () => {
  const encoded = ean.encode('ean8', '96385074');
  const literal = ['101', '0001011', '0101111', '0111101', '0110111', '01010', '1001110', '1110010', '1000100', '1011100', '101'].join('');
  assert.equal(encoded.pattern, literal);
  assert.equal(encoded.pattern, expectEan8('96385074'));
  assert.equal(encoded.pattern.length, 67);
  assert.equal(encoded.width, 67);
});

test('UPC-A 036000291452 is drawn like the EAN-13 with a leading 0 (all left digits odd parity)', () => {
  const encoded = ean.encode('upca', '036000291452');
  assert.equal(encoded.pattern.length, 95);
  assert.equal(encoded.pattern, expectEan13('0036000291452'));
  assert.equal(encoded.text, '036000291452');
  assert.equal(encoded.pattern, ean.encode('ean13', '0036000291452').pattern);
});

test('UPC-E 04252614: 51 modules, parity from the check digit, number system 0 and 1', () => {
  const encoded = ean.encode('upce', '04252614');
  assert.equal(encoded.pattern.length, 51);
  assert.equal(encoded.pattern, expectUpcE('0', '425261', 4));
  assert.equal(encoded.pattern.slice(-6), '010101');
  assert.equal(encoded.text, '04252614');
  assert.equal(ean.encode('upce', '0425261').pattern, encoded.pattern, '7 digits');
  assert.equal(ean.encode('upce', '425261').pattern, encoded.pattern, '6 digits');
  const check = ean.upceToUpca('1425261')[11];
  const ns1 = ean.encode('upce', '1425261' + check);
  assert.equal(ns1.pattern, expectUpcE('1', '425261', Number(check)));
  for (let c = 0; c <= 9; c++) {
    const expected0 = expectUpcE('0', '123456', c);
    assert.equal(expected0.length, 51);
  }
});

test('EAN-13 + 2 / + 5: the add-on starts 9 modules after the end guard', () => {
  const two = ean.encode('ean13', '590123412345712', { addon: 2 });
  assert.equal(two.pattern, expectEan13('5901234123457'));
  assert.equal(two.addonPattern, expectAddon('12', ADDON2[0]));
  assert.equal(two.addonOffset, 95 + 9);
  assert.equal(two.totalWidth, 95 + 9 + 20);
  const five = ean.encode('upca', '03600029145290000', { addon: 5 });
  assert.equal(five.pattern.length, 95);
  assert.equal(five.addonPattern, expectAddon('90000', 'LGLGL'));
  assert.equal(five.totalWidth, 95 + 9 + 47);
  assert.equal(five.text, '036000291452');
  assert.equal(five.addonText, '90000');
});

// --- Check digit options and data validation

test('auto attach: data without the check digit gets it; data with it is validated and warns on a mismatch', () => {
  const short = ean.encode('ean13', '590123412345', { check: 'auto' });
  assert.equal(short.text, '5901234123457');
  assert.equal(short.pattern, expectEan13('5901234123457'));
  assert.deepEqual(short.warnings, []);
  assert.equal(ean.encode('ean8', '9638507').text, '96385074');
  assert.equal(ean.encode('upca', '03600029145').text, '036000291452');
  const wrong = ean.encode('ean13', '5901234123450', { check: 'auto' });
  assert.equal(wrong.ok, true);
  assert.equal(wrong.text, '5901234123450', 'drawn as given');
  assert.equal(wrong.warnings.length, 1);
  assert.match(wrong.warnings[0], /EAN-13: el dígito de control 0 no coincide con el calculado \(7\)/);
});

test('check option "check" validates and "none" draws what it is given; a missing check digit is computed with a warning', () => {
  assert.deepEqual(ean.encode('ean13', '5901234123457', { check: 'check' }).warnings, []);
  assert.equal(ean.encode('ean13', '5901234123450', { check: 'check' }).warnings.length, 1);
  assert.deepEqual(ean.encode('ean13', '5901234123450', { check: 'none' }).warnings, [], 'none: the data is taken as it is');
  assert.equal(ean.encode('ean13', '5901234123450', { check: 'none' }).text, '5901234123450');
  for (const check of ['none', 'check']) {
    const out = ean.encode('ean13', '590123412345', { check });
    assert.equal(out.text, '5901234123457', check);
    assert.equal(out.warnings.length, 1, check);
    assert.match(out.warnings[0], /sin dígito de control/);
  }
});

test('an unsupported check option (price check digits) is drawn as automatic and reported', () => {
  const out = ean.encode('ean13', '590123412345', { check: 'unsupported' });
  assert.equal(out.text, '5901234123457');
  assert.match(out.warnings.join(' '), /opción de dígito de control no soportada/);
});

test('digit counts: EAN-13 12|13, EAN-8 7|8, UPC-A 11|12, UPC-E 6|7|8, add-on 2|5', () => {
  const lengths = (symbology, addon = 0) => Array.from({ length: 22 }, (_, n) => n)
    .filter(n => ean.encode(symbology, '1'.repeat(n), { addon }).ok);
  // the data of a symbol with an add-on is the base digits followed by the add-on digits
  assert.deepEqual(lengths('ean13'), [12, 13]);
  assert.deepEqual(lengths('ean8'), [7, 8]);
  assert.deepEqual(lengths('upca'), [11, 12]);
  assert.deepEqual(lengths('upce').filter(n => n < 9), [6, 7, 8]);
  assert.deepEqual(lengths('ean13', 2).filter(n => n > 13), [14, 15]);
  assert.deepEqual(lengths('ean13', 5).filter(n => n > 13), [17, 18]);
  const bad = ean.encode('ean13', '12345');
  assert.deepEqual([bad.ok, bad.pattern, bad.bars], [false, '', []]);
  assert.match(bad.warnings[0], /^EAN-13: se esperaban 12 dígitos \(13 con dígito de control\) y hay 5, no se dibuja$/);
});

test('non-digits are rejected; UPC-E needs number system 0 or 1', () => {
  for (const [symbology, data] of [['ean13', '59012341234A'], ['ean8', '9638507X'], ['upca', '0360002914 '], ['upce', '0425261A']]) {
    const out = ean.encode(symbology, data);
    assert.equal(out.ok, false, data);
    assert.match(out.warnings[0], /solo admite dígitos, no se dibuja/);
  }
  const ns2 = ean.encode('upce', '2425261');
  assert.equal(ns2.ok, false);
  assert.match(ns2.warnings[0], /UPC-E: el sistema numérico debe ser 0 o 1/);
  assert.equal(ean.encode('ean13', '590123412345', { addon: 2 }).ok, true, 'a missing add-on is reported, the symbol is still drawn');
  assert.match(ean.encode('ean13', '590123412345', { addon: 2 }).warnings.join(' '), /falta el complemento de 2 dígitos/);
  assert.equal(ean.encode('ean13', '590123412345', { addon: 2 }).addonPattern, '');
});

// --- Bars, guards and digit positions (module units)

test('bars: runs of 1 modules; the start, centre and end guards are marked', () => {
  const encoded = ean.encode('ean13', '5901234123457');
  const runs = [...encoded.pattern.matchAll(/1+/g)].map(m => [m.index, m[0].length]);
  assert.deepEqual(encoded.bars.map(b => [b.x, b.w]), runs);
  const guards = encoded.bars.filter(b => b.guard).map(b => b.x);
  assert.deepEqual(guards, [0, 2, 46, 48, 92, 94]);
  const upce = ean.encode('upce', '04252614');
  assert.deepEqual(upce.bars.filter(b => b.guard).map(b => b.x), [0, 2, 46, 48, 50]);
  const ean8 = ean.encode('ean8', '96385074');
  assert.deepEqual(ean8.bars.filter(b => b.guard).map(b => b.x), [0, 2, 32, 34, 64, 66]);
});

test('digit positions: EAN-13 first digit outside to the left, then two groups of six; EAN-8 two groups of four; UPC-A digits outside', () => {
  const centers = (out, zone = 'main') => out.digits.filter(d => d.zone === zone).map(d => [d.char, d.x]);
  const e13 = ean.encode('ean13', '5901234123457');
  assert.deepEqual(centers(e13)[0], ['5', -5]);
  assert.deepEqual(centers(e13).slice(1, 3), ['9', '0'].map((c, i) => [c, 3 + 3.5 + 7 * i]));
  assert.deepEqual(centers(e13).slice(7, 9), ['1', '2'].map((c, i) => [c, 50 + 3.5 + 7 * i]));
  assert.equal(centers(e13).length, 13);
  const e8 = ean.encode('ean8', '96385074');
  assert.deepEqual(centers(e8).map(([, x]) => x), [6.5, 13.5, 20.5, 27.5, 39.5, 46.5, 53.5, 60.5]);
  const upca = ean.encode('upca', '036000291452');
  assert.deepEqual(centers(upca)[0], ['0', -5]);
  assert.deepEqual(centers(upca).at(-1), ['2', 95 + 5]);
  assert.deepEqual(centers(upca).slice(1, 6).map(([, x]) => x), [13.5, 20.5, 27.5, 34.5, 41.5]);
  assert.deepEqual(centers(upca).slice(6, 11).map(([, x]) => x), [53.5, 60.5, 67.5, 74.5, 81.5]);
  const upce = ean.encode('upce', '04252614');
  assert.deepEqual(centers(upce)[0], ['0', -5]);
  assert.deepEqual(centers(upce).at(-1), ['4', 51 + 5]);
  assert.equal(centers(upce).length, 8);
  const addon = ean.encode('ean13', '590123412345712', { addon: 2 });
  assert.deepEqual(centers(addon, 'addon'), [['1', 104 + 4 + 3.5], ['2', 104 + 4 + 7 + 2 + 3.5]]);
});

// --- Drawing at model level

const model = (items, size = {}) => ({
  language: 'tpcl', size: { width: 990, height: 550, pitch: 610, gap: null, native: {}, ...size }, items, diagnostics: [],
});
const item = (props = {}) => ({
  kind: 'barcode', ref: 'XB01', x: 100, y: 200, module: 3, height: 300, rotation: 0, humanReadable: true, symbology: 'ean13', check: 'auto', addon: 0, data: '5901234123457', ...props,
});
const draw = (props, values = {}) => {
  const m = model([item(props)]);
  return PB.svgRenderer.render(m, PB.sizes.view(m, null), { textScale: 1, showGrid: false, showAnchors: false, values });
};
const rectsOf = svg => [...svg.match(/<path d="([^"]*)"/)[1].matchAll(/M([\d.-]+) ([\d.-]+)h([\d.-]+)v([\d.-]+)h/g)].map(m => m.slice(1).map(Number));
const textsOf = svg => [...svg.matchAll(/<text class="human-readable"([^>]*)>([^<]*)<\/text>/g)].map(m => ({
  x: (/ x="([^"]*)"/.exec(m[1])[1]).split(' ').map(Number), y: Number(/ y="([^"]*)"/.exec(m[1])[1]), size: Number(/font-size="([^"]*)"/.exec(m[1])[1]), text: m[2],
}));

test('SVG: bars of the EAN-13 are scaled by the module; guards extend below the main bars', () => {
  const { svg, diagnostics } = draw();
  const rects = rectsOf(svg);
  const runs = [...expectEan13('5901234123457').matchAll(/1+/g)].map(m => [m.index, m[0].length]);
  assert.equal(rects.length, runs.length);
  rects.forEach(([x, y, w], i) => { assert.equal(x, 100 + runs[i][0] * 3); assert.equal(y, 200); assert.equal(w, runs[i][1] * 3); });
  // size = min(max(20, min(40, 0.3 x 300)), 10 x module) = 30: the guards are 30 longer
  const heights = rects.map(r => r[3]);
  assert.deepEqual(heights.filter(h => h === 330).length, 6);
  assert.deepEqual(heights.filter(h => h === 300).length, rects.length - 6);
  assert.deepEqual(rects.filter(r => r[3] === 330).map(r => r[0]), [0, 2, 46, 48, 92, 94].map(m => 100 + m * 3));
  assert.match(svg, /<rect class="hit" x="100" y="200" width="285" height="300"\/>/);
  assert.match(diagnostics[0].text, /^XB01: EAN-13: 95 módulos × [\d,]+ mm = [\d,]+ mm de ancho$/);
  assert.equal(diagnostics.length, 1);
  assert.equal(/class="not-generated"/.test(svg), false);
});

test('SVG: the digits sit below the bars, centred on their module cells (one x per digit)', () => {
  const texts = textsOf(draw().svg);
  assert.equal(texts.length, 3);
  assert.deepEqual(texts.map(t => t.text), ['5', '901234', '123457']);
  for (const t of texts) { assert.equal(t.y, 200 + 300 + 30); assert.equal(t.size, 30); }
  assert.deepEqual(texts[0].x, [100 - 5 * 3]);
  assert.deepEqual(texts[1].x, [0, 1, 2, 3, 4, 5].map(i => 100 + (3 + 3.5 + 7 * i) * 3));
  assert.deepEqual(texts[2].x, [0, 1, 2, 3, 4, 5].map(i => 100 + (50 + 3.5 + 7 * i) * 3));
});

test('SVG: no digits without humanReadable and no guard extension; an explicit guard length (0.1 mm) is used when given', () => {
  const plain = draw({ humanReadable: false });
  assert.equal(plain.svg.includes('human-readable'), false);
  assert.deepEqual([...new Set(rectsOf(plain.svg).map(r => r[3]))], [300]);
  const guarded = draw({ humanReadable: true, guard: 50 });
  assert.deepEqual([...new Set(rectsOf(guarded.svg).map(r => r[3]))].sort(), [300, 350]);
  const none = draw({ humanReadable: true, guard: 0 });
  assert.deepEqual([...new Set(rectsOf(none.svg).map(r => r[3]))], [300], 'guard 0 (TPCL ooo = 000): no guard bars');
  assert.equal(textsOf(none.svg).length, 3, 'the digits are still printed');
  assert.deepEqual([...new Set(rectsOf(draw({ humanReadable: false, guard: 40 }).svg).map(r => r[3]))].sort(), [300, 340]);
});

test('SVG: EAN-8 and UPC-A / UPC-E text layout', () => {
  const e8 = draw({ symbology: 'ean8', data: '96385074' }).svg;
  assert.deepEqual(textsOf(e8).map(t => t.text), ['9638', '5074']);
  assert.deepEqual(textsOf(e8)[1].x, [0, 1, 2, 3].map(i => 100 + (36 + 3.5 + 7 * i) * 3));
  assert.equal(rectsOf(e8).filter(r => r[3] === 330).length, 6);
  const upca = draw({ symbology: 'upca', data: '036000291452' }).svg;
  assert.deepEqual(textsOf(upca).map(t => t.text), ['0', '36000', '29145', '2']);
  assert.equal(textsOf(upca)[3].x[0], 100 + 100 * 3);
  const upce = draw({ symbology: 'upce', data: '04252614' }).svg;
  assert.deepEqual(textsOf(upce).map(t => t.text), ['0', '425261', '4']);
  assert.equal(rectsOf(upce).filter(r => r[3] === 330).length, 5);
});

test('SVG: the add-on bars are shorter, start 9 modules after the symbol, and its digits are ABOVE the add-on bars', () => {
  const { svg, diagnostics } = draw({ addon: 2, data: '590123412345712' });
  const rects = rectsOf(svg);
  const mainEnd = 100 + 95 * 3;
  const addonRects = rects.filter(r => r[0] >= mainEnd);
  const addonRuns = [...expectAddon('12', ADDON2[0]).matchAll(/1+/g)].map(m => [m.index, m[0].length]);
  assert.equal(addonRects.length, addonRuns.length);
  addonRects.forEach(([x, y, w, h], i) => {
    assert.equal(x, 100 + (104 + addonRuns[i][0]) * 3);
    assert.equal(w, addonRuns[i][1] * 3);
    assert.equal(y, 200 + 30, 'starts below the digits');
    assert.equal(h, 300 - 30, 'ends with the main bars');
  });
  const texts = textsOf(svg);
  const addonText = texts.at(-1);
  assert.equal(addonText.text, '12');
  assert.ok(addonText.y < 200 + 30, 'above the add-on bars');
  assert.deepEqual(addonText.x, [100 + (104 + 7.5) * 3, 100 + (104 + 4 + 7 + 2 + 3.5) * 3]);
  assert.match(diagnostics[0].text, /EAN-13 \+2: 124 módulos/);
  const five = draw({ addon: 5, data: '590123412345790000' }).diagnostics[0].text;
  assert.match(five, /EAN-13 \+5: 151 módulos/);
  const noText = draw({ addon: 2, data: '590123412345712', humanReadable: false });
  assert.deepEqual([...new Set(rectsOf(noText.svg).map(r => r[3]))], [300], 'without digits the add-on bars are full height');
});

test('SVG: the data takes variables, and what cannot be encoded is a hatched box with the warnings', () => {
  assert.match(draw({ data: '#N#' }, { N: '5901234123457' }).svg, /<path d="M100 200/);
  const bad = draw({ data: '1234' });
  assert.match(bad.svg, /class="not-generated"/);
  assert.equal(/<path d="M/.test(bad.svg), false);
  assert.match(bad.diagnostics.map(d => d.text).join('|'), /XB01: EAN-13: se esperaban 12 dígitos/);
  const wrongCheck = draw({ data: '5901234123450' });
  assert.equal(/class="not-generated"/.test(wrongCheck.svg), false);
  assert.ok(wrongCheck.diagnostics.some(d => d.level === 'warning' && /no coincide/.test(d.text)));
});

test('SVG: rotation turns the whole symbol around its origin', () => {
  assert.match(draw({ rotation: 90 }).svg, /<g transform="rotate\(90 100 200\)">/);
});

// --- Validator

test('validator: the four symbologies are exact, no longer approximate', () => {
  const tpcl = PB.languages.get('tpcl');
  for (const symbology of ['ean13', 'ean8', 'upca', 'upce']) {
    const diags = PB.validator.validate(model([item({ symbology })]), tpcl);
    assert.equal(diags.some(d => /aproximado/.test(d.text)), false, symbology);
  }
  assert.equal(PB.validator.validate(model([item({ symbology: 'unknown' })]), tpcl).some(d => /aproximado/.test(d.text)), true);
});
