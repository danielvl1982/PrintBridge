const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TPCL component palette hooks (tpcl.js): componentTemplates + buildComponent.
const PB = loadUpTo('js/languages/tpcl.js');
const tpcl = PB.languages.get('tpcl');

const XS = '{XS;I,0001,0000C6000|}';
const BASE = `{D0500,0800,0400|}\n{C|}\n${XS}\n`;
const at = (x, y) => ({ x, y });

/** Builds a component and parses the result; returns { out, model, problems } (parse + validate diagnostics). */
function build(text, kind, point = at(100, 200), viewRotation) {
  const out = tpcl.buildComponent(text, kind, point, { dpi: 203, viewRotation });
  const model = tpcl.parse(out, { dpi: 203 });
  return { out, model, problems: [...model.diagnostics, ...tpcl.validate(model)] };
}

test('componentTemplates lists the six kinds in order with Spanish labels', () => {
  assert.deepEqual(tpcl.componentTemplates(), [
    { kind: 'text', label: 'Texto' },
    { kind: 'barcode', label: 'Código de barras' },
    { kind: 'qr', label: 'QR' },
    { kind: 'line', label: 'Línea' },
    { kind: 'box', label: 'Caja' },
    { kind: 'area', label: 'Área invertida' },
  ]);
});

test('text: PV + RV parse without diagnostics at the drop point and create the variable', () => {
  const { out, model, problems } = build(BASE, 'text');
  assert.ok(out.includes('{PV01;0100,0200,0060,0080,B,00,B|}\n{RV01;<#TEXTO1#>|}\n'));
  assert.deepEqual(problems, []);
  const item = model.items.find(i => i.kind === 'text');
  assert.deepEqual([item.x, item.y, item.data], [100, 200, '<#TEXTO1#>']);
  assert.deepEqual(PB.variables.namesInModel(model), ['TEXTO1']);
});

test('barcode: XB + RB parse as Code128 without diagnostics and create the variable', () => {
  const { out, model, problems } = build(BASE, 'barcode', at(30, 40));
  assert.ok(out.includes('{XB01;0030,0040,9,1,02,0,0080,+0000000000,000,0,00|}\n{RB01;<#CODIGOBARRAS1#>|}\n'));
  assert.deepEqual(problems, []);
  const item = model.items.find(i => i.kind === 'barcode');
  assert.deepEqual([item.symbology, item.x, item.y], ['code128', 30, 40]);
  assert.deepEqual(PB.variables.namesInModel(model), ['CODIGOBARRAS1']);
});

test('qr: XB + RB parse as QR without diagnostics and create the variable', () => {
  const { out, model, problems } = build(BASE, 'qr');
  assert.ok(out.includes('{XB01;0100,0200,T,H,04,A,0,M2|}\n{RB01;<#QR1#>|}\n'));
  assert.deepEqual(problems, []);
  const item = model.items.find(i => i.kind === 'qr');
  assert.deepEqual([item.x, item.y], [100, 200]);
  assert.deepEqual(PB.variables.namesInModel(model), ['QR1']);
});

test('line: horizontal LC of 0400 without data command', () => {
  const { out, model, problems } = build(BASE, 'line');
  assert.ok(out.includes('{LC;0100,0200,0500,0200,0,03|}\n'));
  assert.deepEqual(problems, []);
  const item = model.items.find(i => i.kind === 'line');
  assert.deepEqual([item.x1, item.y1, item.x2, item.y2, item.rect], [100, 200, 500, 200, false]);
});

test('box: rectangle LC of 0300 x 0200', () => {
  const { out, model, problems } = build(BASE, 'box');
  assert.ok(out.includes('{LC;0100,0200,0400,0400,1,03|}\n'));
  assert.deepEqual(problems, []);
  const item = model.items.find(i => i.kind === 'line');
  assert.deepEqual([item.x2, item.y2, item.rect], [400, 400, true]);
});

test('the point is rounded and clamped to 0..9999', () => {
  assert.ok(build(BASE, 'text', at(-50, 12000)).out.includes('{PV01;0000,9999,'));
  assert.ok(build(BASE, 'text', at(10.6, 20.4)).out.includes('{PV01;0011,0020,'));
});

test('line and box shift the start left/up so the end point stays <= 9999', () => {
  assert.ok(build(BASE, 'line', at(9999, 9999)).out.includes('{LC;9599,9999,9999,9999,0,03|}'));
  const box = build(BASE, 'box', at(9999, 9999));
  assert.ok(box.out.includes('{LC;9699,9799,9999,9999,1,03|}'));
  assert.deepEqual(box.problems, []);
  assert.ok(build(BASE, 'line', at(0, 0)).out.includes('{LC;0000,0000,0400,0000,0,03|}'));
});

test('ids: next number after the max of the namespace, gaps ignored', () => {
  const text = `{PV01;0000,0000,0060,0080,B,11,B|}\n{PV05;0000,0000,0060,0080,B,11,B|}\n${XS}\n`;
  assert.ok(build(text, 'text').out.includes('{PV06;0100,0200,0060,0080,B,00,B|}\n{RV06;'));
});

test('ids: a number used only by a data command counts, and the width of the namespace is kept', () => {
  const text = `{XB007;0000,0000,T,H,04,A,0,M2|}\n{RB007;<#QR1#>|}\n{RB012;x|}\n${XS}\n`;
  const { out } = build(text, 'barcode');
  assert.ok(out.includes('{XB013;0100,0200,9,'));
  assert.ok(out.includes('{RB013;<#CODIGOBARRAS1#>|}'));
});

test('ids: PV and XB namespaces are independent', () => {
  const text = `{PV07;0000,0000,0060,0080,B,11,B|}\n{RV07;<#A#>|}\n${XS}\n`;
  assert.ok(build(text, 'barcode').out.includes('{XB01;'));
  const text2 = `{XB03;0000,0000,T,H,04,A,0,M2|}\n{RB03;<#A#>|}\n${XS}\n`;
  assert.ok(build(text2, 'text').out.includes('{PV01;'));
});

test('ids: PC commands do not take part in the PV namespace', () => {
  const text = `{PC009;0000,0000,05,05,A,00,B|}\n{RC009;x|}\n${XS}\n`;
  assert.ok(build(text, 'text').out.includes('{PV01;'));
});

test('placeholder: smallest k not used, in both # and <##> forms', () => {
  const text = `{PV01;0000,0000,0060,0080,B,11,B|}\n{RV01;<#TEXTO1#>|}\n${XS}\n`;
  const { out, model } = build(text, 'text');
  assert.ok(out.includes('{RV02;<#TEXTO2#>|}'));
  assert.deepEqual(PB.variables.namesInModel(model), ['TEXTO1', 'TEXTO2']);
  const text2 = `{PV01;0000,0000,0060,0080,B,11,B|}\n{RV01;#TEXTO1#|}\n{RV02;<#TEXTO3#>|}\n${XS}\n`;
  assert.ok(build(text2, 'text').out.includes('<#TEXTO2#>|}'));
});

test('the data command comes after its format command and both go before {XS', () => {
  const { out } = build(BASE, 'text');
  assert.ok(out.indexOf('{PV01;') < out.indexOf('{RV01;'));
  assert.ok(out.indexOf('{RV01;') < out.indexOf('{XS;'));
  assert.ok(out.startsWith('{D0500,0800,0400|}\n{C|}\n'));
  assert.ok(out.endsWith(`${XS}\n`));
});

test('CRLF line endings are preserved', () => {
  const out = tpcl.buildComponent(BASE.replace(/\n/g, '\r\n'), 'qr', at(10, 20), { dpi: 203 });
  assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
  assert.ok(out.includes('{XB01;0010,0020,T,H,04,A,0,M2|}\r\n{RB01;<#QR1#>|}\r\n'));
});

test('without {XS the commands are appended at the end', () => {
  const out = tpcl.buildComponent('{D0500,0800,0400|}\n', 'text', at(1, 2), { dpi: 203 });
  assert.equal(out, '{D0500,0800,0400|}\n{PV01;0001,0002,0060,0080,B,00,B|}\n{RV01;<#TEXTO1#>|}\n');
});

test('unknown kind or invalid point leaves the text unchanged', () => {
  assert.equal(tpcl.buildComponent(BASE, 'hologram', at(1, 2), { dpi: 203 }), BASE);
  assert.equal(tpcl.buildComponent(BASE, 'text', at(NaN, 2), { dpi: 203 }), BASE);
  assert.equal(tpcl.buildComponent(BASE, 'text', at(1, Infinity), { dpi: 203 }), BASE);
  assert.equal(tpcl.buildComponent(BASE, 'text', null, { dpi: 203 }), BASE);
});

// View rotation: the new item is rotated (360 - view) % 360 so it looks upright in that view.
const VIEWS = [0, 90, 180, 270];
const TEXT_CODE = { 0: '00', 90: '33', 180: '22', 270: '11' };
const BARCODE_DIGIT = { 0: '0', 90: '3', 180: '2', 270: '1' };

test('text: rotation code follows the view rotation and the item looks upright', () => {
  for (const view of VIEWS) {
    const { out, model, problems } = build(BASE, 'text', at(100, 200), view);
    assert.ok(out.includes(`{PV01;0100,0200,0060,0080,B,${TEXT_CODE[view]},B|}`), `view ${view}`);
    assert.deepEqual(problems, [], `view ${view}`);
    const item = model.items.find(i => i.kind === 'text');
    assert.equal(item.rotation, (360 - view) % 360, `view ${view}`);
    assert.equal((item.rotation + view) % 360, 0, `view ${view}`);
  }
});

test('barcode: rotation digit follows the view rotation and the item looks upright', () => {
  for (const view of VIEWS) {
    const { out, model, problems } = build(BASE, 'barcode', at(30, 40), view);
    assert.ok(out.includes(`{XB01;0030,0040,9,1,02,${BARCODE_DIGIT[view]},0080,+0000000000,000,0,00|}`), `view ${view}`);
    assert.deepEqual(problems, [], `view ${view}`);
    const item = model.items.find(i => i.kind === 'barcode');
    assert.equal(item.rotation, (360 - view) % 360, `view ${view}`);
    assert.equal((item.rotation + view) % 360, 0, `view ${view}`);
  }
});

test('missing or invalid viewRotation behaves as 0', () => {
  for (const kind of ['text', 'barcode']) {
    const reference = build(BASE, kind, at(10, 20), 0).out;
    for (const view of [undefined, null, NaN, 'abc', 45, -90, Infinity]) {
      assert.equal(build(BASE, kind, at(10, 20), view).out, reference, `${kind} ${String(view)}`);
    }
    assert.equal(tpcl.buildComponent(BASE, kind, at(10, 20), { dpi: 203 }), reference);
    assert.equal(tpcl.buildComponent(BASE, kind, at(10, 20)), reference);
  }
});

test('qr, line and box are identical for every view rotation', () => {
  for (const kind of ['qr', 'line', 'box']) {
    const reference = build(BASE, kind, at(100, 200), 0).out;
    for (const view of VIEWS) assert.equal(build(BASE, kind, at(100, 200), view).out, reference, `${kind} ${view}`);
  }
});
