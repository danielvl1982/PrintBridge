const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const PB = load(['js/lib/qrcode-generator.min.js', 'js/config.js', 'js/core.js', 'js/languages/tpcl.js', 'js/barcodes.js', 'js/view.js', 'js/drawing.js']);
const { viewRotation } = PB;
const ANGLES = [0, 90, 180, 270];

test('rotation: rotate and inverse are inverses for the four angles and non-square labels', () => {
  const points = [[0, 0], [990, 550], [100, 200], [1, 549], [495, 275]];
  for (const [w, h] of [[990, 550], [300, 1200], [500, 500]]) {
    for (const angle of ANGLES) {
      for (const p of points) {
        assert.deepEqual(viewRotation.inverse(viewRotation.rotate(p, angle, w, h), angle, w, h), p, `${angle}° ${w}x${h} ${p}`);
      }
    }
  }
});

test('rotation: 0 degrees is the identity', () => {
  assert.deepEqual(viewRotation.rotate([123, 45], 0, 990, 550), [123, 45]);
  assert.equal(viewRotation.transformFor(990, 550, 0), '');
  assert.deepEqual(viewRotation.viewBoxFor(990, 550, 0, 30), { x: -30, y: -30, width: 1050, height: 610 });
});

test('rotation: the corners rotate clockwise', () => {
  const w = 990, h = 550;
  // 90 clockwise: the top left corner moves to the top right
  assert.deepEqual(viewRotation.rotate([0, 0], 90, w, h), [h, 0]);
  assert.deepEqual(viewRotation.rotate([w, 0], 90, w, h), [h, w]);
  assert.deepEqual(viewRotation.rotate([0, 0], 180, w, h), [w, h]);
  assert.deepEqual(viewRotation.rotate([w, h], 180, w, h), [0, 0]);
  // 270 clockwise: the top left corner moves to the bottom left
  assert.deepEqual(viewRotation.rotate([0, 0], 270, w, h), [0, w]);
  assert.deepEqual(viewRotation.rotate([w, h], 270, w, h), [h, 0]);
});

test('rotation: viewBoxFor swaps width and height at 90 and 270', () => {
  assert.deepEqual(viewRotation.viewBoxFor(990, 550, 90, 30), { x: -30, y: -30, width: 610, height: 1050 });
  assert.deepEqual(viewRotation.viewBoxFor(990, 550, 270, 30), { x: -30, y: -30, width: 610, height: 1050 });
  assert.deepEqual(viewRotation.viewBoxFor(990, 550, 180, 30), { x: -30, y: -30, width: 1050, height: 610 });
});

test('rotation: transformFor matches rotate (SVG matrix) and an invalid angle throws', () => {
  const w = 990, h = 550, p = [123, 45];
  for (const angle of ANGLES.slice(1)) {
    const [a, b, c, d, e, f] = viewRotation.transformFor(w, h, angle).match(/-?\d+/g).map(Number);
    assert.deepEqual([a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f], viewRotation.rotate(p, angle, w, h));
  }
  assert.throws(() => viewRotation.rotate(p, 45, w, h), RangeError);
});

// --- Drawing with rotation (drawing.js does not touch the DOM) ---
const example = PB.examples[0];
const tpcl = PB.languages.get('tpcl');
const draw = rotation => {
  const model = tpcl.parse(example.source, { dpi: 203 });
  const area = PB.sizes.view(model, PB.sizes.resolve(PB.config.sizes[0]));
  const opts = { textScale: 1, showGrid: true, showAnchors: true, values: example.values };
  return PB.svgRenderer.render(model, area, rotation === undefined ? opts : { ...opts, rotation }).svg;
};

test('drawing with rotation: 0 degrees gives exactly the same SVG as without rotation', () => {
  assert.equal(draw(0), draw(undefined));
  assert.equal(draw(0).includes('matrix('), false);
});

test('drawing with rotation: 90 degrees swaps the viewBox and wraps the content in a rotated group', () => {
  const svg = draw(90);
  assert.match(svg, /viewBox="-30 -30 610 1050"/);
  assert.match(svg, /<g class="view-rotation" transform="matrix\(0 1 -1 0 550 0\)">/);
  // the group contains background, grid, items, overlaps and origins
  const inside = svg.slice(svg.indexOf('<g class="view-rotation"'));
  for (const marker of ['label-background', 'grid-line', 'class="item"', 'class="overlaps"', 'class="origin"']) assert.ok(inside.includes(marker), marker);
});
