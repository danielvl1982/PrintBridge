/**
 * Line slice: SVG drawing. The model item is { kind: 'line', x1, y1, x2, y2, rect, width }; a line (rect false) is a
 * stroke from (x1, y1) to (x2, y2) and a box (rect true) is the outline of the rectangle they span. Both slices use
 * this renderer: the box slice reuses it because they share the model kind.
 * Published on PB.slices.line.render and registered by js/components/line/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.line = PB.slices.line || {};

  /** ctx comes from drawing.js: { n } rounds a number to 2 decimals for SVG attributes. */
  function render(item, ctx) {
    const { n } = ctx;
    // The thickness comes from the label, which is why it is not in the CSS
    const stroke = `class="stroke" stroke-width="${n(Math.max(item.width, 1))}"`;
    const flat = item.x1 === item.x2 || item.y1 === item.y2;
    return {
      markup: item.rect && !flat
        ? `<rect x="${Math.min(item.x1, item.x2)}" y="${Math.min(item.y1, item.y2)}" width="${Math.abs(item.x2 - item.x1)}" height="${Math.abs(item.y2 - item.y1)}" ${stroke}/>`
        : `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" ${stroke}/>`,
    };
  }

  PB.slices.line.render = render;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
