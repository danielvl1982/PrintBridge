const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// V13: conversions land valid in the target language.
//
// A conversion is parse(source) -> neutral model -> emit(target). For every ordered pair among TPCL, TSPL and ZPL and every component kind, the source
// label is written by the SOURCE emitter from a neutral item with EXTREME values (huge, tiny, negative, fractional, long data, characters the target
// forbids, symbologies the target lacks, odd rotations, counters). The source emitter limits each value to what its own language accepts, so the text is a
// valid label at the edge of the source's range, which is what a user converts. The text goes through PB.convert.run and the result is checked:
//   1. the target text is read back by the target's own parser, which reports NO warning or error (the converter never writes what the app itself would
//      flag as invalid: every range check of V1..V12 lives in that parser) - except the data validity warnings of a barcode the source already carried
//      (the data is copied as it is, and the emit reports it);
//   2. the diagnostics of the conversion hold no repeated text (an adjustment is reported once);
//   3. a value the target cannot hold is adjusted AND reported: a case names the warning each target must give (`reports`).
const PB = loadUpTo('js/ui.js');

const LANGS = ['tpcl', 'tspl', 'zpl'];
const PAIRS = LANGS.flatMap(from => LANGS.filter(to => to !== from).map(to => [from, to]));
const DPIS = [203, 300];
const SIZE = Object.freeze({ width: 1000, height: 600, pitch: 630, gap: 30 });
const labelOf = items => ({ language: 'neutral', size: { ...SIZE, native: {} }, items, diagnostics: [] });
const bitmapOf = (w, h, fn = () => true) => ({ w, h, data: Uint8Array.from({ length: w * h }, (_, i) => (fn(i % w, Math.floor(i / w)) ? 1 : 0)) });

const font = (size = 100, o = {}) => ({ size, scaleX: 1, family: 'sans', weight: 400, style: 'normal', ...o });
const text = (o = {}) => ({ kind: 'text', x: 100, y: 200, rotation: 0, font: font(), data: 'Hello', ...o });
const barcode = (o = {}) => ({ kind: 'barcode', x: 100, y: 200, rotation: 0, module: 2.5, height: 80, humanReadable: true, symbology: 'code128', data: 'ABC123', ...o });
const qr = (o = {}) => ({ kind: 'qr', x: 100, y: 200, ecc: 'M', cell: 5, symbology: 'qr', data: 'https://example.com/1', ...o });
const dmatrix = (o = {}) => ({ kind: 'datamatrix', x: 100, y: 200, rotation: 0, cell: 5, ecc: 200, symbology: 'datamatrix', data: 'DM12345', ...o });
const line = (o = {}) => ({ kind: 'line', x1: 100, y1: 100, x2: 500, y2: 100, rect: false, width: 5, ...o });
const box = (o = {}) => line({ x1: 100, y1: 100, x2: 500, y2: 300, rect: true, width: 5, ...o });
const ellipse = (o = {}) => ({ kind: 'ellipse', ref: 'ELLIPSE', x: 100, y: 100, width: 400, height: 200, thickness: 5, ...o });
const circle = (o = {}) => ellipse({ ref: 'CIRCLE', width: 300, height: 300, ...o });
const area = (o = {}) => ({ kind: 'area', mode: 'reverse', x: 100, y: 100, width: 300, height: 200, ...o });
const image = (o = {}) => ({ kind: 'image', x: 100, y: 100, width: 0, height: 0, bitmap: bitmapOf(24, 10, (x, y) => (x + 2 * y) % 5 === 0), data: null, ...o });

const CASES = [];
/** reports = { target: regexp of the warning that target must give }; allow = regexp of the parse warnings of the target a case may keep (the emit reported them). */
const add = (id, items, { reports = {}, allow = null } = {}) => CASES.push({ id, items, reports, allow });

// Text lines -----------------------------------------------------------------------------------------------------------------------------------------
add('text-huge-size', [text({ font: font(100000) })]);
add('text-tiny-size', [text({ font: font(0.4) })]);
add('text-very-wide', [text({ font: font(100, { scaleX: 80 }) })]);
add('text-very-narrow', [text({ font: font(100, { scaleX: 0.01 }) })]);
add('text-mono-huge', [text({ font: font(60000, { family: 'mono' }) })]);
add('text-serif-bold-italic', [text({ font: font(5, { family: 'serif', weight: 700, style: 'italic' }) })]);
add('text-negative-position', [text({ x: -500, y: -200 })]);
add('text-far-position', [text({ x: 99999, y: 99999 })]);
add('text-fractional-position', [text({ x: 100.37, y: 200.62, font: font(33.3) })]);
for (const rotation of [45, 90, 135, 180, 270, 315, -90, 720]) add(`text-rotation-${rotation}`, [text({ rotation })]);
add('text-long-data', [text({ data: 'x'.repeat(4000) })]);
add('text-forbidden-characters', [text({ data: 'a{b}c|d^e~f"g\\h,i;j=k' })]);
add('text-accents-and-symbols', [text({ data: 'Ñandú café 5€ ©' })]);
add('text-variables', [text({ data: 'Lot #LOT# of #TOTAL# and @1 and %x%' })]);
add('text-counter-huge-step', [text({ data: '0001', counter: { step: 99999999999999 } })]);
add('text-counter-negative-step', [text({ data: '0100', counter: { step: -99999999999999 } })]);
add('text-counter-zero-suppress', [text({ data: '0001', counter: { step: 1 }, zeroSuppress: 99 })]);
add('text-counters-many', Array.from({ length: 60 }, (_, i) => text({ x: 10, y: 10 + i * 5, data: String(i + 1).padStart(4, '0'), counter: { step: 1 } })));
// TPCL numbers its fields 00..99 (PV) and 00..31 (bar codes): the emit warns once and the parse repeats it (kept as is, see Open of V13)
add('text-many-items', Array.from({ length: 130 }, (_, i) => text({ x: 10, y: 10 + i * 4, data: `L${i}` })), { reports: { tpcl: /más de 100 textos/ }, allow: /número de campo/ });
add('text-spacing-extreme', [text({ spacing: { value: 99999 } })]);
add('text-bold-extreme', [text({ bold: { h: 999, v: 999, native: { h: 99, v: 99 } } })]);
add('text-attribute-extreme', [text({ attribute: { kind: 'reverse', h: 99999, v: 99999, defaultDots: 6 } }), text({ y: 400, attribute: { kind: 'box', h: 0.1, v: 0.1, defaultDots: 6 } })]);
add('text-align-extreme', [text({ align: { kind: 'equal', width: 99999 } }), text({ y: 400, align: { kind: 'equal', width: 1 } }), text({ y: 500, align: { kind: 'center' } })]);
add('text-reverse-zpl', [text({ reverse: true })]);
const block = (o = {}) => ({ width: 300, lines: 4, align: 'left', lineSpace: 0, ...o });
add('block-huge-width', [text({ data: 'Hello world, this is a block of text', block: block({ width: 900000 }) })]);
add('block-tiny-width', [text({ data: 'Hello world, this is a block of text', block: block({ width: 0.4 }) })]);
add('block-huge-lines', [text({ data: 'Hello world, this is a block of text', block: block({ lines: 999999 }) })]);
add('block-line-space-extreme', [text({ data: 'Hello world', block: block({ lineSpace: 99999 }) }), text({ y: 400, data: 'Hello world', block: block({ lineSpace: -99999 }) })]);
add('block-aligns', ['left', 'center', 'right', 'justify'].map((align, i) => text({ y: 100 + 100 * i, data: 'Hello world, this is a block of text', block: block({ align }) })));
add('block-breaks-and-long-data', [text({ data: `one\ntwo ${'three '.repeat(800)}`, block: block({ width: 800000, lines: 50000 }) })]);
add('block-huge-font-rotated', [text({ x: 500, rotation: 90, font: font(50000), data: 'Hello world', block: block() })]);

// Lines, boxes, ellipses, areas ---------------------------------------------------------------------------------------------------------------------
add('line-huge', [line({ x2: 999999, width: 999999 })]);
add('line-tiny', [line({ x2: 100.2, width: 0.1 })]);
add('line-negative', [line({ x1: -100, y1: -100, x2: 500, y2: -50 })]);
add('line-diagonal-extreme', [line({ x1: -300, y1: -300, x2: 99999, y2: 99999, width: 70000 })]);
add('line-vertical', [line({ x1: 100, y1: 100, x2: 100, y2: 99999, width: 2 })]);
add('box-huge', [box({ x2: 9999999, y2: 9999999, width: 99999, radius: 99999 })]);
add('box-tiny', [box({ x2: 100.1, y2: 100.1, width: 0.1, radius: 0.1 })]);
add('box-negative', [box({ x1: -700, y1: -700, x2: -100, y2: -100 })]);
add('box-reversed-corners', [box({ x1: 500, y1: 300, x2: 100, y2: 100 })]);
add('box-radius-extreme', [box({ radius: 99999 }), box({ y1: 400, y2: 550, radius: 0.1 })]);
add('ellipse-huge', [ellipse({ width: 9999999, height: 9999999, thickness: 99999 })]);
add('ellipse-tiny', [ellipse({ width: 0.1, height: 0.1, thickness: 0.1 })]);
add('ellipse-negative', [ellipse({ x: -100, y: -100 })]);
add('circle-huge', [circle({ width: 99999999, height: 99999999, thickness: 0.1 })]);
add('circle-tiny', [circle({ width: 0.1, height: 0.1, thickness: 99999 })]);
add('area-huge', [area({ width: 9999999, height: 9999999 }), area({ mode: 'clear', x: 200, width: 9999999, height: 9999999 })]);
add('area-tiny', [area({ width: 0.1, height: 0.1 }), area({ mode: 'clear', x: 200, width: 0.1, height: 0.1 })]);
add('area-negative', [area({ x: -100, y: -100 })]);

// Linear barcodes (one case per symbology the languages know, so a pair that lacks one reports it) -----------------------------------------------------
const SYMBOLOGIES = {
  code128: 'ABC123', code39: 'ABC-123', itf: '1234567890', code93: 'ABC123', codabar: 'A1234B', ean13: '123456789012', ean8: '1234567',
  upca: '12345678901', upce: '123456', msi: '1234', industrial25: '1234',
};
for (const [symbology, data] of Object.entries(SYMBOLOGIES)) {
  const wide = ['code39', 'itf', 'codabar', 'msi', 'industrial25'].includes(symbology);
  const widths = (narrow, wideBar) => (wide ? { widths: { narrowBar: narrow, narrowSpace: narrow, wideBar, wideSpace: wideBar }, interCharGap: narrow } : {});
  add(`barcode-${symbology}-huge`, [barcode({ symbology, data, module: 9999, height: 999999, ...widths(9999, 99999) })]);
  add(`barcode-${symbology}-tiny`, [barcode({ symbology, data, module: 0.01, height: 0.01, ...widths(0.01, 0.02) })]);
  add(`barcode-${symbology}-position`, [barcode({ symbology, data, x: -500, y: 99999 })]);
  add(`barcode-${symbology}-rotations`, [0, 90, 180, 270, 45].map((rotation, i) => barcode({ symbology, data, rotation, y: 50 + 100 * i })));
  add(`barcode-${symbology}-not-readable`, [barcode({ symbology, data, humanReadable: false })]);
}
add('barcode-code128-long-data', [barcode({ data: 'ABC'.repeat(100) })]);
add('barcode-code128-fnc1', [barcode({ data: `${PB.barcodeData.FNC1}01123456789012${PB.barcodeData.FNC1}ab` })]);
add('barcode-code128-non-ascii', [barcode({ data: 'Ñandú' })]);
add('barcode-code39-forbidden-data', [barcode({ symbology: 'code39', data: 'abc é' })]);
add('barcode-code39-mod43', [barcode({ symbology: 'code39', data: 'ABC123', check: 'mod43' })]);
add('barcode-code39-ratios', [{ w: 1, r: 2 }, { w: 1, r: 5 }, { w: 3, r: 3 }, { w: 0.5, r: 40 }].map(({ w, r }, i) => barcode({ symbology: 'code39', data: 'ABC', y: 50 + 100 * i, module: w, widths: { narrowBar: w, narrowSpace: w, wideBar: w * r, wideSpace: w * r }, interCharGap: w })));
add('barcode-itf-forbidden-data', [barcode({ symbology: 'itf', data: 'ABC' }), barcode({ symbology: 'itf', y: 300, data: '123' })]);
add('barcode-ean13-wrong-length', [barcode({ symbology: 'ean13', data: '12' }), barcode({ symbology: 'ean13', y: 300, data: '12345678901234567' })]);
add('barcode-ean-addons', [barcode({ symbology: 'ean13', data: '123456789012', addon: 2 }), barcode({ symbology: 'upca', y: 300, data: '12345678901', addon: 5 })]);
add('barcode-checks', [['ean13', 'none'], ['ean13', 'check'], ['code93', 'none'], ['itf', 'auto'], ['msi', 'mod1010'], ['msi', 'mod1110']].map(([symbology, check], i) => barcode({ symbology, check, data: SYMBOLOGIES[symbology], y: 50 + 90 * i })));
add('barcode-counter', [barcode({ data: '0001', counter: { step: 99999999999 } })]);
add('barcode-unknown-symbology', [barcode({ symbology: 'unknown', data: '1234' })]);
add('barcode-many', Array.from({ length: 40 }, (_, i) => barcode({ x: 10, y: 10 + 14 * i, height: 10, data: `L${i}` })), { reports: { tpcl: /más de 32 códigos/ }, allow: /número de código de barras/ });

// QR and Data Matrix --------------------------------------------------------------------------------------------------------------------------------
add('qr-huge-cell', [qr({ cell: 9999 })]);
add('qr-tiny-cell', [qr({ cell: 0.01 })]);
add('qr-position', [qr({ x: -100, y: 99999 })]);
add('qr-eccs', ['L', 'M', 'Q', 'H'].map((ecc, i) => qr({ ecc, y: 50 + 100 * i })));
add('qr-long-data', [qr({ data: 'x'.repeat(5000) })]);
add('qr-unicode-data', [qr({ data: 'Ñandú ^~{}|,;"\\' })]);
add('dm-huge-cell', [dmatrix({ cell: 9999 })]);
add('dm-tiny-cell', [dmatrix({ cell: 0.01 })]);
add('dm-position', [dmatrix({ x: -100, y: 99999 })]);
add('dm-rotations', [0, 90, 180, 270, 45].map((rotation, i) => dmatrix({ rotation, y: 50 + 100 * i })));
add('dm-long-data', [dmatrix({ data: 'DM'.repeat(2000) })]);
add('dm-forced-sizes', [dmatrix({ size: 144 }), dmatrix({ y: 400, size: 10 }), dmatrix({ y: 500, size: 13 })]);
add('dm-no-module', [dmatrix({ cell: null, area: { width: 300, height: 200 }, size: undefined })]);
add('dm-other-ecc', [dmatrix({ ecc: 0 }), dmatrix({ y: 400, ecc: 140 })]);

// Images --------------------------------------------------------------------------------------------------------------------------------------------
add('image-wide', [image({ bitmap: bitmapOf(12000, 4) })]);
add('image-tall', [image({ bitmap: bitmapOf(8, 12000) })]);
add('image-large-buffer', [image({ bitmap: bitmapOf(2000, 2000) })]);
add('image-single-dot', [image({ bitmap: bitmapOf(1, 1) })]);
add('image-position', [image({ x: -300, y: 99999 })]);
add('image-fractional-width', [image({ bitmap: bitmapOf(13, 7, (x, y) => (x ^ y) & 1) })]);

// Everything together
add('mixed-label', [text(), text({ y: 300, font: font(50000) }), barcode({ y: 400 }), qr({ x: 600 }), dmatrix({ x: 700, y: 400 }), box(), line({ y1: 50, y2: 50 }), ellipse({ y: 450 }), area({ x: 800 }), image({ x: 500, y: 500 })]);

// Native sources: values at the edge of the SOURCE language that its own emitter never writes (fonts, magnifications, blocks, alignments, every shape
// parameter at its maximum). Each body is a complete command list of one language; the other two languages are the targets.
const NATIVE = [];
const native = (id, bodies, { reports = {}, allow = null } = {}) => NATIVE.push({ id, bodies, reports, allow });
const HEADERS = {
  tpcl: () => '{D0630,1000,0600|}\n{AX;+000,+000,+00|}\n{C|}\n',
  tspl: () => 'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n',
  zpl: dpi => `^XA
^PW${Math.round(1000 / PB.units.dotSize(dpi))}
^LL${Math.round(600 / PB.units.dotSize(dpi))}
`,
};
const TRAILERS = { tpcl: () => '\n{XS;I,0001,0002C4100|}', tspl: () => '\r\nPRINT 1,1\r\n', zpl: () => '\r\n^XZ\r\n' };

native('native-text-fonts-at-maximum', {
  tpcl: () => '{PC000;0100,0200,99,99,J,33,B|}\n{RC000;Big|}\n{PC001;9999,9999,01,01,A,11,B,J1616|}\n{RC001;Small|}\n{PV00;0000,0000,0850,0850,B,22,B,+512|}\n{RV00;Outline|}',
  tspl: () => 'TEXT 0,0,"1",0,10,10,"Hi"\r\nTEXT 99999,99999,"5",270,10,10,"x"\r\nTEXT 5,5,"0",90,200,200,"scalable"\r\nTEXT 5,500,"8",180,1,10,"y"',
  zpl: () => '^FO0,0^ADN,100,100^FDHi^FS\n^FO32000,32000^A0R,32000,32000^FDx^FS\n^FO5,5^AAI,90,50^FDy^FS\n^FT5,500^ACB,10,10^FDz^FS\n^CF0,32000,32000\n^FO10,10^FDdefault^FS',
});
native('native-text-blocks-at-maximum', {
  tpcl: () => '{PC000;0100,0200,06,06,S,00,B,P5105750099|}\n{RC000;A long text in a block|}\n{PC001;0100,0400,06,06,S,00,B,P4 1057|}\n{RC001;equal|}',
  tspl: () => 'BLOCK 0,0,9999,9999,"0",0,200,200,500,"text in a big block"\r\nBLOCK 10,10,5,5,"1",90,10,10,-100,2,"x"',
  zpl: () => '^FO0,0^A0N,50,50^FB9999,9999,-9999,R,9999^FDtext in a big block^FS\n^FO10,300^A0N,32000,32000^FB1,1,9999,J^FDx^FS',
});
native('native-counters-at-maximum', {
  tpcl: () => '{PC000;0100,0200,06,06,S,00,B,+9999999999,Z20|}\n{RC000;0001|}\n{PV01;0100,0400,0100,0100,B,00,B,-9999999999|}\n{RV01;0099|}',
  tspl: () => 'SET COUNTER @49 999999999\r\n@49="0001"\r\nTEXT 80,100,"0",0,10,10,@49\r\nSET COUNTER @0 -999999999\r\n@0="0001"\r\nTEXT 80,300,"0",0,10,10,@0',
  zpl: () => '^FO0,0^A0N,50,50^SN0001,999999999999,Y^FS\n^FO0,200^A0N,50,50^SN999999999999,-999999999999,N^FS\n^FO0,300^A0N,50,50^FN9999^FDdefault^FS',
});
native('native-shapes-at-maximum', {
  tpcl: () => '{LC;0000,0000,9999,9999,1,99,999|}\n{LC;0000,0000,9999,0000,0,99|}\n{XR;0000,0000,9999,9999,B|}\n{XR;0100,0100,0101,0101,A|}',
  tspl: () => 'BAR 0,0,99999,99999\r\nBOX 0,0,99999,99999,9999,9999\r\nELLIPSE 0,0,99999,99999,9999\r\nCIRCLE 0,0,99999,9999\r\nERASE 0,0,99999,99999\r\nREVERSE 0,0,99999,99999\r\nBAR -5,-5,10,10',
  zpl: () => '^FO0,0^GB32000,32000,32000,B,8^FS\n^FO0,0^GC4095,4095,B^FS\n^FO0,0^GD32000,32000,32000,B,L^FS\n^FO32000,32000^GE4095,4095,4095^FS\n^FO0,0^GB3,3,2^FR^FS',
});
native('native-barcodes-at-maximum', {
  tpcl: () => '{XB00;0100,0200,9,1,15,0,1000,0,000,1,00|}\n{RB00;ABC123|}\n{XB01;0100,0400,3,1,99,99,99,99,99,0,1000,1|}\n{RB01;ABC|}',
  tspl: () => 'BARCODE 0,0,"128",9999,3,0,10,30,"ABC"\r\nBARCODE 0,300,"39",9999,1,270,40,120,"ABC"\r\nBARCODE 0,400,"EAN13",1,2,90,1,3,"123456789012"\r\nBARCODE 0,500,"CODA",9999,1,180,40,120,"A12B"',
  zpl: () => '^BY10,3.0\n^FO0,0^BCN,32000,Y,Y,Y^FDABC^FS\n^FO0,300^B3R,N,32000,Y,Y^FDABC^FS\n^FO0,400^BEI,32000,Y,Y^FD123456789012^FS\n^FO0,500^B2B,32000,Y,Y,Y^FD1234^FS',
});
native('native-2d-at-maximum', {
  tpcl: () => '{XB00;0100,0200,T,H,52,A,3,M2|}\n{RB00;QR|}\n{XB01;0100,0400,Q,20,99,00,3|}\n{RB01;DM|}',
  tspl: () => 'QRCODE 0,0,H,10,A,270,"QR"\r\nDMATRIX 0,300,9999,9999,99,144,144,"DM"\r\nQRCODE 99999,99999,L,1,M,0,"x"',
  zpl: () => '^FO0,0^BQN,2,10^FDHA,QR^FS\n^FO0,300^BXR,9999,200,144,144^FDDM^FS\n^FO32000,32000^BQN,2,1^FDLA,x^FS',
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** The warnings the parse of an emitted barcode may carry because of its DATA (the value is copied as it is and the emit reports it). */
const DATA_WARNING = /no se puede codificar|se esperaban|solo admite|no válido para|datos no válidos|no se dibuja|dígito de control|caracteres? ASCII|carácter/i;
const brief = diagnostics => diagnostics.map(d => `${d.level}: ${d.text}`);

// What each pair must REPORT when the source value does not fit the target (key "from>to"): the source emitter has already limited the value to its own
// range, so a pair only appears where the source range is wider than the target's.
const REPORTS = {
  'text-huge-size': { 'tspl>tpcl': /vectoriales/, 'zpl>tpcl': /vectoriales/ },
  'text-negative-position': { 'tspl>tpcl': /coordenadas fuera de 0\.\.9999/, 'tspl>zpl': /fuera de 0\.\.32000/ },
  'text-far-position': { 'tspl>tpcl': /coordenadas fuera de 0\.\.9999/, 'zpl>tpcl': /coordenadas fuera de 0\.\.9999/ },
  'text-long-data': { 'tspl>tpcl': /255 caracteres/, 'zpl>tpcl': /255 caracteres/, 'tspl>zpl': /3072 caracteres/ },
  'text-forbidden-characters': { 'tspl>tpcl': /caracteres que rompen el formato TPCL/, 'zpl>tpcl': /caracteres que rompen el formato TPCL/ },
  'text-counter-huge-step': { 'zpl>tpcl': /incrementos/, 'zpl>tspl': /incrementos/, 'tpcl>tspl': /incrementos/ },
  'block-huge-width': { 'tspl>zpl': /rangos de \^FB/ },
  'line-huge': { 'tspl>zpl': /grosores de línea|de largo/, 'tspl>tpcl': /grosores de línea|coordenadas/ },
  'box-huge': { 'tspl>tpcl': /radios de esquina|coordenadas/, 'tspl>zpl': /de largo|grosores/ },
  'ellipse-huge': { 'tspl>zpl': /elipses o círculos de más de 4095/, 'tspl>tpcl': /elipses y círculos no se escriben/, 'zpl>tpcl': /elipses y círculos no se escriben/ },
  'circle-tiny': { 'tspl>tpcl': /elipses y círculos no se escriben/ },
  'area-huge': { 'tspl>zpl': /áreas de más de 32000/, 'tspl>tpcl': /coordenadas fuera/ },
  'barcode-code128-huge': { 'tspl>tpcl': /módulo|altura/, 'tspl>zpl': /módulo/, 'tpcl>zpl': /módulo/, 'zpl>tpcl': /altura/ },
  'barcode-msi-huge': { 'tpcl>tspl': /sin equivalente en TSPL/, 'zpl>tspl': /sin equivalente en TSPL/ },
  'barcode-industrial25-huge': { 'tpcl>tspl': /sin equivalente en TSPL/, 'zpl>tspl': /sin equivalente en TSPL/ },
  'qr-huge-cell': { 'tpcl>tspl': /celda fuera de 1\.\.10/, 'tpcl>zpl': /módulo fuera de 1\.\.10/ },
  'qr-long-data': { 'tspl>tpcl': /2000 caracteres/, 'zpl>tpcl': /2000 caracteres/, 'tspl>zpl': /3072 caracteres/ },
  'image-wide': { 'zpl>tpcl': /imágenes que la impresora no admite/, 'zpl>tspl': /máximo de BITMAP/ },
  'image-tall': { 'zpl>tspl': /máximo de BITMAP/ },
  'image-large-buffer': { 'tspl>zpl': /máximo de \^GF/, 'tpcl>zpl': /máximo de \^GF/ },
};

/** The source label text of a case in a language (null when a native case has no body in it). */
function sourceText(c, from, dpi) {
  if (c.items) return PB.languages.emit(from, labelOf(c.items), { dpi }).text;
  return c.bodies[from] ? HEADERS[from](dpi) + c.bodies[from](dpi) + TRAILERS[from](dpi) : null;
}

/** Everything wrong with one conversion, as a list of messages. */
function problems(c, from, to, dpi) {
  const text = sourceText(c, from, dpi);
  if (text === null) return [];
  let result;
  try {
    result = PB.convert.run(text, to, { dpi, sourceId: from });
  } catch (error) {
    return [`${c.id}: threw ${error.message}`];
  }
  const found = [];
  const back = PB.languages.get(to).parse(result.text, { dpi });
  const flagged = back.diagnostics.filter(d => (d.level === 'warning' || d.level === 'error') && !(c.id.includes('barcode') && DATA_WARNING.test(d.text)) && !(c.allow && c.allow.test(d.text)));
  if (flagged.length) found.push(`${c.id}: the ${to} parser flags its own output: ${brief(flagged).join(' | ')}`);
  const texts = result.diagnostics.map(d => d.text);
  const repeated = texts.filter((t, i) => texts.indexOf(t) !== i);
  if (repeated.length) found.push(`${c.id}: repeated diagnostics: ${[...new Set(repeated)].join(' | ')}`);
  const expected = (REPORTS[c.id] || {})[`${from}>${to}`] || c.reports[to];
  if (expected && !result.diagnostics.some(d => d.level === 'warning' && expected.test(d.text))) found.push(`${c.id}: no warning matching ${expected}`);
  return found;
}

for (const dpi of DPIS) {
  for (const [from, to] of PAIRS) {
    test(`${from} -> ${to} at ${dpi} dpi: every converted case reads back without a range warning, adjustments reported once`, () => {
      assert.deepEqual([...CASES, ...NATIVE].flatMap(c => problems(c, from, to, dpi)), []);
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Gaps the matrix found

test('a line or a box longer than 32000 dots is limited and reported once in ZPL', () => {
  for (const item of [line({ x1: 100, y1: 100, x2: 100, y2: 99999, width: 2 }), line({ x1: 100, y1: 100, x2: 99999, y2: 99999, width: 2 }), box({ x2: 99999, y2: 400, width: 2 })]) {
    const { text: out, diagnostics } = PB.languages.emit('zpl', labelOf([item, { ...item }]), { dpi: 203 });
    assert.ok(/\^G[BD]\d+,\d+/.test(out));
    for (const [w, h] of [...out.matchAll(/\^G[BD](\d+),(\d+)/g)].map(m => [Number(m[1]), Number(m[2])])) assert.ok(w <= 32000 && h <= 32000, out);
    assert.equal(diagnostics.filter(d => /de largo: ZPL \(\^GB \/ \^GD\) admite hasta 32000/.test(d.text)).length, 1);
  }
});

test('a bar code symbology the target lacks is reported once however many items use it', () => {
  const items = [0, 1, 2].map(i => barcode({ symbology: 'msi', data: '1234', y: 100 + 100 * i }));
  for (const target of ['tpcl', 'tspl']) {
    if (target === 'tpcl') continue; // TPCL writes MSI
    const { diagnostics } = PB.languages.emit(target, labelOf(items), { dpi: 203 });
    assert.equal(diagnostics.filter(d => /msi: sin equivalente/.test(d.text)).length, 1);
  }
  const tpcl = PB.languages.emit('tpcl', labelOf([0, 1].map(i => barcode({ symbology: 'unknown', y: 100 + 100 * i }))), { dpi: 203 });
  assert.equal(tpcl.diagnostics.filter(d => /unknown: sin equivalente/.test(d.text)).length, 1);
});

test('a TSPL BITMAP of hundreds of KB is read (the payload is not spread into one call)', () => {
  const big = image({ bitmap: bitmapOf(2000, 2000) });
  const text = PB.languages.emit('tspl', labelOf([big]), { dpi: 203 }).text;
  const model = PB.languages.get('tspl').parse(text, { dpi: 203 });
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].bitmap.w, 2000);
  assert.equal(model.items[0].bitmap.h, 2000);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The example labels

const { shippedExamples, LEGACY_EXAMPLES } = require('./helpers/load');
const SHIPPED = shippedExamples();
const notices = diagnostics => diagnostics.filter(d => d.level === 'warning' || d.level === 'error');

test('every example label shipped in js/config.js parses without a warning or an error at both resolutions', () => {
  assert.ok(SHIPPED.length >= 6);
  for (const example of SHIPPED) {
    for (const dpi of DPIS) {
      const model = PB.languages.get(example.language).parse(example.source, { dpi });
      assert.deepEqual(brief(notices(model.diagnostics)), [], `${example.id} at ${dpi} dpi`);
    }
  }
});

test('the example labels of the test fixtures parse without a warning or an error at their resolution (203 dpi)', () => {
  for (const example of LEGACY_EXAMPLES) {
    const model = PB.languages.get(example.language).parse(example.source, { dpi: 203 });
    assert.deepEqual(brief(notices(model.diagnostics)), [], example.id);
  }
});

test('the Code 128 of the TPCL template writes a check digit option the manual allows (1..5)', () => {
  const template = SHIPPED.find(e => e.id === 'template-tpcl');
  assert.match(template.source, /\{XB00;[^|]*,9,1,/);
});

test('every example label converts to the other two languages and reads back without a warning or an error', () => {
  for (const example of [...SHIPPED, ...LEGACY_EXAMPLES]) {
    for (const to of LANGS.filter(id => id !== example.language)) {
      const { text: converted } = PB.convert.run(example.source, to, { dpi: 203, sourceId: example.language });
      const back = PB.languages.get(to).parse(converted, { dpi: 203 });
      assert.deepEqual(brief(notices(back.diagnostics)), [], `${example.id} -> ${to}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The picture pre-check of the app follows the language the picture is written in

test('each language declares which picture sizes it can write (the app asks the language, not a fixed 9999)', () => {
  const problem = id => PB.languages.get(id).imageSizeProblem;
  for (const id of LANGS) assert.equal(typeof problem(id), 'function', id);
  // 10000 x 8 dots: over the 4 digits of SG, inside BITMAP (1250 bytes) and ^GF (10000 bytes)
  assert.match(problem('tpcl')(10000, 8), /supera el máximo de SG/);
  assert.equal(problem('tspl')(10000, 8), null);
  assert.equal(problem('zpl')(10000, 8), null);
  // 8 x 12000: height over 9999 is fine for SG (up to 99999) and ^GF, refused by BITMAP
  assert.equal(problem('tpcl')(8, 12000), null);
  assert.match(problem('tspl')(8, 12000), /supera el máximo de BITMAP/);
  assert.equal(problem('zpl')(8, 12000), null);
  // 6400 x 160 dots = 128000 bytes: over the 99999 bytes of ^GF and fine elsewhere
  assert.match(problem('zpl')(6400, 160), /supera el máximo de \^GF/);
  assert.equal(problem('tspl')(6400, 160), null);
  assert.equal(problem('tpcl')(6400, 160), null);
  // 4000 x 1400 dots = 700000 bytes: over the 512 KB buffer of SG
  assert.match(problem('tpcl')(4000, 1400), /búfer de imagen/);
  for (const id of LANGS) assert.match(problem(id)(0, 5), /no es un tamaño de imagen válido/);
});
