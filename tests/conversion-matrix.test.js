const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// Z8: the conversion matrix between TPCL, TSPL and ZPL.
//
// Every case (a label with one feature, a mixed label, a tour of the native fonts of a language, or one of the example labels of js/config.js)
// is written in each language that can hold it, converted with PB.convert.run to each of the other two, read back with the target parser and
// compared, item by item, with what the source parser read. The result of a feature in a pair is
//   exact      the same items with the same fields (within the tolerances below),
//   degraded   the item survives with some fields changed, and a diagnostic of the existing style says so,
//   skipped    the item is left out of the output, and a diagnostic says so.
// RULES below is that table: case id x pair -> expected result; whatever no rule names has to be exact.
//
// Tolerances (all units are 0.1 mm, one dot = PB.units.dotSize(dpi)): coordinates, lengths, thicknesses, radii, barcode heights and modules
// differ by at most one dot plus the 0.1 mm rounding of the model; font sizes and widths by at most half a point or the 5% with which the
// bitmap fonts are matched, whichever is larger. Positions are compared through the neutral model only (see "text origin" at the end: the languages disagree on what the origin of
// a text is, and that is an open point, not something this file settles).
const PB = loadUpTo('js/ui.js');

const LANGS = ['tpcl', 'tspl', 'zpl'];
const PAIRS = LANGS.flatMap(from => LANGS.filter(to => to !== from).map(to => `${from}>${to}`));
const DPIS = [203, 300];
const EPS = 1e-6;
const HALF_POINT = PB.units.UNITS_PER_POINT / 2;
const FNC1 = PB.barcodeData.FNC1;
const parser = id => PB.languages.get(id);
const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));
const dotOf = dpi => PB.units.dotSize(dpi);

// ---------------------------------------------------------------------------------------------------------------------------
// Neutral builders (0.1 mm). Every case is a 100 x 60 mm label.

const SIZE = Object.freeze({ width: 1000, height: 600, pitch: 630, gap: 30 });
const labelOf = items => ({ language: 'neutral', size: { ...SIZE, native: {} }, items, diagnostics: [] });
const font = (size = 100, family = 'sans', weight = 400, style = 'normal', scaleX = 1) => ({ size, scaleX, family, weight, style });
const text = (o = {}) => ({ kind: 'text', x: 100, y: 200, rotation: 0, font: font(), data: 'Hello', ...o });
const barcode = (o = {}) => ({ kind: 'barcode', x: 100, y: 200, rotation: 0, module: 2.5, height: 80, humanReadable: true, symbology: 'code128', data: 'ABC123', ...o });
const qr = (o = {}) => ({ kind: 'qr', x: 100, y: 200, ecc: 'M', cell: 5, symbology: 'qr', data: 'https://example.com/1', ...o });
const dmatrix = (o = {}) => ({ kind: 'datamatrix', x: 100, y: 200, rotation: 0, cell: 5, ecc: 200, symbology: 'datamatrix', data: 'DM12345', ...o });
const line = (o = {}) => ({ kind: 'line', x1: 100, y1: 100, x2: 500, y2: 100, rect: false, width: 5, ...o });
const box = (o = {}) => line({ x1: 100, y1: 100, x2: 500, y2: 300, rect: true, width: 5, ...o });
const ellipse = (o = {}) => ({ kind: 'ellipse', ref: 'ELLIPSE', x: 100, y: 100, width: 400, height: 200, thickness: 5, ...o });
const circle = (o = {}) => ellipse({ ref: 'CIRCLE', width: 300, height: 300, ...o });
const area = (o = {}) => ({ kind: 'area', mode: 'reverse', x: 100, y: 100, width: 300, height: 200, ...o });
const bitmapOf = (w, h, fn) => ({ w, h, data: Uint8Array.from({ length: w * h }, (_, i) => (fn(i % w, Math.floor(i / w)) ? 1 : 0)) });
const image = (o = {}) => ({ kind: 'image', x: 100, y: 100, width: 0, height: 0, bitmap: bitmapOf(24, 10, (x, y) => (x + 2 * y) % 5 === 0), data: null, ...o });

const CASES = [];
/** A case made of neutral items: each language writes them with its own emitter, so every language that can hold them is a source. */
const neutral = (id, items) => CASES.push({ id, items });
/** A case written natively: bodies = { language: dpi => commands } (the header and trailer of the label are added). */
const nativeCase = (id, bodies, extra = {}) => CASES.push({ id, bodies, fonts: id.startsWith('fonts-'), ...extra });

const HEADERS = {
  tpcl: () => '{D0630,1000,0600|}\n{AX;+000,+000,+00|}\n{C|}\n',
  tspl: () => 'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n',
  zpl: dpi => `^XA\r\n^PW${Math.round(1000 / dotOf(dpi))}\r\n^LL${Math.round(600 / dotOf(dpi))}\r\n`,
};
const TRAILERS = { tpcl: () => '\n{XS;I,0001,0002C4100|}', tspl: () => '\r\nPRINT 1,1\r\n', zpl: () => '\r\n^XZ\r\n' };

// ---------------------------------------------------------------------------------------------------------------------------
// Text

neutral('text-sans', () => [text()]);
neutral('text-serif', () => [text({ font: font(100, 'serif') })]);
neutral('text-mono', () => [text({ font: font(100, 'mono') })]);
neutral('text-bold', () => [text({ font: font(100, 'sans', 700) })]);
neutral('text-italic', () => [text({ font: font(100, 'serif', 400, 'italic') })]);
neutral('text-small', () => [text({ font: font(60) })]);
neutral('text-large', () => [text({ font: font(240) })]);
neutral('text-wide', () => [text({ font: font(100, 'sans', 400, 'normal', 1.5) })]);
for (const rotation of [90, 180, 270]) neutral(`text-rotation-${rotation}`, () => [text({ rotation })]);
neutral('text-reverse-attribute', () => [text({ attribute: { kind: 'reverse', h: 20, v: 20, defaultDots: 6 } })]);
neutral('text-box-attribute', () => [text({ attribute: { kind: 'box', h: 20, v: 20, defaultDots: 6 } })]);
neutral('text-strike-attribute', () => [text({ attribute: { kind: 'strike', h: 20, defaultDots: 6 } })]);
neutral('text-align-center', () => [text({ align: { kind: 'center' } })]);
neutral('text-align-right', () => [text({ align: { kind: 'right' } })]);
neutral('text-align-equal', () => [text({ align: { kind: 'equal', width: 400 } })]);
neutral('text-spacing', () => [text({ spacing: { value: 12 } })]);
// The bold overprint (J) belongs to the bitmap fonts of TPCL: the neutral sans 100 would be written with the outline font, so it is native
nativeCase('text-bold-overprint', { tpcl: () => '{PC000;0100,0200,06,06,J,00,B,J0102|}\n{RC000;Bold|}' });
neutral('text-counter', () => [text({ data: '0001', counter: { step: 1 } })]);
neutral('text-counter-down', () => [text({ data: '0100', counter: { step: -5 } })]);
neutral('text-counter-zero-suppress', () => [text({ data: '0001', counter: { step: 1 }, zeroSuppress: 3 })]);
neutral('text-variable', () => [text({ data: 'Lot #LOT# of #TOTAL#' })]);
neutral('text-special-characters', () => [text({ data: 'say "hi" 100%' })]);
neutral('text-reserved-characters', () => [text({ data: 'a^b~c,d;e\\f' })]);
neutral('text-accents', () => [text({ data: 'Ñandú café' })]);
neutral('text-all-ascii', () => [text({ data: '!#$%&\'()*+-./:<=>?@[]_`0123456789' })]);
neutral('text-zpl-reverse', () => [text({ reverse: true })]);
// Text blocks (TSPL BLOCK, ZPL ^FB, TPCL PC P5): width, lines and line space travel between the three; TPCL has no alignment of a block, and the
// sans 100 font of the first cases is an outline (PV) font in TPCL, which has no block (the "-bitmap" cases use a font the PC command writes)
const block = (o = {}) => ({ width: 300, lines: 4, align: 'left', lineSpace: 0, ...o });
const BLOCK_DATA = 'Hello world, this is a block of text';
neutral('text-block', () => [text({ data: BLOCK_DATA, block: block() })]);
neutral('text-block-center', () => [text({ data: BLOCK_DATA, block: block({ align: 'center' }) })]);
neutral('text-block-right', () => [text({ data: BLOCK_DATA, block: block({ align: 'right' }) })]);
neutral('text-block-justify', () => [text({ data: BLOCK_DATA, block: block({ align: 'justify' }) })]);
neutral('text-block-line-space', () => [text({ data: BLOCK_DATA, block: block({ lineSpace: 25 }) })]);
neutral('text-block-breaks', () => [text({ data: 'one\ntwo three', block: block() })]);
neutral('text-block-rotated', () => [text({ x: 500, data: BLOCK_DATA, rotation: 90, block: block() })]);
neutral('text-block-mono', () => [text({ data: BLOCK_DATA, font: font(100, 'mono'), block: block({ width: 400 }) })]);
// A 12 pt mono font is the bitmap PC font S at magnification 1.0, so TPCL writes these as PC ...,P5aaaabbbcc
const PC_MONO = font(12 * PB.units.UNITS_PER_POINT, 'mono');
neutral('text-block-bitmap', () => [text({ data: BLOCK_DATA, font: PC_MONO, block: block({ lineSpace: 20 }) })]);
neutral('text-block-bitmap-center', () => [text({ data: BLOCK_DATA, font: PC_MONO, block: block({ lineSpace: 20, align: 'center' }) })]);
neutral('text-block-bitmap-right', () => [text({ data: BLOCK_DATA, font: PC_MONO, block: block({ lineSpace: 20, align: 'right' }) })]);
neutral('text-block-bitmap-justify', () => [text({ data: BLOCK_DATA, font: PC_MONO, block: block({ lineSpace: 20, align: 'justify' }) })]);
neutral('text-block-bitmap-no-space', () => [text({ data: BLOCK_DATA, font: PC_MONO, block: block() })]);
neutral('text-block-bitmap-breaks', () => [text({ data: 'one\ntwo three', font: PC_MONO, block: block({ lineSpace: 20 }) })]);
neutral('text-block-bitmap-rotated', () => [text({ x: 500, data: BLOCK_DATA, rotation: 90, font: PC_MONO, block: block({ lineSpace: 20 }) })]);

// The fonts of each language, written natively: every bitmap font, magnifications, the scalable fonts and the rotations. The neutral model
// cannot name a font and every language maps its family and size to its own, so a font is always "degraded" between languages.
const dotsOf = (mm10, dpi) => Math.round(mm10 / dotOf(dpi));
const tpclRows = (letters, mag, rotation = '00') => letters.map((letter, i) => {
  const [x, y, id] = [60 + 480 * (i % 2), 30 + 27 * Math.floor(i / 2), String(i).padStart(3, '0')];
  return `{PC${id};${String(x).padStart(4, '0')},${String(y).padStart(4, '0')},${mag},${mag},${letter},${rotation},B=Font ${letter}|}`;
}).join('\n');
nativeCase('fonts-tpcl', { tpcl: () => tpclRows('ABCDEFGHIJKLMNOPQRST'.split(''), '06') });
nativeCase('fonts-tpcl-magnified', { tpcl: () => tpclRows(['G', 'J', 'N', 'S'], '10') });
for (const code of ['11', '22', '33']) nativeCase(`fonts-tpcl-rotation-${code}`, { tpcl: () => tpclRows(['G', 'J', 'N'], '06', code) });
nativeCase('fonts-tpcl-outline', { tpcl: () => '{PV00;0100,0100,0100,0100,B,00,B|}\n{RV00;Outline|}\n{PV01;0100,0300,0240,0120,B,00,B|}\n{RV01;Wide|}' });

const tsplRows = (fonts, mul, rotation = 0) => dpi => fonts
  .map((name, i) => `TEXT ${dotsOf(60 + 480 * (i % 2), dpi)},${dotsOf((rotation === 180 ? 70 : 30) + 40 * Math.floor(i / 2), dpi)},"${name}",${rotation},${mul},${mul},"Font ${name}"`).join('\r\n');
nativeCase('fonts-tspl', { tspl: tsplRows(['1', '2', '3', '4', '5', '6', '7', '8'], 1) });
nativeCase('fonts-tspl-magnified', { tspl: tsplRows(['1', '3', '5'], 2) });
for (const rotation of [90, 180, 270]) nativeCase(`fonts-tspl-rotation-${rotation}`, { tspl: tsplRows(['2', '4'], 1, rotation) });
nativeCase('fonts-tspl-scalable', {
  tspl: dpi => [[8, 8], [10, 10], [12, 12], [24, 24], [12, 18]].map(([w, h], i) => `TEXT ${dotsOf(60, dpi)},${dotsOf(30 + 90 * i, dpi)},"0",0,${w},${h},"Scalable ${h}"`).join('\r\n'),
});

const zplRows = (fonts, h, w, orientation = 'N') => dpi => fonts
  .map((name, i) => `^FO${dotsOf(60 + 480 * (i % 2), dpi)},${dotsOf(30 + 40 * Math.floor(i / 2), dpi)}^A${name}${orientation},${h},${w}^FDFont ${name}^FS`).join('\r\n');
nativeCase('fonts-zpl', { zpl: zplRows('ABCDEFGH'.split(''), 0, 0) });
nativeCase('fonts-zpl-magnified', { zpl: zplRows(['A', 'D', 'E'], 36, 20) });
for (const o of ['R', 'I', 'B']) nativeCase(`fonts-zpl-rotation-${o}`, { zpl: zplRows(['A', 'D'], 0, 0, o) });
nativeCase('fonts-zpl-scalable', {
  zpl: dpi => [[30, 30], [60, 60], [120, 90], [24, 12], [48, 48]].map(([h, w], i) => `^FO${dotsOf(60, dpi)},${dotsOf(30 + 90 * i, dpi)}^A0N,${h},${w}^FDScalable ${h}^FS`).join('\r\n'),
});

// ---------------------------------------------------------------------------------------------------------------------------
// Barcodes: every symbology, its check options, add-ons, the human readable line, rotation, the wide / narrow ratio

neutral('barcode-code128', () => [barcode()]);
neutral('barcode-code128-no-text', () => [barcode({ humanReadable: false })]);
neutral('barcode-code128-fnc1', () => [barcode({ data: `01${FNC1}2345` })]);
neutral('barcode-code128-reserved', () => [barcode({ data: 'A^B~C,D' })]);
for (const rotation of [90, 180, 270]) neutral(`barcode-code128-rotation-${rotation}`, () => [barcode({ rotation })]);
neutral('barcode-code39', () => [barcode({ symbology: 'code39', data: 'CODE39', check: 'none' })]);
neutral('barcode-code39-no-text', () => [barcode({ symbology: 'code39', data: 'CODE39', check: 'none', humanReadable: false })]);
neutral('barcode-code39-mod43', () => [barcode({ symbology: 'code39', data: 'CODE39', check: 'mod43' })]);
neutral('barcode-code39-wide', () => [barcode({
  symbology: 'code39', data: 'CODE39', check: 'none', widths: { narrowBar: 2.5, narrowSpace: 2.5, wideBar: 5, wideSpace: 5 }, interCharGap: 2.5,
})]);
neutral('barcode-itf', () => [barcode({ symbology: 'itf', data: '0123456789', check: 'none' })]);
neutral('barcode-itf-check', () => [barcode({ symbology: 'itf', data: '012345678', check: 'auto' })]);
neutral('barcode-itf-wide', () => [barcode({ symbology: 'itf', data: '0123456789', check: 'none', widths: { narrowBar: 2.5, narrowSpace: 2.5, wideBar: 5, wideSpace: 5 } })]);
neutral('barcode-code93', () => [barcode({ symbology: 'code93', data: 'CODE93', check: 'none' })]);
neutral('barcode-code93-check', () => [barcode({ symbology: 'code93', data: 'CODE93', check: 'check' })]);
neutral('barcode-code93-auto', () => [barcode({ symbology: 'code93', data: 'CODE93', check: 'auto' })]);
neutral('barcode-codabar', () => [barcode({ symbology: 'codabar', data: 'A123456B', check: 'none' })]);
neutral('barcode-codabar-wide', () => [barcode({
  symbology: 'codabar', data: 'A123456B', check: 'none', widths: { narrowBar: 2.5, narrowSpace: 2.5, wideBar: 6.5, wideSpace: 6.5 }, interCharGap: 2.5,
})]);
neutral('barcode-msi', () => [barcode({ symbology: 'msi', data: '1234567', check: 'none' })]);
for (const check of ['check', 'auto', 'mod1010', 'mod1110']) neutral(`barcode-msi-${check}`, () => [barcode({ symbology: 'msi', data: '1234567', check })]);
neutral('barcode-industrial25', () => [barcode({ symbology: 'industrial25', data: '12345678', check: 'none' })]);
neutral('barcode-industrial25-auto', () => [barcode({ symbology: 'industrial25', data: '12345678', check: 'auto' })]);
neutral('barcode-ean13', () => [barcode({ symbology: 'ean13', data: '5901234123457', check: 'auto' })]);
neutral('barcode-ean13-no-check', () => [barcode({ symbology: 'ean13', data: '590123412345', check: 'none' })]);
neutral('barcode-ean13-no-text', () => [barcode({ symbology: 'ean13', data: '5901234123457', check: 'auto', humanReadable: false })]);
neutral('barcode-ean13-guard', () => [barcode({ symbology: 'ean13', data: '5901234123457', check: 'auto', guard: 12 })]);
neutral('barcode-ean13-addon2', () => [barcode({ symbology: 'ean13', data: '590123412345712', check: 'auto', addon: 2 })]);
neutral('barcode-ean13-addon5', () => [barcode({ symbology: 'ean13', data: '590123412345712345', check: 'auto', addon: 5 })]);
neutral('barcode-ean8', () => [barcode({ symbology: 'ean8', data: '96385074', check: 'auto' })]);
neutral('barcode-upca', () => [barcode({ symbology: 'upca', data: '012345678905', check: 'auto' })]);
neutral('barcode-upce', () => [barcode({ symbology: 'upce', data: '01234565', check: 'auto' })]);
neutral('barcode-counter', () => [barcode({ data: '0001', counter: { step: 1 } })]);
neutral('barcode-counter-zero-suppress', () => [barcode({ data: '0001', counter: { step: 1 }, zeroSuppress: 2 })]);
neutral('barcode-variable', () => [barcode({ data: '#CODE#' })]);

// Barcode types written natively (the neutral emit never produces them): TSPL manual types and ZPL variants
nativeCase('barcodes-tspl-types', {
  tspl: dpi => [
    ['128M', 'ABC!102123'], ['EAN128', '0112345678901231'], ['39S', 'ABC'], ['ITF14', '12345678901231'], ['EAN13+2', '590123412345712'],
    ['EAN8+5', '9638507412345'], ['UPCA+2', '01234567890512'], ['UPCE+5', '0123456512345'],
  ].map(([type, data], i) => `BARCODE ${dotsOf(60, dpi)},${dotsOf(30 + 50 * i, dpi)},"${type}",${dotsOf(40, dpi)},1,0,2,5,"${data}"`).join('\r\n'),
});
// 25C = Interleaved 2 of 5 with a check digit: the neutral model has no such option ('unsupported'), so it is written without one, reported
nativeCase('barcodes-tspl-25c', {
  tspl: dpi => `BARCODE ${dotsOf(60, dpi)},${dotsOf(30, dpi)},"25C",${dotsOf(40, dpi)},1,0,2,5,"12345678"`,
}, { roundTripKeys: { tspl: ['check'] } });
// Types the TSPL manual has and the neutral model does not (symbology 'unknown'): drawn approximately, never written to another language
nativeCase('barcodes-tspl-unknown', {
  tspl: dpi => [['POST', '12345'], ['MSI', '1234567']]
    .map(([type, data], i) => `BARCODE ${dotsOf(60, dpi)},${dotsOf(30 + 50 * i, dpi)},"${type}",${dotsOf(40, dpi)},1,0,2,5,"${data}"`).join('\r\n'),
}, { roundTripSkips: { tspl: ['barcode', 'barcode'] } });
nativeCase('barcodes-zpl-variants', {
  zpl: dpi => [
    `^FO${dotsOf(60, dpi)},${dotsOf(30, dpi)}^BY3,3.0,40^BJN,40,Y,N^FD12345678^FS`,
    `^FO${dotsOf(60, dpi)},${dotsOf(100, dpi)}^BY2^BCN,40,N,N,N,N^FD>;0112345678^FS`,
    `^FO${dotsOf(60, dpi)},${dotsOf(170, dpi)}^BY2^B3N,Y,40,Y,N^FDABC123^FS`,
    `^FO${dotsOf(60, dpi)},${dotsOf(240, dpi)}^BY2,2.0^B2N,40,Y,N,Y^FD123456789^FS`,
    `^FT${dotsOf(60, dpi)},${dotsOf(380, dpi)}^BY2^BEN,40,Y,N^FD590123412345^FS`,
    `^FT${dotsOf(400, dpi)},${dotsOf(380, dpi)}^BY2^BKN,N,40,Y,N,A,B^FD123456^FS`,
  ].join('\r\n'),
});
nativeCase('qr-zpl-variants', {
  zpl: dpi => [
    `^FO${dotsOf(60, dpi)},${dotsOf(30, dpi)}^BQN,2,6^FDHA,Manual mode^FS`,
    `^FO${dotsOf(400, dpi)},${dotsOf(30, dpi)}^BQN,2,3^FDQM,A1234^FS`,
    `^FO${dotsOf(60, dpi)},${dotsOf(300, dpi)}^BXN,5,200,16,16^FDDM16^FS`,
    `^FO${dotsOf(400, dpi)},${dotsOf(300, dpi)}^BXR,4,200^FDDMR^FS`,
  ].join('\r\n'),
});
nativeCase('qr-tspl-variants', {
  tspl: dpi => [
    `QRCODE ${dotsOf(60, dpi)},${dotsOf(30, dpi)},H,6,A,0,"QR with level H"`,
    `QRCODE ${dotsOf(400, dpi)},${dotsOf(30, dpi)},Q,4,M,90,M2,"manual mode"`,
    `DMATRIX ${dotsOf(60, dpi)},${dotsOf(300, dpi)},${dotsOf(200, dpi)},${dotsOf(200, dpi)},"DM area form"`,
    `DMATRIX ${dotsOf(400, dpi)},${dotsOf(300, dpi)},80,80,4,20,20,"DM full form"`,
  ].join('\r\n'),
});

// The label orientation: DIRECTION 0 (TSPL) and ^POI (ZPL) print the label rotated 180 degrees. The viewer draws both unrotated (reported when read);
// a conversion between languages cannot say it and reports it, the same language writes it back
nativeCase('label-rotated-180', {
  tspl: dpi => `DIRECTION 0\r\nTEXT ${dotsOf(60, dpi)},${dotsOf(100, dpi)},"3",0,1,1,"Rotated"`,
  zpl: dpi => `^POI\r\n^FO${dotsOf(60, dpi)},${dotsOf(100, dpi)}^A0N,30,30^FDRotated^FS`,
});

// Label offsets (TSPL REFERENCE and SHIFT, ZPL ^LH ^LS ^LT) are folded into the positions of the items
nativeCase('label-offsets', {
  tspl: dpi => `REFERENCE ${dotsOf(40, dpi)},${dotsOf(24, dpi)}\r\nSHIFT 8,4\r\nTEXT ${dotsOf(60, dpi)},${dotsOf(100, dpi)},"3",0,1,1,"Offsets"\r\nBAR ${dotsOf(60, dpi)},${dotsOf(200, dpi)},200,3`,
  zpl: dpi => `^LH${dotsOf(40, dpi)},${dotsOf(24, dpi)}\r\n^LS8\r\n^LT4\r\n^FO${dotsOf(60, dpi)},${dotsOf(100, dpi)}^A0N,30,30^FDOffsets^FS\r\n^FO${dotsOf(60, dpi)},${dotsOf(200, dpi)}^GB200,3,3^FS`,
});

// QR and Data Matrix
for (const ecc of ['L', 'M', 'Q', 'H']) neutral(`qr-ecc-${ecc}`, () => [qr({ ecc })]);
for (const cell of [3, 8]) neutral(`qr-cell-${cell}`, () => [qr({ cell })]);
neutral('datamatrix', () => [dmatrix()]);
neutral('datamatrix-size-16', () => [dmatrix({ size: 16 })]);
neutral('datamatrix-size-32', () => [dmatrix({ size: 32 })]);
for (const rotation of [90, 180, 270]) neutral(`datamatrix-rotation-${rotation}`, () => [dmatrix({ rotation })]);

// Shapes
neutral('line-horizontal', () => [line()]);
neutral('line-vertical', () => [line({ x2: 100, y2: 400 })]);
neutral('line-thick', () => [line({ width: 30 })]);
neutral('line-empty', () => [line({ x2: 100 })]);
neutral('line-short-thick', () => [line({ x2: 110, width: 30 })]);
neutral('line-short-thick-vertical', () => [line({ x2: 100, y2: 110, width: 30 })]);
neutral('line-diagonal', () => [line({ x2: 500, y2: 300 })]);
neutral('line-white', () => [line({ white: true })]);
neutral('line-reverse', () => [line({ reverse: true })]);
neutral('box', () => [box({ radius: undefined })]);
neutral('box-radius', () => [box({ radius: 20 })]);
neutral('box-thick', () => [box({ width: 20 })]);
neutral('box-white', () => [box({ white: true })]);
neutral('ellipse', () => [ellipse()]);
neutral('ellipse-white', () => [ellipse({ white: true })]);
neutral('circle', () => [circle()]);
neutral('circle-reverse', () => [circle({ reverse: true })]);
neutral('area-reverse', () => [box(), area()]);
neutral('area-clear', () => [box(), area({ mode: 'clear' })]);

// Images
neutral('image', () => [image()]);
neutral('image-odd-width', () => [image({ bitmap: bitmapOf(21, 7, (x, y) => (x * 3 + y) % 4 === 0) })]);
neutral('image-large', () => [image({ bitmap: bitmapOf(200, 120, (x, y) => ((x >> 3) + (y >> 3)) % 2 === 0 || x === y) })]);
neutral('image-blank', () => [image({ bitmap: bitmapOf(32, 8, () => false) })]);
neutral('image-black', () => [image({ bitmap: bitmapOf(32, 8, () => true) })]);
neutral('image-two',() => [image(), image({ y: 250, bitmap: bitmapOf(16, 16, (x, y) => (x + y) % 2 === 0) })]);

// Every kind in one label, in the command order that matters for the areas
neutral('mixed', () => [
  text({ y: 30 }), barcode({ y: 100 }), qr({ x: 500, y: 100 }), dmatrix({ x: 700, y: 100 }), line({ y1: 300, y2: 300 }), box({ x1: 100, y1: 320, x2: 400, y2: 450 }),
  ellipse({ x: 500, y: 320, width: 200, height: 100 }), circle({ x: 750, y: 320, width: 100, height: 100 }), area({ x: 100, y: 500, width: 200, height: 50 }), image({ x: 500, y: 450 }),
]);

// The example labels of js/config.js, as shipped
for (const e of PB.examples) CASES.push({ id: `example-${e.id}`, lang: e.language, text: e.source, fonts: true });

// ---------------------------------------------------------------------------------------------------------------------------
// Comparison of two neutral items

const near = (a, b, tol) => (a == null && b == null) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol + EPS);

/** Font sizes and widths: half a point, or the 5% with which the bitmap fonts are matched (MULTIPLIER_TOLERANCE of the text slices), the larger. */
const fontTolerance = (size, tol) => Math.max(HALF_POINT, tol, size * 0.05);

/** The six digits that identify a UPC-E symbol in any of its spellings (6, 7 or 8 digits with the system and the check digit). */
const upceCore = data => (/^\d{8}$/.test(data) || /^\d{7}$/.test(data) ? data.slice(1, 7) : data);

/** The names of the fields that differ between a source item and the one read back from the converted text. */
function differences(a, b, dot, withFont) {
  const tol = dot + 0.5;
  const out = [];
  const check = (key, ok) => { if (!ok) out.push(key); };
  const eq = (key, x, y) => check(key, JSON.stringify(x) === JSON.stringify(y));
  const pos = (key, x, y) => check(key, near(x, y, tol));
  switch (a.kind) {
    case 'text': {
      // The baseline of a TSPL text follows its character cell, so a substituted font (another size) moves it along the ascent
      {
        const sizeGap = Math.abs(a.font.size - b.font.size);
        const ascent = sizeGap > 1e-6 ? 0.8 * sizeGap + dot : 0; // plus the dot the ascent is rounded to
        const along = a.rotation % 180 === 0;
        check('x', near(a.x, b.x, tol + (along ? 0 : ascent)));
        check('y', near(a.y, b.y, tol + (along ? ascent : 0)));
      }
      eq('rotation', a.rotation, b.rotation); eq('data', a.data, b.data);
      const [fa, fb] = [a.font, b.font];
      check('font.size', near(fa.size, fb.size, fontTolerance(fa.size, tol)));
      check('font.width', near(fa.size * fa.scaleX, fb.size * fb.scaleX, fontTolerance(fa.size * fa.scaleX, tol)));
      if (withFont) eq('font', [fa.family, fa.weight, fa.style], [fb.family, fb.weight, fb.style]);
      eq('attribute', a.attribute && a.attribute.kind, b.attribute && b.attribute.kind);
      eq('align', a.align && a.align.kind, b.align && b.align.kind);
      eq('spacing', !!a.spacing, !!b.spacing);
      eq('bold', !!a.bold, !!b.bold);
      eq('counter', a.counter && a.counter.step, b.counter && b.counter.step);
      eq('zeroSuppress', a.zeroSuppress || 0, b.zeroSuppress || 0);
      eq('reverse', !!a.reverse, !!b.reverse);
      eq('block', !!a.block, !!b.block);
      if (a.block && b.block) {
        pos('block.width', a.block.width, b.block.width); eq('block.lines', a.block.lines, b.block.lines); eq('block.align', a.block.align, b.block.align);
        pos('block.lineSpace', a.block.lineSpace || 0, b.block.lineSpace || 0);
      }
      break;
    }
    case 'barcode': {
      pos('x', a.x, b.x); pos('y', a.y, b.y); pos('height', a.height, b.height); pos('module', a.module, b.module);
      eq('rotation', a.rotation, b.rotation); eq('symbology', a.symbology, b.symbology);
      eq('data', a.symbology === 'upce' ? upceCore(a.data) : a.data, b.symbology === 'upce' ? upceCore(b.data) : b.data);
      eq('humanReadable', !!a.humanReadable, !!b.humanReadable); eq('check', a.check, b.check); eq('addon', a.addon || 0, b.addon || 0);
      eq('guard', !!a.guard, !!b.guard);
      eq('widths', !!a.widths, !!b.widths);
      if (a.widths && b.widths) {
        // The spaces of Industrial 2 of 5 are all narrow: its wide space is not used (TPCL writes 0, ZPL repeats the wide bar)
        for (const k of Object.keys(a.widths)) if (!(a.symbology === 'industrial25' && k === 'wideSpace')) check(`widths.${k}`, near(a.widths[k], b.widths[k], tol));
      }
      eq('counter', a.counter && a.counter.step, b.counter && b.counter.step);
      eq('zeroSuppress', a.zeroSuppress || 0, b.zeroSuppress || 0);
      break;
    }
    case 'qr':
      pos('x', a.x, b.x); pos('y', a.y, b.y); pos('cell', a.cell, b.cell); eq('ecc', a.ecc, b.ecc); eq('data', a.data, b.data);
      break;
    case 'datamatrix':
      pos('x', a.x, b.x); pos('y', a.y, b.y);
      // A symbol that fits an area (TSPL, no module) gets the module the area allows: only a given module is compared
      if (a.cell != null) check('cell', near(a.cell, b.cell, tol));
      // An automatic size (absent) is written with the side the symbol needs: the same symbol, so only a forced size is compared
      if (a.size !== undefined) eq('size', a.size, b.size);
      eq('rotation', a.rotation || 0, b.rotation || 0); eq('data', a.data, b.data); eq('ecc', a.ecc, b.ecc);
      break;
    case 'line': {
      const ends = i => (i.x1 < i.x2 || (i.x1 === i.x2 && i.y1 <= i.y2) ? [i.x1, i.y1, i.x2, i.y2] : [i.x2, i.y2, i.x1, i.y1]);
      // A horizontal or vertical bar is the rectangle it covers (a bar shorter than its thickness is the same rectangle seen from the other axis)
      const cover = i => {
        const [dx, dy] = [Math.abs(i.x2 - i.x1), Math.abs(i.y2 - i.y1)];
        if (i.rect || (dx > tol && dy > tol)) return null;
        const half = i.width / 2;
        const [cx, cy] = [(i.x1 + i.x2) / 2, (i.y1 + i.y2) / 2];
        return dy <= tol ? [Math.min(i.x1, i.x2), cy - half, Math.max(i.x1, i.x2), cy + half] : [cx - half, Math.min(i.y1, i.y2), cx + half, Math.max(i.y1, i.y2)];
      };
      const [ea, eb] = [ends(a), ends(b)];
      const [ca, cb] = [cover(a), cover(b)];
      if (ca && cb) ['x1', 'y1', 'x2', 'y2'].forEach((k, n) => pos(k, ca[n], cb[n]));
      else {
        ['x1', 'y1', 'x2', 'y2'].forEach((k, n) => pos(k, ea[n], eb[n]));
        pos('width', a.width, b.width);
      }
      eq('rect', !!a.rect, !!b.rect);
      check('radius', near(a.radius || 0, b.radius || 0, tol));
      eq('white', !!a.white, !!b.white); eq('reverse', !!a.reverse, !!b.reverse);
      break;
    }
    case 'ellipse':
      pos('x', a.x, b.x); pos('y', a.y, b.y); pos('width', a.width, b.width); pos('height', a.height, b.height); pos('thickness', a.thickness, b.thickness);
      eq('circle', a.ref === 'CIRCLE', b.ref === 'CIRCLE'); eq('white', !!a.white, !!b.white); eq('reverse', !!a.reverse, !!b.reverse);
      break;
    case 'area':
      eq('mode', a.mode, b.mode); pos('x', a.x, b.x); pos('y', a.y, b.y); pos('width', a.width, b.width); pos('height', a.height, b.height);
      break;
    case 'image': {
      pos('x', a.x, b.x); pos('y', a.y, b.y);
      const [p, q] = [a.bitmap, b.bitmap];
      eq('bitmap.h', p.h, q.h);
      // TSPL and TPCL rows are whole bytes: the extra columns of a bitmap that is not a multiple of 8 wide are white
      let same = q.w >= p.w && q.w - p.w < 8;
      for (let y = 0; same && y < p.h; y++) {
        for (let x = 0; x < q.w; x++) if ((x < p.w ? p.data[y * p.w + x] : 0) !== q.data[y * q.w + x]) { same = false; break; }
      }
      check('bitmap', same);
      break;
    }
    default: out.push(`unexpected kind ${a.kind}`);
  }
  return out;
}

/** Matches the items of the source with those read back, in order: an item without a partner of its kind next in line was left out. */
function align(from, to) {
  const pairs = [];
  const skipped = [];
  const key = i => (i.kind === 'barcode' ? `barcode ${i.symbology}` : i.kind);
  let j = 0;
  for (const a of from) {
    if (j < to.length && key(to[j]) === key(a)) pairs.push([a, to[j++]]);
    else skipped.push(a.kind);
  }
  return { pairs, skipped, extra: to.length - j };
}

/** What a conversion did: the kinds left out and the fields that differ in the others. */
function classify(A, B, dpi, withFont) {
  const { pairs, skipped, extra } = align(A.items, B.items);
  const keys = new Set();
  for (const [a, b] of pairs) differences(a, b, dotOf(dpi), withFont).forEach(k => keys.add(k));
  if (extra) keys.add('extra items');
  return { skipped, keys: [...keys].sort() };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Running a case

/** Source text of a case in a language, or null when the case has no text in that language. */
function sourceText(c, lang, dpi) {
  if (c.bodies) return c.bodies[lang] ? HEADERS[lang](dpi) + c.bodies[lang](dpi) + TRAILERS[lang](dpi) : null;
  if (c.text) return c.lang === lang ? c.text : null;
  return PB.languages.emit(lang, labelOf(c.items(dpi)), { dpi }).text;
}

/** The source model of a case in a language (null when the language cannot hold anything of it) and its text. */
function sourceOf(c, lang, dpi) {
  const src = sourceText(c, lang, dpi);
  if (src == null) return null;
  const A = parser(lang).parse(src, { dpi });
  return A.items.length ? { src, A } : null;
}

function convertCase(c, from, to, dpi) {
  const source = sourceOf(c, from, dpi);
  if (!source) return null;
  const result = PB.convert.run(source.src, to, { dpi });
  const B = parser(to).parse(result.text, { dpi });
  return { ...source, B, result, ...classify(source.A, B, dpi, c.fonts) };
}

const sourcesOf = c => LANGS.filter(l => sourceOf(c, l, DPIS[0]));

// ---------------------------------------------------------------------------------------------------------------------------
// RULES: the expected result of a feature in a pair; whatever no rule names is exact.
//   deg(must, diag, may): the item survives; every field in `must` differs at some dpi, no field outside must + may differs, and one
//       diagnostic (warning or info) matches `diag`
//   skip(kinds, diag): exactly these items are left out and one diagnostic matches `diag`

const [T2S, T2Z, S2T, S2Z, Z2T, Z2S] = PAIRS;
const deg = (must, diag, may = []) => ({ must, may, skipped: [], diag });
const skip = (skipped, diag) => ({ must: [], may: [], skipped, diag });
/** Exact, but the loss of something that is not an item (the label orientation) must be reported. */
const note = diag => ({ must: [], may: [], skipped: [], diag, note: true });
/** Both at once: items left out and fields that change in the others (diag: one regex or a list, each must match a diagnostic). */
const both = (skipped, must, diag) => ({ must, may: [], skipped, diag });

const FONTS = /Las fuentes (TPCL|TSPL|ZPL) no coinciden|redondea a puntos enteros|PV\) con ancho o alto fuera de 0020\.\.0850/;
const NO_CHECK = /dígito de control/;
const ADDON = /complemento/;
const ZERO_TSPL = /ceros suprimidos/;
const ZERO_ZPL = /supresión de ceros/;
const ELLIPSE_TPCL = /elipses y círculos no se escriben en TPCL/;
const REVERSE = /impresión inversa/;
const WHITE = /en blanco/;
const TPCL_BLOCK = /cuya fuente solo se escribe vectorial \(PV\)/;
const TPCL_BLOCK_ALIGN = /el salto de línea automático de TPCL \(P5\) no tiene alineación/;
const TPCL_BLOCK_RANGE = /fuera de los rangos de TPCL/;

const RULES = [
  // ---- text
  [/^text-(reverse|box|strike)-attribute$/, [T2S, T2Z], deg(['attribute'], /Hay textos con atributo/)],
  [/^text-align-/, [T2S, T2Z], deg(['align'], /Hay textos con alineación/)],
  [/^text-spacing$/, [T2S, T2Z], deg(['spacing'], /espaciado entre caracteres/)],
  [/^text-bold-overprint$/, [T2S, T2Z], deg(['bold'], /negrita/)],
  [/^text-counter-zero-suppress$/, [T2S, Z2S], deg(['zeroSuppress'], ZERO_TSPL)],
  [/^text-counter-zero-suppress$/, [T2Z], deg(['zeroSuppress'], ZERO_ZPL)],
  [/^text-zpl-reverse$/, [Z2T, Z2S], deg(['reverse'], REVERSE)],
  // The ZPL and TSPL font 0 of the neutral sans 100 is an outline (PV) font in TPCL (no block): the TSPL one (28 pt) was H at 2.8 when the PC
  // magnification took any tenth, but the printer only accepts 0.5 steps from 1 (2.5 or 3.0), which do not reproduce the size
  [/^text-block-breaks$/, [Z2T, S2T], deg(['block', 'data'], TPCL_BLOCK)],
  [/^text-block(?!-bitmap)/, [Z2T], deg(['block'], TPCL_BLOCK)],
  [/^text-block(?!-bitmap|-mono)/, [S2T], deg(['block'], TPCL_BLOCK)],
  // mono 100 is an outline font at 203 dpi but a PC font at 300 dpi
  [/^text-block-mono$/, [S2T], deg(['block'], /cuya fuente solo se escribe vectorial \(PV\)|fuera de los rangos de TPCL/, ['block.lineSpace'])],
  // The breaks of the data become spaces in TPCL (its data has none), and the TPCL block has no alignment
  [/^text-block-bitmap-(center|right)$/, [S2T, Z2T], deg(['block.align'], TPCL_BLOCK_ALIGN)],
  [/^text-block-bitmap-justify$/, [Z2T], deg(['block.align'], TPCL_BLOCK_ALIGN)],
  [/^text-block-bitmap-breaks$/, [S2T, Z2T], deg(['data'], /./)],
  [/^text-block-bitmap-no-space$/, [S2T, Z2T], deg(['block.lineSpace'], TPCL_BLOCK_RANGE)],
  [/^text-block(-bitmap)?-justify$/, [Z2S], deg(['block.align'], /bloques de texto justificados/)],
  // ---- fonts: always the nearest built-in font of the target, reported; the sizes and the geometry stay
  [/^fonts-/, PAIRS, deg([], FONTS, ['font', 'font.size', 'font.width'])],
  // ---- barcodes
  [/^barcode-code93(-check)?$/, [T2S, T2Z], deg(['check'], NO_CHECK)],
  [/^barcode-itf-check$/, [Z2T, Z2S], deg(['check'], NO_CHECK)],
  [/^barcode-ean13-no-check$/, [T2S, T2Z], deg(['check'], NO_CHECK)],
  [/^barcode-industrial25-auto$/, [T2Z], deg(['check'], NO_CHECK)],
  [/^barcode-(msi|industrial25)(-[a-z0-9]+)?$/, [T2S, Z2S], skip(['barcode'], /sin equivalente en TSPL/)],
  [/^barcode-msi-check$/, [T2Z], deg(['check'], NO_CHECK)],
  [/^barcode-ean13-addon[25]$/, [T2Z, S2Z], deg(['addon', 'data'], ADDON)],
  [/^barcode-ean13-guard$/, [T2S, T2Z], deg(['guard'], /barra de guarda/)],
  [/^barcode-counter-zero-suppress$/, [T2S, Z2S], deg(['zeroSuppress'], ZERO_TSPL)],
  [/^barcode-counter-zero-suppress$/, [T2Z], deg(['zeroSuppress'], ZERO_ZPL)],
  [/^barcodes-tspl-25c$/, [S2T, S2Z], deg(['check'], NO_CHECK)],
  [/^barcodes-tspl-types$/, [S2Z], deg(['addon', 'data'], ADDON)],
  [/^barcodes-tspl-unknown$/, [S2T], skip(['barcode', 'barcode'], /sin equivalente en TPCL/)],
  [/^barcodes-tspl-unknown$/, [S2Z], skip(['barcode', 'barcode'], /sin equivalente en ZPL/)],
  [/^barcodes-zpl-variants$/, [Z2T], deg(['check'], NO_CHECK)],
  [/^barcodes-zpl-variants$/, [Z2S], both(['barcode'], ['check'], [/sin equivalente en TSPL/, NO_CHECK])],
  [/^label-rotated-180$/, [S2T, S2Z, Z2T, Z2S], note(/girada 180°/)],
  // ---- 2D
  [/^qr-zpl-variants$/, [Z2S], deg(['rotation'], /Data Matrix con rotación/)],
  [/^datamatrix-rotation-/, [T2S, Z2S], deg(['rotation'], /Data Matrix con rotación/)],
  // ---- shapes
  [/^line-diagonal$/, [T2S, Z2S], skip(['line'], /líneas diagonales/)],
  [/^line-empty$/, [T2S, T2Z], skip(['line'], /longitud 0/)],
  [/^box-radius$/, [T2Z, S2Z], deg(['radius'], /redondeo/)],
  [/^box-white$/, [Z2T, Z2S], deg(['white'], WHITE)],
  [/^ellipse-white$/, [Z2S], deg(['white'], WHITE)],
  [/^circle-reverse$/, [Z2S], deg(['reverse'], REVERSE)],
  [/^(ellipse|circle)(-white|-reverse)?$/, [S2T, Z2T], skip(['ellipse'], ELLIPSE_TPCL)],
  [/^mixed$/, [S2T, Z2T], skip(['ellipse', 'ellipse'], ELLIPSE_TPCL)],
  // ---- the example labels
  [/^example-(spool-99x55|barcodes-code39-itf-code128)$/, [T2S], deg(['font'], FONTS)],
  [/^example-tspl-label-100x60$/, [S2T, S2Z], deg(['font'], FONTS, ['font.size', 'font.width'])], // a 1.5 mm text is outline (PV) 2 mm in TPCL (0020 minimum)
  // The templates (same label in three languages): the title and lines change font family when the language has no equivalent
  [/^example-template-tpcl$/, [T2S, T2Z], deg(['font'], FONTS)],
  [/^example-template-tspl$/, [S2T, S2Z], deg(['font'], FONTS)],
  [/^example-template-zpl$/, [Z2S], deg(['font'], FONTS, ['font.width'])],
  [/^example-zpl-label-100x60$/, [Z2T], deg(['font', 'reverse'], FONTS, ['font.size', 'font.width'])],
  [/^example-zpl-label-100x60$/, [Z2S], deg(['font', 'reverse'], FONTS, ['font.width'])],
];

const ruleFor = (id, pair) => RULES.findIndex(([re, pairs]) => re.test(id) && pairs.includes(pair));
const expectationOf = (id, pair) => { const at = ruleFor(id, pair); return at < 0 ? null : RULES[at][2]; };

// ---------------------------------------------------------------------------------------------------------------------------
// The matrix: one test per case and pair, at both resolutions

const textsOf = diagnostics => diagnostics.filter(d => d.level === 'warning' || d.level === 'info').map(d => d.text);

for (const c of CASES) {
  for (const pair of PAIRS) {
    const [from, to] = pair.split('>');
    if (!sourceOf(c, from, DPIS[0])) continue;
    test(`${c.id}: ${from} -> ${to}`, () => {
      const expected = expectationOf(c.id, pair);
      const union = new Set();
      for (const dpi of DPIS) {
        const r = convertCase(c, from, to, dpi);
        const at = `${c.id} ${pair} at ${dpi} dpi`;
        assert.deepEqual(levels(r.B.diagnostics, 'error'), [], `${at}: the target parser reads the output without errors`);
        assert.deepEqual(r.skipped, expected ? expected.skipped : [], `${at}: items left out`);
        r.keys.forEach(k => union.add(k));
        const allowed = expected ? [...expected.must, ...expected.may] : [];
        assert.deepEqual(r.keys.filter(k => !allowed.includes(k)), [], `${at}: fields that differ and are not documented`);
        if (r.keys.length || r.skipped.length || (expected && expected.note)) {
          for (const re of [].concat(expected.diag)) {
            assert.ok(textsOf(r.result.diagnostics).some(t => re.test(t)), `${at}: a diagnostic matching ${re} (got ${JSON.stringify(textsOf(r.result.diagnostics))})`);
          }
        }
      }
      if (expected) for (const key of expected.must) assert.ok(union.has(key), `${c.id} ${pair}: the documented loss "${key}" no longer happens: update RULES`);
    });
  }
}

test('every rule of the table describes a conversion that exists', () => {
  RULES.forEach(([re, pairs], at) => {
    const hit = pairs.some(pair => CASES.some(c => re.test(c.id) && sourceOf(c, pair.split('>')[0], DPIS[0])));
    assert.ok(hit, `rule ${at} (${re}) matches no case`);
  });
});

test('each case is written in the languages that can hold it, and only in those', () => {
  const only = {
    'barcode-msi': ['tpcl', 'zpl'], 'barcode-industrial25': ['tpcl', 'zpl'], 'line-diagonal': ['tpcl', 'zpl'], 'line-empty': ['tpcl'],
    ellipse: ['tspl', 'zpl'], 'ellipse-white': ['tspl', 'zpl'], circle: ['tspl', 'zpl'], 'circle-reverse': ['tspl', 'zpl'],
  };
  for (const c of CASES) {
    if (c.bodies || c.text) continue;
    const key = c.id.replace(/-(check|auto|mod1010|mod1110)$/, '');
    assert.deepEqual(sourcesOf(c), only[key] || LANGS, c.id);
  }
});

test('the cases cover every component kind in every language pair with at least one exact conversion', () => {
  const KINDS = ['area', 'barcode', 'datamatrix', 'ellipse', 'image', 'line', 'qr', 'text'];
  assert.ok(KINDS.every(k => PB.components.kinds().includes(k)));
  for (const pair of PAIRS) {
    const [from, to] = pair.split('>');
    const exact = new Set();
    for (const c of CASES) {
      if (c.fonts || expectationOf(c.id, pair)) continue;
      const source = sourceOf(c, from, DPIS[0]);
      if (source) source.A.items.forEach(i => exact.add(i.kind));
    }
    for (const kind of KINDS) {
      if (kind === 'ellipse' && (from === 'tpcl' || to === 'tpcl')) continue;
      assert.ok(exact.has(kind), `${pair}: no exact ${kind}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Round trips: every language reads back what it writes (parse -> emit -> parse), fonts included

for (const c of CASES) {
  for (const lang of LANGS) {
    if (!sourceOf(c, lang, DPIS[0])) continue;
    test(`${c.id}: ${lang} round-trips to itself`, () => {
      for (const dpi of DPIS) {
        const { A } = sourceOf(c, lang, dpi);
        const out = PB.languages.emit(lang, A, { dpi });
        const A2 = parser(lang).parse(out.text, { dpi });
        assert.deepEqual(levels(A2.diagnostics, 'error'), []);
        // An item the language cannot write (a TSPL barcode type with no neutral symbology) is left out with a warning, in its own language too
        const { pairs, skipped, extra } = align(A.items, A2.items);
        const documented = (c.roundTripSkips && c.roundTripSkips[lang]) || [];
        assert.deepEqual([skipped, extra], [documented, 0], `${c.id} ${lang} at ${dpi}: items left out`);
        if (documented.length) assert.ok(levels(out.diagnostics, 'warning').length > 0, 'and reported');
        const allowed = (c.roundTripKeys && c.roundTripKeys[lang]) || [];
        pairs.forEach(([a, b], n) => assert.deepEqual(differences(a, b, dotOf(dpi), true).filter(k => !allowed.includes(k)), [], `${c.id} ${lang} at ${dpi}: item ${n}`));
        if (allowed.length) assert.ok(levels(out.diagnostics, 'warning').length > 0, 'and reported');
        assert.equal(PB.languages.emit(lang, A2, { dpi }).text, out.text, `${c.id} ${lang} at ${dpi}: the second emit is identical`);
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Chains A -> B -> C -> A, in both orders: what is exact in every hop comes back as it left

for (const c of CASES) {
  for (const from of LANGS) {
    if (!sourceOf(c, from, DPIS[0])) continue;
    const others = LANGS.filter(l => l !== from);
    for (const order of [others, [...others].reverse()]) {
      test(`${c.id}: ${[from, ...order, from].join(' -> ')} is stable`, () => {
        for (const dpi of DPIS) {
          const { src, A } = sourceOf(c, from, dpi);
          let [text, prev, current] = [src, A, from];
          let faithful = true;
          let fontChanged = false;
          for (const to of [...order, from]) {
            const result = PB.convert.run(text, to, { dpi, sourceId: current });
            const model = parser(to).parse(result.text, { dpi });
            assert.deepEqual(levels(model.diagnostics, 'error'), []);
            const hop = classify(prev, model, dpi, true);
            // A fully faithful hop keeps every field; a font that changes only moves the sizes by the rounding of the built-in fonts
            fontChanged = fontChanged || hop.keys.includes('font');
            if (hop.skipped.length || hop.keys.some(k => k !== 'font' && !(fontChanged && k.startsWith('font.')))) faithful = false;
            [text, prev, current] = [result.text, model, to];
          }
          if (!faithful) continue;
          const back = classify(A, prev, dpi, false);
          const loose = back.keys.filter(k => !(fontChanged && k.startsWith('font.')));
          assert.deepEqual([back.skipped, loose], [[], []], `${c.id} ${[from, ...order, from].join('>')} at ${dpi}`);
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The label size

const SIZES = [[1000, 600, 630, 30], [990, 550, 610, 60], [1000, 1500, 1530, 30], [400, 300, 330, 30], [800, 500, null, null], [254, 127, null, null]];

for (const dpi of DPIS) {
  for (const [w, h, pitch, gap] of SIZES) {
    for (const pair of PAIRS) {
      const [from, to] = pair.split('>');
      test(`label ${w / 10} x ${h / 10} mm ${from} -> ${to} at ${dpi} dpi keeps the size within one dot`, () => {
        const model = { language: 'neutral', size: { width: w, height: h, pitch, gap, native: {} }, items: [line()], diagnostics: [] };
        const src = PB.languages.emit(from, model, { dpi }).text;
        const A = parser(from).parse(src, { dpi });
        const result = PB.convert.run(src, to, { dpi });
        const B = parser(to).parse(result.text, { dpi });
        near(A.size.width, B.size.width, dotOf(dpi) + 0.5) || assert.fail(`width ${A.size.width} -> ${B.size.width}`);
        near(A.size.height, B.size.height, dotOf(dpi) + 0.5) || assert.fail(`height ${A.size.height} -> ${B.size.height}`);
        // Only what the target has is written: ZPL has neither pitch nor gap, TPCL has the pitch, TSPL the gap
        if (to === 'zpl') assert.deepEqual([B.size.pitch, B.size.gap], [null, null]);
        // pitch = height + gap: TPCL <-> TSPL carry it (within the 0.1 mm rounding), the target reads back both forms
        if (from !== 'zpl' && to !== 'zpl' && A.size.gap != null) {
          near(A.size.pitch, B.size.pitch, 1) || assert.fail(`pitch ${A.size.pitch} -> ${B.size.pitch}`);
          near(A.size.gap, B.size.gap, 1) || assert.fail(`gap ${A.size.gap} -> ${B.size.gap}`);
          assert.equal(result.diagnostics.filter(d => /paso de etiqueta|No se escribe GAP/.test(d.text)).length, 0, 'no word about the pitch / gap');
        }
        // Nothing is lost without a word: the pitch or the gap of the source is reported once when the target cannot take it
        const lossInfos = result.diagnostics.filter(d => /paso de etiqueta|GAP/.test(d.text));
        if (to === 'zpl' && (A.size.pitch != null || A.size.gap != null)) assert.equal(result.diagnostics.filter(d => /ZPL solo declara el ancho y el largo/.test(d.text)).length, 1, 'ZPL: one info for the pitch / gap');
        if (to === 'tpcl' && A.size.pitch == null) assert.equal(lossInfos.filter(d => /paso de etiqueta/.test(d.text)).length, 1, 'TPCL: the default pitch is reported');
        if (to === 'tspl' && A.size.gap == null) assert.equal(lossInfos.filter(d => /No se escribe GAP/.test(d.text)).length, 1, 'TSPL: the missing GAP is reported');
        if (from === 'zpl') assert.ok(!result.diagnostics.some(d => /ZPL solo declara/.test(d.text)));
      });
    }
  }
}

test('ZPL -> TPCL writes the height as the pitch and ZPL -> TSPL writes no GAP, both with the existing info', () => {
  const zpl = '^XA\r\n^PW799\r\n^LL480\r\n^FO30,30^A0N,30,30^FDHola^FS\r\n^XZ\r\n';
  const toTpcl = PB.convert.run(zpl, 'tpcl', { dpi: 203 });
  assert.match(toTpcl.text, /^\{D0601,1000,0601\|\}/);
  assert.ok(toTpcl.diagnostics.some(d => d.level === 'info' && /paso de etiqueta \(pitch\) no está especificado/.test(d.text)));
  const toTspl = PB.convert.run(zpl, 'tspl', { dpi: 203 });
  assert.ok(!/^GAP/m.test(toTspl.text));
  assert.ok(toTspl.diagnostics.some(d => d.level === 'info' && /No se escribe GAP/.test(d.text)));
});

test('TPCL -> ZPL and TSPL -> ZPL report once that the pitch / the gap cannot be written (^PW and ^LL only)', () => {
  for (const [id, label] of [['spool-99x55', 'paso'], ['tspl-label-100x60', 'GAP']]) {
    const example = PB.examples.find(e => e.id === id);
    const result = PB.convert.run(example.source, 'zpl', { dpi: 203 });
    const notes = result.diagnostics.filter(d => /ZPL solo declara el ancho y el largo/.test(d.text));
    assert.equal(notes.length, 1, id);
    assert.equal(notes[0].level, 'info');
    assert.match(notes[0].text, new RegExp(label === 'GAP' ? 'GAP' : 'paso de etiqueta'));
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Specific defects the matrix exposed

test('a ZPL field reverse print (^FR) that TPCL and TSPL cannot write is reported, never dropped silently', () => {
  const zpl = '^XA\r\n^PW799\r\n^LL480\r\n^FO30,30^A0N,30,30^FR^FDINVERTIDO^FS\r\n^XZ\r\n';
  for (const target of ['tpcl', 'tspl']) {
    const result = PB.convert.run(zpl, target, { dpi: 203 });
    assert.equal(result.diagnostics.filter(d => REVERSE.test(d.text)).length, 1, target);
    assert.ok(result.diagnostics.some(d => REVERSE.test(d.text) && d.level === 'warning'), `${target}: a warning`);
  }
  assert.equal(PB.convert.run(zpl, 'zpl', { dpi: 203 }).diagnostics.filter(d => REVERSE.test(d.text)).length, 0, 'ZPL keeps it');
});

test('a label printed rotated 180 degrees (TSPL DIRECTION 0, ZPL ^POI) keeps it in its own language and reports it in the others', () => {
  const tspl = 'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 0\r\nCLS\r\nTEXT 40,100,"3",0,1,1,"Rotated"\r\nPRINT 1,1\r\n';
  const zpl = '^XA\r\n^PW799\r\n^LL480\r\n^POI\r\n^FO40,100^A0N,30,30^FDRotated^FS\r\n^XZ\r\n';
  const again = PB.convert.run(tspl, 'tspl', { dpi: 203 });
  assert.match(again.text, /^DIRECTION 0$/m);
  assert.equal(again.diagnostics.filter(d => /girada 180°/.test(d.text)).length, 0);
  const sameZpl = PB.convert.run(zpl, 'zpl', { dpi: 203 });
  assert.match(sameZpl.text, /^\^POI$/m);
  assert.equal(sameZpl.diagnostics.filter(d => /girada 180°/.test(d.text)).length, 0);
  for (const [source, targets] of [[tspl, ['tpcl', 'zpl']], [zpl, ['tpcl', 'tspl']]]) {
    for (const target of targets) {
      const result = PB.convert.run(source, target, { dpi: 203 });
      assert.equal(result.diagnostics.filter(d => /girada 180°/.test(d.text)).length, 1, target);
      assert.ok(!/DIRECTION 0|\^POI/.test(result.text), `${target}: the rotation is not written`);
    }
  }
  // an upright label says nothing
  assert.equal(PB.convert.run(tspl.replace('DIRECTION 0', 'DIRECTION 1'), 'zpl', { dpi: 203 }).diagnostics.filter(d => /girada 180°/.test(d.text)).length, 0);
});

test('the info about the zero suppression TSPL cannot write does not name TPCL', () => {
  const result = PB.convert.run('{D0610,0990,0550|}\n{PC001;0100,0100,06,06,J,00,B,+0000000001,Z03|}\n{RC001;0001|}\n{XS;I,0001,0002C4100|}', 'tspl', { dpi: 203 });
  const notes = result.diagnostics.filter(d => /ceros suprimidos/.test(d.text));
  assert.equal(notes.length, 1);
  assert.ok(!/TPCL/.test(notes[0].text), notes[0].text);
});

test('TPCL counter steps beyond the 10 digits of the manual are clamped with one warning (text and barcode)', () => {
  const zpl = ['^XA', '^PW799', '^LL480', '^FO30,30^A0N,30,30^SN0001,99999999999,Y^FS', '^FO30,90^BCN,50,Y,N,N^SN0001,123456789012,Y^FS', '^FO30,160^A0N,30,30^SN0001,-99999999999,Y^FS', '^XZ'].join('\r\n');
  const result = PB.convert.run(zpl, 'tpcl', { dpi: 203 });
  const warnings = levels(result.diagnostics, 'warning').filter(d => /incremento/i.test(d.text));
  assert.equal(warnings.length, 1, JSON.stringify(result.diagnostics.map(d => d.text)));
  assert.match(warnings[0].text, /9999999999/);
  const back = parser('tpcl').parse(result.text, { dpi: 203 });
  assert.deepEqual(back.items.map(i => i.counter.step), [9999999999, 9999999999, -9999999999]);
  // a step inside the range says nothing
  const fine = PB.convert.run('^XA^PW799^LL480^FO30,30^A0N,30,30^SN0001,5,Y^FS^XZ', 'tpcl', { dpi: 203 });
  assert.equal(levels(fine.diagnostics, 'warning').length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Text origin
// The three languages place a text differently: TPCL writes the origin of the text, ZPL ^FO is the top-left of the field and ^FT the
// baseline, and TSPL TEXT is the top-left of the character cell (TSC manual). The neutral model keeps one meaning (the baseline origin),
// so the TSPL reader adds the ascent (80% of the character height, not verified on a printer) and the TSPL writer takes it off again.

test('text origin: a TSPL TEXT y is a top edge: the ZPL ^FT baseline is the ascent below it and the way back lands on the same y', () => {
  const tspl = 'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nTEXT 40,100,"0",0,12,12,"Origin"\r\nPRINT 1,1\r\n';
  const result = PB.convert.run(tspl, 'zpl', { dpi: 203 });
  const baseline = Number(/\^FT40,(\d+)\^A0N,/.exec(result.text)[1]);
  assert.ok(baseline > 100 + 20, `the ^FT baseline (${baseline}) is below the TSPL top edge`);
  const back = PB.convert.run(result.text, 'tspl', { dpi: 203 });
  assert.match(back.text, /TEXT 40,100,"0",0,/);
});

// Font 0 baseline: ZPL uses 3/4 of the height (Volume Two, Table 10) and the TSPL scalable font takes the same share, so the top edge of a
// ZPL font 0 text survives a ZPL -> TSPL conversion exactly.
test('text origin: a ZPL ^FO text keeps its top edge in TSPL', () => {
  const zpl = '^XA\r\n^PW799\r\n^LL480\r\n^FO40,100^A0N,40,40^FDOrigin^FS\r\n^XZ\r\n';
  const model = parser('zpl').parse(zpl, { dpi: 203 });
  assert.ok(model.items[0].y > 100 * dotOf(203), 'the neutral baseline is below the ^FO top edge');
  const tspl = PB.convert.run(zpl, 'tspl', { dpi: 203 });
  assert.match(tspl.text, /TEXT 40,100,/);
});

test('text origin: a rotated TSPL text has its baseline on the side the letters stand to', () => {
  for (const [rotation, side] of [[0, 'y+'], [90, 'x-'], [180, 'y-'], [270, 'x+']]) {
    const tspl = `SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nTEXT 400,300,"3",${rotation},1,1,"A"\r\nPRINT 1,1\r\n`;
    const item = parser('tspl').parse(tspl, { dpi: 203 }).items[0];
    const [dx, dy] = [item.x - 400 * dotOf(203), item.y - 300 * dotOf(203)];
    const moved = { 'y+': dy > 0 && Math.abs(dx) < 1e-6, 'y-': dy < 0 && Math.abs(dx) < 1e-6, 'x+': dx > 0 && Math.abs(dy) < 1e-6, 'x-': dx < 0 && Math.abs(dy) < 1e-6 };
    assert.ok(moved[side], `rotation ${rotation}: baseline moves ${side} (dx ${dx}, dy ${dy})`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// The table itself

test('no rule of the table is dead: each one is applied to at least one conversion', () => {
  const used = new Set();
  for (const c of CASES) for (const pair of PAIRS) if (ruleFor(c.id, pair) >= 0 && sourceOf(c, pair.split('>')[0], DPIS[0])) used.add(ruleFor(c.id, pair));
  for (let at = 0; at < RULES.length; at++) assert.ok(used.has(at), `rule ${at} (${RULES[at][0]}) is shadowed by an earlier rule or matches no conversion`);
});
