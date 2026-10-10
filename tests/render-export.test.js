const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUpTo, manifest } = require('./helpers/load');

// js/render-export.js: the pure parts (pixel size, agent query, editor chrome rule, CSS in step with css/label.css).
// toPng itself needs a browser (DOMParser, Image, canvas): it is checked with the Chrome probe, see odd/tasks/print-image.md.
const PB = loadUpTo('js/render-export.js');
const { renderExport } = PB;
const ROOT = path.join(__dirname, '..');

test('pixelSize: round(mm / 25.4 * dpi) on each side', () => {
  assert.deepEqual(renderExport.pixelSize(25.4, 50.8, 300), { width: 300, height: 600 });
  assert.deepEqual(renderExport.pixelSize(100, 60, 300), { width: 1181, height: 709 });
  assert.deepEqual(renderExport.pixelSize(100, 60, 203), { width: 799, height: 480 });
  assert.deepEqual(renderExport.pixelSize(0.1, 0.1, 72), { width: 1, height: 1 }); // never a zero side
});

test('pixelSize rejects sizes and resolutions out of range, in Spanish', () => {
  for (const [w, h] of [[0, 10], [10, 0], [-1, 10], [NaN, 10], [10, Infinity], ['10', 10]]) {
    assert.throws(() => renderExport.pixelSize(w, h, 300), /tamaño de la etiqueta/);
  }
  for (const dpi of [71, 1201, NaN, 0, '300']) assert.throws(() => renderExport.pixelSize(10, 10, dpi), /resolución debe estar entre 72 y 1200/);
});

test('pixelSize limits a side to 16384 px and the area to 100 megapixels, naming the limit', () => {
  assert.throws(() => renderExport.pixelSize(1000, 10, 1200), /16384 px por lado/); // 47244 px
  assert.throws(() => renderExport.pixelSize(450, 450, 600), /100 megapíxeles/); // 10630 x 10630 = 113 MP
});

test('pixelSize accepts a side exactly at the limit and an area just under 100 MP', () => {
  // 16384 px at 1200 dpi is 346.77 mm: 346.7 mm rounds to 16380 px
  assert.equal(renderExport.pixelSize(346.7, 10, 1200).width, 16380);
  assert.deepEqual(renderExport.pixelSize(200, 200, 1200), { width: 9449, height: 9449 }); // 89.3 MP
});

const base = { printer: 'Zebra ZD420', widthMm: 100, heightMm: 60, dpi: 300 };

test('imageQuery builds the query string the agent parses, with defaults', () => {
  const params = new URLSearchParams(renderExport.imageQuery(base));
  assert.deepEqual(Object.fromEntries(params), { printer: 'Zebra ZD420', widthMm: '100', heightMm: '60', dpi: '300', offsetXmm: '0', offsetYmm: '0', copies: '1', paper: 'default' });
  const full = new URLSearchParams(renderExport.imageQuery({ ...base, widthMm: 99.5, offsetXmm: -2.5, offsetYmm: 1.25, copies: 3, paper: 'label' }));
  assert.equal(full.get('widthMm'), '99.5');
  assert.equal(full.get('offsetXmm'), '-2.5');
  assert.equal(full.get('copies'), '3');
  assert.equal(full.get('paper'), 'label');
});

test('imageQuery encodes the printer name and never writes an exponent', () => {
  const query = renderExport.imageQuery({ ...base, printer: 'HP & Co #1', widthMm: 1e-7 + 10, offsetXmm: 0.0000001 });
  assert.equal(new URLSearchParams(query).get('printer'), 'HP & Co #1');
  assert.ok(!/e[+-]?\d/i.test(query.replace(/printer=[^&]*/, '')));
  assert.equal(new URLSearchParams(query).get('offsetXmm'), '0');
});

test('imageQuery uses the agent ranges (agent/printbridge-agent.js parseImageQuery), including the edges', () => {
  const ok = patch => renderExport.imageQuery({ ...base, ...patch });
  ok({ widthMm: 1000, heightMm: 1000, dpi: 72 });
  ok({ dpi: 1200, offsetXmm: 100, offsetYmm: -100, copies: 99 });
  const bad = (patch, pattern) => assert.throws(() => ok(patch), pattern);
  bad({ printer: '' }, /Elige una impresora/);
  bad({ printer: undefined }, /Elige una impresora/);
  bad({ widthMm: 0 }, /ancho/);
  bad({ widthMm: 1000.1 }, /ancho/);
  bad({ heightMm: -5 }, /alto/);
  bad({ dpi: 71 }, /resolución/);
  bad({ dpi: 1201 }, /resolución/);
  bad({ offsetXmm: 100.1 }, /desplazamiento X/);
  bad({ offsetYmm: -100.1 }, /desplazamiento Y/);
  bad({ copies: 0 }, /copias/);
  bad({ copies: 100 }, /copias/);
  bad({ copies: 1.5 }, /entero/);
  bad({ widthMm: NaN }, /ancho/);
  bad({ paper: 'a4' }, /papel/);
});

test('the ranges of imageQuery match the constants of the agent source', () => {
  const agent = fs.readFileSync(path.join(ROOT, 'agent', 'printbridge-agent.js'), 'utf8');
  const constant = name => Number(new RegExp(`const ${name} = (\\d+)`).exec(agent)[1]);
  const query = patch => renderExport.imageQuery({ ...base, ...patch });
  assert.doesNotThrow(() => query({ widthMm: constant('MAX_SIZE_MM'), offsetXmm: constant('MAX_OFFSET_MM'), copies: constant('MAX_COPIES') }));
  assert.throws(() => query({ widthMm: constant('MAX_SIZE_MM') + 1 }));
  assert.throws(() => query({ offsetXmm: constant('MAX_OFFSET_MM') + 1 }));
  assert.throws(() => query({ copies: constant('MAX_COPIES') + 1 }));
  assert.match(agent, /dpi: \{ min: 72, max: 1200/);
});

test('editor chrome (grid, origin points, hit / selection areas, overlap marks) is stripped, label content is not', () => {
  for (const name of ['hit', 'grid-line', 'grid-text', 'origin', 'overlaps', 'overlap', 'drop-target']) {
    assert.equal(renderExport.isEditorChrome(name), true, name);
  }
  assert.equal(renderExport.isEditorChrome('item sel hit'), true);
  assert.equal(renderExport.isEditorChrome(['item', 'movable']), false);
  for (const name of ['item', 'label-background', 'font-sans bold', 'human-readable', 'stroke', 'attr-fill', 'view-rotation', '', undefined]) {
    assert.equal(renderExport.isEditorChrome(name), false, String(name));
  }
  for (const name of renderExport.CHROME_CLASSES) assert.ok(renderExport.CHROME_SELECTOR.includes(`.${name}`));
  assert.ok(renderExport.CHROME_SELECTOR.includes('title'));
});

test('every class the viewer draws for the editor only is in the chrome list', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'label.css'), 'utf8');
  for (const name of ['hit', 'grid-line', 'grid-text', 'origin', 'overlap', 'drop-target']) assert.match(css, new RegExp(`\\.${name}\\b`));
  const source = fs.readFileSync(path.join(ROOT, 'js', 'drawing.js'), 'utf8');
  assert.match(source, /class="overlaps"/);
});

test('the printed drawing is the label alone and upright: viewBox 0 0 width height, no pad, no view rotation', () => {
  assert.equal(renderExport.labelViewBox(1000, 600), '0 0 1000 600');
  // The viewer's own viewBox adds a pad and swaps the sides at 90 / 270; the export never uses it
  const shown = PB.viewRotation.viewBoxFor(1000, 600, 90, 30);
  assert.notEqual(`${shown.x} ${shown.y} ${shown.width} ${shown.height}`, renderExport.labelViewBox(1000, 600));
  const source = fs.readFileSync(path.join(ROOT, 'js', 'render-export.js'), 'utf8');
  assert.match(source, /\.view-rotation/);
  assert.match(source, /removeAttribute\('transform'\)/);
});

/** Rules of a stylesheet as normalized "selector { declarations }" strings. */
const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => `${m[1].trim().replace(/\s+/g, ' ')} { ${m[2].trim().replace(/\s+/g, ' ')} }`);

test('the CSS inlined in the PNG matches css/label.css, except the label border that is a screen aid', () => {
  const sheet = rules(fs.readFileSync(path.join(ROOT, 'css', 'label.css'), 'utf8'));
  const inlined = rules(renderExport.LABEL_CSS.join('\n'));
  const border = '.label-background { fill: #fff; stroke: none; }';
  for (const rule of inlined) {
    if (rule === border) continue;
    assert.ok(sheet.includes(rule), `not in css/label.css: ${rule}`);
  }
  assert.ok(sheet.includes('.label-background { fill: #fff; stroke: #333; stroke-width: 3; }'));
  // The three typefaces and the text styles of the viewer are all there
  for (const selector of ['.font-serif', '.font-sans', '.font-mono', '.bold', '.italic', '.human-readable', 'text.attr-reverse']) {
    assert.ok(inlined.some(rule => rule.startsWith(selector + ' ')), selector);
  }
});

test('js/render-export.js is in index.html and the manifest, after the print panel', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(scripts.indexOf('js/render-export.js') > scripts.indexOf('js/print-panel.js'));
  assert.ok(scripts.indexOf('js/render-export.js') < scripts.indexOf('js/app.js'));
  assert.deepEqual(scripts, manifest());
});
