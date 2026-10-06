const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// TPCL SG graphic command: nibble encoding (core.js), parser + insertCommand (tpcl.js), bitmap renderer (drawing.js).
const PB = load(['js/lib/qrcode-generator.min.js', 'js/config.js', 'js/core.js', 'js/languages/tpcl.js', 'js/barcodes.js', 'js/view.js', 'js/drawing.js']);
const tpcl = PB.languages.get('tpcl');
const { images } = PB;

const bits = rows => Uint8Array.from(rows.flatMap(r => [...r].map(Number)));
const chars = s => [...s].map(c => c.charCodeAt(0));

// --- T6: nibble helpers ---------------------------------------------------------------------------------------

test('images.bitmapToNibble: 4 dots per char, 1 = black, rows padded to a multiple of 8 dots with 0', () => {
  // 10 dots wide -> padded to 16: 1111 0000 | 1100 0000 -> '?' '0' '<' '0'; second row empty
  const data = images.bitmapToNibble(bits(['1111000011', '0000000000']), 10, 2);
  assert.equal(data, '?0<0' + '0000');
});

test('images.bitmapToNibble: data length is ((w+7)>>3)*h*2 and every char is in 0x30..0x3F', () => {
  for (const [w, h] of [[1, 1], [7, 3], [8, 2], [9, 5], [16, 4], [17, 2]]) {
    const all = new Uint8Array(w * h).fill(1);
    const data = images.bitmapToNibble(all, w, h);
    assert.equal(data.length, ((w + 7) >> 3) * h * 2, `${w}x${h}`);
    assert.ok(chars(data).every(c => c >= 0x30 && c <= 0x3f), `${w}x${h}`);
  }
});

test('images.bitmapToNibble: padding dots stay white even when every real dot is black', () => {
  // 5 black dots: 11111000 -> nibbles 1111 1000 -> '?' '8'
  assert.equal(images.bitmapToNibble(bits(['11111']), 5, 1), '?8');
});

test('images.nibbleToBitmap: decodes to a flat 0/1 array of w*h (padding dropped)', () => {
  const out = images.nibbleToBitmap('?0<00000', 10, 2);
  assert.deepEqual(out, bits(['1111000011', '0000000000']));
  assert.equal(out.length, 20);
});

test('images.nibbleToBitmap: round trip with widths that are not a multiple of 8', () => {
  for (const [w, h] of [[1, 1], [3, 4], [8, 3], [13, 5], [21, 2]]) {
    const src = Uint8Array.from({ length: w * h }, (_, i) => ((i * 7 + (i >> 2)) % 3 === 0 ? 1 : 0));
    assert.deepEqual(images.nibbleToBitmap(images.bitmapToNibble(src, w, h), w, h), src, `${w}x${h}`);
  }
});

test('images.nibbleToBitmap: short or foreign data is decoded as white instead of throwing', () => {
  assert.deepEqual(images.nibbleToBitmap('?', 8, 2), bits(['11110000', '00000000']));
  assert.deepEqual(images.nibbleToBitmap('zz', 8, 1), bits(['00000000']));
});

test('images.buildSG: {SG;xxxx,yyyy,wwww,hhhh,0,data|} with x/y in 0.1 mm and w/h in dots', () => {
  assert.equal(images.buildSG({ xMm: 10, yMm: 5.5, w: 10, h: 2, data: '?0<00000' }), '{SG;0100,0055,0010,0002,0,?0<00000|}');
  assert.equal(images.buildSG({ xMm: '3,5', yMm: '', w: 8, h: 1, data: '00' }), '{SG;0035,0000,0008,0001,0,00|}');
});

test('images.targetDots: width in mm -> dots at the dpi, otherwise natural pixels; height keeps the aspect', () => {
  assert.deepEqual(images.targetDots({ naturalW: 200, naturalH: 100, widthMm: 25.4, dpi: 203 }), { w: 203, h: 102 });
  assert.deepEqual(images.targetDots({ naturalW: 200, naturalH: 100, widthMm: '', dpi: 600 }), { w: 200, h: 100 });
  const thin = images.targetDots({ naturalW: 1000, naturalH: 1, widthMm: 1, dpi: 203 });
  assert.ok(thin.w >= 1 && thin.h >= 1, 'never less than one dot');
});

test('images.thresholdRGBA: composites alpha over white and uses a 50% luminance threshold (1 = black)', () => {
  const px = [
    0, 0, 0, 255,       // opaque black -> 1
    255, 255, 255, 255, // white -> 0
    0, 0, 0, 0,         // transparent -> white -> 0
    0, 0, 0, 100,       // black at ~39% opacity -> light gray -> 0
    0, 0, 0, 200,       // black at ~78% opacity -> dark gray -> 1
    120, 120, 120, 255, // below 50% -> 1
    136, 136, 136, 255, // above 50% -> 0
  ];
  assert.deepEqual(images.thresholdRGBA(Uint8ClampedArray.from(px), 7, 1), bits(['1000110']));
});

// --- T10: adjustable threshold, stepwise downscale, bitmap preview item ---------------------------------------

test('images.thresholdRGBA: an explicit threshold (0-255) moves the black/white boundary; without one it is 128', () => {
  const gray = v => [v, v, v, 255];
  const px = Uint8ClampedArray.from([...gray(60), ...gray(127), ...gray(129), ...gray(200)]);
  assert.deepEqual(images.thresholdRGBA(px, 4, 1), bits(['1100']));
  assert.deepEqual(images.thresholdRGBA(px, 4, 1, undefined), bits(['1100']));
  assert.deepEqual(images.thresholdRGBA(px, 4, 1, 128), bits(['1100']));
  assert.deepEqual(images.thresholdRGBA(px, 4, 1, 64), bits(['1000']));
  assert.deepEqual(images.thresholdRGBA(px, 4, 1, 201), bits(['1111']));
});

test('images.thresholdRGBA: the extremes of the range are valid (0 = all white, 255 = everything but pure white is black)', () => {
  const px = Uint8ClampedArray.from([0, 0, 0, 255, 254, 254, 254, 255, 255, 255, 255, 255]);
  assert.deepEqual(images.thresholdRGBA(px, 3, 1, 0), bits(['000']));
  assert.deepEqual(images.thresholdRGBA(px, 3, 1, 255), bits(['110']));
});

test('images.thresholdRGBA: out-of-range or invalid thresholds are clamped or fall back to 128', () => {
  const px = Uint8ClampedArray.from([0, 0, 0, 255, 254, 254, 254, 255, 255, 255, 255, 255]);
  assert.deepEqual(images.thresholdRGBA(px, 3, 1, -50), bits(['000']));
  assert.deepEqual(images.thresholdRGBA(px, 3, 1, 999), bits(['110']));
  for (const bad of [NaN, null, 'abc', Infinity]) {
    assert.deepEqual(images.thresholdRGBA(px, 3, 1, bad), bits(['100']), String(bad));
  }
});

test('images.thresholdFromPercent: slider percent 0-100 -> 0-255 (50 keeps the historical 128), clamped, invalid = 50%', () => {
  assert.equal(images.thresholdFromPercent(0), 0);
  assert.equal(images.thresholdFromPercent(50), 128);
  assert.equal(images.thresholdFromPercent(100), 255);
  assert.equal(images.thresholdFromPercent('50'), 128);
  assert.equal(images.thresholdFromPercent(-10), 0);
  assert.equal(images.thresholdFromPercent(250), 255);
  assert.equal(images.thresholdFromPercent(NaN), 128);
  assert.equal(images.thresholdFromPercent(''), 128);
});

test('images.downscaleSteps: halves (rounded) while the next size is still at least twice the target width, then the target', () => {
  assert.deepEqual(images.downscaleSteps(1000, 500, 100, 50), [{ w: 500, h: 250 }, { w: 250, h: 125 }, { w: 100, h: 50 }]);
  assert.deepEqual(images.downscaleSteps(1000, 500, 300, 150), [{ w: 300, h: 150 }]);
  assert.deepEqual(images.downscaleSteps(800, 400, 200, 100), [{ w: 400, h: 200 }, { w: 200, h: 100 }]);
});

test('images.downscaleSteps: no stepping when the target is as big as or bigger than the source', () => {
  assert.deepEqual(images.downscaleSteps(100, 50, 400, 200), [{ w: 400, h: 200 }]);
  assert.deepEqual(images.downscaleSteps(100, 50, 100, 50), [{ w: 100, h: 50 }]);
});

test('images.downscaleSteps: intermediate steps keep the aspect ratio (within rounding) and the last one is exactly the target', () => {
  const [srcW, srcH, dstW, dstH] = [1237, 511, 37, 15];
  const steps = images.downscaleSteps(srcW, srcH, dstW, dstH);
  assert.ok(steps.length > 1);
  assert.deepEqual(steps[steps.length - 1], { w: dstW, h: dstH });
  let prev = srcW;
  for (const step of steps.slice(0, -1)) {
    assert.ok(Math.abs(step.h - step.w * srcH / srcW) <= 0.5 + 1e-9, `aspect of ${step.w}x${step.h}`);
    assert.ok(step.w < prev && step.w >= 2 * dstW, `strictly shrinking and at least 2x the target: ${step.w}`);
    prev = step.w;
  }
});

test('images.downscaleSteps: tiny targets and thin sources never produce a side below 1', () => {
  const steps = images.downscaleSteps(1000, 3, 1, 1);
  assert.deepEqual(steps[steps.length - 1], { w: 1, h: 1 });
  assert.ok(steps.every(s => s.w >= 1 && s.h >= 1), JSON.stringify(steps));
  assert.deepEqual(images.downscaleSteps(1, 1, 1, 1), [{ w: 1, h: 1 }]);
});

test('images.makeBitmapItem: an image item with the converted bitmap, sized in dots like the parsed SG will be', () => {
  const data = Uint8Array.from([1, 0, 0, 1]);
  const item = images.makeBitmapItem({ href: 'data:x', xMm: 10, yMm: '5,5', dpi: 203 }, { w: 2, h: 2, data });
  assert.equal(item.kind, 'image');
  assert.equal(item.x, 100);
  assert.equal(item.y, 55);
  assert.equal(item.width, Math.round(2 * 254 / 203));
  assert.equal(item.height, Math.round(2 * 254 / 203));
  assert.deepEqual(item.bitmap, { w: 2, h: 2, data });
  assert.equal(item.data, null);
  assert.equal(item.href, undefined);
  assert.ok(item.ref);
  assert.match(PB.svgRenderer.render({ items: [item] }, { width: 990, height: 550 }, { textScale: 1, showGrid: false, showAnchors: true, values: {} }).svg, /<path d="M0 0h1v1h-1zM1 1h1v1h-1z"/);
});

// --- T7: parser -----------------------------------------------------------------------------------------------

const sg = (data, { x = '0100', y = '0050', w = 10, h = 2, e = 0 } = {}) => `{SG;${x},${y},${String(w).padStart(4, '0')},${String(h).padStart(4, '0')},${e},${data}|}`;
const tiny = bits(['1111000011', '0000000000']);

test('tpcl SG: parses an image item with the bitmap, position in 0.1 mm and size in 0.1 mm', () => {
  const model = tpcl.parse(`{D0610,0990,0550|}\n${sg('?0<00000')}\n`, { dpi: 203 });
  const item = model.items.find(i => i.kind === 'image');
  assert.ok(item);
  assert.equal(item.x, 100);
  assert.equal(item.y, 50);
  assert.equal(item.width, Math.round(10 * 254 / 203));
  assert.equal(item.height, Math.round(2 * 254 / 203));
  assert.deepEqual(item.bitmap.data, tiny);
  assert.equal(item.bitmap.w, 10);
  assert.equal(item.bitmap.h, 2);
  assert.equal(item.data, null);
  assert.ok(item.ref);
  assert.ok(item.source.spans[0].end > item.source.spans[0].start);
  assert.deepEqual(model.diagnostics, []);
});

test('tpcl SG: data with ";" ":" "<" "=" ">" "?" is kept raw (not split on ; or ,)', () => {
  const data = ';:<=>?01'; // 8 chars = 8 dots wide x 4 rows ((8+7)>>3)*4*2
  const model = tpcl.parse(sg(data, { w: 8, h: 4 }));
  const item = model.items.find(i => i.kind === 'image');
  assert.ok(item);
  assert.deepEqual(item.bitmap.data, images.nibbleToBitmap(data, 8, 4));
  assert.deepEqual(model.diagnostics, []);
});

test('tpcl SG: a D suffix makes x/y dots, converted with the dpi', () => {
  const model = tpcl.parse(sg('?0<00000', { x: '0100D', y: '0020D' }), { dpi: 203 });
  const item = model.items.find(i => i.kind === 'image');
  assert.equal(item.x, Math.round(100 * 254 / 203));
  assert.equal(item.y, Math.round(20 * 254 / 203));
});

test('tpcl SG: e=4 (nibble OR) is supported', () => {
  const model = tpcl.parse(sg('?0<00000', { e: 4 }));
  assert.equal(model.items.filter(i => i.kind === 'image').length, 1);
  assert.deepEqual(model.diagnostics, []);
});

test('tpcl SG: other data modes warn and are skipped', () => {
  const model = tpcl.parse(sg('?0<00000', { e: 1 }));
  assert.equal(model.items.length, 0);
  assert.ok(model.diagnostics.some(d => d.level === 'warning' && /Modo de datos SG no soportado por el visor/.test(d.text)));
});

test('tpcl SG: a data length that does not match w x h warns (and still draws what it can)', () => {
  const model = tpcl.parse(sg('?0<0'));
  assert.ok(model.diagnostics.some(d => d.level === 'warning' && /SG/.test(d.text) && /8/.test(d.text)));
  assert.equal(model.items.filter(i => i.kind === 'image').length, 1);
});

test('tpcl SG: zero width or height warns and is skipped', () => {
  const model = tpcl.parse(sg('', { w: 0, h: 2 }));
  assert.equal(model.items.length, 0);
  assert.equal(model.diagnostics.length, 1);
});

test('tpcl SG: a label with an image has no "sin texto" warning and survives validation', () => {
  const model = tpcl.parse(`{C|}\n${sg('?0<00000')}\n{XS;I,0001,0002C4100|}`);
  assert.deepEqual(PB.validator.validate(model, tpcl), []);
});

test('tpcl SG: round trip buildSG -> parse gives the same bitmap and position', () => {
  const w = 21, h = 5;
  const src = Uint8Array.from({ length: w * h }, (_, i) => ((i * 5 + (i >> 3)) % 4 === 0 ? 1 : 0));
  const cmd = images.buildSG({ xMm: 12.3, yMm: 4.5, w, h, data: images.bitmapToNibble(src, w, h) });
  const model = tpcl.parse(cmd);
  const item = model.items.find(i => i.kind === 'image');
  assert.deepEqual(item.bitmap.data, src);
  assert.equal(item.bitmap.w, w);
  assert.equal(item.bitmap.h, h);
  assert.equal(item.x, 123);
  assert.equal(item.y, 45);
  assert.deepEqual(model.diagnostics, []);
});

// --- T7: insertCommand ----------------------------------------------------------------------------------------

test('tpcl insertCommand: goes right before {XS and after {C|}', () => {
  const text = '{D0610,0990,0550|}\n{C|}\n{PC001;0010,0010,05,05,J,00,B|}\n{XS;I,0001,0002C4100|}';
  const cmd = '{SG;0000,0000,0008,0001,0,00|}';
  assert.equal(
    tpcl.insertCommand(text, cmd),
    '{D0610,0990,0550|}\n{C|}\n{PC001;0010,0010,05,05,J,00,B|}\n{SG;0000,0000,0008,0001,0,00|}\n{XS;I,0001,0002C4100|}',
  );
});

test('tpcl insertCommand: a {XS on the same line as other commands starts its own line', () => {
  const out = tpcl.insertCommand('{C|}{XS;I,0001,0002C4100|}', '{SG;0000,0000,0008,0001,0,00|}');
  assert.equal(out, '{C|}\n{SG;0000,0000,0008,0001,0,00|}\n{XS;I,0001,0002C4100|}');
});

test('tpcl insertCommand: without {XS it is appended on its own line, keeping the trailing newline style', () => {
  const cmd = '{SG;0000,0000,0008,0001,0,00|}';
  assert.equal(tpcl.insertCommand('{C|}', cmd), `{C|}\n${cmd}`);
  assert.equal(tpcl.insertCommand('{C|}\n', cmd), `{C|}\n${cmd}\n`);
  assert.equal(tpcl.insertCommand('', cmd), `${cmd}\n`);
});

test('tpcl insertCommand: uses CRLF when the file does', () => {
  const cmd = '{SG;0000,0000,0008,0001,0,00|}';
  assert.equal(tpcl.insertCommand('{C|}\r\n{XS;I,0001,0002C4100|}', cmd), `{C|}\r\n${cmd}\r\n{XS;I,0001,0002C4100|}`);
  assert.equal(tpcl.insertCommand('{C|}\r\n', cmd), `{C|}\r\n${cmd}\r\n`);
});

test('tpcl insertCommand: the inserted image parses back from the resulting text', () => {
  const w = 10, h = 2;
  const cmd = images.buildSG({ xMm: 10, yMm: 5, w, h, data: images.bitmapToNibble(tiny, w, h) });
  const model = tpcl.parse(tpcl.insertCommand('{D0610,0990,0550|}\n{C|}\n{XS;I,0001,0002C4100|}', cmd));
  assert.deepEqual(model.items.find(i => i.kind === 'image').bitmap.data, tiny);
});

// --- T8: renderer ---------------------------------------------------------------------------------------------

const render = items => PB.svgRenderer.render({ items }, { width: 990, height: 550 }, { textScale: 1, showGrid: false, showAnchors: true, values: {} });
const bitmapItem = (rows, extra = {}) => ({
  kind: 'image', ref: 'SG1', x: 100, y: 50, width: 40, height: 20, data: null,
  bitmap: { w: rows[0].length, h: rows.length, data: bits(rows) }, ...extra,
});

test('drawing: a bitmap image is one path of black row runs under a scaled group', () => {
  // 4x2 bitmap drawn at 40x20 -> scale 10 x 10
  const { svg } = render([bitmapItem(['1101', '0011'])]);
  assert.match(svg, /<g transform="translate\(100 50\) scale\(10 10\)"/);
  const d = svg.match(/<path d="([^"]*)"/)[1];
  assert.equal(d, 'M0 0h2v1h-2zM3 0h1v1h-1zM2 1h2v1h-2z');
  assert.equal(svg.includes('<image'), false);
});

test('drawing: black only where the bits are 1 (runs cover exactly the set bits)', () => {
  const rows = ['10110', '00000', '11111'];
  const { svg } = render([bitmapItem(rows, { width: 50, height: 30 })]);
  const covered = new Set();
  for (const m of svg.match(/<path d="([^"]*)"/)[1].matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
    for (let i = 0; i < +m[3]; i++) covered.add(`${+m[1] + i},${m[2]}`);
  }
  const expected = new Set();
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '1') expected.add(`${x},${y}`); }));
  assert.deepEqual(covered, expected);
});

test('drawing: a bitmap image keeps the hit rect, anchor and size info, and an all-white bitmap draws no path', () => {
  const { svg, diagnostics } = render([bitmapItem(['1111', '0000'])]);
  assert.match(svg, /<rect class="hit" x="100" y="50" width="40" height="20"/);
  assert.match(svg, /<circle class="origin" cx="100" cy="50"/);
  assert.ok(diagnostics.some(d => d.level === 'info' && /4 × 2 mm/.test(d.text)));
  const blank = render([bitmapItem(['0000'])]).svg;
  assert.equal(/<path d=""/.test(blank), false);
  assert.match(blank, /<rect class="hit"/);
});

test('drawing: the href overlay path still works when there is no bitmap', () => {
  const item = images.makeItem({ href: 'data:image/png;base64,AAAA', naturalW: 200, naturalH: 100, xMm: 10, yMm: 5, widthMm: 40, dpi: 203 });
  assert.match(render([item]).svg, /<image href="data:image\/png;base64,AAAA" x="100" y="50" width="400" height="200"/);
});
