/**
 * Area slice: SVG drawing. The model item is { kind: 'area', ref: 'XR' | 'REVERSE' | 'ERASE', mode: 'reverse' | 'clear', x, y, width, height }:
 * x, y is the top-left corner and width, height the size, all in 0.1 mm.
 * Both printer commands act on the image buffer content ALREADY drawn when they run, so the area is painted at its position in
 * the command order (drawing.js paints the model items in order, and the parsers add them in command order): what comes later
 * is drawn over it untouched.
 *  - clear: a plain white rect over what is already drawn (the paper colour).
 *  - reverse: a white rect blended with `mix-blend-mode: difference`, which turns the pixels underneath into their inverse
 *    (white -> black, black -> white). The blend is inline (not in the CSS) so the markup is self-contained. It inverts against
 *    the SVG backdrop, which holds the white label background drawn first. NOT TESTABLE IN NODE: check it in a browser.
 * A transparent .hit rect goes after the painted one so that clicking selects the area and the hover/selection highlight is
 * painted over the inversion (the blended rect itself is not a reliable click target).
 * Published on PB.slices.area.render and registered by js/components/area/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.area = PB.slices.area || {};

  /** ctx comes from drawing.js: { n } rounds a number to 2 decimals for SVG attributes. */
  function render(item, ctx) {
    const { n } = ctx;
    const box = `x="${n(item.x)}" y="${n(item.y)}" width="${n(Math.max(item.width, 0))}" height="${n(Math.max(item.height, 0))}"`;
    const painted = item.mode === 'clear'
      ? `<rect class="area area-clear" ${box} fill="#fff"/>`
      : `<rect class="area area-reverse" ${box} fill="#fff" style="mix-blend-mode:difference"/>`;
    return { markup: `${painted}<rect class="hit" ${box}/>` };
  }

  /**
   * Layout hook (browser only): the area takes part in the outside-the-label check but never in the overlap check (it is meant to
   * lie over other content), so it reports no ink box, like boxes and ellipses.
   */
  function layout(group) {
    return { full: group.getBBox(), ink: { x: 0, y: 0, width: 0, height: 0 } };
  }

  PB.slices.area.render = render;
  PB.slices.area.layout = layout;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
