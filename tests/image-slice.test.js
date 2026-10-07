const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tpcl.js');
const tpcl = PB.languages.get('tpcl');

test('image registers as a slice with palette entry, renderer and a TPCL hook factory', () => {
  const image = PB.components.get('image');
  assert.ok(image);
  assert.deepEqual([image.label, image.glyph, image.order, image.carriesData], ['Imagen', '🖼', 60, false]);
  assert.equal(typeof image.render, 'function');
  assert.equal(typeof image.languages.tpcl, 'function');
  assert.equal(PB.components.forItem({ kind: 'image', ref: 'SG1' }).kind, 'image');
});

test('PB.images keeps its public name and lives in the slice', () => {
  for (const name of ['bitmapToNibble', 'nibbleToBitmap', 'buildSG', 'targetDots', 'thresholdFromPercent', 'downscaleSteps',
    'thresholdRGBA', 'makeBitmapItem', 'makeItem']) {
    assert.equal(typeof PB.images[name], 'function', name);
  }
});

test('image is the last slice but not a language template (the app adds its palette entry)', () => {
  assert.deepEqual(PB.components.kinds(), ['text', 'barcode', 'qr', 'line', 'box', 'image']);
  assert.deepEqual(tpcl.componentTemplates().map(c => c.kind), ['text', 'barcode', 'qr', 'line', 'box']);
  const text = '{D0300,0500,0400|}\n';
  assert.equal(tpcl.buildComponent(text, 'image', { x: 10, y: 10 }), text);
});

test('an SG command is parsed and moved through the image slice hooks', () => {
  const src = '{SG;0010,0020,8,1,0,00|}';
  const model = tpcl.parse(src);
  assert.deepEqual(model.items.map(i => [i.ref, i.kind]), [['SG1', 'image']]);
  assert.equal(tpcl.moveItem(src, model.items[0], 10, 0, { dpi: 203 }), '{SG;0020,0020,8,1,0,00|}');
  assert.deepEqual(tpcl.describeItem(model.items[0], src), { kind: 'image', fields: [] });
});

test('images carry no data command, so the "no content" rule skips them', () => {
  const model = tpcl.parse('{SG;0010,0020,8,1,0,00|}');
  assert.deepEqual(PB.validator.validate(model, tpcl), []);
});
