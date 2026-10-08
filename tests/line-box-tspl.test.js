const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/drawing.js');
const tspl = PB.languages.get('tspl');
const parse = (src, opts) => tspl.parse(src, opts);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const one = (src, opts) => {
  const model = parse(src, opts);
  assert.equal(model.items.length, 1, JSON.stringify(model.diagnostics));
  return model.items[0];
};
const dotOf = dpi => 254 / dpi;

test('line and box register a TSPL hook factory next to the TPCL one', () => {
  for (const id of ['line', 'box']) {
    assert.equal(typeof PB.components.get(id).languages.tspl, 'function');
    assert.equal(typeof PB.components.get(id).languages.tpcl, 'function');
  }
});

test('BAR wider than tall: horizontal thick line, thickness = height', () => {
  const d = dotOf(203);
  const item = one('BAR 10,20,100,4');
  assert.equal(item.kind, 'line');
  assert.equal(item.ref, 'BAR');
  assert.equal(item.rect, false);
  near(item.x1, 10 * d);
  near(item.x2, 110 * d);
  near(item.y1, 22 * d);
  near(item.y2, 22 * d);
  near(item.width, 4 * d);
  assert.deepEqual(item.native, { width: 100, height: 4, kind: 'BAR' });
});

test('BAR taller than wide: vertical thick line, thickness = width', () => {
  const d = dotOf(203);
  const item = one('BAR 10,20,6,80');
  near(item.x1, 13 * d);
  near(item.x2, 13 * d);
  near(item.y1, 20 * d);
  near(item.y2, 100 * d);
  near(item.width, 6 * d);
  assert.deepEqual(item.native, { width: 6, height: 80, kind: 'BAR' });
});

test('BAR square takes the horizontal form', () => {
  const d = dotOf(203);
  const item = one('BAR 0,0,8,8');
  near(item.x1, 0);
  near(item.x2, 8 * d);
  near(item.y1, 4 * d);
  near(item.y2, 4 * d);
  near(item.width, 8 * d);
});

test('BAR converts with the dpi', () => {
  const d = dotOf(300);
  const item = one('BAR 12,24,120,6', { dpi: 300 });
  near(item.x1, 12 * d);
  near(item.x2, 132 * d);
  near(item.y1, 27 * d);
  near(item.width, 6 * d);
});

test('REFERENCE and SHIFT offset the bar and the box', () => {
  const d = dotOf(203);
  const bar = parse('REFERENCE 5,7\r\nSHIFT 2,3\r\nBAR 10,20,100,4').items[0];
  near(bar.x1, 17 * d);
  near(bar.x2, 117 * d);
  near(bar.y1, 32 * d);
  const box = parse('REFERENCE 5,7\r\nBOX 10,20,50,60,3').items[0];
  near(box.x1, 15 * d);
  near(box.y1, 27 * d);
  near(box.x2, 55 * d);
  near(box.y2, 67 * d);
});

test('BOX builds a rect line item with the corners and the thickness', () => {
  const d = dotOf(203);
  const item = one('BOX 10,20,210,120,4');
  assert.equal(item.kind, 'line');
  assert.equal(item.ref, 'BOX');
  assert.equal(item.rect, true);
  near(item.x1, 10 * d);
  near(item.y1, 20 * d);
  near(item.x2, 210 * d);
  near(item.y2, 120 * d);
  near(item.width, 4 * d);
  assert.deepEqual(item.native, { width: 4, kind: 'BOX' });
  assert.equal(PB.components.forItem(item).kind, 'box');
});

test('BOX radius is kept in native (dots) and as the neutral radius, with no diagnostic (it is drawn)', () => {
  const model = parse('BOX 10,20,210,120,4,8\r\nBOX 10,20,50,60,2,5');
  assert.equal(model.items.length, 2);
  assert.equal(model.items[0].native.radius, 8);
  assert.equal(model.items[1].native.radius, 5);
  near(model.items[0].radius, 8 * dotOf(203));
  assert.equal(model.diagnostics.filter(x => /radio de esquina/.test(x.text)).length, 0);
});

test('BOX with radius 0 or none adds no diagnostic', () => {
  assert.equal(parse('BOX 1,2,30,40,2,0').diagnostics.length, 0);
  assert.equal(parse('BOX 1,2,30,40,2').diagnostics.length, 0);
});

test('missing or invalid arguments: Spanish warning and no item', () => {
  for (const src of ['BAR 10,20,100', 'BAR 10,20,x,4', 'BAR', 'BAR 10,20,0,4', 'BOX 10,20,30,40', 'BOX 10,20,a,40,3', 'BOX 10,20,30,40,0']) {
    const model = parse(src);
    assert.equal(model.items.length, 0, src);
    assert.equal(model.diagnostics.length, 1, src);
    assert.equal(model.diagnostics[0].level, 'warning', src);
    assert.match(model.diagnostics[0].text, /^(BAR|BOX) /, src);
  }
});

test('spaces around the arguments and lower case are tolerated', () => {
  const d = dotOf(203);
  const item = one('bar 10, 20, 100, 4');
  near(item.x2, 110 * d);
  near(item.width, 4 * d);
  const box = one('Box 10 , 20 , 50 , 60 , 3');
  near(box.x2, 50 * d);
});

test('the source span covers exactly the command line', () => {
  const src = 'SIZE 4,3\r\nBAR 10,20,100,4  \r\nBOX 1,2,30,40,2\r\nPRINT 1';
  const model = parse(src);
  const [bar, box] = model.items;
  const text = i => src.slice(i.source.spans[0].start, i.source.spans[0].end);
  assert.equal(text(bar), 'BAR 10,20,100,4');
  assert.equal(text(box), 'BOX 1,2,30,40,2');
  assert.equal(bar.source.spans.length, 1);
});

test('end to end: SIZE + BAR + BOX', () => {
  const model = parse('SIZE 100 mm,60 mm\r\nCLS\r\nBAR 8,8,200,4\r\nBOX 8,40,208,140,3\r\nPRINT 1,1\r\n');
  assert.equal(model.diagnostics.length, 0);
  assert.deepEqual(model.items.map(i => [i.ref, i.rect]), [['BAR', false], ['BOX', true]]);
  assert.equal(model.size.width, 1000);
});

test('rendering: a BAR draws the same filled rectangle as the dots it covers', () => {
  const d = dotOf(203);
  const model = parse('BAR 10,20,100,4');
  const { svg } = PB.svgRenderer.render(model, { width: 800, height: 400 }, { textScale: 1 });
  const m = /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" class="stroke" stroke-width="([\d.]+)"/.exec(svg);
  assert.ok(m, svg);
  const [x1, y1, x2, y2, w] = m.slice(1).map(Number);
  // Default (butt) caps: the stroke covers x1..x2 and y - w/2 .. y + w/2, i.e. exactly x..x+w, y..y+h
  assert.ok(Math.abs(x1 - 10 * d) < 0.01 && Math.abs(x2 - 110 * d) < 0.01);
  assert.ok(Math.abs(y1 - y2) < 1e-9);
  assert.ok(Math.abs(y1 - w / 2 - 20 * d) < 0.02);
  assert.ok(Math.abs(y1 + w / 2 - 24 * d) < 0.02);
});

test('rendering: a vertical BAR and a BOX go through the line renderer', () => {
  const model = parse('BAR 10,20,6,80\r\nBOX 10,20,210,120,4');
  const { svg, diagnostics } = PB.svgRenderer.render(model, { width: 800, height: 400 }, { textScale: 1 });
  assert.equal(diagnostics.length, 0);
  assert.match(svg, /<line x1="([\d.]+)" y1="[\d.]+" x2="\1" y2="[\d.]+"/);
  assert.match(svg, /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" class="stroke"/);
});

test('ERASE and REVERSE are still unsupported with the existing warning (ELLIPSE and CIRCLE are read since A2)', () => {
  for (const src of ['ERASE 10,10,100,50', 'REVERSE 10,10,100,50']) {
    const model = parse(src);
    assert.equal(model.items.length, 0, src);
    assert.equal(model.diagnostics.length, 1, src);
    assert.match(model.diagnostics[0].text, /^Comando no soportado por el visor: /, src);
  }
});
