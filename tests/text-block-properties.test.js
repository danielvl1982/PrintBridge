const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// The Tipo select of a text (Línea de texto / Bloque de texto) and the block fields of the Propiedades panel, per language:
// TSPL TEXT <-> BLOCK and ZPL ^FB added / removed, written through the language edit engines (one rewritten text = one undoable edit).
const PB = loadUpTo('js/ui.js');
const tspl = PB.languages.get('tspl');
const zpl = PB.languages.get('zpl');
const tpcl = PB.languages.get('tpcl');
const DPI = 203;
const DOT = 254 / DPI;

const byKey = (d, key) => d.fields.find(f => f.key === key);
const keys = d => d.fields.map(f => f.key);

// ---- TSPL

const THEAD = 'SIZE 100 mm,60 mm\r\nCLS\r\n';
const TTAIL = 'PRINT 1,1\r\n';
const tdoc = (...lines) => THEAD + lines.map(l => l + '\r\n').join('') + TTAIL;
const titem = (text, i = 0) => tspl.parse(text, { dpi: DPI }).items[i];
const tdescribe = (text, i = 0) => tspl.describeItem(titem(text, i), text, { dpi: DPI });
const tupdate = (text, changes, i = 0) => tspl.updateItem(text, titem(text, i), changes, { dpi: DPI });
const tline = text => text.split('\r\n').find(l => /^(TEXT|BLOCK) /.test(l));

test('TSPL TEXT: Tipo is the first field, "line", with the two options in order', () => {
  const d = tdescribe(tdoc('TEXT 100,200,"3",0,1,1,"Hello"'));
  assert.deepEqual(keys(d).slice(0, 2), ['kind', 'rotation']);
  const kind = byKey(d, 'kind');
  assert.deepEqual([kind.label, kind.type, kind.value], ['Tipo', 'select', 'line']);
  assert.deepEqual(kind.options, [{ value: 'line', label: 'Línea de texto' }, { value: 'block', label: 'Bloque de texto' }]);
});

test('TSPL BLOCK: Tipo "block", then width, lines, alignment (3 options), then the usual fields of the command', () => {
  const d = tdescribe(tdoc('BLOCK 100,200,300,150,"3",90,2,1,4,2,"Some, text"'));
  assert.deepEqual(keys(d), ['kind', 'blockWidth', 'blockLines', 'blockAlign', 'rotation', 'xmul', 'ymul', 'font', 'content']);
  assert.equal(byKey(d, 'kind').value, 'block');
  assert.deepEqual([byKey(d, 'blockWidth').value, byKey(d, 'blockWidth').label], [300, 'Ancho del bloque (puntos)']);
  assert.deepEqual([byKey(d, 'blockLines').value, byKey(d, 'blockLines').label], [Math.floor(150 / (24 + 4)), 'Líneas máx.']);
  assert.equal(byKey(d, 'blockAlign').value, 'center');
  assert.deepEqual(byKey(d, 'blockAlign').options.map(o => o.value), ['left', 'center', 'right']);
  assert.deepEqual([byKey(d, 'rotation').value, byKey(d, 'xmul').value, byKey(d, 'ymul').value, byKey(d, 'content').value], [90, 2, 1, 'Some, text']);
});

test('TSPL: a counter text has no Tipo; the model path (no text) describes the kind too', () => {
  const counter = tdescribe(tdoc('TEXT 100,200,"3",0,1,1,"N"+@1'));
  assert.ok(!keys(counter).includes('kind'));
  const item = titem(tdoc('BLOCK 100,200,300,150,"3",0,1,1,"x"'));
  const model = tspl.describeItem(item, undefined, { dpi: DPI });
  assert.equal(byKey(model, 'kind').value, 'block');
  assert.equal(byKey(model, 'blockWidth').value, 300);
});

test('TSPL: Tipo -> block rewrites only that TEXT into BLOCK with 20 characters of width and the lines the text needs', () => {
  const text = tdoc('TEXT 10,10,"1",0,1,1,"Other"', 'TEXT 100,200,"3",0,1,1,"one two three four five six seven eight nine ten"');
  const out = tupdate(text, { kind: 'block' }, 1);
  // font 3 is 16 x 24 dots: 20 characters = 320 dots; the wrap makes 3 lines of 24 dots
  assert.equal(out, tdoc('TEXT 10,10,"1",0,1,1,"Other"', 'BLOCK 100,200,320,72,"3",0,1,1,"one two three four five six seven eight nine ten"'));
  const back = titem(out, 1);
  assert.equal(back.block.lines, 3);
  assert.equal(back.block.align, 'left');
});

test('TSPL: Tipo -> block keeps the rotation, the multipliers and the content as written, and drops the TEXT alignment argument', () => {
  const out = tupdate(tdoc('TEXT 100,200,"2",90,2,3,2,"say \\["]hi\\["]"'), { kind: 'block' });
  assert.match(tline(out), /^BLOCK 100,200,\d+,\d+,"2",90,2,3,"say \\\["\]hi\\\["\]"$/);
});

test('TSPL: Tipo -> block on a scalable font sizes the width from the point size', () => {
  const out = tupdate(tdoc('TEXT 100,200,"0",0,10,12,"Hi"'), { kind: 'block' });
  const item = titem(out);
  assert.ok(item.block.width > 0);
  assert.equal(item.block.lines, 1);
  assert.equal(item.data, 'Hi');
});

test('TSPL: Tipo -> line rewrites BLOCK into TEXT: the block arguments go, the breaks become spaces', () => {
  const text = tdoc('BLOCK 100,200,300,150,"3",0,1,1,4,2,"a\\[R]b\\[R]\\[L]c"', 'TEXT 1,1,"1",0,1,1,"z"');
  assert.equal(tupdate(text, { kind: 'line' }), tdoc('TEXT 100,200,"3",0,1,1,"a b c"', 'TEXT 1,1,"1",0,1,1,"z"'));
});

test('TSPL: Tipo to what it already is changes nothing', () => {
  const text = tdoc('BLOCK 100,200,300,150,"3",0,1,1,"x"', 'TEXT 1,1,"1",0,1,1,"z"');
  assert.equal(tupdate(text, { kind: 'block' }), text);
  assert.equal(tupdate(text, { kind: 'line' }, 1), text);
  assert.equal(tupdate(text, { kind: 'other' }), text);
});

test('TSPL: the width edits the third argument; lines write height = lines * pitch (space included)', () => {
  const text = tdoc('BLOCK 100,200,300,150,"3",0,1,1,"x"');
  assert.equal(tupdate(text, { blockWidth: 410 }), tdoc('BLOCK 100,200,410,150,"3",0,1,1,"x"'));
  assert.equal(tupdate(text, { blockLines: 5 }), tdoc('BLOCK 100,200,300,120,"3",0,1,1,"x"'));
  const spaced = tdoc('BLOCK 100,200,300,150,"3",0,1,1,4,1,"x"');
  assert.equal(tupdate(spaced, { blockLines: 5 }), tdoc('BLOCK 100,200,300,140,"3",0,1,1,4,1,"x"'));
  // out of range values are clamped, not written as they are
  assert.equal(tupdate(text, { blockWidth: 0 }), tdoc('BLOCK 100,200,1,150,"3",0,1,1,"x"'));
  assert.equal(tupdate(text, { blockLines: 0 }), tdoc('BLOCK 100,200,300,24,"3",0,1,1,"x"'));
});

test('TSPL: lines of a scalable font use the point size pitch', () => {
  const text = tdoc('BLOCK 100,200,300,150,"0",0,8,10,"x"');
  const pitch = Math.round(10 * PB.units.UNITS_PER_POINT / DOT);
  assert.equal(tupdate(text, { blockLines: 3 }), tdoc(`BLOCK 100,200,300,${3 * pitch},"0",0,8,10,"x"`));
});

test('TSPL: the alignment fills the optional arguments (space 0 by default), keeps the space and the fit', () => {
  assert.equal(tupdate(tdoc('BLOCK 1,2,300,150,"3",0,1,1,"x"'), { blockAlign: 'center' }), tdoc('BLOCK 1,2,300,150,"3",0,1,1,0,2,"x"'));
  assert.equal(tupdate(tdoc('BLOCK 1,2,300,150,"3",0,1,1,"x"'), { blockAlign: 'right' }), tdoc('BLOCK 1,2,300,150,"3",0,1,1,0,3,"x"'));
  assert.equal(tupdate(tdoc('BLOCK 1,2,300,150,"3",0,1,1,5,"x"'), { blockAlign: 'right' }), tdoc('BLOCK 1,2,300,150,"3",0,1,1,5,3,"x"'));
  assert.equal(tupdate(tdoc('BLOCK 1,2,300,150,"3",0,1,1,5,1,1,"x"'), { blockAlign: 'center' }), tdoc('BLOCK 1,2,300,150,"3",0,1,1,5,2,1,"x"'));
  assert.equal(tupdate(tdoc('BLOCK 1,2,300,150,"3",0,1,1,0,2,"x"'), { blockAlign: 'left' }), tdoc('BLOCK 1,2,300,150,"3",0,1,1,0,0,"x"'));
  // left on a block with no optional arguments is already what it is
  const plain = tdoc('BLOCK 1,2,300,150,"3",0,1,1,"x"');
  assert.equal(tupdate(plain, { blockAlign: 'left' }), plain);
});

test('TSPL: the other fields of a BLOCK edit their own arguments (rotation, multipliers, font, content)', () => {
  const text = tdoc('BLOCK 1,2,300,150,"3",0,1,1,4,2,"x, y"');
  assert.equal(tupdate(text, { rotation: 90, xmul: 2, ymul: 3, font: '4' }), tdoc('BLOCK 1,2,300,150,"4",90,2,3,4,2,"x, y"'));
  assert.equal(tupdate(text, { content: 'new, text' }), tdoc('BLOCK 1,2,300,150,"3",0,1,1,4,2,"new, text"'));
});

// ---- ZPL

const zdescribe = (text, i = 0) => zpl.describeItem(zpl.parse(text, { dpi: DPI }).items[i], text, { dpi: DPI });
const zupdate = (text, changes, i = 0) => zpl.updateItem(text, zpl.parse(text, { dpi: DPI }).items[i], changes, { dpi: DPI });
const zitem = (text, i = 0) => zpl.parse(text, { dpi: DPI }).items[i];
const zl = (...fields) => `^XA\r\n${fields.join('\r\n')}\r\n^XZ\r\n`;

test('ZPL: a text field has Tipo "line" first; with ^FB it is "block" followed by width, lines, alignment and line space', () => {
  const line = zdescribe(zl('^FO50,100^A0N,30,30^FDHello^FS'));
  assert.equal(keys(line)[0], 'kind');
  assert.deepEqual([byKey(line, 'kind').label, byKey(line, 'kind').value], ['Tipo', 'line']);
  assert.deepEqual(byKey(line, 'kind').options, [{ value: 'line', label: 'Línea de texto' }, { value: 'block', label: 'Bloque de texto' }]);
  assert.ok(!keys(line).includes('blockWidth'));
  const d = zdescribe(zl('^FO50,100^A0N,30,30^FB400,3,5,C,20^FDHello^FS'));
  assert.deepEqual(keys(d).slice(0, 5), ['kind', 'blockWidth', 'blockLines', 'blockSpace', 'blockAlign']);
  assert.deepEqual([byKey(d, 'blockWidth').value, byKey(d, 'blockLines').value, byKey(d, 'blockSpace').value, byKey(d, 'blockAlign').value], [400, 3, 5, 'C']);
  assert.deepEqual(byKey(d, 'blockAlign').options.map(o => [o.value, o.label]), [['L', 'Izquierda'], ['C', 'Centro'], ['R', 'Derecha'], ['J', 'Justificado']]);
  assert.deepEqual([byKey(d, 'blockSpace').label, byKey(d, 'blockSpace').min], ['Interlineado (puntos)', -9999]);
});

test('ZPL: ^FB defaults are shown for the omitted arguments; a field with only data (no ^A) has the Tipo too', () => {
  const d = zdescribe(zl('^FO50,100^A0N,30,30^FB400^FDHello^FS'));
  assert.deepEqual([byKey(d, 'blockLines').value, byKey(d, 'blockSpace').value, byKey(d, 'blockAlign').value], [1, 0, 'L']);
  const bare = zdescribe(zl('^FO50,100^FDHello^FS'));
  assert.equal(byKey(bare, 'kind').value, 'line');
  assert.equal(byKey(zdescribe(zl('^FO50,100^FB300,2^FDHello^FS')), 'kind').value, 'block');
});

test('ZPL: a counter (^SN) field has no Tipo (the guide: ^SN does not print inside ^FB); the model path gives the kind', () => {
  assert.ok(!keys(zdescribe(zl('^FO50,100^A0N,30,30^SN0001,1,Y^FS'))).includes('kind'));
  const item = zitem(zl('^FO50,100^A0N,30,30^FB400,3^FDHello^FS'));
  assert.equal(byKey(zpl.describeItem(item, undefined, { dpi: DPI }), 'kind').value, 'block');
});

test('ZPL: Tipo -> block inserts ^FB after ^A with a 20 character width and the lines the text needs (one rewrite)', () => {
  const text = zl('^FO50,100^A0N,30,30^FDone two three four five six seven eight nine ten^FS', '^FO50,300^A0N,30,30^FDother^FS');
  const out = zupdate(text, { kind: 'block' });
  const item = zitem(out);
  assert.match(out, /\^FO50,100\^A0N,30,30\^FB\d+,\d+,0,L\^FDone two/);
  assert.equal(item.block.lines, Math.ceil(item.data.length / 20) >= 2 ? item.block.lines : 1);
  assert.ok(item.block.lines >= 2);
  assert.equal(out.slice(out.indexOf('^FO50,300')), text.slice(text.indexOf('^FO50,300')));
  // the text is the same and the line stays where it was
  const before = zitem(text);
  assert.equal(item.data, before.data);
  assert.ok(Math.abs(item.x - before.x) < 1e-6 && Math.abs(item.y - before.y) < 1e-6);
  const widthDots = item.block.width / DOT;
  assert.ok(Math.abs(widthDots - 20 * 30 * 0.59) < 2, String(widthDots));
});

test('ZPL: Tipo -> block on a field with only data inserts ^FB right after the origin', () => {
  const out = zupdate(zl('^FO50,100^FDHello^FS'), { kind: 'block' });
  assert.match(out, /\^FO50,100\^FB\d+,1,0,L\^FDHello\^FS/);
});

test('ZPL: Tipo -> block on an ^FT field keeps the first baseline (^FT is the last line of a block)', () => {
  const text = zl('^FT50,300^A0N,30,30^FDone two three four five six seven eight nine ten^FS');
  const out = zupdate(text, { kind: 'block' });
  const [a, b] = [zitem(text), zitem(out)];
  assert.ok(b.block.lines >= 2);
  assert.ok(Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) < 1e-6, `${a.y} vs ${b.y}`);
  // and back: the same ^FT as the start
  assert.equal(zupdate(out, { kind: 'line' }), text);
});

test('ZPL: Tipo -> line removes ^FB (and the line it sat on), the "\\&" breaks become spaces', () => {
  const text = zl('^FO50,100', '^A0N,30,30', '^FB400,3,0,L', '^FDone\\&two^FS');
  assert.equal(zupdate(text, { kind: 'line' }), zl('^FO50,100', '^A0N,30,30', '^FDone two^FS'));
  assert.equal(zupdate(zl('^FO50,100^A0N,30,30^FB400,3^FDa^FS'), { kind: 'line' }), zl('^FO50,100^A0N,30,30^FDa^FS'));
});

test('ZPL: Tipo to what it already is changes nothing', () => {
  const block = zl('^FO50,100^A0N,30,30^FB400,3^FDa^FS');
  assert.equal(zupdate(block, { kind: 'block' }), block);
  const line = zl('^FO50,100^A0N,30,30^FDa^FS');
  assert.equal(zupdate(line, { kind: 'line' }), line);
  assert.equal(zupdate(line, { kind: 'x' }), line);
});

test('ZPL: width, lines, line space and justification edit their ^FB argument and fill the omitted ones', () => {
  const text = zl('^FO50,100^A0N,30,30^FB400,3,5,C,20^FDa^FS');
  assert.equal(zupdate(text, { blockWidth: 500 }), zl('^FO50,100^A0N,30,30^FB500,3,5,C,20^FDa^FS'));
  assert.equal(zupdate(text, { blockLines: 6 }), zl('^FO50,100^A0N,30,30^FB400,6,5,C,20^FDa^FS'));
  assert.equal(zupdate(text, { blockSpace: -4 }), zl('^FO50,100^A0N,30,30^FB400,3,-4,C,20^FDa^FS'));
  assert.equal(zupdate(text, { blockAlign: 'J' }), zl('^FO50,100^A0N,30,30^FB400,3,5,J,20^FDa^FS'));
  const short = zl('^FO50,100^A0N,30,30^FB400^FDa^FS');
  assert.equal(zupdate(short, { blockLines: 3 }), zl('^FO50,100^A0N,30,30^FB400,3^FDa^FS'));
  assert.equal(zupdate(short, { blockAlign: 'R' }), zl('^FO50,100^A0N,30,30^FB400,,,R^FDa^FS'));
  // clamped to the guide's ranges; an invalid letter is refused
  assert.equal(zupdate(text, { blockWidth: 20000 }), zl('^FO50,100^A0N,30,30^FB9999,3,5,C,20^FDa^FS'));
  assert.equal(zupdate(text, { blockLines: 0 }), zl('^FO50,100^A0N,30,30^FB400,1,5,C,20^FDa^FS'));
  assert.equal(zupdate(text, { blockAlign: 'X' }), text);
});

test('ZPL: editing the block of one field leaves the others and the other arguments of the field byte for byte', () => {
  const text = zl('^FO50,100^A0N,30,30^FB400,3^FDa, b^FS', '^FO50,200^A0N,30,30^FB300,2^FDc^FS');
  assert.equal(zupdate(text, { blockWidth: 410 }, 1), zl('^FO50,100^A0N,30,30^FB400,3^FDa, b^FS', '^FO50,200^A0N,30,30^FB410,2^FDc^FS'));
});

// ---- TPCL

test('TPCL: the Tipo select offers the line and the block for a PC text, only the line (with a note) for a PV text', () => {
  const src = '{D0630,1000,0600|}{AX;+000,+000,+00|}{C|}{PC000;0100,0200,06,06,J,00,B|}{RC000;Hola|}{PV001;0100,0400,0100,0100,B,00,B|}{RV001;Hola|}';
  const model = tpcl.parse(src, { dpi: DPI });
  const [pc, pv] = model.items.map(item => byKey(tpcl.describeItem(item, src), 'kind'));
  assert.deepEqual([pc.label, pc.type, pc.value], ['Tipo', 'select', 'line']);
  assert.deepEqual(pc.options, [{ value: 'line', label: 'Línea de texto' }, { value: 'block', label: 'Bloque de texto' }]);
  assert.equal(pc.note, undefined);
  assert.deepEqual(pv.options, [{ value: 'line', label: 'Línea de texto' }]);
  assert.equal(pv.note, 'Bloque de texto solo con fuente de mapa de bits (PC)');
  assert.equal(tpcl.updateItem(src, model.items[1], { kind: 'block' }), src);
  assert.match(tpcl.updateItem(src, model.items[0], { kind: 'block' }), /[{]PC000;0100,0200,06,06,J,00,B,P5[0-9]{9}[|][}]/);
});

// ---- the panel

test('the panel shows a one-option select disabled, with its note as text and tooltip', () => {
  const made = [];
  const fake = tag => {
    const el = {
      tagName: tag, dataset: {}, children: [], append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
      addEventListener() {}, contains: () => false, querySelector: () => null,
    };
    made.push(el);
    return el;
  };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: fake, activeElement: null } });
  try {
    const els = { empty: fake('p'), title: fake('h'), form: fake('form'), overlay: fake('div') };
    const panel = PB.ui.createPropertiesPanel(els, { onChange() {}, onValueChange() {} });
    panel.show({
      kind: 'text',
      fields: [
        { key: 'kind', label: 'Tipo', type: 'select', value: 'line', options: [{ value: 'line', label: 'Línea de texto' }], note: 'Bloque de texto solo con fuente de mapa de bits (PC)' },
        { key: 'other', label: 'Otro', type: 'select', value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      ],
    });
    const [single, pair] = els.form.children;
    const select = single.children[1];
    assert.equal(select.disabled, true);
    assert.equal(select.title, 'Bloque de texto solo con fuente de mapa de bits (PC)');
    assert.equal(single.children[2].textContent, 'Bloque de texto solo con fuente de mapa de bits (PC)');
    assert.equal(single.children[2].className, 'props-note');
    assert.notEqual(pair.children[1].disabled, true);
    assert.equal(pair.children.length, 2);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
});
