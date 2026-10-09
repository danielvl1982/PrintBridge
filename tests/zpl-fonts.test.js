const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// V1 (Volume Two, 2005, printed pages 61 and 64-65): the bitmapped font matrices by printhead (8 dots/mm = 203 dpi, 12 dots/mm = 300 dpi; any
// other resolution uses the 203 table), the fonts P..V, the inter-character gap and the baseline of ^FO. The numbers below are the manual's.
// Table 10 (page 61): H x W, intercharacter gap and baseline of A..H (203 dpi): A 9x5 1 7 / B 11x7 2 11 / C,D 18x10 2 14 / E 28x15 5 23 /
// F 26x13 3 21 / G 60x40 8 48 / H 21x13 6 21, and for font 0 the baseline is 3 x HEIGHT / 4. The matrix tables: E 42x20 and H 34x22 at 300 dpi,
// P 20x18, Q 28x24, R 35x31, S 40x35, T 48x42, U 59x53, V 80x71 (letters, U-L-D) at both. GS (24x24 SYMBOL) is not offered: see the README.
const PB = loadUpTo('js/ui.js');
const zpl = PB.languages.get('zpl');
const dotOf = dpi => 254 / dpi;
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol + 1e-6, `${label}: ${a} vs ${b} (tolerance ${tol})`);

/** [height, width, pitch (width + gap)] of every bitmapped font by resolution. */
const M203 = { A: [9, 5, 6], B: [11, 7, 9], C: [18, 10, 12], D: [18, 10, 12], E: [28, 15, 20], F: [26, 13, 16], G: [60, 40, 48], H: [21, 13, 19],
  P: [20, 18, 18], Q: [28, 24, 24], R: [35, 31, 31], S: [40, 35, 35], T: [48, 42, 42], U: [59, 53, 53], V: [80, 71, 71] };
const M300 = { ...M203, E: [42, 20, 25], H: [34, 22, 29] };
/** Baseline of each font at 1x (Table 10); P..V are not in the table (0.75, the rule of the scalable font). */
const BASELINE = { A: 7, B: 11, C: 14, D: 14, E: 23, F: 21, G: 48, H: 21 };

const parseAt = (src, dpi) => zpl.parse(`^XA${src}^XZ`, { dpi });
const item = (src, dpi) => parseAt(src, dpi).items[0];

for (const [dpi, table] of [[203, M203], [300, M300], [254, M203], [600, M203]]) {
  test(`${dpi} dpi: each bitmapped font reads with the manual's cell and pitch (${dpi === 203 || dpi === 300 ? `${dpi === 203 ? 8 : 12} dots/mm table` : '203 dpi table as fallback'})`, () => {
    const dot = dotOf(dpi);
    for (const [name, [h, w, pitch]] of Object.entries(table)) {
      const t = item(`^FT10,10^A${name}N^FDx^FS`, dpi);
      const label = `font ${name}`;
      assert.deepEqual(t.native.font, name, label);
      assert.equal(t.font.family, 'mono', label);
      near(t.font.size / dot, h, 1e-6, `${label} height`);
      near(t.font.scaleX * 0.6 * t.font.size / dot, pitch, 1e-6, `${label} pitch`);
      // magnified 3x: the multiple of the matrix of this resolution
      const m = item(`^FT10,10^A${name}N,${h * 3},${w * 3}^FDx^FS`, dpi);
      near(m.font.size / dot, h * 3, 1e-6, `${label} 3x height`);
      near(m.font.scaleX * 0.6 * m.font.size / dot, pitch * 3, 1e-6, `${label} 3x pitch`);
      assert.deepEqual([m.native.hMult, m.native.wMult], [3, 3], label);
    }
  });
}

test('the fonts P..V are letter fonts of the manual: read mono with no "no definition" information; GS and the digits still are not', () => {
  for (const name of 'PQRSTUV') assert.deepEqual(parseAt(`^FT10,10^A${name}N,30,30^FDx^FS`, 254).diagnostics, [], name);
  const gs = parseAt('^FT10,10^A5N,30,30^FDx^FS', 254);
  assert.deepEqual(gs.diagnostics.map(d => d.level), ['info']);
});

test('the baseline of ^FO is the one of Table 10 (page 61) times the magnification; font 0 is 3 x height / 4', () => {
  // 254 dpi: one dot is 0.1 mm, so dots and model units are the same number; ^FO10,50 and a baseline b below it
  for (const [name, b] of Object.entries(BASELINE)) {
    const [h] = M203[name];
    assert.equal(item(`^FO10,50^A${name}N^FDx^FS`, 254).y, 50 + b, `${name} 1x`);
    assert.equal(item(`^FO10,50^A${name}N,${h * 2},0^FDx^FS`, 254).y, 50 + 2 * b, `${name} 2x`);
  }
  assert.equal(item('^FO10,50^A0N,40,40^FDx^FS', 254).y, 80);
  assert.equal(item('^FO10,50^A0N,100,100^FDx^FS', 254).y, 125);
  // ^FT does not use it
  assert.equal(item('^FT10,50^AEN^FDx^FS', 254).y, 50);
  // P..V: no baseline in the manual, the scalable rule is used
  assert.equal(item('^FO10,50^AVN^FDx^FS', 254).y, 50 + 60);
});

test('the baseline of a rotated ^FO box uses the same ascent; emit puts the box back (round trip of ^FO, 2x magnified)', () => {
  for (const dpi of [203, 254, 300]) {
    const table = dpi === 300 ? M300 : M203;
    for (const [name, o] of [['E', 'N'], ['E', 'R'], ['E', 'I'], ['E', 'B'], ['Q', 'N'], ['H', 'R'], ['0', 'B']]) {
      const [h, w] = name === '0' ? [40, 30] : table[name].slice(0, 2).map(v => v * 2);
      const src = `^FO100,50^A${name}${o},${h},${w}^FDHi^FS`;
      const model = zpl.parse(`^XA^PW800^LL480${src}^XZ`, { dpi });
      const back = zpl.emit(model, { dpi }).text.split('\r\n').find(l => l.startsWith('^FO'));
      assert.equal(back, src, `${src} at ${dpi}`);
    }
  }
});

test('emit at 300 dpi writes the 300 dpi matrix: a font written at 300 reads back as the same font (E 42x20, H 34x22, every P..V)', () => {
  for (const [dpi, table] of [[203, M203], [300, M300]]) {
    for (const name of Object.keys(table)) {
      const [h, w] = table[name];
      for (const mult of [1, 2, 5]) {
        const src = `^FT100,200^A${name}N,${h * mult},${w * mult}^FDx^FS`;
        const model = zpl.parse(`^XA^PW1000^LL800${src}^XZ`, { dpi });
        const out = zpl.emit(model, { dpi });
        assert.ok(out.text.includes(src), `${name} x${mult} at ${dpi}: ${out.text}`);
        assert.deepEqual(out.diagnostics.filter(d => d.level !== 'info'), [], `${name} x${mult} at ${dpi}`);
      }
    }
  }
});

test('a neutral mono text is never given to P..V (they are only written when the item came from them); the scalable font is the fallback', () => {
  const dot = dotOf(203);
  // 20 x 18 cell mono: the size of P at 1x, but P is source-only
  const model = { size: { width: 800, height: 480 }, items: [{ kind: 'text', ref: 'T', x: 10, y: 100, rotation: 0, data: 'x', font: { family: 'mono', weight: 400, style: 'normal', size: 20 * dot, scaleX: 18 / (0.6 * 20) } }] };
  const line = zpl.emit(model, { dpi: 203 }).text.split('\r\n').find(l => l.startsWith('^FT'));
  assert.doesNotMatch(line, /\^A[P-V]/);
});

test('the font select lists A..H, P..V and 0 (no GS), the label shows the 203 dpi cell and says where 300 dpi differs', () => {
  const text = '^XA^FO10,10^AAN,9,5^FDx^FS^XZ';
  const [a] = zpl.parse(text, { dpi: 203 }).items;
  const font = zpl.describeItem(a, text, { dpi: 203 }).fields.find(f => f.key === 'font');
  assert.deepEqual(font.options.map(o => o.value), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', '0']);
  const label = id => font.options.find(o => o.value === id).label;
  assert.match(label('P'), /^P · 20×18 puntos/);
  assert.match(label('V'), /^V · 80×71 puntos/);
  assert.match(label('E'), /28×15 puntos.*42×20 a 300 dpi.*OCR-B/);
  assert.match(label('H'), /21×13 puntos.*34×22 a 300 dpi.*OCR-A/);
  assert.doesNotMatch(label('A'), /300 dpi/);
  // the select can write any of them
  assert.equal(zpl.updateItem(text, a, { font: 'V' }, { dpi: 203 }), '^XA^FO10,10^AVN,9,5^FDx^FS^XZ');
  assert.equal(zpl.updateItem(text, a, { font: 'GS' }, { dpi: 203 }), text);
});
