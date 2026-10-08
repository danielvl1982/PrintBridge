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

test('the palette: ZPL offers the components its slices provide (text, bar codes, QR, Data Matrix and the shapes) and the Imagen entry last; an unrecognised text is not ZPL', () => {
  const image = { kind: 'image', label: 'Imagen' };
  assert.deepEqual(PB.ui.paletteEntries(zpl, image), [
    { kind: 'text', label: 'Texto' }, { kind: 'barcode', label: 'Código de barras' }, { kind: 'qr', label: 'QR' }, { kind: 'datamatrix', label: 'Data Matrix' },
    { kind: 'line', label: 'Línea' }, { kind: 'box', label: 'Caja' }, { kind: 'ellipse', label: 'Elipse' }, { kind: 'circle', label: 'Círculo' }, { kind: 'area', label: 'Área invertida' },
    image,
  ]);
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
  // text, bar code, QR and the box of the example are written (Z2..Z5); only the font simulation is reported
  assert.match(toZpl.text, /\^GB764,464,4\^FS/);
  assert.deepEqual(toZpl.diagnostics.filter(d => d.level !== 'info'), []);
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

// Z8: ZPL declares whole dots (^PW / ^LL), so 100 x 60 mm reads back as 100.0 x 60.1 (203 dpi) and has no pitch: the Formato row still
// finds the standard size, within one dot; TPCL and TSPL (exact millimetres) keep the exact match.
const [tpcl, tspl] = [PB.languages.get('tpcl'), PB.languages.get('tspl')];
const STANDARDS = [[100, 150], [100, 100], [100, 60], [80, 50], [60, 40], [50, 30], [40, 30]];
const selectedFor = (language, text, dpi) => {
  const model = language.parse(text, { dpi });
  return PB.sizes.createCatalog(PB.config.sizes).findBySize({ ...model.size, pitch: PB.sizes.declaredPitch(model.size) });
};

test('catalog: a size with a tolerance matches a standard one within it and ignores a missing pitch; without tolerance it stays exact', () => {
  const catalog = PB.sizes.createCatalog(PB.config.sizes);
  assert.equal(catalog.findBySize({ width: 1000, height: 601, pitch: null, tolerance: 1.25 }).id, '100x60');
  assert.equal(catalog.findBySize({ width: 1000, height: 602, pitch: null, tolerance: 1.25 }), null, 'two 0.1 mm away is more than one dot');
  assert.equal(catalog.findBySize({ width: 1001, height: 601, pitch: 630, tolerance: 1.25 }).id, '100x60', 'a declared pitch still has to be the standard one');
  assert.equal(catalog.findBySize({ width: 1001, height: 601, pitch: 600, tolerance: 1.25 }), null);
  assert.equal(catalog.findBySize({ width: 1000, height: 601, pitch: null }), null, 'no tolerance: exact, and a null pitch never matched');
  assert.equal(catalog.findBySize({ width: 1000, height: 601, pitch: 630 }), null);
  assert.equal(catalog.findBySize({ width: null, height: null, pitch: null, tolerance: 1.25 }), null);
});

test('ZPL: a label of every standard size matches it at 203 and 300 dpi, as ^PW / ^LL in dots', () => {
  for (const dpi of [203, 300]) {
    for (const [w, h] of STANDARDS) {
      const text = zpl.applySize('^XA\r\n^XZ\r\n', { w: w * 10, h: h * 10, p: h * 10 + 30, dpi });
      const model = zpl.parse(text, { dpi });
      assert.ok(model.size.tolerance > 0, 'ZPL says how precise its size is');
      const match = selectedFor(zpl, text, dpi);
      assert.equal(match && match.id, `${w}x${h}`, `${w} x ${h} mm at ${dpi} dpi (${model.size.width} x ${model.size.height})`);
    }
  }
  assert.deepEqual(Object.keys(zpl.parse('^XA^PW799^LL480^XZ', { dpi: 203 }).size).sort(), ['gap', 'height', 'native', 'pitch', 'tolerance', 'width']);
});

test('ZPL: the 100 x 60 label of the example (^PW800 ^LL480) and a different size are told apart', () => {
  assert.equal(selectedFor(zpl, '^XA^PW799^LL480^XZ', 203).id, '100x60');
  assert.equal(selectedFor(zpl, '^XA^PW800^LL480^XZ', 203).id, '100x60', '100.1 x 60.1 is within a dot of 100 x 60');
  assert.equal(selectedFor(zpl, '^XA^PW812^LL480^XZ', 203), null, '101.6 mm is not a standard size');
  assert.equal(selectedFor(zpl, '^XA^PW799^XZ', 203), null, 'no length declared');
});

test('TPCL and TSPL keep the exact match: no tolerance, and a missing pitch or gap never matches', () => {
  assert.equal(tpcl.parse('{D0630,1000,0600|}').size.tolerance, undefined);
  assert.equal(tspl.parse('SIZE 100 mm,60 mm\nGAP 3 mm,0 mm').size.tolerance, undefined);
  assert.equal(selectedFor(tpcl, '{D0630,1000,0600|}', 203).id, '100x60');
  assert.equal(selectedFor(tpcl, '{D0630,1001,0600|}', 203), null);
  assert.equal(selectedFor(tpcl, '{D0630,1000,0601|}', 203), null);
  assert.equal(selectedFor(tspl, 'SIZE 100 mm,60 mm\nGAP 3 mm,0 mm', 203).id, '100x60');
  assert.equal(selectedFor(tspl, 'SIZE 100 mm,60 mm', 203), null, 'TSPL without a gap declares no pitch');
  assert.equal(selectedFor(tspl, 'SIZE 100.1 mm,60 mm\nGAP 3 mm,0 mm', 203), null);
});
