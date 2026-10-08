/**
 * Box slice, TSPL language (TSC TTP): the BOX command.
 *   BOX x,y,xEnd,yEnd,thickness[,radius]   (all in dots)
 * It becomes the neutral `line` item with rect true, like a TPCL LC rectangle, so the renderer of the line slice draws it.
 * Assumption: the manual does not say toward which side the thickness grows; the viewer follows the convention it already
 * uses for TPCL boxes, where the stroke is centered on the rectangle that the corners span.
 * The corner radius (dots) is kept in native.radius and as the neutral item.radius in 0.1 mm; the renderer draws it rounded.
 * NOT VERIFIED ON A PRINTER: the radius argument comes from the TSC TSPL2 manual v3.0, which is not in docs/ (the local
 * B-442/443 manual documents BOX without it).
 * Emit (the inverse): BOX x1,y1,x2,y2,thickness[,radius] with the corners normalized to min/max, the thickness (item.width) in
 * dots, at least 1, and the radius (item.radius) in dots only when it is greater than 0.
 * factory(helpers) -> { handlers, emit, build, coordinates, editable }; registered by js/components/box/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.box = PB.slices.box || {};

  const { diagnostics: diag } = PB;

  /** Largest thickness / radius offered in the properties panel, in dots. */
  const MAX_DOTS = 9999;

  /** A freshly inserted box: 30 x 20 mm in 0.1 mm, 3 dots thick. */
  const TEMPLATE_SIZE = Object.freeze([300, 200]);
  const TEMPLATE_THICKNESS = 3;

  function tspl(helpers) {
    const { sourceOf, num, exactDots, roundDots, numberField, insertCommand, dropDots, lengthDots } = helpers;

    /** Adds BOX x,y,xEnd,yEnd,thickness: a TEMPLATE_SIZE (0.1 mm, like the TPCL box) rectangle at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const [w, h] = TEMPLATE_SIZE.map(size => lengthDots(options, size));
      return insertCommand(text, `BOX ${x},${y},${x + w},${y + h},${TEMPLATE_THICKNESS}`);
    }

    /** BOX x1,y1,x2,y2,thickness of a box item (corners normalized, thickness at least 1 dot). */
    function emit(item, ctx) {
      const [x1, y1, x2, y2] = [item.x1, item.y1, item.x2, item.y2].map(v => exactDots(ctx, v || 0));
      const thickness = Math.max(1, roundDots(exactDots(ctx, Number.isFinite(item.width) ? item.width : 0)));
      const [left, top, right, bottom] = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].map(roundDots);
      const radius = Number.isFinite(item.radius) ? roundDots(exactDots(ctx, item.radius)) : 0;
      return `BOX ${left},${top},${right},${bottom},${thickness}${radius > 0 ? `,${radius}` : ''}`;
    }

    return {
      // emit(item, ctx) -> the BOX command of a box item
      emit,
      // build(text, point, options) -> text with a new BOX command (palette)
      build,
      // Move: BOX shifts both corners (x,y and xEnd,yEnd: arguments 0..3, dots) by the same delta; thickness and radius stay
      coordinates: [{
        applies: (item, cmd) => !cmd || cmd.name === 'BOX',
        fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }, { arg: 2, axis: 'x' }, { arg: 3, axis: 'y' }],
      }],
      // Properties: thickness and (when present) corner radius; the end corner is a coordinate, so it is moved, not edited
      editable: [{
        applies: (item, cmd) => (cmd ? cmd.name === 'BOX' : item.ref === 'BOX'),
        fields: [
          numberField('thickness', 'Grosor (puntos)', 4, 1, MAX_DOTS, item => item.native && item.native.width),
          // Optional last argument: listed as 0 when omitted; a non-zero value appends it, 0 on an omitted one writes nothing
          { ...numberField('radius', 'Radio de esquina (puntos)', 5, 0, MAX_DOTS, item => (item.native && item.native.radius) || 0), optional: 0 },
        ],
      }],
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
            if (radius !== null) native.radius = radius;
            const a = ctx.pos(px, py);
            const b = ctx.pos(ex, ey);
            const item = {
              kind: 'line', ref: 'BOX', source: sourceOf(cmd), x1: a.x, y1: a.y, x2: b.x, y2: b.y, rect: true,
              width: ctx.len(thickness), native,
            };
            // Rounded corners: the neutral radius is in 0.1 mm, native.radius keeps the dots of the command
            if (radius !== null && radius >= 0) item.radius = ctx.len(radius);
            ctx.addItem(item);
          },
        },
      ],
    };
  }

  PB.slices.box.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
