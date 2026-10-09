const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Z3: the ZPL linear barcodes (js/components/barcode/zpl.js): ^BC (Code 128), ^B3 (Code 39), ^B2 (Interleaved 2 of 5), ^BE (EAN-13), ^B8 (EAN-8),
// ^BU (UPC-A), ^B9 (UPC-E), ^BA (Code 93), ^BK (Codabar), ^BM (MSI), ^BI (Industrial 2 of 5) and ^BJ (Standard 2 of 5), with ^BY (module width,
// wide / narrow ratio, default height), the Code 128 `>` invocation codes, ^FO / ^FT origins, emit, the properties panel, the palette entry and
// the conversions through the shared pipeline.
// Parameter layouts of the 2003 guide (Volume One): ^BCo,h,f,g,e,m  ^B3o,e,h,f,g  ^B2o,h,f,g,e  ^BEo,h,f,g  ^B8o,h,f,g  ^BUo,h,f,g,e  ^B9o,h,f,g,e
// ^BAo,h,f,g,e  ^BKo,e,h,f,g,k,l  ^BMo,e,h,f,g,e2  ^BIo,h,f,g  ^BJo,h,f,g.  ^BYw,r,h.
// All parses use 254 dpi, where one dot is exactly 0.1 mm, so dots and model units are the same number.
const PB = loadApp();
const zpl = PB.languages.get('zpl');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const DPI = 254;
const FNC1 = PB.barcodeData.FNC1;
const { measure } = PB.slices.barcode;

const BASE = body => `^XA^PW800^LL480${body}^XZ`;
const parse = src => zpl.parse(src, { dpi: DPI });
const one = src => parse(BASE(src)).items[0];
const diagnostics = src => parse(BASE(src)).diagnostics.map(d => `${d.level}: ${d.text}`);
const emitLines = (model, dpi = DPI) => zpl.emit(model, { dpi }).text.split('\r\n').filter(l => l && !/^\^(XA|XZ|PW|LL)/.test(l));
const emitResult = (model, dpi = DPI) => zpl.emit(model, { dpi });
const roundTrip = src => emitLines(parse(BASE(src)));
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol + 1e-6, `${label}: ${a} vs ${b} (tolerance ${tol})`);
const byKey = description => Object.fromEntries(description.fields.map(f => [f.key, f]));
const barcodeCmd = text => /\^B[C23EU98AKMIJ](?!Y)[^^]*/.exec(text)[0];
const maskCmd = text => text.replace(/\^B[C23EU98AKMIJ](?!Y)[^^]*/, '<B>');

const levels = (list, ...wanted) => list.filter(d => wanted.includes(d.level));

/** Every command with a valid field, a symbology and the data its parameters are written with. */
const CASES = [
  { name: 'BC', symbology: 'code128', cmd: o => `^BC${o},80,Y,N,N`, data: 'CODE128', neutral: 'CODE128' },
  { name: 'B3', symbology: 'code39', cmd: o => `^B3${o},N,80,Y,N`, data: 'CODE39', neutral: 'CODE39', check: 'none' },
  { name: 'B2', symbology: 'itf', cmd: o => `^B2${o},80,Y,N,N`, data: '123456', neutral: '123456', check: 'none' },
  { name: 'BE', symbology: 'ean13', cmd: o => `^BE${o},80,Y,N`, data: '123456789012', neutral: '123456789012', check: 'auto' },
  { name: 'B8', symbology: 'ean8', cmd: o => `^B8${o},80,Y,N`, data: '1234567', neutral: '1234567', check: 'auto' },
  { name: 'BU', symbology: 'upca', cmd: o => `^BU${o},80,Y,N,Y`, data: '12345678901', neutral: '12345678901', check: 'auto' },
  { name: 'B9', symbology: 'upce', cmd: o => `^B9${o},80,Y,N,Y`, data: '0123400005', neutral: '012345', check: 'auto' },
  { name: 'BA', symbology: 'code93', cmd: o => `^BA${o},80,Y,N,N`, data: 'CODE93', neutral: 'CODE93', check: 'auto' },
  { name: 'BK', symbology: 'codabar', cmd: o => `^BK${o},N,80,Y,N`, data: '1234', neutral: 'A1234A', check: 'none' },
  { name: 'BM', symbology: 'msi', cmd: o => `^BM${o},B,80,Y,N`, data: '1234567', neutral: '1234567', check: 'auto' },
  { name: 'BI', symbology: 'industrial25', cmd: o => `^BI${o},80,Y,N`, data: '123456', neutral: '123456', check: 'none' },
];
const WIDE_NARROW = ['code39', 'itf', 'codabar', 'msi', 'industrial25'];
const field = (c, o = 'N', origin = '^FO100,50') => `${origin}${c.cmd(o)}^FD${c.data}^FS`;

// ---------------------------------------------------------------------------------------------------------------
// Registration and tables

test('the barcode slice registers a zpl factory after tpcl and tspl; ZPL offers Texto and Código de barras first in the palette (QR and Data Matrix follow, Z4)', () => {
  assert.deepEqual(Object.keys(PB.components.get('barcode').languages), ['tpcl', 'tspl', 'zpl']);
  assert.deepEqual(zpl.componentTemplates().map(c => [c.kind, c.label]).slice(0, 2), [['text', 'Texto'], ['barcode', 'Código de barras']]);
});

// ---------------------------------------------------------------------------------------------------------------
// Parse: every command

for (const c of CASES) {
  test(`parse ^${c.name}: ${c.symbology} with its parameters, no diagnostics`, () => {
    const model = parse(BASE(field(c)));
    assert.deepEqual(model.diagnostics, []);
    const [item] = model.items;
    assert.equal(item.kind, 'barcode');
    assert.deepEqual([item.symbology, item.data, item.x, item.y, item.rotation, item.height, item.humanReadable], [c.symbology, c.neutral, 100, 50, 0, 80, true]);
    assert.equal(item.module, 2);
    assert.equal(item.native.type, c.name);
    assert.equal(item.native.origin, 'FO');
    assert.equal(item.check, c.check);
    assert.equal(item.addon, ['ean13', 'ean8', 'upca', 'upce'].includes(c.symbology) ? 0 : undefined);
    assert.equal(item.source.spans.length, 1);
  });
}

test('the orientation N / R / I / B is the rotation 0 / 90 / 180 / 270 clockwise; ^FO is the top-left of the rotated bars', () => {
  const c = CASES[0];
  const n = one(field(c, 'N'));
  const w = measure(n);
  assert.ok(w > 0);
  const at = o => one(field(c, o));
  assert.deepEqual([at('N').rotation, at('N').x, at('N').y], [0, 100, 50]);
  assert.deepEqual([at('R').rotation, at('R').x, at('R').y], [90, 180, 50]);
  assert.deepEqual([at('I').rotation, at('I').x, at('I').y], [180, 100 + w, 130]);
  assert.deepEqual([at('B').rotation, at('B').x, at('B').y], [270, 100, 50 + w]);
});

test('^FT is the base of the bars (bottom-left in the reading direction) and does not depend on the length', () => {
  const c = CASES[0];
  const at = o => one(field(c, o, '^FT100,200'));
  assert.deepEqual([at('N').rotation, at('N').x, at('N').y, at('N').native.origin], [0, 100, 120, 'FT']);
  assert.deepEqual([at('R').x, at('R').y], [180, 200]);
  assert.deepEqual([at('I').x, at('I').y], [100, 280]);
  assert.deepEqual([at('B').x, at('B').y], [20, 200]);
});

test('^FW gives the orientation of a barcode that has none; ^LH moves the field; a field without ^FO sits at the label home', () => {
  assert.equal(one('^FWR^FO10,10^BC,50,Y,N,N^FDabc^FS').rotation, 90);
  assert.equal(one('^FWR^FO10,10^BCN,50,Y,N,N^FDabc^FS').rotation, 0);
  const lh = one('^LH10,20^FO100,50^BCN,50,Y,N,N^FDabc^FS');
  assert.deepEqual([lh.x, lh.y], [110, 70]);
  const none = parse(BASE('^BCN,50,Y,N,N^FDabc^FS'));
  assert.deepEqual([none.items[0].x, none.items[0].y, none.items[0].native.origin], [0, 0, 'default']);
});

test('human readable (f, default Y) and the line above (g, default N, reported and not drawn above)', () => {
  assert.equal(one('^FO10,10^BCN,50,N,N,N^FDabc^FS').humanReadable, false);
  assert.equal(one('^FO10,10^BCN,50^FDabc^FS').humanReadable, true);
  const above = parse(BASE('^FO10,10^BCN,50,Y,Y,N^FDabc^FS^FO10,100^B3N,N,50,Y,Y^FDabc^FS'));
  assert.deepEqual(above.items.map(i => i.native.above), [true, true]);
  assert.deepEqual(above.diagnostics.map(d => [d.level, /sobre el código/.test(d.text)]), [['info', true]]);
  assert.equal(one('^FO10,10^BCN,50,Y,N,N^FDabc^FS').native.above, false);
});

test('the height comes from the command, else from ^BY (default 10 dots); an invalid one is reported', () => {
  assert.equal(one('^FO10,10^BCN,50,Y,N,N^FDabc^FS').height, 50);
  assert.equal(one('^FO10,10^BCN,,Y,N,N^FDabc^FS').height, 10);
  assert.equal(one('^BY2,3,70^FO10,10^BCN,,Y,N,N^FDabc^FS').height, 70);
  assert.equal(one('^BY2,3,70^FO10,10^BC^FDabc^FS').height, 70);
  const bad = parse(BASE('^BY2,3,70^FO10,10^BCN,x,Y,N,N^FDabc^FS'));
  assert.equal(bad.items[0].height, 70);
  assert.match(bad.diagnostics[0].text, /altura/);
});

test('the check digit options: Code 39 e, ITF e, MSI e (A..D), the fixed ones of the others', () => {
  const check = src => one(`^FO10,10${src}^FD1234^FS`).check;
  assert.deepEqual(['^B3N,Y,50', '^B3N,N,50', '^B3N,,50', '^B3N'].map(check), ['mod43', 'none', 'none', 'none']);
  assert.deepEqual(['^B2N,50,Y,N,Y', '^B2N,50,Y,N,N', '^B2N,50'].map(check), ['auto', 'none', 'none']);
  assert.deepEqual(['A', 'B', 'C', 'D', ''].map(e => check(`^BMN,${e},50`)), ['none', 'auto', 'mod1010', 'mod1110', 'auto']);
  assert.deepEqual(['^BEN,50', '^B8N,50', '^BUN,50', '^BAN,50', '^BKN,N,50', '^BIN,50', '^BC'].map(check), ['auto', 'auto', 'auto', 'auto', 'none', 'none', undefined]);
  // ^BU / ^B9 e = print the check digit (default Y), ^BA e (default N): kept as written, the digit is always in the bars
  const printCheck = src => one(`^FO10,10${src}^FD12345678901^FS`).native.printCheck;
  assert.deepEqual(['^BUN,50,Y,N,N', '^BUN,50,Y,N', '^B9N,50,Y,N,Y', '^BAN,50,Y,N,Y', '^BAN,50,Y,N'].map(printCheck), [false, true, true, true, false]);
});

test('Code 128 e (UCC check digit) and m (mode N / U / A / D) are reported once and drawn as a plain Code 128', () => {
  const model = parse(BASE('^FO10,10^BCN,50,Y,N,Y,U^FD123^FS^FO10,100^BCN,50,Y,N,N,A^FD456^FS'));
  assert.deepEqual(model.items.map(i => [i.native.ucc, i.native.mode, i.symbology]), [[true, 'U', 'code128'], [false, 'A', 'code128']]);
  assert.deepEqual(model.diagnostics.map(d => [d.level, /modo|UCC/.test(d.text)]), [['info', true]]);
  assert.equal(one('^FO10,10^BCN,50,Y,N,N,N^FD123^FS').native.mode, 'N');
  assert.equal(one('^FO10,10^BCN,50,Y,N,N^FD123^FS').native.mode, 'N');
});

test('Codabar: k and l are the start and stop characters (default A), the viewer data carries them like the other languages', () => {
  assert.equal(one('^FO10,10^BKN,N,50,Y,N,B,C^FD1234^FS').data, 'B1234C');
  assert.equal(one('^FO10,10^BKN,N,50,Y,N,B^FD1234^FS').data, 'B1234A');
  assert.equal(one('^FO10,10^BKN,N,50,Y,N^FD1234^FS').data, 'A1234A');
  const item = one('^FO10,10^BKN,N,50,Y,N,D,B^FD1234^FS');
  assert.deepEqual([item.native.k, item.native.l], ['D', 'B']);
});

test('Standard 2 of 5 (^BJ) is read like Industrial 2 of 5, with one info', () => {
  const model = parse(BASE('^FO10,10^BJN,50,Y,N^FD123456^FS'));
  assert.equal(model.items[0].symbology, 'industrial25');
  assert.equal(model.items[0].native.type, 'BJ');
  assert.deepEqual(model.diagnostics.map(d => [d.level, /2 de 5 estándar/.test(d.text)]), [['info', true]]);
});

test('UPC-E (^B9): the 10 characters of the guide are the manufacturer and product codes; the viewer keeps the zero-suppressed 6 digits', () => {
  // the four zero suppression rules (the guide: product code limits per manufacturer ending)
  const data = d => one(`^FO10,10^B9N,50,Y,N,Y^FD${d}^FS`).data;
  const cases = [['1210000345', '123451'], ['1230000045', '123453'], ['1234000005', '123454'], ['1234500006', '123456'], ['0123400005', '012345']];
  for (const [ten, six] of cases) {
    assert.equal(data(ten), six, ten);
    assert.equal(PB.ean.upceToUpca(six).slice(1, 11), ten, `${six} expands back to ${ten}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// ^BY

test('^BY: module, ratio and default height apply to the fields that follow, persist until changed and override partially', () => {
  const items = parse(BASE('^BY3,2.4,40^FO10,10^B3N,N,,Y,N^FDA^FS^FO10,60^B3N,N,20,Y,N^FDB^FS^BY4^FO10,100^B3N,N,,Y,N^FDC^FS')).items;
  assert.deepEqual(items.map(i => [i.module, i.height, i.widths.wideBar]), [[3, 40, 7], [3, 20, 7], [4, 40, 9]]);
  assert.deepEqual(items.map(i => i.native.ratio), [2.4, 2.4, 2.4]);
  assert.deepEqual(items.map(i => i.native.module), [3, 3, 4]);
  // power-up values: 2 dots, ratio 3, height 10
  const dflt = one('^FO10,10^B3N,N,,Y,N^FDA^FS');
  assert.deepEqual([dflt.module, dflt.height, dflt.widths.wideBar, dflt.widths.narrowBar, dflt.widths.wideSpace, dflt.interCharGap], [2, 10, 6, 2, 6, 2]);
});

test('^BY in the middle of a field applies to it; a ^BY out of range is applied at the nearest limit (V11) and a one that is not a number changes nothing; both are reported', () => {
  assert.equal(one('^FO10,10^B3N,N,50,Y,N^BY5^FDA^FS').module, 5);
  const bad = parse(BASE('^BY5^BY99^FO10,10^BCN,50,Y,N,N^FDA^FS'));
  assert.equal(bad.items[0].module, 10);
  assert.equal(bad.diagnostics.filter(d => /\^BY/.test(d.text)).length, 1);
  const text = parse(BASE('^BY5^BYx^FO10,10^BCN,50,Y,N,N^FDA^FS'));
  assert.equal(text.items[0].module, 5);
  assert.equal(text.diagnostics.filter(d => /\^BY/.test(d.text)).length, 1);
});

test('the ratio table J of the guide: the wide bar is a whole number of dots (rounded down)', () => {
  const wide = (w, r) => one(`^BY${w},${r}^FO10,10^B3N,N,50,Y,N^FDA^FS`).widths.wideBar;
  assert.deepEqual([wide(1, 2.5), wide(2, 2.5), wide(3, 2.5), wide(3, 3), wide(4, 2.3), wide(5, 2.2), wide(6, 2.2), wide(10, 2.1), wide(2, 2), wide(10, 3)], [2, 5, 7, 9, 9, 11, 13, 21, 4, 30]);
});

test('the fixed-ratio symbologies (Code 128, Code 93, EAN / UPC) have no widths: ^BY r has no effect; the wide / narrow ones all do', () => {
  for (const c of CASES) {
    const item = one(`^BY3,2.5${field(c)}`);
    assert.equal(item.module, 3, c.symbology);
    assert.equal(item.widths !== undefined, WIDE_NARROW.includes(c.symbology), c.symbology);
    if (item.widths) assert.deepEqual([item.widths.narrowBar, item.widths.wideBar], [3, 7], c.symbology);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Code 128 invocation codes and ^FH

test('Code 128 invocation codes: start codes and subset changes are dropped (info), >8 is FNC1, >0 >= >< are > ~ ^', () => {
  const data = d => one(`^FO10,10^BCN,50,Y,N,N^FD${d}^FS`).data;
  assert.equal(data('>:CODE128'), 'CODE128');
  assert.equal(data('>9ABC'), 'ABC');
  assert.equal(data('>;>8001234'), `${FNC1}001234`);
  assert.equal(data('>:AB>5123456>6CD'), 'AB123456CD');
  assert.equal(data('A>0B>=C><D'), 'A>B~C^D');
  assert.equal(data('AB>'), 'AB>');
  const info = diagnostics('^FO10,10^BCN,50,Y,N,N^FD>:AB>5123456^FS');
  assert.deepEqual(info.map(s => s.split(':')[0]), ['info']);
  assert.match(info[0], /subconjunto/);
});

test('Code 128 invocation codes the viewer cannot draw (>1 DEL, >2 FNC3, >3 FNC2, >4 SHIFT, unknown) are reported and dropped', () => {
  const model = parse(BASE('^FO10,10^BCN,50,Y,N,N^FDA>2B>4C>xD^FS'));
  assert.equal(model.items[0].data, 'ABCD');
  assert.equal(model.diagnostics.filter(d => d.level === 'warning').length, 1);
  assert.match(model.diagnostics.find(d => d.level === 'warning').text, />2.*>4.*>x/);
});

test('mode N uses subset B unless a start code is given: a run of 4 or more digits is reported once (the viewer chooses the subsets itself)', () => {
  assert.deepEqual(diagnostics('^FO10,10^BCN,50,Y,N,N^FD123456^FS').map(s => /subconjunto B/.test(s)), [true]);
  assert.deepEqual(diagnostics('^FO10,10^BCN,50,Y,N,N^FD>;123456^FS').filter(s => /subconjunto B/.test(s)), []);
  assert.deepEqual(diagnostics('^FO10,10^BCN,50,Y,N,N^FDabc12^FS'), []);
});

test('^FH hex escapes in the barcode data are decoded (also ^ and ~)', () => {
  assert.equal(one('^FO10,10^BCN,50,Y,N,N^FH^FDAB_5EC_7ED^FS').data, 'AB^C~D');
  assert.equal(one('^FO10,10^B3N,N,50,Y,N^FH^FDA_42C^FS').data, 'ABC');
});

test('a barcode field without data draws nothing; ^FV data is read like ^FD', () => {
  assert.deepEqual(parse(BASE('^FO10,10^BCN,50,Y,N,N^FS')).items, []);
  assert.equal(one('^FO10,10^BCN,50,Y,N,N^FVabc^FS').data, 'abc');
});

// ---------------------------------------------------------------------------------------------------------------
// Emit

const item = over => ({ kind: 'barcode', ref: 'X', x: 100, y: 200, rotation: 0, symbology: 'code128', module: 2, height: 80, humanReadable: true, data: 'ABC', ...over });
const model = (...items) => ({ language: 'tpcl', size: { width: 800, height: 480 }, items, diagnostics: [] });

test('emit: a ^BY (module, and the ratio for the wide / narrow symbologies) before every barcode field, then the field with all its parameters', () => {
  assert.deepEqual(emitLines(model(item({}))), ['^BY2', '^FO100,200^BCN,80,Y,N,N^FDABC^FS']);
  const wn = item({ symbology: 'code39', data: 'AB', module: 3, widths: { narrowBar: 3, narrowSpace: 3, wideBar: 7, wideSpace: 7 }, check: 'mod43', humanReadable: false });
  assert.deepEqual(emitLines(model(wn)), ['^BY3,2.4', '^FO100,200^B3N,Y,80,N,N^FDAB^FS']);
  assert.deepEqual(emitLines(model(item({ symbology: 'code39', data: 'AB', widths: { narrowBar: 2, narrowSpace: 2, wideBar: 6, wideSpace: 6 } }))).slice(0, 1), ['^BY2,3.0']);
  assert.deepEqual(emitLines(model(item({ symbology: 'code39', data: 'AB', widths: { narrowBar: 2, narrowSpace: 2, wideBar: 5, wideSpace: 5 } }))).slice(0, 1), ['^BY2,2.5']);
});

test('emit: every barcode has its own ^BY, so a later barcode never depends on the module of an earlier one', () => {
  const lines = emitLines(model(item({ module: 2 }), item({ module: 4, y: 300 }), item({ module: 2, y: 400 })));
  assert.deepEqual(lines.filter(l => l.startsWith('^BY')), ['^BY2', '^BY4', '^BY2']);
  const back = zpl.parse(zpl.emit(model(item({ module: 2 }), item({ module: 4, y: 300 }), item({ module: 2, y: 400 })), { dpi: DPI }).text, { dpi: DPI });
  assert.deepEqual(back.items.map(i => i.module), [2, 4, 2]);
});

test('emit: rotation and origin. Rotation 0 / 90 write ^FO (the anchor minus the height for 90), 180 / 270 write ^FT (the base of the bars)', () => {
  const at = rotation => emitLines(model(item({ rotation, x: 300, y: 300 })))[1].split('^BC')[0];
  assert.deepEqual([0, 90, 180, 270].map(at), ['^FO300,300', '^FO220,300', '^FT300,220', '^FT380,300']);
  // it parses back to the same anchor
  for (const rotation of [0, 90, 180, 270]) {
    const back = zpl.parse(zpl.emit(model(item({ rotation, x: 300, y: 300 })), { dpi: DPI }).text, { dpi: DPI }).items[0];
    assert.deepEqual([back.rotation, back.x, back.y], [rotation, 300, 300], String(rotation));
  }
});

test('emit: an item that came from a ^FO field keeps ^FO also rotated 180 / 270 (the length is measured with the encoder)', () => {
  for (const o of ['I', 'B']) {
    const src = `^FO100,50^BC${o},80,Y,N,N^FDCODE128^FS`;
    assert.deepEqual(roundTrip(src), ['^BY2', `^FO100,50^BC${o},80,Y,N,N^FDCODE128^FS`]);
  }
});

test('emit: the check digit options (Code 39 e, ITF e, MSI e), the add-on and the UPC-E digits', () => {
  const line = over => emitLines(model(item({ humanReadable: false, ...over })))[1];
  assert.equal(line({ symbology: 'code39', data: 'AB', check: 'mod43' }), '^FO100,200^B3N,Y,80,N,N^FDAB^FS');
  assert.equal(line({ symbology: 'itf', data: '1234', check: 'auto' }), '^FO100,200^B2N,80,N,N,Y^FD1234^FS');
  assert.equal(line({ symbology: 'itf', data: '1234', check: 'none' }), '^FO100,200^B2N,80,N,N,N^FD1234^FS');
  assert.equal(line({ symbology: 'msi', data: '1234', check: 'mod1110', widths: { narrowBar: 2, narrowSpace: 2, wideBar: 6, wideSpace: 6 } }), '^FO100,200^BMN,D,80,N,N^FD1234^FS');
  assert.equal(line({ symbology: 'ean13', data: '123456789012', check: 'auto', addon: 0 }), '^FO100,200^BEN,80,N,N^FD123456789012^FS');
  assert.equal(line({ symbology: 'upce', data: '012345', check: 'auto', addon: 0 }), '^FO100,200^B9N,80,N,N,Y^FD0123400005^FS');
  assert.equal(line({ symbology: 'upca', data: '12345678901', check: 'auto', addon: 0 }), '^FO100,200^BUN,80,N,N,Y^FD12345678901^FS');
  assert.equal(line({ symbology: 'code93', data: 'AB', check: 'auto' }), '^FO100,200^BAN,80,N,N,N^FDAB^FS');
  assert.equal(line({ symbology: 'codabar', data: 'B123C', check: 'none', widths: { narrowBar: 2, narrowSpace: 2, wideBar: 6, wideSpace: 6 } }), '^FO100,200^BKN,N,80,N,N,B,C^FD123^FS');
  assert.equal(line({ symbology: 'codabar', data: '123', check: 'none' }), '^FO100,200^BKN,N,80,N,N^FD123^FS');
  assert.equal(line({ symbology: 'industrial25', data: '1234', check: 'none' }), '^FO100,200^BIN,80,N,N^FD1234^FS');
});

test('emit: Code 128 data. FNC1 is >8 and a > is >0; data read with invocation codes is written back as it was', () => {
  assert.equal(emitLines(model(item({ data: `${FNC1}0112` })))[1], '^FO100,200^BCN,80,Y,N,N^FD>80112^FS');
  assert.equal(emitLines(model(item({ data: 'A>B' })))[1], '^FO100,200^BCN,80,Y,N,N^FDA>0B^FS');
  assert.equal(emitLines(model(item({ data: 'A^B' })))[1], '^FO100,200^BCN,80,Y,N,N^FH^FDA_5EB^FS');
  for (const src of ['^FO10,10^BCN,50,Y,N,N^FD>:CODE128^FS', '^FO10,10^BCN,50,Y,N,N^FD>;>8001234^FS', '^FO10,10^BCN,50,Y,N,N^FDA><B>=C^FS']) {
    assert.equal(roundTrip(src)[1], src);
  }
});

test('emit: ZPL has no EAN / UPC add-ons: they are dropped from the data with one warning; the price check digits of TPCL one warning too', () => {
  const result = emitResult(model(
    item({ symbology: 'ean13', data: '123456789012' + '12', addon: 2, check: 'auto' }),
    item({ symbology: 'ean8', data: '1234567' + '12345', addon: 5, check: 'auto', y: 300 }),
    item({ symbology: 'upca', data: '12345678901', check: 'unsupported', addon: 0, y: 400 }),
    item({ symbology: 'upce', data: '012345', check: 'unsupported', addon: 0, y: 450 })));
  const lines = result.text.split('\r\n');
  assert.ok(lines.includes('^FO100,200^BEN,80,Y,N^FD123456789012^FS'));
  assert.ok(lines.includes('^FO100,300^B8N,80,Y,N^FD1234567^FS'));
  assert.deepEqual(result.diagnostics.filter(d => /complemento/.test(d.text)).map(d => d.level), ['warning']);
  assert.deepEqual(result.diagnostics.filter(d => /control/.test(d.text)).map(d => d.level), ['warning']);
});

test('emit: a check digit option ZPL does not have is written as the default with one warning per symbology', () => {
  const result = emitResult(model(item({ symbology: 'ean13', data: '123456789012', check: 'none', addon: 0 }), item({ symbology: 'ean13', data: '123456789012', check: 'check', addon: 0, y: 300 }), item({ symbology: 'itf', data: '1234', check: 'mod43', y: 400 })));
  assert.equal(result.diagnostics.filter(d => /dígito de control/.test(d.text) && /ean13/.test(d.text)).length, 1);
  assert.equal(result.diagnostics.filter(d => /dígito de control/.test(d.text) && /itf/.test(d.text)).length, 1);
});

test('emit: types ZPL lacks are skipped with ONE warning per label; invalid EAN / UPC / Code 93 data is reported once per symbology, variables are not', () => {
  const skipped = emitResult(model(item({ symbology: 'unknown' }), item({ symbology: 'unknown', y: 300 }), item({ symbology: 'qr', y: 400 })));
  assert.deepEqual(skipped.text.split('\r\n').filter(l => /\^B/.test(l)), []);
  assert.deepEqual(skipped.diagnostics.filter(d => /sin equivalente en ZPL/.test(d.text)).map(d => d.level), ['warning']);
  const bad = emitResult(model(item({ symbology: 'ean13', data: '12', check: 'auto', addon: 0 }), item({ symbology: 'ean13', data: '34', check: 'auto', addon: 0, y: 300 }), item({ symbology: 'ean8', data: '<#X1#>', check: 'auto', addon: 0, y: 400 })));
  assert.equal(bad.diagnostics.filter(d => /no son válidos/.test(d.text)).length, 1);
});

test('emit: module outside 1..10 dots, ratio outside 2.0..3.0 and TPCL features without ZPL counterpart are reported once', () => {
  const wide = { narrowBar: 12, narrowSpace: 12, wideBar: 48, wideSpace: 48 };
  const result = emitResult(model(
    item({ symbology: 'code39', data: 'A', module: 12, widths: wide }),
    item({ symbology: 'code39', data: 'B', module: 12, widths: wide, y: 300 }),
    item({ symbology: 'ean13', data: '123456789012', check: 'auto', addon: 0, guard: 5, y: 400 }),
    item({ data: 'C', counter: { step: 1 }, zeroSuppress: 2, y: 450 })));
  assert.ok(result.text.includes('^BY10,3.0'));
  assert.equal(result.diagnostics.filter(d => /1.*10 puntos/.test(d.text)).length, 1);
  assert.equal(result.diagnostics.filter(d => /relación/.test(d.text) && /2\.0/.test(d.text)).length, 1);
  assert.equal(result.diagnostics.filter(d => /barra de guarda/.test(d.text)).length, 1);
  assert.equal(result.diagnostics.filter(d => /contador/.test(d.text)).length, 1);
});

test('emit: a barcode without explicit widths is written with ratio 3.0 and one info', () => {
  const result = emitResult(model(item({ symbology: 'code39', data: 'A' }), item({ symbology: 'itf', data: '1234', y: 300 })));
  assert.equal(result.diagnostics.filter(d => /sin anchos explícitos/.test(d.text)).length, 1);
  assert.ok(result.text.includes('^BY2,3.0'));
});

test('emit: size in dots follows the resolution, rotation not on a quarter turn is adjusted with a warning', () => {
  const at300 = emitLines(model(item({ height: 80, module: 2 })), 300)[1];
  assert.equal(at300, '^FO118,236^BCN,94,Y,N,N^FDABC^FS');
  const odd = emitResult(model(item({ rotation: 45 })));
  assert.equal(odd.diagnostics.filter(d => d.level === 'warning' && /90/.test(d.text)).length, 1);
});

for (const c of CASES) {
  for (const o of ['N', 'R', 'I', 'B']) {
    test(`round trip ^${c.name} ${o}: parse -> emit -> parse keeps the item`, () => {
      const first = parse(BASE(`^BY3,2.5${field(c, o)}`));
      const text = zpl.emit(first, { dpi: DPI }).text;
      const second = zpl.parse(text, { dpi: DPI });
      assert.deepEqual(second.diagnostics, [], text);
      const pick = i => [i.symbology, i.data, i.x, i.y, i.rotation, i.height, i.module, i.humanReadable, i.check, i.widths];
      assert.deepEqual(pick(second.items[0]), pick(first.items[0]), text);
      // the field itself is written back as it was (the ^BY gets its decimal form)
      assert.equal(roundTrip(`^BY3,2.5${field(c, o)}`).at(-1), field(c, o));
    });
  }
}

test('round trip: the line above (g), the UCC check, the mode and the UPC-E print check digit are kept as written', () => {
  for (const src of ['^FO10,10^BCN,50,Y,Y,Y,U^FD123^FS', '^FO10,10^B3N,Y,50,N,Y^FD123^FS', '^FO10,10^BUN,50,Y,N,N^FD12345678901^FS', '^FO10,10^B9N,50,Y,N,N^FD0123400005^FS', '^FO10,10^BAN,50,Y,N,Y^FDAB^FS', '^FO10,10^BMN,C,50,Y,N^FD1234^FS']) {
    assert.equal(roundTrip(src)[1], src);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Editing

const TEXT = '^XA\r\n^PW800\r\n^LL480\r\n^FO100,50^BCR,80,Y,N,N^FDABC123^FS\r\n^FO10,300^B3N,N,50,Y,N^FDAAA^FS\r\n^XZ';
const itemsOf = text => parse(text).items;
const update = (it, changes, text) => zpl.updateItem(text, it, changes, { dpi: DPI });
const describe = (it, text) => zpl.describeItem(it, text, { dpi: DPI });

test('describeItem: the fields of each command (symbology, check, height, rotation, readable, above, module, ratio, command extras, content, counter: the digits of every data of the cases allow the Incremento of Z7)', () => {
  const keys = c => describe(parse(BASE(field(c))).items[0], BASE(field(c))).fields.map(f => f.key);
  assert.deepEqual(keys(CASES[0]), ['symbology', 'height', 'rotation', 'readable', 'above', 'module', 'ucc', 'mode', 'content', 'counter']);
  assert.deepEqual(keys(CASES[1]), ['symbology', 'check', 'height', 'rotation', 'readable', 'above', 'module', 'ratio', 'content', 'counter']);
  assert.deepEqual(keys(CASES[3]), ['symbology', 'check', 'height', 'rotation', 'readable', 'above', 'module', 'content', 'counter']);
  assert.deepEqual(keys(CASES[5]), ['symbology', 'check', 'height', 'rotation', 'readable', 'above', 'module', 'printCheck', 'content', 'counter']);
  assert.deepEqual(keys(CASES[8]), ['symbology', 'check', 'height', 'rotation', 'readable', 'above', 'module', 'ratio', 'start', 'stop', 'content', 'counter']);
  assert.deepEqual(keys(CASES[9]), ['symbology', 'check', 'height', 'rotation', 'readable', 'above', 'module', 'ratio', 'content', 'counter']);
});

test('describeItem values from the text and without it (the model), and the data-driven options of the selector', () => {
  const [bc, b3] = itemsOf(TEXT);
  const d = byKey(describe(bc, TEXT));
  assert.deepEqual([d.symbology.value, d.height.value, d.rotation.value, d.readable.value, d.above.value, d.module.value, d.ucc.value, d.mode.value, d.content.value], ['code128', 80, 90, true, false, 2, false, 'N', 'ABC123']);
  assert.deepEqual(d.symbology.options.map(o => o.value), ['code128', 'code39', 'itf', 'code93', 'codabar', 'msi', 'industrial25', 'ean13', 'ean8', 'upca', 'upce']);
  assert.deepEqual(d.rotation.options.map(o => o.value), [0, 90, 180, 270]);
  assert.deepEqual([d.height.min, d.height.max], [1, 32000]);
  assert.deepEqual([d.module.min, d.module.max, d.module.step], [1, 10, 1]);
  const e = byKey(describe(b3, TEXT));
  assert.deepEqual([e.check.value, e.ratio.value, e.ratio.min, e.ratio.max, e.ratio.step], ['none', 3, 2, 3, 0.1]);
  assert.deepEqual(e.check.options.map(o => o.value), ['none', 'mod43']);
  const model = byKey(describe(b3));
  assert.deepEqual([model.symbology.value, model.height.value, model.module.value, model.ratio.value], ['code39', 50, 2, 3]);
  // the check options of each symbology come from the table of ZPL
  const checks = symbology => PB.slices.barcode.selector.checkOptions(PB.slices.barcode.zplTables.CHECK_CODES, symbology).map(o => o.value);
  assert.deepEqual([checks('code39'), checks('itf'), checks('msi'), checks('code128')], [['none', 'mod43'], ['none', 'auto'], ['none', 'auto', 'mod1010', 'mod1110'], []]);
});

test('describeItem: an empty height and orientation show the effective value (^BY height, ^FW)', () => {
  const text = BASE('^BY3,2.5,70^FWB^FO10,10^BC,,Y,N,N^FDabc^FS');
  const d = byKey(describe(parse(text).items[0], text));
  assert.deepEqual([d.height.value, d.rotation.value, d.module.value], [70, 270, 3]);
});

test('updateItem: height, rotation, human readable and the line above rewrite only their parameter', () => {
  const [bc, b3] = itemsOf(TEXT);
  assert.equal(update(bc, { height: 120 }, TEXT), TEXT.replace('^BCR,80,', '^BCR,120,'));
  assert.equal(update(bc, { rotation: 270 }, TEXT), TEXT.replace('^BCR,', '^BCB,'));
  assert.equal(update(bc, { readable: false }, TEXT), TEXT.replace('^BCR,80,Y,N,N', '^BCR,80,N,N,N'));
  assert.equal(update(bc, { above: true }, TEXT), TEXT.replace('^BCR,80,Y,N,N', '^BCR,80,Y,Y,N'));
  assert.equal(update(b3, { height: 60 }, TEXT), TEXT.replace('^B3N,N,50,', '^B3N,N,60,'));
  // invalid values and unknown keys change nothing; the range is clamped
  assert.equal(update(bc, { height: 'x', rotation: 45, readable: 'sí', nothing: 1 }, TEXT), TEXT);
  assert.equal(update(bc, { height: 99999 }, TEXT), TEXT.replace('^BCR,80,', '^BCR,32000,'));
});

test('updateItem fills the parameters a short command does not have (default values written in place)', () => {
  const text = BASE('^FO10,10^BC^FDabc^FS');
  const [it] = itemsOf(text);
  assert.equal(update(it, { height: 70 }, text), BASE('^FO10,10^BC,70^FDabc^FS'));
  assert.equal(update(it, { rotation: 90 }, text), BASE('^FO10,10^BCR^FDabc^FS'));
  assert.equal(update(it, { readable: false }, text), BASE('^FO10,10^BC,,N^FDabc^FS'));
  const sparse = BASE('^FO10,10^BCN,,,^FDabc^FS');
  assert.equal(update(itemsOf(sparse)[0], { height: 40 }, sparse), BASE('^FO10,10^BCN,40,,^FDabc^FS'));
});

test('the command extras: print check digit (^BU / ^B9 / ^BA e), UCC check and mode (^BC), codabar start / stop', () => {
  const upc = BASE('^FO10,10^BUN,50,Y,N,Y^FD12345678901^FS');
  assert.equal(update(itemsOf(upc)[0], { printCheck: false }, upc), upc.replace('^BUN,50,Y,N,Y', '^BUN,50,Y,N,N'));
  const bc = BASE('^FO10,10^BCN,50,Y,N,N^FDabc^FS');
  assert.equal(update(itemsOf(bc)[0], { ucc: true }, bc), bc.replace('^BCN,50,Y,N,N', '^BCN,50,Y,N,Y'));
  assert.equal(update(itemsOf(bc)[0], { mode: 'A' }, bc), bc.replace('^BCN,50,Y,N,N', '^BCN,50,Y,N,N,A'));
  assert.equal(update(itemsOf(bc)[0], { mode: 'Z' }, bc), bc);
  const bk = BASE('^FO10,10^BKN,N,50,Y,N^FD1234^FS');
  assert.equal(update(itemsOf(bk)[0], { start: 'B' }, bk), bk.replace('^BKN,N,50,Y,N', '^BKN,N,50,Y,N,B'));
  assert.equal(update(itemsOf(bk)[0], { stop: 'D' }, bk), bk.replace('^BKN,N,50,Y,N', '^BKN,N,50,Y,N,,D'));
  assert.equal(update(itemsOf(bk)[0], { stop: 'E' }, bk), bk);
});

test('the content is the ^FD data (read decoded, written with the hex escapes a ^ or ~ needs); Code 128 shows and writes the invocation codes as they are', () => {
  const [bc] = itemsOf(TEXT);
  assert.equal(update(bc, { content: 'XYZ' }, TEXT), TEXT.replace('^FDABC123', '^FDXYZ'));
  assert.equal(update(bc, { content: 'a^b' }, TEXT), TEXT.replace('^BCR,80,Y,N,N^FDABC123', '^BCR,80,Y,N,N^FH^FDa_5Eb'));
  const text = BASE('^FO10,10^BCN,50,Y,N,N^FD>:AB>8CD^FS');
  const [it] = itemsOf(text);
  assert.equal(byKey(describe(it, text)).content.value, '>:AB>8CD');
  assert.equal(update(it, { content: '>;123456' }, text), text.replace('>:AB>8CD', '>;123456'));
});

test('moveItem moves only the origin (^FO / ^FT) whatever the orientation', () => {
  const [bc, b3] = itemsOf(TEXT);
  assert.equal(zpl.moveItem(TEXT, bc, 100, 50, { dpi: DPI }), TEXT.replace('^FO100,50', '^FO200,100'));
  assert.equal(zpl.moveItem(TEXT, b3, -10, 10, { dpi: DPI }), TEXT.replace('^FO10,300', '^FO0,310'));
  const ft = BASE('^FT100,200^BCI,80,Y,N,N^FDABC^FS');
  assert.equal(zpl.moveItem(ft, itemsOf(ft)[0], 30, -20, { dpi: DPI }), ft.replace('^FT100,200', '^FT130,180'));
});

// --- Type selector

const SYMBOLOGIES = CASES.map(c => c.symbology);
const FIXTURE = c => BASE(`^FO100,50^BY3,2.5${c.cmd('R')}^FD${c.data}^FS^FO10,300^B3N,N,50,Y,N^FDAAA^FS`);

test('the selector offers the ZPL symbologies in the label order and the check options of each one', () => {
  const [it] = itemsOf(FIXTURE(CASES[0]));
  const options = byKey(describe(it, FIXTURE(CASES[0]))).symbology.options;
  assert.deepEqual(options.map(o => o.value), ['code128', 'code39', 'itf', 'code93', 'codabar', 'msi', 'industrial25', 'ean13', 'ean8', 'upca', 'upce']);
  assert.equal(options[0].label, 'Code 128');
  const checkOf = c => byKey(describe(itemsOf(FIXTURE(c))[0], FIXTURE(c))).check;
  assert.equal(checkOf(CASES[0]), undefined);
  assert.deepEqual(checkOf(CASES[2]).options.map(o => o.value), ['none', 'auto']);
  assert.deepEqual(checkOf(CASES[9]).options.map(o => [o.value, o.label]), [['none', 'Sin dígito de control'], ['auto', 'Añadir el dígito de control (automático)'], ['mod1010', 'Añadir módulo 10 + módulo 10 (IBM)'], ['mod1110', 'Añadir módulo 11 + módulo 10 (IBM)']]);
});

test('every change between two symbologies of ZPL: the new command is written for the new type, the data and every other command stay as they were', () => {
  for (const from of CASES) {
    const text = FIXTURE(from);
    const [it] = itemsOf(text);
    for (const to of CASES) {
      if (to === from) continue;
      const out = update(it, { symbology: to.symbology }, text);
      const label = `${from.symbology} -> ${to.symbology}`;
      assert.notEqual(out, text, label);
      assert.equal(maskCmd(out), maskCmd(text), label);
      assert.match(barcodeCmd(out), new RegExp(`^\\^${to.name}R,(?:[A-Z],)?80,Y,N`), `${label}: ${barcodeCmd(out)}`);
      assert.ok(out.includes(`^FD${from.data}^FS`), label);
      const [moved] = itemsOf(out);
      assert.deepEqual([moved.symbology, moved.rotation, moved.height, moved.humanReadable, moved.x, moved.y, moved.module], [to.symbology, 90, 80, true, 180, 50, 3], label);
      assert.equal(moved.native.type, to.name, label);
    }
  }
});

test('the written command of a type change: the exact text for a few (check option defaults, command extras carried only between the same kind)', () => {
  const cmdOf = (from, to, changes = {}) => barcodeCmd(update(itemsOf(FIXTURE(from))[0], { symbology: to.symbology, ...changes }, FIXTURE(from)));
  const [bc, b3, b2, be, b8, bu, b9, ba, bk, bm, bi] = CASES;
  assert.equal(cmdOf(bc, b3), '^B3R,N,80,Y,N');
  assert.equal(cmdOf(bc, b2), '^B2R,80,Y,N,N');
  assert.equal(cmdOf(b3, bc), '^BCR,80,Y,N,N');
  assert.equal(cmdOf(b3, bm), '^BMR,A,80,Y,N');
  assert.equal(cmdOf(bm, b3), '^B3R,N,80,Y,N');
  assert.equal(cmdOf(be, b8), '^B8R,80,Y,N');
  assert.equal(cmdOf(be, bu), '^BUR,80,Y,N,Y');
  assert.equal(cmdOf(bu, b9), '^B9R,80,Y,N,Y');
  assert.equal(cmdOf(bu, ba), '^BAR,80,Y,N,Y');
  assert.equal(cmdOf(ba, bk), '^BKR,N,80,Y,N');
  assert.equal(cmdOf(bk, bi), '^BIR,80,Y,N');
  assert.equal(cmdOf(bi, bc), '^BCR,80,Y,N,N');
  // the check option at the same time
  assert.equal(cmdOf(bc, b3, { check: 'mod43' }), '^B3R,Y,80,Y,N');
  assert.equal(cmdOf(bc, bm, { check: 'mod1010' }), '^BMR,C,80,Y,N');
  assert.equal(cmdOf(bc, b2, { check: 'auto' }), '^B2R,80,Y,N,Y');
});

test('the check digit selector rewrites the e parameter of the same symbology', () => {
  const field3 = '^FO10,10^B3N,N,50,Y,N^FDAAA^FS';
  const text = BASE(field3);
  const [it] = itemsOf(text);
  assert.equal(update(it, { check: 'mod43' }, text), BASE('^FO10,10^B3N,Y,50,Y,N^FDAAA^FS'));
  const itf = BASE('^FO10,10^B2N,50,Y,N,N^FD1234^FS');
  assert.equal(update(itemsOf(itf)[0], { check: 'auto' }, itf), BASE('^FO10,10^B2N,50,Y,N,Y^FD1234^FS'));
  const msi = BASE('^FO10,10^BMN,B,50,Y,N^FD1234^FS');
  const msiCmd = check => barcodeCmd(update(itemsOf(msi)[0], { check }, msi));
  assert.deepEqual(['none', 'auto', 'mod1010', 'mod1110'].map(msiCmd), ['^BMN,A,50,Y,N', '^BMN,B,50,Y,N', '^BMN,C,50,Y,N', '^BMN,D,50,Y,N']);
  // refused: not a row of the table, or nothing changes
  assert.equal(update(it, { check: 'mod1010' }, text), text);
  assert.equal(update(it, { check: 'none' }, text), text);
  assert.equal(update(it, { symbology: 'code39' }, text), text);
  assert.equal(update(it, { symbology: 'pdf417' }, text), text);
});

test('a type change that would lose information is refused: Code 128 invocation codes, a mode or UCC check, a codabar start / stop character', () => {
  const refuse = (src, to = 'code39') => { const text = BASE(src); assert.equal(update(itemsOf(text)[0], { symbology: to }, text), text, src); };
  refuse('^FO10,10^BCN,50,Y,N,N^FD>:ABC^FS');
  refuse('^FO10,10^BCN,50,Y,N,N,A^FDABC^FS');
  refuse('^FO10,10^BCN,50,Y,N,Y^FD123^FS');
  refuse('^FO10,10^BKN,N,50,Y,N,B,C^FD123^FS');
  refuse('^FO10,10^BKN,N,50,Y,N,,C^FD123^FS');
  // the same barcode kept as Code 128 keeps them
  const ok = BASE('^FO10,10^BCN,50,Y,N,N^FD>:ABC^FS');
  assert.equal(update(itemsOf(ok)[0], { height: 60 }, ok), BASE('^FO10,10^BCN,60,Y,N,N^FD>:ABC^FS'));
  // moving to Code 128 from another symbology is allowed
  const to128 = BASE('^FO10,10^B3N,N,50,Y,N^FDABC^FS');
  assert.equal(update(itemsOf(to128)[0], { symbology: 'code128' }, to128), BASE('^FO10,10^BCN,50,Y,N,N^FDABC^FS'));
});

test('a type change refuses a symbology that is not offered and a field that does not use it (^BJ is not offered, but its type can be changed)', () => {
  const bj = BASE('^FO10,10^BJN,50,Y,N^FD1234^FS');
  const [it] = itemsOf(bj);
  assert.equal(byKey(describe(it, bj)).symbology.value, 'industrial25');
  assert.equal(update(it, { symbology: 'code39' }, bj), BASE('^FO10,10^B3N,N,50,Y,N^FD1234^FS'));
});

// --- Module and ratio: ^BY

const TWO = '^XA\r\n^PW800\r\n^LL480\r\n^BY3,2.5\r\n^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n^FO10,100^B3N,N,50,Y,N^FDBBB^FS\r\n^XZ';

test('module edit, the governing ^BY belongs to this barcode only: it is rewritten in place', () => {
  const text = '^XA\r\n^BY3,2.5\r\n^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n^XZ';
  const [it] = itemsOf(text);
  assert.equal(update(it, { module: 5 }, text), text.replace('^BY3,2.5', '^BY5,2.5'));
  assert.equal(update(it, { ratio: 2.2 }, text), text.replace('^BY3,2.5', '^BY3,2.2'));
  assert.equal(update(it, { ratio: 3 }, text), text.replace('^BY3,2.5', '^BY3,3.0'));
  // the ^BY inside the field is rewritten too
  const inner = '^XA\r\n^FO10,10^B3N,N,50,Y,N^BY4^FDAAA^FS\r\n^XZ';
  assert.equal(update(itemsOf(inner)[0], { module: 6 }, inner), inner.replace('^BY4', '^BY6'));
  // the value is clamped to 1..10 and 2.0..3.0
  assert.equal(update(it, { module: 99 }, text), text.replace('^BY3,2.5', '^BY10,2.5'));
  assert.equal(update(it, { ratio: 9 }, text), text.replace('^BY3,2.5', '^BY3,3.0'));
});

test('module edit, no ^BY at all and no other barcode: a ^BY is added before the field', () => {
  const text = '^XA\r\n^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n^XZ';
  const [it] = itemsOf(text);
  assert.equal(update(it, { module: 4 }, text), '^XA\r\n^BY4\r\n^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n^XZ');
  assert.equal(update(it, { ratio: 2.5 }, text), '^XA\r\n^BY,2.5\r\n^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n^XZ');
  const inline = '^XA^FO10,10^B3N,N,50,Y,N^FDAAA^FS^XZ';
  assert.equal(update(itemsOf(inline)[0], { module: 4 }, inline), '^XA^BY4^FO10,10^B3N,N,50,Y,N^FDAAA^FS^XZ');
});

test('module edit, the ^BY also governs other barcodes: a field-local ^BY before the field and the previous values right after its ^FS', () => {
  const [first, second] = itemsOf(TWO);
  const out = update(first, { module: 5 }, TWO);
  assert.equal(out, TWO.replace('^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n', '^BY5\r\n^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n^BY3\r\n'));
  const [a, b] = itemsOf(out);
  assert.deepEqual([a.module, b.module], [5, 3]);
  assert.deepEqual([a.widths.wideBar, b.widths.wideBar], [12, 7]);
  // the last barcode, too: the following text (here ^XZ) is not affected
  const last = update(second, { module: 6 }, TWO);
  assert.equal(last, TWO.replace('^FO10,100^B3N,N,50,Y,N^FDBBB^FS\r\n', '^BY6\r\n^FO10,100^B3N,N,50,Y,N^FDBBB^FS\r\n^BY3\r\n'));
  assert.deepEqual(itemsOf(last).map(i => i.module), [3, 6]);
  // both ^BY parameters restored when both were changed in the same ^BY: the ratio only restores the ratio
  const ratio = update(first, { ratio: 2 }, TWO);
  assert.equal(ratio, TWO.replace('^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n', '^BY,2.0\r\n^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n^BY,2.5\r\n'));
  assert.deepEqual(itemsOf(ratio).map(i => [i.module, i.widths.wideBar]), [[3, 6], [3, 7]]);
});

test('module edit: a second edit of the same barcode rewrites its own local ^BY (nothing piles up)', () => {
  const once = update(itemsOf(TWO)[0], { module: 5 }, TWO);
  const twice = update(itemsOf(once)[0], { module: 7 }, once);
  assert.equal(twice, once.replace('^BY5', '^BY7'));
  assert.deepEqual(itemsOf(twice).map(i => i.module), [7, 3]);
});

test('module edit on one line (no line breaks): the local ^BY and the restoring one are written inline', () => {
  const text = '^XA^BY3,2.5^FO10,10^B3N,N,50,Y,N^FDAAA^FS^FO10,100^B3N,N,50,Y,N^FDBBB^FS^XZ';
  const out = update(itemsOf(text)[0], { module: 5 }, text);
  assert.equal(out, '^XA^BY3,2.5^BY5^FO10,10^B3N,N,50,Y,N^FDAAA^FS^BY3^FO10,100^B3N,N,50,Y,N^FDBBB^FS^XZ');
  assert.deepEqual(itemsOf(out).map(i => i.module), [5, 3]);
});

test('module edit: only the barcodes that see the ^BY count (a later ^BY that sets the module ends its reach; an earlier barcode does not see a later ^BY)', () => {
  const text = '^XA\r\n^FO10,10^B3N,N,50,Y,N^FDAAA^FS\r\n^BY4\r\n^FO10,100^B3N,N,50,Y,N^FDBBB^FS\r\n^BY6\r\n^FO10,200^B3N,N,50,Y,N^FDCCC^FS\r\n^XZ';
  const [a, b, c] = itemsOf(text);
  // the second barcode is the only one under ^BY4 (^BY6 takes over for the third): rewritten in place
  assert.equal(update(b, { module: 5 }, text), text.replace('^BY4', '^BY5'));
  // the first one has no ^BY: nothing before it is affected, but the later ^BY4 sets the module again, so it is alone too
  assert.equal(update(a, { module: 5 }, text), text.replace('^FO10,10', '^BY5\r\n^FO10,10'));
  assert.equal(update(c, { module: 8 }, text), text.replace('^BY6', '^BY8'));
  // the ratio is not set by the later ^BY4 / ^BY6, so it is shared by the three: a local ^BY
  const r = update(b, { ratio: 2.5 }, text);
  assert.equal(r, text.replace('^FO10,100^B3N,N,50,Y,N^FDBBB^FS\r\n', '^BY,2.5\r\n^FO10,100^B3N,N,50,Y,N^FDBBB^FS\r\n^BY,3.0\r\n'));
  assert.deepEqual(itemsOf(r).map(i => [i.module, i.widths.wideBar]), [[2, 6], [4, 10], [6, 18]]);
});

test('module edit: a ^BY inside the field that others depend on cannot be rewritten (refused)', () => {
  const text = '^XA\r\n^FO10,10^B3N,N,50,Y,N^BY4^FDAAA^FS\r\n^FO10,100^B3N,N,50,Y,N^FDBBB^FS\r\n^XZ';
  assert.equal(itemsOf(text).length, 2);
  assert.equal(update(itemsOf(text)[0], { module: 6 }, text), text);
});

test('module edit works for every symbology and the ratio field only exists for the wide / narrow ones', () => {
  for (const c of CASES) {
    const text = BASE(`^BY3,2.5${field(c)}^FO10,300^BCN,50,Y,N,N^FDZZ^FS`);
    const [it] = itemsOf(text);
    const out = update(it, { module: 4 }, text);
    assert.deepEqual(itemsOf(out).map(i => i.module), [4, 3], c.symbology);
    const has = Boolean(byKey(describe(it, text)).ratio);
    assert.equal(has, WIDE_NARROW.includes(c.symbology), c.symbology);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Palette

test('the palette Código de barras: ^BY2,3,h ^FO x,y ^BCN,h,Y,N,N ^FD<#CODIGOn#> ^FS before ^XZ at the drop point, upright in a rotated view', () => {
  const base = '^XA\r\n^PW800\r\n^LL480\r\n^XZ\r\n';
  const build = (text, options) => zpl.buildComponent(text, 'barcode', { x: 100, y: 50 }, { dpi: DPI, ...options });
  const first = build(base, {});
  assert.equal(first, '^XA\r\n^PW800\r\n^LL480\r\n^BY2,3,80^FO100,50^BCN,80,Y,N,N^FD<#CODIGO1#>^FS\r\n^XZ\r\n');
  assert.equal(build(first, {}).split('\r\n').filter(l => l.includes('^BC')).pop(), '^BY2,3,80^FO100,50^BCN,80,Y,N,N^FD<#CODIGO2#>^FS');
  assert.match(build(base, { viewRotation: 90 }), /\^BCB,80,Y,N,N/);
  assert.match(build(base, { viewRotation: 180 }), /\^BCI,80,Y,N,N/);
  assert.match(build(base, { viewRotation: 270 }), /\^BCR,80,Y,N,N/);
  const model = parse(first);
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual([model.items[0].kind, model.items[0].symbology, model.items[0].data, model.items[0].rotation, model.items[0].height, model.items[0].module, model.items[0].native.origin], ['barcode', 'code128', '<#CODIGO1#>', 0, 80, 2, 'FO']);
  // the same physical height (8 mm) at every resolution
  assert.match(zpl.buildComponent(base, 'barcode', { x: 100, y: 50 }, { dpi: 300 }), /\^BY2,3,94\^FO118,59\^BCN,94,Y,N,N\^FD/);
  // ^LH and ^LS are subtracted from the drop point
  assert.match(zpl.buildComponent('^XA^LH10,20^XZ', 'barcode', { x: 100, y: 50 }, { dpi: DPI }), /\^FO90,30\^BCN/);
});

test('a palette barcode edited afterwards: the module of a new barcode does not touch the others', () => {
  const base = '^XA\r\n^XZ\r\n';
  const build = (text, x, y) => zpl.buildComponent(text, 'barcode', { x, y }, { dpi: DPI });
  const text = build(build(base, 10, 10), 10, 200);
  const [a, b] = itemsOf(text);
  const out = update(a, { module: 4 }, text);
  assert.deepEqual(itemsOf(out).map(i => i.module), [4, 2]);
  // each palette barcode brought its own ^BY: the first one's is private, so it was rewritten (no extra ^BY)
  assert.equal(out.split('^BY').length, text.split('^BY').length);
  assert.ok(b);
});

// ---------------------------------------------------------------------------------------------------------------
// Rendering and validation (shared with the other languages)

const slice = PB.components.get('barcode');
const renderItem = i => slice.render(i, { n: v => v, esc: s => s, rectsPath: rects => rects.map(r => r.join(' ')).join(';'), value: v => v });

test('the ZPL items flow through the shared renderer and validator: bars, human readable text, guard bars and rotation', () => {
  const draw = src => PB.svgRenderer.render(parse(BASE(src)), { width: 800, height: 480 }, { textScale: 1, values: {} }).svg;
  const ean = draw('^FO10,10^BEN,80,Y,N^FD123456789012^FS');
  assert.ok(ean.includes('class="human-readable"'));
  assert.ok(ean.includes('class="hit"'));
  assert.ok(!draw('^FO10,10^BEN,80,N,N^FD123456789012^FS').includes('human-readable'));
  assert.ok(draw('^FO10,10^BCR,80,Y,N,N^FDabc^FS').includes('rotate(90 '));
  const model = parse(BASE('^FO10,10^BCN,80,Y,N,N^FDabc^FS^FO10,100^BEN,80,Y,N^FD123456789012^FS^FO10,200^BMN,B,80,Y,N^FD123^FS'));
  assert.deepEqual(PB.validator.validate(model, zpl), []);
});

test('the data validation of the shared path reaches the ZPL item: invalid data of each symbology is reported by the renderer', () => {
  const warn = (src) => renderItem(one(src)).warnings;
  assert.ok(warn('^FO10,10^BEN,80,Y,N^FDabc^FS').length > 0);
  assert.ok(warn('^FO10,10^B2N,80,Y,N,N^FDabc^FS').length > 0);
  assert.ok(warn('^FO10,10^B3N,N,80,Y,N^FDabc^FS').length > 0, 'Code 39 has no lower case');
  assert.ok(warn('^FO10,10^BMN,B,80,Y,N^FDabc^FS').length > 0);
  assert.deepEqual(warn('^FO10,10^BEN,80,Y,N^FD123456789012^FS'), []);
  // UPC-E data that cannot be zero suppressed keeps the digits and is reported
  const model = parse(BASE('^FO10,10^B9N,80,Y,N,Y^FD1234567890^FS'));
  assert.ok(model.diagnostics.some(d => d.level === 'warning' && /\^B9/.test(d.text)));
  assert.equal(model.items[0].data, '1234567890');
  assert.ok(renderItem(model.items[0]).warnings.length > 0);
});

test('measure gives the length of the drawn bars in 0.1 mm (0 when nothing can be drawn)', () => {
  const m = i => measure(i);
  assert.ok(m(one('^BY2^FO10,10^BCN,80,Y,N,N^FDABC^FS')) > 0);
  assert.equal(m(one('^BY4^FO10,10^BCN,80,Y,N,N^FDABC^FS')), 2 * m(one('^BY2^FO10,10^BCN,80,Y,N,N^FDABC^FS')));
  assert.equal(m(one('^FO10,10^BEN,80,Y,N^FDabc^FS')), 0);
  assert.equal(m(one('^FO10,10^BEN,80,Y,N^FD123456789012^FS')), 95 * 2);
});

// ---------------------------------------------------------------------------------------------------------------
// Conversions through the shared pipeline

const TPCL = {
  code128: '{XB01;0300,0200,9,1,03,1,0120,0,000,1,00|}{RB01;ABC123|}',
  code39: '{XB01;0300,0200,3,3,03,03,09,09,03,1,0120,1|}{RB01;ABC123|}',
  itf: '{XB01;0300,0200,2,1,03,03,09,09,00,1,0120,1|}{RB01;123456|}',
  ean13: '{XB01;0300,0200,5,3,03,1,0120,0,000,1,00|}{RB01;123456789012|}',
  ean8: '{XB01;0300,0200,0,3,03,1,0120,0,000,1,00|}{RB01;1234567|}',
  upca: '{XB01;0300,0200,K,3,03,1,0120,0,000,1,00|}{RB01;12345678901|}',
  upce: '{XB01;0300,0200,6,3,03,1,0120,0,000,1,00|}{RB01;012345|}',
  code93: '{XB01;0300,0200,C,3,03,1,0120,0,000,1,00|}{RB01;ABC123|}',
  codabar: '{XB01;0300,0200,4,1,03,03,09,09,03,1,0120,1|}{RB01;A1234B|}',
  msi: '{XB01;0300,0200,1,4,03,03,09,09,00,1,0120,1|}{RB01;123456|}',
  industrial25: '{XB01;0300,0200,O,1,03,03,09,00,03,1,0120,1|}{RB01;123456|}',
};
const tpclLabel = body => ['{D0500,1000,0500|}', '{AX;+000,+000,+00|}', '{C|}', body, '{XS;I,0001,0002C4100|}'].join('\r\n');
const TSPL = {
  code128: 'BARCODE 200,50,"128",96,1,90,2,2,"ABC123"',
  code39: 'BARCODE 200,50,"39C",96,1,90,2,5,"ABC123"',
  itf: 'BARCODE 200,50,"25",96,1,90,2,5,"123456"',
  ean13: 'BARCODE 200,50,"EAN13",96,1,90,2,2,"123456789012"',
  ean8: 'BARCODE 200,50,"EAN8",96,1,90,2,2,"1234567"',
  upca: 'BARCODE 200,50,"UPCA",96,1,90,2,2,"12345678901"',
  upce: 'BARCODE 200,50,"UPCE",96,1,90,2,2,"012345"',
  code93: 'BARCODE 200,50,"93",96,1,90,2,4,"ABC123"',
  codabar: 'BARCODE 200,50,"CODA",96,1,90,2,5,"A1234B"',
};
const tsplText = line => ['SIZE 100 mm,60 mm', 'CLS', line, 'PRINT 1,1', ''].join('\r\n');

function sameBarcode(a, b, label) {
  assert.deepEqual([a.symbology, a.data, a.rotation, a.humanReadable], [b.symbology, b.data, b.rotation, b.humanReadable], label);
  near(a.x, b.x, 2, `x ${label}`);
  near(a.y, b.y, 2, `y ${label}`);
  near(a.height, b.height, 2, `height ${label}`);
  near(a.module, b.module, 0.7, `module ${label}`);
  assert.equal(a.check, b.check, `check ${label}`);
  if (a.widths) near(a.widths.wideBar / a.widths.narrowBar, b.widths.wideBar / b.widths.narrowBar, 0.3, `ratio ${label}`);
}

for (const [symbology, body] of Object.entries(TPCL)) {
  test(`TPCL -> ZPL -> TPCL: ${symbology} keeps position, rotation 90, height, module, data, human readable and the check option`, () => {
    const text = tpclLabel(body);
    const result = PB.convert.run(text, 'zpl', { dpi: 203 });
    assert.equal(result.source, 'tpcl');
    assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), [], symbology);
    const original = tpcl.parse(text, { dpi: 203 }).items[0];
    const back = zpl.parse(result.text, { dpi: 203 });
    assert.deepEqual(levels(back.diagnostics, 'warning', 'error'), [], result.text);
    sameBarcode(back.items[0], original, symbology);
    // and back to TPCL
    const again = PB.convert.run(result.text, 'tpcl', { dpi: 203 });
    assert.deepEqual(levels(again.diagnostics, 'warning', 'error'), [], symbology);
    const final = tpcl.parse(again.text, { dpi: 203 }).items[0];
    sameBarcode(final, original, `${symbology} (tpcl)`);
  });
}

for (const [symbology, line] of Object.entries(TSPL)) {
  test(`TSPL -> ZPL -> TSPL: ${symbology} keeps position, rotation 90, height, module, data and human readable`, () => {
    const text = tsplText(line);
    const result = PB.convert.run(text, 'zpl', { dpi: 203 });
    assert.equal(result.source, 'tspl');
    assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), [], symbology);
    const original = tspl.parse(text, { dpi: 203 }).items[0];
    const back = zpl.parse(result.text, { dpi: 203 });
    assert.deepEqual(levels(back.diagnostics, 'warning', 'error'), [], result.text);
    sameBarcode(back.items[0], original, symbology);
    const again = PB.convert.run(result.text, 'tspl', { dpi: 203 });
    const final = tspl.parse(again.text, { dpi: 203 }).items[0];
    sameBarcode(final, original, `${symbology} (tspl)`);
  });
}

test('ZPL -> TPCL and ZPL -> TSPL: each ZPL symbology becomes the neutral one the target writes; TSPL has no MSI and no Industrial 2 of 5 (skipped with a warning)', () => {
  const src = BASE(CASES.map((c, i) => `^FO100,${50 + i * 100}${c.cmd('N')}^FD${c.data}^FS`).join(''));
  const original = zpl.parse(src, { dpi: 203 });
  for (const [target, language] of [['tpcl', tpcl], ['tspl', tspl]]) {
    const result = PB.convert.run(src, target, { dpi: 203 });
    const back = language.parse(result.text, { dpi: 203 }).items.filter(i => i.kind === 'barcode');
    const expected = original.items.filter(i => target === 'tpcl' || !['msi', 'industrial25'].includes(i.symbology));
    assert.deepEqual(back.map(i => i.symbology), expected.map(i => i.symbology), target);
    assert.deepEqual(back.map(i => i.data), expected.map(i => i.data), target);
    if (target === 'tspl') assert.equal(result.diagnostics.filter(d => /msi|industrial25/.test(d.text)).length, 2);
    else assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), []);
  }
});

test('conversions to ZPL: ZPL has no EAN / UPC add-ons and no TPCL price check digits (warnings); the types it lacks are skipped with one warning', () => {
  const addon = PB.convert.run(tpclLabel('{XB01;0300,0200,7,3,03,1,0120,0,000,1,00|}{RB01;12345678901234|}{XB02;0300,0400,5,4,03,1,0120,0,000,1,00|}{RB02;123456789012|}'), 'zpl', { dpi: 203 });
  assert.deepEqual(addon.diagnostics.filter(d => /complemento/.test(d.text)).map(d => d.level), ['warning']);
  assert.deepEqual(addon.diagnostics.filter(d => /control/.test(d.text)).map(d => d.level), ['warning']);
  const back = zpl.parse(addon.text, { dpi: 203 }).items;
  assert.deepEqual(back.map(i => i.data), ['123456789012', '123456789012']);
  const unknown = PB.convert.run(tsplText('BARCODE 40,50,"CODE11",96,1,0,2,2,"12345"\r\nBARCODE 40,150,"POSTNET",96,1,0,2,2,"12345"'), 'zpl', { dpi: 203 });
  assert.equal(unknown.diagnostics.filter(d => /sin equivalente en ZPL/.test(d.text)).length, 1);
  assert.deepEqual(zpl.parse(unknown.text, { dpi: 203 }).items, []);
});

test('conversions from ZPL: the ZPL features the other languages lack (line above, mode, UCC check) are reported once as an info of the source', () => {
  const src = BASE('^FO10,10^BCN,50,Y,Y,Y,U^FD123^FS^FO10,100^B3N,N,50,Y,Y^FDABC^FS');
  for (const target of ['tpcl', 'tspl']) {
    const result = PB.convert.run(src, target, { dpi: 203 });
    assert.equal(result.parseDiagnostics.filter(d => d.level === 'info' && /sobre el código/.test(d.text)).length, 1, target);
    assert.equal(result.parseDiagnostics.filter(d => d.level === 'info' && /UCC|modo/.test(d.text)).length, 1, target);
    assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), [], target);
  }
});

test('ZPL -> ZPL through Convertir keeps the barcodes (every symbology, rotation) with the invocation codes', () => {
  const src = BASE(CASES.map((c, i) => `^BY3,2.5^FO100,${50 + i * 100}${c.cmd(['N', 'R', 'I', 'B'][i % 4])}^FD${c.data}^FS`).join('') + '^FO10,5^BCN,50,Y,N,N^FD>:A>8B^FS');
  const result = PB.convert.run(src, 'zpl', { dpi: 203 });
  const [a, b] = [zpl.parse(src, { dpi: 203 }), zpl.parse(result.text, { dpi: 203 })];
  assert.equal(a.items.length, CASES.length + 1);
  assert.deepEqual(levels(b.diagnostics, 'warning', 'error'), []);
  const pick = i => [i.symbology, i.data, i.rotation, i.height, i.module, i.humanReadable, i.check, i.native.type, i.native.origin];
  assert.deepEqual(b.items.map(pick), a.items.map(pick));
  a.items.forEach((x, i) => { near(b.items[i].x, x.x, 1.3, `x ${i}`); near(b.items[i].y, x.y, 1.3, `y ${i}`); });
});

// ---------------------------------------------------------------------------------------------------------------
// ITF check digit (^B2 e = Y, "Mod 10 check digit") and the documentation

test('the ITF encoder attaches the modulus 10 check digit with check "auto" (before the pair padding), and the viewer draws it', () => {
  // 7 digits: 7*3 + 6 + 5*3 + 4 + 3*3 + 2 + 1*3 = 60 -> check 0; 6 digits: 18 + 5 + 12 + 3 + 6 + 1 = 45 -> check 5, odd length, padded with a 0
  assert.equal(PB.itf.encode('1234567', { check: 'auto' }).text, '12345670');
  assert.equal(PB.itf.encode('123456', { check: 'auto' }).text, '01234565');
  assert.equal(PB.itf.encode('123456', { check: 'none' }).text, '123456');
  assert.equal(PB.itf.encode('123456').text, '123456');
  const plain = measure(one('^BY2^FO10,10^B2N,80,Y,N,N^FD123456^FS'));
  const checked = measure(one('^BY2^FO10,10^B2N,80,Y,N,Y^FD123456^FS'));
  assert.ok(checked > plain, 'the check digit lengthens the bars');
  // TPCL and TSPL have no ITF check option: converting reports it
  const result = PB.convert.run(BASE('^FO10,10^B2N,80,Y,N,Y^FD1234567^FS'), 'tspl', { dpi: 203 });
  assert.equal(result.diagnostics.filter(d => d.level === 'warning' && /itf/.test(d.text)).length, 1);
});

test('the guide examples parse without diagnostics (Code 39 with the full ASCII pairs, Code 128 with subsets A / C codes)', () => {
  assert.deepEqual(parse('^XA^FO20,20^B3N,N,100,Y^FDTEST+$$M$J-$^FS^XZ').diagnostics, []);
  assert.equal(parse('^XA^FO20,20^B3N,N,100,Y^FDTEST+$$M$J-$^FS^XZ').items[0].data, 'TEST+$$M$J-$');
  assert.deepEqual(parse('^XA^FO100,75^BCN,100,Y,N,N^FDCODE128^FS^XZ').diagnostics, []);
  assert.equal(parse('^XA^FO100,75^BCN,100,Y,N,N^FD>:CODE128^FS^XZ').items[0].data, 'CODE128');
});

test('README documents the ZPL barcodes: the commands, ^BY, the selector and what is not verified', () => {
  const readme = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'README.md'), 'utf8');
  for (const needle of ['^BC', '^B3', '^B2', '^BE', '^B8', '^BU', '^B9', '^BA', '^BK', '^BM', '^BI', '^BY', 'Tipo de código', 'Dígito de control', 'not verified on a printer']) {
    assert.ok(readme.includes(needle), needle);
  }
});

// Volume Two, printed pages 95-97 (Mod 10 and Mod 43 check digits): the worked examples of the guide.
test('Volume Two page 96: the Mod 10 example 01234567890 has the check digit 5 (the viewer anchors the weights 3, 1 at the right digit, which agrees for an odd number of digits; an even number is not settled by the guide)', () => {
  assert.equal(PB.itf.encode('01234567890', { check: 'auto' }).text, '012345678905');
});

test('Volume Two page 97: the Mod 43 example 12345ABCDE/ sums 115, 115 mod 43 = 29, the check character is T', () => {
  assert.equal(PB.code39.checkCharacter('12345ABCDE/'), 'T');
  assert.equal(PB.code39.encode('12345ABCDE/', { check: 'mod43' }).characters, 12);
});
