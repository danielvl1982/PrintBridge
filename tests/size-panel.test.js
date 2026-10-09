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
function withPanel(fn, withField = false) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => fakeElement(tag) } });
  try {
    const els = { select: fakeElement('select'), width: fakeElement('input'), height: fakeElement('input'), pitch: fakeElement('input') };
    if (withField) Object.assign(els, { pitchField: fakeElement('label'), pitchText: fakeElement('span') });
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

// label-gap G2: the pitch field follows the language (TPCL "Paso" = pitch, TSPL "Separación (GAP)" = gap, hidden for ZPL / none).

/** withPanel with the optional label wrapper and text of the pitch / gap field. */
function withLanguagePanel(fn) {
  withPanel(({ panel, els, applied }) => fn({ panel, els, applied }), true);
}

test('setLanguage: TPCL shows Paso with the pitch, TSPL shows Separación (GAP) with pitch - height, ZPL and no language hide it', () => {
  withLanguagePanel(({ panel, els }) => {
    panel.showArea(area(1000, 600, 630));
    panel.setLanguage('tpcl');
    assert.deepEqual([els.pitchText.textContent, els.pitch.value, els.pitchField.hidden], ['Paso', 63, false]);
    assert.match(els.pitchField.title, /Distancia entre el inicio/);
    panel.setLanguage('tspl');
    assert.deepEqual([els.pitchText.textContent, els.pitch.value, els.pitchField.hidden], ['Separación (GAP)', 3, false]);
    assert.match(els.pitchField.title, /GAP/);
    panel.showArea(area(1000, 600, null));
    assert.equal(els.pitch.value, '');
    for (const language of ['zpl', null]) {
      panel.setLanguage(language);
      assert.equal(els.pitchField.hidden, true, String(language));
    }
    panel.setLanguage('tpcl');
    assert.equal(els.pitchField.hidden, false);
  });
});

test('TSPL: editing the gap applies pitch = height + gap; an empty or zero gap applies pitch = height', () => {
  withLanguagePanel(({ panel, els, applied }) => {
    panel.setLanguage('tspl');
    panel.showArea(area(1000, 600, 630));
    els.pitch.type('4,5');
    els.pitch.commit();
    assert.deepEqual([applied[0].w, applied[0].h, applied[0].p], [1000, 600, 645]);
    els.pitch.commit('');
    assert.equal(applied[1].p, 600);
    els.pitch.commit('0');
    assert.equal(applied[2].p, 600);
  });
});

test('editing the height keeps the gap: TPCL moves the pitch, TSPL keeps the GAP', () => {
  withLanguagePanel(({ panel, els, applied }) => {
    panel.setLanguage('tpcl');
    panel.showArea(area(1000, 600, 630));
    els.height.commit('70');
    assert.deepEqual([applied[0].h, applied[0].p], [700, 730]);
    panel.setLanguage('tspl');
    panel.showArea(area(1000, 600, 630));
    els.height.commit('70');
    assert.deepEqual([applied[1].h, applied[1].p], [700, 730], 'height 70 + GAP 3 (the gap is pitch - height in the model)');
    panel.showArea(area(1000, 600, 630));
    els.width.commit('90');
    assert.deepEqual([applied[2].w, applied[2].h, applied[2].p], [900, 600, 630]);
  });
});

test('TPCL: editing the pitch writes it as typed; a label without gap keeps pitch = height when the height changes', () => {
  withLanguagePanel(({ panel, els, applied }) => {
    panel.setLanguage('tpcl');
    panel.showArea(area(1000, 600, 630));
    els.pitch.commit('65');
    assert.deepEqual([applied[0].h, applied[0].p], [600, 650]);
    panel.showArea(area(1000, 600, 600));
    els.height.commit('70');
    assert.deepEqual([applied[1].h, applied[1].p], [700, 700]);
  });
});

test('the combo sets the standard pitch (height + 3 mm) whatever the language', () => {
  withLanguagePanel(({ panel, els, applied }) => {
    panel.setLanguage('tspl');
    els.select.value = '100x60';
    els.select.fire('change');
    assert.deepEqual([applied[0].h, applied[0].p], [600, 630]);
  });
});

test('an input event on a field that is not the focused one (the browser undo reaching a typed edit) does not freeze that field', () => {
  withLanguagePanel(({ panel, els }) => {
    panel.setLanguage('tpcl');
    panel.showArea(area(1000, 600, 630));
    globalThis.document.activeElement = fakeElement('textarea');
    els.pitch.type('5');
    panel.showArea(area(1000, 600, 650));
    assert.equal(els.pitch.value, 65, 'the field follows the label');
    globalThis.document.activeElement = els.pitch;
    els.pitch.type('7');
    panel.showArea(area(1000, 600, 650));
    assert.equal(els.pitch.value, '7', 'the field being typed in is left alone');
  });
});
