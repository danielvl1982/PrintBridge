const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tspl.js');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const tpclExamples = PB.examples.filter(e => e.language === 'tpcl');
const FNC1 = PB.barcodeData.FNC1;

const emit = (model, dpi = 203) => PB.languages.emit('tpcl', model, { dpi });
const lines = model => emit(model).text.split('\n');
const model = (items = [], size = {}) => ({
  language: 'tpcl',
  size: { width: 990, height: 550, pitch: 610, gap: null, native: { axRaw: 'AX;+010,+000,+00' }, ...size },
  items,
  diagnostics: [],
});
const barcode = (props = {}) => ({
  kind: 'barcode', x: 50, y: 60, symbology: 'code128', module: 2.5, rotation: 0, height: 80, humanReadable: true, data: 'ABC123', ...props,
});
const widths = (props = {}) => ({
  widths: { narrowBar: 2.5, narrowSpace: 2.5, wideBar: 7.5, wideSpace: 7.5 }, interCharGap: 2.5, ...props,
});
const qr = (props = {}) => ({ kind: 'qr', x: 700, y: 160, ecc: 'H', cell: 5, symbology: 'qr', data: 'HELLO', ...props });
const bitmap = (w, h, fn) => ({ w, h, data: Uint8Array.from({ length: w * h }, (_, i) => (fn(i % w, Math.floor(i / w)) ? 1 : 0)) });
const image = (props = {}) => {
  const bm = bitmap(10, 3, (x, y) => (x + y) % 3 === 0);
  return { kind: 'image', x: 120, y: 200, width: 13, height: 4, bitmap: bm, data: null, ...props };
};
const body = model_ => lines(model_).slice(3, -1);
const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));
const parseBack = model_ => tpcl.parse(emit(model_).text);

/** Neutral items without identity/origin fields (source, raw, native, ref); a missing text data counts as ''. */
const neutral = parsed => parsed.items.map(({ source, raw, native, ref, ...rest }) => ({
  ...rest, ...('data' in rest && rest.kind === 'text' && { data: rest.data ?? '' }),
}));

test('the barcode, qr and image slices expose a tpcl emitter through composeSlices', () => {
  const composed = PB.composeSlices('tpcl', new Proxy({}, { get: () => () => '' }));
  for (const kind of ['barcode', 'qr', 'image']) assert.equal(typeof composed.emitters[kind], 'function', kind);
});

// --- Barcode: generic 1D form (Code 128) ---

test('code128 uses the generic XB form with type 9, module in dots, rotation digit, height and human readable flag', () => {
  assert.deepEqual(body(model([barcode()])), ['{XB00;0050,0060,9,1,02,0,0080,0,000,1,00|}', '{RB00;ABC123|}']);
});

test('module and height conversion follows the resolution (module in dots, height in 0.1 mm)', () => {
  assert.equal(body(model([barcode({ module: 3.8, height: 123 })]))[0], '{XB00;0050,0060,9,1,03,0,0123,0,000,1,00|}');
  assert.equal(emit(model([barcode({ module: 3.8, height: 123 })]), 300).text.split('\n')[3], '{XB00;0050,0060,9,1,04,0,0123,0,000,1,00|}');
});

test('the module is at least 1 dot and at most 15 in the generic form (with a warning once)', () => {
  assert.equal(body(model([barcode({ module: 0.1 })]))[0].split(',')[4], '01');
  const out = emit(model([barcode({ module: 500 }), barcode({ module: 900 })]));
  assert.ok(out.text.includes('XB00;0050,0060,9,1,15,'));
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

test('rotations map to the digits 0..3 and the human readable flag to 1/0', () => {
  const digits = [0, 90, 180, 270].map(rotation => body(model([barcode({ rotation })]))[0].split(',')[5]);
  assert.deepEqual(digits, ['0', '1', '2', '3']);
  assert.equal(body(model([barcode({ humanReadable: false })]))[0].split(',')[9], '0');
});

test('a rotation that is not a multiple of 90 goes to the nearest turn with one warning', () => {
  const out = emit(model([barcode({ rotation: 80 }), barcode({ rotation: 100 })]));
  assert.equal(out.text.split('\n')[3].split(',')[5], '1');
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

test('the height is clamped to 1..1000', () => {
  assert.equal(body(model([barcode({ height: 0 })]))[0].split(',')[6], '0001');
  assert.equal(body(model([barcode({ height: 123456 })]))[0].split(',')[6], '1000');
});

// --- Barcode: wide/narrow form (Code 39, ITF) ---

test('code39 without check writes the widths form with type 3 and check option 1', () => {
  const out = body(model([barcode({ symbology: 'code39', ...widths(), check: 'none' })]));
  assert.deepEqual(out, ['{XB00;0050,0060,3,1,02,02,06,06,02,0,0080,1|}', '{RB00;ABC123|}']);
});

test('code39 mod43 uses check option 3', () => {
  assert.equal(body(model([barcode({ symbology: 'code39', ...widths(), check: 'mod43' })]))[0], '{XB00;0050,0060,3,3,02,02,06,06,02,0,0080,1|}');
});

test('itf writes type 2 with check option 1 and no inter-character gap', () => {
  const widthsItf = widths({ interCharGap: 0, widths: { narrowBar: 2.5, narrowSpace: 2.5, wideBar: 6.25, wideSpace: 6.25 } });
  assert.equal(body(model([barcode({ symbology: 'itf', ...widthsItf, check: 'none' })]))[0], '{XB00;0050,0060,2,1,02,02,05,05,00,0,0080,1|}');
});

test('a missing check counts as none', () => {
  assert.equal(body(model([barcode({ symbology: 'code39', ...widths() })]))[0].split(',')[3], '1');
});

test('widths are converted back to dots per resolution (203 and 300 dpi)', () => {
  const item = barcode({ symbology: 'code39', ...widths({ widths: { narrowBar: 3.4, narrowSpace: 3.4, wideBar: 10.2, wideSpace: 10.2 }, interCharGap: 3.4 }) });
  assert.equal(body(model([item]))[0], '{XB00;0050,0060,3,1,03,03,08,08,03,0,0080,1|}');
  assert.equal(emit(model([item]), 300).text.split('\n')[3], '{XB00;0050,0060,3,1,04,04,12,12,04,0,0080,1|}');
});

test('code39/itf without explicit widths write the 3:1 ratio from the module, with an info', () => {
  const out = emit(model([barcode({ symbology: 'code39', module: 2.5 })]));
  assert.equal(out.text.split('\n')[3], '{XB00;0050,0060,3,1,02,02,06,06,02,0,0080,1|}');
  assert.ok(out.diagnostics.some(d => d.level === 'info' && /3:1/.test(d.text)));
  assert.equal(emit(model([barcode({ symbology: 'itf', module: 2.5 })])).text.split('\n')[3], '{XB00;0050,0060,2,1,02,02,06,06,00,0,0080,1|}');
});

test('a check option the TPCL form cannot express is written without check digit with a warning', () => {
  const out = emit(model([barcode({ symbology: 'itf', data: '123456', ...widths({ interCharGap: 0 }), check: 'unsupported' })]));
  assert.equal(out.text.split('\n')[3].split(',')[3], '1');
  assert.ok(levels(out.diagnostics, 'warning').some(d => /itf/i.test(d.text) && /control/.test(d.text)));
  const itfMod = emit(model([barcode({ symbology: 'itf', data: '123456', ...widths({ interCharGap: 0 }), check: 'mod43' })]));
  assert.equal(itfMod.text.split('\n')[3].split(',')[3], '1');
  assert.equal(levels(itfMod.diagnostics, 'warning').length, 1);
});

// --- Barcode: data, FNC1, unsupported symbologies ---

test('FNC1 is written as the >8 notation the parser reads back', () => {
  const m = model([barcode({ data: `${FNC1}0112345${FNC1}17` })]);
  assert.equal(body(m)[1], '{RB00;>80112345>817|}');
  assert.equal(tpcl.parse(emit(m).text).items[0].data, `${FNC1}0112345${FNC1}17`);
});

test('a literal >8 in the data warns because the parser would read it as FNC1', () => {
  const out = emit(model([barcode({ data: 'A>8B' })]));
  assert.ok(levels(out.diagnostics, 'warning').some(d => />8/.test(d.text) && /FNC1/.test(d.text)));
});

test('#NAME# placeholders pass through and framing characters become spaces with one warning', () => {
  assert.equal(body(model([barcode({ data: '#CODE128#' })]))[1], '{RB00;#CODE128#|}');
  const out = emit(model([barcode({ data: 'a|b{c}d' }), qr({ data: 'x}y' })]));
  assert.ok(out.text.includes('{RB00;a b c d|}'));
  assert.ok(out.text.includes('{RB01;x y|}'));
  const warnings = levels(out.diagnostics, 'warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /\{.*\|/);
});

test('barcode without data still gets an empty RB', () => {
  assert.deepEqual(body(model([barcode({ data: null })])), ['{XB00;0050,0060,9,1,02,0,0080,0,000,1,00|}', '{RB00;|}']);
});

test('symbologies TPCL cannot express are skipped with a Spanish warning naming them', () => {
  for (const symbology of ['unknown', 'qr']) {
    const out = emit(model([barcode({ symbology }), barcode()]));
    assert.equal(out.text.split('\n').filter(l => /^\{XB/.test(l)).length, 1, symbology);
    assert.ok(levels(out.diagnostics, 'warning').some(d => d.text.includes(symbology)), symbology);
  }
});

test('the native.type of a barcode from TSPL is ignored: only neutral fields count', () => {
  const m = model([barcode({ native: { type: 'EAN128', module: 9 } })]);
  assert.equal(body(m)[0], '{XB00;0050,0060,9,1,02,0,0080,0,000,1,00|}');
});

test('TSPL barcodes emit as TPCL from their neutral fields', () => {
  const src = 'SIZE 100 mm,60 mm\nBARCODE 40,60,"39C",80,1,0,2,6,"ABC"\nBARCODE 40,200,"128",80,1,0,2,2,"XYZ"\nPRINT 1,1\n';
  const parsed = tspl.parse(src, { dpi: 203 });
  const out = emit({ ...parsed, language: 'tspl' });
  assert.deepEqual(levels(out.diagnostics, 'warning', 'error'), []);
  const back = tpcl.parse(out.text);
  assert.deepEqual(back.items.map(i => [i.symbology, i.check, i.data]), [['code39', 'mod43', 'ABC'], ['code128', undefined, 'XYZ']]);
});

test('coordinates of barcodes are clamped to 0..9999 with a single warning', () => {
  const out = emit(model([barcode({ x: 12000, y: -5 }), qr({ x: 20000 })]));
  assert.ok(out.text.includes('{XB00;9999,0000,9'));
  assert.ok(out.text.includes('{XB01;9999,0160,T'));
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

// --- QR ---

test('qr writes XB type T with ecc, 2-digit cell dots and the fixed tail', () => {
  assert.deepEqual(body(model([qr()])), ['{XB00;0700,0160,T,H,04,A,0,M2|}', '{RB00;HELLO|}']);
});

test('every ecc level is written as its letter', () => {
  const letters = ['L', 'M', 'Q', 'H'].map(ecc => body(model([qr({ ecc })]))[0].split(',')[3]);
  assert.deepEqual(letters, ['L', 'M', 'Q', 'H']);
});

test('an unknown ecc is written as M with a warning', () => {
  const out = emit(model([qr({ ecc: 'X' })]));
  assert.equal(out.text.split('\n')[3].split(',')[3], 'M');
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

test('the qr cell converts 0.1 mm to dots (203 and 300 dpi) and is clamped to 1..52 with a warning', () => {
  assert.equal(body(model([qr({ cell: 5.0049 })]))[0].split(',')[4], '04');
  assert.equal(emit(model([qr({ cell: 5 })]), 300).text.split('\n')[3].split(',')[4], '06');
  const small = emit(model([qr({ cell: 0.1 })]));
  assert.equal(small.text.split('\n')[3].split(',')[4], '01');
  assert.equal(levels(small.diagnostics, 'warning').length, 1);
  const big = emit(model([qr({ cell: 5000 }), qr({ cell: 6000 })]));
  assert.equal(big.text.split('\n')[3].split(',')[4], '52');
  assert.equal(levels(big.diagnostics, 'warning').length, 1);
});

test('qr and barcode ids share the XB namespace and match their RB data command', () => {
  const out = body(model([barcode(), qr(), barcode({ symbology: 'itf', ...widths() })]));
  assert.deepEqual(out.map(l => l.match(/^\{([A-Z]{2}\d\d);/)[1]), ['XB00', 'RB00', 'XB01', 'RB01', 'XB02', 'RB02']);
});

// --- Image ---

test('an image becomes SG with the position in 0.1 mm, the size in dots and the nibble data', () => {
  const item = image();
  const expected = PB.images.bitmapToNibble(item.bitmap.data, 10, 3);
  assert.deepEqual(body(model([item])), [`{SG;0120,0200,0010,0003,0,${expected}|}`]);
});

test('SG data parses back to the identical bitmap (rows are padded to 8 dots in the data only)', () => {
  // Width 10 is stored in 2 bytes per row (16 dots): the padding dots are white and are dropped when parsing back.
  const item = image();
  const parsed = parseBack(model([item]));
  assert.deepEqual(levels(parsed.diagnostics, 'error', 'warning'), []);
  const [back] = parsed.items;
  assert.equal(back.bitmap.w, 10);
  assert.equal(back.bitmap.h, 3);
  assert.deepEqual(back.bitmap.data, item.bitmap.data);
  assert.equal(((10 + 7) >> 3) * 3 * 2, PB.images.bitmapToNibble(item.bitmap.data, 10, 3).length);
});

test('widths that are multiples of 8 and 1-dot images round trip too', () => {
  for (const [w, h] of [[8, 2], [16, 1], [1, 1], [9, 5]]) {
    const bm = bitmap(w, h, (x, y) => (x * 7 + y * 3) % 2 === 0);
    const [back] = parseBack(model([image({ bitmap: bm })])).items;
    assert.deepEqual([back.bitmap.w, back.bitmap.h], [w, h]);
    assert.deepEqual(back.bitmap.data, bm.data);
  }
});

test('image coordinates are clamped', () => {
  const out = emit(model([image({ x: 20000, y: -3 })]));
  assert.ok(out.text.includes('{SG;9999,0000,0010,0003,0,'));
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

test('an overlay image without bitmap is skipped with a Spanish warning', () => {
  const out = emit(model([image({ bitmap: undefined, href: 'data:image/png;base64,AA==' }), barcode()]));
  assert.ok(!out.text.includes('{SG'));
  assert.ok(out.text.includes('{XB00;'));
  assert.ok(levels(out.diagnostics, 'warning').some(d => /imágenes/.test(d.text) && /bitmap|vista previa/.test(d.text)));
});

test('a bitmap whose data length does not match its size, or that is too large, is skipped with a warning', () => {
  const bad = image({ bitmap: { w: 10, h: 3, data: new Uint8Array(5) } });
  const huge = image({ bitmap: { w: 10000, h: 1, data: new Uint8Array(10000) } });
  for (const item of [bad, huge]) {
    const out = emit(model([item]));
    assert.ok(!out.text.includes('{SG'));
    assert.equal(levels(out.diagnostics, 'warning').length, 1);
  }
});

test('buildSG keeps its output for existing callers', () => {
  assert.equal(PB.images.buildSG({ xMm: '12', yMm: 20, w: 10, h: 3, data: 'abc' }), '{SG;0120,0200,0010,0003,0,abc|}');
});

// --- Re-parse without diagnostics ---

test('emitted barcode, qr and image re-parse without errors or warnings', () => {
  const m = model([
    barcode(), barcode({ rotation: 90, humanReadable: false }), barcode({ symbology: 'code39', ...widths(), check: 'mod43' }),
    barcode({ symbology: 'itf', data: '123456', ...widths({ interCharGap: 0 }) }), qr(), qr({ ecc: 'L', cell: 7.5 }), image(),
  ]);
  const parsed = parseBack(m);
  assert.deepEqual(levels(parsed.diagnostics, 'error', 'warning'), []);
  assert.deepEqual(parsed.items.map(i => i.kind), ['barcode', 'barcode', 'barcode', 'barcode', 'qr', 'qr', 'image']);
  assert.deepEqual(levels(emit(m).diagnostics, 'error', 'warning'), []);
});

test('the neutral fields survive parse -> emit -> parse for every symbology/check combination', () => {
  const items = [
    barcode(), barcode({ rotation: 270, humanReadable: false, height: 120 }),
    barcode({ symbology: 'code39', ...widths(), check: 'none' }), barcode({ symbology: 'code39', ...widths(), check: 'mod43', rotation: 180 }),
    barcode({ symbology: 'itf', ...widths({ interCharGap: 0 }), check: 'none' }),
    qr({ ecc: 'L' }), qr({ ecc: 'M', cell: 7.5 }), qr({ ecc: 'Q' }), image(),
  ];
  const first = parseBack(model(items));
  const second = tpcl.parse(emit(first).text);
  assert.deepEqual(neutral(second), neutral(first));
  assert.equal(first.items.length, items.length);
});

// --- Full TPCL -> TPCL round trip on the examples ---
// No tolerance is needed at the same resolution: every measure is an integer number of dots (or of 0.1 mm) in TPCL,
// the neutral value is dots * dotSize and the emitter divides by the same dotSize and rounds. Cross-resolution and
// cross-language rounding belongs to T6.

test('there are TPCL examples to round trip', () => {
  assert.ok(tpclExamples.length >= 2);
});

for (const example of tpclExamples) {
  for (const dpi of [203, 300]) {
    test(`round trip on the "${example.id}" example at ${dpi} dpi keeps ALL neutral items`, () => {
      const first = tpcl.parse(example.source, { dpi });
      const out = emit(first, dpi);
      const second = tpcl.parse(out.text, { dpi });
      assert.deepEqual(levels(second.diagnostics, 'error', 'warning'), []);
      if (example.group !== 'blank') assert.ok(first.items.length > 0); // a blank template has the header only
      assert.deepEqual(neutral(second), neutral(first));
      assert.deepEqual([second.size.width, second.size.height, second.size.pitch], [first.size.width, first.size.height, first.size.pitch]);
      // Only the known info diagnostics: the default {XS} (and the AX note when the size is outside the catalog)
      assert.deepEqual(levels(out.diagnostics, 'error', 'warning'), []);
      assert.ok(out.diagnostics.every(d => d.level === 'info' && /\{XS\}|AX/.test(d.text)), JSON.stringify(out.diagnostics));
      assert.ok(out.diagnostics.some(d => /\{XS\}/.test(d.text)));
      assert.equal(out.diagnostics.filter(d => /sin emisor/.test(d.text)).length, 0);
    });
  }
}

test('the spool example keeps its QR and the barcodes example its three barcodes', () => {
  const kinds = id => tpcl.parse(tpclExamples.find(e => e.id === id).source).items.map(i => i.kind);
  assert.ok(kinds('spool-99x55').includes('qr'));
  assert.equal(kinds('barcodes-code39-itf-code128').filter(k => k === 'barcode').length, 3);
});
