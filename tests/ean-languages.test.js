const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Task C1 of odd/tasks/component-candidates.md, languages part: the twelve EAN / UPC variants in TPCL (XB types 0 5 6 7 8 G H I J K L M,
// B-SV4 spec 6.3.9, generic form XBaa;x,y,d,e,ff,k,llll(,mnnnnnnnnnn,ooo,p,qq), e = 1 none / 2 check / 3 auto attach / 4,5 price check digit)
// and in TSPL (BARCODE types EAN13 EAN13+2 EAN13+5 EAN8 EAN8+2 EAN8+5 UPCA UPCA+2 UPCA+5 UPCE UPCE+2 UPCE+5, B-442/443 manual):
// parse, emit, the type selector rows, and the conversion between the two.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const { selector } = PB.slices.barcode;
const DPI = 203;
const DOT = 254 / DPI;

// [symbology, addon, TPCL type, TSPL type]
const VARIANTS = [
  ['ean13', 0, '5', 'EAN13'], ['ean13', 2, '7', 'EAN13+2'], ['ean13', 5, '8', 'EAN13+5'],
  ['ean8', 0, '0', 'EAN8'], ['ean8', 2, 'I', 'EAN8+2'], ['ean8', 5, 'J', 'EAN8+5'],
  ['upca', 0, 'K', 'UPCA'], ['upca', 2, 'L', 'UPCA+2'], ['upca', 5, 'M', 'UPCA+5'],
  ['upce', 0, '6', 'UPCE'], ['upce', 2, 'G', 'UPCE+2'], ['upce', 5, 'H', 'UPCE+5'],
];
const BASE = { ean13: '5901234123457', ean8: '96385074', upca: '036000291452', upce: '04252614' };
const dataOf = (symbology, addon) => BASE[symbology] + ({ 0: '', 2: '12', 5: '90000' })[addon];

const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));
const tpclParse = text => tpcl.parse(text, { dpi: DPI });
const tsplParse = text => tspl.parse(text, { dpi: DPI });
const tpclXB = (type, { check = '3', guard = '000', readable = '1', data = '5901234123457' } = {}) => `{XB01;0100,0200,${type},${check},03,0,0120,0,${guard},${readable},00|}{RB01;${data}|}`;
const tsplText = line => ['SIZE 100 mm,60 mm', 'REFERENCE 8,8', 'CLS', 'TEXT 10,10,"3",0,1,1,"HOLA"', line, 'PRINT 1,1', ''].join('\r\n');
const barcodeOf = parsed => parsed.items.find(i => i.kind === 'barcode');

// --- TPCL parse

test('TPCL parse: the twelve types give the neutral symbology and add-on', () => {
  for (const [symbology, addon, type] of VARIANTS) {
    const parsed = tpclParse(tpclXB(type, { data: dataOf(symbology, addon) }));
    const item = barcodeOf(parsed);
    assert.equal(item.symbology, symbology, type);
    assert.equal(item.addon, addon, type);
    assert.equal(item.check, 'auto', type);
    assert.equal(item.humanReadable, true, type);
    assert.equal(item.guard, 0, type);
    assert.equal(item.native.type, type);
    assert.equal(item.native.checkDigit, '3');
    assert.equal(item.data, dataOf(symbology, addon));
    assert.ok(Math.abs(item.module - 3 * DOT) < 1e-9);
    assert.deepEqual(levels(parsed.diagnostics, 'warning', 'error'), [], type);
  }
});

test('TPCL parse: check digit options 1 / 2 / 3 map to none / check / auto, 4 / 5 (price check digit) are unsupported', () => {
  const check = e => barcodeOf(tpclParse(tpclXB('5', { check: e }))).check;
  assert.deepEqual(['1', '2', '3', '4', '5'].map(check), ['none', 'check', 'auto', 'unsupported', 'unsupported']);
});

test('TPCL parse: the WPC guard bar length (0.1 mm) and the readable flag are kept; an omitted guard is 0', () => {
  assert.equal(barcodeOf(tpclParse(tpclXB('5', { guard: '050' }))).guard, 50);
  assert.equal(barcodeOf(tpclParse(tpclXB('5', { readable: '0' }))).humanReadable, false);
  assert.equal(barcodeOf(tpclParse('{XB01;0100,0200,5,3,03,0,0120|}{RB01;590123412345|}')).guard, 0);
});

test('TPCL parse: Code 128 and the other types are untouched (no add-on, no guard)', () => {
  const c128 = barcodeOf(tpclParse('{XB01;0100,0200,9,0,03,0,0100,0,000,1,00|}'));
  assert.equal('addon' in c128, false);
  assert.equal('guard' in c128, false);
  assert.equal(barcodeOf(tpclParse('{XB01;0100,0200,Z,0,03,0,0100,0,000,1,00|}')).symbology, 'unknown');
});

// --- TPCL emit

const model = (items = []) => ({
  language: 'tpcl', size: { width: 990, height: 550, pitch: 610, gap: null, native: {} }, items, diagnostics: [],
});
const neutral = (props = {}) => ({
  kind: 'barcode', x: 50, y: 60, symbology: 'ean13', addon: 0, check: 'auto', module: 2.5, rotation: 0, height: 80, humanReadable: true, data: '5901234123457', ...props,
});
const emitT = items => PB.languages.emit('tpcl', model(items), { dpi: DPI });
const bodyT = items => emitT(items).text.split('\n').filter(l => /^\{(XB|RB)/.test(l));

test('TPCL emit: each variant writes its type character, auto check digit (3) and the RB data', () => {
  for (const [symbology, addon, type] of VARIANTS) {
    const data = dataOf(symbology, addon);
    assert.deepEqual(bodyT([neutral({ symbology, addon, data })]), [`{XB00;0050,0060,${type},3,02,0,0080,0,000,1,00|}`, `{RB00;${data}|}`], type);
  }
});

test('TPCL emit: check digit option, guard length and a missing check / add-on', () => {
  assert.equal(bodyT([neutral({ check: 'none' })])[0], '{XB00;0050,0060,5,1,02,0,0080,0,000,1,00|}');
  assert.equal(bodyT([neutral({ check: 'check' })])[0], '{XB00;0050,0060,5,2,02,0,0080,0,000,1,00|}');
  assert.equal(bodyT([neutral({ check: undefined })])[0], '{XB00;0050,0060,5,3,02,0,0080,0,000,1,00|}', 'default: auto attach');
  assert.equal(bodyT([neutral({ guard: 50 })])[0], '{XB00;0050,0060,5,3,02,0,0080,0,050,1,00|}');
  assert.equal(bodyT([neutral({ guard: 500 })])[0], '{XB00;0050,0060,5,3,02,0,0080,0,100,1,00|}', 'at most 100');
  assert.equal(bodyT([neutral({ addon: undefined })])[0].split(',')[2], '5');
  const odd = emitT([neutral({ check: 'unsupported' }), neutral({ check: 'unsupported' })]);
  assert.equal(levels(odd.diagnostics, 'warning').length, 1);
  assert.match(levels(odd.diagnostics, 'warning')[0].text, /unsupported/);
});

test('TPCL emit: counters and zero suppression stay in the generic form', () => {
  assert.equal(bodyT([neutral({ counter: { step: 1 }, zeroSuppress: 3 })])[0], '{XB00;0050,0060,5,3,02,0,0080,+0000000001,000,1,03|}');
});

test('TPCL emit: data that the symbology cannot take warns once per symbology, the command is still written', () => {
  const out = emitT([neutral({ data: '12345' }), neutral({ data: 'ABC' })]);
  assert.equal(out.text.split('\n').filter(l => /^\{XB/.test(l)).length, 2);
  const warnings = levels(out.diagnostics, 'warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /EAN-13/);
  assert.deepEqual(levels(emitT([neutral()]).diagnostics, 'warning'), []);
});

test('TPCL round trip: emit then parse gives back the neutral fields', () => {
  for (const [symbology, addon] of VARIANTS) {
    for (const check of ['none', 'check', 'auto']) {
      const data = dataOf(symbology, addon);
      const parsed = tpclParse(emitT([neutral({ symbology, addon, check, data, guard: 40 })]).text);
      const item = barcodeOf(parsed);
      assert.deepEqual([item.symbology, item.addon, item.check, item.data, item.guard, item.humanReadable], [symbology, addon, check, data, 40, true]);
    }
  }
});

// --- TSPL parse / emit

test('TSPL parse: the twelve types give the neutral symbology, add-on and automatic check; no more "add-on not drawn" info', () => {
  for (const [symbology, addon, , type] of VARIANTS) {
    const parsed = tsplParse(tsplText(`BARCODE 40,50,"${type}",96,1,0,2,2,"${dataOf(symbology, addon)}"`));
    const item = barcodeOf(parsed);
    assert.deepEqual([item.symbology, item.addon, item.check, item.native.type, item.data], [symbology, addon, 'auto', type, dataOf(symbology, addon)], type);
    assert.equal('guard' in item, false);
    assert.deepEqual(parsed.diagnostics, [], type);
    assert.equal(barcodeOf(tsplParse(tsplText(`BARCODE 40,50,"${type.toLowerCase()}",96,1,0,2,2,"1"`))).symbology, symbology, 'case insensitive');
  }
});

test('TSPL parse: a type that is not one of the twelve keeps the unknown path', () => {
  for (const type of ['EAN13+3', 'UPCA+22', 'EAN5']) {
    const item = barcodeOf(tsplParse(tsplText(`BARCODE 40,50,"${type}",96,1,0,2,2,"1"`)));
    assert.equal(item.symbology, 'unknown', type);
  }
});

const emitS = items => PB.languages.emit('tspl', { language: 'tspl', size: { width: 1000, height: 600, pitch: null, gap: null, native: {} }, items, diagnostics: [] }, { dpi: DPI });
const lineS = items => emitS(items).text.split('\r\n').find(l => l.startsWith('BARCODE'));
const sItem = (props = {}) => neutral({ x: 40 * DOT, y: 230 * DOT, module: 2 * DOT, height: 100 * DOT, ...props });

test('TSPL emit: each variant writes its type, wide = narrow, the data and no check option', () => {
  for (const [symbology, addon, , type] of VARIANTS) {
    const data = dataOf(symbology, addon);
    assert.equal(lineS([sItem({ symbology, addon, data })]), `BARCODE 40,230,"${type}",100,1,0,2,2,"${data}"`, type);
  }
});

test('TSPL emit: a check option TSPL has no counterpart for, and the TPCL guard, are reported once; data that does not fit warns', () => {
  const none = emitS([sItem({ check: 'none' }), sItem({ check: 'check' })]);
  assert.equal(lineS([sItem({ check: 'none' })]).includes('"EAN13"'), true);
  assert.equal(levels(none.diagnostics, 'warning').filter(d => /dígito de control/.test(d.text)).length, 1);
  assert.deepEqual(levels(emitS([sItem()]).diagnostics, 'warning'), []);
  assert.equal(levels(emitS([sItem({ guard: 40 })]).diagnostics, 'info').filter(d => /guarda/.test(d.text)).length, 1);
  const bad = emitS([sItem({ data: '12345' }), sItem({ data: 'ABC' })]);
  assert.equal(levels(bad.diagnostics, 'warning').length, 1);
  assert.match(levels(bad.diagnostics, 'warning')[0].text, /EAN-13/);
});

test('TSPL round trip: emit then parse gives back the neutral fields', () => {
  for (const [symbology, addon] of VARIANTS) {
    const data = dataOf(symbology, addon);
    const item = barcodeOf(tsplParse(emitS([sItem({ symbology, addon, data, humanReadable: false, rotation: 90 })]).text));
    assert.deepEqual([item.symbology, item.addon, item.check, item.data, item.humanReadable, item.rotation], [symbology, addon, 'auto', data, false, 90]);
  }
});

// --- Conversion

const convert = (source, target) => {
  const result = PB.convert.run(source, target, { dpi: DPI });
  return { result, converted: PB.languages.get(target).parse(result.text, { dpi: DPI }) };
};

test('conversion TPCL -> TSPL -> TPCL keeps all twelve variants exactly (symbology, add-on, data, check, readable)', () => {
  for (const [symbology, addon, tpclType, tsplType] of VARIANTS) {
    const data = dataOf(symbology, addon);
    const source = `{D0990,0550,0990|}{C|}${tpclXB(tpclType, { data })}`;
    const toTspl = convert(source, 'tspl');
    assert.match(toTspl.result.text, new RegExp(`BARCODE \\d+,\\d+,"${tsplType.replace('+', '\\+')}",`), tsplType);
    assert.deepEqual(levels(toTspl.result.diagnostics, 'warning'), [], tsplType);
    const middle = barcodeOf(toTspl.converted);
    assert.deepEqual([middle.symbology, middle.addon, middle.data, middle.check, middle.humanReadable], [symbology, addon, data, 'auto', true]);
    const back = convert(toTspl.result.text, 'tpcl');
    assert.deepEqual(levels(back.result.diagnostics, 'warning'), [], tpclType);
    const item = barcodeOf(back.converted);
    assert.deepEqual([item.symbology, item.addon, item.data, item.check, item.native.type], [symbology, addon, data, 'auto', tpclType]);
  }
});

test('conversion TSPL -> TPCL: the twelve types become the TPCL type characters', () => {
  for (const [symbology, addon, tpclType, tsplType] of VARIANTS) {
    const data = dataOf(symbology, addon);
    const out = convert(tsplText(`BARCODE 40,50,"${tsplType}",96,1,0,2,2,"${data}"`), 'tpcl');
    assert.deepEqual(levels(out.result.diagnostics, 'warning'), [], tsplType);
    const item = barcodeOf(out.converted);
    assert.deepEqual([item.native.type, item.symbology, item.addon, item.data], [tpclType, symbology, addon, data], tsplType);
  }
});

test('conversion TPCL -> TSPL: a check option TSPL cannot express and the guard length are reported', () => {
  const none = convert(`{D0990,0550,0990|}{C|}${tpclXB('5', { check: '1', guard: '050' })}`, 'tspl');
  const texts = none.result.diagnostics.map(d => d.text).join('|');
  assert.match(texts, /dígito de control/);
  assert.match(texts, /guarda/);
  assert.equal(barcodeOf(none.converted).symbology, 'ean13');
});

// --- Type selector: the rows of the tables and the re-emit rules of B2

const XB = {
  ean13: '{XB01;0100,0200,5,3,03,1,0120,0,000,1,00|}',
  code128: '{XB01;0100,0200,9,1,03,1,0120,0,000,1,00|}',
  code39: '{XB01;0100,0200,3,1,03,03,09,09,03,1,0120,1|}',
};
const tpclDoc = (xb, data = '5901234123457') => ['{D0400,0600,0400|}', '{C|}', xb, `{RB01;${data}|}`, ''].join('\n');
const itemT = text => tpclParse(text).items.find(i => i.kind === 'barcode');
const setT = (text, changes) => tpcl.updateItem(text, itemT(text), changes, { dpi: DPI });
const describeT = (text, withText = true) => tpcl.describeItem(itemT(text), withText ? text : undefined);
const valueOf = (d, key) => (d.fields.find(f => f.key === key) || {}).value;
const optionsOf = (d, key) => ((d.fields.find(f => f.key === key) || {}).options || []).map(o => o.value);
const xbOf = text => /\{XB01;[^|]*\|\}/.exec(text)[0];

test('selector: the data-driven labels list the new symbologies in order, after Code 128 / 39 / ITF', () => {
  assert.deepEqual(Object.keys(selector.LABELS), ['code128', 'code39', 'itf', 'ean13', 'ean8', 'upca', 'upce']);
  assert.deepEqual(Object.keys(selector.CHECK_LABELS), ['none', 'mod43', 'check', 'auto']);
  assert.deepEqual(Object.keys(selector.ADDON_LABELS), ['0', '2', '5']);
  assert.equal(selector.LABELS.ean13, 'EAN-13');
});

test('TPCL describeItem: Tipo de código offers the four symbologies, Dígito de control none / check / auto, Complemento 0 / 2 / 5', () => {
  for (const withText of [true, false]) {
    const d = describeT(tpclDoc(XB.ean13), withText);
    assert.deepEqual(optionsOf(d, 'symbology'), ['code128', 'code39', 'itf', 'ean13', 'ean8', 'upca', 'upce']);
    assert.deepEqual([valueOf(d, 'symbology'), valueOf(d, 'check'), valueOf(d, 'addon')], ['ean13', 'auto', 0]);
    assert.deepEqual(optionsOf(d, 'check'), ['none', 'check', 'auto']);
    assert.deepEqual(optionsOf(d, 'addon'), [0, 2, 5]);
    assert.deepEqual(d.fields.slice(0, 3).map(f => [f.key, f.label]), [['symbology', 'Tipo de código'], ['check', 'Dígito de control'], ['addon', 'Complemento']]);
    assert.equal(valueOf(describeT(tpclDoc(XB.ean13.replace('5,3', '8,2')), withText), 'addon'), 5);
    assert.equal(valueOf(describeT(tpclDoc(XB.ean13.replace('5,3', '5,4')), withText), 'check'), 'unsupported');
    assert.equal(valueOf(describeT(tpclDoc(XB.code128), withText), 'addon'), undefined, 'Code 128 has no add-on');
  }
});

test('TPCL updateItem: the type character follows the symbology and the add-on, the check digit follows the option', () => {
  const doc = tpclDoc(XB.ean13);
  assert.equal(xbOf(setT(doc, { symbology: 'upca' })), '{XB01;0100,0200,K,3,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(doc, { symbology: 'ean8' })), '{XB01;0100,0200,0,3,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(doc, { symbology: 'upce' })), '{XB01;0100,0200,6,3,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(doc, { addon: 2 })), '{XB01;0100,0200,7,3,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(doc, { addon: 5 })), '{XB01;0100,0200,8,3,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(doc, { check: 'none' })), '{XB01;0100,0200,5,1,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(doc, { check: 'check' })), '{XB01;0100,0200,5,2,03,1,0120,0,000,1,00|}');
  const plus2 = tpclDoc(XB.ean13.replace('5,3', '7,3'), '590123412345712');
  assert.equal(xbOf(setT(plus2, { symbology: 'upce' })), '{XB01;0100,0200,G,3,03,1,0120,0,000,1,00|}', 'the add-on is carried over');
  assert.equal(xbOf(setT(plus2, { addon: 0 })), '{XB01;0100,0200,5,3,03,1,0120,0,000,1,00|}');
  assert.equal(setT(doc, { check: 'mod43' }), doc, 'a check option the symbology has no row for');
  assert.equal(setT(doc, { addon: 3 }), doc);
  assert.equal(setT(doc, { symbology: 'ean13' }), doc, 'nothing changes');
  assert.equal(setT(doc, { addon: 0 }), doc);
  assert.equal(setT(doc, { check: 'auto' }), doc);
});

test('TPCL updateItem: the guard length, readable flag, counters and the RB data survive WPC <-> Code 128 changes', () => {
  const guarded = tpclDoc('{XB01;0100,0200,5,2,03,1,0120,+0000000001,050,1,03|}');
  assert.equal(xbOf(setT(guarded, { symbology: 'ean8' })), '{XB01;0100,0200,0,2,03,1,0120,+0000000001,050,1,03|}');
  assert.equal(setT(guarded, { symbology: 'ean8' }).includes('{RB01;5901234123457|}'), true);
  assert.equal(setT(guarded, { symbology: 'code39' }), guarded, 'a guard bar cannot leave the generic form');
  assert.equal(setT(tpclDoc(XB.ean13.replace('5,3', '7,3')), { symbology: 'code128' }), tpclDoc(XB.ean13.replace('5,3', '7,3')), 'an add-on would be lost');
  assert.equal(setT(tpclDoc(XB.ean13.replace('5,3', '7,3')), { symbology: 'code39' }), tpclDoc(XB.ean13.replace('5,3', '7,3')));
});

test('TPCL updateItem: moving between Code 128 / Code 39 and the WPC types re-emits both forms; the check digit defaults to auto', () => {
  assert.equal(xbOf(setT(tpclDoc(XB.code128), { symbology: 'ean13' })), '{XB01;0100,0200,5,3,03,1,0120,0,000,1,00|}');
  assert.equal(xbOf(setT(tpclDoc(XB.code39.replace('3,1,03', '3,3,03')), { symbology: 'upca' })), '{XB01;0100,0200,K,3,03,1,0120,0,000,1,00|}', 'a Code 39 mod 43 is not an option of UPC-A');
  assert.equal(xbOf(setT(tpclDoc(XB.ean13.replace('5,3', '5,1')), { symbology: 'code39' })), XB.code39);
  assert.equal(xbOf(setT(tpclDoc(XB.ean13), { symbology: 'code128' })), '{XB01;0100,0200,9,1,03,1,0120,0,000,1,00|}');
  assert.equal(itemT(setT(tpclDoc(XB.code128), { symbology: 'ean13' })).symbology, 'ean13');
  const back = setT(setT(tpclDoc(XB.code128), { symbology: 'ean13' }), { symbology: 'code128' });
  assert.equal(itemT(back).symbology, 'code128');
});

// --- TSPL selector

const BARCODE_S = type => `BARCODE 40,50,"${type}",96,1,90,2,2,"5901234123457"`;
const itemS = text => tsplParse(text).items.find(i => i.kind === 'barcode');
const setS = (text, changes) => tspl.updateItem(text, itemS(text), changes, { dpi: DPI });
const describeS = (text, withText = true) => tspl.describeItem(itemS(text), withText ? text : undefined, { dpi: DPI });
const lineOf = text => /BARCODE [^\r\n]*/.exec(text)[0];

test('TSPL describeItem: Tipo de código offers the four symbologies, the check is automatic only, Complemento 0 / 2 / 5', () => {
  for (const withText of [true, false]) {
    const d = describeS(tsplText(BARCODE_S('EAN13+2')), withText);
    assert.deepEqual(optionsOf(d, 'symbology'), ['code128', 'code39', 'itf', 'ean13', 'ean8', 'upca', 'upce']);
    assert.deepEqual([valueOf(d, 'symbology'), valueOf(d, 'check'), valueOf(d, 'addon')], ['ean13', 'auto', 2]);
    assert.deepEqual(optionsOf(d, 'check'), ['auto']);
    assert.deepEqual(optionsOf(d, 'addon'), [0, 2, 5]);
    assert.equal(valueOf(describeS(tsplText(BARCODE_S('128')), withText), 'addon'), undefined);
    assert.equal(valueOf(describeS(tsplText(BARCODE_S('93')), withText), 'symbology'), undefined, 'types without a row stay without a selector');
  }
});

test('TSPL updateItem: the type string follows the symbology and add-on; the other arguments stay as written', () => {
  const doc = tsplText(BARCODE_S('EAN13'));
  assert.equal(lineOf(setS(doc, { symbology: 'upca' })), BARCODE_S('UPCA'));
  assert.equal(lineOf(setS(doc, { symbology: 'ean8' })), BARCODE_S('EAN8'));
  assert.equal(lineOf(setS(doc, { symbology: 'upce' })), BARCODE_S('UPCE'));
  assert.equal(lineOf(setS(doc, { addon: 2 })), BARCODE_S('EAN13+2'));
  assert.equal(lineOf(setS(doc, { addon: 5 })), BARCODE_S('EAN13+5'));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('UPCE+5')), { addon: 0 })), BARCODE_S('UPCE'));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('EAN8+2')), { symbology: 'upca' })), BARCODE_S('UPCA+2'), 'the add-on is carried over');
  assert.equal(setS(doc, { symbology: 'ean13' }), doc);
  assert.equal(setS(doc, { addon: 0 }), doc);
  assert.equal(setS(doc, { addon: 3 }), doc);
  assert.equal(setS(doc, { check: 'none' }), doc, 'TSPL has no such option for these types');
  assert.equal(setS(tsplText(BARCODE_S('93')), { symbology: 'ean13' }), tsplText(BARCODE_S('93')));
});

test('TSPL updateItem: Code 128 / 39 / ITF <-> WPC adjust the wide argument; an add-on cannot go to a type without one', () => {
  assert.equal(lineOf(setS(tsplText('BARCODE 40,50,"39",96,1,90,2,6,"123"'), { symbology: 'ean13' })), 'BARCODE 40,50,"EAN13",96,1,90,2,2,"123"');
  assert.equal(lineOf(setS(tsplText(BARCODE_S('EAN13')), { symbology: 'code39' })), 'BARCODE 40,50,"39",96,1,90,2,6,"5901234123457"');
  assert.equal(lineOf(setS(tsplText(BARCODE_S('EAN13')), { symbology: 'code128' })), BARCODE_S('128'));
  assert.equal(lineOf(setS(tsplText(BARCODE_S('128')), { symbology: 'upca' })), BARCODE_S('UPCA'));
  const plus = tsplText(BARCODE_S('EAN13+2'));
  assert.equal(setS(plus, { symbology: 'code128' }), plus);
  assert.equal(setS(plus, { symbology: 'itf' }), plus);
});
