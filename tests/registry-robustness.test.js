const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tpcl.js');
const tpcl = PB.languages.get('tpcl');
const valid = id => ({ id, name: `Language ${id}`, detect: () => false, parse: () => ({ language: id, items: [], diagnostics: [] }) });

test('registry: rejects duplicate ids with a clear message', () => {
  assert.throws(() => PB.languages.register(valid('tpcl')), /duplicate.*"tpcl"/i);
  assert.equal(PB.languages.all().filter(l => l.id === 'tpcl').length, 1);
});

test('registry: validates the shape of the language', () => {
  const bad = [
    null,
    { ...valid('a'), id: undefined },
    { ...valid('a'), id: '' },
    { ...valid('a'), name: 5 },
    { ...valid('a'), detect: 'x' },
    { ...valid('a'), parse: null },
  ];
  for (const language of bad) assert.throws(() => PB.languages.register(language), /language/i, JSON.stringify(language));
  assert.equal(PB.languages.get('a'), null);
});

test('registry: a valid language is registered and retrieved', () => {
  PB.languages.register(valid('simple'));
  assert.equal(PB.languages.get('simple').name, 'Language simple');
});

test('detect: a text that no language recognizes gives null', () => {
  assert.equal(PB.languages.detect('plain text without commands'), null);
  assert.equal(PB.languages.detect(''), null);
});

test('sizes: apply without applySize leaves the text unchanged and says so', () => {
  const size = PB.sizes.resolve(PB.config.sizes[0]);
  const text = '^XA^FDhello^FS^XZ';
  assert.deepEqual(PB.sizes.apply(PB.languages.get('simple'), text, size), { text, supported: false });
  assert.deepEqual(PB.sizes.apply(null, text, size), { text, supported: false });
});

test('sizes: apply with applySize returns the written text', () => {
  const size = PB.sizes.resolve(PB.config.sizes[0]);
  const out = PB.sizes.apply(tpcl, '{C|}', size);
  assert.equal(out.supported, true);
  assert.match(out.text, /^\{D0610,0990,0550\|\}/);
});
