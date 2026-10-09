const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tspl.js');
const tspl = PB.languages.get('tspl');
const parse = (src, opts) => tspl.parse(src, opts);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const one = (src, opts) => {
  const model = parse(src, opts);
  assert.equal(model.items.length, 1, JSON.stringify(model.diagnostics));
  return model.items[0];
};
const DOT = 254 / 203;

test('text registers a TSPL hook factory next to the TPCL one', () => {
  assert.equal(typeof PB.components.get('text').languages.tspl, 'function');
  assert.equal(typeof PB.components.get('text').languages.tpcl, 'function');
});

test('TEXT with a bitmap font: size = cell height * y-mul dots, scaleX fits the cell width', () => {
  const cells = { 1: [8, 12], 2: [12, 20], 3: [16, 24], 4: [24, 32], 5: [32, 48], 6: [14, 19], 7: [21, 27], 8: [14, 25] };
  for (const [font, [w, h]] of Object.entries(cells)) {
    const item = one(`TEXT 10,20,"${font}",0,1,1,"AB"`);
    assert.equal(item.kind, 'text');
    near(item.font.size, h * DOT);
    near(item.font.scaleX, w / (h * 0.6));
    assert.equal(item.font.family, 'mono');
    assert.equal(item.font.weight, 400);
    assert.equal(item.font.style, 'normal');
    assert.equal(item.data, 'AB');
  }
});

test('TEXT multipliers scale the bitmap font: y-mul the height, x-mul the width', () => {
  const item = one('TEXT 0,0,"3",0,2,3,"A"');
  near(item.font.size, 24 * 3 * DOT);
  near(item.font.scaleX, (16 * 2) / (24 * 3 * 0.6));
});

test('TEXT font "0" and ROMAN.TTF are scalable: multipliers are points, no diagnostic', () => {
  for (const font of ['0', 'ROMAN.TTF', 'roman.ttf']) {
    const model = parse(`TEXT 10,20,"${font}",0,10,12,"Hi"`);
    const [item] = model.items;
    near(item.font.size, 12 * PB.units.UNITS_PER_POINT);
    near(item.font.scaleX, 10 / 12);
    assert.equal(item.font.family, 'sans');
    assert.deepEqual(model.diagnostics, []);
  }
});

test('TEXT with an unknown font falls back to sans with one info diagnostic per font', () => {
  const model = parse('TEXT 0,0,"ARIAL.TTF",0,8,8,"a"\r\nTEXT 0,50,"ARIAL.TTF",0,8,8,"b"\r\nTEXT 0,90,"X.EFT",0,8,8,"c"');
  assert.equal(model.items.length, 3);
  assert.equal(model.items[0].font.family, 'sans');
  near(model.items[0].font.size, 8 * PB.units.UNITS_PER_POINT);
  const infos = model.diagnostics.filter(d => /fuente/.test(d.text));
  assert.equal(infos.length, 2);
  assert.match(infos[0].text, /ARIAL\.TTF/);
  assert.equal(infos[0].level, 'info');
});

test('TEXT rotation 0/90/180/270 is the model rotation; an invalid one warns and draws unrotated', () => {
  for (const rot of [0, 90, 180, 270]) assert.equal(one(`TEXT 0,0,"1",${rot},1,1,"A"`).rotation, rot);
  const model = parse('TEXT 0,0,"1",45,1,1,"A"');
  assert.equal(model.items[0].rotation, 0);
  assert.equal(model.diagnostics[0].level, 'warning');
  assert.match(model.diagnostics[0].text, /rotación/);
});

test('TEXT position converts dots to 0.1 mm with the dpi', () => {
  const a = one('TEXT 100,50,"1",0,1,1,"A"', { dpi: 203 });
  near(a.x, 100 * 254 / 203);
  near(a.y, (50 + 10) * 254 / 203); // the baseline: the ascent (10 of the 12 dots of the cell) below the TEXT y
  const b = one('TEXT 100,50,"1",0,1,1,"A"', { dpi: 300 });
  near(b.x, 100 * 254 / 300);
  near(b.font.size, 12 * 254 / 300);
  assert.equal(a.raw.x, '100');
});

test('TEXT applies REFERENCE and SHIFT', () => {
  const item = one('REFERENCE 20,30\r\nSHIFT 0,5\r\nTEXT 10,10,"1",0,1,1,"A"');
  near(item.x, 30 * DOT);
  near(item.y, (45 + 10) * DOT);
});

test('TEXT optional alignment is detected by field count', () => {
  const without = parse('TEXT 0,0,"1",0,1,1,"hello"');
  assert.equal(without.items[0].data, 'hello');
  assert.deepEqual(without.diagnostics, []);
  const left = parse('TEXT 0,0,"1",0,1,1,1,"hello"');
  assert.equal(left.items[0].data, 'hello');
  assert.deepEqual(left.diagnostics, []);
  for (const align of [2, 3]) {
    const model = parse(`TEXT 0,0,"1",0,1,1,${align},"hello"`);
    assert.equal(model.items[0].data, 'hello');
    assert.equal(model.diagnostics.length, 1);
    assert.equal(model.diagnostics[0].level, 'info');
    assert.match(model.diagnostics[0].text, /alineación no soportada, se dibuja a la izquierda/);
  }
});

test('TEXT content: quoted commas and the escaped quote', () => {
  assert.equal(one('TEXT 0,0,"1",0,1,1,"a,b, c"').data, 'a,b, c');
  assert.equal(one('TEXT 0,0,"1",0,1,1,"say \\"hi\\""').data, 'say "hi"');
  assert.equal(one('TEXT 0,0,"1",0,1,1,2,"a,b"').data, 'a,b');
});

test('TEXT counters and variables are kept as literal text with one info per label', () => {
  const model = parse('TEXT 0,0,"1",0,1,1,@0\r\nTEXT 0,40,"1",0,1,1,"x"+@1+"y"\r\nTEXT 0,80,"1",0,1,1,"@"');
  assert.equal(model.items[0].data, '@0');
  assert.equal(model.items[1].data, '"x"+@1+"y"');
  assert.equal(model.items[2].data, '@');
  const infos = model.diagnostics.filter(d => /contador/.test(d.text));
  assert.equal(infos.length, 1);
  assert.equal(infos[0].level, 'info');
});

test('TEXT source span covers exactly the command line', () => {
  const src = 'SIZE 4,2\r\nTEXT 10,20,"1",0,1,1,"A,B"\r\nTEXT 10,60,"1",0,1,1,"C"\r\n';
  const model = parse(src);
  const { spans } = model.items[0].source;
  assert.equal(spans.length, 1);
  assert.equal(src.slice(spans[0].start, spans[0].end), 'TEXT 10,20,"1",0,1,1,"A,B"');
  assert.equal(model.items[0].source.label, 'TEXT 10,20,"1",0,1,1,"A,B"');
  assert.equal(src.slice(model.items[1].source.spans[0].start, model.items[1].source.spans[0].end), 'TEXT 10,60,"1",0,1,1,"C"');
});

test('TEXT incomplete or with invalid coordinates warns and draws nothing', () => {
  for (const src of ['TEXT 10,20,"1",0,1', 'TEXT a,b,"1",0,1,1,"A"']) {
    const model = parse(src);
    assert.deepEqual(model.items, []);
    assert.equal(model.diagnostics[0].level, 'warning');
  }
});

test('TEXT invalid multipliers warn and use 1', () => {
  const model = parse('TEXT 0,0,"1",0,0,x,"A"');
  near(model.items[0].font.size, 12 * DOT);
  assert.equal(model.diagnostics.filter(d => d.level === 'warning').length, 2);
});

test('BLOCK without optional fields is one text item with a single info diagnostic', () => {
  const model = parse('BLOCK 10,20,400,200,"2",0,1,1,"Hello world"\r\nBLOCK 10,60,400,200,"2",0,1,1,"Again"');
  assert.equal(model.items.length, 2);
  const [item] = model.items;
  assert.equal(item.kind, 'text');
  assert.equal(item.data, 'Hello world');
  near(item.x, 10 * DOT);
  near(item.font.size, 20 * DOT);
  assert.equal(item.native.width, 400);
  assert.equal(item.native.height, 200);
  const infos = model.diagnostics.filter(d => /BLOCK se dibuja como texto simple/.test(d.text));
  assert.equal(infos.length, 1);
  assert.equal(infos[0].level, 'info');
  assert.match(infos[0].text, /\(sin ajuste de línea\)/);
});

test('BLOCK with optional space, align and fit fields; content keeps its commas', () => {
  const model = parse('BLOCK 0,0,300,100,"0",90,8,10,5,2,1,"a,b \\"q\\""');
  const [item] = model.items;
  assert.equal(item.data, 'a,b "q"');
  assert.equal(item.rotation, 90);
  near(item.font.size, 10 * PB.units.UNITS_PER_POINT);
  assert.deepEqual([item.native.space, item.native.align, item.native.fit], [5, 2, 1]);
  assert.ok(model.diagnostics.some(d => /alineación no soportada/.test(d.text)));
});

test('BLOCK optional fields are positional (space, align, fit); \\[R] and \\[L] become spaces', () => {
  const model = parse('BLOCK 0,0,300,100,"1",0,1,1,3,1,"one\\[R]two\\[L]three"');
  assert.equal(model.items[0].data, 'one two three');
  assert.deepEqual([model.items[0].native.space, model.items[0].native.align], [3, 1]);
  assert.equal(model.diagnostics.filter(d => /alineación/.test(d.text)).length, 0);
});

test('BLOCK incomplete warns and draws nothing', () => {
  const model = parse('BLOCK 0,0,300,100,"1",0,1,1');
  assert.deepEqual(model.items, []);
  assert.equal(model.diagnostics[0].level, 'warning');
});

test('end to end: a small TSPL label parses to size and text items', () => {
  const src = 'SIZE 100 mm,60 mm\r\nGAP 3 mm,0\r\nDIRECTION 1\r\nCLS\r\nTEXT 40,30,"3",0,1,1,"PrintBridge"\r\nTEXT 40,90,"0",90,8,10,"Rotated"\r\nPRINT 1,1\r\n';
  const model = parse(src);
  assert.equal(model.size.width, 1000);
  assert.equal(model.size.height, 600);
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.items.map(i => [i.kind, i.data, i.rotation]), [['text', 'PrintBridge', 0], ['text', 'Rotated', 90]]);
  assert.deepEqual(model.items.map(i => i.font.family), ['mono', 'sans']);
});

test('a parsed TSPL text item renders with the existing SVG renderer', () => {
  const D = loadUpTo('js/drawing.js');
  const model = D.languages.get('tspl').parse('SIZE 100 mm,60 mm\r\nTEXT 40,30,"3",90,1,1,"Hello <b>"\r\n', { dpi: 203 });
  const view = D.sizes.view(model, null);
  const { svg } = D.svgRenderer.render(model, view, { textScale: 1, showGrid: false, showAnchors: false, values: {} });
  assert.equal((svg.match(/<text /g) || []).length, 1);
  assert.match(svg, /class="font-mono"/);
  assert.match(svg, /rotate\(90\)/);
  assert.match(svg, />Hello &lt;b&gt;<\/text>/);
});
