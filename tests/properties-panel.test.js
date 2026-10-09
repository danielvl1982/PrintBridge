const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// Properties panel (properties.js): only the pure coercion of form input is testable without a DOM.
const PB = loadUpTo('js/properties.js');
const { coerceFieldValue } = PB.ui;

test('number fields: dot and comma decimals become numbers', () => {
  const field = { type: 'number', value: 1 };
  assert.equal(coerceFieldValue(field, '12'), 12);
  assert.equal(coerceFieldValue(field, '12.5'), 12.5);
  assert.equal(coerceFieldValue(field, '12,5'), 12.5);
});

test('number fields: empty or non numeric input is rejected', () => {
  const field = { type: 'number', value: 1 };
  assert.equal(coerceFieldValue(field, ''), undefined);
  assert.equal(coerceFieldValue(field, '  '), undefined);
  assert.equal(coerceFieldValue(field, 'abc'), undefined);
});

test('select fields: the matching option value is returned with its original type', () => {
  const field = { type: 'select', value: 0, options: [{ value: 0, label: '0°' }, { value: 90, label: '90°' }, { value: 'box', label: 'Caja' }] };
  assert.equal(coerceFieldValue(field, '90'), 90);
  assert.equal(coerceFieldValue(field, 'box'), 'box');
  assert.equal(coerceFieldValue(field, '45'), undefined);
});

test('checkbox fields: the checked state is returned as a boolean', () => {
  const field = { type: 'checkbox', value: false };
  assert.equal(coerceFieldValue(field, true), true);
  assert.equal(coerceFieldValue(field, false), false);
});

test('text fields: the string is returned as is (empty allowed, no trimming, no number parsing)', () => {
  const field = { type: 'text', value: 'a' };
  assert.equal(coerceFieldValue(field, '12,5'), '12,5');
  assert.equal(coerceFieldValue(field, ''), '');
  assert.equal(coerceFieldValue(field, '  x, y  '), '  x, y  ');
  assert.equal(coerceFieldValue(field, 5), undefined);
});

test('text fields: the panel renders a text input with its maxLength and notifies the typed string on change', () => {
  const listeners = {};
  const fake = tag => ({
    tagName: tag, dataset: {}, children: [], append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, fn) { listeners[type] = fn; }, contains: () => false, querySelector: () => null,
  });
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: fake, activeElement: null } });
  try {
    const els = { empty: fake('p'), title: fake('h'), form: fake('form'), overlay: fake('div') };
    const calls = [];
    PB.ui.createPropertiesPanel(els, { onChange: (key, value) => calls.push([key, value]) })
      .show({ kind: 'text', fields: [{ key: 'content', label: 'Contenido', type: 'text', value: 'Hola', maxLength: 20 }] });
    const input = els.form.children[0].children[1];
    assert.equal(input.type, 'text');
    assert.equal(input.value, 'Hola');
    assert.equal(input.maxLength, 20);
    assert.equal(input.dataset.key, 'content');
    input.value = '';
    listeners.change();
    assert.deepEqual(calls, [['content', '']]);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
});

test('radio fields: like a select, the matching option value is returned and anything else is rejected', () => {
  const field = { type: 'radio', value: 'bitmap', options: [{ value: 'bitmap', label: 'Mapa de bits (PC)' }, { value: 'vector', label: 'Vectorial (PV)' }] };
  assert.equal(coerceFieldValue(field, 'vector'), 'vector');
  assert.equal(coerceFieldValue(field, 'other'), undefined);
});

test('radio fields: the panel renders one radio input per option in a group, checks the current one, and notifies only the option chosen', () => {
  const listeners = new Map();
  const fake = tag => {
    const el = {
      tagName: tag, dataset: {}, attributes: {}, children: [], append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, fn) { listeners.set(el, { ...listeners.get(el), [type]: fn }); }, contains: () => false, querySelector: () => null,
    };
    return el;
  };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: fake, activeElement: null } });
  try {
    const els = { empty: fake('p'), title: fake('h'), form: fake('form'), overlay: fake('div') };
    const calls = [];
    PB.ui.createPropertiesPanel(els, { onChange: (key, value) => calls.push([key, value]) }).show({
      kind: 'text',
      fields: [{
        key: 'fontType', label: 'Tipo de fuente', type: 'radio', value: 'bitmap', note: 'una nota',
        options: [{ value: 'bitmap', label: 'Mapa de bits (PC)' }, { value: 'vector', label: 'Vectorial (PV)' }],
      }],
    });
    const group = els.form.children[0];
    assert.equal(group.tagName, 'div');
    assert.equal(group.attributes.role, 'radiogroup');
    assert.equal(group.children[0].textContent, 'Tipo de fuente');
    const choices = group.children[1].children;
    assert.deepEqual(choices.map(c => c.children[1].textContent), ['Mapa de bits (PC)', 'Vectorial (PV)']);
    const [bitmap, vector] = choices.map(c => c.children[0]);
    assert.deepEqual([bitmap.type, bitmap.checked, vector.checked, bitmap.name === vector.name, vector.dataset.key], ['radio', true, false, true, 'fontType']);
    assert.equal(group.children[2].textContent, 'una nota');
    // A radio only notifies when it is the one checked
    vector.checked = false;
    listeners.get(vector).change();
    assert.deepEqual(calls, []);
    vector.checked = true;
    listeners.get(vector).change();
    assert.deepEqual(calls, [['fontType', 'vector']]);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
});
