const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// A BITMAP payload byte 0x0D is altered by the editor textarea (it normalizes CR / CRLF to LF). While the text lives in the
// editor, PB.ui.decodeFile stands for those bytes with PB.tspl.CR_PLACEHOLDER; every reader of payload chars maps it back.
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');

const fromLatin1 = text => new Uint8Array(Buffer.from(text, 'latin1'));
// What the textarea does to its value
const textareaNormalize = text => text.replace(/\r\n?/g, '\n');
// 2 bytes x 4 rows: CR alone, CR LF pair, LF alone, a high byte and plain bytes
const PAYLOAD = [0x0D, 0x41, 0x0D, 0x0A, 0x0A, 0x80, 0x0D, 0xFF];
const HEAD = 'SIZE 100 mm,60 mm\r\nCLS\r\nBITMAP 10,20,2,4,0,';
const TAIL = '\r\nPRINT 1\r\n';
const file = (payload = PAYLOAD) => new Uint8Array([...Buffer.from(HEAD, 'latin1'), ...payload, ...Buffer.from(TAIL, 'latin1')]);
const PLACEHOLDER = () => PB.tspl.CR_PLACEHOLDER;
const expectedEditorText = () => HEAD + PAYLOAD.map(b => (b === 0x0D ? PLACEHOLDER() : String.fromCharCode(b))).join('') + TAIL;

/** Neutral bitmap (1 = black) of the first image of a text, as TSPL bytes again (so it can be compared with the payload). */
const payloadOf = model => Array.from(tspl.emit(model, { dpi: 203 }).text
  .match(/BITMAP \d+,\d+,\d+,\d+,0,([\s\S]*?)\r\nPRINT/)[1], ch => ch.charCodeAt(0));

test('the placeholder is a private-use character outside latin1', () => {
  assert.equal(typeof PLACEHOLDER(), 'string');
  assert.equal(PLACEHOLDER().length, 1);
  assert.ok(PLACEHOLDER().charCodeAt(0) > 0xFF);
  assert.ok(PLACEHOLDER().charCodeAt(0) >= 0xE000 && PLACEHOLDER().charCodeAt(0) <= 0xF8FF);
});

test('decodeFile stands for the payload 0x0D bytes with the placeholder, keeping LF and the file line endings', () => {
  const text = PB.ui.decodeFile(file());
  assert.equal(text, expectedEditorText());
  assert.ok(text.includes('CLS\r\nBITMAP'), 'the CRLF line endings of the file are untouched');
  assert.ok(text.endsWith(TAIL));
  assert.equal(text.split(PLACEHOLDER()).length - 1, 3);
});

test('the payload survives the textarea newline normalization with the placeholder, and would not without it', () => {
  const faithful = Buffer.from(file()).toString('latin1');
  const typed = textareaNormalize(PB.ui.decodeFile(file()));
  const model = tspl.parse(typed, { dpi: 203 });
  assert.equal(model.items.length, 1);
  assert.deepEqual(payloadOf(model), PAYLOAD);
  // Old behaviour: the faithful latin1 text normalized by the textarea loses the bytes
  const old = tspl.parse(textareaNormalize(faithful), { dpi: 203 });
  const oldPayload = old.items.length ? payloadOf(old) : [];
  assert.notDeepEqual(oldPayload, PAYLOAD);
});

test('parse of the editor text gives an image whose decoded bytes equal the original payload', () => {
  const model = tspl.parse(PB.ui.decodeFile(file()), { dpi: 203 });
  assert.deepEqual(model.diagnostics.filter(d => d.level === 'warning' || d.level === 'error'), []);
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].kind, 'image');
  assert.deepEqual(payloadOf(model), PAYLOAD);
});

test('the tokenizer hands the placeholder back as the byte 0x0D in cmd.data', () => {
  const cmd = Array.from(PB.tspl.commands(PB.ui.decodeFile(file()))).find(c => c.name === 'BITMAP');
  assert.deepEqual(Array.from(cmd.data, ch => ch.charCodeAt(0)), PAYLOAD);
});

test('moveItem keeps the payload, placeholders included, byte for byte', () => {
  const text = textareaNormalize(PB.ui.decodeFile(file()));
  const item = tspl.parse(text, { dpi: 203 }).items[0];
  const moved = tspl.moveItem(text, item, 40, 24, { dpi: 203 });
  assert.notEqual(moved, text);
  const payloadSpan = t => { const cmd = Array.from(PB.tspl.commands(t)).find(c => c.name === 'BITMAP'); return t.slice(cmd.end - cmd.data.length, cmd.end); };
  assert.equal(payloadSpan(moved), payloadSpan(text));
  assert.ok(payloadSpan(moved).includes(PLACEHOLDER()));
});

test('TSPL -> TSPL conversion then toBytes reproduces the original payload bytes exactly', () => {
  const editorText = textareaNormalize(PB.ui.decodeFile(file()));
  const result = PB.convert.run(editorText, 'tspl', { dpi: 203 });
  const bytes = Array.from(PB.convert.toBytes(result.text, 'tspl'));
  const headerLength = Buffer.from(result.text.slice(0, result.text.indexOf('BITMAP')), 'latin1').length;
  const bitmapHead = Buffer.from(result.text.match(/BITMAP \d+,\d+,\d+,\d+,0,/)[0], 'latin1').length;
  const start = headerLength + bitmapHead;
  assert.deepEqual(bytes.slice(start, start + PAYLOAD.length), PAYLOAD);
});

test('toBytes writes the placeholder as 0x0D for latin1 targets, never as "?"', () => {
  const bytes = Array.from(PB.convert.toBytes(`A${PLACEHOLDER()}B€`, 'tspl'));
  assert.deepEqual(bytes, [0x41, 0x0D, 0x42, 0x3F]);
  // UTF-8 targets are not byte-faithful and keep their own encoding
  assert.deepEqual(Array.from(PB.convert.toBytes(PLACEHOLDER(), 'tpcl')), Array.from(Buffer.from(PLACEHOLDER(), 'utf8')));
});

test('decodeFile: a BITMAP payload of only ASCII bytes with 0x0D is protected too', () => {
  const payload = [0x0D, 0x0D, 0x0A, 0x41, 0x0D, 0x20, 0x30, 0x0D];
  const text = PB.ui.decodeFile(file(payload));
  assert.equal(text.split(PLACEHOLDER()).length - 1, 4);
  assert.deepEqual(payloadOf(tspl.parse(textareaNormalize(text), { dpi: 203 })), payload);
});

test('decodeFile: text without a BITMAP is unaffected (CR bytes stay as they are)', () => {
  const plain = 'SIZE 100 mm,60 mm\r\nCLS\r\nTEXT 10,10,"3",0,1,1,"Niño"\r\nPRINT 1\r\n';
  assert.equal(PB.ui.decodeFile(fromLatin1(plain)), plain);
  assert.ok(!PB.ui.decodeFile(fromLatin1(plain)).includes(PLACEHOLDER()));
  const ascii = 'SIZE 100 mm,60 mm\r\nCLS\r\nPRINT 1\r\n';
  assert.equal(PB.ui.decodeFile(fromLatin1(ascii)), ascii);
  const tpcl = '{D0610,0990,0550|}\r\n{C|}\r\n';
  assert.equal(PB.ui.decodeFile(new Uint8Array(Buffer.from(tpcl, 'utf8'))), tpcl);
});

test('decodeFile: a file with a BITMAP and no 0x0D in the payload decodes exactly as before', () => {
  const payload = [0x80, 0xFF, 0xFE, 0xC0, 0x7F, 0xA5, 0xAA, 0x55];
  assert.equal(PB.ui.decodeFile(file(payload)), Buffer.from(file(payload)).toString('latin1'));
});

test('a CR outside the payload (the file line endings) is never replaced, even next to a BITMAP', () => {
  const text = PB.ui.decodeFile(file());
  const outside = text.replace(/BITMAP \d+,\d+,\d+,\d+,0,[\s\S]{8}/, '');
  assert.ok(!outside.includes(PLACEHOLDER()));
  assert.ok(outside.includes('\r\n'));
});
