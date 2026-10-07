/**
 * Box slice, TSPL language (TSC TTP): the BOX command.
 *   BOX x,y,xEnd,yEnd,thickness[,radius]   (all in dots)
 * It becomes the neutral `line` item with rect true, like a TPCL LC rectangle, so the renderer of the line slice draws it.
 * Assumption: the manual does not say toward which side the thickness grows; the viewer follows the convention it already
 * uses for TPCL boxes, where the stroke is centered on the rectangle that the corners span.
 * The corner radius is kept in native.radius but not drawn (one info per label).
 * Emit (the inverse): BOX x1,y1,x2,y2,thickness with the corners normalized to min/max and the thickness (item.width) in dots,
 * at least 1.
 * factory(helpers) -> { handlers, emit }; registered by js/components/box/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.box = PB.slices.box || {};

  const { diagnostics: diag } = PB;

  function tspl(helpers) {
    const { sourceOf, num, exactDots, roundDots } = helpers;

    /** BOX x1,y1,x2,y2,thickness of a box item (corners normalized, thickness at least 1 dot). */
    function emit(item, ctx) {
      const [x1, y1, x2, y2] = [item.x1, item.y1, item.x2, item.y2].map(v => exactDots(ctx, v || 0));
      const thickness = Math.max(1, roundDots(exactDots(ctx, Number.isFinite(item.width) ? item.width : 0)));
      const [left, top, right, bottom] = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].map(roundDots);
      return `BOX ${left},${top},${right},${bottom},${thickness}`;
    }

    return {
      // emit(item, ctx) -> the BOX command of a box item
      emit,
      handlers: [
        {
          // BOX x,y,xEnd,yEnd,thickness[,radius]
          pattern: /^BOX\b/i,
          handle(m, cmd, ctx) {
            if (cmd.args.length < 5) { ctx.report(diag.warning(`BOX incompleto: ${cmd.raw.slice(0, 40)}`)); return; }
            const [px, py, ex, ey, thickness] = cmd.args.slice(0, 5).map(num);
            if ([px, py, ex, ey, thickness].includes(null) || thickness <= 0) {
              ctx.report(diag.warning(`BOX con valores no válidos: ${cmd.raw.slice(0, 40)}`));
              return;
            }
            const native = { width: thickness, kind: 'BOX' };
            const radius = cmd.args.length > 5 ? num(cmd.args[5]) : null;
            if (radius !== null) {
              native.radius = radius;
              if (radius > 0 && !ctx.tsplBoxRadiusNoted) {
                ctx.tsplBoxRadiusNoted = true;
                ctx.report(diag.info('BOX: radio de esquina no soportado, se dibuja con esquinas rectas'));
              }
            }
            const a = ctx.pos(px, py);
            const b = ctx.pos(ex, ey);
            ctx.addItem({
              kind: 'line', ref: 'BOX', source: sourceOf(cmd), x1: a.x, y1: a.y, x2: b.x, y2: b.y, rect: true,
              width: ctx.len(thickness), native,
            });
          },
        },
      ],
    };
  }

  PB.slices.box.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
