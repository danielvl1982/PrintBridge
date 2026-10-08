/**
 * Area slice, TSPL language (TSC TTP): the REVERSE and ERASE commands (B-442/443 manual; all measures in dots).
 *   REVERSE x,y,width,height   reverses (inverts) a region of the image
 *   ERASE   x,y,width,height   blots out a region of the image
 * NOT VERIFIED ON A PRINTER: the manual only gives the syntax and a one-line description; the viewer reads them as acting on what
 * is already in the image buffer when the command runs (the same semantics as TPCL XR), in command order.
 * Both become the neutral `area` item (x, y, width, height in 0.1 mm; REFERENCE and SHIFT folded into x, y) with mode 'reverse'
 * (REVERSE) or 'clear' (ERASE); native keeps the dots of the command: { width, height, kind: 'REVERSE' | 'ERASE' }.
 * Emit (the inverse): REVERSE or ERASE x,y,w,h with the size at least 1 dot. Edit: Ancho / Alto in dots; the position is moved.
 * Palette: ONE entry (Área invertida = REVERSE), 30 x 10 mm at the drop point, written before PRINT (so after the items drawn).
 * factory(helpers) -> { handlers, emit, build, coordinates, editable }; registered by js/components/area/index.js as `languages: { tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.area = PB.slices.area || {};

  const { diagnostics: diag } = PB;

  /** Largest measure offered in the properties panel, in dots. */
  const MAX_DOTS = 9999;

  /** A freshly inserted area: 30 x 10 mm in 0.1 mm. */
  const TEMPLATE = Object.freeze([300, 100]);

  const MODE_BY_COMMAND = Object.freeze({ REVERSE: 'reverse', ERASE: 'clear' });
  const COMMAND_BY_MODE = Object.freeze({ reverse: 'REVERSE', clear: 'ERASE' });

  function tspl(helpers) {
    const { sourceOf, num, exactDots, roundDots, numberField, insertCommand, dropDots, lengthDots } = helpers;

    /** REVERSE / ERASE x,y,w,h of an area item. */
    function emit(item, ctx) {
      const dots = v => exactDots(ctx, Number.isFinite(v) ? v : 0);
      const [x, y] = [item.x, item.y].map(v => Math.max(0, roundDots(dots(v))));
      const [w, h] = [item.width, item.height].map(v => Math.max(1, roundDots(dots(v))));
      return `${COMMAND_BY_MODE[item.mode] || 'REVERSE'} ${x},${y},${w},${h}`;
    }

    /** Adds REVERSE x,y,width,height: TEMPLATE (0.1 mm) at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const [w, h] = TEMPLATE.map(size => lengthDots(options, size));
      return insertCommand(text, `REVERSE ${x},${y},${w},${h}`);
    }

    const isArea = (item, cmd) => (cmd ? Object.hasOwn(MODE_BY_COMMAND, cmd.name) : item.kind === 'area');

    return {
      emit,
      build,
      // Move: x,y are arguments 0 and 1 (dots)
      coordinates: [{ applies: isArea, fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] }],
      // Properties: size in dots; the position is a coordinate, so it is moved, not edited
      editable: [{
        applies: isArea,
        fields: [
          numberField('width', 'Ancho (puntos)', 2, 1, MAX_DOTS, item => item.native && item.native.width),
          numberField('height', 'Alto (puntos)', 3, 1, MAX_DOTS, item => item.native && item.native.height),
        ],
      }],
      handlers: [{
        // REVERSE x,y,width,height / ERASE x,y,width,height
        pattern: /^(REVERSE|ERASE)\b/i,
        handle(m, cmd, ctx) {
          const name = m[1].toUpperCase();
          if (cmd.args.length < 4) { ctx.report(diag.warning(`${name} incompleto: ${cmd.raw.slice(0, 40)}`)); return; }
          const values = cmd.args.slice(0, 4).map(num);
          if (values.includes(null) || values[2] <= 0 || values[3] <= 0) {
            ctx.report(diag.warning(`${name} con valores no válidos: ${cmd.raw.slice(0, 40)}`));
            return;
          }
          const [px, py, w, h] = values;
          const { x, y } = ctx.pos(px, py);
          ctx.addItem({
            kind: 'area', ref: name, mode: MODE_BY_COMMAND[name], source: sourceOf(cmd), x, y, width: ctx.len(w), height: ctx.len(h),
            native: { width: w, height: h, kind: name },
          });
        },
      }],
    };
  }

  PB.slices.area.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
