const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// Rotation of the inserted image: the rotation is baked into the bitmap (neither SG nor BITMAP has a rotation parameter).
const PB = loadUpTo('js/drawing.js');
const tpcl = PB.languages.get('tpcl');
const tspl = PB.languages.get('tspl');
const { images } = PB;

const bitmap = (w, h, rows) => ({ w, h, data: Uint8Array.from(rows.flatMap(r => [...r].map(Number))) });
const rows = ({ w, data }) => {
  const out = [];
  for (let i = 0; i < data.length; i += w) out.push(Array.from(data.slice(i, i + w)).join(''));
  return out;
};

// 3 wide x 2 tall, a b c / d e f = 1 0 0 / 0 1 1
const M = bitmap(3, 2, ['100', '011']);

test('rotateBitmap 0 returns an equal copy, not the same object', () => {
  const r = images.rotateBitmap(M, 0);
  assert.notEqual(r, M);
  assert.notEqual(r.data, M.data);
  assert.deepEqual([r.w, r.h, rows(r)], [3, 2, ['100', '011']]);
});

test('rotateBitmap 90 turns a 3x2 matrix clockwise and swaps w and h', () => {
  // [1 0 0 / 0 1 1] clockwise -> 2 wide, 3 tall: [0 1 / 1 0 / 1 0]
  const r = images.rotateBitmap(M, 90);
  assert.deepEqual([r.w, r.h, rows(r)], [2, 3, ['01', '10', '10']]);
});

test('rotateBitmap 180 reverses rows and columns and keeps w and h', () => {
  const r = images.rotateBitmap(M, 180);
  assert.deepEqual([r.w, r.h, rows(r)], [3, 2, ['110', '001']]);
});

test('rotateBitmap 270 turns a 3x2 matrix counterclockwise and swaps w and h', () => {
  // [1 0 0 / 0 1 1] counterclockwise -> 2 wide, 3 tall: [0 1 / 0 1 / 1 0]
  const r = images.rotateBitmap(M, 270);
  assert.deepEqual([r.w, r.h, rows(r)], [2, 3, ['01', '01', '10']]);
});

test('rotateBitmap composes: four quarter turns are the identity, 90 then 270 too, 180 twice too', () => {
  const same = r => assert.deepEqual([r.w, r.h, rows(r)], [M.w, M.h, rows(M)]);
  same(images.rotateBitmap(images.rotateBitmap(images.rotateBitmap(images.rotateBitmap(M, 90), 90), 90), 90));
  same(images.rotateBitmap(images.rotateBitmap(M, 90), 270));
  same(images.rotateBitmap(images.rotateBitmap(M, 270), 90));
  same(images.rotateBitmap(images.rotateBitmap(M, 180), 180));
  assert.deepEqual(rows(images.rotateBitmap(images.rotateBitmap(M, 90), 90)), rows(images.rotateBitmap(M, 180)));
});

test('rotateBitmap swaps w and h only for 90 and 270, on a non-square bitmap', () => {
  const wide = bitmap(5, 2, ['10000', '00001']);
  assert.deepEqual([90, 270].map(d => { const r = images.rotateBitmap(wide, d); return [r.w, r.h, r.data.length]; }), [[2, 5, 10], [2, 5, 10]]);
  assert.deepEqual([0, 180].map(d => { const r = images.rotateBitmap(wide, d); return [r.w, r.h, r.data.length]; }), [[5, 2, 10], [5, 2, 10]]);
});

test('rotateBitmap does not modify its input and takes equivalent angles; other angles throw', () => {
  const before = rows(M);
  images.rotateBitmap(M, 90);
  assert.deepEqual(rows(M), before);
  assert.deepEqual(rows(images.rotateBitmap(M, 360)), rows(M));
  assert.deepEqual(rows(images.rotateBitmap(M, -90)), rows(images.rotateBitmap(M, 270)));
  assert.throws(() => images.rotateBitmap(M, 45), RangeError);
  assert.throws(() => images.rotateBitmap(M, NaN), RangeError);
});

test('rotationForView: the picture looks upright in the view, (360 - view) % 360, like text', () => {
  assert.deepEqual([0, 90, 180, 270].map(images.rotationForView), [0, 270, 180, 90]);
  assert.equal(images.rotationForView('270'), 90);
  assert.equal(images.rotationForView(undefined), 0);
});

test('the TPCL SG of a rotated image parses back to the rotated bitmap', () => {
  const rotated = images.rotateBitmap(M, 90);
  const command = images.buildSG({ xMm: 10, yMm: 5, w: rotated.w, h: rotated.h, data: images.bitmapToNibble(rotated.data, rotated.w, rotated.h) });
  const [item] = tpcl.parse(command, { dpi: 203 }).items.filter(i => i.kind === 'image');
  assert.deepEqual([item.bitmap.w, item.bitmap.h, rows(item.bitmap)], [2, 3, ['01', '10', '10']]);
});

test('the TSPL BITMAP of a rotated image parses back to the rotated bitmap', () => {
  const rotated = images.rotateBitmap(M, 270);
  const command = tspl.imageCommand({ xMm: '10', yMm: '5', ...rotated, dpi: 203 });
  const text = tspl.insertCommand(['SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm', 'CLS', 'PRINT 1,1', ''].join('\r\n'), command);
  const [item] = tspl.parse(text, { dpi: 203 }).items.filter(i => i.kind === 'image');
  // BITMAP rows are padded to bytes: compare the real dots of every row
  assert.equal(item.bitmap.h, 3);
  const dots = Array.from({ length: 3 }, (_, y) => Array.from(item.bitmap.data.slice(y * item.bitmap.w, y * item.bitmap.w + 2)).join(''));
  assert.deepEqual(dots, rows(rotated));
});

test('makeItem with a rotation: the box is the rotated bounding box at the same top-left, the height keeps the proportion', () => {
  const picture = { href: 'x', naturalW: 200, naturalH: 100, xMm: 10, yMm: 5, widthMm: 20, dpi: 203 };
  const flat = images.makeItem(picture);
  assert.deepEqual([flat.width, flat.height, flat.turn], [200, 100, 0]);
  for (const turn of [90, 270]) {
    const item = images.makeItem({ ...picture, rotation: turn });
    assert.deepEqual([item.x, item.y, item.width, item.height, item.turn], [100, 50, 100, 200, turn]);
  }
  const upside = images.makeItem({ ...picture, rotation: 180 });
  assert.deepEqual([upside.width, upside.height, upside.turn], [200, 100, 180]);
});

test('makeBitmapItem of the rotated bitmap sizes the box in dots of the rotated bitmap', () => {
  const rotated = images.rotateBitmap(bitmap(8, 4, ['10000000', '00000000', '00000000', '00000000']), 90);
  const item = images.makeBitmapItem({ href: 'x', xMm: 1, yMm: 2, dpi: 203 }, rotated);
  assert.deepEqual([item.x, item.y], [10, 20]);
  assert.equal(item.width, Math.round(4 * PB.units.dotSize(203)));
  assert.equal(item.height, Math.round(8 * PB.units.dotSize(203)));
});

test('the plain picture is drawn rotated about the centre of its bounding box', () => {
  const picture = { href: 'x.png', naturalW: 200, naturalH: 100, xMm: 10, yMm: 5, widthMm: 20, dpi: 203, rotation: 90 };
  const { markup } = PB.slices.image.render(images.makeItem(picture), { esc: s => s });
  // box 100 x 200 at (100, 50): centre (150, 150); picture 200 x 100 centred there
  assert.match(markup, /<image [^>]*x="50" y="100" width="200" height="100"[^>]*transform="rotate\(90 150 150\)"/);
  assert.match(markup, /<rect class="hit" x="100" y="50" width="100" height="200"\/>/);
  const upright = PB.slices.image.render(images.makeItem({ ...picture, rotation: 0 }), { esc: s => s }).markup;
  assert.doesNotMatch(upright, /transform=/);
});
