const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// tspl-small-fixes T2: `GAP 0 mm,0 mm` is written when the TSPL gap is emptied or typed as 0 in the Formato row (the manual allows 0 <= m <= 1 inch),
// and never invented when the gap was not specified. The neutral size already tells them apart: size.gap is 0 for `GAP 0` and null when unknown.
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');
const catalog = PB.sizes.createCatalog(PB.config.sizes);

const doc = (...lines) => lines.map(l => l + '\r\n').join('');
const WITH_GAP = doc('SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm', 'DIRECTION 1', 'CLS', 'TEXT 40,100,"3",0,1,1,"Hi"', 'PRINT 1,1');
const ZERO_GAP = WITH_GAP.replace('GAP 3 mm', 'GAP 0 mm');
const NO_GAP = doc('SIZE 100 mm,60 mm', 'DIRECTION 1', 'CLS', 'TEXT 40,100,"3",0,1,1,"Hi"', 'PRINT 1,1');

// ---- the writer

const size = (w, h, p, extra) => ({ w: w * 10, h: h * 10, p: p === undefined ? h * 10 : p * 10, ...extra });

test('sizeCommands: an explicit zero gap writes GAP 0; pitch == height alone still writes no GAP', () => {
  assert.deepEqual(tspl.sizeCommands(size(100, 60, undefined, { zeroGap: true })), ['SIZE 100 mm,60 mm', 'GAP 0 mm,0 mm']);
  assert.deepEqual(tspl.sizeCommands(size(100, 60)), ['SIZE 100 mm,60 mm']);
  // a real gap wins over the flag
  assert.deepEqual(tspl.sizeCommands(size(100, 60, 63, { zeroGap: true })), ['SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm']);
  assert.deepEqual(tspl.sizeCommands(size(100, 60, undefined, { zeroGap: false })), ['SIZE 100 mm,60 mm']);
});

test('applySize: GAP 0 replaces an existing GAP line, is added after SIZE when missing, and is idempotent', () => {
  const zero = size(100, 60, undefined, { zeroGap: true });
  assert.equal(tspl.applySize(WITH_GAP, zero), ZERO_GAP);
  assert.equal(tspl.applySize(NO_GAP, zero), NO_GAP.replace('DIRECTION', 'GAP 0 mm,0 mm\r\nDIRECTION'));
  assert.equal(tspl.applySize(ZERO_GAP, zero), ZERO_GAP);
});

test('applySize without the flag leaves an existing GAP alone (the gap was not edited)', () => {
  assert.equal(tspl.applySize(WITH_GAP, size(100, 60)), WITH_GAP);
  assert.equal(tspl.applySize(NO_GAP, size(100, 60)), NO_GAP);
  assert.equal(tspl.applySize(ZERO_GAP, size(90, 60)), ZERO_GAP.replace('SIZE 100 mm', 'SIZE 90 mm'));
});

test('the Formato row path (PB.sizes.apply) carries the flag through fitSize', () => {
  const out = PB.sizes.apply(tspl, WITH_GAP, size(100, 60, undefined, { zeroGap: true }));
  assert.equal(out.text, ZERO_GAP);
});

// ---- the Formato row

function fakeElement(tagName = 'div') {
  const listeners = {};
  const el = {
    tagName: String(tagName).toUpperCase(), children: [], value: '', textContent: '', disabled: false,
    replaceChildren(...nodes) { el.children = [...nodes]; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { (listeners[type] || []).forEach(fn => fn()); },
    commit(value) { if (value !== undefined) el.value = value; el.fire('change'); },
  };
  return el;
}

function withPanel(language, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => fakeElement(tag) } });
  try {
    const els = { select: fakeElement('select'), width: fakeElement('input'), height: fakeElement('input'), pitch: fakeElement('input'), pitchField: fakeElement('label'), pitchText: fakeElement('span') };
    const applied = [];
    const panel = PB.ui.createSizePanel(els, catalog, { onApply: s => applied.push(s) });
    panel.init();
    panel.setLanguage(language);
    fn({ panel, els, applied });
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
}
const area = (width, height, pitch) => ({ width, height, pitch });

test('TSPL row: emptying the gap or typing 0 flags an explicit zero gap', () => {
  withPanel('tspl', ({ panel, els, applied }) => {
    panel.showArea(area(1000, 600, 630));
    els.pitch.commit('');
    assert.deepEqual([applied[0].h, applied[0].p, applied[0].zeroGap], [600, 600, true]);
    panel.showArea(area(1000, 600, 630));
    els.pitch.commit('0');
    assert.deepEqual([applied[1].p, applied[1].zeroGap], [600, true]);
    panel.showArea(area(1000, 600, 630));
    els.pitch.commit('0,0');
    assert.equal(applied[2].zeroGap, true);
  });
});

test('TSPL row: a gap that was never specified is not invented when the width or the height is edited, or the empty field is left', () => {
  withPanel('tspl', ({ panel, els, applied }) => {
    panel.showArea(area(1000, 600, null));
    els.width.commit('90');
    els.height.commit('70');
    els.pitch.commit('');
    assert.equal(applied.length, 3);
    for (const a of applied) assert.ok(!a.zeroGap, JSON.stringify(a));
    // ... but typing a 0 there is an explicit decision
    panel.showArea(area(1000, 600, null));
    els.pitch.commit('0');
    assert.equal(applied[3].zeroGap, true);
  });
});

test('TSPL row: a real gap, the combo and the other languages never set the flag', () => {
  withPanel('tspl', ({ panel, els, applied }) => {
    panel.showArea(area(1000, 600, 630));
    els.pitch.commit('4');
    els.width.commit('90');
    els.select.value = '100x60';
    els.select.fire('change');
    for (const a of applied) assert.ok(!a.zeroGap, JSON.stringify(a));
  });
  withPanel('tpcl', ({ panel, els, applied }) => {
    panel.showArea(area(1000, 600, 630));
    els.pitch.commit('');
    els.pitch.commit('60');
    for (const a of applied) assert.ok(!a.zeroGap, JSON.stringify(a));
  });
});

test('end to end: the zero gap of the row rewrites the GAP line of the label; the neutral size reads back as gap 0 and no pitch', () => {
  withPanel('tspl', ({ panel, els, applied }) => {
    panel.showArea(area(1000, 600, 630));
    els.pitch.commit('0');
    const text = PB.sizes.apply(tspl, WITH_GAP, applied[0]).text;
    assert.equal(text, ZERO_GAP);
    const parsed = tspl.parse(text).size;
    assert.deepEqual([parsed.gap, parsed.pitch], [0, null]);
  });
});

// ---- conversions: an explicit zero gap is neither lost nor invented

test('TSPL GAP 0 -> TSPL keeps the line; no GAP stays without one', () => {
  assert.match(PB.convert.run(ZERO_GAP, 'tspl', { dpi: 203 }).text, /^SIZE 100 mm,60 mm\r\nGAP 0 mm,0 mm\r\n/);
  assert.ok(!/GAP/.test(PB.convert.run(NO_GAP, 'tspl', { dpi: 203 }).text));
});

for (const dpi of [203, 300]) {
  test(`TSPL GAP 0 -> TPCL writes pitch = height and back writes no GAP, at ${dpi} dpi`, () => {
    const tpcl = PB.convert.run(ZERO_GAP, 'tpcl', { dpi });
    assert.match(tpcl.text, /^\{D0600,1000,0600\|\}/);
    const parsed = PB.languages.get('tpcl').parse(tpcl.text).size;
    assert.deepEqual([parsed.pitch, parsed.gap], [600, null]);
    const back = PB.convert.run(tpcl.text, 'tspl', { dpi });
    assert.ok(!/GAP/.test(back.text), 'TPCL cannot say "gap 0": nothing is invented');
    assert.equal(tspl.parse(back.text).size.pitch, null);
  });

  test(`TSPL GAP 0 -> ZPL writes ^PW / ^LL only, with the information message, at ${dpi} dpi`, () => {
    const zpl = PB.convert.run(ZERO_GAP, 'zpl', { dpi });
    assert.ok(!/GAP/i.test(zpl.text));
    assert.ok(zpl.diagnostics.some(d => /GAP de TSPL/.test(d.text)));
    const back = PB.convert.run(zpl.text, 'tspl', { dpi });
    assert.ok(!/GAP/.test(back.text));
  });
}
