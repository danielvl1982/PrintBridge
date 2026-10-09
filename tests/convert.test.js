const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// T6: the pure conversion API (PB.convert) on top of the language registry. js/ui.js is loaded for decodeFile (byte round trip).
const PB = loadUpTo('js/ui.js');
const spool = PB.examples.find(e => e.id === 'spool-99x55');
const tsplExample = PB.examples.find(e => e.id === 'tspl-label-100x60');

// A language that cannot emit, to prove targets()/run() read the registry instead of listing ids.
PB.languages.register({ id: 'noemit', name: 'Sin emisor', detect: src => src.startsWith('NOEMIT'), parse: () => ({ language: 'noemit', size: {}, items: [], diagnostics: [] }) });

const errorOf = fn => { try { fn(); } catch (e) { return e; } return null; };
const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));
const bitmapOf = (w, h, fn) => ({ w, h, data: Uint8Array.from({ length: w * h }, (_, i) => (fn(i % w, Math.floor(i / w)) ? 1 : 0)) });

test('PB.convert exposes run, targets, toBytes and fileName', () => {
  assert.ok(PB.convert && Object.isFrozen(PB.convert));
  for (const name of ['run', 'targets', 'toBytes', 'fileName']) assert.equal(typeof PB.convert[name], 'function', name);
});

test('js/core/convert.js is listed in the manifest and in index.html, after languages.js and emit.js and before the languages', () => {
  const files = require('./helpers/load').manifest();
  const at = files.indexOf('js/core/convert.js');
  assert.ok(at > files.indexOf('js/core/languages.js') && at > files.indexOf('js/core/emit.js'));
  assert.ok(at < files.indexOf('js/languages/tpcl.js') && at < files.indexOf('js/languages/tspl.js'));
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="js/core/convert.js"></script>'));
});

test('run converts TPCL to TSPL: detected source, target, text and both diagnostic lists', () => {
  const r = PB.convert.run(spool.source, 'tspl', { dpi: 203 });
  assert.equal(r.source, 'tpcl');
  assert.equal(r.target, 'tspl');
  assert.ok(r.text.startsWith('SIZE 99 mm,55 mm\r\n'));
  assert.ok(Array.isArray(r.diagnostics) && r.diagnostics.length > 0);
  assert.deepEqual(r.parseDiagnostics, []);
});

test('run converts TSPL to TPCL and the dpi changes the dots', () => {
  const r = PB.convert.run(tsplExample.source, 'tpcl', { dpi: 203 });
  assert.equal(r.source, 'tspl');
  assert.ok(r.text.startsWith('{D0630,1000,0600|}'));
  const r300 = PB.convert.run(tsplExample.source, 'tpcl', { dpi: 300 });
  assert.notEqual(r300.text, r.text);
});

test('run without dpi uses the first configured resolution', () => {
  const [first] = PB.config.resolutions;
  assert.equal(PB.convert.run(tsplExample.source, 'tpcl').text, PB.convert.run(tsplExample.source, 'tpcl', { dpi: first }).text);
});

test('parse diagnostics of the source come back in parseDiagnostics (not mixed with the emit ones)', () => {
  const r = PB.convert.run('{D0610,0990,0550|}\n{ZZ;1|}\n{XS;I,0001,0002C4100|}', 'tspl');
  assert.ok(r.parseDiagnostics.some(d => d.level === 'warning' && /no soportado/.test(d.text)));
  assert.ok(!r.diagnostics.some(d => /no soportado/.test(d.text)));
});

test('an explicit sourceId overrides the detection', () => {
  const detected = PB.convert.run(tsplExample.source, 'tspl');
  assert.equal(detected.source, 'tspl');
  const forced = PB.convert.run(tsplExample.source, 'tspl', { sourceId: 'tpcl' });
  assert.equal(forced.source, 'tpcl');
  // TSPL text read as TPCL has no commands: the label has no size
  assert.ok(levels(forced.diagnostics, 'warning').some(d => /tamaño/.test(d.text)));
  assert.notEqual(forced.text, detected.text);
});

test('empty or non-string text throws Error with code empty-text and a Spanish message', () => {
  for (const text of ['', '   \r\n', null, undefined, 42]) {
    const e = errorOf(() => PB.convert.run(text, 'tspl'));
    assert.ok(e instanceof Error, String(text));
    assert.equal(e.code, 'empty-text');
    assert.match(e.message, /vac[ií]o|no hay texto/i);
  }
});

test('text of no known language throws no-source-language; so does an unknown sourceId', () => {
  const unknown = errorOf(() => PB.convert.run('esto no es una etiqueta', 'tspl'));
  assert.equal(unknown.code, 'no-source-language');
  assert.match(unknown.message, /lenguaje/);
  const forced = errorOf(() => PB.convert.run(spool.source, 'tspl', { sourceId: 'epl' }));
  assert.equal(forced.code, 'no-source-language');
  assert.match(forced.message, /epl/);
});

test('an unknown target, or a language without emit, throws no-target-emit', () => {
  const unknown = errorOf(() => PB.convert.run(spool.source, 'epl'));
  assert.equal(unknown.code, 'no-target-emit');
  assert.match(unknown.message, /epl/);
  const noEmit = errorOf(() => PB.convert.run(spool.source, 'noemit'));
  assert.equal(noEmit.code, 'no-target-emit');
  assert.match(noEmit.message, /Sin emisor|noemit/);
});

test('the target is checked before the source (a missing target wins over an undetectable text)', () => {
  assert.equal(errorOf(() => PB.convert.run('nada', 'epl')).code, 'no-target-emit');
});

test('a source language that cannot emit can still be converted from (parse only is enough)', () => {
  const r = PB.convert.run('NOEMIT x', 'tspl');
  assert.equal(r.source, 'noemit');
});

test('targets() lists the registered languages that emit, as { id, name }', () => {
  const targets = PB.convert.targets();
  assert.deepEqual(targets.map(t => t.id), ['tpcl', 'tspl', 'zpl']);
  for (const t of targets) assert.equal(t.name, PB.languages.get(t.id).name);
  assert.deepEqual(Object.keys(targets[0]).sort(), ['id', 'name']);
});

test('language properties: TSPL is latin1 .prn, TPCL is the utf-8 default with .txt', () => {
  assert.equal(PB.languages.get('tspl').fileEncoding, 'latin1');
  assert.equal(PB.languages.get('tspl').fileExtension, 'prn');
  assert.equal(PB.languages.get('tpcl').fileEncoding, undefined);
  assert.equal(PB.languages.get('tpcl').fileExtension, 'txt');
});

test('the registry validates fileEncoding and fileExtension when present', () => {
  const base = { name: 'X', detect: () => false, parse: () => ({}) };
  assert.throws(() => PB.languages.register({ ...base, id: 'bad1', fileEncoding: 'ascii' }), /fileEncoding/);
  assert.throws(() => PB.languages.register({ ...base, id: 'bad2', fileExtension: '.prn' }), /fileExtension/);
  assert.throws(() => PB.languages.register({ ...base, id: 'bad3', fileExtension: '' }), /fileExtension/);
  assert.throws(() => PB.languages.register({ ...base, id: 'bad4', fileExtension: 7 }), /fileExtension/);
  PB.languages.register({ ...base, id: 'good1', fileEncoding: 'utf-8', fileExtension: 'lbl' });
  PB.languages.register({ ...base, id: 'good2', fileEncoding: 'latin1' });
});

test('toBytes for TPCL is UTF-8 (accents are two bytes)', () => {
  const text = '{D0610,0990,0550|}\n{PC00;0050,0020,05,05,J,00,B|}\n{RC00;Niño café|}';
  const bytes = PB.convert.toBytes(text, 'tpcl');
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual(Array.from(bytes), Array.from(Buffer.from(text, 'utf8')));
  assert.ok(bytes.length > text.length);
});

test('toBytes for TSPL is byte-preserving latin1: each char code is one byte, a BITMAP payload included', () => {
  const payload = Array.from({ length: 256 }, (_, i) => i);
  const text = 'SIZE 100 mm,60 mm\r\nBITMAP 0,0,16,16,0,' + String.fromCharCode(...payload) + '\r\nTEXT 1,1,"3",0,1,1,"Niño"\r\nPRINT 1,1\r\n';
  const bytes = PB.convert.toBytes(text, 'tspl');
  assert.equal(bytes.length, text.length);
  for (let i = 0; i < text.length; i++) assert.equal(bytes[i], text.charCodeAt(i) & 0xFF, `byte ${i}`);
  assert.deepEqual(Array.from(bytes), Array.from(Buffer.from(text, 'latin1')));
});

test('toBytes in latin1 writes "?" for characters above 255 instead of a wrapped byte', () => {
  const bytes = PB.convert.toBytes('A€B≠', 'tspl');
  assert.deepEqual(Array.from(bytes), [0x41, 0x3F, 0x42, 0x3F]);
});

test('toBytes throws no-target-emit for an unknown language', () => {
  assert.equal(errorOf(() => PB.convert.toBytes('x', 'epl')).code, 'no-target-emit');
});

test('fileName: .prn for TSPL, .txt for TPCL, default base "etiqueta"', () => {
  assert.equal(PB.convert.fileName('tspl'), 'etiqueta.prn');
  assert.equal(PB.convert.fileName('tpcl'), 'etiqueta.txt');
});

test('fileName reuses the base of the source file name and drops any path', () => {
  assert.equal(PB.convert.fileName('tspl', 'bobina.ter'), 'bobina.prn');
  assert.equal(PB.convert.fileName('tpcl', 'bobina.prn'), 'bobina.txt');
  assert.equal(PB.convert.fileName('tspl', 'C:\\labels\\a.b.txt'), 'a.b.prn');
  assert.equal(PB.convert.fileName('tspl', '/tmp/x/sin-extension'), 'sin-extension.prn');
  assert.equal(PB.convert.fileName('tspl', ''), 'etiqueta.prn');
  assert.equal(PB.convert.fileName('tspl', '.ter'), 'etiqueta.prn');
});

test('fileName for a language without fileExtension falls back to .txt', () => {
  assert.equal(PB.convert.fileName('noemit'), 'etiqueta.txt');
});

test('characters above 255 in a latin1 target add a Spanish warning that counts them; utf-8 targets do not', () => {
  const tpclSource = '{D0610,0990,0550|}\n{C|}\n{PC00;0050,0020,10,10,J,00,B|}\n{RC00;Precio 5€ ≠ 6€ ñ|}\n{XS;I,0001,0002C4100|}';
  const toTspl = PB.convert.run(tpclSource, 'tspl');
  const warnings = levels(toTspl.diagnostics, 'warning').filter(d => /latin1/i.test(d.text));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /3 caracteres/);
  assert.match(warnings[0].text, /\?/);
  const toTpcl = PB.convert.run(tpclSource, 'tpcl');
  assert.ok(!toTpcl.diagnostics.some(d => /latin1/i.test(d.text)));
  const plain = PB.convert.run(tsplExample.source, 'tspl');
  assert.ok(!plain.diagnostics.some(d => /latin1/i.test(d.text)));
});

test('the BITMAP bytes of a converted image survive toBytes -> decodeFile -> detect -> parse (bytes 0x80-0xFF included)', () => {
  // 16 wide so no padding columns; mostly white (TSPL byte 0xFF) with a pattern that yields high and low bytes
  const bitmap = bitmapOf(16, 8, (x, y) => (x * 3 + y * 5) % 7 === 0 || x === 15);
  const image = { kind: 'image', x: 40, y: 30, width: 0, height: 0, bitmap, data: null };
  const model = { language: 'tpcl', size: { width: 990, height: 550, pitch: 610, gap: null, native: {} }, items: [image], diagnostics: [] };
  const tpclText = PB.languages.emit('tpcl', model, { dpi: 203 }).text;
  const r = PB.convert.run(tpclText, 'tspl', { dpi: 203 });
  assert.deepEqual(levels(r.parseDiagnostics, 'error', 'warning'), []);
  const bytes = PB.convert.toBytes(r.text, 'tspl');
  assert.ok(bytes.some(b => b >= 0x80), 'the payload has high bytes');
  assert.ok(new TextDecoder('utf-8').decode(bytes).includes('�'), 'a UTF-8 decode would mangle the file');
  const decoded = PB.ui.decodeFile(bytes);
  assert.equal(decoded, r.text);
  assert.equal(PB.languages.detect(decoded).id, 'tspl');
  const back = PB.languages.get('tspl').parse(decoded, { dpi: 203 });
  assert.deepEqual(levels(back.diagnostics, 'error', 'warning'), []);
  assert.equal(back.items.length, 1);
  assert.deepEqual({ w: back.items[0].bitmap.w, h: back.items[0].bitmap.h, data: Array.from(back.items[0].bitmap.data) },
    { w: 16, h: 8, data: Array.from(bitmap.data) });
});

test('a TSPL file with accents converted from TPCL reads back as the same text through decodeFile', () => {
  const tpclSource = '{D0610,0990,0550|}\n{C|}\n{PC00;0050,0020,10,10,J,00,B|}\n{RC00;Niño café|}\n{XS;I,0001,0002C4100|}';
  const r = PB.convert.run(tpclSource, 'tspl');
  const decoded = PB.ui.decodeFile(PB.convert.toBytes(r.text, 'tspl'));
  assert.equal(decoded, r.text);
  assert.equal(PB.languages.get('tspl').parse(decoded).items[0].data, 'Niño café');
});

// ---- Z8: ZPL as the third language

test('targets lists the three languages in registration order, and each is detected as a source', () => {
  assert.deepEqual(PB.convert.targets().filter(t => t.id !== 'noemit').map(t => t.id), ['tpcl', 'tspl', 'zpl']);
  const zplExample = PB.examples.find(e => e.id === 'zpl-label-100x60');
  for (const [example, id] of [[spool, 'tpcl'], [tsplExample, 'tspl'], [zplExample, 'zpl']]) {
    for (const target of ['tpcl', 'tspl', 'zpl']) assert.equal(PB.convert.run(example.source, target, { dpi: 203 }).source, id);
  }
});

test('ZPL files: .zpl extension, the file name rule of the other languages, UTF-8 bytes without any special byte', () => {
  assert.equal(PB.convert.fileName('zpl'), 'etiqueta.zpl');
  assert.equal(PB.convert.fileName('zpl', 'labels/bobina 99.ter'), 'bobina 99.zpl');
  assert.equal(PB.convert.fileName('zpl', 'a:b?.prn'), 'a_b_.zpl');
  const text = '^XA\r\n^FO10,10^A0N,30,30^FDNiño € ñ^FS\r\n^XZ\r\n';
  assert.deepEqual(Array.from(PB.convert.toBytes(text, 'zpl')), Array.from(new TextEncoder().encode(text)));
  assert.equal(new TextDecoder().decode(PB.convert.toBytes(text, 'zpl')), text);
});

test('a ZPL output never carries the characters outside latin1 warning (its file is UTF-8) and an image is ASCII hex', () => {
  const converted = PB.convert.run('{D0610,0990,0550|}\n{PC001;0100,0100,05,05,J,00,B=Niño € ñ|}\n{XS;I,0001,0002C4100|}', 'zpl', { dpi: 203 });
  assert.ok(!converted.diagnostics.some(d => /latin1/.test(d.text)));
  const tspl = PB.convert.run('{D0610,0990,0550|}\n{PC001;0100,0100,05,05,J,00,B=Niño € ñ|}\n{XS;I,0001,0002C4100|}', 'tspl', { dpi: 203 });
  assert.ok(tspl.diagnostics.some(d => /latin1/.test(d.text)), 'while TSPL (latin1 file) does warn');
  const bitmap = bitmapOf(16, 6, (x, y) => (x + 2 * y) % 5 === 0);
  const model = { language: 'tpcl', size: { width: 990, height: 550, pitch: 610, gap: null, native: {} }, diagnostics: [], items: [{ kind: 'image', x: 40, y: 30, width: 0, height: 0, bitmap, data: null }] };
  const source = PB.languages.emit('tpcl', model, { dpi: 203 }).text;
  const zpl = PB.convert.run(source, 'zpl', { dpi: 203 }).text;
  assert.match(zpl, /\^GFA,/);
  assert.ok(/^[\t\r\n\u0020-\u007E]*$/.test(zpl));
  assert.deepEqual(Array.from(PB.convert.toBytes(zpl, 'zpl')), Array.from(zpl, ch => ch.charCodeAt(0)));
});
