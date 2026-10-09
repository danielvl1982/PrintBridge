const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// T6: cross conversion TPCL <-> TSPL. Each example is converted with PB.convert.run, the converted text is parsed again by
// the target parser and compared with the original model.
//
// Tolerance rules (all units are 0.1 mm, dot = PB.units.dotSize(dpi)):
//   - coordinates, line ends, barcode height, barcode module/widths, QR cell, line thickness: |delta| <= 1 dot
//     (the conversion rounds to whole dots TPCL -> TSPL and to whole 0.1 mm TSPL -> TPCL, so the real error is <= 0.5)
//   - label width/height: |delta| <= 1 (TSPL writes one decimal of a mm). The TPCL pitch and the TSPL gap are one value
//     (pitch = height + gap, derived on reading): pitch/gap are compared when both sides have them.
//   - text size and character width (size * scaleX): |delta| <= half a point (UNITS_PER_POINT / 2), the rounding of the TSPL
//     scalable font "0" (whole points). Family, weight and style are not compared: a change must be reported by the font info.
//   - barcode interCharGap is not compared (the TSPL parser always sets it to the module); everything else is exact:
//     kinds and their order, text data, rotation, symbology, check, humanReadable, QR ecc and data, rect flag.
const PB = loadUpTo('js/ui.js');
const spool = PB.examples.find(e => e.id === 'spool-99x55');
const barcodes = PB.examples.find(e => e.id === 'barcodes-code39-itf-code128');
const tsplExample = PB.examples.find(e => e.id === 'tspl-label-100x60');
const FNC1 = PB.barcodeData.FNC1;

const EPS = 1e-6;
const dotOf = dpi => PB.units.dotSize(dpi);
const HALF_POINT = PB.units.UNITS_PER_POINT / 2;
const parserOf = id => PB.languages.get(id);
const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));
const brief = diagnostics => diagnostics.map(d => [d.level, d.text]);
const bitmapOf = (w, h, fn) => ({ w, h, data: Uint8Array.from({ length: w * h }, (_, i) => (fn(i % w, Math.floor(i / w)) ? 1 : 0)) });

function near(a, b, tol, label) {
  assert.ok(Math.abs(a - b) <= tol + EPS, `${label}: ${a} vs ${b} (tolerance ${tol})`);
}

/** Compares the original items with the re-parsed ones under the tolerance rules above. */
function assertSameLabel(original, converted, dpi) {
  const dot = dotOf(dpi);
  const [a, b] = [original.items, converted.items];
  assert.deepEqual(b.map(i => i.kind), a.map(i => i.kind), 'item kinds in the same order');
  a.forEach((x, n) => {
    const y = b[n];
    const at = `item ${n} (${x.kind})`;
    switch (x.kind) {
      case 'text':
        // The baseline of a TSPL text follows its character cell, so a substituted font (another size) moves it along the ascent
        {
          const sizeGap = Math.abs(x.font.size - y.font.size);
          const ascent = sizeGap > 1e-6 ? 0.8 * sizeGap + dot : 0; // plus the dot the ascent is rounded to
          const along = x.rotation % 180 === 0;
          near(x.x, y.x, dot + (along ? 0 : ascent), `${at} x`);
          near(x.y, y.y, dot + (along ? ascent : 0), `${at} y`);
        }
        assert.equal(y.data, x.data, `${at} data`);
        assert.equal(y.rotation, x.rotation, `${at} rotation`);
        near(x.font.size, y.font.size, HALF_POINT, `${at} font size`);
        near(x.font.size * x.font.scaleX, y.font.size * y.font.scaleX, HALF_POINT, `${at} character width`);
        break;
      case 'line':
        for (const k of ['x1', 'y1', 'x2', 'y2', 'width']) near(x[k], y[k], dot, `${at} ${k}`);
        assert.equal(y.rect, x.rect, `${at} rect`);
        break;
      case 'barcode':
        near(x.x, y.x, dot, `${at} x`);
        near(x.y, y.y, dot, `${at} y`);
        near(x.height, y.height, dot, `${at} height`);
        near(x.module, y.module, dot, `${at} module`);
        for (const k of ['symbology', 'data', 'check', 'humanReadable', 'rotation']) assert.equal(y[k], x[k], `${at} ${k}`);
        assert.equal(!!y.widths, !!x.widths, `${at} widths presence`);
        if (x.widths) for (const k of Object.keys(x.widths)) near(x.widths[k], y.widths[k], dot, `${at} widths.${k}`);
        break;
      case 'qr':
        near(x.x, y.x, dot, `${at} x`);
        near(x.y, y.y, dot, `${at} y`);
        near(x.cell, y.cell, dot, `${at} cell`);
        assert.equal(y.ecc, x.ecc, `${at} ecc`);
        assert.equal(y.data, x.data, `${at} data`);
        break;
      case 'image':
        near(x.x, y.x, dot, `${at} x`);
        near(x.y, y.y, dot, `${at} y`);
        assert.equal(y.bitmap.h, x.bitmap.h, `${at} bitmap height`);
        break;
      default:
        assert.fail(`unexpected kind ${x.kind}`);
    }
  });
  near(original.size.width, converted.size.width, 1, 'label width');
  near(original.size.height, converted.size.height, 1, 'label height');
  if (original.size.pitch != null && converted.size.pitch != null) near(original.size.pitch, converted.size.pitch, 1, 'pitch');
  if (original.size.gap != null && converted.size.gap != null) near(original.size.gap, converted.size.gap, 1, 'gap');
}

/** Converts a source text and parses the output again. */
function cross(source, targetId, dpi) {
  const result = PB.convert.run(source, targetId, { dpi });
  const original = parserOf(result.source).parse(source, { dpi });
  const converted = parserOf(targetId).parse(result.text, { dpi });
  return { result, original, converted };
}

// Exact fidelity diagnostics (level + message prefix) of each conversion, in emission order. They are the same at 203 and 300 dpi.
const INFO_FONTS_TSPL = ['info', 'Las fuentes TSPL no coinciden'];
const INFO_SIZE_TSPL = ['info', 'Hay textos cuyo tamaño se redondea a puntos enteros'];
const INFO_VARIABLES = ['info', 'Las variables #NOMBRE# se escriben como texto literal en TSPL'];
const INFO_AX = ['info', 'No se escribe {AX'];
const INFO_PITCH = ['info', 'El paso de etiqueta (pitch) no está especificado'];
const INFO_FONTS_TPCL = ['info', 'Las fuentes TPCL no coinciden'];
const INFO_XS = ['info', 'Parámetros de {XS} por defecto'];

const CASES = [
  { example: spool, from: 'tpcl', to: 'tspl', expected: [INFO_FONTS_TSPL, INFO_SIZE_TSPL, INFO_VARIABLES] },
  { example: barcodes, from: 'tpcl', to: 'tspl', expected: [INFO_FONTS_TSPL, INFO_VARIABLES] },
  { example: tsplExample, from: 'tspl', to: 'tpcl', expected: [INFO_AX, INFO_FONTS_TPCL, INFO_XS] },
];

for (const dpi of [203, 300]) {
  for (const { example, from, to, expected } of CASES) {
    test(`${example.id} ${from} -> ${to} at ${dpi} dpi re-parses without errors and keeps kinds, data and geometry`, () => {
      const { result, original, converted } = cross(example.source, to, dpi);
      assert.equal(result.source, from);
      assert.equal(result.target, to);
      assert.deepEqual(levels(original.diagnostics, 'error', 'warning'), []);
      assert.deepEqual(levels(converted.diagnostics, 'error', 'warning'), [], 'the target parser reads the output cleanly');
      assert.ok(original.items.length > 0);
      assertSameLabel(original, converted, dpi);
    });

    test(`${example.id} ${from} -> ${to} at ${dpi} dpi produces exactly the documented fidelity diagnostics`, () => {
      const { result } = cross(example.source, to, dpi);
      const actual = result.diagnostics.map((d, i) => [d.level, d.text.slice(0, (expected[i] || ['', ''])[1].length)]);
      assert.deepEqual(actual, expected);
      assert.equal(levels(result.diagnostics, 'warning', 'error').length, 0, 'only info diagnostics for the examples');
    });
  }
}

test('TPCL -> TSPL keeps the label size and carries the pitch as GAP = pitch - height', () => {
  const { original, converted } = cross(spool.source, 'tspl', 203);
  assert.deepEqual([original.size.width, original.size.height, original.size.pitch], [990, 550, 610]);
  assert.deepEqual([converted.size.width, converted.size.height, converted.size.gap], [990, 550, 60]);
  assert.equal(converted.size.pitch, 610);
});

test('TSPL -> TPCL writes the pitch height + GAP and says nothing about it', () => {
  const { result, converted } = cross(tsplExample.source, 'tpcl', 203);
  assert.deepEqual([converted.size.width, converted.size.height, converted.size.pitch, converted.size.gap], [1000, 600, 630, 30]);
  assert.ok(!result.diagnostics.some(d => /paso de etiqueta/.test(d.text)));
});

test('fonts that change family, weight or style are always reported (TPCL -> TSPL and TSPL -> TPCL)', () => {
  for (const [source, target, prefix] of [[spool.source, 'tspl', 'Las fuentes TSPL'], [tsplExample.source, 'tpcl', 'Las fuentes TPCL']]) {
    const { result, original, converted } = cross(source, target, 203);
    const key = f => `${f.family}/${f.weight}/${f.style}`;
    const changed = original.items.some((x, n) => x.kind === 'text' && key(x.font) !== key(converted.items[n].font));
    assert.ok(changed, 'this example does lose a font attribute');
    assert.equal(result.diagnostics.filter(d => d.text.startsWith(prefix)).length, 1);
  }
});

test('the scalable font rounding info appears only when a size really changes', () => {
  const { result } = cross(barcodes.source, 'tspl', 203);
  assert.ok(!result.diagnostics.some(d => /redondea a puntos enteros/.test(d.text)), 'sizes of 6 pt are exact');
  assert.ok(cross(spool.source, 'tspl', 203).result.diagnostics.some(d => /redondea a puntos enteros/.test(d.text)), '9.6 pt becomes 10 pt');
});

// --- Items that cannot be expressed ---

const TSPL_UNSUPPORTED = [
  'SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm', 'DIRECTION 1', 'CLS',
  'TEXT 40,30,"3",0,1,1,"Hola"',
  'BARCODE 40,100,"POST",80,1,0,2,2,"12345"',
  'BARCODE 40,200,"128M",80,1,0,2,2,"01!10223"',
  'BARCODE 40,300,"EAN128",80,1,0,2,2,"0112345678901231"',
  'PRINT 1,1',
].join('\r\n');

for (const dpi of [203, 300]) {
  test(`TSPL -> TPCL at ${dpi} dpi: a Postnet barcode has no TPCL counterpart, is absent and is named in a Spanish warning; FNC1 barcodes survive`, () => {
    const { result, original, converted } = cross(TSPL_UNSUPPORTED, 'tpcl', dpi);
    assert.deepEqual(original.items.map(i => i.symbology || i.kind), ['text', 'unknown', 'code128', 'code128']);
    assert.deepEqual(converted.items.map(i => i.symbology || i.kind), ['text', 'code128', 'code128']);
    const warnings = levels(result.diagnostics, 'warning');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].text, /unknown/);
    assert.match(warnings[0].text, /sin equivalente en TPCL/);
    assert.deepEqual(converted.items.slice(1).map(i => i.data), ['01' + FNC1 + '23', FNC1 + '0112345678901231']);
    assert.deepEqual(levels(converted.diagnostics, 'error', 'warning'), []);
  });
}

test('TPCL -> TSPL: an image survives as a BITMAP (width not multiple of 8 gains white padding columns), an overlay-only image warns', () => {
  const sizeOf = { width: 990, height: 550, pitch: 610, gap: null, native: {} };
  const bitmap = bitmapOf(16, 6, (x, y) => (x + 2 * y) % 5 === 0);
  const odd = bitmapOf(10, 3, (x, y) => (x * 3 + y) % 4 === 0);
  const items = [
    { kind: 'image', x: 40, y: 30, width: 0, height: 0, bitmap, data: null },
    { kind: 'image', x: 40, y: 130, width: 0, height: 0, bitmap: odd, data: null },
  ];
  const tpclText = PB.languages.emit('tpcl', { language: 'tpcl', size: sizeOf, items, diagnostics: [] }, { dpi: 203 }).text;
  const { result, original, converted } = cross(tpclText, 'tspl', 203);
  assert.deepEqual(levels(result.diagnostics, 'warning'), []);
  assert.deepEqual(levels(converted.diagnostics, 'error', 'warning'), []);
  assert.deepEqual(converted.items.map(i => i.kind), ['image', 'image']);
  assertSameLabel(original, converted, 203);
  assert.deepEqual(Array.from(converted.items[0].bitmap.data), Array.from(bitmap.data));
  assert.equal(converted.items[1].bitmap.w, 16);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 16; x++) assert.equal(converted.items[1].bitmap.data[y * 16 + x], x < 10 ? odd.data[y * 10 + x] : 0, `pixel ${x},${y}`);
  }
  // and back: TSPL -> TPCL keeps the 16-wide bitmap
  const back = cross(result.text, 'tpcl', 203);
  assert.deepEqual(Array.from(back.converted.items[0].bitmap.data), Array.from(bitmap.data));
  // an image without a bitmap cannot be written in either language
  const overlay = { language: 'tpcl', size: sizeOf, items: [{ kind: 'image', x: 40, y: 30, width: 100, height: 100, bitmap: null, data: null }], diagnostics: [] };
  for (const id of ['tpcl', 'tspl']) {
    const out = PB.languages.emit(id, overlay, { dpi: 203 });
    assert.equal(levels(out.diagnostics, 'warning').length, 1);
    assert.match(levels(out.diagnostics, 'warning')[0].text, /sin bitmap/);
  }
});

test('TPCL variables #NAME# are written literally in TSPL with one Spanish info, and read back as the same text', () => {
  const { result, converted } = cross(spool.source, 'tspl', 203);
  assert.equal(result.diagnostics.filter(d => /variables #NOMBRE#/.test(d.text)).length, 1);
  assert.ok(converted.items.some(i => i.data === '#ROLLNUM# / #TOTALROLLS#'));
});

test('TSPL text with a quote and a line break is made safe for TPCL', () => {
  const source = ['SIZE 100 mm,60 mm', 'DIRECTION 1', 'CLS', 'TEXT 40,30,"3",0,1,1,"say \\["]hi\\["] {x}|"', 'PRINT 1,1'].join('\r\n');
  const { result, converted } = cross(source, 'tpcl', 203);
  assert.equal(converted.items[0].data, 'say "hi"  x  ');
  assert.equal(levels(result.diagnostics, 'warning').length, 1);
  assert.match(levels(result.diagnostics, 'warning')[0].text, /\{ \} \|/);
});

test('coordinates beyond the TPCL 4 digits are clamped with one Spanish warning (TSPL -> TPCL)', () => {
  const source = ['SIZE 100 mm,60 mm', 'DIRECTION 1', 'CLS', 'TEXT 20000,30,"3",0,1,1,"far"', 'PRINT 1,1'].join('\r\n');
  const { result, converted } = cross(source, 'tpcl', 203);
  assert.equal(converted.items[0].x, 9999);
  assert.ok(levels(result.diagnostics, 'warning').some(d => /fuera de 0\.\.9999/.test(d.text)));
});

// --- Double conversions ---

/**
 * Same TSPL text, except that the y of a TEXT line may differ by one dot: it is the top of the cell, the baseline minus the ascent of a font
 * whose size went through the TPCL rounding.
 */
function assertSameTspl(actual, expected, label) {
  const [a, b] = [actual.split('\r\n'), expected.split('\r\n')];
  assert.equal(a.length, b.length, label);
  const textLine = /^(TEXT \d+,)(\d+)(,.*)$/;
  a.forEach((line, i) => {
    const [m, n] = [textLine.exec(line), textLine.exec(b[i])];
    if (m && n) {
      assert.equal(m[1] + m[3], n[1] + n[3], `${label} line ${i}`);
      assert.ok(Math.abs(Number(m[2]) - Number(n[2])) <= 1, `${label} line ${i}: y ${m[2]} vs ${n[2]}`);
    } else assert.equal(line, b[i], `${label} line ${i}`);
  });
}

/** One cross conversion step on a text: { text, diagnostics, model } with the model parsed from the output. */
function step(text, targetId, dpi) {
  const r = PB.convert.run(text, targetId, { dpi });
  return { ...r, model: parserOf(targetId).parse(r.text, { dpi }) };
}

for (const dpi of [203, 300]) {
  test(`TPCL -> TSPL -> TPCL -> TSPL at ${dpi} dpi is stable: the second TSPL output equals the first and loses nothing more`, () => {
    for (const example of [spool, barcodes]) {
      const first = step(example.source, 'tspl', dpi);
      const second = step(first.text, 'tpcl', dpi);
      const third = step(second.text, 'tspl', dpi);
      assertSameTspl(third.text, first.text, example.id);
      assertSameLabel(first.model, third.model, dpi);
      assert.deepEqual(levels(third.diagnostics, 'warning', 'error'), []);
      // after the first conversion the fonts are already TSPL ones: the font and size infos do not come back
      assert.deepEqual(brief(third.diagnostics).map(d => d[1].slice(0, 20)), brief(first.diagnostics).map(d => d[1].slice(0, 20))
        .filter(t => !/^Las fuentes TSPL|^Hay textos cuyo/.test(t)));
    }
  });

  test(`TSPL -> TPCL -> TSPL -> TPCL at ${dpi} dpi: geometry and data are stable after the first conversion, fonts settle at the second`, () => {
    const first = step(tsplExample.source, 'tpcl', dpi);
    const second = step(first.text, 'tspl', dpi);
    const third = step(second.text, 'tpcl', dpi);
    const fourth = step(third.text, 'tspl', dpi);
    // first -> third: same items (kinds, data, positions, sizes) even though the family/weight may still change once
    assertSameLabel(first.model, third.model, dpi);
    // from the second round on nothing changes, except the y of a TEXT by one dot: the valid PC magnifications (0.5 steps from 1) round the font size
    // more than the old tenths did, and the top of the cell is the baseline minus the ascent of that size
    assertSameTspl(fourth.text, second.text, `second round at ${dpi} dpi`);
    assert.deepEqual(levels(third.diagnostics, 'warning', 'error'), []);
    assert.deepEqual(levels(fourth.diagnostics, 'warning', 'error'), []);
  });
}

test('every cross conversion of the examples reports no error diagnostics and leaves nothing without an emitter', () => {
  for (const { example, to } of CASES) {
    const { result } = cross(example.source, to, 203);
    assert.ok(!result.diagnostics.some(d => /sin emisor/.test(d.text)), example.id);
    assert.equal(levels(result.diagnostics, 'error').length, 0);
  }
});

test('a TSPL BLOCK with a vector-only font (PV) goes to TPCL as one line with one warning', () => {
  const source = ['SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm', 'DIRECTION 1', 'CLS', 'BLOCK 40,30,300,100,"1",0,1,1,4,2,"first line\\[R]second line"', 'PRINT 1,1'].join('\r\n');
  const { result, converted } = cross(source, 'tpcl', 203);
  assert.equal(converted.items.length, 1);
  assert.equal(converted.items[0].block, undefined);
  assert.equal(converted.items[0].data, 'first line second line');
  assert.deepEqual(levels(result.diagnostics, 'warning').map(d => d.text), [levels(result.diagnostics, 'warning')[0].text]);
  assert.match(levels(result.diagnostics, 'warning')[0].text, /necesita una fuente de mapa de bits [(]PC[)]/);
});

test('a ZPL ^FB block goes to TSPL as BLOCK and back to ZPL as ^FB with the same parameters (both resolutions)', () => {
  for (const dpi of [203, 300]) {
    const source = '^XA\r\n^PW800\r\n^LL480\r\n^FO50,100^A0N,30,30^FB400,3,4,R^FDone\\&two three four five^FS\r\n^XZ\r\n';
    const toTspl = cross(source, 'tspl', dpi);
    const block = toTspl.converted.items[0].block;
    assert.equal(block.align, 'right');
    assert.equal(block.lines, 3);
    assert.equal(toTspl.converted.items[0].data, 'one\ntwo three four five');
    assert.deepEqual(levels(toTspl.result.diagnostics, 'warning', 'error'), levels(toTspl.result.diagnostics, 'warning', 'error').filter(d => !/BLOCK/.test(d.text)));
    const back = cross(toTspl.result.text, 'zpl', dpi);
    assert.match(back.result.text, /\^FB400,3,4,R\^FDone\\&two three four five\^FS/, `${dpi} dpi`);
  }
});
