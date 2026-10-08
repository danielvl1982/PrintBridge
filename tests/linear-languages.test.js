const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Task C2 of odd/tasks/component-candidates.md, languages part: Code 93, NW7 (Codabar), MSI and Industrial 2 of 5.
// TPCL (B-SV4 spec 6.3.9): Code 93 is type C of the generic form XBaa;x,y,d,e,ff,k,llll(,mnnnnnnnnnn,ooo,p,qq) with e = 1 none / 2 check /
// 3 auto attach (modulus 47); MSI (1), NW7 (4) and Industrial 2 of 5 (O) are types of the widths form
// XBaa;x,y,d,e,ff,gg,hh,ii,jj,k,llll(,mnnnnnnnnnn,p,qq)(,r) with e = 1 none / 2 check / 3 auto / 4 / 5 (MSI only: IBM modulus 10 + 10, 11 + 10),
// MSI with jj = 00, Industrial 2 of 5 with ii = 00 and r = T / P / N (start only / stop only / none; omitted = automatic).
// TSPL (B-442/443 manual): "93" and "CODA" (Codabar); the manual has no MSI and no Industrial 2 of 5.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const { selector } = PB.slices.barcode;
const DPI = 203;
const DOT = 254 / DPI;

const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));
const tpclParse = text => tpcl.parse(text, { dpi: DPI });
const tsplParse = text => tspl.parse(text, { dpi: DPI });
const barcodeOf = parsed => parsed.items.find(i => i.kind === 'barcode');
const generic = (type, { check = '3', readable = '1', data = 'TEST93' } = {}) => `{XB01;0100,0200,${type},${check},03,0,0120,0,000,${readable},00|}{RB01;${data}|}`;
const widths = (type, { check = '1', ii = '09', jj = '03', readable = '1', r = '', data = 'A40156B' } = {}) => `{XB01;0100,0200,${type},${check},03,03,09,${ii},${jj},0,0120,${readable}${r}|}{RB01;${data}|}`;
const tsplText = line => ['SIZE 100 mm,60 mm', 'REFERENCE 8,8', 'CLS', 'TEXT 10,10,"3",0,1,1,"HOLA"', line, 'PRINT 1,1', ''].join('\r\n');

// --- TPCL parse

test('TPCL parse: Code 93 (type C, generic form) gives code93 with the check option and the module', () => {
  const parsed = tpclParse(generic('C'));
  const item = barcodeOf(parsed);
  assert.equal(item.symbology, 'code93');
  assert.equal(item.check, 'auto');
  assert.equal(item.humanReadable, true);
  assert.equal(item.data, 'TEST93');
  assert.equal(item.native.type, 'C');
  assert.equal(item.native.checkDigit, '3');
  assert.ok(Math.abs(item.module - 3 * DOT) < 1e-9);
  assert.deepEqual(levels(parsed.diagnostics, 'warning', 'error'), []);
  const check = e => barcodeOf(tpclParse(generic('C', { check: e }))).check;
  assert.deepEqual(['1', '2', '3', '4', '5'].map(check), ['none', 'check', 'auto', 'unsupported', 'unsupported']);
});

test('TPCL parse: MSI (1), NW7 (4) and Industrial 2 of 5 (O) are widths-form barcodes with their widths', () => {
  for (const [type, symbology] of [['1', 'msi'], ['4', 'codabar'], ['O', 'industrial25']]) {
    const parsed = tpclParse(widths(type, { data: '1234567' }));
    const item = barcodeOf(parsed);
    assert.equal(item.symbology, symbology, type);
    assert.equal(item.native.type, type);
    assert.deepEqual(item.widths, { narrowBar: 3 * DOT, narrowSpace: 3 * DOT, wideBar: 9 * DOT, wideSpace: 9 * DOT }, type);
    assert.equal(item.interCharGap, 3 * DOT);
    assert.equal(item.humanReadable, true);
    assert.equal(item.data, '1234567');
    assert.deepEqual(levels(parsed.diagnostics, 'warning', 'error'), [], type);
  }
});

test('TPCL parse: the check options of MSI (1..5), Industrial 2 of 5 (1..3) and NW7 (1 only); the others are unsupported', () => {
  const check = (type, e) => barcodeOf(tpclParse(widths(type, { check: e }))).check;
  assert.deepEqual(['1', '2', '3', '4', '5', '6'].map(e => check('1', e)), ['none', 'check', 'auto', 'mod1010', 'mod1110', 'unsupported']);
  assert.deepEqual(['1', '2', '3', '4'].map(e => check('O', e)), ['none', 'check', 'auto', 'unsupported']);
  assert.deepEqual(['1', '2', '3'].map(e => check('4', e)), ['none', 'unsupported', 'unsupported']);
});

test('TPCL parse: the start / stop option T / P / N is kept in native; the viewer draws its automatic start / stop and says so', () => {
  for (const r of ['T', 'P', 'N']) {
    const parsed = tpclParse(widths('4', { r: `,${r}` }));
    assert.equal(barcodeOf(parsed).native.startStop, r);
    assert.ok(parsed.diagnostics.some(d => d.level === 'warning' && /inicio\/parada "[TPN]"/.test(d.text)), r);
  }
  assert.equal(barcodeOf(tpclParse(widths('4'))).native.startStop, null);
});

test('TPCL parse: types the slice does not know stay unknown (Z) and Code 128 is unchanged', () => {
  assert.equal(barcodeOf(tpclParse(generic('Z'))).symbology, 'unknown');
  assert.equal(barcodeOf(tpclParse('{XB01;0100,0200,9,0,03,0,0100,0,000,1,00|}')).symbology, 'code128');
});

// --- TPCL emit

const model = (items = []) => ({ language: 'tpcl', size: { width: 990, height: 550, pitch: 610, gap: null, native: {} }, items, diagnostics: [] });
const neutral = (props = {}) => ({
  kind: 'barcode', x: 50, y: 60, symbology: 'code93', check: 'auto', module: 2.5, rotation: 0, height: 80, humanReadable: true, data: 'TEST93', ...props,
});
const emitT = items => PB.languages.emit('tpcl', model(items), { dpi: DPI });
const bodyT = items => emitT(items).text.split('\n').filter(l => /^\{(XB|RB)/.test(l));

test('TPCL emit: Code 93 writes the generic form with the type C and the check option', () => {
  assert.deepEqual(bodyT([neutral()]), ['{XB00;0050,0060,C,3,02,0,0080,0,000,1,00|}', '{RB00;TEST93|}']);
  assert.equal(bodyT([neutral({ check: 'none' })])[0], '{XB00;0050,0060,C,1,02,0,0080,0,000,1,00|}');
  assert.equal(bodyT([neutral({ check: 'check' })])[0], '{XB00;0050,0060,C,2,02,0,0080,0,000,1,00|}');
  assert.equal(bodyT([neutral({ check: undefined })])[0], '{XB00;0050,0060,C,3,02,0,0080,0,000,1,00|}', 'default: auto attach');
  assert.equal(bodyT([neutral({ counter: { step: 1 }, zeroSuppress: 3 })])[0], '{XB00;0050,0060,C,3,02,0,0080,+0000000001,000,1,03|}');
});

test('TPCL emit: NW7, MSI and Industrial 2 of 5 write the widths form (MSI: jj = 00; Industrial 2 of 5: ii = 00); without widths the ratio is 3:1', () => {
  assert.equal(bodyT([neutral({ symbology: 'codabar', check: 'none', data: 'A40156B' })])[0], '{XB00;0050,0060,4,1,02,02,06,06,02,0,0080,1|}');
  assert.equal(bodyT([neutral({ symbology: 'msi', check: 'none', data: '1234567' })])[0], '{XB00;0050,0060,1,1,02,02,06,06,00,0,0080,1|}');
  assert.equal(bodyT([neutral({ symbology: 'industrial25', check: 'none', data: '12345' })])[0], '{XB00;0050,0060,O,1,02,02,06,00,02,0,0080,1|}');
  for (const [check, e] of [['none', '1'], ['check', '2'], ['auto', '3'], ['mod1010', '4'], ['mod1110', '5']]) {
    assert.equal(bodyT([neutral({ symbology: 'msi', check, data: '1234567' })])[0], `{XB00;0050,0060,1,${e},02,02,06,06,00,0,0080,1|}`, check);
  }
  const explicit = { narrowBar: 2 * DOT, narrowSpace: 2 * DOT, wideBar: 5 * DOT, wideSpace: 5 * DOT };
  assert.equal(bodyT([neutral({ symbology: 'codabar', check: 'none', widths: explicit, interCharGap: 4 * DOT })])[0], '{XB00;0050,0060,4,1,02,02,05,05,04,0,0080,1|}');
  assert.equal(bodyT([neutral({ symbology: 'industrial25', check: 'none', widths: explicit, interCharGap: 4 * DOT })])[0], '{XB00;0050,0060,O,1,02,02,05,00,04,0,0080,1|}', 'the wide space is fixed to 00');
});

test('TPCL emit: a check option the symbology has no row for is written as none with one warning', () => {
  const out = emitT([neutral({ symbology: 'codabar', check: 'auto', data: 'A40156B' }), neutral({ symbology: 'codabar', check: 'auto', data: 'A40156B' })]);
  assert.equal(out.text.split('\n').filter(l => /^\{XB/.test(l))[0].split(',')[3], '1');
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
  assert.match(levels(out.diagnostics, 'warning')[0].text, /codabar.*"auto"/);
});

test('TPCL round trip: emit then parse gives back the neutral fields (every check option of each symbology)', () => {
  const checks = { code93: ['none', 'check', 'auto'], codabar: ['none'], msi: ['none', 'check', 'auto', 'mod1010', 'mod1110'], industrial25: ['none', 'check', 'auto'] };
  for (const [symbology, list] of Object.entries(checks)) {
    for (const check of list) {
      const item = barcodeOf(tpclParse(emitT([neutral({ symbology, check, data: '12345' })]).text));
      assert.deepEqual([item.symbology, item.check, item.data, item.humanReadable], [symbology, check, '12345', true], `${symbology} ${check}`);
    }
  }
});

// --- TSPL parse / emit

test('TSPL parse: "93" is Code 93 (automatic check characters, module based) and "CODA" is Codabar (wide / narrow, no check)', () => {
  const c93 = tsplParse(tsplText('BARCODE 40,50,"93",96,1,0,2,4,"TEST93"'));
  const a = barcodeOf(c93);
  assert.deepEqual([a.symbology, a.check, a.data, a.native.type, a.humanReadable], ['code93', 'auto', 'TEST93', '93', true]);
  assert.ok(Math.abs(a.module - 2 * DOT) < 1e-9);
  assert.equal('widths' in a, false);
  assert.deepEqual(c93.diagnostics, []);
  const coda = tsplParse(tsplText('BARCODE 40,50,"CODA",96,1,0,2,5,"A40156B"'));
  const b = barcodeOf(coda);
  assert.deepEqual([b.symbology, b.check, b.data], ['codabar', 'none', 'A40156B']);
  assert.deepEqual(b.widths, { narrowBar: 2 * DOT, narrowSpace: 2 * DOT, wideBar: 5 * DOT, wideSpace: 5 * DOT });
  assert.equal(b.interCharGap, 2 * DOT);
  assert.deepEqual(coda.diagnostics, []);
  assert.equal(barcodeOf(tsplParse(tsplText('BARCODE 40,50,"coda",96,1,0,2,5,"A1B"'))).symbology, 'codabar', 'case insensitive');
});

test('TSPL parse: the manual has no MSI and no Industrial 2 of 5: they stay unknown', () => {
  for (const type of ['MSI', 'POST', '2OF5']) assert.equal(barcodeOf(tsplParse(tsplText(`BARCODE 40,50,"${type}",96,1,0,2,4,"123"`))).symbology, 'unknown', type);
});

const emitS = items => PB.languages.emit('tspl', { language: 'tspl', size: { width: 1000, height: 600, pitch: null, gap: null, native: {} }, items, diagnostics: [] }, { dpi: DPI });
const lineS = items => emitS(items).text.split('\r\n').find(l => l.startsWith('BARCODE'));
const sItem = (props = {}) => neutral({ x: 40 * DOT, y: 230 * DOT, module: 2 * DOT, height: 100 * DOT, ...props });

test('TSPL emit: Code 93 writes "93" with wide = 2 x narrow (1:2, a manual ratio); Codabar writes "CODA" with the ratio of its widths', () => {
  assert.equal(lineS([sItem()]), 'BARCODE 40,230,"93",100,1,0,2,4,"TEST93"');
  assert.equal(lineS([sItem({ symbology: 'codabar', check: 'none', data: 'A40156B' })]), 'BARCODE 40,230,"CODA",100,1,0,2,6,"A40156B"', 'without widths: 3:1');
  const explicit = { narrowBar: 2 * DOT, narrowSpace: 2 * DOT, wideBar: 5 * DOT, wideSpace: 5 * DOT };
  assert.equal(lineS([sItem({ symbology: 'codabar', check: 'none', widths: explicit, data: 'A1B' })]), 'BARCODE 40,230,"CODA",100,1,0,2,5,"A1B"', '2:5');
  assert.deepEqual(levels(emitS([sItem()]).diagnostics, 'warning'), []);
});

test('TSPL emit: a Code 93 without automatic check characters is written with them and reported; MSI and Industrial 2 of 5 are skipped with a warning', () => {
  const out = emitS([sItem({ check: 'none' }), sItem({ check: 'check' })]);
  assert.equal(out.text.split('\r\n').filter(l => l.startsWith('BARCODE')).every(l => l.includes('"93"')), true);
  assert.equal(levels(out.diagnostics, 'warning').filter(d => /dígito de control/.test(d.text)).length, 1);
  assert.match(levels(out.diagnostics, 'warning')[0].text, /con dígito de control automático/);
  const skipped = emitS([sItem({ symbology: 'msi', check: 'none', data: '123' }), sItem({ symbology: 'industrial25', check: 'none', data: '123' })]);
  assert.equal(skipped.text.includes('BARCODE'), false);
  const warnings = levels(skipped.diagnostics, 'warning').map(d => d.text);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /msi.*sin equivalente en TSPL/);
  assert.match(warnings[1], /industrial25.*sin equivalente en TSPL/);
});

test('TSPL round trip: emit then parse gives back the neutral fields', () => {
  for (const [symbology, check, data] of [['code93', 'auto', 'TEST93'], ['codabar', 'none', 'A40156B']]) {
    const item = barcodeOf(tsplParse(emitS([sItem({ symbology, check, data, humanReadable: false, rotation: 90 })]).text));
    assert.deepEqual([item.symbology, item.check, item.data, item.humanReadable, item.rotation], [symbology, check, data, false, 90], symbology);
  }
});

// --- Conversion

const convert = (source, target) => {
  const result = PB.convert.run(source, target, { dpi: DPI });
  return { result, converted: PB.languages.get(target).parse(result.text, { dpi: DPI }) };
};

test('conversion TPCL -> TSPL -> TPCL keeps Code 93 and NW7 (symbology, data, check, readable, widths)', () => {
  for (const [source, tsplType, symbology, data, check] of [[generic('C'), '93', 'code93', 'TEST93', 'auto'], [widths('4'), 'CODA', 'codabar', 'A40156B', 'none']]) {
    const toTspl = convert(`{D0990,0550,0990|}{C|}${source}`, 'tspl');
    assert.match(toTspl.result.text, new RegExp(`BARCODE \\d+,\\d+,"${tsplType}",`), tsplType);
    assert.deepEqual(levels(toTspl.result.diagnostics, 'warning'), [], tsplType);
    const middle = barcodeOf(toTspl.converted);
    assert.deepEqual([middle.symbology, middle.data, middle.check, middle.humanReadable], [symbology, data, check, true]);
    const back = convert(toTspl.result.text, 'tpcl');
    assert.deepEqual(levels(back.result.diagnostics, 'warning'), [], tsplType);
    const item = barcodeOf(back.converted);
    assert.deepEqual([item.symbology, item.data, item.check, item.humanReadable], [symbology, data, check, true]);
    assert.equal(item.native.type, symbology === 'code93' ? 'C' : '4');
  }
  assert.equal(barcodeOf(convert(`{D0990,0550,0990|}{C|}${widths('4')}`, 'tspl').converted).widths.wideBar, 9 * DOT, '3:1 kept');
});

test('conversion TPCL -> TSPL: MSI and Industrial 2 of 5 have no TSPL type, they are skipped with a warning; TSPL -> TPCL has nothing to convert for them', () => {
  for (const [type, symbology] of [['1', 'msi'], ['O', 'industrial25']]) {
    const out = convert(`{D0990,0550,0990|}{C|}${widths(type, { data: '12345' })}`, 'tspl');
    assert.equal(out.result.text.includes('BARCODE'), false, symbology);
    assert.ok(levels(out.result.diagnostics, 'warning').some(d => new RegExp(`${symbology}.*sin equivalente en TSPL`).test(d.text)), symbology);
  }
});

test('conversion TPCL -> TSPL: a Code 93 without check characters is written with them and reported', () => {
  const out = convert(`{D0990,0550,0990|}{C|}${generic('C', { check: '1' })}`, 'tspl');
  assert.match(out.result.text, /"93"/);
  assert.ok(levels(out.result.diagnostics, 'warning').some(d => /dígito de control/.test(d.text)));
});

// --- Type selector: tables and the re-emit rules of B2

const SYMBOLOGIES = ['code128', 'code39', 'itf', 'code93', 'codabar', 'msi', 'industrial25', 'ean13', 'ean8', 'upca', 'upce'];
const XB = {
  code128: '{XB01;0100,0200,9,1,03,1,0120,0,000,1,00|}',
  code39: '{XB01;0100,0200,3,1,03,03,09,09,03,1,0120,1|}',
  itf: '{XB01;0100,0200,2,1,03,03,09,09,00,1,0120,1|}',
  code93: '{XB01;0100,0200,C,3,03,1,0120,0,000,1,00|}',
  codabar: '{XB01;0100,0200,4,1,03,03,09,09,03,1,0120,1|}',
  msi: '{XB01;0100,0200,1,1,03,03,09,09,00,1,0120,1|}',
  industrial25: '{XB01;0100,0200,O,1,03,03,09,00,03,1,0120,1|}',
  ean13: '{XB01;0100,0200,5,3,03,1,0120,0,000,1,00|}',
  ean8: '{XB01;0100,0200,0,3,03,1,0120,0,000,1,00|}',
  upca: '{XB01;0100,0200,K,3,03,1,0120,0,000,1,00|}',
  upce: '{XB01;0100,0200,6,3,03,1,0120,0,000,1,00|}',
};
const tpclDoc = (xb, data = '1234567') => ['{D0400,0600,0400|}', '{C|}', xb, `{RB01;${data}|}`, ''].join('\n');
const itemT = text => tpclParse(text).items.find(i => i.kind === 'barcode');
const setT = (text, changes) => tpcl.updateItem(text, itemT(text), changes, { dpi: DPI });
const describeT = (text, withText = true) => tpcl.describeItem(itemT(text), withText ? text : undefined);
const valueOf = (d, key) => (d.fields.find(f => f.key === key) || {}).value;
const optionsOf = (d, key) => ((d.fields.find(f => f.key === key) || {}).options || []).map(o => o.value);
const xbOf = text => /\{XB01;[^|]*\|\}/.exec(text)[0];

test('selector: the labels list the new symbologies and check options in order', () => {
  assert.deepEqual(Object.keys(selector.LABELS), SYMBOLOGIES);
  assert.deepEqual(Object.keys(selector.CHECK_LABELS), ['none', 'mod43', 'check', 'auto', 'mod1010', 'mod1110']);
  assert.equal(selector.LABELS.codabar, 'NW7 (Codabar)');
  assert.equal(selector.LABELS.code93, 'Code 93');
  assert.equal(selector.LABELS.msi, 'MSI');
  assert.equal(selector.LABELS.industrial25, '2 de 5 industrial');
});

test('TPCL describeItem: Tipo de código offers all eleven symbologies; Dígito de control the options of the symbology in the command', () => {
  for (const withText of [true, false]) {
    for (const [symbology, checks] of [['code93', ['none', 'check', 'auto']], ['codabar', ['none']], ['msi', ['none', 'check', 'auto', 'mod1010', 'mod1110']], ['industrial25', ['none', 'check', 'auto']]]) {
      const d = describeT(tpclDoc(XB[symbology]), withText);
      assert.deepEqual(optionsOf(d, 'symbology'), SYMBOLOGIES, symbology);
      assert.equal(valueOf(d, 'symbology'), symbology);
      assert.deepEqual(optionsOf(d, 'check'), checks, symbology);
      assert.equal(valueOf(d, 'addon'), undefined, symbology);
    }
    assert.equal(valueOf(describeT(tpclDoc(XB.msi.replace('1,1,03', '1,5,03')), withText), 'check'), 'mod1110');
    assert.equal(valueOf(describeT(tpclDoc(XB.code93.replace('C,3', 'C,4')), withText), 'check'), 'unsupported');
  }
});

test('TPCL updateItem: the check digit option follows the option; options the symbology has no row for are refused', () => {
  assert.equal(xbOf(setT(tpclDoc(XB.msi), { check: 'mod1010' })), '{XB01;0100,0200,1,4,03,03,09,09,00,1,0120,1|}');
  assert.equal(xbOf(setT(tpclDoc(XB.msi), { check: 'mod1110' })), '{XB01;0100,0200,1,5,03,03,09,09,00,1,0120,1|}');
  assert.equal(xbOf(setT(tpclDoc(XB.industrial25), { check: 'auto' })), '{XB01;0100,0200,O,3,03,03,09,00,03,1,0120,1|}');
  assert.equal(xbOf(setT(tpclDoc(XB.code93), { check: 'none' })), '{XB01;0100,0200,C,1,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(tpclDoc(XB.code93), { check: 'check' })), '{XB01;0100,0200,C,2,03,1,0120,0,000,1,00|}');
  for (const [symbology, bad] of [['codabar', 'auto'], ['industrial25', 'mod1010'], ['code93', 'mod43'], ['msi', 'mod43']]) {
    assert.equal(setT(tpclDoc(XB[symbology]), { check: bad }), tpclDoc(XB[symbology]), `${symbology} ${bad}`);
  }
});

test('TPCL updateItem: Code 93 <-> widths-form symbologies re-emit both forms, carrying the check option when the new type has it', () => {
  assert.equal(xbOf(setT(tpclDoc(XB.code93), { symbology: 'msi' })), '{XB01;0100,0200,1,3,03,03,09,09,00,1,0120,1|}', 'auto is an MSI option too');
  assert.equal(xbOf(setT(tpclDoc(XB.code93), { symbology: 'codabar' })), '{XB01;0100,0200,4,1,03,03,09,09,03,1,0120,1|}', 'auto is not an NW7 option');
  assert.equal(xbOf(setT(tpclDoc(XB.codabar), { symbology: 'code93' })), '{XB01;0100,0200,C,1,03,1,0120,0,000,1,00|}', 'none is kept');
  assert.equal(xbOf(setT(tpclDoc(XB.code39.replace('3,1,03', '3,3,03')), { symbology: 'code93' })), '{XB01;0100,0200,C,3,03,1,0120,0,000,1,00|}', 'mod 43 is not an option: the default (auto)');
  assert.equal(xbOf(setT(tpclDoc(XB.code128), { symbology: 'code93' })), '{XB01;0100,0200,C,3,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(tpclDoc(XB.code93), { symbology: 'code128' })), XB.code128);
  assert.equal(xbOf(setT(tpclDoc(XB.ean13), { symbology: 'code93' })), '{XB01;0100,0200,C,3,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(tpclDoc(XB.code93), { symbology: 'ean13' })), XB.ean13);
});

test('TPCL updateItem: MSI has no inter-character space (00), Industrial 2 of 5 has no wide space (00): the other forms get them back', () => {
  assert.equal(xbOf(setT(tpclDoc(XB.code39), { symbology: 'msi' })), '{XB01;0100,0200,1,1,03,03,09,09,00,1,0120,1|}');
  assert.equal(xbOf(setT(tpclDoc(XB.itf), { symbology: 'msi' })), XB.msi);
  assert.equal(xbOf(setT(tpclDoc(XB.msi), { symbology: 'code39' })), XB.code39, 'the space between characters is the module again');
  assert.equal(xbOf(setT(tpclDoc(XB.msi), { symbology: 'itf' })), XB.itf);
  assert.equal(xbOf(setT(tpclDoc(XB.code39), { symbology: 'industrial25' })), XB.industrial25);
  assert.equal(xbOf(setT(tpclDoc(XB.industrial25), { symbology: 'code39' })), XB.code39, 'the wide space is the wide bar again');
  assert.equal(xbOf(setT(tpclDoc(XB.industrial25), { symbology: 'codabar' })), XB.codabar);
  assert.equal(xbOf(setT(tpclDoc(XB.codabar), { symbology: 'industrial25' })), XB.industrial25);
});

test('TPCL updateItem: the start / stop option T / P / N is carried between widths-form symbologies and refused where the form cannot hold it', () => {
  for (const r of ['T', 'P', 'N']) {
    const doc = tpclDoc(XB.code39.replace('0120,1', `0120,1,${r}`));
    assert.equal(xbOf(setT(doc, { symbology: 'codabar' })), XB.codabar.replace('0120,1', `0120,1,${r}`), `Code 39 -> NW7 ${r}`);
    assert.equal(xbOf(setT(doc, { symbology: 'msi' })), XB.msi.replace('0120,1', `0120,1,${r}`), `-> MSI ${r}`);
    assert.equal(xbOf(setT(doc, { symbology: 'industrial25' })), XB.industrial25.replace('0120,1', `0120,1,${r}`), `-> Industrial 2 of 5 ${r}`);
    const nw7 = tpclDoc(XB.codabar.replace('0120,1', `0120,1,${r}`));
    assert.equal(xbOf(setT(nw7, { symbology: 'itf' })), XB.itf.replace('0120,1', `0120,1,${r}`), `NW7 -> ITF ${r}`);
    for (const to of ['code93', 'code128', 'ean13', 'upce']) assert.equal(setT(nw7, { symbology: to }), nw7, `NW7 ${r} -> ${to} would lose the option`);
    assert.equal(xbOf(setT(nw7, { check: 'none' })) === xbOf(nw7), true, 'no change');
  }
  assert.equal(xbOf(setT(tpclDoc(XB.msi.replace('0120,1', '0120,1,T')), { check: 'mod1010' })), '{XB01;0100,0200,1,4,03,03,09,09,00,1,0120,1,T|}', 'a check change keeps the option');
});

test('TPCL updateItem: every change between two of the eleven symbologies gives the target symbology, or is refused without changing the text', () => {
  for (const from of SYMBOLOGIES) {
    for (const to of SYMBOLOGIES.filter(s => s !== from)) {
      const doc = tpclDoc(XB[from]);
      const out = setT(doc, { symbology: to });
      assert.notEqual(out, doc, `${from} -> ${to}`);
      const item = itemT(out);
      assert.equal(item.symbology, to, `${from} -> ${to}`);
      assert.equal(out.includes('{RB01;1234567|}'), true, 'the data stays');
      assert.deepEqual(levels(tpclParse(out).diagnostics, 'warning', 'error'), [], `${from} -> ${to}`);
    }
  }
});

// --- TSPL selector

const BARCODE_S = (type, wide = 2) => `BARCODE 40,50,"${type}",96,1,90,2,${wide},"1234567"`;
const itemS = text => tsplParse(text).items.find(i => i.kind === 'barcode');
const setS = (text, changes) => tspl.updateItem(text, itemS(text), changes, { dpi: DPI });
const describeS = (text, withText = true) => tspl.describeItem(itemS(text), withText ? text : undefined, { dpi: DPI });
const lineOf = text => /BARCODE [^\r\n]*/.exec(text)[0];

test('TSPL describeItem: Tipo de código offers Code 93 and NW7 (no MSI or Industrial 2 of 5); their check options are the only ones of the manual', () => {
  for (const withText of [true, false]) {
    const d = describeS(tsplText(BARCODE_S('93', 4)), withText);
    assert.deepEqual(optionsOf(d, 'symbology'), ['code128', 'code39', 'itf', 'code93', 'codabar', 'ean13', 'ean8', 'upca', 'upce']);
    assert.deepEqual([valueOf(d, 'symbology'), valueOf(d, 'check')], ['code93', 'auto']);
    assert.deepEqual(optionsOf(d, 'check'), ['auto']);
    assert.equal(d.fields.some(f => f.key === 'wide'), false, 'Code 93 has no wide bar field');
    const coda = describeS(tsplText(BARCODE_S('CODA', 5)), withText);
    assert.deepEqual([valueOf(coda, 'symbology'), valueOf(coda, 'check')], ['codabar', 'none']);
    assert.deepEqual(optionsOf(coda, 'check'), ['none']);
    assert.equal(valueOf(coda, 'wide'), 5);
    assert.equal(valueOf(describeS(tsplText(BARCODE_S('MSI')), withText), 'symbology'), undefined, 'types without a row stay without a selector');
  }
});

test('TSPL updateItem: the type string follows the symbology, the wide argument follows its class (ratio 1:2 for Code 93, 3:1 for Code 39 / NW7, = narrow else)', () => {
  assert.equal(lineOf(setS(tsplText(BARCODE_S('128')), { symbology: 'code93' })), BARCODE_S('93', 4));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('128')), { symbology: 'codabar' })), BARCODE_S('CODA', 6));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('39', 6)), { symbology: 'code93' })), BARCODE_S('93', 4));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('93', 4)), { symbology: 'code39' })), BARCODE_S('39', 6));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('93', 4)), { symbology: 'ean13' })), BARCODE_S('EAN13'));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('EAN13')), { symbology: 'code93' })), BARCODE_S('93', 4));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('CODA', 5)), { symbology: 'code39' })), BARCODE_S('39', 5), 'between wide / narrow types the wide argument stays');
  assert.equal(lineOf(setS(tsplText(BARCODE_S('39C', 5)), { symbology: 'codabar' })), BARCODE_S('CODA', 5));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('CODA', 5)), { symbology: 'itf' })), BARCODE_S('25', 5));
  assert.equal(setS(tsplText(BARCODE_S('93', 4)), { check: 'none' }), tsplText(BARCODE_S('93', 4)), 'Code 93 has only the automatic check');
  assert.equal(setS(tsplText(BARCODE_S('CODA', 5)), { check: 'auto' }), tsplText(BARCODE_S('CODA', 5)));
  for (const bad of ['msi', 'industrial25']) assert.equal(setS(tsplText(BARCODE_S('93', 4)), { symbology: bad }), tsplText(BARCODE_S('93', 4)), bad);
});

// --- Data that the symbology cannot encode: the command is still written, with one warning per symbology

test('emit: data a new symbology cannot encode is written anyway with one warning per symbology (TPCL and TSPL)', () => {
  const tpclOut = emitT([neutral({ symbology: 'msi', check: 'none', data: 'ABC' }), neutral({ symbology: 'msi', check: 'none', data: 'x1' }), neutral({ symbology: 'msi', check: 'none', data: '123' })]);
  assert.equal(tpclOut.text.split('\n').filter(l => /^\{XB/.test(l)).length, 3);
  assert.equal(levels(tpclOut.diagnostics, 'warning').length, 1);
  assert.match(levels(tpclOut.diagnostics, 'warning')[0].text, /MSI: solo admite dígitos/);
  assert.deepEqual(levels(emitT([neutral({ symbology: 'msi', check: 'none', data: '123' })]).diagnostics, 'warning'), []);
  const tsplOut = emitS([sItem({ symbology: 'codabar', check: 'none', data: 'A1x' }), sItem({ symbology: 'codabar', check: 'none', data: 'A1y' })]);
  assert.equal(tsplOut.text.split('\r\n').filter(l => l.startsWith('BARCODE')).length, 2);
  assert.equal(levels(tsplOut.diagnostics, 'warning').length, 1);
  assert.match(levels(tsplOut.diagnostics, 'warning')[0].text, /NW7: no se puede codificar/);
  assert.deepEqual(levels(emitS([sItem({ symbology: 'codabar', check: 'none', data: 'A1B' })]).diagnostics, 'warning'), []);
});
