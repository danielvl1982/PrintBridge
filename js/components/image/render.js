/**
 * Image slice: SVG drawing of an image item. The model item is { kind: 'image', x, y, width, height, href | bitmap }
 * (all in 0.1 mm; bitmap = { w, h, data } is a parsed SG graphic, href a preview overlay). Published on
 * PB.slices.image.render and registered by js/components/image/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.image = PB.slices.image || {};

  const { units } = PB;

  /**
   * Bitmap of an image item (flat 0/1 array, 1 = black) as a single path of black row runs, in bitmap dots, inside a group
   * that places it at item.x/y and scales a dot to item.width / bitmap.w by item.height / bitmap.h (0.1 mm).
   */
  function bitmapMarkup({ x, y, width, height, bitmap: { w, h, data } }) {
    let d = '';
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (!data[row * w + col]) continue;
        const start = col;
        while (col + 1 < w && data[row * w + col + 1]) col++;
        const run = col - start + 1;
        d += `M${start} ${row}h${run}v1h${-run}z`;
      }
    }
    const scale = v => Number(v.toFixed(4));
    return `<g transform="translate(${x} ${y}) scale(${scale(width / w)} ${scale(height / h)})">` +
      (d ? `<path d="${d}" shape-rendering="crispEdges"/>` : '') + `</g>`;
  }

  /** ctx comes from drawing.js: { esc } escapes attribute values. */
  function render(item, ctx) {
    return {
      // .hit goes after the picture so the hover/selection highlight is painted over it
      markup: (item.bitmap ? bitmapMarkup(item) : `<image href="${ctx.esc(item.href)}" x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" preserveAspectRatio="none"/>`) +
        `<rect class="hit" x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}"/>`,
      info: `imagen ${units.formatMm(item.width)} × ${units.formatMm(item.height)} mm`,
      anchor: [item.x, item.y],
    };
  }

  PB.slices.image.render = render;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
