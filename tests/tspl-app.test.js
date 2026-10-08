const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// T8: what the app needs to work with a TSPL document: byte-preserving file decoding, the example label and the
// absent-hook paths that js/app.js guards (palette, drag, properties, insert, size).
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');
const tpcl = PB.languages.get('tpcl');

const latin1 = bytes => Buffer.from(bytes).toString('latin1');
const fromText = (text, encoding) => new Uint8Array(Buffer.from(text, encoding));

// 2 bytes x 4 rows: every byte >= 0x80 except where noted, none is a valid UTF-8 sequence on its own
const PATTERN = [0x80, 0xFF, 0xFE, 0xC0, 0x7F, 0xA5, 0xAA, 0x55];
const tsplFile = (payload = PATTERN) => new Uint8Array([
  ...Buffer.from('SIZE 100 mm,60 mm\r\nCLS\r\nBITMAP 10,20,2,4,0,', 'latin1'), ...payload, ...Buffer.from('\r\nPRINT 1\r\n', 'latin1'),
]);

test('decodeFile keeps a UTF-8 TPCL file with accents identical to the plain UTF-8 text', () => {
  const source = '{D0610,0990,0550|}\r\n{C|}\r\n{PC001;0050,0020,05,05,J,00,B=Niño café ñ ü|}\r\n{XS;I,0001,0002C4100|}';
  assert.equal(PB.ui.decodeFile(fromText(source, 'utf8')), source);
});

test('decodeFile returns ASCII and unrecognized text as UTF-8', () => {
  assert.equal(PB.ui.decodeFile(fromText('SIZE 100 mm,60 mm\r\nCLS\r\n', 'utf8')), 'SIZE 100 mm,60 mm\r\nCLS\r\n');
  assert.equal(PB.ui.decodeFile(fromText('hola ñ', 'utf8')), 'hola ñ');
  assert.equal(PB.ui.decodeFile(new Uint8Array(0)), '');
});

test('decodeFile: TSPL BITMAP bytes 0x80-0xFF round-trip through detect and parse with the payload intact', () => {
  const bytes = tsplFile();
  assert.ok(new TextDecoder('utf-8').decode(bytes).includes('�'), 'the plain UTF-8 decode would mangle this file');
  const text = PB.ui.decodeFile(bytes);
  assert.equal(text, latin1(bytes));
  assert.equal(PB.languages.detect(text).id, 'tspl');
  const model = tspl.parse(text, { dpi: 203 });
  assert.deepEqual(model.diagnostics, []);
  assert.equal(model.items.length, 1);
  const bitmap = model.items[0].bitmap;
  assert.equal(bitmap.w, 16);
  assert.equal(bitmap.h, 4);
  // First row 0x80 0xFF: TSPL bit 0 = black, neutral 1 = black
  assert.deepEqual(Array.from(bitmap.data.slice(0, 16)), [0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(bitmap.data.slice(16, 32)), [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1]);
});

test('decodeFile: a BITMAP payload that happens to be valid UTF-8 is still kept byte for byte', () => {
  // C3 A9 = "é" in UTF-8: no U+FFFD, but the text would be one character shorter than the payload
  const bytes = tsplFile([0xC3, 0xA9, 0xC3, 0xA9, 0xC3, 0xA9, 0xC3, 0xA9]);
  assert.ok(!new TextDecoder('utf-8').decode(bytes).includes('�'));
  const text = PB.ui.decodeFile(bytes);
  assert.equal(text, latin1(bytes));
  const model = tspl.parse(text, { dpi: 203 });
  assert.deepEqual(model.diagnostics, []);
  assert.equal(model.items[0].bitmap.data.length, 64);
});

test('decodeFile: a TSPL file with accents but no BITMAP stays UTF-8 text', () => {
  const source = 'SIZE 100 mm,60 mm\r\nCLS\r\nTEXT 10,10,"3",0,1,1,"Niño"\r\nPRINT 1\r\n';
  assert.equal(PB.ui.decodeFile(fromText(source, 'utf8')), source);
});

test('decodeFile: a non-UTF-8 file that is not TSPL falls back to the plain UTF-8 decode, as before', () => {
  const bytes = fromText('{D0610,0990,0550|}\r\n{PC001;0050,0020,05,05,J,00,B=Niño|}', 'latin1');
  assert.equal(PB.ui.decodeFile(bytes), new TextDecoder('utf-8').decode(bytes));
});

test('decodeFile handles large binary payloads (chunked latin1)', () => {
  const payload = Array.from({ length: 20000 }, (_, i) => 0x80 + (i % 128));
  const bytes = new Uint8Array([...Buffer.from('SIZE 100 mm,60 mm\r\nBITMAP 0,0,200,100,0,', 'latin1'), ...payload]);
  assert.equal(PB.ui.decodeFile(bytes), latin1(bytes));
});

test('the TSPL example is in the example list and parses without warnings or errors', () => {
  const example = PB.examples.find(e => e.language === 'tspl');
  assert.ok(example, 'a TSPL example exists');
  assert.equal(PB.examples.filter(e => e.id === example.id).length, 1);
  assert.equal(PB.languages.detect(example.source).id, 'tspl');
  const model = tspl.parse(example.source, { dpi: 203 });
  assert.deepEqual(model.diagnostics.filter(d => d.level === 'error' || d.level === 'warning'), []);
  const kinds = {};
  for (const item of model.items) kinds[item.kind] = (kinds[item.kind] || 0) + 1;
  assert.deepEqual(kinds, { line: 2, text: 5, barcode: 1, qr: 1 });
  assert.equal(model.size.width, 1000);
  assert.equal(model.size.height, 600);
  assert.ok(model.items.every(item => PB.sources.rangeOf(item)), 'every item has a source span');
  // It also validates cleanly for the viewer
  assert.deepEqual(PB.validator.validate(model, tspl).filter(d => d.level === 'error' || d.level === 'warning'), []);
});

test('the configuration offers 203 and 300 dpi, 203 first (the TPCL default)', () => {
  assert.deepEqual([...PB.config.resolutions], [203, 300]);
});

test('TSPL has the editing, palette and image insertion hooks', () => {
  for (const hook of ['moveItem', 'updateItem', 'describeItem', 'insertCommand', 'componentTemplates', 'buildComponent']) {
    assert.equal(typeof tspl[hook], 'function', hook);
  }
  assert.equal(tspl.insertImage, true);
  assert.equal(typeof tspl.imageCommand, 'function');
  assert.equal(tpcl.insertImage, true);
  // TSPL writes the label size (SIZE/GAP)
  for (const hook of ['sizeCommands', 'applySize']) assert.equal(typeof tspl[hook], 'function', hook);
  // TPCL keeps all of them
  for (const hook of ['moveItem', 'updateItem', 'describeItem', 'componentTemplates', 'buildComponent', 'insertCommand', 'applySize']) {
    assert.equal(typeof tpcl[hook], 'function', hook);
  }
});

test('size Apply on a TSPL label writes SIZE and GAP and reports it as supported', () => {
  const source = PB.examples.find(e => e.language === 'tspl').source;
  const result = PB.sizes.apply(PB.languages.detect(source), source, PB.sizes.resolve({ name: 'x', w: 50, h: 30, p: 33 }));
  assert.equal(result.supported, true);
  assert.match(result.text, /^SIZE 50 mm,30 mm/im);
  assert.match(result.text, /^GAP 3 mm,0 mm/im);
});

test('the palette of a language without componentTemplates is empty and its panel hidden', () => {
  const parent = { hidden: false };
  const container = { parentElement: parent, replaceChildren(...items) { this.children = items; } };
  const palette = PB.ui.createPalette(container, { onInsert: () => {} });
  palette.render([]);
  assert.deepEqual(container.children, []);
  assert.equal(parent.hidden, true);
});
