const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo, shippedExamples } = require('./helpers/load');

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

// example-templates T2: the combo is grouped with <optgroup>s from the optional `group` of each example.
/** Like withPicker but with the given examples; also exposes the flat list of options (the ones inside groups too). */
function withGroupedPicker(examples, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => fakeElement(tag) } });
  try {
    const select = fakeElement('select');
    const picked = [];
    PB.ui.createExamplePicker(select, examples, { onPick: example => picked.push(example) });
    const options = select.children.flatMap(node => (node.tagName === 'OPTGROUP' ? node.children : [node]));
    fn({ select, picked, options });
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
}

const GROUPED = [
  { id: 'x1', name: 'No group' },
  { id: 'b1', name: 'Blank 1', group: 'blank' },
  { id: 's1', name: 'Template 1', group: 'template' },
  { id: 'b2', name: 'Blank 2', group: 'blank' },
];

test('examples with a group are listed under one optgroup per group, in the fixed order En blanco, Plantillas', () => {
  withGroupedPicker(GROUPED, ({ select }) => {
    const groups = select.children.filter(node => node.tagName === 'OPTGROUP');
    assert.deepEqual(groups.map(g => g.label), ['En blanco', 'Plantillas']);
    assert.deepEqual(groups.map(g => g.children.map(o => o.value)), [['b1', 'b2'], ['s1']]);
  });
});

test('the placeholder stays first and an example without group goes last, outside any optgroup', () => {
  withGroupedPicker(GROUPED, ({ select }) => {
    assert.equal(select.children[0].tagName, 'OPTION');
    assert.equal(select.children[0].disabled, true);
    const last = select.children[select.children.length - 1];
    assert.equal(last.tagName, 'OPTION');
    assert.deepEqual([last.value, last.textContent], ['x1', 'No group']);
  });
});

test('a group with no examples gets no optgroup', () => {
  withGroupedPicker([{ id: 's1', name: 'Template 1', group: 'template' }], ({ select }) => {
    assert.deepEqual(select.children.filter(n => n.tagName === 'OPTGROUP').map(g => g.label), ['Plantillas']);
  });
});

test('picking an example from inside a group loads it and returns to the placeholder', () => {
  withGroupedPicker(GROUPED, ({ select, picked }) => {
    select.pick('b2');
    assert.deepEqual(picked, [GROUPED[3]]);
    assert.equal(select.value, '');
  });
});

test('the shipped examples: the En blanco and Plantillas groups, three each, and no example outside them', () => {
  const shipped = shippedExamples();
  withGroupedPicker(shipped, ({ select, options }) => {
    const groups = select.children.filter(node => node.tagName === 'OPTGROUP');
    assert.deepEqual(groups.map(g => [g.label, g.children.length]), [['En blanco', 3], ['Plantillas', 3]]);
    assert.equal(options.length, shipped.length + 1);
    assert.equal(select.children[select.children.length - 1].tagName, 'OPTGROUP', 'nothing outside the groups');
  });
});
