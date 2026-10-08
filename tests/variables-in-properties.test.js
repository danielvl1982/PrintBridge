const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// Test values of the variables, edited from the properties of the selected object (properties.js).
const PB = loadUpTo('js/properties.js');
const { variableFieldsFor } = PB.ui;

const item = data => ({ data });
const model = (...datas) => ({ items: datas.map(item) });

test('variableFieldsFor: one entry per variable of the item, in order of appearance, with its value', () => {
  const it = item('#ROLLNUM# / <#TOTALROLLS#> #ROLLNUM#');
  const fields = variableFieldsFor(it, model(it.data), { ROLLNUM: '3', TOTALROLLS: '10' });
  assert.deepEqual(fields, [
    { name: 'ROLLNUM', value: '3', usedIn: 1 },
    { name: 'TOTALROLLS', value: '10', usedIn: 1 },
  ]);
});

test('variableFieldsFor: an undefined value is shown as an empty string', () => {
  const it = item('#A#');
  assert.deepEqual(variableFieldsFor(it, model('#A#'), {}), [{ name: 'A', value: '', usedIn: 1 }]);
});

test('variableFieldsFor: usedIn counts the objects of the model that use the variable', () => {
  const a = item('#X# #Y#');
  const m = model(a.data, '#X#', 'plain', '#X#');
  assert.deepEqual(variableFieldsFor(a, m, { X: 'x' }), [
    { name: 'X', value: 'x', usedIn: 3 },
    { name: 'Y', value: '', usedIn: 1 },
  ]);
});

test('variableFieldsFor: no variables (or no data) gives no fields', () => {
  assert.deepEqual(variableFieldsFor(item('plain'), model('plain'), {}), []);
  assert.deepEqual(variableFieldsFor({}, { items: [{}] }, {}), []);
  assert.deepEqual(variableFieldsFor(null, model('#A#'), {}), []);
});

/** Fake DOM: elements keep their own listeners, so each control can be driven. */
function withFakeDom(run) {
  const fake = tag => ({
    tagName: tag, dataset: {}, children: [], listeners: {},
    append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, fn) { this.listeners[type] = fn; }, contains: () => false, querySelector: () => null,
  });
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: fake, activeElement: null } });
  try {
    const els = { empty: fake('p'), title: fake('h'), form: fake('form'), overlay: fake('div') };
    run(els);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
}

const textField = { key: 'content', label: 'Contenido', type: 'text', value: '#A#' };
const flat = el => [el, ...(el.children || []).flatMap(c => (typeof c === 'object' ? flat(c) : []))];

test('the form gets a test-values section after the language fields: title, one labelled text input per variable, note when shared', () => {
  withFakeDom(els => {
    const panel = PB.ui.createPropertiesPanel(els, { onChange() {}, onValueChange() {} });
    panel.show({ kind: 'text', fields: [textField] }, [{ name: 'A', value: '5', usedIn: 3 }, { name: 'B', value: '', usedIn: 1 }]);
    assert.equal(els.form.children.length, 2);
    const section = els.form.children[1];
    const all = flat(section);
    const texts = all.map(e => e.textContent).filter(Boolean);
    assert.ok(texts.includes('Valores de prueba (solo vista previa)'));
    assert.ok(texts.includes('Valor de A'));
    assert.ok(texts.includes('Valor de B'));
    assert.ok(texts.includes('usada en 3 objetos'));
    assert.equal(texts.filter(t => t.startsWith('usada en')).length, 1, 'no note for a variable used once');
    const inputs = all.filter(e => e.tagName === 'input');
    assert.deepEqual(inputs.map(i => i.dataset.key), ['var:A', 'var:B']);
    assert.deepEqual(inputs.map(i => i.type), ['text', 'text']);
    assert.deepEqual(inputs.map(i => i.value), ['5', '']);
  });
});

test('no variables: no test-values section', () => {
  withFakeDom(els => {
    const panel = PB.ui.createPropertiesPanel(els, { onChange() {}, onValueChange() {} });
    panel.show({ kind: 'text', fields: [textField] }, []);
    assert.equal(els.form.children.length, 1);
    panel.show({ kind: 'text', fields: [textField] });
    assert.equal(els.form.children.length, 1);
  });
});

test('editing a test value calls onValueChange with the raw string (no number parsing) and never onChange', () => {
  withFakeDom(els => {
    const changes = [];
    const values = [];
    const panel = PB.ui.createPropertiesPanel(els, { onChange: (k, v) => changes.push([k, v]), onValueChange: (n, v) => values.push([n, v]) });
    panel.show({ kind: 'text', fields: [textField] }, [{ name: 'A', value: '', usedIn: 1 }]);
    const input = flat(els.form.children[1]).find(e => e.tagName === 'input');
    input.value = '12,50';
    input.listeners.change();
    input.value = '';
    input.listeners.change();
    assert.deepEqual(values, [['A', '12,50'], ['A', '']]);
    assert.deepEqual(changes, []);
  });
});

test('an object with variables but no editable fields still shows the test values', () => {
  withFakeDom(els => {
    const panel = PB.ui.createPropertiesPanel(els, { onChange() {}, onValueChange() {} });
    panel.show({ kind: 'text', fields: [] }, [{ name: 'A', value: '', usedIn: 1 }]);
    assert.equal(els.form.hidden, false);
    assert.equal(els.empty.hidden, true);
  });
});
