const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Counters (task B1 of odd/tasks/component-candidates.md).
// TPCL (B-SV4 spec 6.3.7 PC, 6.3.8 PV, 6.3.9 XB): the optional increment "noooooooooo" (sign + skip value 0000000000..9999999999)
// and the zero suppression "Zpp" (PC/PV) / "qq" (XB), parsed into item.counter = { step (signed), native (the token as written) }
// and item.zeroSuppress (1..20), written back by emit and edited from the panel. The order of the optional tokens is the manual's:
//   PC ...,ii,j(,Jkkll)(,Mm)(,noooooooooo)(,Zpp)(,Pq)(=data)     PV ...,ii,j(,Mk)(,lmmmmmmmmmm)(,Znn)(,Po)(=data)
//   XB (generic)  ...,k,llll(,mnnnnnnnnnn,ooo,p,qq)                XB (Code 39 / ITF) ...,k,llll(,mnnnnnnnnnn,p,qq)(,r)
// The preview shows the START value (the printer increments per label), with the zero suppression of the manual's table.
// TSPL (B-442/443 manual, SET COUNTER): "SET COUNTER @n step" declares the increment (-999999999..999999999), "@n="0001"" assigns
// the start value and the TEXT / BARCODE content "@n" uses it.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');

const parseT = text => tpcl.parse(text, { dpi: 203 });
const itemsT = text => parseT(text).items;
const describeT = (text, index = 0) => tpcl.describeItem(itemsT(text)[index], text);
const fieldT = (text, key, index = 0) => describeT(text, index).fields.find(f => f.key === key);
const setT = (text, changes, index = 0) => tpcl.updateItem(text, itemsT(text)[index], changes, { dpi: 203 });
const infos = (list, re) => list.filter(d => d.level === 'info' && re.test(d.text));

const START_VALUE_INFO = /valor inicial/i;

// pc(tail) / pv(tail): `tail` is what follows the attribute B
const pc = (tail = '', data = '0001') => `{PC001;0100,0200,10,05,J,00,B${tail}=${data}|}`;
const pv = (tail = '', data = '0001') => `{PV01;0100,0200,0060,0080,B,00,B${tail}=${data}|}`;
const XB128 = tail => `{XB01;0100,0200,9,0,02,0,0100${tail}|}\n{RB01;0001|}`;
const XB39 = tail => `{XB01;0050,0050,3,3,02,02,06,06,02,0,0080${tail}|}\n{RB01;CODE39|}`;

// --- Parse: text

test('parse PC: the increment token and the zero suppression reach item.counter and item.zeroSuppress', () => {
  const item = itemsT(pc(',+0000000010,Z05'))[0];
  assert.deepEqual(item.counter, { step: 10, native: '+0000000010' });
  assert.equal(item.zeroSuppress, 5);
  assert.equal(item.data, '0001');
});

test('parse PC/PV: a decrement is a negative step; +0000000000, Z00 and omitted tokens leave both fields undefined', () => {
  assert.equal(itemsT(pc(',-0000000003'))[0].counter.step, -3);
  assert.equal(itemsT(pv(',-9999999999'))[0].counter.step, -9999999999);
  for (const tail of ['', ',+0000000000,Z00']) {
    const item = itemsT(pc(tail))[0];
    assert.equal(item.counter, undefined, tail);
    assert.equal(item.zeroSuppress, undefined, tail);
  }
});

test('parse PC: n and Z sit after J and M and before P, and none of the other tokens is disturbed', () => {
  const item = itemsT('{PC001;0100,0200,10,05,J,+03,11,W0507,J0102,M0,+0000000005,Z03,P2=HOLA|}')[0];
  assert.equal(item.counter.step, 5);
  assert.equal(item.zeroSuppress, 3);
  assert.deepEqual(item.bold.native, { h: 1, v: 2 });
  assert.deepEqual(item.align, { kind: 'center' });
  assert.equal(item.spacing.native, 3);
  assert.deepEqual(item.attribute.native, { h: 5, v: 7 });
  assert.equal(item.rotation, 90);
  assert.equal(item.data, 'HOLA');
});

test('parse PV: lmmmmmmmmmm and Znn after Mk and before Po', () => {
  const item = itemsT('{PV01;0100,0200,0060,0080,B,-012,00,B,M0,-0000000002,Z02,P3=HOLA|}')[0];
  assert.equal(item.counter.step, -2);
  assert.equal(item.zeroSuppress, 2);
  assert.deepEqual(item.align, { kind: 'right' });
  assert.equal(item.spacing.native, -12);
});

test('parse: the form with a separate RC / RV command carries the counter on the format command', () => {
  const item = itemsT('{PC001;0100,0200,10,05,J,00,B,+0000000001,Z04|}\n{RC001;0042|}')[0];
  assert.equal(item.counter.step, 1);
  assert.equal(item.zeroSuppress, 4);
  assert.equal(item.data, '0042');
});

test('parse: Z is clamped to the manual maximum of 20', () => {
  assert.equal(itemsT(pc(',Z99'))[0].zeroSuppress, 20);
});

// --- Parse: barcodes

test('parse XB generic form: the increment and qq sit after the height, before and after the guard and the readable flag', () => {
  const item = itemsT(XB128(',+0000000001,000,1,05'))[0];
  assert.deepEqual(item.counter, { step: 1, native: '+0000000001' });
  assert.equal(item.zeroSuppress, 5);
  assert.equal(item.humanReadable, true);
  assert.equal(item.symbology, 'code128');
  assert.equal(itemsT(XB128(',0,000,1,00'))[0].counter, undefined);
  assert.equal(itemsT(XB128(',+0000000000,000,1,00'))[0].counter, undefined);
});

test('parse XB Code 39 / ITF form: the manual puts the increment before the readable flag; the older form has none', () => {
  const withCounter = itemsT('{XB02;0830,0550,3,1,02,04,07,08,04,3,0150,-0000000001,1,05,N|}')[0];
  assert.equal(withCounter.counter.step, -1);
  assert.equal(withCounter.zeroSuppress, 5);
  assert.equal(withCounter.humanReadable, true);
  assert.equal(withCounter.native.startStop, 'N');
  const older = itemsT(XB39(',1'))[0];
  assert.equal(older.counter, undefined);
  assert.equal(older.humanReadable, true);
  const olderZero = itemsT(XB39(',1,07'))[0];
  assert.equal(olderZero.zeroSuppress, 7);
  assert.equal(olderZero.counter, undefined);
});

test('parse XB: a QR command never gets a counter', () => {
  const item = itemsT('{XB01;0010,0010,T,H,04,A,0,M2|}\n{RB01;QR|}')[0];
  assert.equal(item.counter, undefined);
});

// --- The once-only info

test('parse: ONE info that the counter fields show the start value, however many counter fields there are', () => {
  const model = parseT(`${pc(',+0000000001')}\n${pv(',-0000000001')}\n${XB128(',+0000000002,000,1,00')}`);
  assert.equal(infos(model.diagnostics, START_VALUE_INFO).length, 1);
  assert.equal(infos(parseT(`${pc()}\n${XB128(',0,000,1,00')}`).diagnostics, START_VALUE_INFO).length, 0);
});

// --- Zero suppression of the preview (manual 6.3.7 (11): the printed row of the table)

test('zero suppression: the manual table (pp = characters kept; leading zeros become spaces, never past the first non-zero)', () => {
  const z = PB.slices.text.suppressZeros;
  const table = [['0000', 0, '0000'], ['0000', 1, '   0'], ['0000', 2, '  00'], ['0A12', 2, ' A12'], ['0123', 3, ' 123'], ['0123', 4, '0123'], ['0123', 5, '0123']];
  for (const [data, pp, printed] of table) assert.equal(z(data, pp), printed, `${data} / ${pp}`);
  // The increment tables: 4 digits with 3, and a 6 digit counter that wrapped to 000000
  assert.equal(z('0010', 3), ' 010');
  assert.equal(z('000001', 3), '   001');
  assert.equal(z('999999', 3), '999999');
  assert.equal(z('12', 20), '12');
  assert.equal(z('', 3), '');
  assert.equal(z('0000', undefined), '0000');
});

const ctx = { n: v => Number(v.toFixed(2)), esc: s => String(s), value: s => s, textScale: 1 };
const textItem = extra => ({ kind: 'text', x: 10, y: 20, rotation: 0, data: '0042', font: { size: 40, scaleX: 1, family: 'sans', weight: 400, style: 'normal' }, ...extra });

test('render: the preview draws the start value with the zero suppression, the data itself is untouched', () => {
  const item = textItem({ zeroSuppress: 3, counter: { step: 1, native: '+0000000001' } });
  const markup = PB.slices.text.render(item, ctx).markup;
  assert.match(markup, />\s042<\/text>/);
  assert.match(markup, /xml:space="preserve"> 042</);
  assert.equal(item.data, '0042');
  assert.match(PB.slices.text.render(textItem(), ctx).markup, />0042</);
});

test('emit: the zero suppression is never applied to the data that is written', () => {
  const out = tpcl.emit({ language: 'tpcl', size: { width: 1000, height: 600, native: {} }, items: [textItem({ zeroSuppress: 3, counter: { step: 1 } })], diagnostics: [] }, { dpi: 203 });
  assert.match(out.text, /\{RV00;0042\|\}|\{RC00;0042\|\}/);
});

// --- Round trips: parse -> emit -> parse

function roundTrip(text) {
  const first = parseT(text);
  const out = tpcl.emit(first, { dpi: 203 });
  return { out, items: tpcl.parse(out.text, { dpi: 203 }).items, first: first.items };
}

test('round trip: text and barcodes keep their counters and their zero suppression', () => {
  const { out, items, first } = roundTrip([
    pc(',J0102,+0000000010,Z05,P2'), pv(',-0000000003,Z02'), XB128(',+0000000001,000,1,05'), XB39(',-0000000007,1,03'),
  ].join('\n'));
  assert.equal(items.length, 4);
  first.forEach((item, i) => {
    assert.deepEqual(items[i].counter, item.counter, `item ${i}`);
    assert.equal(items[i].zeroSuppress, item.zeroSuppress, `item ${i}`);
    assert.equal(items[i].data, item.data, `item ${i}`);
  });
  assert.match(out.text, /\{PC00;0100,0200,10,05,J,00,B,J0102,\+0000000010,Z05,P2\|\}/);
  assert.match(out.text, /\{PV00;0100,0200,0060,0080,B,00,B,-0000000003,Z02\|\}/);
  assert.match(out.text, /,0100,\+0000000001,000,1,05\|\}/);
  assert.match(out.text, /,0080,-0000000007,1,03\|\}/);
});

test('round trip: items without counters write exactly what they wrote before (no new tokens)', () => {
  const { out } = roundTrip(`${pc()}\n${pv()}\n${XB128(',0,000,1,00')}\n${XB39(',1')}`);
  assert.doesNotMatch(out.text, /\+0000000|-0000000|Z\d\d/);
  assert.match(out.text, /\{PC00;0100,0200,10,05,J,00,B\|\}/);
  assert.match(out.text, /,0100,0,000,1,00\|\}/);
  assert.match(out.text, /,0080,1\|\}/);
});

test('emit: a step beyond the manual range is clamped, a zero step and Z0 write nothing', () => {
  const model = items => ({ language: 'tpcl', size: { width: 1000, height: 600, native: {} }, items, diagnostics: [] });
  const font = { size: 12 * PB.units.UNITS_PER_POINT, scaleX: 1, family: 'sans', weight: 700, style: 'normal' };
  const item = extra => ({ kind: 'text', x: 100, y: 200, rotation: 0, data: '1', font, ...extra });
  assert.match(tpcl.emit(model([item({ counter: { step: 99999999999 } })]), { dpi: 203 }).text, /,B,\+9999999999\|\}/);
  assert.match(tpcl.emit(model([item({ counter: { step: -99999999999 } })]), { dpi: 203 }).text, /,B,-9999999999\|\}/);
  const none = tpcl.emit(model([item({ counter: { step: 0 }, zeroSuppress: 0 })]), { dpi: 203 }).text;
  assert.match(none, /,B\|\}/);
});

test('emit: a TSPL-origin counter and a barcode counter reach the TPCL tokens', () => {
  const model = { language: 'tpcl', size: { width: 1000, height: 600, native: {} }, diagnostics: [], items: [
    { kind: 'barcode', x: 100, y: 200, rotation: 0, symbology: 'code128', module: 20, height: 80, humanReadable: true, data: '0001', counter: { step: 5 }, zeroSuppress: 4 },
    { kind: 'barcode', x: 100, y: 400, rotation: 0, symbology: 'code39', module: 20, height: 80, humanReadable: true, data: 'A1', counter: { step: -2 } },
  ] };
  const out = tpcl.emit(model, { dpi: 203 }).text;
  assert.match(out, /\{XB00;0100,0200,9,0,\d\d,0,0080,\+0000000005,000,1,04\|\}/);
  assert.match(out, /\{XB01;0100,0400,3,1,\d\d,\d\d,\d\d,\d\d,\d\d,0,0080,-0000000002,1\|\}/);
});

// --- Panel: describeItem

test('describeItem: Incremento and Ceros suprimidos on PC, PV and both XB forms, with and without the text', () => {
  const samples = [pc(',+0000000010,Z05'), pv(',-0000000003,Z02'), XB128(',+0000000001,000,1,05'), XB39(',-0000000007,1,03')];
  const expected = [[10, 5], [-3, 2], [1, 5], [-7, 3]];
  samples.forEach((text, i) => {
    const item = itemsT(text)[0];
    for (const withText of [true, false]) {
      const fields = tpcl.describeItem(item, withText ? text : undefined).fields;
      const counter = fields.find(f => f.key === 'counter');
      const zero = fields.find(f => f.key === 'zeroSuppress');
      assert.equal(counter.label, 'Incremento');
      assert.equal(counter.type, 'number');
      assert.equal(counter.value, expected[i][0], `${i} text=${withText}`);
      assert.equal(zero.label, 'Ceros suprimidos');
      assert.equal(zero.min, 0);
      assert.equal(zero.max, 20);
      assert.equal(zero.value, expected[i][1], `${i} text=${withText}`);
    }
  });
});

test('describeItem: without the tokens both fields read 0, with and without the text', () => {
  for (const text of [pc(), pv(), XB128(',0,000,1,00'), XB39(',1')]) {
    for (const withText of [true, false]) {
      const fields = tpcl.describeItem(itemsT(text)[0], withText ? text : undefined).fields;
      assert.equal(fields.find(f => f.key === 'counter').value, 0, text);
      assert.equal(fields.find(f => f.key === 'zeroSuppress').value, 0, text);
    }
  }
});

test('describeItem: the other fields still read their own tokens when a counter is present (readable flag, height)', () => {
  const text = XB39(',+0000000001,1,05');
  assert.equal(fieldT(text, 'humanReadable').value, true);
  assert.equal(fieldT(text, 'height').value, 80);
  assert.equal(fieldT(XB128(',+0000000001,000,1,05'), 'humanReadable').value, true);
});

test('describeItem: a QR has no counter fields', () => {
  const text = '{XB01;0010,0010,T,H,04,A,0,M2|}\n{RB01;QR|}';
  const keys = describeT(text).fields.map(f => f.key);
  assert.ok(!keys.includes('counter') && !keys.includes('zeroSuppress'));
});

// --- Panel: updateItem

test('updateItem: inserts the counter right after the attribute, J and M, and before P', () => {
  assert.equal(setT(pc(), { counter: 10 }), pc(',+0000000010'));
  assert.equal(setT(pv(), { counter: -3 }), pv(',-0000000003'));
  assert.equal(setT(pc(',J0102,M0,P2'), { counter: 10 }), pc(',J0102,M0,+0000000010,P2'));
  assert.equal(setT(pv(',M0,P3'), { counter: 5, zeroSuppress: 4 }), pv(',M0,+0000000005,Z04,P3'));
  assert.equal(setT(pc(',P2'), { zeroSuppress: 3 }), pc(',Z03,P2'));
});

test('updateItem: changes an existing counter or zero suppression without touching the other tokens', () => {
  assert.equal(setT(pc(',W0507,J0102,+0000000010,Z05,P2'), { counter: -7, zeroSuppress: 9 }), pc(',W0507,J0102,-0000000007,Z09,P2'));
  assert.equal(setT(pc(',+0000000010,Z05'), { counter: 25 }), pc(',+0000000025,Z05'));
});

test('updateItem: 0 on an absent token writes nothing; on an existing token keeps it as +0000000000 / Z00', () => {
  assert.equal(setT(pc(), { counter: 0, zeroSuppress: 0 }), pc());
  assert.equal(setT(pc(',-0000000005,Z05'), { counter: 0 }), pc(',+0000000000,Z05'));
  assert.equal(setT(pc(',+0000000005,Z05'), { zeroSuppress: 0 }), pc(',+0000000005,Z00'));
});

test('updateItem: values are rounded and clamped (step +-9999999999, Z 0..20); invalid values are ignored', () => {
  assert.equal(setT(pc(), { counter: 99999999999 }), pc(',+9999999999'));
  assert.equal(setT(pc(), { counter: -99999999999 }), pc(',-9999999999'));
  assert.equal(setT(pc(), { counter: 2.6 }), pc(',+0000000003'));
  assert.equal(setT(pc(), { zeroSuppress: 25 }), pc(',Z20'));
  assert.equal(setT(pc(), { zeroSuppress: -4 }), pc());
  for (const bad of ['5', NaN, null, undefined, Infinity]) {
    assert.equal(setT(pc(), { counter: bad, zeroSuppress: bad }), pc(), String(bad));
  }
});

test('updateItem XB generic: replaces the increment token ("0" or a signed one) and fills or adds qq', () => {
  assert.equal(setT(XB128(',0,000,1,00'), { counter: 5 }), XB128(',+0000000005,000,1,00'));
  assert.equal(setT(XB128(',+0000000001,000,1,00'), { counter: -2 }), XB128(',-0000000002,000,1,00'));
  assert.equal(setT(XB128(',+0000000001,000,1,00'), { counter: 0 }), XB128(',+0000000000,000,1,00'));
  assert.equal(setT(XB128(',0,000,1,00'), { counter: 0 }), XB128(',0,000,1,00'));
  assert.equal(setT(XB128(',0,000,1,00'), { zeroSuppress: 7 }), XB128(',0,000,1,07'));
  assert.equal(setT(XB128(',0,000,1'), { zeroSuppress: 3 }), XB128(',0,000,1,03'));
  assert.equal(setT(XB128(',0,000,1'), { zeroSuppress: 0 }), XB128(',0,000,1'));
});

test('updateItem XB Code 39 / ITF: the increment is inserted before the readable flag, qq after it, before r', () => {
  assert.equal(setT(XB39(',1'), { counter: 12 }), XB39(',+0000000012,1'));
  assert.equal(setT(XB39(',1'), { zeroSuppress: 4 }), XB39(',1,04'));
  assert.equal(setT(XB39(',1,N'), { counter: 3, zeroSuppress: 2 }), XB39(',+0000000003,1,02,N'));
  assert.equal(setT(XB39(',-0000000001,1,05,N'), { counter: 9 }), XB39(',+0000000009,1,05,N'));
});

test('updateItem: counters combine with the other fields of the same command in one change', () => {
  assert.equal(setT(XB39(',1'), { counter: 12, height: 90, humanReadable: false }), '{XB01;0050,0050,3,3,02,02,06,06,02,0,0090,+0000000012,0|}\n{RB01;CODE39|}');
  const out = setT(pc(',P2'), { counter: 4, rotation: 90, align: 'right' });
  assert.equal(out, '{PC001;0100,0200,10,05,J,11,B,+0000000004,P3=0001|}');
});

test('updateItem: the content of an item with a counter is still editable (the start value)', () => {
  assert.equal(setT(pc(',+0000000001'), { content: '0100' }), pc(',+0000000001', '0100'));
});

test('updateItem: CRLF and LF texts keep their line endings; only the token is inserted', () => {
  const lf = `${pc()}\n${pv()}\n`;
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(setT(lf, { counter: 10, zeroSuppress: 2 }), `${pc(',+0000000010,Z02')}\n${pv()}\n`);
  assert.equal(setT(crlf, { counter: 10, zeroSuppress: 2 }), `${pc(',+0000000010,Z02')}\r\n${pv()}\r\n`);
  const second = setT(crlf, { counter: 7 }, 1);
  assert.equal(second, `${pc()}\r\n${pv(',+0000000007')}\r\n`);
});

test('updateItem: a command split across lines is edited in place', () => {
  const split = '{PC001;0100,0200,10,05,J,00,B,\r\nJ0102=HOLA|}\r\n';
  const out = setT(split, { counter: 5 });
  assert.match(out, /^\{PC001;0100,0200,10,05,J,00,B,\r\nJ0102,\+0000000005=HOLA\|\}\r\n$/);
});

// --- TSPL

const TSPL = [
  'SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm', 'SET COUNTER @0 1', 'SET COUNTER @1 -5', 'CLS',
  '@0="0001"', '@1="TEC00001"',
  'TEXT 50,50,"3",0,1,1,@0', 'BARCODE 50,500,"39",48,1,0,2,4,@1', 'PRINT 1', '',
].join('\r\n');
const itemsS = text => tspl.parse(text, { dpi: 203 }).items;
const describeS = (text, index = 0) => tspl.describeItem(itemsS(text)[index], text, { dpi: 203 });
const setS = (text, changes, index = 0) => tspl.updateItem(text, itemsS(text)[index], changes, { dpi: 203 });

test('TSPL parse: a counter used as content shows its start value and carries its declared step', () => {
  const [text, barcode] = itemsS(TSPL);
  assert.equal(text.data, '0001');
  assert.equal(text.counter.step, 1);
  assert.equal(text.counter.native.n, 0);
  assert.equal(barcode.data, 'TEC00001');
  assert.equal(barcode.counter.step, -5);
  assert.equal(barcode.symbology, 'code39');
});

test('TSPL parse: ONE info that the counters show the start value', () => {
  const model = tspl.parse(TSPL, { dpi: 203 });
  assert.equal(infos(model.diagnostics, START_VALUE_INFO).length, 1);
  assert.equal(model.diagnostics.filter(d => /sin evaluar/.test(d.text)).length, 0);
});

test('TSPL parse: an unassigned counter, an assigned one without SET COUNTER and mixed content keep today\'s behaviour', () => {
  const unassigned = tspl.parse('SIZE 100 mm,60 mm\r\nSET COUNTER @0 1\r\nTEXT 10,10,"3",0,1,1,@0\r\nPRINT 1\r\n', { dpi: 203 });
  assert.equal(unassigned.items[0].data, '@0');
  assert.equal(unassigned.items[0].counter, undefined);
  assert.equal(unassigned.diagnostics.filter(d => /sin evaluar/.test(d.text)).length, 1);
  const undeclared = itemsS('SIZE 100 mm,60 mm\r\n@3="0007"\r\nTEXT 10,10,"3",0,1,1,@3\r\nPRINT 1\r\n')[0];
  assert.equal(undeclared.data, '0007');
  assert.equal(undeclared.counter, undefined);
  const mixed = itemsS('SIZE 100 mm,60 mm\r\nSET COUNTER @0 1\r\n@0="01"\r\nTEXT 10,10,"3",0,1,1,"N"+@0\r\nPRINT 1\r\n')[0];
  assert.equal(mixed.data, '"N"+@0');
  assert.equal(mixed.counter, undefined);
  const zero = itemsS('SIZE 100 mm,60 mm\r\nSET COUNTER @0 0\r\n@0="01"\r\nTEXT 10,10,"3",0,1,1,@0\r\nPRINT 1\r\n')[0];
  assert.equal(zero.data, '01');
  assert.equal(zero.counter, undefined);
});

test('TSPL parse: an invalid SET COUNTER warns and declares nothing', () => {
  const model = tspl.parse('SIZE 100 mm,60 mm\r\nSET COUNTER @0 abc\r\nSET COUNTER @0 1000000000\r\n@0="1"\r\nTEXT 10,10,"3",0,1,1,@0\r\nPRINT 1\r\n', { dpi: 203 });
  assert.equal(model.diagnostics.filter(d => d.level === 'warning' && /SET COUNTER/.test(d.text)).length, 2);
  assert.equal(model.items[0].counter, undefined);
});

test('TSPL describe: the step is a field; the content of a counter is not editable, with and without the text', () => {
  for (const withText of [true, false]) {
    const item = itemsS(TSPL)[0];
    const fields = tspl.describeItem(item, withText ? TSPL : undefined, { dpi: 203 }).fields;
    const counter = fields.find(f => f.key === 'counter');
    assert.equal(counter.label, 'Incremento');
    assert.equal(counter.value, 1);
    assert.equal(counter.min, -999999999);
    assert.equal(counter.max, 999999999);
    assert.ok(!fields.some(f => f.key === 'content'), `text=${withText}`);
    assert.ok(fields.some(f => f.key === 'rotation'));
  }
  assert.equal(describeS(TSPL, 1).fields.find(f => f.key === 'counter').value, -5);
});

test('TSPL update: the step is written in the SET COUNTER line only; everything else stays byte for byte', () => {
  const out = setS(TSPL, { counter: 25 });
  assert.equal(out, TSPL.replace('SET COUNTER @0 1', 'SET COUNTER @0 25'));
  assert.equal(setS(TSPL, { counter: -999999999999 }, 1), TSPL.replace('SET COUNTER @1 -5', 'SET COUNTER @1 -999999999'));
  assert.equal(setS(TSPL, { counter: 0 }), TSPL.replace('SET COUNTER @0 1', 'SET COUNTER @0 0'));
  assert.equal(setS(TSPL, { counter: 'x' }), TSPL);
  assert.equal(setS(TSPL, { counter: NaN }), TSPL);
});

test('TSPL update: the step and a field of the item command change together, in LF and CRLF files; a counter assigned or declared after its use stays literal', () => {
  assert.equal(setS(TSPL, { counter: 3, rotation: 90 }), TSPL.replace('SET COUNTER @0 1', 'SET COUNTER @0 3').replace('"3",0,1,1,@0', '"3",90,1,1,@0'));
  const lf = TSPL.replace(/\r\n/g, '\n');
  assert.equal(setS(lf, { counter: 3 }), lf.replace('SET COUNTER @0 1', 'SET COUNTER @0 3'));
  const after = 'SIZE 100 mm,60 mm\nTEXT 10,10,"3",0,1,1,@0\nSET COUNTER @0 1\n@0="01"\nPRINT 1\n';
  // the assignment comes after the TEXT here, so the content stays literal and there is no counter to edit
  assert.equal(itemsS(after)[0].counter, undefined);
  const before = 'SIZE 100 mm,60 mm\n@0="01"\nTEXT 10,10,"3",0,1,1,@0\nSET COUNTER @0 1\nPRINT 1\n';
  const item = itemsS(before)[0];
  assert.equal(item.counter, undefined);
});

test('TSPL emit: a counter item writes SET COUNTER, the assignment and the TEXT / BARCODE with @n; two counters take @0 and @1', () => {
  const model = { language: 'tspl', size: { width: 1000, height: 600, native: {} }, diagnostics: [], items: [
    { kind: 'text', x: 100, y: 200, rotation: 0, data: '0001', counter: { step: 5 }, font: { size: 80, scaleX: 1, family: 'sans', weight: 400, style: 'normal' } },
    { kind: 'barcode', x: 100, y: 400, rotation: 0, symbology: 'code128', module: 20, height: 80, humanReadable: true, data: 'AB12', counter: { step: -2 } },
    { kind: 'text', x: 100, y: 500, rotation: 0, data: 'fixed', counter: { step: 0 }, font: { size: 80, scaleX: 1, family: 'sans', weight: 400, style: 'normal' } },
  ] };
  const out = tspl.emit(model, { dpi: 203 });
  const lines = out.text.split('\r\n');
  assert.ok(lines.includes('SET COUNTER @0 5'));
  assert.ok(lines.includes('@0="0001"'));
  assert.ok(lines.includes('SET COUNTER @1 -2'));
  assert.ok(lines.includes('@1="AB12"'));
  assert.ok(lines.some(l => /^TEXT \d+,\d+,"0",0,\d+,\d+,@0$/.test(l) || /^TEXT \d+,\d+,"\w+",0,\d+,\d+,@0$/.test(l)));
  assert.ok(lines.some(l => /^BARCODE \d+,\d+,"128",\d+,1,0,\d+,\d+,@1$/.test(l)));
  assert.ok(lines.some(l => /,"fixed"$/.test(l)));
  assert.ok(lines.indexOf('SET COUNTER @0 5') < lines.indexOf('@0="0001"'));
  assert.ok(lines.indexOf('@0="0001"') < lines.findIndex(l => l.startsWith('TEXT') && l.endsWith('@0')));
});

test('TSPL emit: a step beyond +-999999999 is clamped with one warning; more than 50 counters fall back to literal text', () => {
  const item = (i, step) => ({ kind: 'text', x: 100, y: 10 * i, rotation: 0, data: String(i), counter: { step }, font: { size: 80, scaleX: 1, family: 'sans', weight: 400, style: 'normal' } });
  const big = tspl.emit({ language: 'tspl', size: { width: 1000, height: 600, native: {} }, diagnostics: [], items: [item(1, 9999999999), item(2, -9999999999)] }, { dpi: 203 });
  assert.match(big.text, /SET COUNTER @0 999999999\r\n/);
  assert.match(big.text, /SET COUNTER @1 -999999999\r\n/);
  assert.equal(big.diagnostics.filter(d => d.level === 'warning' && /999999999/.test(d.text)).length, 1);
  const many = tspl.emit({ language: 'tspl', size: { width: 1000, height: 600, native: {} }, diagnostics: [], items: Array.from({ length: 52 }, (_, i) => item(i + 1, 1)) }, { dpi: 203 });
  assert.equal((many.text.match(/SET COUNTER @/g) || []).length, 50);
  assert.match(many.text, /SET COUNTER @49 1/);
  assert.equal(many.diagnostics.filter(d => d.level === 'warning' && /50/.test(d.text)).length, 1);
  assert.match(many.text, /"51"\r\n/);
});

test('TSPL round trip: parse -> emit -> parse keeps the counters and their start values', () => {
  const first = tspl.parse(TSPL, { dpi: 203 });
  const out = tspl.emit(first, { dpi: 203 });
  const again = tspl.parse(out.text, { dpi: 203 }).items;
  assert.equal(again.length, 2);
  assert.equal(again[0].data, '0001');
  assert.equal(again[0].counter.step, 1);
  assert.equal(again[1].data, 'TEC00001');
  assert.equal(again[1].counter.step, -5);
});

// --- Conversion

test('conversion TPCL -> TSPL: the counter becomes SET COUNTER / @n; the zero suppression has no TSPL equivalent (one info)', () => {
  const src = `${pc(',+0000000010,Z05')}\n${pv(',-0000000003,Z02')}\n${XB128(',+0000000001,000,1,05')}`;
  const out = PB.convert.run(src, 'tspl', { dpi: 203 });
  const lines = out.text.split('\r\n');
  assert.ok(lines.includes('SET COUNTER @0 10'));
  assert.ok(lines.includes('SET COUNTER @1 -3'));
  assert.ok(lines.includes('SET COUNTER @2 1'));
  assert.equal(lines.filter(l => /^@\d="0001"$/.test(l)).length, 3);
  assert.equal(infos(out.diagnostics, /ceros suprimidos/i).length, 1);
  // and no new warning from the counters
  assert.equal(out.diagnostics.filter(d => d.level === 'warning' && /contador|counter/i.test(d.text)).length, 0);
});

test('conversion TSPL -> TPCL: the counter becomes the n token', () => {
  const out = PB.convert.run(TSPL, 'tpcl', { dpi: 203 });
  assert.match(out.text, /,B,\+0000000001=0001\|\}|\{RC\d+;0001\|\}/);
  assert.match(out.text, /\+0000000001/);
  assert.match(out.text, /-0000000005/);
  const items = tpcl.parse(out.text, { dpi: 203 }).items;
  assert.deepEqual(items.map(i => i.counter && i.counter.step), [1, -5]);
  assert.deepEqual(items.map(i => i.data), ['0001', 'TEC00001']);
});
