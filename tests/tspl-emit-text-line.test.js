const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tspl.js');
const tspl = PB.languages.get('tspl');
const tpcl = PB.languages.get('tpcl');
const example = PB.examples.find(e => e.id === 'tspl-label-100x60');
const spool = PB.examples.find(e => e.id === 'spool-99x55');

const UPP = PB.units.UNITS_PER_POINT;
const dotOf = dpi => 254 / dpi;

const emit = (model, dpi = 203) => PB.languages.emit('tspl', model, { dpi });
const lines = (model, dpi) => emit(model, dpi).text.split('\r\n');
const model = (items = [], size = {}) => ({
  language: 'tspl',
  size: { width: 1000, height: 600, pitch: null, gap: null, native: {}, ...size },
  items,
  diagnostics: [],
});
// Body lines of an emitted label: without the header (SIZE, DIRECTION, CLS) and the PRINT line
const body = (items, dpi) => lines(model(items), dpi).filter(l => !/^(SIZE|GAP|DIRECTION|CLS|PRINT)\b/.test(l) && l !== '');
const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));

/** Mono font drawn by the bitmap font with cell (cellW x cellH) and multipliers, at 203 dpi unless told otherwise. */
const mono = (cellW, cellH, xmul, ymul, dpi = 203) => ({
  size: cellH * ymul * dotOf(dpi), scaleX: (cellW * xmul) / (cellH * ymul * 0.6), family: 'mono', weight: 400, style: 'normal',
});
const sans = (points, scaleX = 1, extra = {}) => ({ size: points * UPP, scaleX, family: 'sans', weight: 400, style: 'normal', ...extra });
// The model keeps the baseline of a text and TEXT the top of its character cell: 80% of the height (whole dots) above the baseline
const ascent = (font, dpi = 203) => Math.round(Math.round(font.size / dotOf(dpi)) * (font.family === 'mono' ? 0.8 : 0.75)) * dotOf(dpi);
const text = (props = {}) => {
  const font = props.font || mono(24, 32, 1, 1);
  return { kind: 'text', x: 40 * dotOf(203), y: 30 * dotOf(203) + ascent(font), rotation: 0, data: 'HOLA', ...props, font };
};
const line = (props = {}) => ({ kind: 'line', x1: 100, y1: 60, x2: 500, y2: 60, rect: false, width: 25, ...props });
const box = (props = {}) => line({ rect: true, x1: 20, y1: 10, x2: 780, y2: 470, width: 25, ...props });

/** Neutral items of the kinds T4 emits, without the identity/origin fields. */
const neutral = parsed => parsed.items
  .filter(i => ['text', 'line'].includes(i.kind))
  .map(({ source, raw, native, ref, ...rest }) => ({ ...rest }));

test('the tspl language registers an emit hook', () => {
  assert.equal(typeof tspl.emit, 'function');
});

test('header: SIZE with one decimal, GAP, DIRECTION and CLS, then PRINT, joined with CRLF', () => {
  const out = emit(model([], { width: 991, height: 600, gap: 30 }));
  assert.equal(out.text, 'SIZE 99.1 mm,60 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nPRINT 1,1\r\n');
  assert.deepEqual(levels(out.diagnostics, 'error', 'warning'), []);
});

test('without a known gap GAP is omitted with a Spanish info', () => {
  const out = emit(model());
  assert.equal(out.text.split('\r\n')[0], 'SIZE 100 mm,60 mm');
  assert.ok(!/GAP/.test(out.text));
  assert.ok(out.diagnostics.some(d => d.level === 'info' && /separación/.test(d.text) && /marca negra/.test(d.text)));
});

test('REFERENCE and SHIFT are never written', () => {
  const out = emit(model([text()]));
  assert.ok(!/REFERENCE|SHIFT/.test(out.text));
});

test('a model without size writes no SIZE and warns in Spanish', () => {
  const out = emit(model([], { width: null, height: null }));
  assert.ok(!/SIZE/.test(out.text));
  assert.ok(out.text.includes('CLS'));
  assert.ok(out.diagnostics.some(d => d.level === 'warning' && /tamaño/.test(d.text)));
  const half = emit(model([], { height: null }));
  assert.ok(!/SIZE/.test(half.text));
});

test('the header is read back by the parser without diagnostics', () => {
  const parsed = tspl.parse(emit(model([], { width: 991, height: 551, gap: 25 })).text);
  assert.deepEqual(parsed.diagnostics, []);
  assert.ok(Math.abs(parsed.size.width - 991) < 1e-6);
  assert.ok(Math.abs(parsed.size.height - 551) < 1e-6);
  assert.ok(Math.abs(parsed.size.gap - 25) < 1e-6);
});

test('built-in fonts: every font 1..8 is chosen from its cell height and multipliers', () => {
  const cells = { 1: [8, 12], 2: [12, 20], 3: [16, 24], 4: [24, 32], 5: [32, 48], 6: [14, 19], 7: [21, 27], 8: [14, 25] };
  for (const [font, [w, h]] of Object.entries(cells)) {
    // A multiplier of 3 avoids the ties between fonts whose heights are multiples of one another
    const out = body([text({ font: mono(w, h, 2, 3) })]);
    assert.equal(out[0], `TEXT 40,30,"${font}",0,2,3,"HOLA"`, `font ${font}`);
  }
});

test('built-in fonts: the font with the best fit wins, ties go to the lowest multiplier', () => {
  // 24 dots high: font 3 x1 and font 1 x2 both fit exactly, the real cell of font 3 is kept
  assert.equal(body([text({ font: mono(16, 24, 1, 1) })])[0], 'TEXT 40,30,"3",0,1,1,"HOLA"');
  // 20 dots high: font 2 x1 (exact) beats font 6 (19 dots, 5% off)
  assert.equal(body([text({ font: mono(12, 20, 1, 1) })])[0], 'TEXT 40,30,"2",0,1,1,"HOLA"');
});

test('built-in fonts at 300 dpi', () => {
  const font = mono(24, 32, 2, 2, 300);
  const t = text({ x: 40 * dotOf(300), y: 30 * dotOf(300) + ascent(font, 300), font });
  assert.equal(body([t], 300)[0], 'TEXT 40,30,"4",0,2,2,"HOLA"');
});

test('a model font that no bitmap font reproduces becomes font "0" with point sizes and an info once', () => {
  const out = emit(model([
    text({ font: sans(10, 1, { weight: 700 }) }),
    text({ font: sans(12, 0.8, { style: 'italic' }) }),
    text({ font: mono(24, 32, 1, 1) }),
  ]));
  const rows = out.text.split('\r\n').filter(l => l.startsWith('TEXT'));
  assert.equal(rows[0], 'TEXT 40,30,"0",0,10,10,"HOLA"');
  assert.equal(rows[1], 'TEXT 40,30,"0",0,10,12,"HOLA"');
  assert.equal(rows[2], 'TEXT 40,30,"4",0,1,1,"HOLA"');
  const infos = out.diagnostics.filter(d => d.level === 'info' && /fuentes TSPL/.test(d.text));
  assert.equal(infos.length, 1);
});

test('font "0": xmul = round(ymul * scaleX), minimum 1', () => {
  assert.equal(body([text({ font: sans(10, 0.8) })])[0], 'TEXT 40,30,"0",0,8,10,"HOLA"');
  assert.equal(body([text({ font: sans(10, 0.01) })])[0], 'TEXT 40,30,"0",0,1,10,"HOLA"');
  assert.equal(body([text({ font: { ...sans(10), size: 0.1 * UPP } })])[0], 'TEXT 40,30,"0",0,1,1,"HOLA"');
});

test('a sans font of regular weight needs no font info, bold / italic / serif do', () => {
  const infoCount = font => emit(model([text({ font })])).diagnostics.filter(d => d.level === 'info' && /fuentes TSPL/.test(d.text)).length;
  assert.equal(infoCount(sans(10)), 0);
  assert.equal(infoCount(mono(24, 32, 1, 1)), 0);
  assert.equal(infoCount(sans(10, 1, { weight: 700 })), 1);
  assert.equal(infoCount(sans(10, 1, { style: 'italic' })), 1);
  assert.equal(infoCount(sans(10, 1, { family: 'serif' })), 1);
});

test('rotations 0/90/180/270 are written as they are', () => {
  const codes = [0, 90, 180, 270].map(rotation => body([text({ rotation })])[0].split(',')[3]);
  assert.deepEqual(codes, ['0', '90', '180', '270']);
});

test('a rotation that is not a quarter turn is adjusted with a Spanish warning once', () => {
  const out = emit(model([text({ rotation: 44 }), text({ rotation: 100 })]));
  assert.deepEqual(out.text.split('\r\n').filter(l => l.startsWith('TEXT')).map(l => l.split(',')[3]), ['0', '90']);
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

test('text coordinates become dots at the resolution', () => {
  // the baseline y is the top y plus the ascent of the font (whole dots)
  const at = dpi => body([text({ x: 600, y: 75 + ascent(mono(24, 32, 1, 1, dpi), dpi), font: mono(24, 32, 1, 1, dpi) })], dpi)[0].split(',').slice(0, 2).join(',');
  assert.equal(at(203), 'TEXT 480,60');
  assert.equal(at(300), 'TEXT 709,89');
});

test('quotes in the content use the \\["] escape and are read back', () => {
  const out = body([text({ data: 'say "hi", ok' })]);
  assert.equal(out[0], 'TEXT 40,30,"4",0,1,1,"say \\["]hi\\["], ok"');
  const parsed = tspl.parse(emit(model([text({ data: 'say "hi", ok' })])).text);
  assert.deepEqual(levels(parsed.diagnostics, 'error', 'warning'), []);
  assert.equal(parsed.items[0].data, 'say "hi", ok');
});

test('a line break in the content becomes a space with one Spanish warning', () => {
  const out = emit(model([text({ data: 'a\r\nb\nc' }), text({ data: 'd\re' })]));
  assert.ok(out.text.includes('"a  b c"'));
  assert.ok(out.text.includes('"d e"'));
  const warnings = levels(out.diagnostics, 'warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /salto/);
  assert.equal(out.text.split('\r\n').filter(l => l.startsWith('TEXT')).length, 2);
});

test('#NAME# placeholders are written literally with one Spanish info', () => {
  const out = emit(model([text({ data: '#ROLLNUM# / #TOTAL#' }), text({ data: '#X#' })]));
  assert.ok(out.text.includes('"#ROLLNUM# / #TOTAL#"'));
  assert.equal(out.diagnostics.filter(d => d.level === 'info' && /variables #NOMBRE# se escriben como texto literal en TSPL/.test(d.text)).length, 1);
});

test('empty or missing data is an empty string', () => {
  assert.equal(body([text({ data: '' })])[0], 'TEXT 40,30,"4",0,1,1,""');
  assert.equal(body([text({ data: null })])[0], 'TEXT 40,30,"4",0,1,1,""');
});

test('boxes become BOX with normalized corners and the thickness in dots (minimum 1)', () => {
  const dot = dotOf(203);
  assert.equal(body([box({ x1: 780 * dot, y1: 470 * dot, x2: 20 * dot, y2: 10 * dot, width: 4 * dot })])[0], 'BOX 20,10,780,470,4');
  assert.equal(body([box({ x1: 20 * dot, y1: 10 * dot, x2: 780 * dot, y2: 470 * dot, width: 0.2 })])[0], 'BOX 20,10,780,470,1');
  const d300 = dotOf(300);
  assert.equal(body([box({ x1: 30 * d300, y1: 15 * d300, x2: 300 * d300, y2: 200 * d300, width: 6 * d300 })], 300)[0], 'BOX 30,15,300,200,6');
});

test('horizontal lines become a BAR centered on the line, at 203 and 300 dpi', () => {
  const dot = dotOf(203);
  // A BAR 20,205,760,3: the line runs through y = 206.5 dots
  assert.equal(body([line({ x1: 20 * dot, y1: 206.5 * dot, x2: 780 * dot, y2: 206.5 * dot, width: 3 * dot })])[0], 'BAR 20,205,760,3');
  // Right to left gives the same bar
  assert.equal(body([line({ x1: 780 * dot, y1: 206.5 * dot, x2: 20 * dot, y2: 206.5 * dot, width: 3 * dot })])[0], 'BAR 20,205,760,3');
  const d = dotOf(300);
  assert.equal(body([line({ x1: 10 * d, y1: 52 * d, x2: 410 * d, y2: 52 * d, width: 4 * d })], 300)[0], 'BAR 10,50,400,4');
});

test('vertical lines become a BAR centered on the line', () => {
  const dot = dotOf(203);
  assert.equal(body([line({ x1: 101.5 * dot, y1: 300 * dot, x2: 101.5 * dot, y2: 100 * dot, width: 3 * dot })])[0], 'BAR 100,100,3,200');
});

test('a thin line is at least 1 dot thick', () => {
  const dot = dotOf(203);
  assert.equal(body([line({ x1: 10 * dot, y1: 20 * dot, x2: 110 * dot, y2: 20 * dot, width: 0.1 })])[0], 'BAR 10,20,100,1');
});

test('a diagonal line is skipped with a Spanish warning that mentions DIAGONAL', () => {
  const out = emit(model([line({ x1: 0, y1: 0, x2: 400, y2: 300 }), text()]));
  assert.ok(!/BAR/.test(out.text));
  const warnings = levels(out.diagnostics, 'warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /DIAGONAL/);
  assert.match(warnings[0].text, /diagonal/i);
  assert.ok(out.text.includes('TEXT'));
});

test('a line off axis by one dot or less still counts as axis aligned', () => {
  const dot = dotOf(203);
  const out = emit(model([line({ x1: 10 * dot, y1: 20 * dot, x2: 110 * dot, y2: 20.8 * dot, width: 2 * dot })]));
  assert.ok(/BAR /.test(out.text));
  assert.deepEqual(levels(out.diagnostics, 'warning'), []);
});

test('every emitted line is read back by the parser without errors or warnings', () => {
  const dot = dotOf(203);
  const m = model([
    text(), text({ font: sans(10), rotation: 90, data: 'a "q", b' }), text({ font: mono(12, 20, 2, 1) }),
    box({ x1: 20 * dot, y1: 10 * dot, x2: 780 * dot, y2: 470 * dot, width: 4 * dot }),
    line({ x1: 20 * dot, y1: 206.5 * dot, x2: 780 * dot, y2: 206.5 * dot, width: 3 * dot }),
  ], { gap: 30 });
  const parsed = tspl.parse(emit(m).text);
  assert.deepEqual(levels(parsed.diagnostics, 'error', 'warning'), []);
  assert.equal(parsed.items.length, 5);
});

test('items of a kind without an emitter are reported as a Spanish warning', () => {
  const out = emit(model([{ kind: 'hologram', x: 1, y: 1 }, text()]));
  assert.ok(out.diagnostics.some(d => d.level === 'warning' && /hologram/.test(d.text) && /sin emisor/.test(d.text)));
  assert.ok(out.text.includes('TEXT'));
});

test('PB.languages.emit returns { text, diagnostics }', () => {
  const out = PB.languages.emit('tspl', model([text()]), { dpi: 203 });
  assert.equal(typeof out.text, 'string');
  assert.ok(Array.isArray(out.diagnostics));
  assert.ok(out.text.startsWith('SIZE ') && out.text.endsWith('PRINT 1,1\r\n'));
});

for (const dpi of [203, 300]) {
  test(`round trip TSPL -> TSPL on the TSPL example at ${dpi} dpi keeps the text/line/box items`, () => {
    const first = tspl.parse(example.source, { dpi });
    const out = emit(first, dpi);
    const second = tspl.parse(out.text, { dpi });
    assert.deepEqual(levels(second.diagnostics, 'error', 'warning'), []);
    const [a, b] = [neutral(first), neutral(second)];
    assert.equal(a.length, 7);
    assert.equal(b.length, a.length);
    // Tolerance: coordinates, thicknesses and font sizes are integer dots (or points) both ways, so only the float
    // noise of dots * dotSize is allowed; everything else (kind, rect, rotation, data, font family) must be equal.
    const close = (x, y) => Math.abs(x - y) < 1e-6;
    a.forEach((item, i) => {
      const other = b[i];
      assert.deepEqual({ ...item, font: undefined, x: 0, y: 0, x1: 0, y1: 0, x2: 0, y2: 0, width: 0 },
        { ...other, font: undefined, x: 0, y: 0, x1: 0, y1: 0, x2: 0, y2: 0, width: 0 });
      for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'width']) {
        if (k in item) assert.ok(close(item[k], other[k]), `item ${i} ${k}: ${item[k]} vs ${other[k]}`);
      }
      if (item.font) {
        assert.ok(close(item.font.size, other.font.size) && close(item.font.scaleX, other.font.scaleX), `item ${i} font`);
        assert.deepEqual([item.font.family, item.font.weight, item.font.style], [other.font.family, other.font.weight, other.font.style]);
      }
    });
    assert.deepEqual([second.size.width, second.size.height, second.size.gap], [first.size.width, first.size.height, first.size.gap]);
    // Barcode and QR have a TSPL emitter since T5 (the full round trip is in tspl-emit-barcode-qr-image.test.js)
    assert.equal(out.diagnostics.filter(d => /sin emisor/.test(d.text)).length, 0);
  });
}

test('a TPCL label emitted as TSPL produces text lines and the expected warnings', () => {
  const parsed = tpcl.parse(spool.source);
  const out = emit(parsed);
  assert.ok(out.text.split('\r\n').filter(l => l.startsWith('TEXT ')).length > 0);
  assert.ok(out.diagnostics.some(d => d.level === 'info' && /fuentes TSPL/.test(d.text)));
  assert.ok(out.diagnostics.every(d => !/sin emisor/.test(d.text)));
  assert.ok(out.diagnostics.some(d => d.level === 'info' && /separación/.test(d.text)));
  const back = tspl.parse(out.text);
  assert.deepEqual(levels(back.diagnostics, 'error', 'warning'), []);
});
