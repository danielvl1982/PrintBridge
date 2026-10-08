const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TSPL editing infrastructure (T1): argument offsets of commands(), insertCommand and the generic move / describe /
// update engines (js/languages/tspl-edit.js), exercised here with small injected definitions (no TSPL slice provides
// coordinates / editable yet).
const PB = loadUpTo('js/languages/tspl.js');
const tspl = PB.languages.get('tspl');
const { commands } = PB.tspl;

// ---- argument offsets

test('commands(): every argument carries the [start, end) of its raw text in the source', () => {
  const src = 'SIZE 100 mm,60 mm\r\nTEXT 10, 20,"3",0,1,1,"Hello, world"\r\n';
  for (const cmd of commands(src)) {
    for (const arg of cmd.args) {
      assert.equal(src.slice(arg.start, arg.end), arg.raw);
    }
  }
  const text = [...commands(src)][1];
  assert.deepEqual(text.args.map(a => a.raw), ['10', '20', '"3"', '0', '1', '1', '"Hello, world"']);
  assert.equal(src.slice(text.args[1].start, text.args[1].end), '20');
});

test('commands(): BITMAP header arguments have offsets and the payload is not an argument', () => {
  const src = 'BITMAP 10,20,2,2,0,\x01\x02,\x03\r\nPRINT 1\r\n';
  const [bitmap] = [...commands(src)];
  assert.equal(bitmap.args.length, 5);
  assert.equal(src.slice(bitmap.args[0].start, bitmap.args[0].end), '10');
  assert.equal(src.slice(bitmap.args[4].start, bitmap.args[4].end), '0');
});

// ---- insertCommand

test('insertCommand puts the command before PRINT using CRLF when the text has CRLF', () => {
  const text = 'SIZE 100 mm,60 mm\r\nCLS\r\nPRINT 1,1\r\n';
  assert.equal(tspl.insertCommand(text, 'BAR 1,2,3,4'), 'SIZE 100 mm,60 mm\r\nCLS\r\nBAR 1,2,3,4\r\nPRINT 1,1\r\n');
});

test('insertCommand uses LF when the text has no CRLF and finds PRINT in any case', () => {
  assert.equal(tspl.insertCommand('CLS\nprint 1\n', 'BAR 1,2,3,4'), 'CLS\nBAR 1,2,3,4\nprint 1\n');
});

test('insertCommand appends at the end when there is no PRINT, keeping the trailing newline state', () => {
  assert.equal(tspl.insertCommand('CLS\r\n', 'BAR 1,2,3,4'), 'CLS\r\nBAR 1,2,3,4\r\n');
  assert.equal(tspl.insertCommand('CLS\r\n\r\n', 'X'), 'CLS\r\n\r\nX\r\n');
  assert.equal(tspl.insertCommand('CLS\r\nBOX 1,2,3,4', 'BAR 1,2,3,4'), 'CLS\r\nBOX 1,2,3,4\r\nBAR 1,2,3,4');
  assert.equal(tspl.insertCommand('', 'BAR 1,2,3,4'), 'BAR 1,2,3,4\n');
});

test('insertCommand adds a line break first when PRINT is not at a line start (cannot happen in a parsed file)', () => {
  assert.equal(tspl.insertCommand('CLS\r\n  PRINT 1\r\n', 'X'), 'CLS\r\nX\r\n  PRINT 1\r\n');
});

test('insertCommand ignores a PRINT word inside quotes or BITMAP data', () => {
  const text = 'TEXT 1,2,"3",0,1,1,"PRINT 1"\r\nBITMAP 0,0,1,1,0,P\r\nPRINT 1\r\n';
  assert.equal(tspl.insertCommand(text, 'X'), 'TEXT 1,2,"3",0,1,1,"PRINT 1"\r\nBITMAP 0,0,1,1,0,P\r\nX\r\nPRINT 1\r\n');
});

// ---- registration

test('the TSPL language registers the editing and palette hooks', () => {
  for (const hook of ['insertCommand', 'moveItem', 'describeItem', 'updateItem', 'componentTemplates', 'buildComponent']) {
    assert.equal(typeof tspl[hook], 'function', hook);
  }
});

test('the registered engines ignore keys that are not editable fields (coordinates move through moveItem; fields are in tspl-properties.test.js)', () => {
  const text = 'SIZE 100 mm,60 mm\r\nTEXT 10,20,"3",0,1,1,"Hi"\r\nPRINT 1\r\n';
  const item = tspl.parse(text, { dpi: 203 }).items[0];
  assert.equal(tspl.updateItem(text, item, { x: 1, y: 1, data: 'x' }, { dpi: 203 }), text);
  assert.deepEqual(tspl.describeItem(item, text).fields.map(f => f.key), ['rotation', 'xmul', 'ymul', 'content']);
});

// ---- engines with injected definitions

const { createTsplEditing, numberField, selectField } = PB.tsplEdit;
const DPI = 203;
const DOT = PB.units.dotSize(DPI); // 0.1 mm per dot

// Fake slices: TEXT moves arg0/arg1; BOX moves both corners; BITMAP moves its header only
const COORDINATES = [
  { applies: (item, cmd) => cmd.name === 'TEXT', fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] },
  { applies: (item, cmd) => cmd.name === 'BOX', fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }, { arg: 2, axis: 'x' }, { arg: 3, axis: 'y' }] },
  { applies: (item, cmd) => cmd.name === 'BITMAP', fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] },
];
const EDITABLE = [
  {
    applies: item => item.kind === 'text',
    fields: [
      numberField('x', 'X', 0, 0, 9999),
      numberField('size', 'Size', 4, 1, 10, item => item.native && item.native.size),
      selectField('rotation', 'Rotation', 3, [0, 90, 180, 270]),
    ],
  },
];
const editing = createTsplEditing({ coordinates: COORDINATES, editable: EDITABLE, commands });

const HEAD = 'SIZE 100 mm,60 mm\r\nCLS\r\n';
const TEXT = 'TEXT 100,200,"3",0,1,1,"Hello, world"\r\n';
const TAIL = 'PRINT 1\r\n';
const firstItem = text => ({ source: { spans: [{ start: [...commands(text)].find(c => c.name === 'TEXT').start, end: 0 }] }, kind: 'text' });
const itemAt = (text, name) => ({ source: { spans: [{ start: [...commands(text)].find(c => c.name === name).start, end: 0 }] }, kind: 'x' });

test('moveItem: dx/dy in 0.1 mm become whole dots and only the coordinate arguments change', () => {
  const text = HEAD + TEXT + TAIL;
  const out = editing.moveItem(text, firstItem(text), 10 * DOT, -20 * DOT, { dpi: DPI });
  assert.equal(out, HEAD + 'TEXT 110,180,"3",0,1,1,"Hello, world"\r\n' + TAIL);
});

test('moveItem: rounds to the nearest dot', () => {
  const text = HEAD + TEXT + TAIL;
  assert.equal(editing.moveItem(text, firstItem(text), 2.4 * DOT, 2.6 * DOT, { dpi: DPI }), HEAD + 'TEXT 102,203,"3",0,1,1,"Hello, world"\r\n' + TAIL);
});

test('moveItem: clamps at 0 dots', () => {
  const text = HEAD + TEXT + TAIL;
  assert.equal(editing.moveItem(text, firstItem(text), -5000, -5000, { dpi: DPI }), HEAD + 'TEXT 0,0,"3",0,1,1,"Hello, world"\r\n' + TAIL);
});

test('moveItem: a zero delta writes the same values (unchanged text)', () => {
  const text = HEAD + TEXT + TAIL;
  assert.equal(editing.moveItem(text, firstItem(text), 0, 0, { dpi: DPI }), text);
});

test('moveItem: a 300 dpi file uses its own dot size', () => {
  const text = HEAD + TEXT + TAIL;
  const dot300 = PB.units.dotSize(300);
  assert.equal(editing.moveItem(text, firstItem(text), 30 * dot300, 0, { dpi: 300 }), HEAD + 'TEXT 130,200,"3",0,1,1,"Hello, world"\r\n' + TAIL);
});

test('moveItem: REFERENCE and SHIFT are subtracted (written dots = target - REFERENCE - SHIFT)', () => {
  const text = 'REFERENCE 10,20\r\nSHIFT 3,4\r\n' + TEXT + TAIL;
  const item = firstItem(text);
  // Item x = (100 + 10 + 3) dots; dragging it 50 dots right puts it at 163 dots -> argument 163 - 13 = 150
  const out = editing.moveItem(text, item, 50 * DOT, 0, { dpi: DPI });
  assert.equal(out, 'REFERENCE 10,20\r\nSHIFT 3,4\r\n' + 'TEXT 150,200,"3",0,1,1,"Hello, world"\r\n' + TAIL);
  // clamp: a target left of the offsets writes 0, never a negative
  assert.equal(editing.moveItem(text, item, -500 * DOT, 0, { dpi: DPI }), 'REFERENCE 10,20\r\nSHIFT 3,4\r\n' + 'TEXT 0,200,"3",0,1,1,"Hello, world"\r\n' + TAIL);
});

test('moveItem: a single-value SHIFT is Y and only offsets declared before the command count', () => {
  const text = 'SHIFT 7\r\n' + TEXT + 'REFERENCE 50,50\r\n' + TAIL;
  const out = editing.moveItem(text, firstItem(text), 10 * DOT, 10 * DOT, { dpi: DPI });
  assert.equal(out, 'SHIFT 7\r\n' + 'TEXT 110,210,"3",0,1,1,"Hello, world"\r\n' + 'REFERENCE 50,50\r\n' + TAIL);
});

test('moveItem: DIRECTION 0 is edited as DIRECTION 1', () => {
  const text = 'DIRECTION 0\r\n' + TEXT + TAIL;
  assert.equal(editing.moveItem(text, firstItem(text), 10 * DOT, 0, { dpi: DPI }), 'DIRECTION 0\r\n' + 'TEXT 110,200,"3",0,1,1,"Hello, world"\r\n' + TAIL);
});

test('moveItem: BOX shifts both corners', () => {
  const text = HEAD + 'BOX 10,20,110,220,4\r\n' + TAIL;
  const out = editing.moveItem(text, itemAt(text, 'BOX'), 5 * DOT, 6 * DOT, { dpi: DPI });
  assert.equal(out, HEAD + 'BOX 15,26,115,226,4\r\n' + TAIL);
});

test('moveItem: only the target line changes, a neighbour with the same numbers stays', () => {
  const text = HEAD + TEXT + TEXT + TAIL;
  const second = { source: { spans: [{ start: HEAD.length + TEXT.length, end: 0 }] }, kind: 'text' };
  const out = editing.moveItem(text, second, 10 * DOT, 0, { dpi: DPI });
  assert.equal(out, HEAD + TEXT + 'TEXT 110,200,"3",0,1,1,"Hello, world"\r\n' + TAIL);
});

test('moveItem: BITMAP header only, the raw payload (CR/LF, quotes, commas) stays byte for byte', () => {
  const payload = '\r,"\n';
  const text = HEAD + 'BITMAP 10,20,2,2,0,' + payload + '\r\n' + TAIL;
  const out = editing.moveItem(text, itemAt(text, 'BITMAP'), 5 * DOT, 5 * DOT, { dpi: DPI });
  assert.equal(out, HEAD + 'BITMAP 15,25,2,2,0,' + payload + '\r\n' + TAIL);
});

test('moveItem: unchanged text for no item, no source, a kind without coordinates or a non-numeric argument', () => {
  const text = HEAD + TEXT + TAIL;
  assert.equal(editing.moveItem(text, null, 1, 1, { dpi: DPI }), text);
  assert.equal(editing.moveItem(text, { kind: 'text' }, 1, 1, { dpi: DPI }), text);
  const clsItem = { source: { spans: [{ start: HEAD.indexOf('CLS'), end: 0 }] } };
  assert.equal(editing.moveItem(text, clsItem, 50, 50, { dpi: DPI }), text);
  const odd = HEAD + 'TEXT @1,200,"3",0,1,1,"x"\r\n' + TAIL;
  assert.equal(editing.moveItem(odd, firstItem(odd), 10 * DOT, 10 * DOT, { dpi: DPI }), HEAD + 'TEXT @1,210,"3",0,1,1,"x"\r\n' + TAIL);
});

test('describeItem lists the fields from the command text, or from the item model without it', () => {
  const text = HEAD + TEXT + TAIL;
  const item = { ...firstItem(text), native: { size: 4 } };
  assert.deepEqual(editing.describeItem(item, text), {
    kind: 'text',
    fields: [
      { key: 'x', label: 'X', type: 'number', value: 100, min: 0, max: 9999, step: 1 },
      { key: 'size', label: 'Size', type: 'number', value: 1, min: 1, max: 10, step: 1 },
      { key: 'rotation', label: 'Rotation', type: 'select', value: 0, options: [0, 90, 180, 270].map(d => ({ value: d, label: `${d}°` })) },
    ],
  });
  // Without text only the fields with a model are known
  assert.deepEqual(editing.describeItem(item).fields.map(f => [f.key, f.value]), [['size', 4]]);
  assert.deepEqual(editing.describeItem(null, text), { kind: null, fields: [] });
});

test('describeItem skips a field whose argument is not a number', () => {
  const text = HEAD + 'TEXT @1,200,"3",90,1,1,"x"\r\n' + TAIL;
  assert.deepEqual(editing.describeItem(firstItem(text), text).fields.map(f => [f.key, f.value]), [['size', 1], ['rotation', 90]]);
});

test('updateItem rewrites only the requested numeric arguments, rounded and clamped', () => {
  const text = HEAD + TEXT + TAIL;
  const item = firstItem(text);
  assert.equal(editing.updateItem(text, item, { x: 250.4 }, { dpi: DPI }), HEAD + 'TEXT 250,200,"3",0,1,1,"Hello, world"\r\n' + TAIL);
  assert.equal(editing.updateItem(text, item, { x: 99999, size: 99 }, { dpi: DPI }), HEAD + 'TEXT 9999,200,"3",0,10,1,"Hello, world"\r\n' + TAIL);
  assert.equal(editing.updateItem(text, item, { x: -5 }, { dpi: DPI }), HEAD + 'TEXT 0,200,"3",0,1,1,"Hello, world"\r\n' + TAIL);
});

test('updateItem: several fields at once, select values and the quoted content (commas included) untouched', () => {
  const text = HEAD + TEXT + TAIL;
  const out = editing.updateItem(text, firstItem(text), { x: 5, size: 3, rotation: 270 }, { dpi: DPI });
  assert.equal(out, HEAD + 'TEXT 5,200,"3",270,3,1,"Hello, world"\r\n' + TAIL);
});

test('updateItem ignores unknown fields, invalid values, selects outside their options and items it cannot edit', () => {
  const text = HEAD + TEXT + TAIL;
  const item = firstItem(text);
  assert.equal(editing.updateItem(text, item, { nope: 1 }, { dpi: DPI }), text);
  assert.equal(editing.updateItem(text, item, { x: 'abc', rotation: 45 }, { dpi: DPI }), text);
  assert.equal(editing.updateItem(text, item, null, { dpi: DPI }), text);
  assert.equal(editing.updateItem(text, null, { x: 1 }, { dpi: DPI }), text);
  assert.equal(editing.updateItem(text, { kind: 'text' }, { x: 1 }, { dpi: DPI }), text);
  const bar = HEAD + 'BOX 1,2,3,4,5\r\n' + TAIL;
  assert.equal(editing.updateItem(bar, itemAt(bar, 'BOX'), { x: 9 }, { dpi: DPI }), bar);
});

test('updateItem leaves a counter argument (@1) and the neighbour lines alone', () => {
  const text = HEAD + 'TEXT 10,20,"3",0,@1,1,"x"\r\n' + TEXT + TAIL;
  const out = editing.updateItem(text, firstItem(text), { x: 11, size: 2 }, { dpi: DPI });
  // size (arg 4) is the counter: only numeric arguments are edited, so that change is ignored
  assert.equal(out, HEAD + 'TEXT 11,20,"3",0,@1,1,"x"\r\n' + TEXT + TAIL);
});
