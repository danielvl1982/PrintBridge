const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// Data Matrix slice (task D1): TPCL XB type Q (B-SV4 spec 6.3.9) and TSPL DMATRIX (B-442/443 manual), neutral item `datamatrix`:
// parse, emit, edit, palette, conversion, drawing and validation. The encoder itself is tested in datamatrix-encoder.test.js.
const PB = loadUpTo('js/palette.js');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const dm = PB.datamatrix;

const DOT = 254 / 203;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label || ''} ${actual} != ${expected}`);
const XS = '{XS;I,0001,0000C6000|}';
const BASE = `{D0500,0800,0400|}\n{C|}\n${XS}\n`;
const XB = '{XB01;0100,0200,Q,20,04,00,0|}';
const DM_TPCL = `${XB}\n{RB01;HELLO|}`;
const itemsOf = (text, dpi = 203) => tpcl.parse(text, { dpi }).items;
const describe = (text, index = 0) => tpcl.describeItem(itemsOf(text)[index], text);
const update = (text, changes, index = 0) => tpcl.updateItem(text, itemsOf(text)[index], changes, { dpi: 203 });
const field = (d, key) => d.fields.find(f => f.key === key);
const problems = diagnostics => diagnostics.filter(d => d.level === 'warning' || d.level === 'error');

const HEAD = 'SIZE 100 mm,60 mm\r\nCLS\r\n';
const TAIL = 'PRINT 1,1\r\n';
const doc = (...lines) => HEAD + lines.map(l => `${l}\r\n`).join('') + TAIL;
const tsplItems = (text, dpi = 203) => tspl.parse(text, { dpi }).items;
const tsplDescribe = text => tspl.describeItem(tsplItems(text)[0], text, { dpi: 203 });
const tsplUpdate = (text, changes) => tspl.updateItem(text, tsplItems(text)[0], changes, { dpi: 203 });
const FULL = 'DMATRIX 10,20,48,48,4,12,12,"HELLO"';
const AREA = 'DMATRIX 10,20,200,200,"HELLO"';

// ---------------------------------------------------------------------------------------------------------------------------
// Registration

test('datamatrix registers as a slice after QR with label, glyph, renderer, validator and both language hooks', () => {
  const slice = PB.components.get('datamatrix');
  assert.ok(slice);
  assert.deepEqual([slice.label, slice.order], ['Data Matrix', 35]);
  assert.equal(typeof slice.glyph, 'string');
  assert.equal(typeof slice.render, 'function');
  assert.equal(typeof slice.validate, 'function');
  assert.equal(typeof slice.languages.tpcl, 'function');
  assert.equal(typeof slice.languages.tspl, 'function');
  assert.deepEqual(PB.components.kinds(), ['text', 'barcode', 'qr', 'datamatrix', 'line', 'box', 'ellipse', 'circle', 'area', 'image']);
  assert.equal(PB.components.forItem({ kind: 'datamatrix', ref: 'XB01' }).kind, 'datamatrix');
});

test('both languages list Data Matrix in their palette right after QR', () => {
  assert.deepEqual(tpcl.componentTemplates().map(c => c.kind), ['text', 'barcode', 'qr', 'datamatrix', 'line', 'box', 'area']);
  assert.deepEqual(tspl.componentTemplates().map(c => c.kind), ['text', 'barcode', 'qr', 'datamatrix', 'line', 'box', 'ellipse', 'circle', 'area']);
  assert.deepEqual(tpcl.componentTemplates()[3], { kind: 'datamatrix', label: 'Data Matrix' });
});

// ---------------------------------------------------------------------------------------------------------------------------
// TPCL parse

test('XB type Q builds the neutral datamatrix item with the RB data', () => {
  const model = tpcl.parse(DM_TPCL);
  assert.equal(model.items.length, 1);
  assert.deepEqual(problems(model.diagnostics), []);
  const item = model.items[0];
  assert.equal(item.kind, 'datamatrix');
  assert.equal(item.ref, 'XB01');
  assert.equal(item.symbology, 'datamatrix');
  assert.deepEqual([item.x, item.y, item.rotation, item.ecc, item.data], [100, 200, 0, 200, 'HELLO']);
  assert.equal(item.size, undefined);
  near(item.cell, 4 * DOT);
  assert.deepEqual(item.raw, { x: '0100', y: '0200', cell: '04' });
  assert.deepEqual(item.native, { type: 'Q', ecc: 20, cell: 4, formatId: '00', rotation: '0' });
  assert.deepEqual(item.source.spans, [{ start: 0, end: XB.length }]);
});

test('the cell width converts with the dpi and the rotation digit 0..3 is 0, 90, 180, 270', () => {
  near(itemsOf(DM_TPCL, 300)[0].cell, 4 * 254 / 300);
  const rotations = [0, 1, 2, 3].map(d => itemsOf(`{XB01;0100,0200,Q,20,04,00,${d}|}\n{RB01;A|}`)[0].rotation);
  assert.deepEqual(rotations, [0, 90, 180, 270]);
});

test('the number of cells (Ciiijjj) forces a square size from the table; 000000 and unknown values stay automatic', () => {
  const sizeOf = tail => tpcl.parse(`{XB01;0100,0200,Q,20,04,00,0${tail}|}\n{RB01;A|}`);
  assert.equal(sizeOf(',C018018').items[0].size, 18);
  assert.equal(sizeOf(',C144144').items[0].size, 144);
  assert.equal(sizeOf(',C000000').items[0].size, undefined);
  assert.deepEqual(problems(sizeOf(',C000000').diagnostics), []);
  // The manual: any other value leaves the number of cells automatic
  assert.equal(sizeOf(',C017017').items[0].size, undefined);
  assert.equal(sizeOf(',C018020').items[0].size, undefined);
  // A rectangular code of the manual is reported
  const rect = sizeOf(',C018008');
  assert.equal(rect.items[0].size, undefined);
  assert.match(problems(rect.diagnostics)[0].text, /rectangular/);
  assert.deepEqual(rect.items[0].native.cells, { x: '018', y: '008' });
});

test('a connection setting (Jkkllmmmnnn) is reported and kept in native', () => {
  const model = tpcl.parse('{XB01;0100,0200,Q,20,04,00,0,J0102001002|}\n{RB01;A|}');
  assert.equal(model.items.length, 1);
  assert.match(problems(model.diagnostics)[0].text, /XB01.*enlace/);
  assert.equal(model.items[0].native.connection, 'J0102001002');
});

test('inline data (=data) is read and the RB data command wins', () => {
  assert.equal(tpcl.parse('{XB01;0100,0200,Q,20,04,00,0=INLINE|}').items[0].data, 'INLINE');
  assert.equal(tpcl.parse('{XB01;0100,0200,Q,20,04,00,0=INLINE|}\n{RB01;LATER|}').items[0].data, 'LATER');
});

test('the generic barcode handler leaves well-formed Q commands to the slice; a malformed one stays a barcode', () => {
  const model = tpcl.parse('{XB01;0100,0200,Q,20,04,00,0|}\n{XB02;0100,0300,9,1,02,0,0080,+0000000000,000,0,00|}\n{XB03;0100,0400,Q,|}');
  assert.deepEqual(model.items.map(i => [i.ref, i.kind]), [['XB01', 'datamatrix'], ['XB02', 'barcode'], ['XB03', 'barcode']]);
});

test('Data Matrix does not change how a QR (type T) is parsed', () => {
  assert.equal(tpcl.parse('{XB01;0010,0010,T,H,04,A,0,M2|}').items[0].kind, 'qr');
});

test('the 2-digit module rule applies to Data Matrix', () => {
  const warn = src => tpcl.validate(tpcl.parse(src)).map(d => d.text);
  assert.deepEqual(warn('{XB01;0100,0200,Q,20,4,00,0|}\n{RB01;A|}'), ['XB01: tamaño de módulo "4" no tiene 2 dígitos']);
  assert.deepEqual(warn(DM_TPCL), []);
});

test('moveItem rewrites only the coordinates', () => {
  const [item] = itemsOf(DM_TPCL);
  assert.equal(tpcl.moveItem(DM_TPCL, item, 50, -20, { dpi: 203 }), DM_TPCL.replace('0100,0200', '0150,0180'));
});

// ---------------------------------------------------------------------------------------------------------------------------
// TPCL emit

const emitTpcl = (items, dpi = 203) => PB.languages.emit('tpcl', { language: 'tpcl', size: { width: 990, height: 550, pitch: 610, gap: null, native: { axRaw: 'AX;+010,+000,+00' } }, items, diagnostics: [] }, { dpi });
const bodyTpcl = (items, dpi) => emitTpcl(items, dpi).text.split('\n').slice(3, -1);
const dmItem = (props = {}) => ({ kind: 'datamatrix', x: 100, y: 200, cell: 5.0049, rotation: 0, ecc: 200, symbology: 'datamatrix', data: 'HELLO', ...props });

test('emit writes XB type Q: ECC200 (20), cell in dots, format ID 00, rotation digit', () => {
  assert.deepEqual(bodyTpcl([dmItem()]), ['{XB00;0100,0200,Q,20,04,00,0|}', '{RB00;HELLO|}']);
  assert.deepEqual(bodyTpcl([dmItem({ rotation: 270, cell: 7 * DOT })])[0], '{XB00;0100,0200,Q,20,07,00,3|}');
});

test('emit adds the number of cells for a forced size and omits it for automatic', () => {
  assert.equal(bodyTpcl([dmItem({ size: 24 })])[0], '{XB00;0100,0200,Q,20,04,00,0,C024024|}');
  assert.equal(bodyTpcl([dmItem({ size: undefined })])[0], '{XB00;0100,0200,Q,20,04,00,0|}');
});

test('emit clamps the cell to 1..99 with one warning, keeps 00 (not drawn) and snaps odd rotations', () => {
  const big = emitTpcl([dmItem({ cell: 500 }), dmItem({ cell: 600 })]);
  assert.equal(big.text.split('\n')[3].split(',')[4], '99');
  assert.equal(problems(big.diagnostics).length, 1);
  assert.equal(bodyTpcl([dmItem({ cell: 0 })])[0].split(',')[4], '00');
  assert.deepEqual(problems(emitTpcl([dmItem({ cell: 0 })]).diagnostics), []);
  const odd = emitTpcl([dmItem({ rotation: 100 })]);
  assert.equal(odd.text.split('\n')[3].split(',')[6].slice(0, 1), '1');
  assert.match(problems(odd.diagnostics)[0].text, /rotación/);
});

test('emit writes ECC200 for another ECC type, with one warning', () => {
  const out = emitTpcl([dmItem({ ecc: 0 }), dmItem({ ecc: 140 })]);
  assert.ok(out.text.includes('Q,20,'));
  assert.equal(problems(out.diagnostics).filter(d => /ECC/.test(d.text)).length, 1);
});

test('emit of an item with an area and no cell (TSPL area form) fits the cell: floor(area dots / symbol side)', () => {
  const item = dmItem({ cell: null, area: { width: 200 * DOT, height: 300 * DOT }, native: { width: 200, height: 300 } });
  // HELLO -> 12x12, 200 / 12 = 16 dots
  assert.equal(bodyTpcl([item])[0].split(',')[4], '16');
});

test('TPCL parse -> emit -> parse keeps the neutral item', () => {
  const text = '{XB01;0100,0200,Q,20,06,00,2,C032032|}\n{RB01;ABC-123|}';
  const [a] = itemsOf(text);
  const [b] = tpcl.parse(PB.languages.emit('tpcl', tpcl.parse(text), { dpi: 203 }).text).items;
  for (const key of ['kind', 'x', 'y', 'rotation', 'size', 'ecc', 'data', 'symbology']) assert.equal(b[key], a[key], key);
  near(b.cell, a.cell);
});

// ---------------------------------------------------------------------------------------------------------------------------
// TPCL edit

test('describeItem lists module size, rotation, symbol size and content', () => {
  const d = describe(DM_TPCL);
  assert.equal(d.kind, 'datamatrix');
  assert.deepEqual(d.fields.map(f => [f.key, f.value]), [['cell', 4], ['rotation', 0], ['size', 0], ['content', 'HELLO']]);
  assert.equal(field(d, 'cell').type, 'number');
  assert.deepEqual([field(d, 'cell').min, field(d, 'cell').max], [1, 99]);
  assert.equal(field(d, 'rotation').type, 'select');
  assert.deepEqual(field(d, 'size').options.map(o => o.value), [0, ...dm.SIZES.map(s => s.side)]);
  assert.equal(field(d, 'size').options[0].label, 'Automático');
  assert.equal(field(d, 'size').options[1].label, '10 × 10');
  assert.equal(describe('{XB01;0100,0200,Q,20,04,00,1,C032032|}\n{RB01;A|}').fields.find(f => f.key === 'size').value, 32);
});

test('describeItem without the text uses the model values', () => {
  const d = tpcl.describeItem(itemsOf(DM_TPCL)[0]);
  assert.deepEqual(d.fields.map(f => [f.key, f.value]), [['cell', 4], ['rotation', 0], ['size', 0], ['content', 'HELLO']]);
});

test('updateItem rewrites only the changed field and keeps the digit width', () => {
  assert.equal(update(DM_TPCL, { cell: 6 }), DM_TPCL.replace('Q,20,04', 'Q,20,06'));
  assert.equal(update(DM_TPCL, { cell: 500 }), DM_TPCL.replace('Q,20,04', 'Q,20,99'));
  assert.equal(update(DM_TPCL, { rotation: 90 }), DM_TPCL.replace('00,0|}', '00,1|}'));
  assert.equal(update(DM_TPCL, { content: 'WORLD 2' }), DM_TPCL.replace('HELLO', 'WORLD 2'));
});

test('updateItem sets, changes and clears the forced size, keeping the other parameters byte for byte', () => {
  assert.equal(update(DM_TPCL, { size: 24 }), DM_TPCL.replace('00,0|}', '00,0,C024024|}'));
  const forced = '{XB01;0100,0200,Q,20,04,00,0,C024024|}\n{RB01;HELLO|}';
  assert.equal(update(forced, { size: 40 }), forced.replace('C024024', 'C040040'));
  assert.equal(update(forced, { size: 0 }), DM_TPCL);
  assert.equal(update(DM_TPCL, { size: 0 }), DM_TPCL, 'automatic stays automatic');
  assert.equal(update(DM_TPCL, { size: 11 }), DM_TPCL, 'a size outside the table is ignored');
  // A connection setting and a rectangular size are never touched
  const connected = '{XB01;0100,0200,Q,20,04,00,0,J0102001002|}\n{RB01;HELLO|}';
  assert.equal(update(connected, { cell: 5 }), connected.replace('Q,20,04', 'Q,20,05'));
  assert.equal(update(connected, { size: 20 }), connected.replace(',J0102', ',C020020,J0102'));
  assert.equal(update(connected, { size: 0 }), connected);
  const rect = '{XB01;0100,0200,Q,20,04,00,0,C018008|}\n{RB01;HELLO|}';
  assert.equal(update(rect, { size: 20 }), rect);
  assert.equal(field(describe(rect), 'size'), undefined, 'a rectangular size is not offered');
});

// ---------------------------------------------------------------------------------------------------------------------------
// TPCL palette

test('the TPCL palette inserts XB type Q plus RB with a <#DATAMATRIX1#> variable at the drop point', () => {
  const out = tpcl.buildComponent(BASE, 'datamatrix', { x: 100, y: 200 }, { dpi: 203 });
  assert.ok(out.includes('{XB01;0100,0200,Q,20,04,00,0|}\n{RB01;<#DATAMATRIX1#>|}\n'));
  assert.ok(out.indexOf('{XB01') < out.indexOf(XS), 'written before the print command');
  const model = tpcl.parse(out, { dpi: 203 });
  assert.deepEqual(problems([...model.diagnostics, ...tpcl.validate(model), ...PB.validator.validate(model, tpcl)]), []);
  assert.deepEqual(PB.variables.namesInModel(model), ['DATAMATRIX1']);
  assert.equal(model.items[0].kind, 'datamatrix');
  // a second one gets the next variable and the next id
  const twice = tpcl.buildComponent(out, 'datamatrix', { x: 300, y: 200 }, { dpi: 203 });
  assert.ok(twice.includes('{XB02;0300,0200,Q,20,04,00,0|}\n{RB02;<#DATAMATRIX2#>|}'));
});

test('the TPCL palette item looks upright in a rotated view', () => {
  const out = tpcl.buildComponent(BASE, 'datamatrix', { x: 100, y: 200 }, { dpi: 203, viewRotation: 90 });
  assert.ok(out.includes('{XB01;0100,0200,Q,20,04,00,3|}'));
});

// ---------------------------------------------------------------------------------------------------------------------------
// TSPL parse

test('DMATRIX with the optional module, rows and columns builds the neutral item', () => {
  const model = tspl.parse(doc(FULL));
  assert.deepEqual(problems(model.diagnostics), []);
  const [item] = model.items;
  assert.equal(item.kind, 'datamatrix');
  assert.equal(item.ref, 'DMATRIX');
  assert.deepEqual([item.symbology, item.rotation, item.ecc, item.size, item.data], ['datamatrix', 0, 200, 12, 'HELLO']);
  near(item.x, 10 * DOT);
  near(item.y, 20 * DOT);
  near(item.cell, 4 * DOT);
  near(item.area.width, 48 * DOT);
  near(item.area.height, 48 * DOT);
  assert.deepEqual(item.native, { width: 48, height: 48, xm: 4, rows: 12, cols: 12 });
});

test('DMATRIX without the optional group has no module: the code fits the width and height', () => {
  const [item] = tsplItems(doc(AREA));
  assert.equal(item.cell, null);
  assert.equal(item.size, undefined);
  near(item.area.width, 200 * DOT);
  assert.deepEqual(item.native, { width: 200, height: 200, xm: null, rows: null, cols: null });
});

test('DMATRIX: rows and columns 0 are automatic; a rectangle or a size outside the table is reported', () => {
  assert.equal(tsplItems(doc('DMATRIX 10,20,48,48,4,0,0,"A"'))[0].size, undefined);
  assert.deepEqual(problems(tspl.parse(doc('DMATRIX 10,20,48,48,4,0,0,"A"')).diagnostics), []);
  for (const tail of ['8,18', '13,13', '18,20']) {
    const model = tspl.parse(doc(`DMATRIX 10,20,48,48,4,${tail},"A"`));
    assert.equal(model.items[0].size, undefined, tail);
    assert.match(problems(model.diagnostics)[0].text, /DMATRIX.*tamaño/, tail);
  }
});

test('DMATRIX: an incomplete command, bad numbers, a module of 0 and odd optional groups are reported', () => {
  assert.deepEqual(tspl.parse(doc('DMATRIX 10,20,48')).items, []);
  assert.match(problems(tspl.parse(doc('DMATRIX 10,20,48')).diagnostics)[0].text, /DMATRIX incompleto/);
  assert.match(problems(tspl.parse(doc('DMATRIX a,20,48,48,"A"')).diagnostics)[0].text, /DMATRIX.*no válid/);
  assert.match(problems(tspl.parse(doc('DMATRIX 10,20,0,48,"A"')).diagnostics)[0].text, /DMATRIX.*no válid/);
  const zero = tspl.parse(doc('DMATRIX 10,20,48,48,0,12,12,"A"'));
  assert.equal(zero.items[0].cell, null);
  assert.match(problems(zero.diagnostics)[0].text, /módulo/);
  const odd = tspl.parse(doc('DMATRIX 10,20,48,48,4,12,"A"'));
  assert.equal(odd.items.length, 1);
  assert.match(problems(odd.diagnostics)[0].text, /DMATRIX.*parámetros/);
});

test('DMATRIX applies REFERENCE and shows a counter as literal text with one info', () => {
  near(tsplItems(doc('REFERENCE 10,5', FULL))[0].x, 20 * DOT);
  const model = tspl.parse(doc('DMATRIX 10,20,48,48,"x"+@1', 'DMATRIX 10,60,48,48,"y"+@2'));
  assert.deepEqual(model.items.map(i => i.data), ['"x"+@1', '"y"+@2']);
  assert.equal(model.diagnostics.filter(d => d.level === 'info').length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------------
// TSPL emit

const emitTspl = (items, dpi = 203) => PB.languages.emit('tspl', { language: 'tspl', size: { width: 1000, height: 600, pitch: null, gap: 30, native: {} }, items, diagnostics: [] }, { dpi });
const bodyTspl = (items, dpi) => emitTspl(items, dpi).text.split('\r\n').filter(l => l.startsWith('DMATRIX'));

test('TSPL emit writes the full form with module, rows and columns of the drawn symbol', () => {
  // HELLO -> 12x12, 4 dots per module -> 48 x 48 dots
  assert.deepEqual(bodyTspl([dmItem()]), ['DMATRIX 80,160,48,48,4,12,12,"HELLO"']);
  assert.deepEqual(bodyTspl([dmItem({ size: 24 })]), ['DMATRIX 80,160,96,96,4,24,24,"HELLO"']);
  // a"b is 3 codewords: 10x10, 40 dots
  assert.deepEqual(bodyTspl([dmItem({ data: 'a"b' })]), ['DMATRIX 80,160,40,40,4,10,10,"a\\["]b"']);
});

test('TSPL emit keeps the area form of an item without a module', () => {
  const item = dmItem({ cell: null, area: { width: 200 * DOT, height: 200 * DOT }, native: { width: 200, height: 200 } });
  assert.deepEqual(bodyTspl([item]), ['DMATRIX 80,160,200,200,"HELLO"']);
  // a forced size needs the module (the group is all or nothing): it is fitted, 200 / 14 = 14 dots; width and height stay
  assert.deepEqual(bodyTspl([{ ...item, size: 14 }]), ['DMATRIX 80,160,200,200,14,14,14,"HELLO"']);
});

test('TSPL emit reports a rotation, another ECC type and a cell of 0 once', () => {
  const rotated = emitTspl([dmItem({ rotation: 90 }), dmItem({ rotation: 180 })]);
  assert.equal(problems(rotated.diagnostics).filter(d => /rotación/.test(d.text)).length, 1);
  assert.equal(bodyTspl([dmItem({ rotation: 90 })]).length, 1);
  const ecc = emitTspl([dmItem({ ecc: 0 }), dmItem({ ecc: 140 })]);
  assert.equal(problems(ecc.diagnostics).filter(d => /ECC/.test(d.text)).length, 1);
  const zero = emitTspl([dmItem({ cell: 0 })]);
  assert.deepEqual(bodyTspl([dmItem({ cell: 0 })]), []);
  assert.equal(problems(zero.diagnostics).filter(d => /módulo/.test(d.text)).length, 1);
});

test('TSPL emit of data the viewer cannot encode falls back to the area of the item or the largest symbol, with a warning', () => {
  const long = emitTspl([dmItem({ data: 'A'.repeat(1600) })]);
  assert.equal(long.text.split('\r\n').find(l => l.startsWith('DMATRIX')).split(',').slice(2, 4).join(','), `${144 * 4},${144 * 4}`);
  assert.equal(problems(long.diagnostics).length, 1);
});

test('TSPL parse -> emit -> parse keeps the neutral item, in both forms', () => {
  for (const line of [FULL, AREA, 'DMATRIX 10,20,96,96,4,24,24,"https://x.y/?a=1,2"']) {
    const [a] = tsplItems(doc(line));
    const out = PB.languages.emit('tspl', tspl.parse(doc(line)), { dpi: 203 }).text;
    const [b] = tspl.parse(out).items;
    for (const key of ['kind', 'size', 'data', 'rotation']) assert.equal(b[key], a[key], `${line}: ${key}`);
    assert.equal(b.cell === null, a.cell === null);
    if (a.cell !== null) near(b.cell, a.cell);
    near(b.x, a.x);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// TSPL edit and palette

test('TSPL describeItem: width, height, module, symbol size and content', () => {
  const d = tsplDescribe(doc(FULL));
  assert.equal(d.kind, 'datamatrix');
  assert.deepEqual(d.fields.map(f => [f.key, f.value]), [['width', 48], ['height', 48], ['cell', 4], ['size', 12], ['content', 'HELLO']]);
  assert.deepEqual(field(d, 'size').options.map(o => o.value), dm.SIZES.map(s => s.side));
  assert.deepEqual(tsplDescribe(doc(AREA)).fields.map(f => [f.key, f.value]), [['width', 200], ['height', 200], ['content', 'HELLO']]);
  assert.deepEqual(tspl.describeItem(tsplItems(doc(FULL))[0]).fields.map(f => f.key), ['width', 'height', 'cell', 'size', 'content']);
});

test('TSPL updateItem rewrites only the chosen arguments', () => {
  assert.equal(tsplUpdate(doc(FULL), { width: 60 }), doc(FULL.replace('48,48', '60,48')));
  assert.equal(tsplUpdate(doc(FULL), { cell: 6 }), doc(FULL.replace(',4,12', ',6,12')));
  assert.equal(tsplUpdate(doc(FULL), { size: 24 }), doc(FULL.replace('12,12', '24,24')));
  assert.equal(tsplUpdate(doc(FULL), { size: 13 }), doc(FULL), 'a size outside the table is ignored');
  assert.equal(tsplUpdate(doc(FULL), { content: 'A,B' }), doc(FULL.replace('HELLO', 'A,B')));
  assert.equal(tsplUpdate(doc(AREA), { size: 24 }), doc(AREA), 'the area form has no size to edit');
  assert.equal(tsplUpdate(doc(AREA), { content: 'X' }), doc(AREA.replace('HELLO', 'X')));
});

test('TSPL moveItem moves x and y only', () => {
  const [item] = tsplItems(doc(FULL));
  assert.equal(tspl.moveItem(doc(FULL), item, 10 * DOT, -5 * DOT, { dpi: 203 }), doc(FULL.replace('10,20', '20,15')));
});

test('the TSPL palette inserts a DMATRIX with module and size before PRINT and parses back without diagnostics', () => {
  const base = doc('TEXT 10,10,"3",0,1,1,"hello"');
  const out = tspl.buildComponent(base, 'datamatrix', { x: 100, y: 100 }, { dpi: 203 });
  // <#DATAMATRIX1#> has 15 characters -> 18x18 -> 72 dots at 4 dots per module
  assert.ok(out.includes('DMATRIX 80,80,72,72,4,18,18,"<#DATAMATRIX1#>"\r\nPRINT 1,1'));
  const model = tspl.parse(out);
  assert.deepEqual(problems(model.diagnostics), []);
  assert.deepEqual(problems(PB.validator.validate(model, tspl)), []);
  assert.equal(model.items.at(-1).kind, 'datamatrix');
  assert.equal(model.items.at(-1).size, 18);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Conversion

const convert = (text, target, dpi = 203) => PB.convert.run(text, target, { dpi });

test('TPCL -> TSPL writes DMATRIX with the module, the size of the drawn symbol and the data', () => {
  const out = convert(`${BASE}${DM_TPCL}\n`, 'tspl');
  assert.ok(out.text.includes('DMATRIX 80,160,48,48,4,12,12,"HELLO"'));
  assert.deepEqual(problems(out.diagnostics), []);
  const [item] = tspl.parse(out.text).items.filter(i => i.kind === 'datamatrix');
  assert.deepEqual([item.data, item.size], ['HELLO', 12]);
  near(item.cell, 4 * DOT);
});

test('TPCL -> TSPL: a rotation (no TSPL equivalent) and an ECC type other than 200 are reported once', () => {
  const rotated = convert(`${BASE}{XB01;0100,0200,Q,20,04,00,1|}\n{RB01;HELLO|}\n`, 'tspl');
  assert.equal(problems(rotated.diagnostics).filter(d => /rotación/.test(d.text)).length, 1);
  const ecc = convert(`${BASE}{XB01;0100,0200,Q,00,04,00,0|}\n{RB01;HELLO|}\n`, 'tspl');
  assert.equal(problems(ecc.diagnostics).filter(d => /ECC/.test(d.text)).length, 1);
  assert.ok(ecc.text.includes('DMATRIX '), 'still written');
});

test('TSPL -> TPCL writes XB type Q; a module-less DMATRIX gets the cell that fits its width and height', () => {
  const full = convert(doc(FULL), 'tpcl');
  assert.ok(full.text.includes('{XB00;0013,0025,Q,20,04,00,0,C012012|}\n{RB00;HELLO|}'));
  assert.deepEqual(problems(full.diagnostics), []);
  const area = convert(doc(AREA), 'tpcl');
  assert.ok(area.text.includes('{XB00;0013,0025,Q,20,16,00,0|}'));
  const [item] = tpcl.parse(area.text).items;
  assert.deepEqual([item.kind, item.data, item.size], ['datamatrix', 'HELLO', undefined]);
});

test('conversion keeps position, data, module and size of a Data Matrix both ways', () => {
  const text = `${BASE}{XB01;0300,0400,Q,20,06,00,0,C032032|}\n{RB01;ORDER 0042-17|}\n`;
  const [a] = tpcl.parse(text).items;
  const [b] = tspl.parse(convert(text, 'tspl').text).items;
  const [c] = tpcl.parse(convert(convert(text, 'tspl').text, 'tpcl').text).items;
  for (const other of [b, c]) {
    assert.equal(other.kind, 'datamatrix');
    assert.deepEqual([other.data, other.size], [a.data, a.size]);
    assert.ok(Math.abs(other.x - a.x) <= DOT && Math.abs(other.y - a.y) <= DOT);
    assert.ok(Math.abs(other.cell - a.cell) <= DOT);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Drawing

const area = { width: 1000, height: 800 };
const draw = (model, opts = {}) => PB.svgRenderer.render(model, area, opts);
const darkModules = text => { const out = dm.encode(text); let n = 0; for (let r = 0; r < out.side; r++) for (let c = 0; c < out.side; c++) if (out.isDark(r, c)) n++; return n; };

test('the drawing is one path with a rectangle per dark module, a hit rectangle and the size in mm as info', () => {
  const { svg, diagnostics } = draw(tpcl.parse(DM_TPCL));
  assert.match(svg, /<rect class="hit" x="100" y="200"/);
  assert.equal((svg.match(/M[\d.]+ [\d.]+h/g) || []).length, darkModules('HELLO'));
  const info = diagnostics.find(d => d.text.startsWith('XB01'));
  assert.match(info.text, /^XB01: Data Matrix 12×12 módulos = 6 mm$/);
});

test('the symbol modules are at the cell pitch (first dark module of the finder at the origin)', () => {
  const { svg } = draw(tpcl.parse(DM_TPCL));
  assert.ok(svg.includes('M100 200h5.3v5.3h-5.3z'), 'cell 5.00 + the 0.3 overlap of the QR drawing');
});

test('a rotation turns the symbol around its origin, like the 1D barcodes', () => {
  const model = tpcl.parse('{XB01;0100,0200,Q,20,04,00,1|}\n{RB01;HELLO|}');
  assert.match(draw(model).svg, /<g transform="rotate\(90 100 200\)">/);
  assert.doesNotMatch(draw(tpcl.parse(DM_TPCL)).svg, /rotate\(0/);
});

test('variables are replaced before encoding and a forced size is honoured (an unfit one falls back to the smallest)', () => {
  const model = tpcl.parse('{XB01;0100,0200,Q,20,04,00,0,C032032|}\n{RB01;<#V#>|}');
  const sizeOf = opts => draw(model, opts).diagnostics.find(d => /Data Matrix/.test(d.text)).text.match(/(\d+)×\d+/)[1];
  assert.equal(sizeOf({ values: { V: 'HI' } }), '32');
  assert.equal(sizeOf({ values: { V: 'A'.repeat(100) } }), '40', '100 characters do not fit 32x32 (62): the smallest that fits is used');
});

test('data that cannot be encoded, an ECC type other than 200 and a module of 0 draw a hatched placeholder', () => {
  const placeholder = text => draw(tpcl.parse(text));
  const long = placeholder(`{XB01;0100,0200,Q,20,04,00,0|}\n{RB01;${'A'.repeat(1600)}|}`);
  assert.match(long.svg, /class="not-generated"/);
  assert.match(long.diagnostics[0].text, /no se ha podido generar/);
  assert.match(placeholder('{XB01;0100,0200,Q,00,04,00,0|}\n{RB01;A|}').svg, /class="not-generated"/);
  const zero = placeholder('{XB01;0100,0200,Q,20,00,00,0|}\n{RB01;A|}');
  assert.match(zero.svg, /class="not-generated"/);
  assert.match(zero.diagnostics[0].text, /módulo 0/);
  assert.match(placeholder('{XB01;0100,0200,Q,20,04,00,0|}\n{RB01;€|}').svg, /class="not-generated"/);
});

test('an item without a module fits its width and height in whole dots (TSPL area form)', () => {
  const { diagnostics } = draw(tspl.parse(doc(AREA)));
  // 12x12 in 200 dots -> 16 dots per module -> 192 dots = 24,0 mm
  assert.match(diagnostics.find(d => /Data Matrix/.test(d.text)).text, /Data Matrix 12×12 módulos = 24 mm/);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Validation

test('validation reports data that does not fit, characters outside 0..255, a forced size that is too small and ECC / module', () => {
  const warn = (item, language = tpcl) => PB.validator.validate({ language: language.id, size: {}, items: [{ ref: 'XB01', ...dmItem(), ...item }], diagnostics: [] }, language).map(d => d.text);
  assert.deepEqual(warn({}), []);
  assert.match(warn({ data: 'A'.repeat(1559) })[0], /^XB01: .*144×144/);
  assert.match(warn({ data: 'a€' })[0], /^XB01: .*0-255/);
  assert.match(warn({ data: 'A'.repeat(20), size: 12 })[0], /^XB01: .*12×12/);
  assert.match(warn({ ecc: 0 })[0], /^XB01: .*ECC/);
  assert.match(warn({ cell: 0 })[0], /^XB01: .*módulo/);
  assert.deepEqual(warn({ data: '<#V#>' }), [], 'a variable stands for a value that is not known here');
  assert.match(warn({ data: null })[0], /sin texto ni comando de datos/);
  assert.deepEqual(warn({ data: '' }), []);
});
