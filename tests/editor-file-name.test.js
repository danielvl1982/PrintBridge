'use strict';
// The editor reports the name of the file a label came from, so downloads can be named after it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/ui.js');

function fakeElement() {
  const listeners = {};
  return {
    value: '',
    files: [],
    classList: { add() {}, remove() {} },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    fire: (type, event = {}) => (listeners[type] || []).forEach(fn => fn({ preventDefault() {}, ...event })),
    click() {},
  };
}

function fakeFile(name, text) {
  const bytes = new TextEncoder().encode(text);
  return { name, arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

function setup() {
  const textarea = fakeElement();
  const fileInput = fakeElement();
  const opened = [];
  PB.ui.createEditor(textarea, { openButton: fakeElement(), fileInput }, { onEdit() {}, onOpen: (text, name) => opened.push({ text, name }) });
  return { textarea, fileInput, opened };
}

test('opening a file with the button passes its name to onOpen', async () => {
  const { fileInput, opened } = setup();
  fileInput.files = [fakeFile('etiquetas/caja 99.ter', '{D0610,0990,0550|}')];
  fileInput.fire('change');
  await settle();
  assert.deepEqual(opened, [{ text: '{D0610,0990,0550|}', name: 'etiquetas/caja 99.ter' }]);
});

test('dropping a file on the editor passes its name to onOpen', async () => {
  const { textarea, opened } = setup();
  textarea.fire('drop', { dataTransfer: { files: [fakeFile('rollo.prn', 'SIZE 100 mm,60 mm')] } });
  await settle();
  assert.deepEqual(opened, [{ text: 'SIZE 100 mm,60 mm', name: 'rollo.prn' }]);
});

test('pasting text calls onOpen without a file name', async () => {
  const { textarea, opened } = setup();
  textarea.value = 'SIZE 100 mm,60 mm';
  textarea.fire('paste');
  await settle();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].name, undefined);
});

test('app.js keeps the name and feeds it to the Convertir panel', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(app.includes('state.fileName'), 'the app keeps the opened file name');
  assert.ok(app.includes('getSourceName: () => state.fileName'), 'the convert panel reads it');
  assert.ok(!app.includes('getSourceName: () => undefined'), 'no hard-coded undefined any more');
});
