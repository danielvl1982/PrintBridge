const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// TPCL text "Tipo de fuente" (text/tpcl.js): the radio switches a text between the bitmap command PC (also the Tipo block) and the outline command PV,
// rewriting the format command AND renaming its RC / RV data command in one text (= one undoable edit). The nearest font is chosen (PC letter and
// magnifications <-> PV font B with width and height in 0.1 mm); position, rotation, attribute, character spacing, counter, zero suppression, alignment,
// the other optional parameters and the inline data stay; the bold (J) and the block (P5), which only PC has, are dropped.
const PB = loadApp();
const tpcl = PB.languages.get('tpcl');
const DPI = 203;
const parse = text => tpcl.parse(text, { dpi: DPI });
const itemsOf = text => parse(text).items;
const describe = (text, index = 0) => tpcl.describeItem(itemsOf(text)[index], text);
const field = (text, key, index = 0) => describe(text, index).fields.find(f => f.key === key);
const set = (text, changes, index = 0) => tpcl.updateItem(text, itemsOf(text)[index], changes, { dpi: DPI });
const wrap = (...commands) => `{D0630,1000,0600|}\n{C|}\n${commands.join('\n')}\n{XS;I,0001,0002C4100|}`;

// ---- The radio

test('describeItem: the radio is the first field of PC and PV texts, with its two options and the current type', () => {
  const pc = describe('{PC001;0100,0200,10,10,J,00,B=a|}');
  const pv = describe('{PV01;0100,0200,0100,0100,B,00,B=a|}');
  for (const d of [pc, pv]) {
    const radio = d.fields[0];
    assert.deepEqual([radio.key, radio.type, radio.label], ['fontType', 'radio', 'Tipo de fuente']);
    assert.deepEqual(radio.options, [{ value: 'bitmap', label: 'Mapa de bits (PC)' }, { value: 'vector', label: 'Vectorial (PV)' }]);
  }
  assert.equal(pc.fields[0].value, 'bitmap');
  assert.equal(pv.fields[0].value, 'vector');
  assert.equal(tpcl.describeItem(itemsOf('{PV01;0100,0200,0100,0100,B,00,B=a|}')[0]).fields[0].value, 'vector');
});

test('the font select lists the fonts of the chosen type: the PC letters for a bitmap text, the two outline fonts for a PV text', () => {
  const pc = field('{PC001;0100,0200,10,10,J,00,B=a|}', 'font');
  const pv = field('{PV01;0100,0200,0100,0100,B,00,B=a|}', 'font');
  assert.equal(pc.options.length, 20);
  assert.deepEqual(pv.options.map(o => o.value), ['A', 'B']);
});

test('the notes say what the other type cannot hold: a PC text with bold or a block warns before switching, a PV text says why', () => {
  assert.equal(field('{PC001;0100,0200,10,10,J,00,B=a|}', 'fontType').note, undefined);
  assert.match(field('{PC001;0100,0200,10,10,J,00,B,J0102=a|}', 'fontType').note, /se pierde la negrita \(J\)$/);
  assert.match(field('{PC001;0100,0200,10,10,J,00,B,P5030002003=a|}', 'fontType').note, /bloque de texto \(P5: vuelve a una línea\)/);
  assert.match(field('{PC001;0100,0200,10,10,J,00,B,J0102,P5030002003=a|}', 'fontType').note, /negrita \(J\) y el bloque de texto/);
  assert.match(field('{PV01;0100,0200,0100,0100,B,00,B=a|}', 'fontType').note, /única con negrita \(J\) y bloque de texto \(P5\)/);
  assert.match(field('{PV01;0100,0200,0100,0100,B,+120,00,B=a|}', 'fontType').note, /±99/);
});

test('the palette text (PV + RV) shows as Vectorial', () => {
  const text = tpcl.buildComponent(wrap(), 'text', { x: 100, y: 200 }, {});
  const item = itemsOf(text)[0];
  assert.equal(item.ref, 'PV01');
  assert.equal(tpcl.describeItem(item, text).fields[0].value, 'vector');
});

// ---- PC -> PV

test('PC -> PV: one rewritten text; the number, the position, the rotation, the attribute and the RC data (renamed RV) stay', () => {
  const text = wrap('{PC01;0100,0200,10,10,J,11,W0507|}', '{RC01;Lote <#LOT#> de #TOTAL#|}');
  const out = set(text, { fontType: 'vector' });
  assert.equal(out, wrap('{PV01;0100,0200,0042,0042,B,11,W0507|}', '{RV01;Lote <#LOT#> de #TOTAL#|}'));
  const [item] = itemsOf(out);
  assert.equal(item.ref, 'PV01');
  assert.deepEqual([item.x, item.y, item.rotation, item.data], [100, 200, 90, 'Lote <#LOT#> de #TOTAL#']);
  assert.equal(item.attribute.kind, 'reverse');
  assert.equal(tpcl.describeItem(item, out).fields[0].value, 'vector');
});

test('PC -> PV: the size comes from the font and the magnifications (width = size x horizontal stretch, height = size)', () => {
  // font J is 12 pt (42.3 in 0.1 mm); magnification 2.0 x 3.0 -> 84.7 wide, 127 high
  const out = set('{PC01;0100,0200,20,30,J,00,B=a|}', { fontType: 'vector' });
  assert.match(out, /^\{PV01;0100,0200,0085,0127,B,00,B=a\|\}$/);
});

test('PC -> PV: inline data stays inline; spacing keeps its dots with 3 digits; counter, zero suppression and alignment stay; the bold goes', () => {
  const out = set('{PC01;0100,0200,10,10,J,+05,00,B,J0102,M0,+0000000001,Z03,P2=0001|}', { fontType: 'vector' });
  assert.equal(out, '{PV01;0100,0200,0042,0042,B,+005,00,B,M0,+0000000001,Z03,P2=0001|}');
  const [item] = itemsOf(out);
  assert.deepEqual([item.spacing.native, item.counter.step, item.zeroSuppress, item.align.kind, item.bold], [5, 1, 3, 'center', undefined]);
  assert.equal(set('{PC01;0100,0200,10,10,J,-00,00,B=a|}', { fontType: 'vector' }), '{PV01;0100,0200,0042,0042,B,+000,00,B=a|}');
});

test('PC -> PV: a block goes back to a line (the P5 token is dropped); an equal-space alignment (P4) stays', () => {
  assert.equal(set('{PC01;0100,0200,10,10,J,00,B,P5030002003=abc|}', { fontType: 'vector' }), '{PV01;0100,0200,0042,0042,B,00,B=abc|}');
  assert.equal(set('{PC01;0100,0200,10,10,J,00,B,P40300=abc|}', { fontType: 'vector' }), '{PV01;0100,0200,0042,0042,B,00,B,P40300=abc|}');
  assert.equal(itemsOf(set('{PC01;0100,0200,10,10,J,00,B,P5030002003=abc|}', { fontType: 'vector' }))[0].block, undefined);
});

test('PC -> PV: when the same number is already a PV (or RV), the next free one is used and the RC follows it', () => {
  const text = wrap('{PC01;0100,0200,10,10,J,00,B|}', '{RC01;uno|}', '{PV01;0100,0300,0100,0100,B,00,B|}', '{RV01;dos|}', '{PC02;0100,0400,10,10,J,00,B|}', '{RC02;tres|}');
  const out = set(text, { fontType: 'vector' });
  assert.equal(out, wrap('{PV02;0100,0200,0042,0042,B,00,B|}', '{RV02;uno|}', '{PV01;0100,0300,0100,0100,B,00,B|}', '{RV01;dos|}', '{PC02;0100,0400,10,10,J,00,B|}', '{RC02;tres|}'));
  assert.deepEqual(itemsOf(out).map(i => [i.ref, i.data]), [['PV02', 'uno'], ['PV01', 'dos'], ['PC02', 'tres']]);
});

test('PC -> PV: only the data of that item is renamed (another PC with a different number keeps its RC)', () => {
  const text = wrap('{PC01;0100,0200,10,10,J,00,B|}', '{PC02;0100,0300,10,10,J,00,B|}', '{RC01;uno|}', '{RC02;dos|}');
  const out = set(text, { fontType: 'vector' }, 0);
  assert.ok(out.includes('{RV01;uno|}') && out.includes('{RC02;dos|}') && out.includes('{PC02;'));
});

test('PC -> PV: a text without a data command or with a multi-line command is rewritten the same way', () => {
  assert.equal(set('{PC01;0100,0200,10,10,J,00,B|}', { fontType: 'vector' }), '{PV01;0100,0200,0042,0042,B,00,B|}');
  const split = '{PC01;0100,0200,10,10,J,\n00,B|}\n{RC01;uno|}';
  assert.equal(set(split, { fontType: 'vector' }), '{PV01;0100,0200,0042,0042,B,00,B|}\n{RV01;uno|}');
});

// ---- PV -> PC

test('PV -> PC: the nearest bitmap font (sans bold) with magnifications; the position, rotation, attribute, spacing and data stay', () => {
  const text = wrap('{PV01;0100,0200,0042,0042,B,+005,11,W0507|}', '{RV01;Lote #LOT#|}');
  const out = set(text, { fontType: 'bitmap' });
  assert.equal(out, wrap('{PC01;0100,0200,1,1,J,+05,11,W0507|}', '{RC01;Lote #LOT#|}'));
  const [item] = itemsOf(out);
  assert.equal(item.ref, 'PC01');
  assert.deepEqual([item.x, item.y, item.rotation, item.data], [100, 200, 90, 'Lote #LOT#']);
  assert.equal(tpcl.describeItem(item, out).fields[0].value, 'bitmap');
});

test('PV -> PC: a size that is not a whole magnification of a font gets the closest one; width and height are independent', () => {
  const [item] = itemsOf(set('{PV01;0100,0200,0120,0080,B,00,B=a|}', { fontType: 'bitmap' }));
  assert.equal(item.ref, 'PC01');
  // the magnifications are 0.5 steps from 1 (K 14 pt at 1.5 x 2.5 here), so the closest one is not as close as with tenths
  assert.ok(Math.abs(item.font.size - 80) / 80 < 0.08, `size ${item.font.size}`);
  assert.ok(Math.abs(item.font.size * item.font.scaleX - 120) / 120 < 0.08, `width ${item.font.size * item.font.scaleX}`);
  assert.equal(item.font.family, 'sans');
  assert.equal(item.font.weight, 700);
});

test('PV -> PC: the spacing is clamped to the 2 digits of PC; counter, zero suppression, alignment and the RV data (renamed RC) stay; the number is kept when free', () => {
  const text = wrap('{PV03;0100,0200,0042,0042,B,+120,00,B,M0,+0000000002,Z02,P3|}', '{RV03;12|}');
  assert.equal(set(text, { fontType: 'bitmap' }), wrap('{PC03;0100,0200,1,1,J,+99,00,B,M0,+0000000002,Z02,P3|}', '{RC03;12|}'));
});

test('PV -> PC: the number is moved to a free PC / RC one when it is taken', () => {
  const text = wrap('{PV01;0100,0200,0042,0042,B,00,B|}', '{RV01;a|}', '{PC01;0100,0300,10,10,J,00,B|}', '{RC01;b|}');
  const out = set(text, { fontType: 'bitmap' });
  assert.equal(out, wrap('{PC02;0100,0200,1,1,J,00,B|}', '{RC02;a|}', '{PC01;0100,0300,10,10,J,00,B|}', '{RC01;b|}'));
});

// ---- Round trip, no-ops and refusals

test('PC -> PV -> PC and PV -> PC -> PV keep the size within one magnification step and everything else', () => {
  const start = wrap('{PC01;0100,0200,1,1,J,22,F0304,+0000000001,P2|}', '{RC01;0001|}');
  const vector = set(start, { fontType: 'vector' });
  const back = set(vector, { fontType: 'bitmap' });
  assert.equal(back, start.replace(',P2|}', ',P2|}'));
  const outline = wrap('{PV01;0100,0200,0100,0100,B,00,B|}', '{RV01;x|}');
  const there = set(outline, { fontType: 'bitmap' });
  const again = itemsOf(set(there, { fontType: 'vector' }))[0];
  assert.ok(Math.abs(again.font.size - 100) <= 3 && Math.abs(again.font.size * again.font.scaleX - 100) <= 3);
});

test('the same type, an unknown type and an item without source change nothing', () => {
  const text = wrap('{PC01;0100,0200,10,10,J,00,B|}', '{RC01;a|}');
  assert.equal(set(text, { fontType: 'bitmap' }), text);
  assert.equal(set(text, { fontType: 'other' }), text);
  assert.equal(tpcl.updateItem(text, { ...itemsOf(text)[0], source: undefined }, { fontType: 'vector' }, { dpi: DPI }), text);
});

test('other changes of the same call apply to the rewritten command (the radio and a size or rotation together)', () => {
  const text = wrap('{PC01;0100,0200,10,10,J,00,B|}', '{RC01;a|}');
  assert.equal(set(text, { fontType: 'vector', rotation: 90 }), wrap('{PV01;0100,0200,0042,0042,B,11,B|}', '{RV01;a|}'));
  assert.equal(set(text, { fontType: 'vector', content: 'b' }), wrap('{PV01;0100,0200,0042,0042,B,00,B|}', '{RV01;b|}'));
});

test('a switched text is moved and edited like any other (the edit engines find it under its new command)', () => {
  const text = wrap('{PC01;0100,0200,10,10,J,00,B|}', '{RC01;a|}');
  const out = set(text, { fontType: 'vector' });
  const item = itemsOf(out)[0];
  assert.ok(tpcl.moveItem(out, item, 10, 20, { dpi: DPI }).includes('{PV01;0110,0220,'));
  assert.ok(tpcl.updateItem(out, item, { width: 50 }, { dpi: DPI }).includes('{PV01;0100,0200,0050,'));
});

test('the converted PC -> PV text emits and converts like a native PV (no warnings)', () => {
  const out = set(wrap('{PC01;0100,0200,10,10,J,00,B|}', '{RC01;a|}'), { fontType: 'vector' });
  const converted = PB.convert.run(out, 'tspl', 'tpcl');
  assert.equal(converted.diagnostics.filter(d => d.level === 'error').length, 0);
  assert.match(converted.text, /TEXT /);
});
