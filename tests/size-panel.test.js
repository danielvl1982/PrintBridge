const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// size-from-label T2: the Formato row (PB.ui.createSizePanel) on a minimal fake DOM.
const PB = loadUpTo('js/ui.js');
const catalog = PB.sizes.createCatalog(PB.config.sizes);

/** Fake element: properties, children and manual event dispatch. */
function fakeElement(tagName = 'div') {
  const listeners = {};
  const el = {
    tagName: String(tagName).toUpperCase(), children: [], value: '', textContent: '', disabled: false,
    replaceChildren(...nodes) { el.children = [...nodes]; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { (listeners[type] || []).forEach(fn => fn()); },
    /** Simulates the user typing: sets the value and fires input. */
    type(value) { el.value = value; el.fire('input'); },
    /** Simulates leaving the field: fires change. */
    commit(value) { if (value !== undefined) el.value = value; el.fire('change'); },
  };
  return el;
}

/** Runs fn with a fake document and a panel built on fake elements; applied sizes are collected in `applied`. */
function withPanel(fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => fakeElement(tag) } });
  try {
    const els = { select: fakeElement('select'), width: fakeElement('input'), height: fakeElement('input'), pitch: fakeElement('input') };
    const applied = [];
    const panel = PB.ui.createSizePanel(els, catalog, { onApply: size => applied.push(size) });
    panel.init();
    fn({ panel, els, applied });
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
}

const area = (width, height, pitch) => ({ width, height, pitch });

test('init: the combo lists the standard sizes then Personalizado, with no "Según la etiqueta"', () => {
  withPanel(({ els }) => {
    const texts = els.select.children.map(o => o.textContent);
    assert.deepEqual(texts, [...catalog.all().map(s => s.name), 'Personalizado…']);
    assert.ok(!texts.some(t => /Según la etiqueta|obligatorio/.test(t)));
    assert.equal(els.select.children.at(-1).value, 'custom');
    assert.equal(els.select.children[0].value, '100x150');
  });
});

test('the fields show the declared size in mm and are always enabled', () => {
  withPanel(({ panel, els }) => {
    panel.showArea(area(990, 550, 610));
    assert.deepEqual([els.width.value, els.height.value, els.pitch.value], [99, 55, 61]);
    panel.showArea(area(990, 550, null));
    assert.equal(els.pitch.value, '');
    for (const f of [els.width, els.height, els.pitch]) assert.equal(f.disabled, false);
  });
});

test('change on a field calls onApply with the custom size resolved to 0.1 mm', () => {
  withPanel(({ panel, els, applied }) => {
    panel.showArea(area(990, 550, 610));
    els.width.type('100,5');
    assert.equal(applied.length, 0, 'typing alone writes nothing');
    els.width.commit();
    assert.equal(applied.length, 1);
    assert.deepEqual([applied[0].w, applied[0].h, applied[0].p], [1005, 550, 610]);
  });
});

test('an empty pitch means pitch = height', () => {
  withPanel(({ panel, els, applied }) => {
    panel.showArea(area(990, 550, 610));
    els.pitch.commit('');
    assert.deepEqual([applied[0].w, applied[0].h, applied[0].p], [990, 550, 550]);
  });
});

test('invalid or non-positive input reverts the fields to the label values and writes nothing', () => {
  withPanel(({ panel, els, applied }) => {
    panel.showArea(area(990, 550, 610));
    for (const [field, bad] of [[els.width, '0'], [els.height, '-3'], [els.width, 'abc'], [els.height, ''], [els.pitch, '-1']]) {
      field.type(bad);
      field.commit();
      assert.deepEqual([els.width.value, els.height.value, els.pitch.value], [99, 55, 61], `${bad}`);
    }
    assert.equal(applied.length, 0);
  });
});

test('picking a standard size calls onApply with it; picking Personalizado writes nothing', () => {
  withPanel(({ els, applied }) => {
    els.select.value = '100x60';
    els.select.fire('change');
    assert.equal(applied.length, 1);
    assert.deepEqual([applied[0].w, applied[0].h, applied[0].p], [1000, 600, 630]);
    els.select.value = 'custom';
    els.select.fire('change');
    assert.equal(applied.length, 1);
  });
});

test('selectFor marks the standard equal to the declared size, else Personalizado', () => {
  withPanel(({ panel, els }) => {
    panel.selectFor({ width: 1000, height: 600, pitch: 630 });
    assert.equal(els.select.value, '100x60');
    panel.selectFor({ width: 990, height: 550, pitch: 610 });
    assert.equal(els.select.value, 'custom');
    panel.selectFor({ width: 1000, height: 600, pitch: 600 });
    assert.equal(els.select.value, 'custom');
    panel.selectFor({ width: 1000, height: 600, pitch: 630 });
    panel.selectFor({ width: null, height: null, pitch: null });
    assert.equal(els.select.value, 'custom');
  });
});

test('showArea never overwrites a field the user is editing', () => {
  withPanel(({ panel, els }) => {
    panel.showArea(area(990, 550, 610));
    els.width.type('12');
    panel.showArea(area(1000, 600, 630));
    assert.equal(els.width.value, '12', 'the edited field keeps the typed text');
    assert.deepEqual([els.height.value, els.pitch.value], [60, 63], 'the others follow the label');
    els.width.commit();
    panel.showArea(area(1000, 600, 630));
    assert.equal(els.width.value, 100, 'after leaving the field it follows the label again');
  });
});

test('selectFor does not touch the fields', () => {
  withPanel(({ panel, els }) => {
    panel.showArea(area(990, 550, 610));
    els.height.type('7');
    panel.selectFor({ width: 1000, height: 600, pitch: 630 });
    assert.deepEqual([els.width.value, els.height.value, els.pitch.value], [99, '7', 61]);
  });
});

test('selectFor marks the standard size for a size known to within a dot (ZPL 100.0 x 60.1 mm, no pitch), and only then', () => {
  withPanel(({ panel, els }) => {
    panel.selectFor({ width: 1000, height: 601, pitch: null, tolerance: 1.25 });
    assert.equal(els.select.value, '100x60');
    panel.selectFor({ width: 1000, height: 601, pitch: null });
    assert.equal(els.select.value, 'custom', 'an exact size does not get the tolerance');
    panel.selectFor({ width: 1000, height: 603, pitch: null, tolerance: 1.25 });
    assert.equal(els.select.value, 'custom');
  });
});
