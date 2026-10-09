const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Z6: ZPL images, the graphic field ^GFa,b,c,d,data (js/components/image/zpl.js).
// What the 2003 guide (Volume One) documents: ^GFa,b,c,d,data with a = A (ASCII hexadecimal), B (binary), C (compressed binary), default A; b = bytes to be
// transmitted (1..99999, "for ASCII download, the parameter should match parameter c"; out-of-range values are set to the nearest limit); c = total bytes of the
// image; d = bytes per row (c / d = the rows); the ASCII data is two hex digits per byte, CR and LF may be inserted, "a comma in the data pads the current line
// with 00", data after the count is satisfied is ignored; the origin of an image is its bottom-left corner with ^FT. The guide's only example is
// ^FO100,100^GFA,8000,8000,80,ASCII data (no data to use as a vector); ~DG says that the first four dots white and the next four black are 0F (1 = black).
// NOT in the 2003 guide but in Volume Two (2005, printed page 52, "Alternative Data Compression Scheme for ~DG and ~DB"): the run-length COMPRESSION of the
// ASCII data: a repeat count before a hex digit (G..Y = 1..19, g..z = 20..400 in steps of 20, the counts add up: gG = 21), `,` fills the rest of the row
// with 0, `!` fills it with 1, `:` repeats the previous row; and (pages 110-112) the B64 / Z64 encodings `:id:data:crc`. The manual documents the scheme for
// ~DG and ~DB, not for ^GF (whose own text only has the comma), so what it does for ^GF is still not verified on a printer. All parses use 254 dpi, where one
// dot is exactly 0.1 mm.
const PB = loadApp();
const zpl = PB.languages.get('zpl');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const images = PB.images;
const slice = PB.slices.image.zpl;
const DPI = 254;

const BASE = body => `^XA^PW800^LL480${body}^XZ`;
const parse = (src, dpi = DPI) => zpl.parse(src, { dpi });
const one = src => parse(BASE(src)).items[0];
const diagnostics = src => parse(BASE(src)).diagnostics.map(d => `${d.level}: ${d.text}`);
const loud = list => list.filter(d => d.level === 'warning' || d.level === 'error');
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol + 1e-6, `${label}: ${a} vs ${b} (tolerance ${tol})`);
const emitResult = (items, dpi = DPI) => zpl.emit({ language: 'zpl', size: { width: 800, height: 480 }, items, diagnostics: [] }, { dpi });
const emitLines = (items, dpi = DPI) => emitResult(items, dpi).text.split('\r\n').filter(l => l && !/^\^(XA|XZ|PW|LL)/.test(l));
const emitDiag = (items, dpi = DPI) => emitResult(items, dpi).diagnostics.map(d => `${d.level}: ${d.text}`);

/** bitmap from rows of '0' / '1' (1 = black) */
const bits = rows => ({ w: rows[0].length, h: rows.length, data: Uint8Array.from(rows.join('').split('').map(Number)) });
const rowsOf = bm => Array.from({ length: bm.h }, (_, y) => Array.from(bm.data.slice(y * bm.w, (y + 1) * bm.w)).join(''));
/** the bitmap a string of hex digits describes at `d` bytes per row (1 = black, the leftmost dot is the highest bit), written independently of the code under test */
const fromHex = (hex, d) => {
  const rows = hex.length / (2 * d);
  return bits(Array.from({ length: rows }, (_, y) => hex.slice(y * 2 * d, (y + 1) * 2 * d).split('').map(c => parseInt(c, 16).toString(2).padStart(4, '0')).join('')));
};
const imageItem = (bitmap, extra = {}) => ({ kind: 'image', x: 0, y: 0, width: bitmap.w, height: bitmap.h, bitmap, data: null, ...extra });
/** a deterministic bitmap with blocks, empty rows and repeated rows (compresses well) */
const banner = (w, h) => bits(Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (y % 5 === 4 ? 0 : (x >> 3) % 3 === 1 || y === 0 ? 1 : 0)).join('')));

// ---------------------------------------------------------------------------------------------------------------
// Registration and hooks

test('the image slice registers a zpl factory after tpcl and tspl; ZPL takes the preview image (insertImage, imageCommand) and the palette shows Imagen last', () => {
  assert.deepEqual(Object.keys(PB.components.get('image').languages), ['tpcl', 'tspl', 'zpl']);
  assert.equal(zpl.insertImage, true);
  assert.equal(typeof zpl.imageCommand, 'function');
  const image = { kind: 'image', label: 'Imagen' };
  assert.deepEqual(PB.ui.paletteEntries(zpl, image).at(-1), image);
  // the image has no build hook: the language's own list of templates does not change
  assert.equal(zpl.componentTemplates().some(c => c.kind === 'image'), false);
});

// ---------------------------------------------------------------------------------------------------------------
// ^GF parse: uncompressed ASCII hexadecimal

test('parse ^GFA: the ~DG example (four white dots then four black = 0F) is one 8 x 1 bitmap with 1 = black', () => {
  const model = parse(BASE('^FO0,0^GFA,1,1,1,0F^FS'));
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(rowsOf(model.items[0].bitmap), ['00001111']);
});

test('parse ^GFA: position from ^FO, w = bytes per row * 8, h = total / bytes per row, size in 0.1 mm, the ^GF data untouched in native', () => {
  const model = parse(BASE('^FO100,50^GFA,4,4,2,FFC08000^FS'));
  assert.deepEqual(model.diagnostics, []);
  const [item] = model.items;
  assert.equal(item.kind, 'image');
  assert.equal(item.ref, 'GF');
  assert.deepEqual([item.x, item.y, item.width, item.height], [100, 50, 16, 2]);
  assert.deepEqual(rowsOf(item.bitmap), ['1111111111000000', '1000000000000000']);
  assert.deepEqual([item.native.format, item.native.total, item.native.bytesPerRow, item.native.compressed, item.native.origin], ['A', 4, 2, false, 'FO']);
  assert.equal(item.data, null);
  assert.equal(PB.components.forItem(item).kind, 'image');
  assert.equal(item.source.spans.length, 1);
});

test('parse ^GFA: line breaks and blanks inside the data are ignored (the guide: CR and LF can be inserted for readability), lower case hex is read', () => {
  const item = one('^FO0,0^GFA,4,4,2,FF\r\nc0 80\r\n00^FS');
  assert.deepEqual(rowsOf(item.bitmap), ['1111111111000000', '1000000000000000']);
  assert.deepEqual(diagnostics('^FO0,0^GFA,4,4,2,FF\r\nc0 80\r\n00^FS'), []);
});

test('parse ^GFA: the default format (a omitted) is A, and the default 8000-byte shape of the guide example parses at 80 bytes per row', () => {
  const item = one('^FO100,100^GF,4,4,2,FFC08000^FS');
  assert.equal(item.native.format, 'A');
  const big = one(`^FO100,100^GFA,8000,8000,80,${'FF'.repeat(8000)}^FS`);
  assert.deepEqual([big.bitmap.w, big.bitmap.h], [640, 100]);
  assert.equal(big.bitmap.data.every(v => v === 1), true);
});

test('parse ^GFA: ^FT is the bottom-left corner of the image, ^LH moves it, an origin-less field sits at the label home with the existing info', () => {
  const ft = one('^FT100,60^GFA,4,4,2,FFC08000^FS');
  assert.deepEqual([ft.x, ft.y, ft.native.origin], [100, 58, 'FT']);
  const lh = parse('^XA^LH20,30^FO100,50^GFA,1,1,1,FF^FS^XZ').items[0];
  assert.deepEqual([lh.x, lh.y], [120, 80]);
  const bare = parse('^XA^GFA,1,1,1,FF^FS^XZ');
  assert.deepEqual([bare.items[0].x, bare.items[0].y], [0, 0]);
  assert.equal(bare.diagnostics.some(d => d.level === 'info' && /sin \^FO ni \^FT/.test(d.text)), true);
});

test('parse ^GFA: a ^FR on an image is read without inverting it (the existing info)', () => {
  const model = parse(BASE('^FO0,0^FR^GFA,1,1,1,FF^FS'));
  assert.equal(model.items.length, 1);
  assert.equal(model.diagnostics.some(d => d.level === 'info' && /\^FR/.test(d.text)), true);
});

// ---------------------------------------------------------------------------------------------------------------
// ^GF parse: the compression

/** the hex digits the data decodes to, at d bytes per row (one parse, no diagnostics) */
function decoded(data, d, rows) {
  const model = parse(BASE(`^FO0,0^GFA,${d * rows},${d * rows},${d},${data}^FS`));
  assert.deepEqual(model.diagnostics, [], data);
  const bm = model.items[0].bitmap;
  return Array.from({ length: bm.h * d * 2 }, (_, n) => {
    const y = Math.floor(n / (2 * d));
    const x = (n % (2 * d)) * 4;
    return parseInt(Array.from(bm.data.slice(y * bm.w + x, y * bm.w + x + 4)).join(''), 2).toString(16).toUpperCase();
  }).join('');
}

test('compression: the repeat count letters at every range boundary (G = 1, Y = 19, g = 20, h = 40, y = 380, z = 400, and the sums)', () => {
  assert.equal(decoded('GF0', 1, 1), 'F0');                             // G = 1
  assert.equal(decoded('H3', 1, 1), '33');                               // H = 2
  assert.equal(decoded('Y10', 10, 1), '1'.repeat(19) + '0');            // Y = 19
  assert.equal(decoded('gA', 10, 1), 'A'.repeat(20));                    // g = 20
  assert.equal(decoded('gGA0', 11, 1), 'A'.repeat(21) + '0');            // gG = 21
  assert.equal(decoded('gY3G0', 20, 1), '3'.repeat(39) + '0');          // gY = 39
  assert.equal(decoded('h7', 20, 1), '7'.repeat(40));                    // h = 40
  assert.equal(decoded('y3', 190, 1), '3'.repeat(380));                  // y = 380
  assert.equal(decoded('z5', 200, 1), '5'.repeat(400));                  // z = 400
  assert.equal(decoded('zGFY0', 210, 1), 'F'.repeat(401) + '0'.repeat(19)); // zG = 401, then Y = 19
  assert.equal(decoded('zYFG0', 210, 1), 'F'.repeat(419) + '0');         // zY = 419
});

test('compression: `,` fills the rest of the row with 0, `!` fills it with 1, a code at the start of a row fills the whole row', () => {
  assert.equal(decoded('12,,', 4, 2), '12000000' + '00000000');
  assert.equal(decoded('12!!', 4, 2), '12FFFFFF' + 'FFFFFFFF');
  assert.equal(decoded('H1,3!', 4, 2), '11000000' + '3FFFFFFF');
  assert.equal(decoded(',34!', 4, 2), '00000000' + '34FFFFFF');
});

test('compression: `:` repeats the previous row (any number of times, after a filled row too)', () => {
  assert.equal(decoded('ABCDEF01::', 4, 3), 'ABCDEF01'.repeat(3));
  assert.equal(decoded('H5,::!:', 4, 5), '55000000'.repeat(3) + 'FFFFFFFF'.repeat(2));
});

test('compression: the item is flagged as compressed; a plain hex data with commas is not compressed data but a comma still pads the row', () => {
  assert.equal(one('^FO0,0^GFA,4,4,2,HFC,8,^FS').native.compressed, true);
  assert.equal(one('^FO0,0^GFA,4,4,2,FFC08000^FS').native.compressed, false);
  const padded = one('^FO0,0^GFA,4,4,2,FF,80,^FS');
  assert.equal(padded.native.compressed, false);
  assert.deepEqual(rowsOf(padded.bitmap), ['1111111100000000', '1000000000000000']);
});

test('compression: a compressed bitmap decodes to the same dots as its plain form (HFC,8, = FFC08000)', () => {
  assert.deepEqual(rowsOf(one('^FO0,0^GFA,4,4,2,HFC,8,^FS').bitmap), rowsOf(one('^FO0,0^GFA,4,4,2,FFC08000^FS').bitmap));
});

// ---------------------------------------------------------------------------------------------------------------
// ^GF parse: invalid counts and data

test('parse ^GFA: b and c that do not match are reported (the guide: they should match for ASCII), the bitmap follows c', () => {
  const model = parse(BASE('^FO0,0^GFA,3,4,2,FFC08000^FS'));
  assert.equal(model.items.length, 1);
  assert.deepEqual(rowsOf(model.items[0].bitmap), ['1111111111000000', '1000000000000000']);
  assert.equal(loud(model.diagnostics).length, 1);
  assert.match(loud(model.diagnostics)[0].text, /\^GF.*3.*4/);
});

test('parse ^GFA: data shorter than c is padded with white and reported; data longer than c is ignored after c and reported', () => {
  const short = parse(BASE('^FO0,0^GFA,4,4,2,FFC0^FS'));
  assert.deepEqual(rowsOf(short.items[0].bitmap), ['1111111111000000', '0000000000000000']);
  assert.equal(loud(short.diagnostics).length, 1);
  assert.match(loud(short.diagnostics)[0].text, /incompletos \(2 de 4 bytes\)/);
  const long = parse(BASE('^FO0,0^GFA,2,2,2,FFC0FFFF^FS'));
  assert.deepEqual(rowsOf(long.items[0].bitmap), ['1111111111000000']);
  assert.equal(loud(long.diagnostics).length, 1);
  assert.match(loud(long.diagnostics)[0].text, /sobran|ignora/);
});

test('parse ^GFA: a total that is not a multiple of the row size gets a last partial row padded with white, reported', () => {
  const model = parse(BASE('^FO0,0^GFA,3,3,2,FFC0FF^FS'));
  assert.deepEqual(rowsOf(model.items[0].bitmap), ['1111111111000000', '1111111100000000']);
  assert.equal(loud(model.diagnostics).length, 1);
  assert.match(loud(model.diagnostics)[0].text, /múltiplo/);
});

test('parse ^GFA: bytes per row 0 and counts beyond 99999 are set to the nearest limit with a warning (the guide)', () => {
  const zero = parse(BASE('^FO0,0^GFA,2,2,0,FFC0^FS'));
  assert.equal(zero.items.length, 1);
  assert.equal(zero.items[0].bitmap.w, 8);
  assert.match(loud(zero.diagnostics)[0].text, /fuera de rango/);
  const huge = parse(BASE('^FO0,0^GFA,100000,100000,1,FF^FS'));
  assert.equal(huge.items[0].bitmap.h, 99999);
  assert.equal(loud(huge.diagnostics).some(d => /fuera de rango/.test(d.text)), true);
});

test('parse ^GFA: a missing or non numeric count means "the command is ignored" (the guide): a warning and no item', () => {
  for (const args of ['A,2,,2,FFC0', 'A,,2,2,FFC0', 'A,2,2,,FFC0', 'A,x,2,2,FFC0', 'A']) {
    const model = parse(BASE(`^FO0,0^GF${args}^FS`));
    assert.equal(model.items.length, 0, args);
    assert.equal(loud(model.diagnostics).length, 1, args);
    assert.match(loud(model.diagnostics)[0].text, /\^GF/, args);
  }
  assert.equal(loud(parse(BASE('^FO0,0^GFQ,2,2,2,FFC0^FS')).diagnostics).length, 1);
  assert.equal(parse(BASE('^FO0,0^GFQ,2,2,2,FFC0^FS')).items.length, 0);
});

test('parse ^GFA: characters that are not hex or a compression code are reported once and skipped; no data at all is a white bitmap with a warning', () => {
  const bad = parse(BASE('^FO0,0^GFA,1,1,1,0#F@^FS'));
  assert.deepEqual(rowsOf(bad.items[0].bitmap), ['00001111']);
  assert.equal(loud(bad.diagnostics).length, 1);
  assert.match(loud(bad.diagnostics)[0].text, /no válid/);
  const empty = parse(BASE('^FO0,0^GFA,2,2,1,^FS'));
  assert.deepEqual(rowsOf(empty.items[0].bitmap), ['00000000', '00000000']);
  assert.equal(loud(empty.diagnostics).length, 1);
});

test('parse ^GF: binary (B) and compressed binary (C) data cannot be read from a text box: one warning for all of them, nothing is drawn', () => {
  const model = parse(BASE('^FO0,0^GFB,2,2,1,ab^FS^FO0,10^GFC,2,2,1,cd^FS'));
  assert.equal(model.items.length, 0);
  assert.equal(loud(model.diagnostics).length, 1);
  assert.match(loud(model.diagnostics)[0].text, /datos binarios no soportados/);
});

test('parse ^GFA: Z64 data (LZ77 + Base64, Volume Two page 110) is not supported: one warning, nothing is drawn', () => {
  const model = parse(BASE('^FO0,0^GFA,8,8,1,:Z64:eJwBAAD//wAAAAE=:1234^FS^FO0,0^GFA,8,8,1,:Z64:H4sIAAAAAAAAA2NgAAIAAAAA//8DAA==:5678^FS'));
  assert.equal(model.items.length, 0);
  assert.equal(loud(model.diagnostics).length, 1);
  assert.match(loud(model.diagnostics)[0].text, /Z64/);
});

test('parse: stored images (~DG, ~DY, ^IM, ^IL, ^XG) are reported once each as stored in the printer and not supported, nothing is drawn', () => {
  const model = parse(BASE('~DGR:LOGO.GRF,1,1,FF^FO10,10^XGR:LOGO.GRF,1,1^FS^FO10,10^XGR:LOGO.GRF,1,1^FS^FO0,0^IMR:LOGO.GRF^FS^ILR:LOGO.GRF^FS~DYR:LOGO,A,G,1,1,FF'));
  assert.equal(model.items.length, 0);
  const warnings = loud(model.diagnostics).map(d => d.text);
  assert.equal(warnings.length, 5);
  for (const name of ['~DG', '^XG', '^IM', '^IL', '~DY']) assert.equal(warnings.filter(w => w.includes(name)).length, 1, name);
  for (const w of warnings) assert.match(w, /almacenada/);
  assert.equal(model.diagnostics.some(d => /Comando no soportado/.test(d.text)), false);
});

// ---------------------------------------------------------------------------------------------------------------
// Emit

test('emit: an image is ^FOx,y^GFA,<total>,<total>,<bytes per row>,<hex>^FS (plain hex when the compression would not make it shorter)', () => {
  // rows 1A2B3C and 4D5E67: no run, no trailing 0 / F pair that would shorten
  const bm = fromHex('1A2B3C4D5E67', 3);
  assert.deepEqual(emitLines([imageItem(bm, { x: 100, y: 50 })]), ['^FO100,50^GFA,6,6,3,1A2B3C4D5E67^FS']);
  assert.deepEqual(emitDiag([imageItem(bm)]), []);
});

test('emit: by default only the comma of the 2003 guide shortens the data (trailing 00 bytes of a row become one comma, a zero row is just a comma)', () => {
  assert.deepEqual(emitLines([imageItem(bits(['0'.repeat(16), '0'.repeat(16)]), { x: 10, y: 20 })]), ['^FO10,20^GFA,4,4,2,,,^FS']);
  assert.deepEqual(emitLines([imageItem(bits(['1'.repeat(16), '1'.repeat(16), '0'.repeat(16)]))]), ['^FO0,0^GFA,6,6,2,FFFFFFFF,^FS']);
  assert.deepEqual(emitLines([imageItem(bits(['1111111111000000', '1000000000000000']))]), ['^FO0,0^GFA,4,4,2,FFC080,^FS']);
  assert.deepEqual(emitLines([imageItem(bits(['0000000011111111', '1111111100000000']))]), ['^FO0,0^GFA,4,4,2,00FFFF,^FS']);
});

test('emit: an item read from a compressed ^GF is written with the full scheme again (lossless style); the same bitmap without native uses commas only', () => {
  const bm = bits(['0'.repeat(16), '0'.repeat(16)]);
  assert.deepEqual(emitLines([imageItem(bm, { x: 10, y: 20, native: { compressed: true } })]), ['^FO10,20^GFA,4,4,2,,:^FS']);
  assert.deepEqual(emitLines([imageItem(bm, { native: { compressed: false } })]), ['^FO0,0^GFA,4,4,2,,,^FS']);
  const rows = bits(['1111111111000000', '1000000000000000']);
  assert.deepEqual(emitLines([imageItem(rows, { native: { compressed: true } })]), ['^FO0,0^GFA,4,4,2,HFC,8,^FS']);
  // a parsed compressed field keeps its style, a parsed plain field stays plain
  assert.deepEqual(emitLines([one('^FO0,0^GFA,4,4,2,HFC,8,^FS')]), ['^FO0,0^GFA,4,4,2,HFC,8,^FS']);
  assert.deepEqual(emitLines([one('^FO0,0^GFA,4,4,2,FFC08000^FS')]), ['^FO0,0^GFA,4,4,2,FFC080,^FS']);
});

test('emit: the default data of a bitmap with trailing zero bytes uses commas and parses back to the same bitmap', () => {
  const bm = bits(['1010101000000000', '0000000000000000', '1111111100000000', '0000000011110000', '1111111111111111']);
  const line = emitLines([imageItem(bm)])[0];
  assert.equal(line, '^FO0,0^GFA,10,10,2,AA,,FF,00F0FFFF^FS');
  const parsed = parse(BASE(line));
  assert.deepEqual(loud(parsed.diagnostics), []);
  assert.deepEqual(rowsOf(parsed.items[0].bitmap), rowsOf(bm));
  assert.equal(parsed.items[0].native.compressed, false);
  assert.match(slice.graphicCommand(bm), /^\^GFA,10,10,2,[0-9A-F,]+$/);
});

test('the encoder: runs of 1, 2, 19, 20, 21, 39, 40, 399, 400, 401, 419 and 420 digits use the shortest count letters and split above 419', () => {
  const cases = { 1: '5', 2: 'H5', 19: 'Y5', 20: 'g5', 21: 'gG5', 39: 'gY5', 40: 'h5', 399: 'yY5', 400: 'z5', 401: 'zG5', 419: 'zY5', 420: 'zY55' };
  for (const [n, token] of Object.entries(cases)) {
    assert.equal(slice.compressRows(['5'.repeat(n)]), token, `run of ${n}`);
  }
  // trailing zeros / ones of a row become the fill codes, a row equal to the previous one becomes :
  assert.equal(slice.compressRows(['ABC00000']), 'ABC,');
  assert.equal(slice.compressRows(['ABFFFFFF']), 'AB!');
  assert.equal(slice.compressRows(['00000000', 'FFFFFFFF', 'FFFFFFFF', '12345678', '12345678']), ',!:12345678:');
  // graphicCommand: plain commas by default, the full scheme only on request and only when it is shorter
  const two = bits(['0'.repeat(16), '0'.repeat(16)]);
  assert.equal(slice.graphicCommand(two), '^GFA,4,4,2,,,');
  assert.equal(slice.graphicCommand(two, { compress: true }), '^GFA,4,4,2,,:');
  assert.equal(slice.graphicCommand(fromHex('1A2B3C4D5E67', 3), { compress: true }), '^GFA,6,6,3,1A2B3C4D5E67');
});

test('the encoder and the decoder are inverse: every run length and the row codes round trip through parse', () => {
  for (const n of [1, 2, 19, 20, 21, 39, 40, 41, 380, 399, 400, 401, 419, 420, 421, 800]) {
    const hex = '5'.repeat(n) + '7'.repeat(n % 2 === 0 ? 2 : 1);
    const d = hex.length / 2;
    const data = slice.compressRows([hex]);
    assert.equal(decoded(data, d, 1), hex, `run of ${n}`);
  }
});

test('round trip parse -> emit -> parse keeps the bitmap exactly (compressed and plain), the position, and the text is deterministic', () => {
  const samples = [banner(64, 20), banner(24, 7), fromHex('1A2B3C4D5E67', 3), bits(['10101010', '01010101', '11110000', '00001111']), bits(['0'.repeat(40)]), bits(['1'.repeat(40)])];
  for (const bm of samples) {
    const first = emitLines([imageItem(bm, { x: 130, y: 70 })]);
    const parsed = parse(BASE(first[0]));
    assert.deepEqual(loud(parsed.diagnostics), []);
    assert.deepEqual(rowsOf(parsed.items[0].bitmap), rowsOf(bm));
    assert.deepEqual([parsed.items[0].x, parsed.items[0].y], [130, 70]);
    const second = emitLines(parsed.items);
    assert.deepEqual(second, first);
    assert.deepEqual(emitLines([imageItem(bm, { x: 130, y: 70 })]), first);
  }
  assert.match(emitLines([imageItem(banner(64, 20))])[0], /^\^FO0,0\^GFA,160,160,8,[0-9A-F,]+\^FS$/);
  assert.ok(emitLines([imageItem(banner(64, 20))])[0].length < 160 * 2);
  // an image read compressed round trips in the compressed style, byte for byte
  const compressed = emitLines([imageItem(banner(64, 20), { native: { compressed: true } })]);
  assert.match(compressed[0], /[G-Zg-z!:]/);
  const again = parse(BASE(compressed[0]));
  assert.deepEqual(rowsOf(again.items[0].bitmap), rowsOf(banner(64, 20)));
  assert.deepEqual(emitLines(again.items), compressed);
});

test('emit: a width that is not a multiple of 8 gains white padding columns (the row is whole bytes), the rest is exact', () => {
  const odd = bits(['1010101011', '0101010100', '1111111111']);
  const back = parse(BASE(emitLines([imageItem(odd)])[0])).items[0].bitmap;
  assert.deepEqual([back.w, back.h], [16, 3]);
  assert.deepEqual(rowsOf(back), ['1010101011000000', '0101010100000000', '1111111111000000']);
});

test('emit: an image read from ^FT is written with ^FT at the bottom-left again; a moved one keeps it', () => {
  const item = one('^FT100,60^GFA,4,4,2,FFC08000^FS');
  assert.match(emitLines([item])[0], /^\^FT100,60\^GFA,4,4,2,/);
  assert.match(emitLines([{ ...item, x: item.x + 50, y: item.y + 10 }])[0], /^\^FT150,70\^GFA/);
});

test('emit at another resolution: the 0.1 mm position becomes dots', () => {
  assert.match(emitLines([imageItem(bits(['10101010']), { x: 100, y: 50 })], 203)[0], /^\^FO80,40\^GFA,1,1,1,AA\^FS$/);
});

test('emit: overlay-only images (no bitmap) and invalid bitmaps are skipped with one warning each kind, and what is too big for ^GF', () => {
  const overlay = { kind: 'image', x: 0, y: 0, width: 100, height: 100, bitmap: null, href: 'x', data: null };
  assert.deepEqual(emitLines([overlay, overlay]), []);
  const d = emitDiag([overlay, overlay]);
  assert.equal(d.length, 1);
  assert.match(d[0], /^warning: .*sin bitmap.*ZPL/);
  const broken = [imageItem({ w: 8, h: 2, data: new Uint8Array(3) }), imageItem({ w: 0, h: 2, data: new Uint8Array(0) }), imageItem({ w: 2.5, h: 1, data: new Uint8Array(2) })];
  assert.deepEqual(emitLines(broken), []);
  assert.equal(emitDiag(broken).length, 1);
  assert.match(emitDiag(broken)[0], /no válido/);
  // 100 bytes per row * 1000 rows = 100000 bytes: over the 99999 of the guide
  const huge = { w: 800, h: 1000, data: new Uint8Array(800 * 1000) };
  assert.deepEqual(emitLines([imageItem(huge), imageItem(huge)]), []);
  assert.equal(emitDiag([imageItem(huge), imageItem(huge)]).length, 1);
  assert.match(emitDiag([imageItem(huge)])[0], /99999/);
});

// ---------------------------------------------------------------------------------------------------------------
// Insertion from the Imagen overlay

const M = bits(['1111111111', '1000000000']);
const LABEL = '^XA\r\n^PW812\r\n^LL1218\r\n^FO10,10^A0N,30,30^FDHi^FS\r\n^XZ\r\n';

test('imageCommand: x / y in mm become dots at the dpi, the bitmap a ^FO..^GFA..^FS field', () => {
  // 10 mm at 203 dpi = 80 dots, 5 mm = 40 dots; rows FFC0 and 8000
  assert.equal(zpl.imageCommand({ xMm: '10', yMm: '5', ...M, dpi: 203 }), '^FO80,40^GFA,4,4,2,FFC080,^FS');
  assert.equal(zpl.imageCommand({ xMm: 10, yMm: 5, ...M, dpi: 300 }), '^FO118,59^GFA,4,4,2,FFC080,^FS');
});

test('imageCommand: only the syntax of the 2003 guide is written (hex digits A-F and commas: no count letters, no ! and no :)', () => {
  const samples = [M, banner(64, 20), bits(['0'.repeat(40)]), bits(['1'.repeat(40)]), bits(['0'.repeat(16), '0'.repeat(16), '1'.repeat(16)])];
  for (const bm of samples) {
    const data = zpl.imageCommand({ xMm: 3, yMm: 4, ...bm, dpi: 203 }).split(',').slice(4).join(',').replace(/\^FS$/, '');
    assert.match(data, /^[0-9A-F,]*$/);
    assert.doesNotMatch(data, /[G-Zg-z!:]/);
  }
});

test('imageCommand: a comma decimal is accepted, an empty or invalid position is 0, a negative one never goes below 0', () => {
  assert.match(zpl.imageCommand({ xMm: '2,5', yMm: '', ...M, dpi: 203 }), /^\^FO20,0\^GFA/);
  assert.match(zpl.imageCommand({ xMm: 'abc', yMm: '-3', ...M, dpi: 203 }), /^\^FO0,0\^GFA/);
});

test('imageCommand: a bitmap over 99999 bytes throws an Error in Spanish; exactly 99999 is accepted', () => {
  assert.throws(() => zpl.imageCommand({ xMm: 0, yMm: 0, w: 8, h: 100000, data: new Uint8Array(800000), dpi: 203 }), error => error instanceof Error && /supera el máximo de \^GF/.test(error.message));
  assert.throws(() => zpl.imageCommand({ xMm: 0, yMm: 0, w: 800, h: 1000, data: new Uint8Array(800000), dpi: 203 }), /99999/);
  const edge = zpl.imageCommand({ xMm: 0, yMm: 0, w: 24, h: 33333, data: new Uint8Array(24 * 33333), dpi: 203 });
  assert.match(edge, /^\^FO0,0\^GFA,99999,99999,3,/);
});

test('inserted: the field goes before ^XZ, keeps the rest of the label and parses back to the same bitmap', () => {
  const text = zpl.insertCommand(LABEL, zpl.imageCommand({ xMm: '10', yMm: '5', ...M, dpi: 203 }));
  assert.ok(text.indexOf('^GFA') < text.indexOf('^XZ'));
  assert.ok(text.startsWith(LABEL.slice(0, LABEL.indexOf('^XZ'))));
  const model = zpl.parse(text, { dpi: 203 });
  assert.deepEqual(loud(model.diagnostics), []);
  const [item] = model.items.filter(i => i.kind === 'image');
  assert.deepEqual([item.bitmap.w, item.bitmap.h], [16, 2]);
  assert.deepEqual(rowsOf(item.bitmap), ['1111111111000000', '1000000000000000']);
  near(item.x, 100, 1.3, 'x');
  near(item.y, 50, 1.3, 'y');
});

test('the rotated insertion (rotate the bitmap, then the command) parses back to the rotated bitmap, for every angle', () => {
  const sample = bits(['10000000', '11000000', '11100000']);
  for (const angle of [0, 90, 180, 270]) {
    const rotated = images.rotateBitmap(sample, angle);
    const text = zpl.insertCommand(LABEL, zpl.imageCommand({ xMm: '4', yMm: '4', ...rotated, dpi: 203 }));
    const [item] = zpl.parse(text, { dpi: 203 }).items.filter(i => i.kind === 'image');
    assert.equal(item.bitmap.h, rotated.h, `angle ${angle}`);
    // rows are whole bytes: compare the real dots of every row
    const dots = Array.from({ length: rotated.h }, (_, y) => Array.from(item.bitmap.data.slice(y * item.bitmap.w, y * item.bitmap.w + rotated.w)).join(''));
    assert.deepEqual(dots, rowsOf(rotated), `angle ${angle}`);
  }
  // the view-following default (Giro): the angle that makes the picture upright in a view turned by 90
  assert.equal(images.rotationForView(90), 270);
});

test('the app path for ZPL needs no language-specific code: insertImage goes through language.imageCommand when it exists', () => {
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /language\.imageCommand\s*\?\s*language\.imageCommand\(/);
  assert.equal(/get\('zpl'\)|=== 'zpl'/.test(app.slice(app.indexOf('function insertImage'), app.indexOf('function open('))), false);
});

// ---------------------------------------------------------------------------------------------------------------
// Moving and editing

test('moveItem rewrites only ^FO (or ^FT): the ^GF arguments and data stay byte for byte, across line breaks', () => {
  const data = 'HFC,\r\n8,\r\nABCDEF01\r\n:';
  const src = `^XA\r\n^PW812\r\n^FO100,50^GFA,16,16,4,${data}^FS\r\n^FO10,10^A0N,20,20^FDHi^FS\r\n^XZ`;
  const model = zpl.parse(src, { dpi: DPI });
  const first = model.items.find(i => i.kind === 'image');
  const moved = zpl.moveItem(src, first, 30, -20, { dpi: DPI });
  assert.equal(moved, src.replace('^FO100,50', '^FO130,30'));
  assert.ok(moved.includes(`^GFA,16,16,4,${data}^FS`));
  const second = zpl.parse(`^XA^FT100,60^GFA,4,4,2,FFC08000^FS^XZ`, { dpi: DPI }).items[0];
  assert.equal(zpl.moveItem('^XA^FT100,60^GFA,4,4,2,FFC08000^FS^XZ', second, 10, 5, { dpi: DPI }), '^XA^FT110,65^GFA,4,4,2,FFC08000^FS^XZ');
  // a long field: 20000 hex digits
  const long = `^XA^FO1,2^GFA,10000,10000,100,${'A5'.repeat(10000)}^FS^XZ`;
  const item = zpl.parse(long, { dpi: DPI }).items[0];
  assert.equal(zpl.moveItem(long, item, 9, 8, { dpi: DPI }), long.replace('^FO1,2', '^FO10,10'));
});

test('an image has no editable fields (it only moves) and updateItem leaves the text unchanged', () => {
  const src = '^XA^FO100,50^GFA,4,4,2,FFC08000^FS^XZ';
  const item = zpl.parse(src, { dpi: DPI }).items[0];
  assert.deepEqual(zpl.describeItem(item, src, { dpi: DPI }), { kind: 'image', fields: [] });
  assert.equal(zpl.updateItem(src, item, { width: 5, content: 'x' }, { dpi: DPI }), src);
});

// ---------------------------------------------------------------------------------------------------------------
// Conversion through the shared pipeline

const tpclLabel = body => ['{D0500,1000,0500|}', '{AX;+000,+000,+00|}', '{C|}', body, '{XS;I,0001,0002C4100|}'].join('\r\n');
const tsplText = (...lines) => ['SIZE 100 mm,60 mm', 'CLS', ...lines, 'PRINT 1,1', ''].join('\r\n');
const SAMPLE = banner(32, 12);

test('TPCL -> ZPL: an SG graphic becomes a ^GFA field with the same bitmap and position', () => {
  const text = tpclLabel(images.buildSG({ xMm: 10, yMm: 5, w: SAMPLE.w, h: SAMPLE.h, data: images.bitmapToNibble(SAMPLE.data, SAMPLE.w, SAMPLE.h) }));
  const result = PB.convert.run(text, 'zpl', { dpi: 203 });
  assert.equal(result.source, 'tpcl');
  assert.deepEqual(loud(result.diagnostics), []);
  assert.match(result.text, /\^FO80,40\^GFA,48,48,4,/);
  const back = zpl.parse(result.text, { dpi: 203 });
  assert.deepEqual(loud(back.diagnostics), []);
  const [item] = back.items;
  assert.deepEqual(rowsOf(item.bitmap), rowsOf(SAMPLE));
  const dot = PB.units.dotSize(203);
  near(item.x, 100, dot, 'x');
  near(item.y, 50, dot, 'y');
});

test('ZPL -> TPCL and ZPL -> TSPL: the bitmap and the position survive (ZPL 1 = black, TPCL nibbles, TSPL inverted bits)', () => {
  const src = BASE(slice.graphicField(80, 40, SAMPLE));
  for (const [target, parser] of [['tpcl', tpcl], ['tspl', tspl]]) {
    const result = PB.convert.run(src, target, { dpi: 203 });
    assert.equal(result.source, 'zpl');
    assert.deepEqual(loud(result.diagnostics), [], target);
    const model = parser.parse(result.text, { dpi: 203 });
    const [item] = model.items.filter(i => i.kind === 'image');
    assert.deepEqual(rowsOf(item.bitmap), rowsOf(SAMPLE), target);
    near(item.x, 80 * PB.units.dotSize(203), 2, `${target} x`);
    near(item.y, 40 * PB.units.dotSize(203), 2, `${target} y`);
  }
});

test('TSPL -> ZPL -> TSPL: a BITMAP becomes a ^GFA field and back with the same dots', () => {
  const text = tsplText(tspl.imageCommand({ xMm: '10', yMm: '5', ...SAMPLE, dpi: 203 }));
  const result = PB.convert.run(text, 'zpl', { dpi: 203 });
  assert.equal(result.source, 'tspl');
  assert.deepEqual(loud(result.diagnostics), []);
  const model = zpl.parse(result.text, { dpi: 203 });
  assert.deepEqual(loud(model.diagnostics), []);
  assert.deepEqual(rowsOf(model.items.find(i => i.kind === 'image').bitmap), rowsOf(SAMPLE));
  const again = PB.convert.run(result.text, 'tspl', { dpi: 203 });
  assert.deepEqual(loud(again.diagnostics), []);
  assert.deepEqual(rowsOf(tspl.parse(again.text, { dpi: 203 }).items.find(i => i.kind === 'image').bitmap), rowsOf(SAMPLE));
});

test('conversion to ZPL: an image without a bitmap (preview only) warns once, like the other emitters', () => {
  const overlay = { language: 'tpcl', size: { width: 990, height: 550, pitch: 610, gap: null, native: {} }, items: [{ kind: 'image', x: 40, y: 30, width: 100, height: 100, bitmap: null, data: null }], diagnostics: [] };
  const out = PB.languages.emit('zpl', overlay, { dpi: 203 });
  assert.equal(loud(out.diagnostics).length, 1);
  assert.match(loud(out.diagnostics)[0].text, /sin bitmap/);
});

// ---------------------------------------------------------------------------------------------------------------
// Volume Two, printed pages 52-53 and 110-112: the compression scheme as the manual writes it, and B64

test('manual page 52: the examples of the guide (M6 = 7 sixes, hB = 40 B, MvB and vMB = 327 B, the order of the counts does not matter)', () => {
  const nibbles = (text, rowNibbles = 400) => {
    const r = slice.decodeData(text, rowNibbles, rowNibbles);
    return { text: Array.from(r.nibbles.slice(0, r.produced), n => n.toString(16).toUpperCase()).join(''), invalid: r.invalid, extra: r.extra };
  };
  assert.deepEqual(nibbles('M6', 7), { text: '6666666', invalid: 0, extra: false });
  assert.equal(nibbles('hB', 40).text, 'B'.repeat(40));
  assert.equal(nibbles('MvB').text, 'B'.repeat(327));
  assert.equal(nibbles('vMB').text, 'B'.repeat(327));
});

test('manual page 52: G..Y are 1..19 and g..z are 20..400 (g h i j k l m n o p q r s t u v w x y z), every letter', () => {
  const small = 'GHIJKLMNOPQRSTUVWXY';
  const large = 'ghijklmnopqrstuvwxyz';
  const count = ch => slice.decodeData(ch + '1', 400, 400).produced;
  [...small].forEach((ch, i) => assert.equal(count(ch), i + 1, ch));
  [...large].forEach((ch, i) => assert.equal(count(ch), 20 * (i + 1), ch));
});

test('manual page 52: a comma fills the line with 0, an exclamation mark with 1 and a colon repeats the previous line (several per image, mixed)', () => {
  // 3 bytes per row, 4 rows: "AB" + zeros, a row of ones, the same row again, a row of zeros
  assert.equal(decoded('AB,!:,', 3, 4), 'AB0000' + 'FFFFFF' + 'FFFFFF' + '000000');
});

test('manual page 53: the reduction of ~DG ("if the HEX string ends in an even number of zeros a single comma replaces ALL of them") reads as the plain data', () => {
  assert.deepEqual(rowsOf(one('^FO0,0^GFA,4,4,2,FF,80,^FS').bitmap), rowsOf(one('^FO0,0^GFA,4,4,2,FF008000^FS').bitmap));
});

test('B64 (manual page 112, :B64:encoded_data:crc): the data is the image bytes in Base64; the CRC is not checked (no algorithm in the guide) and one info says so', () => {
  const model = parse(BASE('^FO0,0^GFA,4,4,2,:B64:/8CAAA==:1234^FS'));
  assert.equal(model.items.length, 1);
  assert.deepEqual(rowsOf(model.items[0].bitmap), ['1111111111000000', '1000000000000000']);
  assert.deepEqual(model.items[0].native.compressed, false);
  assert.deepEqual(model.diagnostics.map(d => d.level), ['info']);
  assert.match(model.diagnostics[0].text, /B64.*CRC/);
  // the same image in plain hex gives the same dots
  assert.deepEqual(rowsOf(model.items[0].bitmap), rowsOf(one('^FO0,0^GFA,4,4,2,FFC08000^FS').bitmap));
  // line breaks are allowed in the Base64 (page 111), the info is given once, and the image is written back as plain hex
  const wrapped = parse(BASE('^FO0,0^GFA,4,4,2,:B64:/8C\r\nAAA==:1234^FS^FO0,10^GFA,4,4,2,:B64:/8CAAA==:1234^FS'));
  assert.equal(wrapped.items.length, 2);
  assert.equal(wrapped.diagnostics.length, 1);
  assert.deepEqual(emitLines(wrapped.items), ['^FO0,0^GFA,4,4,2,FFC080,^FS', '^FO0,10^GFA,4,4,2,FFC080,^FS']);
});

test('B64: short data is padded with white and reported, extra data is ignored and reported, a character outside Base64 is reported', () => {
  const short = parse(BASE('^FO0,0^GFA,4,4,2,:B64:/w==:1234^FS'));
  assert.deepEqual(rowsOf(short.items[0].bitmap), ['1111111100000000', '0000000000000000']);
  assert.ok(loud(short.diagnostics).some(d => /incompletos/.test(d.text)));
  const long = parse(BASE('^FO0,0^GFA,1,1,1,:B64:/8CAAA==:1234^FS'));
  assert.deepEqual(rowsOf(long.items[0].bitmap), ['11111111']);
  assert.ok(loud(long.diagnostics).some(d => /sobran/.test(d.text)));
  const bad = parse(BASE('^FO0,0^GFA,1,1,1,:B64:/#w==:1234^FS'));
  assert.deepEqual(rowsOf(bad.items[0].bitmap), ['11111111']);
  assert.ok(loud(bad.diagnostics).some(d => /no válid/.test(d.text)));
});

test('what the emitter writes by default stays the documented comma: the compression is only for images read compressed (the manual documents it for ~DG / ~DB, not ^GF)', () => {
  const bm = banner(64, 20);
  const plain = emitLines([imageItem(bm)])[0];
  assert.doesNotMatch(plain.replace(/^\^FO0,0\^GFA,\d+,\d+,\d+,/, '').replace(/\^FS$/, ''), /[G-Zg-z!:]/);
  assert.equal(slice.graphicCommand(bm), plain.replace(/^\^FO0,0/, '').replace(/\^FS$/, ''));
});
