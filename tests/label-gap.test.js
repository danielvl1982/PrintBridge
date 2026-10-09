const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// label-gap G1: pitch = height + gap, derived from each other when a label is read, carried between TPCL and TSPL.
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');
const tpcl = PB.languages.get('tpcl');
const TSPL = (gap, h = '60 mm') => `SIZE 100 mm,${h}\r\n${gap}DIRECTION 1\r\nCLS\r\nTEXT 40,100,"3",0,1,1,"Hi"\r\nPRINT 1,1\r\n`;
const pitchInfo = r => r.diagnostics.filter(d => /paso de etiqueta \(pitch\)/.test(d.text));

test('TSPL GAP g gives pitch = height + g; no GAP, GAP 0 or no height give no pitch', () => {
  const m = tspl.parse(TSPL('GAP 3 mm,0 mm\r\n')).size;
  assert.deepEqual([m.width, m.height, m.gap, m.pitch], [1000, 600, 30, 630]);
  assert.equal(tspl.parse(TSPL('')).size.pitch, null);
  assert.equal(tspl.parse(TSPL('GAP 0 mm,0 mm\r\n')).size.pitch, null);
  // GAP before SIZE reads the same
  assert.equal(tspl.parse('GAP 3 mm,0 mm\r\nSIZE 100 mm,60 mm\r\n').size.pitch, 630);
  assert.equal(tspl.parse('GAP 3 mm,0 mm\r\n').size.pitch, null);
});

test('TPCL pitch p gives gap = p - height only when p > height', () => {
  const a = tpcl.parse('{D0630,1000,0600|}').size;
  assert.deepEqual([a.pitch, a.gap], [630, 30]);
  const b = tpcl.parse('{D0600,1000,0600|}').size;
  assert.deepEqual([b.pitch, b.gap], [600, null]);
});

test('the emitters write each language form from either value', () => {
  const model = (size) => ({ language: 'neutral', size: { width: 1000, height: 600, pitch: null, gap: null, native: {}, ...size }, items: [], diagnostics: [] });
  assert.match(PB.languages.emit('tpcl', model({ gap: 30 }), { dpi: 203 }).text, /^\{D0630,1000,0600\|\}/);
  assert.match(PB.languages.emit('tpcl', model({ pitch: 630 }), { dpi: 203 }).text, /^\{D0630,1000,0600\|\}/);
  assert.match(PB.languages.emit('tspl', model({ pitch: 630 }), { dpi: 203 }).text, /GAP 3 mm,0 mm/);
  assert.match(PB.languages.emit('tspl', model({ gap: 30 }), { dpi: 203 }).text, /GAP 3 mm,0 mm/);
  assert.ok(!/GAP/.test(PB.languages.emit('tspl', model({ pitch: 600 }), { dpi: 203 }).text));
});

for (const dpi of [203, 300]) {
  test(`TSPL -> TPCL at ${dpi} dpi writes the pitch height + GAP without a word about it`, () => {
    const r = PB.convert.run(TSPL('GAP 3 mm,0 mm\r\n'), 'tpcl', { dpi });
    assert.match(r.text, /^\{D0630,1000,0600\|\}/);
    assert.equal(pitchInfo(r).length, 0);
    assert.deepEqual([tpcl.parse(r.text, { dpi }).size.pitch, tpcl.parse(r.text, { dpi }).size.gap], [630, 30]);
  });

  test(`TPCL -> TSPL at ${dpi} dpi writes GAP = pitch - height without a word about it`, () => {
    const r = PB.convert.run('{D0630,1000,0600|}{C|}{XS;I,0001,0002C4100|}', 'tspl', { dpi });
    assert.match(r.text, /GAP 3 mm,0 mm/);
    assert.ok(!r.diagnostics.some(d => /GAP/.test(d.text)));
    assert.equal(tspl.parse(r.text, { dpi }).size.pitch, 630);
  });
}

test('a TSPL label without GAP still reports the default pitch in TPCL, and pitch = height writes no GAP in TSPL (as before)', () => {
  assert.equal(pitchInfo(PB.convert.run(TSPL(''), 'tpcl', { dpi: 203 })).length, 1);
  const r = PB.convert.run('{D0600,1000,0600|}{C|}{XS;I,0001,0002C4100|}', 'tspl', { dpi: 203 });
  assert.ok(!/GAP/m.test(r.text.replace(/No se escribe GAP/, '')));
});

test('ZPL target still warns once that the pitch / gap are not written', () => {
  const r = PB.convert.run(TSPL('GAP 3 mm,0 mm\r\n'), 'zpl', { dpi: 203 });
  assert.equal(r.diagnostics.filter(d => /ZPL solo declara el ancho y el largo/.test(d.text)).length, 1);
});
