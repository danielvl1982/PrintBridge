/**
 * Ellipse slice: SVG drawing. The model item is { kind: 'ellipse', ref: 'ELLIPSE' | 'CIRCLE', x, y, width, height, thickness }:
 * x, y is the top-left corner of the bounding box and width, height its size, all in 0.1 mm; thickness is the stroke width.
 * A circle is the same item with equal axes (ref CIRCLE). It is drawn as a stroke-only <ellipse> that fits the bounding box,
 * with the stroke centered on the box edge (the same convention as the box). `white` / `reverse` (ZPL colour W / ^FR) draw the stroke white / blended,
 * like the line slice (PB.slices.line.strokeStyle).
 * Published on PB.slices.ellipse.render and registered by js/components/ellipse/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.ellipse = PB.slices.ellipse || {};

  /** ctx comes from drawing.js: { n } rounds a number to 2 decimals for SVG attributes. */
  function render(item, ctx) {
    const { n } = ctx;
    const [rx, ry] = [item.width / 2, item.height / 2];
    // The thickness comes from the label, which is why it is not in the CSS
    const stroke = `class="stroke" stroke-width="${n(Math.max(Number.isFinite(item.thickness) ? item.thickness : 0, 1))}"${PB.slices.line.strokeStyle(item)}`;
    return { markup: `<ellipse cx="${n(item.x + rx)}" cy="${n(item.y + ry)}" rx="${n(rx)}" ry="${n(ry)}" ${stroke}/>` };
  }

  /**
   * Layout hook (browser only): the bounding box takes part in the outside-the-label check. Like boxes, a ring is often drawn
   * around other content, so it reports no ink box and never counts as an overlap.
   */
  function layout(group) {
    return { full: group.getBBox(), ink: { x: 0, y: 0, width: 0, height: 0 } };
  }

  PB.slices.ellipse.render = render;
  PB.slices.ellipse.layout = layout;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
