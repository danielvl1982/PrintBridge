const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Barcode type selector and check digit option (task B2 of odd/tasks/component-candidates.md).
// The panel changes the symbology ('Tipo de código') and its check digit option ('Dígito de control') among the symbologies the viewer
// draws exactly and the emitters write (Code 128, Code 39, ITF), by RE-EMITTING the barcode's format command (TPCL XB: type character
// and parameter layout; TSPL BARCODE: type string and wide argument). Everything else of the item and of the text survives.
// The selector is data driven: the options come from PB.slices.barcode.selector over the tables of the language.
// TPCL (B-SV4 spec 6.3.9): generic form  XBaa;x,y,d,e,ff,k,llll(,mnnnnnnnnnn,ooo,p,qq)   (type 9 / A: Code 128)
//                          widths form   XBaa;x,y,d,e,ff,gg,hh,ii,jj,k,llll(,mnnnnnnnnnn,p,qq)(,r)   (type 2 ITF, 3 / B Code 39)
//   the check digit e: 1 = none, 3 = automatic (Modulus 43 for Code 39).
// TSPL: BARCODE x,y,"type",height,readable,rotation,narrow,wide,[alignment,]"content"  (128, 39 / 39C, 25).
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const { selector } = PB.slices.barcode;

const SYMBOLOGIES = ['code128', 'code39', 'itf'];
const DPI = 203;

// --- TPCL fixtures: x 0100, y 0200, rotation 90 (digit 1), height 0120, human readable, 3 dots
const XB = {
  code128: '{XB01;0100,0200,9,1,03,1,0120,0,000,1,00|}',
  code39: '{XB01;0100,0200,3,1,03,03,09,09,03,1,0120,1|}',
  itf: '{XB01;0100,0200,2,1,03,03,09,09,00,1,0120,1|}',
};
const tpclText = (symbology, eol = '\n', xb = XB[symbology]) => ['{D0400,0600,0400|}', '{C|}', '{PC001;0050,0050,10,05,J,00,B=HOLA|}', xb, '{RB01;12345678|}', '{XS;I,0001,0002C4100|}', ''].join(eol);
const parseT = text => tpcl.parse(text, { dpi: DPI });
const barcodeT = text => parseT(text).items.find(i => i.kind === 'barcode');
const setT = (text, changes) => tpcl.updateItem(text, barcodeT(text), changes, { dpi: DPI });
const describeT = (text, withText = true) => tpcl.describeItem(barcodeT(text), withText ? text : undefined);
const maskXB = text => text.replace(/\{XB01;[^|]*\|\}/, '<XB>');
const valueOf = (description, key) => (description.fields.find(f => f.key === key) || {}).value;
const optionsOf = (description, key) => ((description.fields.find(f => f.key === key) || {}).options || []).map(o => o.value);

// --- TSPL fixtures: REFERENCE 8,8 is folded into the coordinates and must survive
const BARCODE = {
  code128: 'BARCODE 40,50,"128",96,1,90,2,2,"ABC123"',
  code39: 'BARCODE 40,50,"39",96,1,90,2,4,"ABC123"',
  itf: 'BARCODE 40,50,"25",96,1,90,2,4,"123456"',
};
const tsplText = (line, eol = '\r\n') => ['SIZE 100 mm,60 mm', 'REFERENCE 8,8', 'CLS', 'TEXT 10,10,"3",0,1,1,"HOLA"', line, 'PRINT 1,1', ''].join(eol);
const parseS = text => tspl.parse(text, { dpi: DPI });
const barcodeS = text => parseS(text).items.find(i => i.kind === 'barcode');
const setS = (text, changes) => tspl.updateItem(text, barcodeS(text), changes, { dpi: DPI });
const describeS = (text, withText = true) => tspl.describeItem(barcodeS(text), withText ? text : undefined, { dpi: DPI });
const maskBarcode = text => text.replace(/BARCODE [^\r\n]*/, '<BARCODE>');
const barcodeLine = text => /BARCODE [^\r\n]*/.exec(text)[0];

const SAME_ITEM = ['x', 'y', 'rotation', 'height', 'humanReadable'];
const pickSame = item => Object.fromEntries(SAME_ITEM.map(k => [k, item[k]]));

// --- The data-driven table

test('selector: the options come from the tables of the language (labels order, only rows with an emit entry)', () => {
  assert.deepEqual(selector.symbologyOptions({ itf: '2', code39: '3', code128: '9' }).map(o => o.value), SYMBOLOGIES);
  assert.deepEqual(selector.symbologyOptions({ code39: '3' }).map(o => o.value), ['code39']);
  assert.deepEqual(selector.symbologyOptions({}), []);
  assert.deepEqual(selector.checkOptions({ code39: { none: '1', mod43: '3' } }, 'code39').map(o => o.value), ['none', 'mod43']);
  assert.deepEqual(selector.checkOptions({ code39: { none: '1' } }, 'code128'), []);
  for (const o of [...selector.symbologyOptions({ code128: 1, code39: 1, itf: 1 }), ...selector.checkOptions({ code39: { none: 1, mod43: 1 } }, 'code39')]) {
    assert.equal(typeof o.label, 'string');
    assert.ok(o.label.length > 0);
  }
});

test('selector: adding a row to the tables (and a label) adds an option, with no other change', () => {
  const typeCodes = { code128: '9', code39: '3', itf: '2', ean13: '5' };
  const labels = { ...selector.LABELS, ean13: 'EAN-13' };
  const options = selector.symbologyOptions(typeCodes, labels);
  assert.deepEqual(options.map(o => o.value), [...SYMBOLOGIES, 'ean13']);
  assert.equal(options.at(-1).label, 'EAN-13');
  // a row without a label is not offered (it has no name to show)
  assert.deepEqual(selector.symbologyOptions({ ...typeCodes, ean8: '0' }, labels).map(o => o.value), [...SYMBOLOGIES, 'ean13']);
  const checks = selector.checkOptions({ ean13: { none: '1', auto: '3' } }, 'ean13', { ...selector.CHECK_LABELS, auto: 'Automático' });
  assert.deepEqual(checks, [{ value: 'none', label: selector.CHECK_LABELS.none }, { value: 'auto', label: 'Automático' }]);
});

// --- describeItem

test('describeItem TPCL: Tipo de código lists the registered symbologies and Dígito de control those of the current one', () => {
  for (const withText of [true, false]) {
    const c128 = describeT(tpclText('code128'), withText);
    assert.deepEqual(c128.fields.slice(0, 1).map(f => [f.key, f.label, f.type, f.value]), [['symbology', 'Tipo de código', 'select', 'code128']], String(withText));
    assert.deepEqual(optionsOf(c128, 'symbology'), SYMBOLOGIES);
    assert.equal(valueOf(c128, 'check'), undefined, 'Code 128: the viewer models no check digit');

    const c39 = describeT(tpclText('code39'), withText);
    assert.equal(valueOf(c39, 'symbology'), 'code39');
    assert.deepEqual(c39.fields.slice(1, 2).map(f => [f.key, f.label, f.type, f.value]), [['check', 'Dígito de control', 'select', 'none']]);
    assert.deepEqual(optionsOf(c39, 'check'), ['none', 'mod43']);
    assert.equal(valueOf(describeT(tpclText('code39', '\n', XB.code39.replace('3,1,03', '3,3,03')), withText), 'check'), 'mod43');

    const itf = describeT(tpclText('itf'), withText);
    assert.equal(valueOf(itf, 'symbology'), 'itf');
    assert.deepEqual(optionsOf(itf, 'check'), ['none']);
  }
});

test('describeItem TPCL: the same fields with and without the text; the other fields are still there', () => {
  for (const s of SYMBOLOGIES) {
    const withText = describeT(tpclText(s), true);
    const without = describeT(tpclText(s), false);
    assert.deepEqual(withText.fields.map(f => [f.key, f.value]), without.fields.map(f => [f.key, f.value]), s);
    const keys = withText.fields.map(f => f.key);
    for (const k of ['height', 'rotation', 'humanReadable', 'content']) assert.ok(keys.includes(k), `${s} ${k}`);
  }
});

test('describeItem TPCL: a check option the viewer does not know is listed as the current value; types without a row have no selector', () => {
  const odd = describeT(tpclText('itf', '\n', XB.itf.replace('2,1,03', '2,2,03')));
  assert.equal(valueOf(odd, 'check'), 'unsupported');
  assert.deepEqual(optionsOf(odd, 'check'), ['none', 'unsupported']);
  const ean = tpclText('code128', '\n', '{XB01;0100,0200,5,1,03,1,0120,0,000,1,00|}');
  assert.deepEqual(describeT(ean).fields.map(f => f.key).filter(k => ['symbology', 'check'].includes(k)), []);
  assert.deepEqual(describeT(ean, false).fields.map(f => f.key).filter(k => ['symbology', 'check'].includes(k)), []);
});

test('describeItem TSPL: Tipo de código and Dígito de control, with and without the text', () => {
  for (const withText of [true, false]) {
    const c128 = describeS(tsplText(BARCODE.code128), withText);
    assert.deepEqual(c128.fields.slice(0, 1).map(f => [f.key, f.label, f.type, f.value]), [['symbology', 'Tipo de código', 'select', 'code128']], String(withText));
    assert.deepEqual(optionsOf(c128, 'symbology'), SYMBOLOGIES);
    assert.equal(valueOf(c128, 'check'), undefined);
    const c39 = describeS(tsplText(BARCODE.code39), withText);
    assert.deepEqual([valueOf(c39, 'symbology'), valueOf(c39, 'check')], ['code39', 'none']);
    assert.deepEqual(optionsOf(c39, 'check'), ['none', 'mod43']);
    assert.deepEqual([valueOf(describeS(tsplText(BARCODE.code39.replace('"39"', '"39C"')), withText), 'check')], ['mod43']);
    const itf = describeS(tsplText(BARCODE.itf), withText);
    assert.deepEqual([valueOf(itf, 'symbology'), valueOf(itf, 'check')], ['itf', 'none']);
    assert.deepEqual(optionsOf(itf, 'check'), ['none']);
    assert.equal(valueOf(describeS(tsplText(BARCODE.itf.replace('"25"', '"25C"')), withText), 'check'), 'unsupported');
    assert.equal(valueOf(describeS(tsplText(BARCODE.code128.replace('"128"', '"EAN13"')), withText), 'symbology'), undefined);
    assert.equal(valueOf(describeS(tsplText(BARCODE.code128.replace('"128"', '"93"')), withText), 'symbology'), undefined);
  }
});

// --- updateItem: every pair

test('TPCL updateItem: every (from, to) pair re-parses to the new type with the same item, the same data and the other commands untouched', () => {
  for (const from of SYMBOLOGIES) {
    for (const to of SYMBOLOGIES) {
      for (const eol of ['\n', '\r\n']) {
        const text = tpclText(from, eol);
        const out = setT(text, { symbology: to });
        const label = `${from} -> ${to} ${JSON.stringify(eol)}`;
        if (from === to) { assert.equal(out, text, label); continue; }
        const [before, after] = [barcodeT(text), barcodeT(out)];
        assert.equal(after.symbology, to, label);
        assert.deepEqual(pickSame(after), pickSame(before), label);
        assert.equal(after.module, before.module, label);
        assert.equal(parseT(out).items.length, parseT(text).items.length, label);
        assert.equal(maskXB(out), maskXB(text), label);
        assert.equal(valueOf(describeT(out), 'content'), '12345678', label);
        assert.equal(valueOf(describeT(out), 'symbology'), to, label);
      }
    }
  }
});

test('TPCL updateItem: the rewritten commands are the slice emit of the item (type, check, widths, gap)', () => {
  assert.equal(setT(tpclText('code128'), { symbology: 'code39' }), tpclText('code128', '\n', '{XB01;0100,0200,3,1,03,03,09,09,03,1,0120,1|}'));
  assert.equal(setT(tpclText('code128'), { symbology: 'itf' }), tpclText('code128', '\n', '{XB01;0100,0200,2,1,03,03,09,09,00,1,0120,1|}'));
  assert.equal(setT(tpclText('code39'), { symbology: 'code128' }), tpclText('code39', '\n', '{XB01;0100,0200,9,1,03,1,0120,0,000,1,00|}'));
  // Code 39 <-> ITF: the widths stay, the inter-character space follows the manual (ITF: 00)
  assert.equal(setT(tpclText('code39'), { symbology: 'itf' }), tpclText('code39', '\n', XB.itf));
  assert.equal(setT(tpclText('itf'), { symbology: 'code39' }), tpclText('itf', '\n', XB.code39));
});

test('TPCL updateItem: explicit widths and the CRLF line breaks of the file are kept', () => {
  const wide = '{XB01;0100,0200,3,1,02,04,07,05,03,0,0100,1|}';
  const out = setT(tpclText('code39', '\r\n', wide), { symbology: 'itf' });
  assert.equal(out, tpclText('code39', '\r\n', '{XB01;0100,0200,2,1,02,04,07,05,00,0,0100,1|}'));
  assert.equal(barcodeT(out).widths.wideBar, barcodeT(tpclText('code39', '\r\n', wide)).widths.wideBar);
});

test('TPCL updateItem: the check digit changes Code 39 only; ITF and Code 128 have no other option', () => {
  const text = tpclText('code39');
  const mod43 = setT(text, { check: 'mod43' });
  assert.equal(mod43, tpclText('code39', '\n', '{XB01;0100,0200,3,3,03,03,09,09,03,1,0120,1|}'));
  assert.equal(barcodeT(mod43).check, 'mod43');
  assert.equal(setT(mod43, { check: 'none' }), text);
  assert.equal(setT(text, { check: 'bogus' }), text);
  assert.equal(setT(tpclText('itf'), { check: 'mod43' }), tpclText('itf'));
  assert.equal(setT(tpclText('code128'), { check: 'mod43' }), tpclText('code128'));
  assert.equal(setT(text, { check: 'none' }), text);
});

test('TPCL updateItem: the check digit is carried to a type that has it, else it goes back to none', () => {
  const mod43 = tpclText('code39', '\n', '{XB01;0100,0200,3,3,03,03,09,09,03,1,0120,1|}');
  assert.equal(setT(mod43, { symbology: 'itf', check: 'none' }), tpclText('code39', '\n', XB.itf));
  assert.equal(barcodeT(setT(mod43, { symbology: 'itf' })).check, 'none');
  const back = setT(setT(mod43, { symbology: 'itf' }), { symbology: 'code39' });
  assert.equal(barcodeT(back).check, 'none');
  // both changes at once: the type and its option
  assert.equal(setT(tpclText('itf'), { symbology: 'code39', check: 'mod43' }), mod43.replace('09,03,1', '09,03,1'));
  // an option the viewer does not know is not carried over
  const odd = tpclText('itf', '\n', XB.itf.replace('2,1,03', '2,2,03'));
  assert.equal(barcodeT(setT(odd, { symbology: 'code39' })).check, 'none');
});

test('TPCL updateItem: type B (full ASCII Code 39) is kept when only the check digit changes', () => {
  const full = tpclText('code39', '\n', XB.code39.replace(',3,1,03', ',B,1,03'));
  const out = setT(full, { check: 'mod43' });
  assert.equal(out, tpclText('code39', '\n', '{XB01;0100,0200,B,3,03,03,09,09,03,1,0120,1|}'));
  assert.equal(barcodeT(out).native.type, 'B');
  assert.equal(barcodeT(setT(full, { symbology: 'itf' })).native.type, '2');
});

test('TPCL updateItem: counters (increment, zero suppression) survive every pair', () => {
  const variants = {
    code128: '{XB01;0100,0200,9,1,03,1,0120,+0000000005,000,1,03|}',
    code39: '{XB01;0100,0200,3,1,03,03,09,09,03,1,0120,+0000000005,1,03|}',
    itf: '{XB01;0100,0200,2,1,03,03,09,09,00,1,0120,-0000000002,1,03|}',
  };
  for (const from of SYMBOLOGIES) {
    for (const to of SYMBOLOGIES.filter(s => s !== from)) {
      const text = tpclText(from, '\n', variants[from]);
      const out = setT(text, { symbology: to });
      const [a, b] = [barcodeT(text), barcodeT(out)];
      assert.equal(b.symbology, to, `${from} -> ${to}`);
      assert.deepEqual(b.counter, a.counter, `${from} -> ${to}`);
      assert.equal(b.zeroSuppress, 3, `${from} -> ${to}`);
      assert.equal(maskXB(out), maskXB(text));
    }
  }
  assert.equal(setT(tpclText('code128', '\n', variants.code128), { symbology: 'code39' }), tpclText('code128', '\n', variants.code39));
});

test('TPCL updateItem: an inline =data after the parameters is kept', () => {
  const inline = '{XB01;0100,0200,9,1,03,1,0120,0,000,1,00=ABC123|}';
  assert.equal(setT(tpclText('code128', '\n', inline), { symbology: 'code39' }), tpclText('code128', '\n', '{XB01;0100,0200,3,1,03,03,09,09,03,1,0120,1=ABC123|}'));
});

test('TPCL updateItem: a start/stop option stays between Code 39 and ITF; leaving the widths form refuses (no neutral field)', () => {
  const stop = tpclText('code39', '\n', XB.code39.replace('0120,1', '0120,1,T'));
  assert.equal(setT(stop, { symbology: 'itf' }), tpclText('code39', '\n', XB.itf.replace('0120,1', '0120,1,T')));
  assert.equal(setT(stop, { symbology: 'code128' }), stop);
  const guard = tpclText('code128', '\n', XB.code128.replace('0,000,1', '0,010,1'));
  assert.equal(setT(guard, { symbology: 'code39' }), guard);
});

test('TPCL updateItem: types without a row (EAN13, QR), unknown symbologies and invalid values leave the text unchanged', () => {
  const ean = tpclText('code128', '\n', '{XB01;0100,0200,5,1,03,1,0120,0,000,1,00|}');
  assert.equal(setT(ean, { symbology: 'code39' }), ean);
  const text = tpclText('code128');
  for (const bad of ['ean13', 'qr', 'unknown', '', null, 3, undefined]) assert.equal(setT(text, { symbology: bad }), text, String(bad));
  assert.equal(tpcl.updateItem(text, barcodeT(text), { symbology: 'itf' }, undefined), setT(text, { symbology: 'itf' }), 'without options the default resolution is used');
});

test('TPCL updateItem: the type change combines with the other fields of the same change', () => {
  const out = setT(tpclText('code128'), { symbology: 'code39', height: 200, rotation: 0, content: 'ABC' });
  const item = barcodeT(out);
  assert.equal(item.symbology, 'code39');
  assert.equal(item.height, 200);
  assert.equal(item.rotation, 0);
  assert.equal(item.data, 'ABC');
});

test('TPCL updateItem: after a type change the other fields of the new form keep working', () => {
  for (const to of SYMBOLOGIES) {
    let text = setT(tpclText('code128'), { symbology: to });
    text = tpcl.updateItem(text, barcodeT(text), { height: 250 }, { dpi: DPI });
    text = tpcl.updateItem(text, barcodeT(text), { rotation: 180 }, { dpi: DPI });
    text = tpcl.updateItem(text, barcodeT(text), { humanReadable: false }, { dpi: DPI });
    text = tpcl.updateItem(text, barcodeT(text), { counter: 4 }, { dpi: DPI });
    const item = barcodeT(text);
    assert.deepEqual([item.symbology, item.height, item.rotation, item.humanReadable, item.counter.step], [to, 250, 180, false, 4], to);
  }
});

test('TPCL updateItem: content that the new type cannot encode is still written, and the viewer warns on the next refresh', () => {
  const draw = text => PB.svgRenderer.render(parseT(text), { width: 1000, height: 600 }, { textScale: 1, values: {} }).diagnostics.filter(d => d.level === 'warning').map(d => d.text);
  const text = tpclText('code128').replace('12345678', 'ab-12');
  assert.deepEqual(draw(text), []);
  const itf = setT(text, { symbology: 'itf' });
  assert.equal(barcodeT(itf).symbology, 'itf');
  assert.equal(barcodeT(itf).data, 'ab-12');
  assert.ok(draw(itf).some(w => /ITF: solo admite dígitos/.test(w)), draw(itf).join('|'));
  const c39 = setT(text, { symbology: 'code39' });
  assert.ok(draw(c39).some(w => /no se puede codificar/.test(w)), draw(c39).join('|'));
  // odd digit count for ITF
  const odd = setT(tpclText('code128').replace('12345678', '1234567'), { symbology: 'itf' });
  assert.ok(draw(odd).some(w => /número impar/.test(w)));
});

// --- TSPL

test('TSPL updateItem: every (from, to) pair re-parses to the new type with the same item and data, the other lines untouched', () => {
  for (const from of SYMBOLOGIES) {
    for (const to of SYMBOLOGIES) {
      for (const eol of ['\n', '\r\n']) {
        const text = tsplText(BARCODE[from], eol);
        const out = setS(text, { symbology: to });
        const label = `${from} -> ${to} ${JSON.stringify(eol)}`;
        if (from === to) { assert.equal(out, text, label); continue; }
        const [before, after] = [barcodeS(text), barcodeS(out)];
        assert.equal(after.symbology, to, label);
        assert.deepEqual(pickSame(after), pickSame(before), label);
        assert.equal(after.module, before.module, label);
        assert.equal(after.data, before.data, label);
        assert.equal(maskBarcode(out), maskBarcode(text), label);
        assert.equal(valueOf(describeS(out), 'symbology'), to, label);
        assert.equal(valueOf(describeS(out), 'content'), before.data, label);
      }
    }
  }
});

test('TSPL updateItem: the BARCODE line is the slice emit of the item (type, wide argument)', () => {
  const lineOf = (from, to) => barcodeLine(setS(tsplText(BARCODE[from]), { symbology: to }));
  assert.equal(lineOf('code128', 'code39'), 'BARCODE 40,50,"39",96,1,90,2,6,"ABC123"');
  assert.equal(lineOf('code128', 'itf'), 'BARCODE 40,50,"25",96,1,90,2,6,"ABC123"');
  assert.equal(lineOf('code39', 'code128'), 'BARCODE 40,50,"128",96,1,90,2,2,"ABC123"');
  assert.equal(lineOf('itf', 'code128'), 'BARCODE 40,50,"128",96,1,90,2,2,"123456"');
  assert.equal(lineOf('code39', 'itf'), 'BARCODE 40,50,"25",96,1,90,2,4,"ABC123"');
  assert.equal(lineOf('itf', 'code39'), 'BARCODE 40,50,"39",96,1,90,2,4,"123456"');
});

test('TSPL updateItem: the check digit is the type string (39 / 39C); a type that already has the option is kept as written', () => {
  const text = tsplText(BARCODE.code39);
  const mod43 = setS(text, { check: 'mod43' });
  assert.equal(barcodeLine(mod43), 'BARCODE 40,50,"39C",96,1,90,2,4,"ABC123"');
  assert.equal(barcodeS(mod43).check, 'mod43');
  assert.equal(setS(mod43, { check: 'none' }), text);
  assert.equal(setS(text, { check: 'none' }), text);
  assert.equal(setS(text, { check: 'bogus' }), text);
  assert.equal(setS(tsplText(BARCODE.itf), { check: 'mod43' }), tsplText(BARCODE.itf));
  assert.equal(setS(tsplText(BARCODE.code128), { check: 'mod43' }), tsplText(BARCODE.code128));
  // 39S and ITF14 already mean "none" for their symbology
  const s39 = tsplText(BARCODE.code39.replace('"39"', '"39S"'));
  assert.equal(setS(s39, { check: 'none' }), s39);
  assert.equal(barcodeLine(setS(s39, { check: 'mod43' })), 'BARCODE 40,50,"39C",96,1,90,2,4,"ABC123"');
  const itf14 = tsplText(BARCODE.itf.replace('"25"', '"ITF14"'));
  assert.equal(setS(itf14, { symbology: 'itf' }), itf14);
  assert.equal(barcodeLine(setS(itf14, { symbology: 'code39' })), 'BARCODE 40,50,"39",96,1,90,2,4,"123456"');
  // carried to a type that has it, else back to none
  const c39c = tsplText(BARCODE.code39.replace('"39"', '"39C"'));
  assert.equal(barcodeLine(setS(c39c, { symbology: 'itf' })), 'BARCODE 40,50,"25",96,1,90,2,4,"ABC123"');
  assert.equal(barcodeLine(setS(tsplText(BARCODE.itf), { symbology: 'code39', check: 'mod43' })), 'BARCODE 40,50,"39C",96,1,90,2,4,"123456"');
});

test('TSPL updateItem: the alignment argument, the coordinates with REFERENCE and a counter content stay as written', () => {
  const aligned = tsplText('BARCODE 40,50,"128",96,2,90,2,2,3,"ABC123"');
  assert.equal(barcodeLine(setS(aligned, { symbology: 'code39' })), 'BARCODE 40,50,"39",96,2,90,2,6,3,"ABC123"');
  const counter = ['SIZE 100 mm,60 mm', 'SET COUNTER @1 1', '@1="0001"', 'CLS', 'BARCODE 40,50,"128",96,1,0,2,2,@1', 'PRINT 1,1', ''].join('\r\n');
  const out = setS(counter, { symbology: 'itf' });
  assert.equal(out, counter.replace('"128"', '"25"').replace(',2,2,@1', ',2,6,@1'));
  const item = barcodeS(out);
  assert.deepEqual([item.symbology, item.counter.step, item.data], ['itf', 1, '0001']);
});

test('TSPL updateItem: 128M / EAN128 content is rewritten by the parser: leaving Code 128 refuses; the symbology is already Code 128', () => {
  for (const type of ['128M', 'EAN128']) {
    const text = tsplText(`BARCODE 40,50,"${type}",96,1,0,2,2,"${type === '128M' ? '!104ABC!102DEF' : '0112345678901231'}"`);
    assert.equal(setS(text, { symbology: 'code39' }), text, type);
    assert.equal(setS(text, { symbology: 'code128' }), text, type);
    assert.equal(valueOf(describeS(text), 'symbology'), 'code128', type);
  }
});

test('TSPL updateItem: types without a row, add-ons, invalid values and an unparsable command leave the text unchanged', () => {
  for (const type of ['EAN13', '93', 'EAN13+2', 'UPCA']) {
    const text = tsplText(BARCODE.code128.replace('"128"', `"${type}"`));
    assert.equal(setS(text, { symbology: 'code39' }), text, type);
  }
  const text = tsplText(BARCODE.code128);
  for (const bad of ['ean13', 'qr', '', null, 3]) assert.equal(setS(text, { symbology: bad }), text, String(bad));
});

test('TSPL updateItem: after a type change the fields of the new type work (wide appears for Code 39 / ITF, goes for Code 128)', () => {
  let text = setS(tsplText(BARCODE.code128), { symbology: 'code39' });
  assert.deepEqual(describeS(text).fields.map(f => f.key), ['symbology', 'check', 'height', 'readable', 'rotation', 'narrow', 'wide', 'content']);
  text = tspl.updateItem(text, barcodeS(text), { wide: 5 }, { dpi: DPI });
  assert.equal(barcodeLine(text), 'BARCODE 40,50,"39",96,1,90,2,5,"ABC123"');
  // wide/narrow -> wide/narrow keeps the wide bar of the command
  assert.equal(barcodeLine(setS(text, { symbology: 'itf' })), 'BARCODE 40,50,"25",96,1,90,2,5,"ABC123"');
  const back = setS(text, { symbology: 'code128' });
  assert.deepEqual(describeS(back).fields.map(f => f.key), ['symbology', 'height', 'readable', 'rotation', 'narrow', 'content']);
  assert.equal(barcodeLine(back), 'BARCODE 40,50,"128",96,1,90,2,2,"ABC123"');
});

test('TSPL updateItem: content that the new type cannot encode is still written, and the viewer warns on the next refresh', () => {
  const draw = text => PB.svgRenderer.render(parseS(text), { width: 1000, height: 600 }, { textScale: 1, values: {} }).diagnostics.filter(d => d.level === 'warning').map(d => d.text);
  const text = tsplText(BARCODE.code128.replace('ABC123', 'ab-12'));
  assert.deepEqual(draw(text), []);
  const itf = setS(text, { symbology: 'itf' });
  assert.equal(barcodeS(itf).data, 'ab-12');
  assert.ok(draw(itf).some(w => /ITF: solo admite dígitos/.test(w)));
  assert.ok(draw(setS(text, { symbology: 'code39' })).some(w => /no se puede codificar/.test(w)));
});
