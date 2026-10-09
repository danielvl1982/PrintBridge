const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TPCL PC magnification, writing side: whatever produces a PC command (the emitter for the other languages and the model, the PV -> PC switch, the
// properties panel) writes only the tokens the printer accepts (one digit 1..9, 05..09, then 10, 15 ... 95; see tpcl-magnification.test.js).
const PB = loadUpTo('js/properties.js');
const tpcl = PB.languages.get('tpcl');
const UPP = PB.units.UNITS_PER_POINT;

const VALID = /^(?:[1-9]|0[5-9]|[1-9][05])$/;
const PC_TOKENS = /\{PC\d+;\d+,\d+,(\d+),(\d+),/g;
const tokensOf = text => [...text.matchAll(PC_TOKENS)].flatMap(m => [m[1], m[2]]);
const model = items => ({ language: 'neutral', size: { width: 1000, height: 600, pitch: 630, gap: 30, native: {} }, items, diagnostics: [] });
const emit = items => PB.languages.emit('tpcl', model(items), { dpi: 203 });
const font = (size, family = 'sans', weight = 700, style = 'normal', scaleX = 1) => ({ size, scaleX, family, weight, style });
const text = font_ => ({ kind: 'text', x: 100, y: 200, rotation: 0, data: 'HOLA', font: font_ });
const warnings = diagnostics => diagnostics.filter(d => d.level === 'warning').map(d => d.text);

test('a font that is a valid magnification of a PC font is written as that PC (whole numbers in one digit, 0.5 and x.5 in two)', () => {
  const cases = [[1, 1, '1', '1'], [2, 2, '2', '2'], [1.5, 2.5, '15', '25'], [0.5, 0.9, '05', '09'], [9, 9.5, '9', '95']];
  for (const [h, v, th, tv] of cases) {
    const out = emit([text(font(12 * UPP * v, 'sans', 700, 'normal', h / v))]);
    assert.match(out.text, new RegExp(String.raw`\{PC00;0100,0200,${th},${tv},J,`), `${h} x ${v}`);
  }
});

test('a size that only an invalid magnification (1.4, 1.9, 2.8 ...) would reproduce is not written as a PC with it: the text is an outline PV', () => {
  for (const mag of [1.4, 1.9, 2.8, 3.3]) {
    const out = emit([text(font(12 * UPP * mag))]);
    assert.deepEqual(tokensOf(out.text), [], `magnification ${mag}`);
    assert.match(out.text, /\{PV00;/, `magnification ${mag}`);
  }
});

test('no size, width, family or style makes the emitter write an invalid magnification', () => {
  const families = [['sans', 700, 'normal'], ['sans', 400, 'normal'], ['serif', 400, 'italic'], ['mono', 400, 'normal'], ['serif', 700, 'normal']];
  let pcs = 0;
  for (const [family, weight, style] of families) {
    for (let size = 20; size <= 600; size += 7) {
      for (const scaleX of [0.5, 0.75, 1, 1.5, 2.2]) {
        const tokens = tokensOf(emit([text(font(size, family, weight, style, scaleX))]).text);
        pcs += tokens.length / 2;
        for (const token of tokens) assert.match(token, VALID, `${family} ${weight} ${style} size ${size} scaleX ${scaleX}`);
      }
    }
  }
  assert.ok(pcs >= 10, `${pcs} PC texts were checked`);
});

test('exact valid magnifications of every font and magnification pair are found (the best fit is still the one nearest to 1.0)', () => {
  // J (sans bold 12 pt) at 1 x 1 and the same size as K (14 pt) is not 1: 12 pt x 7/6 is no valid magnification, so only J 1 x 1 matches
  assert.match(emit([text(font(12 * UPP))]).text, /\{PC00;0100,0200,1,1,J,/);
  // two PC fonts draw 24 pt: J (12 pt) at 2 and M (18 pt) at no valid one; the 2 x 2 of J wins
  assert.match(emit([text(font(24 * UPP))]).text, /\{PC00;0100,0200,2,2,J,/);
  // J at 3 and K (14 pt) at no valid one for 36 pt: 36 / 18 = 2 (M at 2) and J at 3: the one with the vertical magnification nearest to 1 is M 2
  assert.match(emit([text(font(36 * UPP))]).text, /\{PC00;0100,0200,2,2,M,/);
});

test('emitting a text that falls back to PV warns about the outline font as before and never writes a PC magnification', () => {
  const out = emit([text(font(12 * UPP * 1.4))]);
  assert.deepEqual(warnings(out.diagnostics).filter(t => /magnifica/i.test(t)), []);
  assert.deepEqual(tokensOf(out.text), []);
});

test('PV -> PC through the panel: the magnifications are always valid, whatever the width and height of the outline text', () => {
  let n = 0;
  for (let width = 10; width <= 500; width += 17) {
    for (let height = 10; height <= 500; height += 23) {
      const src = `{D0630,1000,0600|}\n{C|}\n{PV01;0100,0200,${String(width).padStart(4, '0')},${String(height).padStart(4, '0')},B,00,B|}\n{RV01;x|}`;
      const out = tpcl.updateItem(src, tpcl.parse(src).items[0], { fontType: 'bitmap' }, { dpi: 203 });
      const tokens = tokensOf(out);
      assert.equal(tokens.length, 2, out);
      for (const token of tokens) assert.match(token, VALID, `${width} x ${height}: ${out}`);
      assert.deepEqual(warnings(tpcl.parse(out).diagnostics), [], out);
      n++;
    }
  }
  assert.ok(n > 500);
});

test('the properties panel writes the valid magnification nearest to the value, with the same token form as the emitter', () => {
  const src = '{PC001;0100,0200,05,06,J,00,B=HOLA|}';
  const set = changes => tpcl.updateItem(src, tpcl.parse(src).items[0], changes, { dpi: 203 });
  assert.equal(set({ hMag: 10, vMag: 20 }), '{PC001;0100,0200,1,2,J,00,B=HOLA|}');
  assert.equal(set({ hMag: 15, vMag: 95 }), '{PC001;0100,0200,15,95,J,00,B=HOLA|}');
  assert.equal(set({ hMag: 14, vMag: 19 }), '{PC001;0100,0200,15,2,J,00,B=HOLA|}');
  assert.equal(set({ hMag: 1, vMag: 400 }), '{PC001;0100,0200,05,95,J,00,B=HOLA|}');
  assert.equal(set({ hMag: 'x' }), src);
  assert.equal(set({ hMag: NaN }), src);
});

test('TSPL / ZPL texts of every size converted to TPCL never come out with an invalid magnification', () => {
  let pcs = 0;
  for (let points = 4; points <= 60; points += 1) {
    const tspl = `SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nTEXT 40,40,"0",0,${points},${Math.max(4, points - 2)},"HOLA"\r\nPRINT 1,1\r\n`;
    const zpl = `^XA\r\n^PW800\r\n^LL480\r\n^FO40,40^A0N,${points * 3},${points * 2}^FDHOLA^FS\r\n^XZ\r\n`;
    for (const [source, id] of [[tspl, 'tpcl'], [zpl, 'tpcl']]) {
      const { text: out } = PB.convert.run(source, id, { dpi: 203 });
      const tokens = tokensOf(out);
      pcs += tokens.length / 2;
      for (const token of tokens) assert.match(token, VALID, `${points} pt: ${out}`);
      assert.deepEqual(warnings(tpcl.parse(out).diagnostics).filter(t => /ampliación/.test(t)), [], out);
    }
  }
  assert.ok(pcs > 0);
});
