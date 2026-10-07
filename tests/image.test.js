const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// images.makeItem (core.js) is DOM-free; the image renderer (drawing.js) only builds markup, so both run in Node.
const PB = loadUpTo('js/drawing.js');

const base = { href: 'data:image/png;base64,AAAA', naturalW: 200, naturalH: 100, xMm: 0, yMm: 0, dpi: 203 };

test('images.makeItem: default size is natural pixels times the dot size, keeping the aspect ratio', () => {
  const item = PB.images.makeItem(base);
  assert.equal(item.kind, 'image');
  assert.equal(item.width, Math.round(200 * 254 / 203));
  assert.equal(item.height, Math.round(100 * 254 / 203));
  assert.equal(item.data, null);
  assert.equal(item.href, base.href);
  assert.ok(item.ref);
});

test('images.makeItem: the default size follows the resolution', () => {
  const at203 = PB.images.makeItem(base);
  const at300 = PB.images.makeItem({ ...base, dpi: 300 });
  assert.ok(at300.width < at203.width);
  assert.equal(at300.width, Math.round(200 * 254 / 300));
});

test('images.makeItem: position in mm is converted to 0.1 mm', () => {
  const item = PB.images.makeItem({ ...base, xMm: 12.5, yMm: '3,5' });
  assert.equal(item.x, 125);
  assert.equal(item.y, 35);
});

test('images.makeItem: a width in mm overrides the default and the height keeps the aspect ratio', () => {
  const item = PB.images.makeItem({ ...base, widthMm: 40 });
  assert.equal(item.width, 400);
  assert.equal(item.height, 200);
  const tall = PB.images.makeItem({ ...base, naturalW: 100, naturalH: 300, widthMm: 10 });
  assert.equal(tall.width, 100);
  assert.equal(tall.height, 300);
});

test('images.makeItem: empty or invalid inputs fall back to defaults', () => {
  const item = PB.images.makeItem({ ...base, xMm: '', yMm: NaN, widthMm: 0 });
  assert.equal(item.x, 0);
  assert.equal(item.y, 0);
  assert.equal(item.width, PB.images.makeItem(base).width);
  const blank = PB.images.makeItem({ ...base, widthMm: '' });
  assert.equal(blank.width, PB.images.makeItem(base).width);
});

test('validator: an image item has no "sin texto" warning, but a text without data still does', () => {
  const image = PB.images.makeItem(base);
  assert.deepEqual(PB.validator.validate({ items: [image] }, null), []);
  const text = { kind: 'text', ref: 'T1', data: null };
  assert.equal(PB.validator.validate({ items: [text] }, null).length, 1);
  assert.deepEqual(PB.variables.namesInModel({ items: [image] }), []);
});

const render = items => PB.svgRenderer.render(
  { items },
  { width: 990, height: 550 },
  { textScale: 1, showGrid: false, showAnchors: true, values: {} },
);

test('drawing: an image renders <image> and a hit rect of the same size, in model units', () => {
  const item = PB.images.makeItem({ ...base, xMm: 10, yMm: 5, widthMm: 40 });
  const { svg } = render([item]);
  assert.match(svg, /<image href="data:image\/png;base64,AAAA" x="100" y="50" width="400" height="200" preserveAspectRatio="none"\/>/);
  assert.match(svg, /<rect class="hit" x="100" y="50" width="400" height="200"/);
  assert.match(svg, /<circle class="origin" cx="100" cy="50"/);
});

test('drawing: the image reports its size in mm and is not reported as unknown', () => {
  const item = PB.images.makeItem({ ...base, widthMm: 40 });
  const { diagnostics } = render([item]);
  assert.equal(diagnostics.some(d => /desconocido/.test(d.text)), false);
  assert.ok(diagnostics.some(d => d.level === 'info' && /40 × 20 mm/.test(d.text)));
});

test('drawing: the href is escaped inside the attribute', () => {
  const item = { ...PB.images.makeItem(base), href: 'x" onload="alert(1)' };
  const { svg } = render([item]);
  assert.equal(svg.includes('onload="alert'), false);
  assert.match(svg, /href="x&quot; onload=&quot;alert\(1\)"/);
});
