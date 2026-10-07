const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/drawing.js');
const { code39, itf } = PB;
const tpcl = PB.languages.get('tpcl');

const wides = elements => elements.filter(e => e.wide).length;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);
const word = elements => elements.map(e => (e.wide ? 'W' : 'n') + (e.bar ? 'B' : 's')).join('');

// ---- Code 39 encoder

test('code39: every character is 9 elements (5 bars, 4 spaces, 3 wide) and the table is complete', () => {
  assert.equal(Object.keys(code39.PATTERNS).length, 44);
  for (const [ch, pattern] of Object.entries(code39.PATTERNS)) {
    assert.match(pattern, /^[nw]{9}$/, ch);
    assert.equal([...pattern].filter(c => c === 'w').length, 3, ch);
  }
  // The 40 "regular" characters have 2 wide bars and 1 wide space; $ / + % have 3 wide spaces
  const wideBars = ch => [...code39.PATTERNS[ch]].filter((c, i) => i % 2 === 0 && c === 'w').length;
  for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. *') assert.equal(wideBars(ch), 2, ch);
  for (const ch of '$/+%') assert.equal(wideBars(ch), 0, ch);
});

test('code39: start/stop, separators and wide count', () => {
  const { elements, warnings } = code39.encode('AB', { check: 'none' });
  assert.deepEqual(warnings, []);
  // 4 characters (* A B *) x 9 elements + 3 separators
  assert.equal(elements.length, 4 * 9 + 3);
  assert.equal(wides(elements), 4 * 3);
  assert.equal(elements.filter(e => e.gap).length, 3);
  assert.ok(elements.filter(e => e.gap).every(e => !e.bar && !e.wide));
  assert.equal(elements[0].bar, true);
  assert.equal(elements.at(-1).bar, true);
  const star = [...code39.PATTERNS['*']].map(c => c === 'w');
  assert.deepEqual(elements.slice(0, 9).map(e => e.wide), star);
  assert.deepEqual(elements.slice(-9).map(e => e.wide), star);
  // A = wnnnnwnnw
  assert.deepEqual(elements.slice(10, 19).map(e => e.wide), [...code39.PATTERNS.A].map(c => c === 'w'));
});

test('code39: mod 43 check character (CODE39 -> W) is attached only with check mod43', () => {
  assert.equal(code39.checkCharacter('CODE39'), 'W');
  assert.equal(code39.checkCharacter('0'), '0');
  const none = code39.encode('CODE39', { check: 'none' });
  const mod43 = code39.encode('CODE39', { check: 'mod43' });
  assert.equal(mod43.elements.length, none.elements.length + 10);
  assert.equal(mod43.text, 'CODE39');
  const withCheck = code39.encode('CODE39W', { check: 'none' });
  assert.deepEqual(word(mod43.elements), word(withCheck.elements));
});

test('code39: unsupported check digit option draws without check character and warns', () => {
  const plain = code39.encode('ABC', { check: 'none' });
  const odd = code39.encode('ABC', { check: 'unsupported' });
  assert.deepEqual(word(odd.elements), word(plain.elements));
  assert.equal(odd.warnings.length, 1);
  assert.match(odd.warnings[0], /dígito de control.*no soportada por el visor/);
});

test('code39: characters outside standard Code 39 warn and nothing is drawn (no throw)', () => {
  const lower = code39.encode('abc', { check: 'none' });
  assert.deepEqual(lower.elements, []);
  assert.equal(lower.warnings.length, 1);
  assert.match(lower.warnings[0], /no se puede codificar/);
  assert.deepEqual(code39.encode('', { check: 'none' }).elements.length, 2 * 9 + 1);
});

// ---- ITF encoder

test('itf: digit table has 5 elements with 2 wide', () => {
  assert.equal(Object.keys(itf.PATTERNS).length, 10);
  for (const [d, p] of Object.entries(itf.PATTERNS)) {
    assert.match(p, /^[nw]{5}$/, d);
    assert.equal([...p].filter(c => c === 'w').length, 2, d);
  }
});

test('itf: "12" is start nnnn, interleaved 1 (bars) and 2 (spaces), stop wnn', () => {
  const { elements, warnings } = itf.encode('12', { check: 'none' });
  assert.deepEqual(warnings, []);
  // 1 = wnnnw (bars), 2 = nwnnw (spaces): Bw sn Bn sw Bn sn Bn sn Bw sw
  const start = 'nBnsnBns', data = 'WBnsnBWsnBnsnBnsWBWs', stop = 'WBnsnB';
  assert.equal(word(elements), start + data + stop);
  assert.equal(elements.length, 4 + 10 + 3);
  assert.equal(wides(elements), 5);
});

test('itf: odd digit count gets a leading 0 and an unverified-behavior warning', () => {
  const odd = itf.encode('123', { check: 'none' });
  const even = itf.encode('0123', { check: 'none' });
  assert.deepEqual(word(odd.elements), word(even.elements));
  assert.equal(odd.text, '0123');
  assert.equal(odd.warnings.length, 1);
  assert.match(odd.warnings[0], /impar.*no (ha sido )?verificado/);
});

test('itf: non-digits warn and nothing is drawn; unsupported check option warns', () => {
  const bad = itf.encode('12A4', { check: 'none' });
  assert.deepEqual(bad.elements, []);
  assert.match(bad.warnings[0], /solo admite dígitos/);
  const check = itf.encode('1234', { check: 'unsupported' });
  assert.deepEqual(word(check.elements), word(itf.encode('1234', { check: 'none' }).elements));
  assert.match(check.warnings[0], /dígito de control.*no soportada por el visor/);
});

// ---- TPCL parsing

const parseBar = (cmd, dpi = 203) => tpcl.parse(`${cmd}{RB01;ABC|}`, { dpi });

test('tpcl: XB type 3 (Code39) positions, widths in 0.1 mm and native values', () => {
  const m = parseBar('{XB01;0100,0200,3,3,02,03,06,07,04,1,0120,1|}');
  const b = m.items[0];
  assert.deepEqual(m.diagnostics, []);
  assert.equal(b.kind, 'barcode');
  assert.equal(b.symbology, 'code39');
  assert.deepEqual([b.x, b.y, b.rotation, b.height, b.humanReadable, b.data], [100, 200, 90, 120, true, 'ABC']);
  assert.equal(b.check, 'mod43');
  const dot = 254 / 203;
  near(b.module, 2 * dot);
  near(b.widths.narrowBar, 2 * dot);
  near(b.widths.narrowSpace, 3 * dot);
  near(b.widths.wideBar, 6 * dot);
  near(b.widths.wideSpace, 7 * dot);
  near(b.interCharGap, 4 * dot);
  assert.deepEqual(b.native, { type: '3', checkDigit: '3', narrowBar: 2, narrowSpace: 3, wideBar: 6, wideSpace: 7, interCharGap: 4, startStop: null, zeroSuppression: null, fullAscii: false });
});

test('tpcl: widths follow the resolution (300 dpi)', () => {
  const b = parseBar('{XB01;0100,0200,3,1,02,02,06,06,02,0,0100,0|}', 300).items[0];
  near(b.widths.wideBar, 6 * (254 / 300));
  assert.equal(b.check, 'none');
  assert.equal(b.humanReadable, false);
});

test('tpcl: XB type 2 (ITF) and optional qq / r fields', () => {
  const b = parseBar('{XB01;0100,0200,2,1,03,03,08,08,00,2,0150,1,00,T|}').items[0];
  assert.equal(b.symbology, 'itf');
  assert.equal(b.rotation, 180);
  assert.equal(b.height, 150);
  assert.equal(b.native.zeroSuppression, '00');
  assert.equal(b.native.startStop, 'T');
  assert.equal('fullAscii' in b.native, false);
});

test('tpcl: check digit options other than the verified ones are marked unsupported', () => {
  assert.equal(parseBar('{XB01;0100,0200,3,2,02,02,06,06,02,0,0100,0|}').items[0].check, 'unsupported');
  assert.equal(parseBar('{XB01;0100,0200,2,3,02,02,06,06,02,0,0100,0|}').items[0].check, 'unsupported');
  assert.equal(parseBar('{XB01;0100,0200,2,1,02,02,06,06,02,0,0100,0|}').items[0].check, 'none');
});

test('tpcl: type B is Code39 with the full ASCII flag and a warning; start/stop option r warns', () => {
  const full = parseBar('{XB01;0100,0200,B,1,02,02,06,06,02,0,0100,0|}');
  assert.equal(full.items[0].symbology, 'code39');
  assert.equal(full.items[0].native.fullAscii, true);
  assert.ok(full.diagnostics.some(d => d.level === 'warning' && /ASCII/.test(d.text)));
  const r = parseBar('{XB01;0100,0200,3,1,02,02,06,06,02,0,0100,0,P|}');
  assert.equal(r.items[0].native.startStop, 'P');
  assert.ok(r.diagnostics.some(d => d.level === 'warning' && /inicio\/parada/.test(d.text)));
});

test('tpcl: invalid width fields fall back to the module with a warning', () => {
  const m = parseBar('{XB01;0100,0200,3,1,02,xx,06,06,02,0,0100,0|}');
  assert.equal(m.items[0].widths, undefined);
  assert.ok(m.diagnostics.some(d => d.level === 'warning' && /anchos/.test(d.text)));
});

test('tpcl: Code128 parsing is unchanged', () => {
  const b = tpcl.parse('{XB02;0100,0200,9,0,03,0,0100,0,000,1,00|}', { dpi: 203 }).items[0];
  assert.equal(b.symbology, 'code128');
  assert.deepEqual(b.native, { type: '9', module: 3 });
  assert.equal('widths' in b, false);
  assert.equal('check' in b, false);
  assert.equal(b.humanReadable, true);
});

// ---- Neutral validator

test('validator: code128, code39 and itf are exact; other symbologies stay approximate', () => {
  const messages = type => PB.validator.validate(tpcl.parse(`{XB01;0010,0010,${type},1,02,02,06,06,02,0,0100,0|}{RB01;1234|}`), tpcl).map(d => d.text);
  for (const type of ['9', '2', '3', 'B']) assert.equal(messages(type).some(t => /aproximado/.test(t)), false, type);
  assert.equal(messages('Z').some(t => /aproximado/.test(t)), true);
});

// ---- Rendering

const render = (cmd, data, { values = {}, dpi = 203 } = {}) => {
  const m = tpcl.parse(`${cmd}{RB01;${data}|}`, { dpi });
  return PB.svgRenderer.render(m, PB.sizes.view(m, null), { textScale: 1, showGrid: false, showAnchors: false, values });
};
const count = (svg, re) => (svg.match(re) || []).length;
const barCount = svg => count(svg.match(/<path d="([^"]*)"/)[1], /M/g);

test('drawing: Code39 draws real bars, exact label and text only when humanReadable', () => {
  const withText = render('{XB01;0100,0200,3,1,02,02,06,06,02,0,0100,1|}', 'AB');
  const without = render('{XB01;0100,0200,3,1,02,02,06,06,02,0,0100,0|}', 'AB');
  // 4 characters x 5 bars
  assert.equal(barCount(withText.svg), 20);
  assert.match(withText.svg, /<text class="human-readable"[^>]*>AB<\/text>/);
  assert.equal(without.svg.includes('human-readable'), false);
  assert.match(withText.diagnostics[0].text, /^XB01: Code39: /);
  assert.equal(withText.diagnostics[0].text.includes('aprox'), false);
  assert.equal(withText.diagnostics.length, 1);
});

test('drawing: Code39 total width uses the real wide/narrow widths', () => {
  const { svg } = render('{XB01;0100,0200,3,1,02,02,06,06,02,0,0100,0|}', 'A');
  const dot = 254 / 203;
  // 3 characters: each 6 narrow + 3 wide elements; 2 gaps of 2 dots
  const chars = 3 * (6 * 2 + 3 * 6) * dot;
  const total = chars + 2 * 2 * dot;
  const w = Number(svg.match(/<rect class="hit" x="100" y="200" width="([\d.]+)"/)[1]);
  near(w, Number(total.toFixed(2)));
});

test('drawing: ITF draws start, pairs and stop; renderer warns for odd length', () => {
  const { svg, diagnostics } = render('{XB01;0100,0200,2,1,02,02,05,05,00,0,0100,1|}', '123');
  // 0123: start 2 bars + 2 pairs x 5 bars + stop 2 bars
  assert.equal(barCount(svg), 14);
  assert.match(svg, /<text class="human-readable"[^>]*>0123<\/text>/);
  assert.match(diagnostics[0].text, /^XB01: ITF: /);
  assert.ok(diagnostics.some(d => d.level === 'warning' && /^XB01: .*impar/.test(d.text)));
});

test('drawing: unencodable content is not drawn, with a warning, and does not throw', () => {
  const { svg, diagnostics } = render('{XB01;0100,0200,3,1,02,02,06,06,02,0,0100,1|}', 'abc');
  assert.equal(count(svg, /<path d="M/g), 0);
  assert.equal(count(svg, /class="not-generated"/g), 1);
  assert.equal(svg.includes('human-readable'), false);
  assert.ok(diagnostics.some(d => d.level === 'warning'));
});

test('drawing: a model without widths falls back to the module with a 3:1 ratio', () => {
  const m = {
    language: 'x', size: { width: 500, height: 300, pitch: null, gap: null, native: {} }, diagnostics: [],
    items: [{ kind: 'barcode', ref: 'B1', x: 0, y: 0, rotation: 0, module: 2, height: 50, humanReadable: false, symbology: 'itf', native: {}, data: '12' }],
  };
  const { svg } = PB.svgRenderer.render(m, PB.sizes.view(m, null), { textScale: 1, showGrid: false, showAnchors: false, values: {} });
  // 17 elements: 5 wide (6) and 12 narrow (2)
  const w = Number(svg.match(/<rect class="hit" x="0" y="0" width="([\d.]+)"/)[1]);
  assert.equal(w, 5 * 6 + 12 * 2);
});
