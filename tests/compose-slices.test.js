const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo, manifest } = require('./helpers/load');

const PB = loadUpTo('js/components/compose.js');

const helpers = Object.freeze({ marker: 'helpers' });

test('compose.js loads right after the registry', () => {
  const files = manifest();
  assert.equal(files.indexOf('js/components/compose.js'), files.indexOf('js/components/registry.js') + 1);
});

test('composes only the slices that declare the language, calling each factory once with the helpers', () => {
  const calls = [];
  PB.components.register({ kind: 'cs-a', order: 2, label: 'A', languages: { xx: h => (calls.push(['a', h]), { handlers: ['ha'] }) } });
  PB.components.register({ kind: 'cs-b', order: 1, label: 'B', languages: { yy: () => ({ handlers: ['hb'] }) } });
  const out = PB.composeSlices('xx', helpers);
  assert.deepEqual(out.slices.map(s => s.id), ['cs-a']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], helpers);
  assert.deepEqual(out.handlers, ['ha']);
});

test('base lists come first, then the slices in order; entry shapes are kept', () => {
  PB.components.register({
    kind: 'cs-late', order: 20, label: 'Late', modelKind: 'late-model',
    languages: { zz: () => ({ handlers: ['h2'], coordinates: ['c2'], editable: ['e2'], rules: ['r2'], build: () => 'built' }) },
  });
  PB.components.register({
    kind: 'cs-early', order: 10, label: 'Early',
    languages: { zz: () => ({ handlers: ['h1'], coordinates: ['c1'], editable: ['e1'], rules: ['r1'] }) },
  });
  const base = { handlers: ['bh'], coordinates: ['bc'], movable: ['bm'], editable: ['be'], rules: ['br'] };
  const out = PB.composeSlices('zz', helpers, base);
  assert.deepEqual(out.handlers, ['bh', 'h1', 'h2']);
  assert.deepEqual(out.coordinates, ['bc', 'c1', 'c2']);
  assert.deepEqual(out.movable, ['bm', 'cs-early', 'late-model']);
  assert.deepEqual(out.editable, ['be', 'e1', 'e2']);
  assert.deepEqual(out.rules, ['br', 'r1', 'r2']);
  const [first] = out.slices;
  assert.deepEqual(Object.keys(first).sort(), ['hooks', 'id', 'label', 'modelKind', 'order']);
  assert.equal(first.modelKind, 'cs-early');
  assert.equal(out.slices[1].modelKind, 'late-model');
});

test('components only lists the slices with a build hook', () => {
  const out = PB.composeSlices('zz', helpers);
  assert.deepEqual(out.components, [{ kind: 'cs-late', label: 'Late' }]);
  assert.ok(Object.isFrozen(out.components));
});

test('an unknown language returns empty lists and a missing base is allowed', () => {
  const out = PB.composeSlices('nope', helpers);
  assert.deepEqual(out, { slices: [], handlers: [], coordinates: [], movable: [], editable: [], rules: [], components: [], emitters: {} });
});
