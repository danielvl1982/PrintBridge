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
