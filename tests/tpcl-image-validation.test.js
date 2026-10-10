const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// V4 TPCL images, checked against the manuals (B-SV4 2004 6.3.21, B-452-R 2012 6.3.22, B-452-TS12 ES 6.23):
//   {SG;aaaa,bbbb,cccc,dddd,e,ggg---ggg|}   aaaa X exactly 4 digits (0.1 mm), bbbb Y 4 or 5 digits, cccc width exactly 4 digits (dots),
//   dddd height 4 or 5 digits (dots), e 0..7 (0 nibble overwrite, 4 nibble OR drawn by the viewer), nibble data 30H..3FH,
//   ((width + 7) / 8) x height x 2 characters; the image buffer is 512 KB (the printer draws only what fits).
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const { images } = PB;

const BUFFER = 512 * 1024;
const sg = ({ x = '0100', y = '0050', w = '0008', h = '0002', e = '0', data } = {}) => {
  const dots = +w;
  const rows = +h;
  const body = data !== undefined ? data : '0'.repeat(((dots + 7) >> 3) * rows * 2);
  return `{SG;${x},${y},${w},${h},${e},${body}|}`;
};
const parse = text => tpcl.parse(text, { dpi: 203 });
const warnings = text => parse(text).diagnostics.filter(d => d.level === 'warning').map(d => d.text);
const imagesOf = text => parse(text).items.filter(i => i.kind === 'image');

const emit = items => PB.languages.emit('tpcl', {
  language: 'tpcl', size: { width: 990, height: 550, pitch: 610, gap: null, native: { axRaw: 'AX;+010,+000,+00' } }, items, diagnostics: [],
}, { dpi: 203 });
const bitmap = (w, h) => ({ w, h, data: new Uint8Array(w * h).fill(1) });
const image = (bm, props = {}) => ({ kind: 'image', x: 120, y: 200, width: 13, height: 4, bitmap: bm, data: null, ...props });
const warningsOf = out => out.diagnostics.filter(d => d.level === 'warning').map(d => d.text);

// ---- Parsing

test('parse: a valid SG at the limits raises nothing', () => {
  assert.deepEqual(warnings(sg()), []);
  assert.deepEqual(warnings(sg({ y: '00050' })), [], 'Y may have 5 digits');
  assert.deepEqual(warnings(sg({ w: '0008', h: '12000' })), [], 'height may have 5 digits (B-SV4, B-452-R)');
});

test('parse: X without 4 digits and Y without 4 or 5 digits warn, the values are read as written', () => {
  const x = warnings(sg({ x: '00100' }));
  assert.equal(x.length, 1);
  assert.match(x[0], /SG1/);
  assert.match(x[0], /4 dígitos/);
  assert.equal(imagesOf(sg({ x: '00100' }))[0].x, 100);
  assert.equal(warnings(sg({ y: '050' })).length, 1);
  assert.equal(warnings(sg({ y: '000050' })).length, 1);
});

test('parse: width and height without the digits the manual fixes warn with the valid range', () => {
  const w = warnings(sg({ w: '008', data: '0'.repeat(4) }));
  assert.equal(w.length, 1);
  assert.match(w[0], /ancho "008"/);
  assert.match(w[0], /0001\.\.9999/);
  const h = warnings(sg({ w: '0008', h: '002', data: '0'.repeat(4) }));
  assert.equal(h.length, 1);
  assert.match(h[0], /alto "002"/);
  assert.match(h[0], /99999/);
  assert.equal(imagesOf(sg({ w: '008', data: '0000' })).length, 1, 'still drawn as written');
});

test('parse: a size beyond 9999 wide or 99999 high is not drawn and the warning names the range', () => {
  const wide = parse(sg({ w: '10000', h: '0001', data: '00' }));
  assert.equal(wide.items.filter(i => i.kind === 'image').length, 0);
  assert.ok(wide.diagnostics.some(d => d.level === 'warning' && /9999/.test(d.text) && /ancho/.test(d.text)));
  const tall = parse(sg({ w: '0008', h: '100000', data: '00' }));
  assert.equal(tall.items.filter(i => i.kind === 'image').length, 0);
  assert.ok(tall.diagnostics.some(d => d.level === 'warning' && /99999/.test(d.text)));
});

test('parse: a size of 0 is not drawn and the warning names the range', () => {
  const model = parse(sg({ w: '0000', h: '0002', data: '' }));
  assert.equal(model.items.length, 0);
  assert.ok(model.diagnostics.some(d => d.level === 'warning' && /1\.\.9999/.test(d.text)));
});

test('parse: a size over the 512 KB image buffer warns and is drawn with the rows that fit', () => {
  const perRow = 13; // 100 dots
  const fits = Math.floor(BUFFER / perRow);
  const text = sg({ w: '0100', h: String(fits + 1000).padStart(5, '0'), data: '0'.repeat(perRow * (fits + 1000) * 2) });
  const ws = warnings(text);
  assert.equal(ws.length, 1);
  assert.match(ws[0], /512 KB/);
  const [item] = imagesOf(text);
  assert.equal(item.bitmap.h, fits);
  assert.equal(item.bitmap.w, 100);
  assert.deepEqual(warnings(sg({ w: '0100', h: String(fits).padStart(5, '0'), data: '0'.repeat(perRow * fits * 2) })), []);
});

test('parse: a data mode outside 0..7 warns with the range and is not drawn; 1..7 other than 0 and 4 keep their own message', () => {
  for (const e of ['8', '9', '00', '10']) {
    const model = parse(sg({ e }));
    assert.ok(model.diagnostics.some(d => d.level === 'warning' && /0\.\.7/.test(d.text)), `e=${e}`);
  }
  assert.equal(imagesOf(sg({ e: '8' })).length, 0);
  const model = parse(sg({ e: '1' }));
  assert.equal(model.items.length, 0);
  assert.ok(model.diagnostics.some(d => /no soportado por el visor/.test(d.text) && !/0\.\.7/.test(d.text)));
});

test('parse: data characters outside 30H..3FH warn once and count as white dots', () => {
  const text = sg({ w: '0008', h: '0001', data: 'zz' });
  const ws = warnings(text);
  assert.equal(ws.length, 1);
  assert.match(ws[0], /30H\.\.3FH/);
  assert.deepEqual([...imagesOf(text)[0].bitmap.data], new Array(8).fill(0));
  assert.deepEqual(warnings(sg({ w: '0008', h: '0001', data: '?>' })), []);
});

// ---- Emit

test('emit: a size beyond the printer limits is refused with one warning that states them', () => {
  for (const bm of [bitmap(10000, 1), bitmap(4000, 1100)]) {
    const out = emit([image(bm)]);
    assert.ok(!out.text.includes('{SG'));
    const ws = warningsOf(out);
    assert.equal(ws.length, 1);
    assert.match(ws[0], /512 KB/);
  }
});

test('emit: several oversized images give one warning', () => {
  assert.equal(warningsOf(emit([image(bitmap(4000, 1100)), image(bitmap(4000, 1200))])).length, 1);
});

test('emit: a 5-digit height inside the buffer is written and parses back', () => {
  const out = emit([image(bitmap(8, 12000))]);
  assert.ok(out.text.includes('{SG;0120,0200,0008,12000,0,'));
  assert.deepEqual(warningsOf(out), []);
  assert.equal(parse(out.text).items.find(i => i.kind === 'image').bitmap.h, 12000);
});

test('emit: the image exactly at the buffer size is written', () => {
  const out = emit([image(bitmap(1024, 512))]);
  assert.ok(out.text.includes('{SG;'));
  assert.deepEqual(warningsOf(out), []);
});

// ---- Insertion from the overlay (TPCL imageCommand)

test('imageCommand: TPCL writes the SG for the overlay picture like buildSG', () => {
  assert.equal(typeof tpcl.imageCommand, 'function');
  const bm = bitmap(10, 2);
  assert.equal(
    tpcl.imageCommand({ xMm: '10', yMm: '5,5', ...bm, dpi: 203 }),
    images.buildSG({ xMm: 10, yMm: 5.5, w: 10, h: 2, data: images.bitmapToNibble(bm.data, 10, 2) }),
  );
});

test('imageCommand: a position outside 0..999,9 mm is refused with a Spanish error', () => {
  const bm = bitmap(8, 1);
  for (const [xMm, yMm] of [['1000', '0'], ['0', '1000'], ['-1', '0'], ['0', '-0,1']]) {
    assert.throws(() => tpcl.imageCommand({ xMm, yMm, ...bm, dpi: 203 }), /0.*999,9 mm/, `${xMm},${yMm}`);
  }
  assert.doesNotThrow(() => tpcl.imageCommand({ xMm: '999,9', yMm: '0', ...bm, dpi: 203 }));
  assert.doesNotThrow(() => tpcl.imageCommand({ xMm: '', yMm: '', ...bm, dpi: 203 }));
});

test('imageCommand: a size beyond the printer limits is refused with a Spanish error', () => {
  assert.throws(() => tpcl.imageCommand({ xMm: 0, yMm: 0, w: 10000, h: 1, data: new Uint8Array(10000), dpi: 203 }), /9999/);
  assert.throws(() => tpcl.imageCommand({ xMm: 0, yMm: 0, w: 4000, h: 1100, data: new Uint8Array(4000 * 1100), dpi: 203 }), /512 KB/);
});

// ---- Panel

test('the image panel only offers positions 0..999,9 mm', () => {
  const el = (props = {}) => ({ value: '', textContent: '', disabled: false, files: [], addEventListener() {}, ...props });
  const els = { fileInput: el(), x: el(), y: el(), width: el(), threshold: el({ value: '50' }), thresholdValue: el(), insert: el(), remove: el(), rotation: el({ value: '0' }) };
  PB.ui.createImagePanel(els, { onFile() {}, onChange() {}, onThreshold() {}, onRotation() {}, onRemove() {}, onInsert() {} });
  for (const input of [els.x, els.y]) {
    assert.equal(String(input.min), '0');
    assert.equal(String(input.max), '999.9');
  }
});
