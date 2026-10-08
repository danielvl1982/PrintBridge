const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TSPL component palette (T4): componentTemplates + buildComponent, driven by the `build` hook of each TSPL slice.
const PB = loadUpTo('js/palette.js');
const tspl = PB.languages.get('tspl');
const tpcl = PB.languages.get('tpcl');

const PRINT = 'PRINT 1,1';
const BASE = ['SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm', 'DIRECTION 1', 'CLS', 'TEXT 10,10,"3",0,1,1,"hello"', PRINT, ''].join('\r\n');
const KINDS = ['text', 'barcode', 'qr', 'line', 'box'];
const dotOf = dpi => PB.units.dotSize(dpi);

/** Builds a component; returns { out, model, added } where added is the one line the build put in. */
function build(text, kind, point = { x: 123, y: 456 }, { dpi = 203, viewRotation } = {}) {
  const out = tspl.buildComponent(text, kind, point, { dpi, viewRotation });
  const model = tspl.parse(out, { dpi });
  return { out, model, added: out.split(/\r\n|\n/).filter(line => !text.split(/\r\n|\n/).includes(line)) };
}

/** Top-left corner of the newest item, in 0.1 mm (a BAR keeps its midline, so the half thickness is taken off). */
function cornerOf(item) {
  if (item.kind === 'line') return { x: Math.min(item.x1, item.x2), y: item.rect ? Math.min(item.y1, item.y2) : item.y1 - item.width / 2 };
  return { x: item.x, y: item.y };
}
const newest = model => model.items[model.items.length - 1];
const problems = model => model.diagnostics.filter(d => d.level === 'error' || d.level === 'warning');

test('componentTemplates lists the seven kinds in palette order with Spanish labels', () => {
  assert.deepEqual(tspl.componentTemplates(), [
    { kind: 'text', label: 'Texto' },
    { kind: 'barcode', label: 'Código de barras' },
    { kind: 'qr', label: 'QR' },
    { kind: 'line', label: 'Línea' },
    { kind: 'box', label: 'Caja' },
    { kind: 'ellipse', label: 'Elipse' },
    { kind: 'circle', label: 'Círculo' },
  ]);
  // A copy: changing it does not change the next answer
  tspl.componentTemplates().pop();
  assert.equal(tspl.componentTemplates().length, 7);
});

test('each kind inserts exactly one command right before PRINT and leaves the rest of the label alone', () => {
  for (const kind of KINDS) {
    const { out, added } = build(BASE, kind);
    assert.equal(added.length, 1, kind);
    const lines = out.split('\r\n');
    assert.equal(lines.length, BASE.split('\r\n').length + 1, kind);
    assert.equal(lines[lines.indexOf(PRINT) - 1], added[0], kind);
    assert.equal(out.replace(`${added[0]}\r\n`, ''), BASE, kind);
  }
});

test('the templates use the agreed command layouts', () => {
  assert.equal(build(BASE, 'text', { x: 100, y: 100 }).added[0], 'TEXT 80,80,"3",0,1,1,"<#TEXTO1#>"');
  assert.match(build(BASE, 'barcode', { x: 100, y: 100 }).added[0], /^BARCODE 80,80,"128",\d+,1,0,2,2,"<#CODIGOBARRAS1#>"$/);
  assert.equal(build(BASE, 'qr', { x: 100, y: 100 }).added[0], 'QRCODE 80,80,M,4,A,0,"<#QR1#>"');
  assert.match(build(BASE, 'line', { x: 100, y: 100 }).added[0], /^BAR 80,80,\d+,\d+$/);
  assert.match(build(BASE, 'box', { x: 100, y: 100 }).added[0], /^BOX 80,80,\d+,\d+,\d+$/);
});

test('every inserted command parses back, without diagnostics, into the right kind at the drop point (+-1 dot)', () => {
  const expected = { text: 'text', barcode: 'barcode', qr: 'qr', line: 'line', box: 'line' };
  for (const dpi of [203, 300]) {
    for (const kind of KINDS) {
      const { model } = build(BASE, kind, { x: 123, y: 456 }, { dpi });
      assert.deepEqual(problems(model), [], `${kind} @${dpi}`);
      assert.equal(model.items.length, 2, `${kind} @${dpi}`);
      const item = newest(model);
      assert.equal(item.kind, expected[kind], `${kind} @${dpi}`);
      assert.equal(!!item.rect, kind === 'box', `${kind} @${dpi}`);
      const corner = cornerOf(item);
      assert.ok(Math.abs(corner.x - 123) <= dotOf(dpi), `${kind} x @${dpi}: ${corner.x}`);
      assert.ok(Math.abs(corner.y - 456) <= dotOf(dpi), `${kind} y @${dpi}: ${corner.y}`);
    }
  }
});

test('line and box have a sensible size in 0.1 mm at both resolutions', () => {
  for (const dpi of [203, 300]) {
    const line = newest(build(BASE, 'line', { x: 100, y: 100 }, { dpi }).model);
    assert.ok(Math.abs(Math.abs(line.x2 - line.x1) - 400) <= dotOf(dpi), `line length @${dpi}`);
    assert.ok(line.width >= dotOf(dpi), 'line thickness');
    const box = newest(build(BASE, 'box', { x: 100, y: 100 }, { dpi }).model);
    assert.ok(Math.abs(Math.abs(box.x2 - box.x1) - 300) <= dotOf(dpi), `box width @${dpi}`);
    assert.ok(Math.abs(Math.abs(box.y2 - box.y1) - 200) <= dotOf(dpi), `box height @${dpi}`);
  }
});

test('REFERENCE and SHIFT in force are subtracted so the item lands under the drop point', () => {
  const text = ['SIZE 100 mm,60 mm', 'REFERENCE 20,30', 'SHIFT 4,5', 'CLS', PRINT, ''].join('\r\n');
  for (const kind of KINDS) {
    const { model, added } = build(text, kind, { x: 500, y: 400 });
    assert.deepEqual(problems(model), [], kind);
    const corner = cornerOf(newest(model));
    assert.ok(Math.abs(corner.x - 500) <= dotOf(203), `${kind} x`);
    assert.ok(Math.abs(corner.y - 400) <= dotOf(203), `${kind} y`);
    // Offset in force: REFERENCE 20,30 + SHIFT 4,5 = 24,35 dots
    const x = Math.round(500 / dotOf(203)) - 24;
    const y = Math.round(400 / dotOf(203)) - 35;
    assert.ok(added[0].includes(` ${x},${y},`), `${kind}: ${added[0]}`);
  }
});

test('only the REFERENCE and SHIFT before PRINT apply to the new command', () => {
  const text = ['SIZE 100 mm,60 mm', 'CLS', PRINT, 'REFERENCE 50,50', ''].join('\r\n');
  const out = tspl.buildComponent(text, 'qr', { x: 500, y: 400 }, { dpi: 203 });
  const dots = /^QRCODE (\d+),(\d+),/m.exec(out);
  assert.equal(+dots[1], Math.round(500 / dotOf(203)));
});

test('the written dots are clamped at 0 (negative drop points and offsets larger than the point)', () => {
  assert.match(build(BASE, 'text', { x: -50, y: -20 }).added[0], /^TEXT 0,0,/);
  const text = ['SIZE 100 mm,60 mm', 'REFERENCE 50,50', 'CLS', PRINT, ''].join('\r\n');
  for (const kind of KINDS) {
    assert.match(build(text, kind, { x: 0, y: 0 }).added[0], /^[A-Z]+ 0,0,/, kind);
  }
});

test('the dots are whole numbers and follow the resolution', () => {
  assert.match(build(BASE, 'text', { x: 100, y: 100 }, { dpi: 203 }).added[0], /^TEXT 80,80,/);
  assert.match(build(BASE, 'text', { x: 100, y: 100 }, { dpi: 300 }).added[0], /^TEXT 118,118,/);
  assert.match(build(BASE, 'text', { x: 101.7, y: 33.3 }, { dpi: 300 }).added[0], /^TEXT 120,39,/);
});

test('text and barcode are written rotated (360 - viewRotation) % 360; the QR keeps rotation 0', () => {
  const expected = { 0: 0, 90: 270, 180: 180, 270: 90 };
  for (const [view, rotation] of Object.entries(expected)) {
    const options = { viewRotation: Number(view) };
    assert.equal(newest(build(BASE, 'text', undefined, options).model).rotation, rotation, `text @${view}`);
    assert.equal(newest(build(BASE, 'barcode', undefined, options).model).rotation, rotation, `barcode @${view}`);
    const qr = build(BASE, 'qr', undefined, options);
    assert.deepEqual(problems(qr.model), [], `qr @${view}`);
    assert.equal(newest(qr.model).native.rotation, 0, `qr @${view}`);
  }
  // Missing or invalid view rotation counts as 0
  assert.equal(newest(build(BASE, 'text', undefined, { viewRotation: 45 }).model).rotation, 0);
  assert.equal(newest(build(BASE, 'text').model).rotation, 0);
});

test('placeholders get a free counter: never the number of one already in the label, nor one built before', () => {
  const text = ['SIZE 100 mm,60 mm', 'CLS', 'TEXT 0,0,"3",0,1,1,"<#TEXTO1#>"', 'TEXT 0,0,"3",0,1,1,"#TEXTO2#"', PRINT, ''].join('\r\n');
  const first = build(text, 'text');
  assert.ok(first.added[0].endsWith('"<#TEXTO3#>"'));
  const second = build(first.out, 'text');
  assert.ok(second.added[0].endsWith('"<#TEXTO4#>"'));
  assert.deepEqual(PB.variables.namesInModel(second.model), ['TEXTO1', 'TEXTO2', 'TEXTO3', 'TEXTO4']);
  // Barcode and QR count apart, each with its own name
  const mixed = build(build(first.out, 'barcode').out, 'barcode');
  assert.deepEqual(PB.variables.namesInModel(mixed.model).filter(n => n.startsWith('CODIGOBARRAS')), ['CODIGOBARRAS1', 'CODIGOBARRAS2']);
  assert.deepEqual(PB.variables.namesInModel(build(mixed.out, 'qr').model).filter(n => n.startsWith('QR')), ['QR1']);
});

test('the line ending of the label is kept: CRLF stays CRLF and LF stays LF', () => {
  const lf = BASE.replace(/\r\n/g, '\n');
  for (const kind of KINDS) {
    assert.ok(!build(lf, kind).out.includes('\r'), `${kind} LF`);
    const crlf = build(BASE, kind).out;
    assert.equal(crlf.replace(/\r\n/g, ''), crlf.replace(/[\r\n]/g, ''), `${kind} CRLF`);
    assert.ok(!/(^|[^\r])\n/.test(crlf), `${kind} CRLF has no bare LF`);
  }
});

test('a label without PRINT gets the command at the end; an empty label gets just the command', () => {
  const noPrint = 'SIZE 100 mm,60 mm\r\nCLS\r\nTEXT 0,0,"3",0,1,1,"a"\r\n';
  assert.equal(build(noPrint, 'qr', { x: 100, y: 100 }).out, `${noPrint}QRCODE 80,80,M,4,A,0,"<#QR1#>"\r\n`);
  assert.equal(build('SIZE 100 mm,60 mm', 'box', { x: 100, y: 100 }).out.split('\n').length, 2);
  const empty = tspl.buildComponent('', 'text', { x: 100, y: 100 }, { dpi: 203 });
  assert.equal(empty, 'TEXT 80,80,"3",0,1,1,"<#TEXTO1#>"\n');
  assert.equal(tspl.parse(empty, { dpi: 203 }).items.length, 1);
});

test('DIRECTION 0 is edited as DIRECTION 1', () => {
  const text = BASE.replace('DIRECTION 1', 'DIRECTION 0');
  const { out, model } = build(text, 'text', { x: 100, y: 100 });
  assert.match(out, /TEXT 80,80,"3",0,1,1,"<#TEXTO1#>"/);
  assert.ok(Math.abs(cornerOf(newest(model)).x - 100) <= dotOf(203));
});

test('an unknown kind (or the image, which TSPL does not insert) and an invalid point leave the text unchanged', () => {
  for (const kind of ['image', 'nope', undefined]) assert.equal(tspl.buildComponent(BASE, kind, { x: 1, y: 1 }, { dpi: 203 }), BASE);
  for (const point of [undefined, null, { x: NaN, y: 1 }, { x: 1, y: Infinity }]) {
    assert.equal(tspl.buildComponent(BASE, 'text', point, { dpi: 203 }), BASE);
  }
});

test('the moved or edited result of a new component keeps working with the TSPL engines', () => {
  const { out, model } = build(BASE, 'text', { x: 100, y: 100 });
  const item = newest(model);
  const moved = tspl.moveItem(out, item, 50, 0, { dpi: 203 });
  assert.notEqual(moved, out);
  assert.equal(tspl.describeItem(item, out).fields.length > 0, true);
});

test('the palette offers the image for the languages that can write it (TPCL and TSPL)', () => {
  const image = { kind: 'image', label: 'Imagen' };
  assert.equal(typeof PB.ui.paletteEntries, 'function');
  assert.deepEqual(PB.ui.paletteEntries(tspl, image).map(e => e.kind), [...KINDS, 'ellipse', 'circle', 'image']);
  assert.deepEqual(PB.ui.paletteEntries(tpcl, image).map(e => e.kind), [...KINDS, 'image']);
  assert.deepEqual(PB.ui.paletteEntries(null, image), []);
  // Language capability, documented in js/core/languages.js
  assert.equal(tpcl.insertImage, true);
  assert.equal(tspl.insertImage, true);
});
