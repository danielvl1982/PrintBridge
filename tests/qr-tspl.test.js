const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/drawing.js');
const tspl = PB.languages.get('tspl');
const parse = (src, opts) => tspl.parse(src, opts);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const one = (src, opts) => {
  const model = parse(src, opts);
  assert.equal(model.items.length, 1, JSON.stringify(model.diagnostics));
  return model.items[0];
};
const DOT = 254 / 203;
const qr = (content, { ecc = 'M', cell = 4, mode = 'A', rotation = 0, extra = '' } = {}) =>
  `QRCODE 10,20,${ecc},${cell},${mode},${rotation},${extra}"${content}"`;

test('qr registers a TSPL hook factory next to the TPCL one', () => {
  assert.equal(typeof PB.components.get('qr').languages.tspl, 'function');
  assert.equal(typeof PB.components.get('qr').languages.tpcl, 'function');
});

test('QRCODE builds the neutral item: position, cell dots -> 0.1 mm, data and native', () => {
  const item = one('QRCODE 16,40,H,5,A,0,"https://example.com"');
  assert.equal(item.kind, 'qr');
  assert.equal(item.ref, 'QRCODE');
  assert.equal(item.symbology, 'qr');
  assert.equal(item.ecc, 'H');
  near(item.x, 16 * DOT);
  near(item.y, 40 * DOT);
  near(item.cell, 5 * DOT);
  assert.equal(item.data, 'https://example.com');
  assert.deepEqual(item.raw, { x: '16', y: '40', cell: '5' });
  assert.deepEqual(item.native, { cell: 5, mode: 'A', rotation: 0 });
});

test('ECC levels L/M/Q/H; an invalid one falls back to M with an info', () => {
  for (const e of ['L', 'M', 'Q', 'H']) assert.equal(one(qr('A', { ecc: e })).ecc, e);
  assert.equal(one(qr('A', { ecc: 'h' })).ecc, 'H');
  const model = parse(qr('A', { ecc: 'Z' }));
  assert.equal(model.items[0].ecc, 'M');
  assert.equal(model.diagnostics.length, 1);
  assert.match(model.diagnostics[0].text, /corrección/);
});

test('cell width converts with the dpi', () => {
  near(one(qr('A', { cell: 6 }), { dpi: 203 }).cell, 6 * 254 / 203);
  near(one(qr('A', { cell: 6 }), { dpi: 300 }).cell, 6 * 254 / 300);
  near(one('QRCODE 12,24,M,3,A,0,"A"', { dpi: 300 }).x, 12 * 254 / 300);
});

test('an invalid cell width warns and uses 4 dots', () => {
  const model = parse(qr('A', { cell: 'x' }));
  near(model.items[0].cell, 4 * DOT);
  assert.match(model.diagnostics[0].text, /ancho de celda/);
});

test('QRCODE applies REFERENCE', () => {
  const item = one('REFERENCE 10,5\r\n' + qr('A'));
  near(item.x, 20 * DOT);
  near(item.y, 25 * DOT);
});

test('mode A keeps the content as is', () => {
  assert.equal(one(qr('N123!ATHE')).data, 'N123!ATHE');
});

test('mode M strips the encoding prefixes', () => {
  const m = c => one(qr(c, { mode: 'M' }));
  assert.equal(m('AHELLO').data, 'HELLO');
  assert.equal(m('N123456').data, '123456');
  assert.equal(m('N123456!ATHE').data, '123456THE');
  assert.equal(m('B0012Product name').data, 'Product name');
  assert.equal(m('B0003abcN12').data, 'abc12');
  assert.equal(m('KHELLO').data, 'HELLO');
  assert.equal(m('B0003a!cAXY').data, 'a!cXY');
  assert.equal(m('B0010short').data, 'short');
  assert.equal(m('AHELLO').native.mode, 'M');
});

test('mode M with a malformed prefix keeps the content with an info', () => {
  for (const bad of ['Zabc', 'BXYZ1abc', 'B12ab', 'B0002ab!Zxx']) {
    const model = parse(qr(bad, { mode: 'M' }));
    assert.equal(model.items[0].data, bad, bad);
    assert.equal(model.diagnostics.length, 1, bad);
    assert.match(model.diagnostics[0].text, /modo manual/);
  }
});

test('optional parameters in any order and subset', () => {
  const item = one(qr('X', { extra: 'M2,S7,X100,J5,L21,' }));
  assert.deepEqual(item.native, { cell: 4, mode: 'A', rotation: 0, model: 2, mask: 7, area: 100, justification: 5, length: 21 });
  assert.deepEqual(one(qr('X', { extra: 'J2,M1,' })).native, { cell: 4, mode: 'A', rotation: 0, model: 1, justification: 2 });
  assert.deepEqual(one(qr('X', { extra: 'S3,' })).native, { cell: 4, mode: 'A', rotation: 0, mask: 3 });
  assert.equal(one(qr('X', { extra: 'Q9,Z,' })).data, 'X');
  // V7: an unknown optional parameter is ignored but now reported
  const unknown = parse(qr('X', { extra: 'Q9,' })).diagnostics;
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].text, /Q9/);
});

test('mode M is not confused with the model option M2', () => {
  const item = one(qr('N123', { mode: 'M', extra: 'M2,' }));
  assert.equal(item.native.mode, 'M');
  assert.equal(item.native.model, 2);
  assert.equal(item.data, '123');
  const auto = one(qr('N123', { mode: 'A', extra: 'M2,' }));
  assert.equal(auto.native.mode, 'A');
  assert.equal(auto.data, 'N123');
});

test('rotation is kept in native with one info per label and the model is unchanged', () => {
  const model = parse(qr('A', { rotation: 90 }) + '\r\n' + qr('B', { rotation: 180 }));
  assert.equal(model.items.length, 2);
  assert.deepEqual(model.items.map(i => i.native.rotation), [90, 180]);
  assert.equal(model.items[0].rotation, undefined);
  assert.equal(model.diagnostics.length, 1);
  assert.match(model.diagnostics[0].text, /rotación de QR no soportada, se dibuja sin rotar/);
  assert.equal(parse(qr('A')).diagnostics.length, 0);
});

test('an invalid rotation warns and is not kept', () => {
  const model = parse(qr('A', { rotation: 45 }));
  assert.equal(model.items[0].native.rotation, 0);
  assert.match(model.diagnostics[0].text, /rotación "45" no válida/);
});

test('quoted commas and the escaped quote', () => {
  assert.equal(one(qr('a,b,c')).data, 'a,b,c');
  assert.equal(one(qr('say \\"hi\\", ok')).data, 'say "hi", ok');
  assert.equal(one(qr('a,b', { extra: 'M2,' })).data, 'a,b');
});

test('counters are literal with one shared info per label', () => {
  const model = parse('QRCODE 0,0,M,4,A,0,"x"+@1\r\nBARCODE 0,0,"128",50,0,0,2,4,"@2"\r\nQRCODE 0,100,M,4,A,0,"@1"');
  assert.deepEqual(model.items.filter(i => i.kind === 'qr').map(i => i.data), ['"x"+@1', '@1']);
  assert.equal(model.diagnostics.length, 1);
  assert.match(model.diagnostics[0].text, /@n/);
});

test('variables like #VAR# stay in the data for the renderer to substitute', () => {
  assert.equal(one(qr('#URL#')).data, '#URL#');
});

test('incomplete or invalid QRCODE warns and adds nothing', () => {
  for (const bad of ['QRCODE 10,20,M,4,A,0', 'QRCODE x,20,M,4,A,0,"A"', 'QRCODE']) {
    const model = parse(bad);
    assert.equal(model.items.length, 0, bad);
    assert.equal(model.diagnostics.length, 1, bad);
  }
});

test('the source span covers exactly the QRCODE line', () => {
  const src = 'SIZE 100 mm,60 mm\r\nQRCODE 10,20,M,4,A,0,"A,B"\r\nPRINT 1\r\n';
  const item = one(src);
  const { start, end } = item.source.spans[0];
  assert.equal(src.slice(start, end), 'QRCODE 10,20,M,4,A,0,"A,B"');
});

test('end to end: SIZE + QRCODE', () => {
  const model = parse('SIZE 50 mm,30 mm\r\nGAP 2 mm,0\r\nCLS\r\nQRCODE 20,20,Q,4,A,0,"HELLO"\r\nPRINT 1,1\r\n');
  assert.equal(model.size.width, 500);
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.items.map(i => [i.kind, i.ecc, i.data]), [['qr', 'Q', 'HELLO']]);
});

test('a parsed TSPL QR renders with the existing SVG renderer', () => {
  const model = parse('SIZE 100 mm,60 mm\r\nQRCODE 40,30,M,4,A,0,"HELLO"\r\n', { dpi: 203 });
  const view = PB.sizes.view(model, null);
  const { svg } = PB.svgRenderer.render(model, view, { textScale: 1, showGrid: false, showAnchors: false, values: {} });
  assert.match(svg, /<path d="/);
  assert.doesNotMatch(svg, /class="not-generated"/);
});

test('a #VAR# QR substitutes the variable when rendering', () => {
  const model = parse('SIZE 100 mm,60 mm\r\nQRCODE 40,30,M,4,A,0,"#URL#"\r\n');
  const view = PB.sizes.view(model, null);
  const draw = values => PB.svgRenderer.render(model, view, { textScale: 1, showGrid: false, showAnchors: false, values }).svg;
  assert.notEqual(draw({ URL: 'https://a.example' }), draw({ URL: 'https://b.example/longer-address-here' }));
});

test('the validator raises no TPCL-only rule for a TSPL QR', () => {
  const model = parse('SIZE 100 mm,60 mm\r\nQRCODE 40,30,M,4,A,0,"HELLO"\r\n');
  assert.deepEqual(PB.validator.validate(model, tspl), []);
  assert.deepEqual(PB.validator.validate(parse(qr('A', { cell: 10 })), tspl), []);
});
