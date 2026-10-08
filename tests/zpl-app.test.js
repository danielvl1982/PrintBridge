const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUpTo, manifest } = require('./helpers/load');

// Z1: what the app needs to work with a ZPL document: file decoding, language detection, the Formato row, the palette hooks,
// the Convertir panel targets and the script lists. js/app.js needs a browser, so its wiring is checked through the pieces
// it calls (the same approach as tests/tspl-app.test.js).
const PB = loadUpTo('js/ui.js');
const zpl = PB.languages.get('zpl');

const ZPL_LABEL = '^XA\r\n^PW812\r\n^LL1218\r\n^FO50,50^A0N,30,30^FDHola^FS\r\n^XZ\r\n';
const fromText = text => new Uint8Array(Buffer.from(text, 'utf8'));
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('decodeFile keeps a ZPL file as UTF-8 text (accents included) and the registry detects it as ZPL', () => {
  assert.equal(PB.ui.decodeFile(fromText(ZPL_LABEL)), ZPL_LABEL);
  const accented = '^XA\r\n^FO10,10^A0N,30,30^FDNiño café^FS\r\n^XZ\r\n';
  assert.equal(PB.ui.decodeFile(fromText(accented)), accented);
  assert.equal(PB.languages.detect(PB.ui.decodeFile(fromText(ZPL_LABEL))).id, 'zpl');
});

test('the Formato row: sizes.apply writes ^PW / ^LL with the resolution the app adds to the chosen size', () => {
  const chosen = PB.sizes.resolve({ name: '100×60 mm', w: 100, h: 60, p: 63 });
  const at203 = PB.sizes.apply(PB.languages.detect(ZPL_LABEL), ZPL_LABEL, { ...chosen, dpi: 203 });
  assert.equal(at203.supported, true);
  assert.equal(at203.text, ZPL_LABEL.replace('^PW812', '^PW799').replace('^LL1218', '^LL480'));
  const at300 = PB.sizes.apply(zpl, ZPL_LABEL, { ...chosen, dpi: 300 });
  assert.match(at300.text, /\^PW1181\r\n\^LL709\r\n/);
  // ZPL sizes are whole dots (799 x 480 at 203 dpi): the label declares 100.0 x 60.1 mm now, so the Formato row may show "Personalizado"
  const model = zpl.parse(at203.text, { dpi: 203 });
  assert.deepEqual([model.size.width, model.size.height], [1000, 601]);
  assert.deepEqual([model.size.pitch, model.size.gap], [null, null]);
});

test('the palette: ZPL offers the components its slices provide (Texto and Código de barras so far) and no Imagen entry; an unrecognised text is not ZPL', () => {
  const image = { kind: 'image', label: 'Imagen' };
  assert.deepEqual(PB.ui.paletteEntries(zpl, image), [{ kind: 'text', label: 'Texto' }, { kind: 'barcode', label: 'Código de barras' }]);
  assert.deepEqual(PB.ui.paletteEntries(PB.languages.get('tspl'), image).at(-1), image);
  assert.equal(PB.languages.detect(''), null);
});

test('the app never falls back to TPCL when the detected language is ZPL: every TPCL fallback in js/app.js comes after languages.detect', () => {
  const app = read('js/app.js');
  const fallbacks = app.split('\n').filter(line => line.includes("languages.get('tpcl')"));
  assert.ok(fallbacks.length > 0);
  for (const line of fallbacks) assert.match(line, /languages\.detect\(.*\)\s*\|\|\s*languages\.get\('tpcl'\)|updatePalette\(used \|\| /);
  // the Formato row hands the resolution to the language (ZPL sizes are in dots)
  assert.match(app, /sizes\.apply\(.*\{ \.\.\.size, dpi: /);
});

test('the resolution selector stays at 203 and 300 dpi (600 dpi is not offered yet)', () => {
  assert.deepEqual([...PB.config.resolutions], [203, 300]);
});

test('Convertir: ZPL is a target and a source; converting a TSPL label writes the format with the size in dots', () => {
  const tspl = PB.examples.find(e => e.id === 'tspl-label-100x60');
  const toZpl = PB.convert.run(tspl.source, 'zpl', { dpi: 203 });
  assert.equal(toZpl.source, 'tspl');
  assert.equal(toZpl.target, 'zpl');
  assert.ok(toZpl.text.startsWith('^XA\r\n^PW799\r\n^LL480\r\n'));
  assert.ok(toZpl.text.endsWith('^XZ\r\n'));
  // no component writes ZPL yet (Z2 onwards): the items are reported, not lost silently
  assert.ok(toZpl.diagnostics.some(d => d.level === 'warning' && /zpl/.test(d.text)));
  const fromZpl = PB.convert.run(ZPL_LABEL, 'tspl', { dpi: 203 });
  assert.equal(fromZpl.source, 'zpl');
  assert.match(fromZpl.text, /^SIZE 101\.6 mm,152\.4 mm\r\n/);
  assert.equal(PB.convert.run(ZPL_LABEL, 'tpcl', { dpi: 203 }).source, 'zpl');
  assert.equal(PB.convert.run(ZPL_LABEL, 'zpl', { dpi: 203 }).text.startsWith('^XA\r\n^PW812\r\n^LL1218\r\n'), true);
});

test('the ZPL files are in the manifest and in index.html, after TSPL and before the viewer; .zpl is accepted for drops', () => {
  const files = manifest();
  const at = file => files.indexOf(file);
  assert.ok(at('js/languages/zpl-edit.js') > at('js/languages/tspl.js'));
  assert.equal(at('js/languages/zpl.js'), at('js/languages/zpl-edit.js') + 1);
  assert.ok(at('js/languages/zpl.js') < at('js/view.js'));
  const html = read('index.html');
  assert.ok(html.includes('<script src="js/languages/zpl-edit.js"></script>'));
  assert.ok(html.includes('<script src="js/languages/zpl.js"></script>'));
  assert.ok(html.indexOf('js/languages/zpl.js') > html.indexOf('js/languages/tspl.js'));
  assert.match(html, /accept="[^"]*\.zpl/);
});

test('README documents the ZPL support and the .zpl extension', () => {
  const readme = read('README.md');
  assert.match(readme, /ZPL support \(Zebra\)/);
  assert.match(readme, /`\.zpl`/);
});
