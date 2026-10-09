const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// The text block (TSPL BLOCK, ZPL ^FB): the neutral item.block, its word wrap in the SVG renderer and the readers of both commands.
const PB = loadUpTo('js/drawing.js');
const tspl = PB.languages.get('tspl');
const zpl = PB.languages.get('zpl');
const { wrapBlock, advanceOf } = PB.slices.text;
const DOT = 254 / 203;
const near = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
const one = (language, src, opts = { dpi: 203 }) => {
  const model = language.parse(src, opts);
  assert.equal(model.items.length, 1, JSON.stringify(model.diagnostics));
  return model.items[0];
};

// A mono font of size 100 and scaleX 1 advances 60 per character: a block 300 wide holds 5 characters per line
const MONO = { size: 100, scaleX: 1, family: 'mono', weight: 400, style: 'normal' };
const block = (o = {}) => ({ width: 300, align: 'left', lineSpace: 0, ...o });
const texts = r => r.lines.map(l => l.text);

// ---- wrapBlock (pure geometry)

test('wrapBlock: greedy word wrap with one advance per character', () => {
  const r = wrapBlock('hello world foo', block(), MONO);
  assert.deepEqual(texts(r), ['hello', 'world', 'foo']);
  assert.equal(r.perLine, 5);
  assert.equal(r.pitch, 100);
});

test('wrapBlock: the horizontal stretch narrows what a line holds', () => {
  assert.equal(wrapBlock('a', block({ width: 300 }), { ...MONO, scaleX: 2 }).perLine, 2);
  assert.equal(wrapBlock('a', block({ width: 300 }), { ...MONO, scaleX: 0.5 }).perLine, 10);
});

test('wrapBlock: the advance depends on the family (mono 0.6, sans 0.55, bold sans 0.59, serif 0.5)', () => {
  near(advanceOf({ family: 'mono' }), 0.6);
  near(advanceOf({ family: 'sans', weight: 400 }), 0.55);
  near(advanceOf({ family: 'sans', weight: 700 }), 0.59);
  near(advanceOf({ family: 'serif', weight: 400 }), 0.5);
  near(advanceOf({ family: 'mono', weight: 700 }), 0.6);
});

test('wrapBlock: a word longer than the line is cut at the edge, spaces at a break are dropped', () => {
  assert.deepEqual(texts(wrapBlock('abcdefghijkl', block(), MONO)), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(texts(wrapBlock('ab  cd   ef', block(), MONO)), ['ab cd', 'ef']);
  assert.deepEqual(texts(wrapBlock('abc defghi', block(), MONO)), ['abc', 'defgh', 'i']);
});

test('wrapBlock: an explicit break starts a line, an empty paragraph is an empty line', () => {
  assert.deepEqual(texts(wrapBlock('ab\ncd\n\nef', block(), MONO)), ['ab', 'cd', '', 'ef']);
  assert.deepEqual(texts(wrapBlock('ab\r\ncd', block(), MONO)), ['ab', 'cd']);
});

test('wrapBlock: lines limits how many are kept; no width draws nothing', () => {
  assert.deepEqual(texts(wrapBlock('aa bb cc dd ee', block({ width: 120, lines: 2 }), MONO)), ['aa', 'bb']);
  assert.deepEqual(texts(wrapBlock('aa bb', block({ width: 0 }), MONO)), []);
  assert.deepEqual(texts(wrapBlock('aa bb', block({ width: 50 }), MONO)), []);
  assert.deepEqual(texts(wrapBlock('', block(), MONO)), ['']);
});

test('wrapBlock: the pitch is the character height plus the (signed) line space', () => {
  assert.equal(wrapBlock('a', block({ lineSpace: 25 }), MONO).pitch, 125);
  assert.equal(wrapBlock('a', block({ lineSpace: -30 }), MONO).pitch, 70);
  assert.equal(wrapBlock('a', block({ lineSpace: -500 }), MONO).pitch, 1);
});

test('wrapBlock: justify stretches every line but the last of a paragraph and a single word', () => {
  const r = wrapBlock('aa bb cc dd\nxx yy', block({ width: 360, align: 'justify' }), MONO);
  assert.deepEqual(texts(r), ['aa bb', 'cc dd', 'xx yy']);
  assert.deepEqual(r.lines.map(l => l.justify), [true, false, false]);
  assert.equal(wrapBlock('word', block({ align: 'justify' }), MONO).lines[0].justify, false);
  assert.equal(wrapBlock('abcd efgh', block({ width: 600, align: 'justify' }), MONO).lines[0].justify, false);
});

// ---- the SVG renderer

const svgOf = (model, opts = {}) => {
  const view = PB.sizes.view(model, null);
  return PB.svgRenderer.render(model, view, { textScale: 1, showGrid: false, showAnchors: false, values: {}, ...opts }).svg;
};
const labelWith = item => ({ language: 'tspl', size: { width: 1000, height: 600, pitch: null, gap: null, native: {} }, items: [item], diagnostics: [] });
const text = (o = {}) => ({ kind: 'text', x: 100, y: 200, rotation: 0, font: MONO, data: 'hello world foo', ...o });

test('render: a block is one <text> with a <tspan> per wrapped line, the lines advance by the pitch', () => {
  const svg = svgOf(labelWith(text({ block: block({ lineSpace: 10 }) })));
  assert.equal((svg.match(/<text /g) || []).length, 1);
  const spans = svg.match(/<tspan [^>]*>[^<]*<\/tspan>/g);
  assert.equal(spans.length, 3);
  assert.match(spans[0], /x="0" dy="0">hello</);
  assert.match(spans[1], /x="0" dy="110">world</);
  assert.match(spans[2], /dy="110">foo</);
});

test('render: center and right place the lines on the block (width over the stretch) with text-anchor', () => {
  const center = svgOf(labelWith(text({ font: { ...MONO, scaleX: 2 }, block: block({ width: 600, align: 'center' }) })));
  assert.match(center, /<tspan x="150" dy="0" text-anchor="middle">/);
  const right = svgOf(labelWith(text({ block: block({ align: 'right' }) })));
  assert.match(right, /<tspan x="300" dy="0" text-anchor="end">hello</);
});

test('render: justify spreads the words with word-spacing; the last line stays left', () => {
  const svg = svgOf(labelWith(text({ data: 'aa bb cc', block: block({ width: 360, align: 'justify' }) })));
  assert.match(svg, /<tspan x="0" dy="0" word-spacing="60">aa bb<\/tspan>/);
  assert.match(svg, /<tspan x="0" dy="100">cc<\/tspan>/);
});

test('render: lines clips, a rotated block turns with the text, variables are substituted before the wrap, markup is escaped', () => {
  const clipped = svgOf(labelWith(text({ block: block({ lines: 2 }) })));
  assert.equal((clipped.match(/<tspan /g) || []).length, 2);
  assert.match(svgOf(labelWith(text({ rotation: 90, block: block() }))), /rotate\(90\)/);
  const values = svgOf(labelWith(text({ data: '#NAME# x', block: block() })), { values: { NAME: 'abcdefg' } });
  assert.match(values, />abcde<\/tspan>/);
  assert.match(svgOf(labelWith(text({ data: '<b>', block: block() }))), />&lt;b&gt;<\/tspan>/);
});

test('render: a text without block is unchanged (no tspan)', () => {
  assert.ok(!/<tspan/.test(svgOf(labelWith(text()))));
});

// ---- TSPL BLOCK

test('TSPL BLOCK reads width, lines (height / pitch), align and the line space into item.block', () => {
  const item = one(tspl, 'BLOCK 10,20,400,200,"2",0,1,1,"Hello world"');
  assert.equal(item.kind, 'text');
  assert.equal(item.data, 'Hello world');
  near(item.block.width, 400 * DOT);
  assert.equal(item.block.lines, 10); // font 2: 20 dots high, 200 / 20
  assert.equal(item.block.align, 'left');
  assert.equal(item.block.lineSpace, 0);
  assert.deepEqual([item.native.width, item.native.height], [400, 200]);
});

test('TSPL BLOCK: the optional arguments are space, align (0/1 left, 2 center, 3 right) and fit', () => {
  const item = one(tspl, 'BLOCK 0,0,300,100,"1",0,1,1,3,2,1,"abc"');
  assert.equal(item.block.align, 'center');
  near(item.block.lineSpace, 3 * DOT);
  assert.equal(item.block.lines, Math.floor(100 / (12 + 3)));
  assert.equal(one(tspl, 'BLOCK 0,0,300,100,"1",0,1,1,3,3,"abc"').block.align, 'right');
  assert.equal(one(tspl, 'BLOCK 0,0,300,100,"1",0,1,1,3,1,"abc"').block.align, 'left');
  assert.equal(one(tspl, 'BLOCK 0,0,300,100,"1",0,1,1,3,0,"abc"').block.align, 'left');
});

test('TSPL BLOCK: a scalable font has point sizes, the pitch is its height in dots; at least one line', () => {
  const item = one(tspl, 'BLOCK 0,0,300,100,"0",0,8,10,"abc"');
  const pitch = Math.round(10 * PB.units.UNITS_PER_POINT / DOT);
  assert.equal(item.block.lines, Math.floor(100 / pitch));
  assert.equal(one(tspl, 'BLOCK 0,0,300,5,"2",0,1,1,"abc"').block.lines, 1);
});

test('TSPL BLOCK: \\[R], \\[L] and \\[R]\\[L] are line breaks ("\\n" in the data); a quote escape is a quote', () => {
  assert.equal(one(tspl, 'BLOCK 0,0,300,100,"1",0,1,1,"one\\[R]two\\[L]three\\[R]\\[L]four \\["]q\\["]"').data, 'one\ntwo\nthree\nfour "q"');
});

test('TSPL BLOCK: no longer reports the "drawn as one line" info; a bad width keeps a line with an info; an unknown align is left with an info', () => {
  const model = tspl.parse('BLOCK 10,20,400,200,"2",0,1,1,"Hello"', { dpi: 203 });
  assert.deepEqual(model.diagnostics, []);
  const bad = tspl.parse('BLOCK 10,20,0,200,"2",0,1,1,"Hello"', { dpi: 203 });
  assert.equal(bad.items[0].block, undefined);
  assert.match(bad.diagnostics[0].text, /ancho no válido/);
  const align = tspl.parse('BLOCK 10,20,400,200,"2",0,1,1,0,9,"Hello"', { dpi: 203 });
  assert.equal(align.items[0].block.align, 'left');
  assert.match(align.diagnostics[0].text, /alineación 9 no válida/);
});

test('TSPL TEXT is not a block', () => {
  assert.equal(one(tspl, 'TEXT 10,20,"2",0,1,1,"Hello"').block, undefined);
});

test('a TSPL BLOCK renders wrapped in the preview', () => {
  const model = tspl.parse('SIZE 100 mm,60 mm\r\nBLOCK 40,30,96,100,"1",0,1,1,"aaaa bbbb cccc"\r\n', { dpi: 203 });
  // font 1 is 8 x 12 dots: 12 characters per 96 dots
  const svg = svgOf(model);
  assert.equal((svg.match(/<tspan /g) || []).length, 2);
  assert.match(svg, />aaaa bbbb<\/tspan>/);
});

// ---- ZPL ^FB

test('ZPL ^FB reads width, lines, line space, justification and the indent', () => {
  const item = one(zpl, '^XA^FO10,20^A0N,30,30^FB400,3,5,C,20^FDHello world^FS^XZ');
  assert.equal(item.kind, 'text');
  assert.equal(item.ref, 'A');
  assert.equal(item.data, 'Hello world');
  near(item.block.width, 400 * DOT);
  assert.equal(item.block.lines, 3);
  assert.equal(item.block.align, 'center');
  near(item.block.lineSpace, 5 * DOT);
  assert.deepEqual(item.native.fb, { width: 400, lines: 3, space: 5, align: 'C', indent: 20 });
});

test('ZPL ^FB defaults (guide): lines 1, space 0, left, indent 0; J is justified, R right', () => {
  const item = one(zpl, '^XA^FO10,20^A0N,30,30^FB400^FDHello^FS^XZ');
  assert.deepEqual([item.block.lines, item.block.lineSpace, item.block.align], [1, 0, 'left']);
  assert.equal(one(zpl, '^XA^FO10,20^A0N,30,30^FB400,2,,J^FDHello^FS^XZ').block.align, 'justify');
  assert.equal(one(zpl, '^XA^FO10,20^A0N,30,30^FB400,2,,r^FDHello^FS^XZ').block.align, 'right');
  near(one(zpl, '^XA^FO10,20^A0N,30,30^FB400,2,-4^FDHello^FS^XZ').block.lineSpace, -4 * DOT);
});

test('ZPL ^FB works with the default font (no ^A) and before or after ^A; it is not reported as unsupported', () => {
  const noA = zpl.parse('^XA^FO10,20^FB400,2,0,L,0^FDHello^FS^XZ', { dpi: 203 });
  assert.equal(noA.items.length, 1);
  assert.equal(noA.items[0].ref, 'FD');
  assert.equal(noA.items[0].block.lines, 2);
  assert.deepEqual(noA.diagnostics, []);
  const before = zpl.parse('^XA^FO10,20^FB400,2^A0N,30,30^FDHello^FS^XZ', { dpi: 203 });
  assert.equal(before.items[0].block.lines, 2);
  assert.deepEqual(before.diagnostics, []);
});

test('ZPL ^FB: "\\&" is a line break ("\\n" in the data), also through ^FH; a text without ^FB keeps it literally', () => {
  assert.equal(one(zpl, '^XA^FO10,20^A0N,30,30^FB400,3^FDone\\&two^FS^XZ').data, 'one\ntwo');
  assert.equal(one(zpl, '^XA^FO10,20^A0N,30,30^FB400,3^FH^FDone_5E\\&two^FS^XZ').data, 'one^\ntwo');
  assert.equal(one(zpl, '^XA^FO10,20^A0N,30,30^FDone\\&two^FS^XZ').data, 'one\\&two');
});

test('ZPL ^FB without a width keeps a line with one info; a bad justification is left with one info', () => {
  const none = zpl.parse('^XA^FO10,20^A0N,30,30^FB^FDHello^FS^XZ', { dpi: 203 });
  assert.equal(none.items[0].block, undefined);
  assert.equal(none.diagnostics.filter(d => /sin ancho/.test(d.text)).length, 1);
  const bad = zpl.parse('^XA^FO10,20^A0N,30,30^FB400,2,0,X^FDHello^FS^XZ', { dpi: 203 });
  assert.equal(bad.items[0].block.align, 'left');
  assert.equal(bad.diagnostics.filter(d => /justificación/.test(d.text)).length, 1);
});

test('ZPL ^FB on a bar code is ignored with one info', () => {
  const model = zpl.parse('^XA^FO10,20^FB400,2^BCN,50,Y,N,N^FD123^FS^XZ', { dpi: 203 });
  assert.equal(model.items.length, 1);
  assert.equal(model.diagnostics.filter(d => /solo se aplica al texto/.test(d.text)).length, 1);
});

test('ZPL ^FO block: the first line sits at the origin like a line of text; ^FT is the baseline of the LAST line', () => {
  const line = one(zpl, '^XA^FO50,100^A0N,30,30^FDHello^FS^XZ');
  const fo = one(zpl, '^XA^FO50,100^A0N,30,30^FB400,3,0,L,0^FDHello^FS^XZ');
  near(fo.x, line.x);
  near(fo.y, line.y);
  // ^FT at y = 100: the baseline of line 3, so the first one is 2 pitches (30 dots each) up
  const ft = one(zpl, '^XA^FT50,100^A0N,30,30^FB400,3,0,L,0^FDHello^FS^XZ');
  near(ft.x, 50 * DOT);
  near(ft.y, (100 - 60) * DOT);
  const spaced = one(zpl, '^XA^FT50,100^A0N,30,30^FB400,3,10,L,0^FDHello^FS^XZ');
  near(spaced.y, (100 - 80) * DOT);
});

test('a ZPL block renders wrapped in the preview', () => {
  const model = zpl.parse('^XA^PW800^LL400^FO20,20^A0N,30,30^FB100,2,0,L,0^FDaaa bbb ccc\\&dd^FS^XZ', { dpi: 203 });
  assert.ok(model.items[0].block);
  assert.ok(/<tspan /.test(svgOf(model)));
});

// ---- emit (B2)

const emit = (id, model, dpi = 203) => PB.languages.emit(id, model, { dpi });
const levelsOf = (r, ...wanted) => r.diagnostics.filter(d => wanted.includes(d.level)).map(d => d.text);
const convert = (src, to, from, dpi = 203) => PB.convert.run(src, to, { dpi, sourceId: from });

test('TSPL emit: a block writes BLOCK with width, height = lines * pitch, space and align', () => {
  const src = 'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nBLOCK 10,20,400,220,"2",0,1,1,2,2,"Hello world"\r\nPRINT 1,1\r\n';
  const out = emit('tspl', tspl.parse(src, { dpi: 203 }));
  assert.match(out.text, /^BLOCK 10,20,400,220,"2",0,1,1,2,2,"Hello world"$/m);
  assert.deepEqual(levelsOf(out, 'warning', 'info'), []);
});

test('TSPL emit: omitted optional arguments stay omitted; right aligned without a space writes 0 then 3; the breaks are \\[R]', () => {
  const plain = emit('tspl', tspl.parse('BLOCK 10,20,400,200,"2",0,1,1,"a\\[R]b"', { dpi: 203 }));
  assert.ok(plain.text.includes('BLOCK 10,20,400,200,"2",0,1,1,"a\\[R]b"'), plain.text);
  const right = emit('tspl', tspl.parse('BLOCK 10,20,400,200,"2",0,1,1,0,3,"a"', { dpi: 203 }));
  assert.match(right.text, /^BLOCK 10,20,400,200,"2",0,1,1,0,3,"a"$/m);
});

test('TSPL emit: a block without lines gets the height the wrapped text needs; justify is written left with an info', () => {
  const model = tspl.parse('BLOCK 0,0,96,100,"1",0,1,1,"aaaa bbbb cccc"', { dpi: 203 });
  delete model.items[0].block.lines;
  model.items[0].block.align = 'justify';
  const out = emit('tspl', model);
  // 12 characters per line: 2 lines of 12 dots
  assert.match(out.text, /^BLOCK 0,0,96,24,"1",0,1,1,"aaaa bbbb cccc"$/m);
  assert.ok(levelsOf(out, 'info').some(t => /justificado/.test(t)));
});

test('TSPL emit: a text with a line break and no block still reports the break; a block keeps its fit argument', () => {
  const line = tspl.parse('TEXT 10,20,"2",0,1,1,"a"', { dpi: 203 });
  line.items[0].data = 'a\nb';
  assert.ok(levelsOf(emit('tspl', line), 'warning').some(t => /saltos de línea/.test(t)));
  const fit = emit('tspl', tspl.parse('BLOCK 10,20,400,200,"2",0,1,1,0,1,1,"a"', { dpi: 203 }));
  assert.match(fit.text, /^BLOCK 10,20,400,200,"2",0,1,1,0,1,1,"a"$/m);
});

test('TSPL BLOCK round trips through its own emit (model equal), with scalable and rotated fonts', () => {
  for (const cmd of ['BLOCK 10,20,400,200,"2",0,1,1,"Hello world foo bar"', 'BLOCK 30,40,300,150,"0",90,8,10,4,2,"abc def\\[R]ghi"', 'BLOCK 5,5,500,300,"3",180,2,2,0,3,"x"']) {
    const a = one(tspl, cmd);
    const out = emit('tspl', { language: 'tspl', size: { width: 1000, height: 600, native: {} }, items: [a], diagnostics: [] });
    const b = one(tspl, out.text.split('\r\n').find(l => l.startsWith('BLOCK')));
    assert.deepEqual([b.block.lines, b.block.align, b.data], [a.block.lines, a.block.align, a.data], cmd);
    near(b.block.width, a.block.width);
    near(b.block.lineSpace, a.block.lineSpace);
    near(b.x, a.x);
    near(b.y, a.y);
  }
});

test('ZPL emit: a block writes ^FB before the data with \\& for the breaks; ^FO stays ^FO and ^FT stays ^FT', () => {
  const fo = emit('zpl', zpl.parse('^XA^PW800^LL400^FO50,100^A0N,30,30^FB400,3,5,C,20^FDone\\&two^FS^XZ', { dpi: 203 }));
  assert.ok(fo.text.includes('^FO50,100^A0N,30,30^FB400,3,5,C,20^FDone\\&two^FS'), fo.text);
  assert.deepEqual(levelsOf(fo, 'warning', 'info'), []);
  const ft = emit('zpl', zpl.parse('^XA^FT50,100^A0N,30,30^FB400,3,0,R^FDhi^FS^XZ', { dpi: 203 }));
  assert.ok(ft.text.includes('^FT50,100^A0N,30,30^FB400,3,0,R^FDhi^FS'), ft.text);
});

test('ZPL emit: from another language a block is placed by its first baseline (^FT writes the last line one)', () => {
  const model = tspl.parse('BLOCK 100,100,400,60,"3",0,1,1,0,2,"Hello world"', { dpi: 203 });
  const out = emit('zpl', model);
  const back = one(zpl, out.text, { dpi: 203 });
  near(back.x, model.items[0].x, 0.7);
  near(back.y, model.items[0].y, 0.7);
  assert.deepEqual([back.block.lines, back.block.align], [model.items[0].block.lines, 'center']);
  near(back.block.width, model.items[0].block.width, 0.7);
});

test('ZPL emit: justify is written J, a block without lines gets the wrapped count, a counter is written as plain data with an info', () => {
  const model = zpl.parse('^XA^FO50,100^A0N,30,30^FB300,2,0,J^FDaaa bbb ccc ddd eee^FS^XZ', { dpi: 203 });
  delete model.items[0].block.lines;
  const out = emit('zpl', model);
  assert.match(out.text, /\^FB300,\d+,0,J/);
  const withCounter = zpl.parse('^XA^FO50,100^A0N,30,30^FB300,2,0,J^FD0001^FS^XZ', { dpi: 203 });
  withCounter.items[0].counter = { step: 1 };
  const r = emit('zpl', withCounter);
  assert.ok(!/\^SN/.test(r.text));
  assert.ok(levelsOf(r, 'info').some(t => /contador/.test(t)));
});

test('TPCL emit: a block whose font is vector-only (PV) is one line of text with ONE warning that the block needs a bitmap font; the breaks become spaces', () => {
  const model = zpl.parse('^XA^FO50,100^A0N,30,30^FB300,3,0,L^FDone\\&two^FS^XZ', { dpi: 203 });
  model.items.push({ ...zpl.parse('^XA^FO50,300^A0N,30,30^FB300,3,0,L^FDthree^FS^XZ', { dpi: 203 }).items[0] });
  const out = emit('tpcl', model);
  const warnings = levelsOf(out, 'warning').filter(t => /bloque/.test(t));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /necesita una fuente de mapa de bits [(]PC[)]/);
  assert.match(out.text, /one two/);
  assert.ok(!/saltos de línea/.test(levelsOf(out, 'warning').join('|')));
  const back = PB.languages.get('tpcl').parse(out.text, { dpi: 203 });
  assert.ok(back.items.every(i => i.block === undefined));
});

test('TSPL <-> ZPL carry the block: width, lines, alignment, line space and the breaks', () => {
  const tsplSrc = 'SIZE 100 mm,60 mm\r\nBLOCK 40,60,300,100,"3",0,1,1,4,2,"alpha beta\\[R]gamma delta epsilon"\r\nPRINT 1,1\r\n';
  const a = tspl.parse(tsplSrc, { dpi: 203 }).items[0];
  const z = convert(tsplSrc, 'zpl', 'tspl');
  const b = zpl.parse(z.text, { dpi: 203 }).items[0];
  assert.equal(b.data, a.data);
  assert.equal(b.block.lines, a.block.lines);
  assert.equal(b.block.align, 'center');
  near(b.block.width, a.block.width, 0.7);
  near(b.block.lineSpace, a.block.lineSpace, 0.7);
  const back = convert(z.text, 'tspl', 'zpl');
  const c = tspl.parse(back.text, { dpi: 203 }).items[0];
  assert.equal(c.data, a.data);
  assert.equal(c.block.lines, a.block.lines);
  assert.equal(c.block.align, 'center');
  near(c.block.width, a.block.width, 0.7);
});

test('a block with a vector-only font converted to TPCL warns once and reads back as a line', () => {
  const r = convert('SIZE 100 mm,60 mm\r\nBLOCK 40,60,300,100,"1",0,1,1,"alpha beta"\r\nPRINT 1,1\r\n', 'tpcl', 'tspl');
  assert.equal(r.diagnostics.filter(d => /necesita una fuente de mapa de bits [(]PC[)]/.test(d.text)).length, 1);
});
