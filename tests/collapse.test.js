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
