/**
 * Line slice, TSPL language (TSC TTP): the BAR command.
 *   BAR x,y,width,height   (all in dots; a filled black rectangle)
 * The neutral model has no filled rectangle, so a bar becomes the `line` item (rect false): an axis-aligned thick
 * line along the LONGER side whose `width` is the SHORTER side. The renderer (js/components/line/render.js) draws a
 * <line> with the default butt caps, whose stroke is centered on the segment, so a segment through the middle of the
 * bar covers exactly x..x+width and y..y+height (no compensation needed):
 *   width >= height: (x, y + h/2) -> (x + w, y + h/2), thickness h;  otherwise (x + w/2, y) -> (x + w/2, y + h), thickness w.
 * native keeps the command measures in dots ({ width, height, kind: 'BAR' }, like TPCL keeps native.width).
 * factory(helpers) -> { handlers }; registered by js/components/line/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.line = PB.slices.line || {};

  const { diagnostics: diag } = PB;

  function tspl(helpers) {
    const { sourceOf, num } = helpers;

    return {
      handlers: [
        {
          // BAR x,y,width,height
          pattern: /^BAR\b/i,
          handle(m, cmd, ctx) {
            if (cmd.args.length < 4) { ctx.report(diag.warning(`BAR incompleto: ${cmd.raw.slice(0, 40)}`)); return; }
            const [px, py, w, h] = cmd.args.slice(0, 4).map(num);
            if ([px, py, w, h].includes(null) || w <= 0 || h <= 0) {
              ctx.report(diag.warning(`BAR con valores no válidos: ${cmd.raw.slice(0, 40)}`));
              return;
            }
            const horizontal = w >= h;
            const start = ctx.pos(px, py);
            const end = ctx.pos(px + w, py + h);
            const item = {
              kind: 'line', ref: 'BAR', source: sourceOf(cmd), rect: false, native: { width: w, height: h, kind: 'BAR' },
              ...(horizontal
                ? { x1: start.x, y1: (start.y + end.y) / 2, x2: end.x, y2: (start.y + end.y) / 2, width: ctx.len(h) }
                : { x1: (start.x + end.x) / 2, y1: start.y, x2: (start.x + end.x) / 2, y2: end.y, width: ctx.len(w) }),
            };
            ctx.addItem(item);
          },
        },
      ],
    };
  }

  PB.slices.line.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
