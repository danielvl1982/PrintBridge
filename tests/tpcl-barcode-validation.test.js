const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// V3 TPCL barcodes, QR and Data Matrix, checked against the manuals (B-SV4 2004 6.3.9 / 6.3.12, B-452-R 2012 6.3.10 / 6.3.13, B-452-TS12 ES 6.12 / 6.15):
//   generic form  {XBaa;bbbb,cccc,d,e,ff,k,llll(,mnnnnnnnnnn,ooo,p,qq)(=data)|}     aa 00..31, e 1..5, ff 01..15, k 0..3, llll 0000..1000, ooo 000..100, p 0 / 1, qq 00..20
//   widths form   {XBaa;bbbb,cccc,d,e,ff,gg,hh,ii,jj,k,llll(,mnnnnnnnnnn,p,qq)(,r)|}  ff..jj 01..99 (ii = 00 for Industrial 2 of 5, jj = 00 for MSI / ITF), r T / P / N
//   QR            {XBaa;bbbb,cccc,T,e,ff,g,h(,Mi)(,Kj)(,Jkkllmm)(=data)|}              e L / M / Q / H, ff 00..52, g M / A, h 0..3, i 1 / 2, j 0..8, kk 01..16, ll 01..16
//   Data Matrix   {XBaa;bbbb,cccc,Q,ee,ff,gg,h(,Ciiijjj)(,Jkkllmmmnnn)(=data)|}       ee 00..14 / 20, ff 00..99, gg format ID, iii / jjj 000..144, kk 01..16, ll 02..16, mmm / nnn 001..254
//   data: 126 characters for the 1D types, 2000 for QR and Data Matrix; the printer discards the excess.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const DPI = 203;
const DOT = PB.units.dotSize(DPI);

const parse = text => tpcl.parse(text, { dpi: DPI });
const warnings = text => parse(text).diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const itemOf = text => parse(text).items[0];
const describe = text => tpcl.describeItem(parse(text).items[0], text);
const field = (text, key) => describe(text).fields.find(f => f.key === key);

const widthsForm = (tail = '3,1,02,02,06,06,02,0,0100,1', id = '00') => `{XB${id};0100,0200,${tail}|}`;
const generic = (tail = '9,1,02,0,0080,0,000,1,00', id = '00') => `{XB${id};0100,0200,${tail}|}`;
const qr = (tail = 'T,H,04,A,0,M2', id = '00') => `{XB${id};0100,0200,${tail}|}`;
const dm = (tail = 'Q,20,04,00,0', id = '00') => `{XB${id};0100,0200,${tail}|}`;

// ---- Parsing: valid commands raise nothing

test('parse: valid commands of every form, with every parameter at its limits, raise no warning', () => {
  assert.deepEqual(warnings(widthsForm()), []);
  // Start / stop options are valid but the viewer does not model them (its own, older notice)
  const modelled = text => warnings(text).filter(w => !/inicio\/parada|enlace de símbolos/.test(w));
  assert.deepEqual(modelled(widthsForm('3,3,01,99,99,99,99,3,1000,1,20,T')), []);
  assert.deepEqual(modelled(widthsForm('2,1,02,02,06,06,00,0,0100,+0000000001,1,05,N')), []);
  assert.deepEqual(warnings(widthsForm('O,1,02,02,06,00,02,0,0100,0')), []);
  assert.deepEqual(warnings(generic()), []);
  assert.deepEqual(warnings(generic('5,3,15,3,1000,+9999999999,100,1,20')), []);
  assert.deepEqual(warnings(generic('9,1,01,0,0000,0,000,0,00')).filter(w => !/altura/.test(w)), []);
  assert.deepEqual(warnings(qr()), []);
  assert.deepEqual(warnings(qr('T,L,52,M,3,M1,K8,J0102FF')), []);
  assert.deepEqual(warnings(dm()), []);
  assert.deepEqual(modelled(dm('Q,20,99,01,3,C144144,J1602254254')), []);
  assert.deepEqual(warnings(widthsForm('3,1,02,02,06,06,02,0,0100,1=HOLA')), []);
});

// ---- Parsing: bar code number

test('parse: the bar code number is 2 digits 00..31 in every form', () => {
  for (const id of ['00', '31']) assert.deepEqual(warnings(generic(undefined, id)), [], id);
  for (const make of [widthsForm, generic, qr, dm]) {
    const w = warnings(make(undefined, '32'));
    assert.equal(w.length, 1);
    assert.match(w[0], /XB32: número de código de barras "32" fuera de 00\.\.31/);
  }
  assert.match(warnings(generic(undefined, '5'))[0], /número de código de barras "5"/);
});

// ---- Parsing: widths form

test('parse: widths 01..99 are valid, others warn with the range and are drawn as the nearest valid one, native keeps them', () => {
  const text = widthsForm('3,1,00,02,100,02,02,0,0100,1');
  const w = warnings(text);
  assert.equal(w.length, 2);
  assert.match(w[0], /ancho de barra estrecha "00" fuera de 01\.\.99/);
  assert.match(w[1], /ancho de barra ancha "100" fuera de 01\.\.99/);
  const item = itemOf(text);
  assert.equal(item.widths.narrowBar, 1 * DOT);
  assert.equal(item.widths.wideBar, 99 * DOT);
  assert.equal(item.native.narrowBar, 0);
  assert.equal(item.native.wideBar, 100);
});

test('parse: the inter-character space is 00 for MSI / ITF and the wide space 00 for Industrial 2 of 5; elsewhere 00 warns', () => {
  assert.deepEqual(warnings(widthsForm('1,1,02,02,06,06,00,0,0100,1')), []);
  assert.deepEqual(warnings(widthsForm('2,1,02,02,06,06,00,0,0100,1')), []);
  assert.deepEqual(warnings(widthsForm('O,1,02,02,06,00,02,0,0100,1')), []);
  assert.match(warnings(widthsForm('3,1,02,02,06,06,00,0,0100,1'))[0], /espacio entre caracteres "00" fuera de 01\.\.99/);
  assert.match(warnings(widthsForm('3,1,02,02,06,00,02,0,0100,1'))[0], /espacio ancho "00" fuera de 01\.\.99/);
  assert.match(warnings(widthsForm('3,1,02,00,06,06,02,0,0100,1'))[0], /espacio estrecho "00"/);
});

test('parse: a width that is not 2 digits warns', () => {
  assert.match(warnings(widthsForm('3,1,2,02,06,06,02,0,0100,1'))[0], /ancho de barra estrecha "2" .*2 dígitos/);
});

test('parse: check digit option 1..5 is valid, anything else warns with the range', () => {
  assert.deepEqual(warnings(widthsForm('3,3,02,02,06,06,02,0,0100,1')), []);
  assert.match(warnings(widthsForm('3,6,02,02,06,06,02,0,0100,1'))[0], /dígito de control "6" fuera de 1\.\.5/);
  assert.match(warnings(generic('5,0,02,0,0080,0,000,1,00'))[0], /dígito de control "0" fuera de 1\.\.5/);
  // The shipped Code 128 example writes 0 (see Open in odd/tasks/field-validation-audit.md): tolerated for types 9 and A only
  assert.deepEqual(warnings(generic('9,0,02,0,0080,0,000,1,00')), []);
});

test('parse: rotation 0..3 only', () => {
  assert.match(warnings(widthsForm('3,1,02,02,06,06,02,4,0100,1'))[0], /rotación "4" fuera de 0\.\.3/);
  assert.match(warnings(generic('9,1,02,7,0080,0,000,1,00'))[0], /rotación "7" fuera de 0\.\.3/);
});

test('parse: height 0000..1000; a larger one is drawn as 1000 and 0 says that the printer draws nothing', () => {
  assert.deepEqual(warnings(widthsForm('3,1,02,02,06,06,02,0,1000,1')), []);
  const text = widthsForm('3,1,02,02,06,06,02,0,1200,1');
  assert.match(warnings(text)[0], /altura "1200" fuera de 0000\.\.1000/);
  assert.equal(itemOf(text).height, 1000);
  assert.equal(field(text, 'height').value, 1200);
  assert.match(warnings(generic('9,1,02,0,0000,0,000,1,00'))[0], /altura "0000".*no dibuja/);
  assert.match(warnings(generic('9,1,02,0,80,0,000,1,00'))[0], /altura "80".*4 dígitos/);
});

test('parse: start / stop option is T, P or N; the readable flag 0 or 1; zero suppression 00..20', () => {
  for (const r of ['T', 'P', 'N']) assert.deepEqual(warnings(widthsForm(`3,1,02,02,06,06,02,0,0100,1,00,${r}`)).filter(w => !/inicio\/parada/.test(w)), [], r);
  assert.match(warnings(widthsForm('3,1,02,02,06,06,02,0,0100,1,00,X'))[0], /"X"/);
  assert.match(warnings(widthsForm('3,1,02,02,06,06,02,0,0100,2'))[0], /texto legible "2" fuera de 0, 1/);
  assert.match(warnings(widthsForm('3,1,02,02,06,06,02,0,0100,1,25'))[0], /ceros suprimidos "25" fuera de 00\.\.20/);
  assert.equal(itemOf(widthsForm('3,1,02,02,06,06,02,0,0100,1,25')).zeroSuppress, 20);
});

test('parse: a malformed increment warns, a valid one and the omitted one do not', () => {
  assert.deepEqual(warnings(widthsForm('3,1,02,02,06,06,02,0,0100,+0000000001,1')), []);
  assert.match(warnings(widthsForm('3,1,02,02,06,06,02,0,0100,+12,1'))[0], /incremento "\+12".*10 dígitos/);
  assert.match(warnings(generic('9,1,02,0,0080,+12,000,1,00'))[0], /incremento "\+12"/);
});

// ---- Parsing: generic form

test('parse: the module is 01..15 in the generic form; a larger one is drawn as 15, native keeps what was written', () => {
  assert.deepEqual(warnings(generic('9,1,15,0,0080,0,000,1,00')), []);
  const text = generic('9,1,40,0,0080,0,000,1,00');
  assert.match(warnings(text)[0], /módulo "40" fuera de 01\.\.15/);
  const item = itemOf(text);
  assert.equal(item.module, 15 * DOT);
  assert.equal(item.native.module, 40);
  assert.equal(field(text, 'module').value, 40);
  assert.match(warnings(generic('9,1,00,0,0080,0,000,1,00'))[0], /módulo "00" fuera de 01\.\.15/);
  assert.equal(itemOf(generic('9,1,00,0,0080,0,000,1,00')).module, 1 * DOT);
});

test('parse: the guard bar is 000..100 for the WPC types and ignored for the others', () => {
  assert.deepEqual(warnings(generic('5,3,02,0,0080,0,100,1,00')), []);
  assert.match(warnings(generic('5,3,02,0,0080,0,120,1,00'))[0], /barra guardiana "120" fuera de 000\.\.100/);
  assert.deepEqual(warnings(generic('9,1,02,0,0080,0,120,1,00')), []);
});

test('parse: other generic-form types are checked like Code 128 (postal and UCC/EAN128), PDF417 is not', () => {
  assert.match(warnings(generic('N,3,20,0,0080,0,000,1,00'))[0], /módulo "20" fuera de 01\.\.15/);
  assert.ok(!warnings(generic('P,04,02,03,0,0010')).some(w => /módulo/.test(w)));
});

// ---- Parsing: data length

test('parse: 1D data of 126 characters is fine, longer is cut to 126 (the printer discards the rest) with a warning', () => {
  const format = widthsForm();
  assert.deepEqual(warnings(`${format}\n{RB00;${'1'.repeat(126)}|}`).filter(w => /caracteres/.test(w)), []);
  const text = `${format}\n{RB00;${'1'.repeat(130)}|}`;
  const w = warnings(text).filter(x => /caracteres/.test(x));
  assert.equal(w.length, 1);
  assert.match(w[0], /130 caracteres.*126/);
  assert.equal(itemOf(text).data.length, 126);
});

test('parse: QR and Data Matrix data of 2000 characters is fine, longer is cut to 2000 with a warning', () => {
  for (const format of [qr(), dm()]) {
    assert.deepEqual(warnings(`${format}\n{RB00;${'a'.repeat(2000)}|}`).filter(w => /caracteres/.test(w)), []);
    const text = `${format}\n{RB00;${'a'.repeat(2100)}|}`;
    const w = warnings(text).filter(x => /caracteres/.test(x));
    assert.equal(w.length, 1);
    assert.match(w[0], /2100 caracteres.*2000/);
    assert.equal(itemOf(text).data.length, 2000);
  }
});

// ---- Parsing: QR

test('parse: QR cell 00..52; a larger one is drawn as 52, 00 says that the printer draws nothing', () => {
  const text = qr('T,H,60,A,0,M2');
  assert.match(warnings(text)[0], /módulo "60" fuera de 00\.\.52/);
  assert.equal(itemOf(text).cell, 52 * DOT);
  assert.equal(itemOf(text).native.cell, 60);
  assert.equal(field(text, 'cell').value, 60);
  assert.match(warnings(qr('T,H,00,A,0,M2'))[0], /módulo "00".*no dibuja/);
});

test('parse: QR mode, rotation, model, mask and connection are checked', () => {
  assert.match(warnings(qr('T,H,04,X,0,M2'))[0], /modo "X" fuera de A, M/);
  assert.match(warnings(qr('T,H,04,A,4,M2'))[0], /rotación "4" fuera de 0\.\.3/);
  assert.match(warnings(qr('T,H,04,A,0,M3'))[0], /modelo "M3" fuera de M1, M2/);
  assert.match(warnings(qr('T,H,04,A,0,M2,K9'))[0], /máscara "K9" fuera de K0\.\.K8/);
  assert.match(warnings(qr('T,H,04,A,0,M2,J1701FF'))[0], /conexión "J1701FF".*kk 01\.\.16/);
  assert.match(warnings(qr('T,H,04,A,0,M2,J0117FF'))[0], /conexión "J0117FF".*ll 01\.\.16/);
  assert.match(warnings(qr('T,H,04,A,0,M2,Z5'))[0], /"Z5".*desconocido/);
  assert.match(warnings(qr('T,H,04'))[0], /faltan/);
});

// ---- Parsing: Data Matrix

test('parse: Data Matrix ECC type is 00..14 or 20', () => {
  for (const ee of ['00', '01', '09', '14', '20']) assert.deepEqual(warnings(dm(`Q,${ee},04,00,0`)).filter(w => /ECC/.test(w) && /fuera/.test(w)), [], ee);
  for (const ee of ['15', '21', '99']) assert.match(warnings(dm(`Q,${ee},04,00,0`))[0], new RegExp(`tipo de ECC "${ee}" fuera de 00\\.\\.14 o 20`), ee);
});

test('parse: Data Matrix cell 00..99, format ID 00..06 or 11..16', () => {
  const text = dm('Q,20,100,00,0');
  assert.match(warnings(text)[0], /módulo "100" fuera de 00\.\.99/);
  assert.equal(itemOf(text).cell, 99 * DOT);
  assert.equal(itemOf(text).native.cell, 100);
  assert.deepEqual(warnings(dm('Q,20,04,16,0')), []);
  assert.match(warnings(dm('Q,20,04,07,0'))[0], /formato ID "07" fuera de 00\.\.06 o 11\.\.16/);
});

test('parse: Data Matrix number of cells is 000..144, even, square or one of the six rectangles; anything else is automatic', () => {
  assert.deepEqual(warnings(dm('Q,20,04,00,0,C020020')), []);
  assert.deepEqual(warnings(dm('Q,20,04,00,0,C000000')), []);
  for (const cells of ['C009009', 'C146146', 'C021021', 'C020030']) {
    const w = warnings(dm(`Q,20,04,00,0,${cells}`));
    assert.equal(w.length, 1, cells);
    assert.match(w[0], /número de celdas.*pares de 10\.\.144.*automático/);
  }
  // The rectangles keep their own message
  const rectangle = warnings(dm('Q,20,04,00,0,C018008'));
  assert.equal(rectangle.length, 1);
  assert.match(rectangle[0], /rectangular/);
});

test('parse: Data Matrix connection setting ranges: kk 01..16, ll 02..16, ID 1 and 2 001..254', () => {
  assert.deepEqual(warnings(dm('Q,20,04,00,0,J0102001254')).filter(w => !/enlace de símbolos/.test(w)), []);
  assert.match(warnings(dm('Q,20,04,00,0,J1702001001')).find(w => /conexión/.test(w)), /kk 01\.\.16/);
  assert.match(warnings(dm('Q,20,04,00,0,J0101001001')).find(w => /conexión/.test(w)), /ll 02\.\.16/);
  assert.match(warnings(dm('Q,20,04,00,0,J0102255001')).find(w => /conexión/.test(w)), /001\.\.254/);
});

// ---- Panel fields

test('panel: the barcode height offers 1..1000 and the generic-form module 1..15', () => {
  const widthsText = widthsForm();
  assert.deepEqual([field(widthsText, 'height').min, field(widthsText, 'height').max], [1, 1000]);
  const genericText = generic();
  assert.deepEqual([field(genericText, 'height').min, field(genericText, 'height').max], [1, 1000]);
  assert.deepEqual([field(genericText, 'module').min, field(genericText, 'module').max], [1, 15]);
  assert.deepEqual([field(genericText, 'zeroSuppress').min, field(genericText, 'zeroSuppress').max], [0, 20]);
});

test('panel: QR cell offers 1..52, Data Matrix cell 1..99', () => {
  assert.deepEqual([field(qr(), 'cell').min, field(qr(), 'cell').max], [1, 52]);
  assert.deepEqual([field(dm(), 'cell').min, field(dm(), 'cell').max], [1, 99]);
});

test('panel: writing a height / module / cell outside the range stores the nearest valid one', () => {
  const text = generic();
  const item = itemOf(text);
  assert.match(tpcl.updateItem(text, item, { height: 5000 }, { dpi: DPI }), /,0,1000,0,000,1,00\|\}/);
  assert.match(tpcl.updateItem(text, item, { module: 40 }, { dpi: DPI }), /,9,1,15,0,0080,/);
  const q = qr();
  assert.match(tpcl.updateItem(q, itemOf(q), { cell: 70 }, { dpi: DPI }), /T,H,52,A,0,M2/);
});

test('panel: switching a wide module Code 39 to Code 128 writes a module of at most 15', () => {
  const text = widthsForm('3,1,40,40,60,60,40,0,0100,1');
  const out = tpcl.updateItem(text, itemOf(text), { symbology: 'code128' }, { dpi: DPI });
  assert.match(out, /9,1,15,0,0100,/);
});

// ---- Emit and conversion

const neutral = items => ({ language: 'neutral', size: { width: 1000, height: 600, pitch: 630, gap: 30, native: {} }, items, diagnostics: [] });
const barcode = (o = {}) => ({ kind: 'barcode', x: 100, y: 200, symbology: 'code128', module: 2.5, rotation: 0, height: 80, humanReadable: true, data: 'ABC123', ...o });
const wide = (o = {}) => barcode({ symbology: 'code39', widths: { narrowBar: 2.5, narrowSpace: 2.5, wideBar: 7.5, wideSpace: 7.5 }, interCharGap: 2.5, ...o });
const qrItem = (o = {}) => ({ kind: 'qr', x: 100, y: 200, ecc: 'H', cell: 5, symbology: 'qr', data: 'HELLO', ...o });
const dmItem = (o = {}) => ({ kind: 'datamatrix', x: 100, y: 200, cell: 5, symbology: 'datamatrix', data: 'HELLO', ecc: 200, rotation: 0, ...o });
const emit = (...items) => tpcl.emit(neutral(items), { dpi: DPI });
const warn = out => out.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const lines = out => out.text.split('\n').filter(l => /^\{(XB|RB)/.test(l));

test('emit: a height above 1000 is written as 1000 and reported once with the range', () => {
  const out = emit(barcode({ height: 1500 }), barcode({ height: 5000 }), wide({ height: 2000 }));
  assert.equal(lines(out).filter(l => /,1000,/.test(l)).length, 3);
  assert.equal(warn(out).filter(t => /1\.\.1000/.test(t)).length, 1);
  assert.deepEqual(warn(emit(barcode({ height: 1000 }))), []);
});

test('emit: a module above 15 in the generic form is written as 15 and reported once; the widths form keeps up to 99', () => {
  const out = emit(barcode({ module: 40 }), barcode({ module: 80 }));
  assert.ok(lines(out).some(l => l.includes(',9,3,') || /,9,\d,15,0,/.test(l)));
  assert.equal(warn(out).filter(t => /1\.\.15/.test(t)).length, 1);
  assert.deepEqual(warn(emit(barcode({ module: 15 * DOT }))).filter(t => /1\.\.15/.test(t)), []);
  const widthsOut = emit(wide({ widths: { narrowBar: 40, narrowSpace: 40, wideBar: 60, wideSpace: 60 }, interCharGap: 40 }));
  assert.ok(widthsOut.text.includes(',32,32,48,48,32,'));
  assert.deepEqual(warn(widthsOut), []);
});

test('emit: a space or wide bar of 0 in the widths form is written as 01 with one warning (01..99), the fixed 00 fields stay 00', () => {
  const out = emit(wide({ widths: { narrowBar: 2.5, narrowSpace: 0, wideBar: 7.5, wideSpace: 0 }, interCharGap: 0 }));
  assert.match(lines(out)[0], /,3,1,02,01,06,01,01,0,/);
  assert.equal(warn(out).filter(t => /01\.\.99/.test(t)).length, 1);
  const industrial = emit(wide({ symbology: 'industrial25', data: '1234' }));
  assert.match(lines(industrial)[0], /,O,1,02,02,06,00,02,0,/);
  assert.deepEqual(warn(industrial), []);
  const itf = emit(wide({ symbology: 'itf', data: '1234', interCharGap: 0 }));
  assert.match(lines(itf)[0], /,2,1,02,02,06,06,00,0,/);
  assert.deepEqual(warn(itf), []);
});

test('emit: ITF and MSI always write the inter-character space as 00, with one warning when the item had one', () => {
  const out = emit(wide({ symbology: 'itf', data: '1234', interCharGap: 2.5 }), wide({ symbology: 'msi', data: '1234', interCharGap: 5 }));
  assert.match(lines(out)[0], /,2,1,02,02,06,06,00,0,/);
  assert.match(lines(out)[2], /,1,1,02,02,06,06,00,0,/);
  assert.equal(warn(out).filter(t => /espacio entre caracteres/.test(t)).length, 1);
});

test('emit: a guard bar above 100 is written as 100 with one warning', () => {
  const out = emit(barcode({ symbology: 'ean13', data: '590123412345', check: 'auto', guard: 400 }));
  assert.match(lines(out)[0], /,5,3,02,0,0080,0,100,1,00\|\}/);
  assert.equal(warn(out).filter(t => /000\.\.100/.test(t)).length, 1);
});

test('emit: 1D data over 126 characters is cut to 126 with one warning, data with variables is left alone', () => {
  const out = emit(barcode({ data: '1'.repeat(150) }));
  assert.equal(lines(out)[1], `{RB00;${'1'.repeat(126)}|}`);
  assert.equal(warn(out).filter(t => /126/.test(t)).length, 1);
  assert.deepEqual(warn(emit(barcode({ data: '1'.repeat(126) }))), []);
  assert.equal(lines(emit(barcode({ data: `<#CODIGO#>${'x'.repeat(130)}` })))[1], `{RB00;<#CODIGO#>${'x'.repeat(130)}|}`);
});

test('emit: data a Code 39, ITF or Code 128 cannot hold is reported once per symbology', () => {
  assert.match(warn(emit(wide({ data: 'abc' }))).join('|'), /no son válidos para su tipo/);
  assert.match(warn(emit(wide({ symbology: 'itf', data: 'AB12' }))).join('|'), /no son válidos para su tipo/);
  assert.match(warn(emit(barcode({ data: 'Ñandú€' }))).join('|'), /no son válidos para su tipo/);
  assert.deepEqual(warn(emit(wide({ data: 'ABC-123' }), barcode({ data: 'abc123' }))), []);
});

test('emit: a QR cell above 52 is written as 52 with one warning, 1..52 raises nothing', () => {
  const out = emit(qrItem({ cell: 80 }), qrItem({ cell: 200 }));
  assert.ok(lines(out)[0].includes(',T,H,52,A,0,M2'));
  assert.equal(warn(out).filter(t => /1\.\.52/.test(t)).length, 1);
  assert.deepEqual(warn(emit(qrItem({ cell: 52 * DOT }))), []);
});

test('emit: QR and Data Matrix data over 2000 characters is cut with one warning', () => {
  for (const item of [qrItem({ data: 'a'.repeat(2500) }), dmItem({ data: 'a'.repeat(2500) })]) {
    const out = emit(item);
    assert.equal(lines(out)[1], `{RB00;${'a'.repeat(2000)}|}`);
    assert.equal(warn(out).filter(t => /2000/.test(t)).length, 1);
  }
});

test('emit: more than 32 barcodes, QR or Data Matrix numbers past 31 are reported once', () => {
  const many = Array.from({ length: 33 }, () => barcode());
  const out = emit(...many);
  assert.equal(warn(out).filter(t => /00 a 31/.test(t)).length, 1);
  assert.deepEqual(warn(emit(...many.slice(0, 32))).filter(t => /00 a 31/.test(t)), []);
});
