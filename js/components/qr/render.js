/**
 * QR slice: SVG drawing of a QR code. The model item is { kind: 'qr', x, y, ecc, cell, data }; `cell` is the module size
 * in 0.1 mm. Published on PB.slices.qr.render and registered by js/components/qr/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.qr = PB.slices.qr || {};

  const { units, qr } = PB;

  /** ctx comes from drawing.js: { n } rounds to 2 decimals, { rectsPath } joins rectangles, { value } substitutes variables. */
  function render(item, ctx) {
    const { n, rectsPath } = ctx;
    const m = qr.matrix(ctx.value(item.data), item.ecc);
    const cell = item.cell;
    const size = m ? m.size : 21;
    const rects = [];
    if (m) for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m.isDark(r, c)) rects.push([item.x + c * cell, item.y + r * cell, cell + 0.3, cell + 0.3]);
    const side = size * cell;
    return {
      markup: `<rect class="hit" x="${item.x}" y="${item.y}" width="${n(side)}" height="${n(side)}"/>` +
        (m ? `<path d="${rectsPath(rects)}"/>` : `<rect class="not-generated" x="${item.x}" y="${item.y}" width="${n(side)}" height="${n(side)}"/>`),
      info: m ? `QR ${size}×${size} módulos = ${units.formatMm(side)} mm` : 'no se ha podido generar el QR con estos datos',
      anchor: [item.x, item.y],
    };
  }

  PB.slices.qr.render = render;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
