const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// example-on-select T1: the Ejemplo combo (PB.ui.createExamplePicker) on a minimal fake DOM.
const PB = loadUpTo('js/ui.js');

/** Fake element: properties, children and manual event dispatch. */
function fakeElement(tagName = 'div') {
  const listeners = {};
  const el = {
    tagName: String(tagName).toUpperCase(), children: [], value: '', textContent: '', disabled: false,
    replaceChildren(...nodes) { el.children = [...nodes]; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { (listeners[type] || []).forEach(fn => fn()); },
    /** Simulates the user picking an option. */
    pick(value) { el.value = value; el.fire('change'); },
  };
  return el;
}

const EXAMPLES = [{ id: 'a', name: 'Example A' }, { id: 'b', name: 'Example B' }];

/** Runs fn with a fake document and a picker; picked examples are collected in `picked`. */
function withPicker(fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => fakeElement(tag) } });
  try {
    const select = fakeElement('select');
    const picked = [];
    PB.ui.createExamplePicker(select, EXAMPLES, { onPick: example => picked.push(example) });
    fn({ select, picked });
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
}

test('the combo starts with a disabled placeholder that is the shown value', () => {
  withPicker(({ select }) => {
    const first = select.children[0];
    assert.equal(first.textContent, 'Elegir ejemplo…');
    assert.equal(first.value, '');
    assert.equal(first.disabled, true);
    assert.equal(select.value, '');
  });
});

test('after the placeholder there is one option per example with its id and name', () => {
  withPicker(({ select }) => {
    assert.equal(select.children.length, EXAMPLES.length + 1);
    assert.deepEqual(select.children.slice(1).map(o => [o.value, o.textContent]), EXAMPLES.map(e => [e.id, e.name]));
  });
});

test('picking an example loads it and the combo returns to the placeholder', () => {
  withPicker(({ select, picked }) => {
    select.pick('b');
    assert.deepEqual(picked, [EXAMPLES[1]]);
    assert.equal(select.value, '');
  });
});

test('picking the same example twice loads it twice', () => {
  withPicker(({ select, picked }) => {
    select.pick('a');
    select.pick('a');
    assert.deepEqual(picked, [EXAMPLES[0], EXAMPLES[0]]);
  });
});

test('the placeholder or an unknown value loads nothing', () => {
  withPicker(({ select, picked }) => {
    select.pick('');
    select.pick('nope');
    assert.deepEqual(picked, []);
    assert.equal(select.value, '');
  });
});
