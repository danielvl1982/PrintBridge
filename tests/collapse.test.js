'use strict';
// Collapsible sections (js/collapse.js) on a minimal fake DOM, plus the structural contract of index.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/collapse.js');

function el(name, parent) {
  const classes = new Set();
  const attrs = {};
  const listeners = {};
  const node = {
    name,
    parentElement: parent || null,
    classList: {
      add: c => classes.add(c),
      toggle: c => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)),
      contains: c => classes.has(c),
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: k => attrs[k],
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    fire: (type, event = {}) => (listeners[type] || []).forEach(fn => fn({ preventDefault() {}, ...event })),
    querySelector: () => node.found || null,
  };
  return node;
}

function fixture() {
  const container = el('section');
  const head = el('div', container);
  const title = el('h2', head);
  container.found = title;
  return { container, head, title };
}

test('makeCollapsible marks the head, makes the title a button and starts expanded', () => {
  const { container, head, title } = fixture();
  assert.equal(PB.ui.makeCollapsible(container), title);
  assert.ok(head.classList.contains('collapse-head'));
  assert.equal(title.getAttribute('role'), 'button');
  assert.equal(title.getAttribute('tabindex'), '0');
  assert.equal(title.getAttribute('aria-expanded'), 'true');
  assert.ok(!container.classList.contains('is-collapsed'));
});

test('clicking the title toggles the collapsed state and aria-expanded', () => {
  const { container, title } = fixture();
  PB.ui.makeCollapsible(container);
  title.fire('click');
  assert.ok(container.classList.contains('is-collapsed'));
  assert.equal(title.getAttribute('aria-expanded'), 'false');
  title.fire('click');
  assert.ok(!container.classList.contains('is-collapsed'));
  assert.equal(title.getAttribute('aria-expanded'), 'true');
});

test('Enter and Space toggle, other keys do not', () => {
  const { container, title } = fixture();
  PB.ui.makeCollapsible(container);
  title.fire('keydown', { key: 'a' });
  assert.ok(!container.classList.contains('is-collapsed'));
  title.fire('keydown', { key: 'Enter' });
  assert.ok(container.classList.contains('is-collapsed'));
  title.fire('keydown', { key: ' ' });
  assert.ok(!container.classList.contains('is-collapsed'));
});

test('a container without a title is left alone', () => {
  const container = el('section');
  assert.equal(PB.ui.makeCollapsible(container), null);
});

test('initCollapsible wires every [data-collapsible] container of the root', () => {
  const a = fixture();
  const b = fixture();
  const root = { querySelectorAll: selector => (selector === '[data-collapsible]' ? [a.container, b.container] : []) };
  PB.ui.initCollapsible(root);
  assert.equal(a.title.getAttribute('role'), 'button');
  assert.equal(b.title.getAttribute('role'), 'button');
});

function memoryStorage(initial) {
  const data = { ...initial };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

test('toggling saves the collapsed state of that section in storage', () => {
  const { container, title } = fixture();
  container.setAttribute('data-collapsible', 'code');
  const storage = memoryStorage();
  PB.ui.makeCollapsible(container, storage);
  title.fire('click');
  assert.deepEqual(JSON.parse(storage.data[PB.ui.COLLAPSE_STORAGE_KEY]), { code: true });
  title.fire('click');
  assert.deepEqual(JSON.parse(storage.data[PB.ui.COLLAPSE_STORAGE_KEY]), { code: false });
});

test('a saved collapsed state is restored on start', () => {
  const { container, title } = fixture();
  container.setAttribute('data-collapsible', 'view');
  const storage = memoryStorage({ [PB.ui.COLLAPSE_STORAGE_KEY]: JSON.stringify({ view: true }) });
  PB.ui.makeCollapsible(container, storage);
  assert.ok(container.classList.contains('is-collapsed'));
  assert.equal(title.getAttribute('aria-expanded'), 'false');
});

test('broken or throwing storage never breaks the toggle', () => {
  const { container, title } = fixture();
  container.setAttribute('data-collapsible', 'code');
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  PB.ui.makeCollapsible(container, bad);
  title.fire('click');
  assert.ok(container.classList.contains('is-collapsed'));
  const garbage = memoryStorage({ [PB.ui.COLLAPSE_STORAGE_KEY]: '{not json' });
  const other = fixture();
  other.container.setAttribute('data-collapsible', 'code');
  PB.ui.makeCollapsible(other.container, garbage);
  assert.ok(!other.container.classList.contains('is-collapsed'));
});

test('data-collapsed-default: collapsed when storage has no entry, an explicit stored choice wins, broken storage uses the default', () => {
  const make = (storage) => {
    const f = fixture();
    f.container.setAttribute('data-collapsible', 'variables');
    f.container.setAttribute('data-collapsed-default', '');
    PB.ui.makeCollapsible(f.container, storage);
    return f;
  };
  const key = PB.ui.COLLAPSE_STORAGE_KEY;
  const none = make(memoryStorage());
  assert.ok(none.container.classList.contains('is-collapsed'));
  assert.equal(none.title.getAttribute('aria-expanded'), 'false');
  assert.ok(make(null).container.classList.contains('is-collapsed'), 'no storage at all');
  assert.ok(make(memoryStorage({ [key]: JSON.stringify({ code: false }) })).container.classList.contains('is-collapsed'), 'other keys do not count');
  assert.ok(!make(memoryStorage({ [key]: JSON.stringify({ variables: false }) })).container.classList.contains('is-collapsed'), 'stored false expands');
  assert.ok(make(memoryStorage({ [key]: JSON.stringify({ variables: true }) })).container.classList.contains('is-collapsed'), 'stored true collapses');
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.ok(make(bad).container.classList.contains('is-collapsed'), 'throwing storage');
  assert.ok(make(memoryStorage({ [key]: '{not json' })).container.classList.contains('is-collapsed'), 'corrupt storage');
});

test('a section without data-collapsed-default still starts expanded', () => {
  const { container } = fixture();
  container.setAttribute('data-collapsible', 'code');
  PB.ui.makeCollapsible(container, memoryStorage());
  assert.ok(!container.classList.contains('is-collapsed'));
});

test('index.html: the Variables section declares it starts collapsed', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<section class="panel" data-collapsible="variables" data-collapsed-default>/);
});

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const tagOf = marker => {
  const i = html.indexOf(marker);
  assert.ok(i >= 0, marker + ' not found');
  return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1);
};

test('the editor, variables, convert, format, view, components and properties sections are collapsible', () => {
  for (const marker of ['class="panel" data-collapsible="code"', 'data-collapsible="variables"', 'id="convert"', 'class="size-row"', 'class="view-row"', 'class="strip"', 'id="propsPanel"']) {
    assert.ok(tagOf(marker).includes('data-collapsible'), marker);
  }
});

test('the label preview and the warnings are never collapsible', () => {
  assert.ok(!tagOf('class="panel preview"').includes('data-collapsible'));
  assert.ok(!tagOf('class="panel msgs-panel"').includes('data-collapsible'));
});

test('js/collapse.js is in the manifest after js/convert-panel.js and before js/app.js', () => {
  const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'js', 'manifest.json'), 'utf8'));
  assert.ok(files.indexOf('js/collapse.js') > files.indexOf('js/convert-panel.js'));
  assert.ok(files.indexOf('js/collapse.js') < files.indexOf('js/app.js'));
});
