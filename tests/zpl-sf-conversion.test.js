const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// ZPL ^SF mask <-> the TPCL / TSPL counters (S4 of odd/tasks/zpl-sf-mask.md). A decimal mask whose d run covers the whole trailing digit run of the data
// (with an all-digit increment) is bridged to counter = { step } by the ZPL parser and converts to the counters; any other modelled mask has no TPCL / TSPL
// equivalent: the field is written as its first value with ONE warning. A TPCL / TSPL counter goes to ZPL as ^SN (never ^SF). When counter and serialMask
// disagree (a neutral item edited by hand) ZPL writes the mask and TPCL / TSPL write the counter (the only thing they know), without a mask warning.
const PB = loadApp();
const DPIS = [203, 300];

const wrap = body => `^XA^PW800^LL480${body}^XZ`;
const FIELD = data => `^FO100,50^A0N,40,40${data}^FS`;
const CODE = data => `^BY2,3,60^FO100,200^BCN,60,Y,N,N${data}^FS`;
const zplSource = body => wrap(body);
const back = (lang, text, dpi) => PB.languages.get(lang).parse(text, { dpi });
const maskWarnings = r => r.diagnostics.filter(d => d.level === 'warning' && /\^SF/.test(d.text));

for (const dpi of DPIS) {
  for (const [lang, token] of [['tpcl', /\+0000000001/], ['tspl', /SET COUNTER @\d+ 1/]]) {
    test(`ZPL -> ${lang} at ${dpi} dpi: a bridged decimal mask becomes the counter and reads back with its step`, () => {
      const r = PB.convert.run(zplSource(FIELD('^FDBL0000^SFdddd,1') + CODE('^FD0042^SFdddd,1')), lang, { dpi });
      assert.match(r.text, token);
      assert.deepEqual(maskWarnings(r), []);
      const items = back(lang, r.text, dpi).items;
      assert.deepEqual(items.map(i => [i.kind, i.data, i.counter && i.counter.step]), [['text', 'BL0000', 1], ['barcode', '0042', 1]]);
      assert.ok(items.every(i => !i.serialMask));
    });
  }

  test(`ZPL -> TPCL and TSPL at ${dpi} dpi: the step of the increment string is the counter step`, () => {
    for (const lang of ['tpcl', 'tspl']) {
      const r = PB.convert.run(zplSource(FIELD('^FD0100^SFdddd,5')), lang, { dpi });
      assert.equal(back(lang, r.text, dpi).items[0].counter.step, 5, lang);
    }
  });

  test(`TPCL / TSPL counter -> ZPL at ${dpi} dpi keeps writing ^SN and never invents ^SF`, () => {
    const tpcl = PB.languages.get('tpcl').emit({ size: { w: 1000, h: 500 }, items: [{ kind: 'text', x: 100, y: 100, rotation: 0, data: '0001', font: { family: 'sans', size: 100, weight: 400, style: 'normal', scaleX: 1 }, counter: { step: 1 } }] }, { dpi }).text;
    const tspl = PB.languages.get('tspl').emit({ size: { w: 1000, h: 500 }, items: [{ kind: 'text', x: 100, y: 100, rotation: 0, data: '0001', font: { family: 'sans', size: 100, weight: 400, style: 'normal', scaleX: 1 }, counter: { step: 1 } }] }, { dpi }).text;
    for (const text of [tpcl, tspl]) {
      const r = PB.convert.run(text, 'zpl', { dpi });
      assert.match(r.text, /\^SN0001,1,Y/);
      assert.doesNotMatch(r.text, /\^SF/);
    }
  });

  for (const [name, body] of [
    ['the exercise-4 shape (% around the digits)', FIELD('^FDABCD1000EFGH^SF%%%%dddd%%%%,10000')],
    ['a partial run of the digits', FIELD('^FD0001^SFdd,1')],
    ['a % inside the mask', FIELD('^FDBL00-0^SFdd%d,1')],
    ['a % in the increment', FIELD('^FD0001^SFdddd,1%')],
    ['a bar code with a partial run', CODE('^FD0001^SFdd,1')],
  ]) {
    for (const lang of ['tpcl', 'tspl']) {
      test(`ZPL -> ${lang} at ${dpi} dpi: ${name} has no counter, is written as its first value with ONE warning`, () => {
        const source = PB.languages.get('zpl').parse(wrap(body), { dpi });
        assert.ok(source.items[0].serialMask);
        assert.equal(source.items[0].counter, undefined);
        const r = PB.convert.run(zplSource(body), lang, { dpi });
        assert.equal(maskWarnings(r).length, 1, JSON.stringify(r.diagnostics));
        assert.match(maskWarnings(r)[0].text, /máscara/i);
        const item = back(lang, r.text, dpi).items[0];
        assert.equal(item.data, source.items[0].data);
        assert.equal(item.counter, undefined);
        assert.doesNotMatch(r.text, /\^SF/);
      });
    }
  }
}

test('two degraded masks give one warning only (TPCL and TSPL)', () => {
  const body = FIELD('^FD0001^SFdd,1') + FIELD('^FDAB12^SF%%dd,1').replace('FO100,50', 'FO100,120');
  for (const lang of ['tpcl', 'tspl']) assert.equal(maskWarnings(PB.convert.run(zplSource(body), lang, { dpi: 203 })).length, 1, lang);
});

test('a bridged mask does not warn, and ZPL -> ZPL keeps the ^SF untouched', () => {
  const r = PB.convert.run(zplSource(FIELD('^FD0001^SFdddd,1')), 'zpl', { dpi: 203 });
  assert.match(r.text, /\^FD0001\^SFdddd,1/);
  assert.doesNotMatch(r.text, /\^SN/);
});

test('counter and serialMask disagree (neutral item): ZPL writes the mask, TPCL and TSPL write the counter without a mask warning', () => {
  const font = { family: 'sans', size: 100, weight: 400, style: 'normal', scaleX: 1 };
  const model = { size: { w: 1000, h: 500 }, items: [{ kind: 'text', x: 100, y: 100, rotation: 0, data: '0001', font, counter: { step: 3 }, serialMask: { mask: 'dddd', increment: '1' } }] };
  const z = PB.languages.get('zpl').emit(model, { dpi: 203 });
  assert.match(z.text, /\^FD0001\^SFdddd,1/);
  assert.doesNotMatch(z.text, /\^SN/);
  for (const lang of ['tpcl', 'tspl']) {
    const out = PB.languages.get(lang).emit(model, { dpi: 203 });
    assert.deepEqual(maskWarnings(out), [], lang);
    assert.equal(back(lang, out.text, 203).items[0].counter.step, 3, lang);
  }
});

test('a serialMask with a zero or missing counter in TPCL / TSPL warns once and drops nothing else', () => {
  const font = { family: 'sans', size: 100, weight: 400, style: 'normal', scaleX: 1 };
  const model = { size: { w: 1000, h: 500 }, items: [{ kind: 'text', x: 100, y: 100, rotation: 0, data: 'AB12', font, serialMask: { mask: 'dd', increment: '1' } }] };
  for (const lang of ['tpcl', 'tspl']) {
    const out = PB.languages.get(lang).emit(model, { dpi: 203 });
    assert.equal(maskWarnings(out).length, 1, lang);
    assert.equal(back(lang, out.text, 203).items[0].data, 'AB12', lang);
  }
});
