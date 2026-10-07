const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// size-from-label T1: language-agnostic catalog, no forced size, TPCL writes only {D...|}.
const PB = loadUpTo('js/languages/tspl.js');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');

const STANDARDS = [[100, 150], [100, 100], [100, 60], [80, 50], [60, 40], [50, 30], [40, 30]];

test('catalog: the seven standard sizes, pitch = height + 3, ids from the dimensions', () => {
  const all = PB.sizes.createCatalog(PB.config.sizes).all();
  assert.deepEqual(all.map(s => [s.w, s.h]), STANDARDS);
  for (const s of all) {
    assert.equal(s.p, s.h + 3, s.id);
    assert.equal(s.id, `${s.w}x${s.h}`);
    assert.equal(s.name, `${s.w}×${s.h} mm`);
  }
});

test('catalog: no required flag, no native language data, no spool entry', () => {
  for (const s of PB.config.sizes) {
    assert.equal('required' in s, false, s.id);
    assert.equal('native' in s, false, s.id);
  }
  assert.equal(PB.sizes.createCatalog(PB.config.sizes).get('spool-99x55'), null);
});

test('catalog: findBySize matches a declared size (0.1 mm) with the standard pitch', () => {
  const catalog = PB.sizes.createCatalog(PB.config.sizes);
  assert.equal(catalog.findBySize({ pitch: 630, width: 1000, height: 600 }).id, '100x60');
  assert.equal(catalog.findBySize({ pitch: 600, width: 1000, height: 600 }), null);
  assert.equal(catalog.findBySize({ pitch: null, width: null, height: null }), null);
});

test('sizes.view follows the size the label declares and never reports a mismatch', () => {
  const model = tpcl.parse('{D0610,0990,0550|}\n{C|}');
  const v = PB.sizes.view(model);
  assert.deepEqual([v.width, v.height, v.pitch], [990, 550, 610]);
  assert.deepEqual(v.diagnostics, []);
  assert.deepEqual(PB.sizes.view(tspl.parse('SIZE 100 mm,60 mm')).diagnostics, []);
});

test('sizes.view ignores any second argument: there is no forced size', () => {
  const model = tpcl.parse('{D0500,0900,0500|}');
  const forced = PB.sizes.resolve({ w: 99, h: 55, p: 61 });
  const v = PB.sizes.view(model, forced);
  assert.deepEqual([v.width, v.height, v.pitch], [900, 500, 500]);
  assert.deepEqual(v.diagnostics, []);
});

test('sizes.view without a declared size uses the fallback and points to the Formato row', () => {
  const v = PB.sizes.view(tpcl.parse('{PC001;0010,0010,05,05,J,00,B=A|}'));
  assert.deepEqual([v.width, v.height, v.pitch], [990, 550, null]);
  assert.equal(v.diagnostics.length, 1);
  assert.equal(v.diagnostics[0].level, 'warning');
  assert.match(v.diagnostics[0].text, /Formato/);
  assert.doesNotMatch(v.diagnostics[0].text, /Tamaño etiqueta/);
});

test('tpcl: no matchesSize hook, sizeCommands is only {D...|}', () => {
  assert.equal(tpcl.matchesSize, undefined);
  assert.equal(tspl.matchesSize, undefined);
  const size = PB.sizes.resolve({ w: 100, h: 60, p: 63 });
  assert.deepEqual(tpcl.sizeCommands(size), ['{D0630,1000,0600|}']);
});

test('tpcl applySize writes only {D...|} and leaves an existing {AX...|} untouched', () => {
  const size = PB.sizes.resolve({ w: 100, h: 60, p: 63 });
  const out = tpcl.applySize('{D0500,0900,0500|}\n{AX;+001,+000,+00|}\n{C|}', size);
  assert.equal(out, '{D0630,1000,0600|}\n{AX;+001,+000,+00|}\n{C|}');
  assert.equal(tpcl.applySize(out, size), out);
});

test('tpcl applySize adds {D...|} when missing and never invents an {AX...|}', () => {
  const size = PB.sizes.resolve({ w: 100, h: 60, p: 63 });
  assert.equal(tpcl.applySize('{C|}', size), '{D0630,1000,0600|}\n{C|}');
  assert.equal(PB.sizes.apply(tpcl, '{C|}', size).text, '{D0630,1000,0600|}\n{C|}');
});

test('examples no longer force a size', () => {
  for (const e of PB.examples) assert.equal('sizeId' in e, false, e.id);
});

test('declaredPitch: TSPL derives pitch = height + gap for display, the parsed model keeps pitch null', () => {
  const model = tspl.parse('SIZE 100 mm,60 mm\nGAP 3 mm,0 mm');
  assert.equal(model.size.pitch, null);
  assert.equal(PB.sizes.declaredPitch(model.size), 630);
  assert.equal(PB.sizes.view(model).pitch, 630);
});

test('declaredPitch: an explicit pitch wins, and no pitch and no gap stays null', () => {
  assert.equal(PB.sizes.declaredPitch({ width: 1000, height: 600, pitch: 610, gap: 30 }), 610);
  assert.equal(PB.sizes.declaredPitch({ width: 1000, height: 600, pitch: null, gap: null }), null);
  assert.equal(PB.sizes.declaredPitch({ width: null, height: null, pitch: null, gap: 30 }), null);
});

test('findBySize matches a TSPL label of a standard size once the display pitch is derived', () => {
  const catalog = PB.sizes.createCatalog(PB.config.sizes);
  const model = tspl.parse('SIZE 100 mm,60 mm\nGAP 3 mm,0 mm');
  const match = catalog.findBySize({ ...model.size, pitch: PB.sizes.declaredPitch(model.size) });
  assert.equal(match && match.id, '100x60');
});
