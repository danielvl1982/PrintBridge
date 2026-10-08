const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TPCL updateItem / describeItem (tpcl.js): rewrite only the requested fields of one item's command.
const PB = loadUpTo('js/languages/tpcl.js');
const tpcl = PB.languages.get('tpcl');

/** Parses the text, applies the changes to one item and returns { out, before, after, diagnostics }. */
function edit(text, changes, index = 0, dpi = 203) {
  const model = tpcl.parse(text, { dpi });
  const out = tpcl.updateItem(text, model.items[index], changes, { dpi });
  const reparsed = tpcl.parse(out, { dpi });
  return { out, before: model.items[index], after: reparsed.items[index], diagnostics: reparsed.diagnostics };
}

const PV = '{PV01;0100,0200,0100,0100,B,00,B|}';
const PC = '{PC001;0100,0200,05,05,A,00,B|}';
const XB = '{XB01;0100,0200,9,0,2,0,100,0,000,1,00|}';
const XB4 = '{XB03;0050,0350,9,0,02,0,0080,0,000,1,00|}';
const C39 = '{XB01;0050,0050,3,3,02,02,06,06,02,0,0080,1|}';
const ITF = '{XB02;0050,0200,2,1,02,02,05,05,00,0,0080,1|}';
const QR = '{XB02;0100,0200,T,H,05|}';
const QRTAIL = '{XB01;0700,0160,T,H,04,A,0,M2|}';
const LC = '{LC;0100,0200,0500,0600,0,02|}';
const SG = '{SG;0100,0200,8,1,0,?0|}';

const keys = d => d.fields.map(f => f.key);
const field = (d, key) => d.fields.find(f => f.key === key);

test('updateItem and describeItem are exposed as optional language hooks', () => {
  assert.equal(typeof tpcl.updateItem, 'function');
  assert.equal(typeof tpcl.describeItem, 'function');
});

// ---- text PV ----

test('updateItem: PV width and height rewrite only those fields (4 digits kept)', () => {
  const { out, after, diagnostics } = edit(PV, { width: 250, height: 5 });
  assert.equal(out, '{PV01;0100,0200,0250,0005,B,00,B|}');
  assert.deepEqual(diagnostics, []);
  assert.equal(after.font.size, 5);
  assert.equal(after.font.scaleX * after.font.size, 250);
});

test('updateItem: PV clamps width and height to 1..9999', () => {
  assert.equal(edit(PV, { width: 0, height: 99999 }).out, '{PV01;0100,0200,0001,9999,B,00,B|}');
});

test('updateItem: PV rotation maps to the 2-digit text codes', () => {
  for (const [deg, code] of [[0, '00'], [90, '11'], [180, '22'], [270, '33']]) {
    const { out, after, diagnostics } = edit(PV, { rotation: deg });
    assert.equal(out, `{PV01;0100,0200,0100,0100,B,${code},B|}`);
    assert.equal(after.rotation, deg);
    assert.deepEqual(diagnostics, []);
  }
});

test('updateItem: PV with spacing adjustment and text keeps them', () => {
  const text = '{PV01;0100,0200,0100,0100,B,+05,00,B=HI, 05,00|}';
  assert.equal(edit(text, { rotation: 90 }).out, '{PV01;0100,0200,0100,0100,B,+05,11,B=HI, 05,00|}');
});

test('updateItem: invalid values and unknown keys are ignored', () => {
  assert.equal(edit(PV, { width: 'abc' }).out, PV);
  assert.equal(edit(PV, { width: NaN }).out, PV);
  assert.equal(edit(PV, { rotation: 45 }).out, PV);
  assert.equal(edit(PV, { bogus: 1 }).out, PV);
  assert.equal(edit(PV, { width: 'abc', height: 300 }).out, '{PV01;0100,0200,0100,0300,B,00,B|}');
  assert.equal(edit(PV, {}).out, PV);
  assert.equal(tpcl.updateItem(PV, tpcl.parse(PV).items[0], null, { dpi: 203 }), PV);
});

test('updateItem: rounds to integers', () => {
  assert.equal(edit(PV, { width: 150.6 }).out, '{PV01;0100,0200,0151,0100,B,00,B|}');
});

test('updateItem: multiple changes at once, neighbours untouched', () => {
  const text = `{D0500,0800,0600|}\r\n${PV}\r\n{RV01;HELLO|}\r\n${LC}\r\n{XS;I,0001,0002C5000|}\r\n`;
  const model = tpcl.parse(text);
  const pv = model.items.find(i => i.ref === 'PV01');
  const out = tpcl.updateItem(text, pv, { width: 300, height: 400, rotation: 180 }, { dpi: 203 });
  assert.equal(out, text.replace(PV, '{PV01;0100,0200,0300,0400,B,22,B|}'));
});

test('updateItem: CR/LF between the fields is preserved', () => {
  const text = '{PV01;0100,0200,\r\n0100,0100,B,\r\n00,B|}';
  const { out, after } = edit(text, { width: 250, rotation: 270 });
  assert.equal(out, '{PV01;0100,0200,\r\n0250,0100,B,\r\n33,B|}');
  assert.equal(after.rotation, 270);
});

test('updateItem: edits the right command when several share the text', () => {
  const text = `${PV}\n{PV02;0300,0400,0100,0100,B,00,B|}`;
  assert.equal(edit(text, { height: 50 }, 1).out, `${PV}\n{PV02;0300,0400,0100,0050,B,00,B|}`);
});

// ---- text PC ----

test('updateItem: PC magnifications and rotation', () => {
  const { out, after, diagnostics } = edit(PC, { hMag: 12, vMag: 3, rotation: 90 });
  assert.equal(out, '{PC001;0100,0200,12,03,A,11,B|}');
  assert.deepEqual(diagnostics, []);
  assert.equal(after.rotation, 90);
});

test('updateItem: PC magnification clamps to 1..99 and keeps 2 digits', () => {
  assert.equal(edit(PC, { hMag: 0, vMag: 500 }).out, '{PC001;0100,0200,01,99,A,00,B|}');
});

test('updateItem: PC keeps the literal text after =', () => {
  const text = '{PC001;0100,0200,05,05,A,00,B=05,05,A,00|}';
  assert.equal(edit(text, { hMag: 8 }).out, '{PC001;0100,0200,08,05,A,00,B=05,05,A,00|}');
});

// ---- 1D barcode ----

test('updateItem: generic barcode module, height, rotation and human readable', () => {
  const { out, after, diagnostics } = edit(XB, { module: 4, height: 80, rotation: 90, humanReadable: false });
  assert.equal(out, '{XB01;0100,0200,9,0,4,1,080,0,000,0,00|}');
  assert.deepEqual(diagnostics, []);
  assert.equal(after.rotation, 90);
  assert.equal(after.height, 80);
  assert.equal(after.humanReadable, false);
  assert.equal(after.native.module, 4);
});

test('updateItem: generic barcode keeps 2- and 4-digit widths and clamps', () => {
  assert.equal(edit(XB4, { module: 5, height: 120 }).out, '{XB03;0050,0350,9,0,05,0,0120,0,000,1,00|}');
  assert.equal(edit(XB4, { module: 0, height: 99999 }).out, '{XB03;0050,0350,9,0,01,0,9999,0,000,1,00|}');
  assert.equal(edit(XB4, { module: 500 }).out, '{XB03;0050,0350,9,0,99,0,0080,0,000,1,00|}');
});

test('updateItem: barcode rotation maps to the digits 0..3', () => {
  for (const [deg, digit] of [[0, 0], [90, 1], [180, 2], [270, 3]]) {
    const { out, after } = edit(XB4, { rotation: deg });
    assert.equal(out, `{XB03;0050,0350,9,0,02,${digit},0080,0,000,1,00|}`);
    assert.equal(after.rotation, deg);
  }
});

test('updateItem: barcode humanReadable only accepts booleans', () => {
  assert.equal(edit(XB4, { humanReadable: false }).out, '{XB03;0050,0350,9,0,02,0,0080,0,000,0,00|}');
  assert.equal(edit(XB4, { humanReadable: 'no' }).out, XB4);
  assert.equal(edit(XB4, { humanReadable: true }).out, XB4);
});

test('updateItem: Code39 supports height, rotation and humanReadable but not module', () => {
  const { out, after, diagnostics } = edit(C39, { height: 200, rotation: 270, humanReadable: false, module: 9 });
  assert.equal(out, '{XB01;0050,0050,3,3,02,02,06,06,02,3,0200,0|}');
  assert.deepEqual(diagnostics, []);
  assert.equal(after.rotation, 270);
  assert.equal(after.height, 200);
  assert.equal(after.humanReadable, false);
});

test('updateItem: ITF supports height and rotation', () => {
  assert.equal(edit(ITF, { height: 60, rotation: 180 }).out, '{XB02;0050,0200,2,1,02,02,05,05,00,2,0060,1|}');
});

test('updateItem: barcode with CR/LF between fields', () => {
  const text = '{XB01;0100,0200,9,0,\r\n2,0,100,\r\n0,000,1,00|}';
  assert.equal(edit(text, { module: 3, humanReadable: false }).out, '{XB01;0100,0200,9,0,\r\n3,0,100,\r\n0,000,0,00|}');
});

// ---- QR ----

test('updateItem: QR cell and ecc', () => {
  const { out, after, diagnostics } = edit(QR, { cell: 8, ecc: 'L' });
  assert.equal(out, '{XB02;0100,0200,T,L,08|}');
  assert.deepEqual(diagnostics, []);
  assert.equal(after.ecc, 'L');
  assert.equal(after.native.cell, 8);
});

test('updateItem: QR cell clamps to 1..99 and ecc must be a known level', () => {
  assert.equal(edit(QR, { cell: 0 }).out, '{XB02;0100,0200,T,H,01|}');
  assert.equal(edit(QR, { cell: 200 }).out, '{XB02;0100,0200,T,H,99|}');
  assert.equal(edit(QR, { ecc: 'Z' }).out, QR);
});

test('updateItem: QR has no rotation field and keeps the trailing options', () => {
  assert.equal(edit(QRTAIL, { rotation: 90 }).out, QRTAIL);
  assert.equal(edit(QRTAIL, { cell: 6, ecc: 'Q' }).out, '{XB01;0700,0160,T,Q,06,A,0,M2|}');
});

// ---- line / box ----

test('updateItem: LC end point, thickness and box flag', () => {
  const { out, after, diagnostics } = edit(LC, { x2: 700, y2: 900, width: 5, rect: 'box' });
  assert.equal(out, '{LC;0100,0200,0700,0900,1,05|}');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual([after.x1, after.y1, after.x2, after.y2, after.rect, after.native.width], [100, 200, 700, 900, true, 5]);
  assert.equal(edit('{LC;0100,0200,0500,0600,1,02|}', { rect: 'line' }).out, LC);
});

test('updateItem: LC clamps and ignores invalid values', () => {
  assert.equal(edit(LC, { x2: -5, y2: 99999, width: 0 }).out, '{LC;0100,0200,0000,9999,0,01|}');
  assert.equal(edit(LC, { width: 500 }).out, '{LC;0100,0200,0500,0600,0,99|}');
  assert.equal(edit(LC, { rect: 'circle', x2: 'a' }).out, LC);
  assert.equal(edit(LC, { x1: 5 }).out, LC);
});

test('updateItem: LC with CR/LF between fields', () => {
  assert.equal(edit('{LC;\r\n0100,0200,\r\n0500,0600,0,02|}', { x2: 700, width: 4 }).out, '{LC;\r\n0100,0200,\r\n0700,0600,0,04|}');
});

// ---- no-op cases ----

test('updateItem: SG image returns the text unchanged', () => {
  assert.equal(edit(SG, { width: 10, x: 5 }).out, SG);
});

test('updateItem: item without source (overlay) returns the text unchanged', () => {
  assert.equal(tpcl.updateItem(PV, { kind: 'text', ref: 'PV01' }, { width: 5 }, { dpi: 203 }), PV);
});

test('updateItem: unknown kind returns the text unchanged', () => {
  const item = { kind: 'other', source: { spans: [{ start: 0, end: PV.length }] } };
  assert.equal(tpcl.updateItem(PV, item, { width: 5 }, { dpi: 203 }), PV);
});

// ---- describeItem ----

test('describeItem: PV fields with values, ranges and rotation options (from text)', () => {
  const item = tpcl.parse(PV).items[0];
  const d = tpcl.describeItem(item, PV);
  assert.equal(d.kind, 'text');
  assert.deepEqual(keys(d), ['width', 'height', 'rotation', 'font', 'spacing', 'attribute', 'align']);
  assert.deepEqual(d.fields.map(f => f.type), ['number', 'number', 'select', 'select', 'number', 'select', 'select']);
  assert.deepEqual([field(d, 'width').value, field(d, 'height').value, field(d, 'rotation').value], [100, 100, 0]);
  assert.deepEqual([field(d, 'width').min, field(d, 'width').max], [1, 9999]);
  assert.deepEqual(field(d, 'rotation').options.map(o => o.value), [0, 90, 180, 270]);
  assert.ok(d.fields.every(f => typeof f.label === 'string' && f.label));
});

test('describeItem: reads current values from the model when no text is given', () => {
  const text = '{PV01;0100,0200,0250,0120,B,22,B|}';
  const d = tpcl.describeItem(tpcl.parse(text).items[0]);
  assert.deepEqual([field(d, 'width').value, field(d, 'height').value, field(d, 'rotation').value], [250, 120, 180]);
});

test('describeItem: PC magnifications come from the text; without text only rotation', () => {
  const item = tpcl.parse('{PC001;0100,0200,12,03,A,11,B|}').items[0];
  const d = tpcl.describeItem(item, '{PC001;0100,0200,12,03,A,11,B|}');
  assert.deepEqual(keys(d), ['hMag', 'vMag', 'rotation', 'font', 'spacing', 'attribute', 'boldH', 'boldV', 'align']);
  assert.deepEqual(d.fields.map(f => f.value), [12, 3, 90, 'A', 0, 'black', 0, 0, 'left']);
  assert.deepEqual([field(d, 'hMag').min, field(d, 'hMag').max], [1, 99]);
  assert.deepEqual(keys(tpcl.describeItem(item)), ['rotation', 'spacing', 'attribute', 'boldH', 'boldV', 'align']);
});

test('describeItem: generic barcode', () => {
  const d = tpcl.describeItem(tpcl.parse(XB4).items[0], XB4);
  assert.equal(d.kind, 'barcode');
  assert.deepEqual(keys(d), ['module', 'height', 'rotation', 'humanReadable']);
  assert.deepEqual(d.fields.map(f => f.value), [2, 80, 0, true]);
  assert.equal(field(d, 'humanReadable').type, 'checkbox');
  assert.deepEqual(d.fields.map(f => f.value), tpcl.describeItem(tpcl.parse(XB4).items[0]).fields.map(f => f.value));
});

test('describeItem: Code39 has no module field', () => {
  const d = tpcl.describeItem(tpcl.parse(C39).items[0], C39);
  assert.deepEqual(keys(d), ['height', 'rotation', 'humanReadable']);
  assert.deepEqual(d.fields.map(f => f.value), [80, 0, true]);
});

test('describeItem: QR has cell and ecc options but no rotation', () => {
  const d = tpcl.describeItem(tpcl.parse(QR).items[0], QR);
  assert.equal(d.kind, 'qr');
  assert.deepEqual(keys(d), ['cell', 'ecc']);
  assert.deepEqual([field(d, 'cell').value, field(d, 'ecc').value], [5, 'H']);
  assert.deepEqual(field(d, 'ecc').options.map(o => o.value), ['L', 'M', 'Q', 'H']);
  assert.deepEqual([field(d, 'cell').min, field(d, 'cell').max], [1, 99]);
});

test('describeItem: line and box fields and the rect select', () => {
  const d = tpcl.describeItem(tpcl.parse(LC).items[0], LC);
  assert.equal(d.kind, 'line');
  assert.deepEqual(keys(d), ['x2', 'y2', 'width', 'rect']);
  assert.deepEqual(d.fields.map(f => f.value), [500, 600, 2, 'line']);
  assert.deepEqual(field(d, 'rect').options.map(o => o.value), ['line', 'box']);
  const box = '{LC;0100,0200,0500,0600,1,02|}';
  assert.equal(field(tpcl.describeItem(tpcl.parse(box).items[0]), 'rect').value, 'box');
});

test('describeItem: image and unknown items have no editable fields', () => {
  assert.deepEqual(tpcl.describeItem(tpcl.parse(SG).items[0], SG).fields, []);
  assert.deepEqual(tpcl.describeItem({ kind: 'other' }).fields, []);
  assert.deepEqual(tpcl.describeItem(null).fields, []);
});

test('describeItem values round-trip through updateItem', () => {
  const item = tpcl.parse(XB4).items[0];
  const d = tpcl.describeItem(item, XB4);
  const changes = Object.fromEntries(d.fields.map(f => [f.key, f.value]));
  assert.equal(tpcl.updateItem(XB4, item, changes, { dpi: 203 }), XB4);
});
