/**
 * Line slice, TSPL language (TSC TTP): the BAR command.
 *   BAR x,y,width,height   (all in dots; a filled black rectangle)
 * The neutral model has no filled rectangle, so a bar becomes the `line` item (rect false): an axis-aligned thick
 * line along the LONGER side whose `width` is the SHORTER side. The renderer (js/components/line/render.js) draws a
 * <line> with the default butt caps, whose stroke is centered on the segment, so a segment through the middle of the
 * bar covers exactly x..x+width and y..y+height (no compensation needed):
 *   width >= height: (x, y + h/2) -> (x + w, y + h/2), thickness h;  otherwise (x + w/2, y) -> (x + w/2, y + h), thickness w.
 * native keeps the command measures in dots ({ width, height, kind: 'BAR' }, like TPCL keeps native.width).
 * Emit (the inverse): an axis-aligned line (within one dot) becomes BAR x,y,w,h centered on the line, with the line width as
 * thickness; a diagonal line cannot be written (TSPL has DIAGONAL, but this viewer's parser does not read it) and is
 * skipped with a warning. A parsed BAR re-emits identically.
 * factory(helpers) -> { handlers, emit, build, coordinates, editable }; registered by js/components/line/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.line = PB.slices.line || {};

  const { diagnostics: diag } = PB;

  /** Largest width / height offered in the properties panel, in dots. */
  const MAX_DOTS = 9999;

  /** A freshly inserted bar: 40 mm long (0.1 mm, like the TPCL line) and 3 dots thick. */
  const TEMPLATE_LENGTH = 400;
  const TEMPLATE_THICKNESS = 3;

  function tspl(helpers) {
    const { sourceOf, num, exactDots, roundDots, numberField, insertCommand, dropDots, lengthDots } = helpers;

    /** Adds BAR x,y,width,height: a horizontal bar of TEMPLATE_LENGTH (0.1 mm) and TEMPLATE_THICKNESS dots at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      return insertCommand(text, `BAR ${x},${y},${lengthDots(options, TEMPLATE_LENGTH)},${TEMPLATE_THICKNESS}`);
    }

    /** BAR x,y,width,height for an axis-aligned line item; diagonal lines are skipped with a warning. */
    function emit(item, ctx) {
      if (item.white === true) ctx.once('tspl-shape-white', () => diag.warning('Hay líneas o cajas en blanco (color W de ZPL): TSPL no tiene color de trazo, se escriben en negro'));
      else if (item.reverse === true) ctx.once('tspl-shape-reverse', () => diag.warning('Hay líneas o cajas con impresión inversa (^FR o ^LR de ZPL): TSPL no la tiene en estas formas, se escriben normales'));
      const [x1, y1, x2, y2] = [item.x1, item.y1, item.x2, item.y2].map(v => exactDots(ctx, v || 0));
      const rawThickness = roundDots(exactDots(ctx, Number.isFinite(item.width) ? item.width : 0));
      if (rawThickness < 1) ctx.once('tspl-shape-min', () => diag.warning('Hay formas con grosor, ancho o alto menor de 1 punto: TSPL necesita al menos 1 punto, se escriben con 1 punto'));
      const thickness = Math.max(1, rawThickness);
      const horizontal = Math.abs(y2 - y1) <= 1;
      if (!horizontal && Math.abs(x2 - x1) > 1) {
        ctx.once('tspl-diagonal', () => diag.warning('Hay líneas diagonales que no se escriben: TSPL tiene DIAGONAL, pero el intérprete de este visor no lo soporta'));
        return [];
      }
      const length = Math.abs(horizontal ? x2 - x1 : y2 - y1);
      if (roundDots(length) < 1) {
        ctx.once('tspl-line-empty', () => diag.warning('Hay líneas de longitud 0 que no se escriben: BAR necesita al menos 1 punto de largo'));
        return [];
      }
      const [lengthDots, left, top] = [roundDots(length), Math.min(x1, x2), Math.min(y1, y2)];
      return horizontal
        ? `BAR ${roundDots(left)},${roundDots((y1 + y2) / 2 - thickness / 2)},${lengthDots},${thickness}`
        : `BAR ${roundDots((x1 + x2) / 2 - thickness / 2)},${roundDots(top)},${thickness},${lengthDots}`;
    }

    return {
      // emit(item, ctx) -> the BAR command of an axis-aligned line item
      emit,
      // build(text, point, options) -> text with a new BAR command (palette)
      build,
      // Move: BAR x,y are arguments 0 and 1 (dots); width and height (arguments 2 and 3) are measures, not coordinates
      coordinates: [{ applies: (item, cmd) => !cmd || cmd.name === 'BAR', fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] }],
      // Properties: width and height in dots (the item's x2/y2 are derived from them)
      editable: [{
        applies: (item, cmd) => (cmd ? cmd.name === 'BAR' : item.ref === 'BAR'),
        fields: [
          numberField('width', 'Ancho (puntos)', 2, 1, MAX_DOTS, item => item.native && item.native.width),
          numberField('height', 'Alto (puntos)', 3, 1, MAX_DOTS, item => item.native && item.native.height),
        ],
      }],
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
