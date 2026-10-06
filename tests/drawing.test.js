const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// drawing.js: render does not touch the DOM, so it can be tested in Node (the layout.analyze part cannot)
const PB = load(['js/lib/qrcode-generator.min.js', 'js/config.js', 'js/core.js', 'js/languages/tpcl.js', 'js/barcodes.js', 'js/view.js', 'js/drawing.js']);
const example = PB.examples[0];
const tpcl = PB.languages.get('tpcl');

const draw = (src, { dpi = 203, area = PB.sizes.resolve(PB.config.sizes[0]), values = example.values, model } = {}) => {
  const m = model || tpcl.parse(src, { dpi });
  const view = PB.sizes.view(m, area);
  return PB.svgRenderer.render(m, view, { textScale: 1, showGrid: false, showAnchors: false, values });
};
const count = (svg, re) => (svg.match(re) || []).length;

test('drawing reference spool: dimensions, texts and QR', () => {
  const { svg, diagnostics } = draw(example.source);
  assert.match(svg, /viewBox="-30 -30 1050 610"/);
  assert.equal(count(svg, /<text /g), 13);
  assert.equal(count(svg, /<g class="item"/g), 14);
  assert.equal(count(svg, /<rect class="hit" x="700" y="160"/g), 1);
  assert.equal(count(svg, /<rect class="not-generated"/g), 0);
  assert.match(diagnostics[0].text, /^XB01: QR \d+×\d+ módulos = /);
});

test('drawing reference spool: the QR changes size with the resolution, the positions do not', () => {
  const side = dpi => Number(draw(example.source, { dpi }).svg.match(/<rect class="hit" x="700" y="160" width="([\d.]+)"/)[1]);
  assert.ok(side(300) < side(203));
});

test('drawing: Code128, line and rectangle', () => {
  const src = '{XB02;0100,0200,9,0,03,0,0100,0,000,1,00|}{RB02;>8AB|}{LC;0100,0100,0500,0300,1,03|}{LC;0100,0400,0500,0400,0,03|}';
  const { svg } = draw(src, { area: null });
  assert.equal(count(svg, /<g transform="rotate\(0 100 200\)">/g), 1);
  assert.match(svg, /<path d="M100 200h/);
  assert.equal(count(svg, /<rect x="100" y="100" width="400" height="200" class="stroke"/g), 1);
  assert.equal(count(svg, /<line x1="100" y1="400" x2="500" y2="400"/g), 1);
  assert.match(svg, />AB<\/text>/);
  assert.equal(svg.includes('\u001d'), false);
});

test('drawing: the barcode type name comes from symbology', () => {
  const info = type => draw(`{XB02;0100,0200,${type},0,03,0,0100,0,000,0,00|}{RB02;AB|}`, { area: null }).diagnostics[0].text;
  assert.match(info('9'), /^XB02: Code128: /);
  assert.match(info('Z'), /^XB02: Código de barras \(aprox\.\): /);
});

test('drawing: an unknown item type is skipped with a warning and without throwing', () => {
  const model = { language: 'x', size: { width: 500, height: 300, pitch: null, gap: null, native: {} }, items: [{ kind: 'hologram', ref: 'H1' }], diagnostics: [] };
  const { svg, diagnostics } = draw(null, { model, area: null });
  assert.equal(count(svg, /<g class="item"/g), 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].level, 'warning');
  assert.match(diagnostics[0].text, /H1.*hologram/);
});

test('drawing: an item without source is drawn without a tooltip', () => {
  const model = tpcl.parse('{PC001;0010,0100,05,05,J,00,B=A|}', { dpi: 203 });
  const withSource = draw(null, { model, area: null }).svg;
  assert.match(withSource, /<title>\{PC001;0010,0100,05,05,J,00,B=A\|\}<\/title>/);
  delete model.items[0].source;
  const without = draw(null, { model, area: null }).svg;
  assert.equal(without.includes('<title>'), false);
  assert.equal(count(without, /<g class="item"/g), 1);
});
