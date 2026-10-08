/**
 * Line slice: SVG drawing. The model item is { kind: 'line', x1, y1, x2, y2, rect, width }; a line (rect false) is a
 * stroke from (x1, y1) to (x2, y2) and a box (rect true) is the outline of the rectangle they span. Both slices use
 * this renderer: the box slice reuses it because they share the model kind. A rectangle may carry `radius` (0.1 mm):
 * its corners are drawn rounded (SVG rx/ry) with the radius clamped to half of the shorter side. ZPL shapes may carry `white: true` (colour W: a white
 * stroke over what is already drawn) or `reverse: true` (^FR / ^LR: a white stroke blended with `difference`, like the text and the areas).
 * Published on PB.slices.line.render and registered by js/components/line/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.line = PB.slices.line || {};

  /**
   * Corner radius of a rectangle in 0.1 mm, as the printers apply it: the item's radius clamped to half of the shorter side
   * (0 when absent, negative or not a number). Pure geometry, no DOM.
   */
  function cornerRadius(item) {
    const radius = Number.isFinite(item.radius) ? Math.max(item.radius, 0) : 0;
    return Math.min(radius, Math.min(Math.abs(item.x2 - item.x1), Math.abs(item.y2 - item.y1)) / 2);
  }

  /** The inline style of a white or reversed stroke (inline, so the markup is self-contained and wins over the CSS .stroke); none for a normal one. */
  function strokeStyle(item) {
    if (item.white === true) return ' style="stroke:#fff"';
    return item.reverse === true ? ' style="stroke:#fff;mix-blend-mode:difference"' : '';
  }

  /** ctx comes from drawing.js: { n } rounds a number to 2 decimals for SVG attributes. */
  function render(item, ctx) {
    const { n } = ctx;
    // The thickness comes from the label, which is why it is not in the CSS
    const stroke = `class="stroke" stroke-width="${n(Math.max(item.width, 1))}"${strokeStyle(item)}`;
    const flat = item.x1 === item.x2 || item.y1 === item.y2;
    const radius = cornerRadius(item);
    const round = radius > 0 ? ` rx="${n(radius)}" ry="${n(radius)}"` : '';
    return {
      markup: item.rect && !flat
        ? `<rect x="${Math.min(item.x1, item.x2)}" y="${Math.min(item.y1, item.y2)}" width="${Math.abs(item.x2 - item.x1)}" height="${Math.abs(item.y2 - item.y1)}"${round} ${stroke}/>`
        : `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" ${stroke}/>`,
    };
  }

  PB.slices.line.render = render;
  PB.slices.line.cornerRadius = cornerRadius;
  PB.slices.line.strokeStyle = strokeStyle;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
