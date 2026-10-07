const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo, manifest } = require('./helpers/load');

const PB = loadUpTo('js/languages/tspl.js');
const fs = require('node:fs');
const path = require('node:path');

const base = { name: 'Fake', detect: () => false, parse: () => ({ items: [] }) };

test('emit.js loads after units and diagnostics, before the languages, and index.html matches', () => {
  const files = manifest();
  const i = files.indexOf('js/core/emit.js');
  assert.ok(i > files.indexOf('js/core/units.js'));
  assert.ok(i > files.indexOf('js/core/diagnostics.js'));
  assert.ok(i < files.indexOf('js/languages/tpcl.js'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="js/core/emit.js"></script>'));
});

test('shapeProblem rejects a non-function emit and accepts a function or none', () => {
  assert.throws(() => PB.languages.register({ ...base, id: 'ec-bad', emit: 'x' }), /emit must be a function/);
  PB.languages.register({ ...base, id: 'ec-none' });
  PB.languages.register({ ...base, id: 'ec-ok', emit: () => ({ text: 'T', diagnostics: [{ level: 'info', text: 'x' }] }) });
  assert.ok(PB.languages.get('ec-ok'));
});

test('PB.languages.emit normalizes the result and passes model and options', () => {
  let seen;
  PB.languages.register({ ...base, id: 'ec-norm', emit: (m, o) => { seen = [m, o]; return {}; } });
  PB.languages.register({ ...base, id: 'ec-str', emit: () => ({ text: 5, diagnostics: 'no' }) });
  const model = { items: [] };
  assert.deepEqual(PB.languages.emit('ec-norm', model, { dpi: 203 }), { text: '', diagnostics: [] });
  assert.equal(seen[0], model);
  assert.deepEqual(seen[1], { dpi: 203 });
  assert.deepEqual(PB.languages.emit('ec-str', model), { text: '5', diagnostics: [] });
});

test('PB.languages.emit throws for an unknown language or one without emit', () => {
  assert.throws(() => PB.languages.emit('ec-missing', { items: [] }), /ec-missing/);
  assert.throws(() => PB.languages.emit('ec-none', { items: [] }), /ec-none/);
});

test('composeSlices returns emitters only for slices that declare emit, keyed by id', () => {
  const fn = () => 'LINE';
  PB.components.register({ kind: 'ec-a', order: 1, label: 'A', languages: { ecx: () => ({ emit: fn }) } });
  PB.components.register({ kind: 'ec-b', order: 2, label: 'B', languages: { ecx: () => ({ handlers: [] }) } });
  const out = PB.composeSlices('ecx', {});
  assert.deepEqual(Object.keys(out.emitters), ['ec-a']);
  assert.equal(out.emitters['ec-a'], fn);
  assert.deepEqual(PB.composeSlices('nope', {}).emitters, {});
});

test('dots and mm10 round at 203 and 300 dpi', () => {
  assert.equal(PB.emit.dots(0, 203), 0);
  assert.equal(PB.emit.dots(254, 203), 203);
  assert.equal(PB.emit.dots(100, 203), 80); // 79.92
  assert.equal(PB.emit.dots(100, 300), 118); // 118.11
  assert.equal(PB.emit.mm10(203, 203), 254);
  assert.equal(PB.emit.mm10(80, 203), 100);
  assert.equal(PB.emit.mm10(118, 300), 100);
});

test('escapeQuotes uses the TSPL escape', () => {
  assert.equal(PB.emit.escapeQuotes('say "hi"'), 'say \\["]hi\\["]');
  assert.equal(PB.emit.escapeQuotes('plain'), 'plain');
});

test('createIds gives unique zero-padded ids per namespace', () => {
  const ids = PB.emit.createIds();
  assert.equal(ids.next('PC'), '00');
  assert.equal(ids.next('PC'), '01');
  assert.equal(ids.next('XB'), '00');
  const many = PB.emit.createIds();
  for (let i = 0; i < 9; i++) many.next('A');
  assert.equal(many.next('A'), '09');
  assert.equal(many.next('A'), '10');
  assert.equal(many.next('B'), '00');
});

test('createContext exposes dpi, dot, report, diagnostics, ids and once', () => {
  const ctx = PB.emit.createContext({ dpi: 300, language: 'ecx' });
  assert.equal(ctx.dpi, 300);
  assert.equal(ctx.language, 'ecx');
  assert.equal(ctx.dot(100), 118);
  ctx.report({ level: 'info', text: 'a' });
  assert.deepEqual(ctx.diagnostics, [{ level: 'info', text: 'a' }]);
  assert.equal(ctx.ids.next('PC'), '00');
  let runs = 0;
  ctx.once('k', () => { runs++; return { level: 'warning', text: 'w' }; });
  ctx.once('k', () => { runs++; return { level: 'warning', text: 'w' }; });
  ctx.once('other', () => ({ level: 'warning', text: 'o' }));
  assert.equal(runs, 1);
  assert.deepEqual(ctx.diagnostics.map(d => d.text), ['a', 'w', 'o']);
});

test('run collects string and array lines in item order, skipping empty ones', () => {
  PB.components.register({ kind: 'ec-run-s', order: 100, label: 'S' });
  PB.components.register({ kind: 'ec-run-a', order: 101, label: 'A' });
  PB.components.register({ kind: 'ec-run-e', order: 102, label: 'E' });
  const composed = {
    emitters: {
      'ec-run-s': item => 'S' + item.n,
      'ec-run-a': (item, ctx) => { ctx.report({ level: 'info', text: 'from a' }); return ['A1', '', 'A2']; },
      'ec-run-e': () => '',
    },
  };
  const model = { items: [{ kind: 'ec-run-s', n: 1 }, { kind: 'ec-run-a' }, { kind: 'ec-run-e' }, { kind: 'ec-run-s', n: 2 }] };
  const ctx = PB.emit.createContext({ dpi: 203, language: 'ecx' });
  const out = PB.emit.run(model, composed, ctx);
  assert.deepEqual(out.lines, ['S1', 'A1', 'A2', 'S2']);
  assert.deepEqual(out.diagnostics, [{ level: 'info', text: 'from a' }]);
});

test('run warns once per item without a slice or an emitter and continues', () => {
  PB.components.register({ kind: 'ec-run-n', order: 103, label: 'N' });
  PB.components.register({ kind: 'ec-run-ok', order: 104, label: 'OK' });
  const composed = { emitters: { 'ec-run-ok': () => 'OK' } };
  const model = { items: [{ kind: 'ec-run-n' }, { kind: 'ghost' }, { kind: 'ec-run-ok' }] };
  const ctx = PB.emit.createContext({ dpi: 203, language: 'ecx' });
  const out = PB.emit.run(model, composed, ctx);
  assert.deepEqual(out.lines, ['OK']);
  assert.deepEqual(out.diagnostics, [
    { level: 'warning', text: 'No se puede exportar el elemento ec-run-n: sin emisor para ecx' },
    { level: 'warning', text: 'No se puede exportar el elemento ghost: sin emisor para ecx' },
  ]);
});
