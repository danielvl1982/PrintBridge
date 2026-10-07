const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUpTo, manifest } = require('./helpers/load');

const ROOT = path.join(__dirname, '..');
const PB = loadUpTo('js/components/registry.js');

test('register stores a frozen copy retrievable with get', () => {
  const def = { kind: 'reg-a', label: 'A' };
  const stored = PB.components.register(def);
  assert.ok(Object.isFrozen(stored));
  assert.notEqual(stored, def);
  assert.equal(PB.components.get('reg-a'), stored);
  assert.equal(PB.components.get('reg-a').label, 'A');
  assert.equal(PB.components.get('nope'), undefined);
});

test('kinds keeps registration order and all returns the definitions', () => {
  PB.components.register({ kind: 'reg-b' });
  PB.components.register({ kind: 'reg-c' });
  const kinds = PB.components.kinds();
  assert.deepEqual(kinds.slice(-2), ['reg-b', 'reg-c']);
  assert.deepEqual(PB.components.all().map((d) => d.kind), kinds);
});

test('duplicate kind throws', () => {
  PB.components.register({ kind: 'reg-dup' });
  assert.throws(() => PB.components.register({ kind: 'reg-dup' }), /reg-dup/);
});

test('missing or non-string kind throws', () => {
  assert.throws(() => PB.components.register({}));
  assert.throws(() => PB.components.register({ kind: 3 }));
  assert.throws(() => PB.components.register(null));
});

test('index.html script order equals js/manifest.json and every file exists', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, manifest());
  for (const file of manifest()) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
});
