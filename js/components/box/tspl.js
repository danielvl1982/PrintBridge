/**
 * Box slice, TSPL language (TSC TTP): the BOX command.
 *   BOX x,y,xEnd,yEnd,thickness[,radius]   (all in dots)
 * It becomes the neutral `line` item with rect true, like a TPCL LC rectangle, so the renderer of the line slice draws it.
 * Assumption: the manual does not say toward which side the thickness grows; the viewer follows the convention it already
 * uses for TPCL boxes, where the stroke is centered on the rectangle that the corners span.
 * The corner radius is kept in native.radius but not drawn (one info per label).
 * factory(helpers) -> { handlers }; registered by js/components/box/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.box = PB.slices.box || {};

  const { diagnostics: diag } = PB;

  function tspl(helpers) {
    const { sourceOf, num } = helpers;

    return {
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
