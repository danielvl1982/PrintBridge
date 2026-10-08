const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tspl.js');
const tspl = PB.languages.get('tspl');
const example = PB.examples.find(e => e.id === 'tspl-label-100x60');
const FNC1 = PB.barcodeData.FNC1;

const dotOf = dpi => 254 / dpi;
const emit = (model, dpi = 203) => PB.languages.emit('tspl', model, { dpi });
const model = (items = [], size = {}) => ({
  language: 'tspl',
  size: { width: 1000, height: 600, pitch: null, gap: null, native: {}, ...size },
  items,
  diagnostics: [],
});
// Body lines of an emitted label (header and PRINT removed). Not for BITMAP: its payload may contain CR/LF.
const body = (items, dpi) => emit(model(items), dpi).text.split('\r\n')
  .filter(l => !/^(SIZE|GAP|DIRECTION|CLS|PRINT)\b/.test(l) && l !== '');
const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));

const barcode = (props = {}) => ({
  kind: 'barcode', x: 40 * dotOf(203), y: 230 * dotOf(203), symbology: 'code128', module: 2 * dotOf(203), rotation: 0,
  height: 100 * dotOf(203), humanReadable: true, data: '100001200001', ...props,
});
const wideWidths = (narrow, wide, dpi = 203) => ({
  widths: { narrowBar: narrow * dotOf(dpi), narrowSpace: narrow * dotOf(dpi), wideBar: wide * dotOf(dpi), wideSpace: wide * dotOf(dpi) },
  interCharGap: narrow * dotOf(dpi),
});
const qr = (props = {}) => ({
  kind: 'qr', x: 560 * dotOf(203), y: 240 * dotOf(203), ecc: 'L', cell: 6 * dotOf(203), symbology: 'qr', data: 'https://example.com/1', ...props,
});
const bitmapOf = (w, h, fn) => ({ w, h, data: Uint8Array.from({ length: w * h }, (_, i) => (fn(i % w, Math.floor(i / w)) ? 1 : 0)) });
const image = (props = {}) => ({
  kind: 'image', x: 40 * dotOf(203), y: 30 * dotOf(203), width: 0, height: 0, bitmap: bitmapOf(10, 2, (x, y) => y === 0 && (x === 0 || x === 9)), data: null, ...props,
});
const payloadChars = bytes => String.fromCharCode(...bytes);

test('the barcode, qr and image slices expose a tspl emitter through composeSlices', () => {
  const composed = PB.composeSlices('tspl', new Proxy({}, { get: () => () => '' }));
  for (const kind of ['barcode', 'qr', 'image']) assert.equal(typeof composed.emitters[kind], 'function', kind);
});

// --- Barcode ---

test('code128 becomes "128" with height, human readable, rotation, narrow and wide (1:1)', () => {
  assert.deepEqual(body([barcode()]), ['BARCODE 40,230,"128",100,1,0,2,2,"100001200001"']);
});

test('a leading FNC1 only becomes EAN128 with the FNC1 removed from the data', () => {
  assert.deepEqual(body([barcode({ data: FNC1 + '0112345678901231' })]), ['BARCODE 40,230,"EAN128",100,1,0,2,2,"0112345678901231"']);
});

test('FNC1 elsewhere becomes 128M with !102 at those positions (also with a leading one)', () => {
  assert.equal(body([barcode({ data: '01' + FNC1 + '23' })])[0], 'BARCODE 40,230,"128M",100,1,0,2,2,"01!10223"');
  assert.equal(body([barcode({ data: FNC1 + '01' + FNC1 + '23' })])[0], 'BARCODE 40,230,"128M",100,1,0,2,2,"!10201!10223"');
});

test('EAN128 and 128M are read back as the same neutral data', () => {
  for (const data of [FNC1 + '0112', '01' + FNC1 + '23', FNC1 + '01' + FNC1 + '23', 'PLAIN']) {
    const parsed = tspl.parse(emit(model([barcode({ data })])).text);
    assert.deepEqual(levels(parsed.diagnostics, 'error', 'warning'), []);
    assert.equal(parsed.items[0].data, data);
  }
});

test('code39 becomes "39", or "39C" with a mod43 check digit', () => {
  const ratio = wideWidths(2, 6);
  assert.equal(body([barcode({ symbology: 'code39', ...ratio, check: 'none', data: 'ABC' })])[0], 'BARCODE 40,230,"39",100,1,0,2,6,"ABC"');
  assert.equal(body([barcode({ symbology: 'code39', ...ratio, check: 'mod43', data: 'ABC' })])[0], 'BARCODE 40,230,"39C",100,1,0,2,6,"ABC"');
  assert.equal(body([barcode({ symbology: 'code39', ...ratio, data: 'ABC' })])[0], 'BARCODE 40,230,"39",100,1,0,2,6,"ABC"');
});

test('itf becomes "25"; a check digit it cannot represent warns once in Spanish', () => {
  const ratio = wideWidths(2, 6);
  const plain = emit(model([barcode({ symbology: 'itf', ...ratio, check: 'none', data: '1234' })]));
  assert.ok(plain.text.includes('BARCODE 40,230,"25",100,1,0,2,6,"1234"'));
  assert.deepEqual(levels(plain.diagnostics, 'warning'), []);
  const checked = emit(model([
    barcode({ symbology: 'itf', ...ratio, check: 'unsupported', data: '1234' }),
    barcode({ symbology: 'itf', ...ratio, check: 'mod10', data: '5678' }),
  ]));
  assert.ok(checked.text.includes('"25"') && !checked.text.includes('25C'));
  const warnings = levels(checked.diagnostics, 'warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /dígito de control/);
});

test('ean13 becomes "EAN13"; data that cannot be encoded warns once (the encoder names the symbology)', () => {
  assert.equal(body([barcode({ symbology: 'ean13', data: '123456789012' })])[0], 'BARCODE 40,230,"EAN13",100,1,0,2,2,"123456789012"');
  assert.deepEqual(levels(emit(model([barcode({ symbology: 'ean13', data: '1234567890123' })])).diagnostics, 'warning'), []);
  const out = emit(model([barcode({ symbology: 'ean13', data: '12345' }), barcode({ symbology: 'ean13', data: 'ABCDEFGHIJKL' })]));
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
  assert.match(levels(out.diagnostics, 'warning')[0].text, /EAN-13/);
});

test('unknown / qr symbologies are skipped with a Spanish warning that names them', () => {
  const out = emit(model([barcode({ symbology: 'unknown' }), barcode({ symbology: 'qr' }), barcode()]));
  assert.equal(out.text.split('\r\n').filter(l => l.startsWith('BARCODE')).length, 1);
  const warnings = levels(out.diagnostics, 'warning');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0].text, /unknown/);
  assert.match(warnings[1].text, /qr/);
  assert.match(warnings[0].text, /TSPL/);
});

test('the module becomes narrow dots (minimum 1) at 203 and 300 dpi', () => {
  assert.equal(body([barcode({ module: 3 * dotOf(203) })])[0].split(',').slice(6, 8).join(','), '3,3');
  assert.equal(body([barcode({ module: 0.1 })])[0].split(',').slice(6, 8).join(','), '1,1');
  const at300 = barcode({ x: 40 * dotOf(300), y: 230 * dotOf(300), module: 4 * dotOf(300), height: 150 * dotOf(300) });
  assert.equal(body([at300], 300)[0], 'BARCODE 40,230,"128",150,1,0,4,4,"100001200001"');
});

test('the height becomes dots (minimum 1)', () => {
  assert.equal(body([barcode({ height: 80 * dotOf(203) })])[0].split(',')[3], '80');
  assert.equal(body([barcode({ height: 0.01 })])[0].split(',')[3], '1');
});

test('wide bars: 1:2, 1:3 and 2:5 are kept, other ratios go to the nearest valid one', () => {
  const wide = (narrow, w) => body([barcode({ symbology: 'code39', module: narrow * dotOf(203), ...wideWidths(narrow, w), data: 'A' })])[0].split(',').slice(6, 8).join(',');
  assert.equal(wide(2, 4), '2,4');
  assert.equal(wide(2, 6), '2,6');
  assert.equal(wide(4, 10), '4,10');
  assert.equal(wide(2, 7), '2,6');
  assert.equal(wide(2, 2), '2,4');
  assert.equal(wide(3, 7), '3,8');
  const itfWide = body([barcode({ symbology: 'itf', ...wideWidths(2, 5), data: '12' })])[0].split(',').slice(6, 8).join(',');
  assert.equal(itfWide, '2,5');
});

test('code39 / itf without explicit widths use the 3:1 ratio of the module', () => {
  assert.equal(body([barcode({ symbology: 'code39', data: 'A' })])[0].split(',').slice(6, 8).join(','), '2,6');
  assert.equal(body([barcode({ symbology: 'itf', data: '12' })])[0].split(',').slice(6, 8).join(','), '2,6');
});

test('human readable 1 (left) when set, 0 otherwise', () => {
  assert.equal(body([barcode({ humanReadable: true })])[0].split(',')[4], '1');
  assert.equal(body([barcode({ humanReadable: false })])[0].split(',')[4], '0');
});

test('rotations 0/90/180/270 are written as they are; others go to the nearest turn with one warning', () => {
  assert.deepEqual([0, 90, 180, 270].map(rotation => body([barcode({ rotation })])[0].split(',')[5]), ['0', '90', '180', '270']);
  const out = emit(model([barcode({ rotation: 80 }), barcode({ rotation: 100 })]));
  assert.deepEqual(out.text.split('\r\n').filter(l => l.startsWith('BARCODE')).map(l => l.split(',')[5]), ['90', '90']);
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

test('barcode data: quotes use the \\["] escape, line breaks become spaces with one warning, #VAR# is literal with one info', () => {
  assert.equal(body([barcode({ data: 'a"b' })])[0], 'BARCODE 40,230,"128",100,1,0,2,2,"a\\["]b"');
  const out = emit(model([barcode({ data: 'a\r\nb' }), barcode({ data: '#CODE#' }), barcode({ data: '#OTHER#' })]));
  assert.ok(out.text.includes('"a  b"'));
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
  assert.equal(out.diagnostics.filter(d => d.level === 'info' && /variables #NOMBRE#/.test(d.text)).length, 1);
});

test('the variables info is shared with the text emitter (one message in total)', () => {
  const text = { kind: 'text', x: 10, y: 10, rotation: 0, data: '#A#', font: { size: 32 * dotOf(203), scaleX: 1, family: 'sans', weight: 400, style: 'normal' } };
  const out = emit(model([text, barcode({ data: '#B#' }), qr({ data: '#C#' })]));
  assert.equal(out.diagnostics.filter(d => /variables #NOMBRE#/.test(d.text)).length, 1);
});

// --- QR ---

test('qr becomes QRCODE with ecc, cell dots, mode A and rotation 0', () => {
  assert.deepEqual(body([qr()]), ['QRCODE 560,240,L,6,A,0,"https://example.com/1"']);
  for (const ecc of ['L', 'M', 'Q', 'H']) assert.equal(body([qr({ ecc })])[0].split(',')[2], ecc);
});

test('an unknown ecc level is written as M with a Spanish warning', () => {
  const out = emit(model([qr({ ecc: 'X' }), qr({ ecc: undefined })]));
  assert.deepEqual(out.text.split('\r\n').filter(l => l.startsWith('QRCODE')).map(l => l.split(',')[2]), ['M', 'M']);
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
  assert.match(levels(out.diagnostics, 'warning')[0].text, /corrección de errores/);
});

test('the cell is round(cell / dot), clamped 1..10 with one warning', () => {
  assert.equal(body([qr({ cell: 4 * dotOf(300) })], 300)[0].split(',')[3], '4');
  assert.equal(body([qr({ cell: 0.1 })])[0].split(',')[3], '1');
  const clamped = emit(model([qr({ cell: 40 * dotOf(203) }), qr({ cell: 50 * dotOf(203) })]));
  assert.deepEqual(clamped.text.split('\r\n').filter(l => l.startsWith('QRCODE')).map(l => l.split(',')[3]), ['10', '10']);
  assert.equal(levels(clamped.diagnostics, 'warning').length, 1);
  assert.match(levels(clamped.diagnostics, 'warning')[0].text, /celda/);
  assert.deepEqual(levels(emit(model([qr({ cell: 10 * dotOf(203) })])).diagnostics, 'warning'), []);
});

test('qr data: quotes escaped, line breaks become spaces with a warning', () => {
  assert.equal(body([qr({ data: 'say "hi"' })])[0], 'QRCODE 560,240,L,6,A,0,"say \\["]hi\\["]"');
  const out = emit(model([qr({ data: 'a\nb' })]));
  assert.ok(out.text.includes('"a b"'));
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

// --- Image ---

test('BITMAP encoder: inverted bits, MSB first, padding bits white, exact bytes', () => {
  const bytes = PB.slices.image.tspl.encodeBitmap(image().bitmap);
  // Row 0: black at x = 0 and 9 -> 0111 1111 | 10 + 111111 padding = 0x7F 0xBF; row 1 is all white: 0xFF 0xFF
  assert.deepEqual(Array.from(bytes), [0x7F, 0xBF, 0xFF, 0xFF]);
  assert.equal(PB.slices.image.tspl.widthBytes(10), 2);
  assert.equal(PB.slices.image.tspl.widthBytes(16), 2);
  assert.equal(PB.slices.image.tspl.widthBytes(17), 3);
});

test('image becomes BITMAP x,y,widthBytes,height,0, the payload (chars 0..255) and CRLF', () => {
  const out = emit(model([image()])).text;
  const header = 'BITMAP 40,30,2,2,0,';
  const at = out.indexOf(header);
  assert.ok(at >= 0);
  assert.equal(out.slice(at, at + header.length + 4 + 2), header + payloadChars([0x7F, 0xBF, 0xFF, 0xFF]) + '\r\n');
  assert.ok(out.endsWith('PRINT 1,1\r\n'));
});

test('image coordinates become dots at the resolution', () => {
  const out = emit(model([image({ x: 600, y: 75 })]), 300).text;
  assert.ok(out.includes('BITMAP 709,89,2,2,0,'));
});

test('parse(emit()) gives the same bitmap; a width that is not a multiple of 8 re-parses padded with white columns', () => {
  const bm = bitmapOf(10, 3, (x, y) => (x * 3 + y) % 4 === 0);
  const parsed = tspl.parse(emit(model([image({ bitmap: bm })])).text);
  assert.deepEqual(levels(parsed.diagnostics, 'error', 'warning'), []);
  const back = parsed.items[0].bitmap;
  // Documented tolerance: the BITMAP width is widthBytes * 8, so 10 dots come back as 16 with white padding columns
  assert.equal(back.w, 16);
  assert.equal(back.h, 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 16; x++) {
      assert.equal(back.data[y * 16 + x], x < 10 ? bm.data[y * 10 + x] : 0, `pixel ${x},${y}`);
    }
  }
});

test('a width multiple of 8 round-trips identically', () => {
  const bm = bitmapOf(16, 4, (x, y) => (x + 2 * y) % 5 === 0);
  const back = tspl.parse(emit(model([image({ bitmap: bm })])).text).items[0].bitmap;
  assert.deepEqual({ w: back.w, h: back.h, data: Array.from(back.data) }, { w: 16, h: 4, data: Array.from(bm.data) });
});

test('payload bytes CR, LF, quote and comma survive parse(emit()), and the next command is read', () => {
  const bytes = [0x0D, 0x0A, 0x22, 0x2C];
  // Neutral bitmap whose TSPL bytes are exactly those: bit 0 = black
  const bm = bitmapOf(8, 4, (x, y) => ((bytes[y] >> (7 - x)) & 1) === 0);
  const text = { kind: 'text', x: 10, y: 10, rotation: 0, data: 'HOLA', font: { size: 32 * dotOf(203), scaleX: 1, family: 'sans', weight: 400, style: 'normal' } };
  const out = emit(model([image({ bitmap: bm }), text]));
  assert.ok(out.text.includes(payloadChars(bytes)));
  const parsed = tspl.parse(out.text);
  assert.deepEqual(levels(parsed.diagnostics, 'error', 'warning'), []);
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(Array.from(parsed.items[0].bitmap.data), Array.from(bm.data));
  assert.equal(parsed.items[1].data, 'HOLA');
});

test('an overlay image without a bitmap is skipped with a Spanish warning once; invalid bitmaps too', () => {
  const out = emit(model([image({ bitmap: undefined }), image({ bitmap: null }), image({ bitmap: { w: 4, h: 4, data: new Uint8Array(3) } })]));
  assert.ok(!/BITMAP/.test(out.text));
  assert.equal(levels(out.diagnostics, 'warning').length, 2);
  assert.match(levels(out.diagnostics, 'warning')[0].text, /vista previa/);
  assert.match(levels(out.diagnostics, 'warning')[1].text, /bitmap no válido/);
});

// --- Re-parse and round trip ---

test('every emitted barcode / qr / image command is read back without errors or warnings', () => {
  const m = model([
    barcode(), barcode({ data: FNC1 + '01' }), barcode({ data: '01' + FNC1 + '02' }),
    barcode({ symbology: 'code39', ...wideWidths(2, 6), check: 'mod43', data: 'A-1' }),
    barcode({ symbology: 'itf', ...wideWidths(3, 8), data: '1234' }),
    barcode({ symbology: 'ean13', data: '123456789012', rotation: 90 }),
    qr(), qr({ ecc: 'H', data: 'a "q", b' }), image(),
  ], { gap: 30 });
  const parsed = tspl.parse(emit(m).text);
  assert.deepEqual(levels(parsed.diagnostics, 'error', 'warning'), []);
  assert.equal(parsed.items.length, 9);
});

/** Deep comparison with a float tolerance (dots * dotSize noise); typed arrays compare as arrays. */
function assertClose(a, b, path = 'item') {
  if (typeof a === 'number' && typeof b === 'number') return assert.ok(Math.abs(a - b) < 1e-6, `${path}: ${a} vs ${b}`);
  if (a && typeof a === 'object') {
    assert.ok(b && typeof b === 'object', `${path}: missing`);
    const [ka, kb] = [Object.keys(a).sort(), Object.keys(b).sort()];
    assert.deepEqual(ka, kb, `${path}: keys`);
    return ka.forEach(k => assertClose(a[k], b[k], `${path}.${k}`));
  }
  return assert.equal(a, b, path);
}
const neutral = parsed => parsed.items.map(({ source, raw, native, ref, ...rest }) => ({
  ...rest, ...(rest.bitmap && { bitmap: { ...rest.bitmap, data: Array.from(rest.bitmap.data) } }),
}));

for (const dpi of [203, 300]) {
  test(`full round trip TSPL -> TSPL on the TSPL example at ${dpi} dpi keeps every item kind`, () => {
    const first = tspl.parse(example.source, { dpi });
    const out = PB.languages.emit('tspl', first, { dpi });
    const second = tspl.parse(out.text, { dpi });
    assert.deepEqual(levels(second.diagnostics, 'error', 'warning'), []);
    const [a, b] = [neutral(first), neutral(second)];
    // Boxes and bars are both the neutral 'line' kind (rect true / false)
    assert.deepEqual([...new Set(a.map(i => i.kind))].sort(), ['barcode', 'line', 'qr', 'text']);
    assert.ok(a.some(i => i.kind === 'line' && i.rect) && a.some(i => i.kind === 'line' && !i.rect));
    assert.equal(b.length, a.length);
    // Tolerance: only float noise (1e-6) of dots * dotSize; coordinates, sizes, symbology, ecc, data, flags are exact.
    a.forEach((item, i) => assertClose(item, b[i], `item ${i} (${item.kind})`));
    assert.equal(out.diagnostics.filter(d => /sin emisor/.test(d.text)).length, 0);
    assert.deepEqual(levels(out.diagnostics, 'warning'), []);
  });
}

test('code39 / itf / ean13 / image items survive parse(emit()) within their documented representation', () => {
  const items = [
    barcode({ symbology: 'code39', ...wideWidths(2, 6), check: 'mod43', data: 'AB-12' }),
    barcode({ symbology: 'itf', module: 3 * dotOf(203), ...wideWidths(3, 8), check: 'none', data: '1234' }),
    barcode({ symbology: 'ean13', data: '123456789012', rotation: 180, humanReadable: false }),
  ];
  const back = tspl.parse(emit(model(items)).text).items;
  assert.deepEqual(back.map(i => [i.symbology, i.check, i.data, i.rotation, i.humanReadable]), [
    ['code39', 'mod43', 'AB-12', 0, true], ['itf', 'none', '1234', 0, true], ['ean13', 'auto', '123456789012', 180, false],
  ]);
  assertClose(back[0].widths, items[0].widths, 'widths');
  // itf 3:8 is not a manual ratio: 8/3 = 2.67 is nearest to 2.5 (2:5), so the wide bar is round(3 * 2.5) = 8 (7.5 rounds up)
  assert.ok(Math.abs(back[1].widths.wideBar - 8 * dotOf(203)) < 1e-6);
});
