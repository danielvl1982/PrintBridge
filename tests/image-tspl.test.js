const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TSPL image slice: BITMAP (binary by length, bit 0 = black) and the stored-image commands PUTBMP/PUTPCX/PUTPNG.
const PB = loadUpTo('js/drawing.js');
const tspl = PB.languages.get('tspl');

const bytes = (...values) => String.fromCharCode(...values);
const rows = bitmap => Array.from({ length: bitmap.h }, (_, r) => Array.from(bitmap.data.slice(r * bitmap.w, (r + 1) * bitmap.w)).join(''));
const warnings = model => model.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const infos = model => model.diagnostics.filter(d => d.level === 'info').map(d => d.text);

// 2 bytes x 4 rows
const PATTERN = bytes(0x00, 0xFF, 0xFF, 0x00, 0x7F, 0xFE, 0xAA, 0x55);

test('image registers a TSPL hook factory next to the TPCL one', () => {
  const image = PB.components.get('image');
  assert.equal(typeof image.languages.tpcl, 'function');
  assert.equal(typeof image.languages.tspl, 'function');
});

test('BITMAP decodes MSB first with bit 0 = black (neutral 1 = black) and widthBytes > 1', () => {
  const src = `BITMAP 10,20,2,4,0,${PATTERN}\r\nPRINT 1\r\n`;
  const model = tspl.parse(src, { dpi: 203 });
  assert.equal(model.items.length, 1);
  const item = model.items[0];
  assert.equal(item.kind, 'image');
  assert.equal(item.ref, 'BITMAP');
  assert.equal(item.data, null);
  assert.equal(item.bitmap.w, 16);
  assert.equal(item.bitmap.h, 4);
  assert.ok(item.bitmap.data instanceof Uint8Array);
  assert.deepEqual(rows(item.bitmap), [
    '1111111100000000',
    '0000000011111111',
    '1000000000000001',
    '0101010110101010',
  ]);
  assert.deepEqual(model.diagnostics, []);
});

test('BITMAP size and position convert dots to 0.1 mm at 203 and 300 dpi', () => {
  const src = `BITMAP 100,50,2,4,0,${PATTERN}`;
  for (const dpi of [203, 300]) {
    const dot = PB.units.dotSize(dpi);
    const item = tspl.parse(src, { dpi }).items[0];
    assert.equal(item.width, Math.round(16 * dot));
    assert.equal(item.height, Math.round(4 * dot));
    assert.equal(item.x, 100 * dot);
    assert.equal(item.y, 50 * dot);
  }
});

test('BITMAP honours REFERENCE', () => {
  const dot = PB.units.dotSize(203);
  const item = tspl.parse(`REFERENCE 10,20\r\nBITMAP 5,5,1,1,0,${bytes(0x80)}`, { dpi: 203 }).items[0];
  assert.equal(item.x, 15 * dot);
  assert.equal(item.y, 25 * dot);
});

test('BITMAP payload with CR, LF, quote and comma bytes is read by length, not by line', () => {
  const payload = bytes(0x0D, 0x0A, 0x22, 0x2C);
  const src = `BITMAP 0,0,1,4,0,${payload}\r\nBAR 1,1,5,5\r\n`;
  const model = tspl.parse(src);
  assert.deepEqual(model.items.map(i => i.kind), ['image', 'line']);
  assert.deepEqual(rows(model.items[0].bitmap), ['11110010', '11110101', '11011101', '11010011']);
  assert.deepEqual(model.diagnostics, []);
});

test('BITMAP mode 1 and 2 give one info per label and still draw the image', () => {
  const src = `BITMAP 0,0,1,1,1,${bytes(0)}\r\nBITMAP 0,8,1,1,2,${bytes(0)}\r\nBITMAP 0,16,1,1,0,${bytes(0)}`;
  const model = tspl.parse(src);
  assert.equal(model.items.length, 3);
  assert.equal(infos(model).length, 1);
  assert.match(infos(model)[0], /BITMAP/);
  assert.match(infos(model)[0], /sobrescritura/);
  assert.deepEqual(model.items.map(i => i.native.mode), [1, 2, 0]);
  assert.equal(infos(tspl.parse(`BITMAP 0,0,1,1,0,${bytes(0)}`)).length, 0);
});

test('BITMAP with truncated data pads with white, warns about text decoding and keeps the item', () => {
  const model = tspl.parse(`BITMAP 0,0,2,2,0,${bytes(0x00, 0x00, 0x00)}`);
  assert.equal(model.items.length, 1);
  assert.deepEqual(rows(model.items[0].bitmap), ['1111111111111111', '1111111100000000']);
  const w = warnings(model);
  assert.equal(w.length, 1);
  assert.match(w[0], /incompletos|incompleto/);
  assert.match(w[0], /binario/);
});

test('BITMAP with missing or invalid arguments warns and creates no item', () => {
  for (const src of ['BITMAP 10,10', 'BITMAP a,0,1,1,0,x', 'BITMAP 0,0,0,5,0,x', 'BITMAP 0,0,1,0,0,x', 'BITMAP 0,0,1,1,z,x']) {
    const model = tspl.parse(src);
    assert.equal(model.items.length, 0, src);
    assert.equal(warnings(model).length, 1, src);
    assert.match(warnings(model)[0], /BITMAP/, src);
  }
});

test('the BITMAP source span covers the whole command including the payload', () => {
  const head = 'SIZE 4,3\r\n';
  const cmd = `BITMAP 0,0,2,4,0,${PATTERN}`;
  const src = `${head}${cmd}\r\nPRINT 1`;
  const item = tspl.parse(src).items[0];
  assert.equal(item.source.spans.length, 1);
  const { start, end } = item.source.spans[0];
  assert.equal(src.slice(start, end), cmd);
});

test('PUTBMP, PUTPCX and PUTPNG give one specific warning each and no item', () => {
  const src = 'PUTBMP 10,10,"LOGO.BMP"\r\nPUTPCX 0,0,"A.PCX"\r\nPUTPNG 5,5,"B.PNG"\r\n';
  const model = tspl.parse(src);
  assert.equal(model.items.length, 0);
  const w = warnings(model);
  assert.equal(w.length, 3);
  assert.match(w[0], /almacenada en la impresora \(LOGO\.BMP\)/);
  assert.match(w[1], /\(A\.PCX\)/);
  assert.match(w[2], /\(B\.PNG\)/);
  for (const m of w) assert.doesNotMatch(m, /Comando no soportado/);
});

test('other unsupported commands keep the generic warning', () => {
  const model = tspl.parse('REVERSE 1,1,10,10\r\nERASE 0,0,5,5\r\n');
  assert.equal(warnings(model).length, 2);
  for (const m of warnings(model)) assert.match(m, /Comando no soportado/);
});

test('end to end: SIZE + TEXT + BITMAP parse in order', () => {
  const src = `SIZE 4,3\r\nCLS\r\nTEXT 10,10,"3",0,1,1,"HELLO"\r\nBITMAP 10,60,2,4,0,${PATTERN}\r\nPRINT 1,1\r\n`;
  const model = tspl.parse(src, { dpi: 203 });
  assert.deepEqual(model.items.map(i => i.kind), ['text', 'image']);
  assert.equal(model.size.width, 1016);
  assert.deepEqual(model.diagnostics, []);
});

test('a parsed TSPL image renders through the SVG renderer as black row runs', () => {
  const model = tspl.parse(`SIZE 4,3\r\nBITMAP 0,0,1,2,0,${bytes(0x3F, 0xC0)}`, { dpi: 203 });
  const { svg } = PB.svgRenderer.render(model, { width: 990, height: 550 }, { textScale: 1, showGrid: false, showAnchors: true, values: {} });
  // row 0 = 0x3F: first two dots black; row 1 = 0xC0: last six dots black
  assert.match(svg, /<path d="M0 0h2v1h-2zM2 1h6v1h-6z"/);
  assert.match(svg, /class="hit"/);
});
