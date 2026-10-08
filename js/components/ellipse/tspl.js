/**
 * Ellipse slice, TSPL language (TSC TTP): the ELLIPSE and CIRCLE commands (all measures in dots).
 *   ELLIPSE x,y,width,height,thickness   x,y = upper-left corner of the bounding box
 *   CIRCLE  x,y,diameter,thickness       x,y = upper-left corner of the bounding box
 * NOT VERIFIED ON A PRINTER: both commands are defined as in the TSC TSPL2 manual v3.0, which is not available locally (the
 * B-442/443 manual in docs/ has neither of them). Assumption: like BOX, the stroke is centered on the edge of the bounding box.
 * Both become the neutral `ellipse` item (x, y, width, height, thickness in 0.1 mm; REFERENCE and SHIFT folded into x, y); a
 * CIRCLE has equal axes and keeps ref 'CIRCLE' so that emit writes it back as CIRCLE. native keeps the dots of the command:
 * { width, height, thickness, kind: 'ELLIPSE' } or { diameter, thickness, kind: 'CIRCLE' }.
 * Emit (the inverse): ELLIPSE x,y,w,h,t, or CIRCLE x,y,d,t when ref is CIRCLE and the axes are equal in whole dots; sizes and
 * thickness are at least 1 dot.
 * The two palette entries ("Elipse", "Círculo") are two slices sharing the model kind, like line and box: `ellipse` (ref
 * ELLIPSE) and `circle` (ref CIRCLE). The parse handlers live in the ellipse slice only.
 * factory(helpers) -> { handlers?, emit, build, coordinates, editable }; registered by js/components/ellipse/index.js as `languages: { tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.ellipse = PB.slices.ellipse || {};

  const { diagnostics: diag } = PB;

  /** Largest measure offered in the properties panel, in dots. */
  const MAX_DOTS = 9999;

  /** A freshly inserted ellipse: 30 x 20 mm in 0.1 mm; a circle: 20 mm across; both 3 dots thick. */
  const TEMPLATE_ELLIPSE = Object.freeze([300, 200]);
  const TEMPLATE_CIRCLE = 200;
  const TEMPLATE_THICKNESS = 3;

  /** Emitter, move and the arguments the two slices have in common. */
  function shared(helpers) {
    const { exactDots, roundDots } = helpers;

    /** ELLIPSE x,y,w,h,t or CIRCLE x,y,d,t of an ellipse item. */
    function emit(item, ctx) {
      const dots = v => exactDots(ctx, Number.isFinite(v) ? v : 0);
      const [x, y] = [item.x, item.y].map(v => Math.max(0, roundDots(dots(v))));
      const [w, h] = [item.width, item.height].map(v => Math.max(1, roundDots(dots(v))));
      const thickness = Math.max(1, roundDots(dots(item.thickness)));
      return item.ref === 'CIRCLE' && w === h ? `CIRCLE ${x},${y},${w},${thickness}` : `ELLIPSE ${x},${y},${w},${h},${thickness}`;
    }

    // Move: x,y of the bounding box are arguments 0 and 1 (dots) of both commands
    const coordinates = name => [{ applies: (item, cmd) => (cmd ? cmd.name === name : item.ref === name), fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] }];

    return { emit, coordinates };
  }

  /** The `ellipse` slice (ELLIPSE): parse handlers for both commands, build, emit, move and edit. */
  function ellipse(helpers) {
    const { sourceOf, num, numberField, insertCommand, dropDots, lengthDots } = helpers;
    const { emit, coordinates } = shared(helpers);

    /** Adds ELLIPSE x,y,width,height,thickness: TEMPLATE_ELLIPSE (0.1 mm) at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const [w, h] = TEMPLATE_ELLIPSE.map(size => lengthDots(options, size));
      return insertCommand(text, `ELLIPSE ${x},${y},${w},${h},${TEMPLATE_THICKNESS}`);
    }

    /** Validates the numeric arguments (count = how many the command needs); null after reporting a warning. */
    function read(name, count, cmd, ctx) {
      if (cmd.args.length < count) { ctx.report(diag.warning(`${name} incompleto: ${cmd.raw.slice(0, 40)}`)); return null; }
      const values = cmd.args.slice(0, count).map(num);
      // The measures (everything after x,y) must be positive
      if (values.includes(null) || values.slice(2).some(v => v <= 0)) {
        ctx.report(diag.warning(`${name} con valores no válidos: ${cmd.raw.slice(0, 40)}`));
        return null;
      }
      return values;
    }

    return {
      emit,
      build,
      coordinates: coordinates('ELLIPSE'),
      // Properties: size and thickness in dots; the position is a coordinate, so it is moved, not edited
      editable: [{
        applies: (item, cmd) => (cmd ? cmd.name === 'ELLIPSE' : item.ref === 'ELLIPSE'),
        fields: [
          numberField('width', 'Ancho (puntos)', 2, 1, MAX_DOTS, item => item.native && item.native.width),
          numberField('height', 'Alto (puntos)', 3, 1, MAX_DOTS, item => item.native && item.native.height),
          numberField('thickness', 'Grosor (puntos)', 4, 1, MAX_DOTS, item => item.native && item.native.thickness),
        ],
      }],
      handlers: [
        {
          // ELLIPSE x,y,width,height,thickness
          pattern: /^ELLIPSE\b/i,
          handle(m, cmd, ctx) {
            const values = read('ELLIPSE', 5, cmd, ctx);
            if (!values) return;
            const [px, py, w, h, thickness] = values;
            const { x, y } = ctx.pos(px, py);
            ctx.addItem({
              kind: 'ellipse', ref: 'ELLIPSE', source: sourceOf(cmd), x, y, width: ctx.len(w), height: ctx.len(h), thickness: ctx.len(thickness),
              native: { width: w, height: h, thickness, kind: 'ELLIPSE' },
            });
          },
        },
        {
          // CIRCLE x,y,diameter,thickness
          pattern: /^CIRCLE\b/i,
          handle(m, cmd, ctx) {
            const values = read('CIRCLE', 4, cmd, ctx);
            if (!values) return;
            const [px, py, diameter, thickness] = values;
            const { x, y } = ctx.pos(px, py);
            ctx.addItem({
              kind: 'ellipse', ref: 'CIRCLE', source: sourceOf(cmd), x, y, width: ctx.len(diameter), height: ctx.len(diameter), thickness: ctx.len(thickness),
              native: { diameter, thickness, kind: 'CIRCLE' },
            });
          },
        },
      ],
    };
  }

  /** The `circle` slice (CIRCLE): build, emit, move and edit (its command is parsed by the ellipse slice). */
  function circle(helpers) {
    const { numberField, insertCommand, dropDots, lengthDots } = helpers;
    const { emit, coordinates } = shared(helpers);

    /** Adds CIRCLE x,y,diameter,thickness: TEMPLATE_CIRCLE (0.1 mm) across at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      return insertCommand(text, `CIRCLE ${x},${y},${lengthDots(options, TEMPLATE_CIRCLE)},${TEMPLATE_THICKNESS}`);
    }

    return {
      emit,
      build,
      coordinates: coordinates('CIRCLE'),
      editable: [{
        applies: (item, cmd) => (cmd ? cmd.name === 'CIRCLE' : item.ref === 'CIRCLE'),
        fields: [
          numberField('diameter', 'Diámetro (puntos)', 2, 1, MAX_DOTS, item => item.native && item.native.diameter),
          numberField('thickness', 'Grosor (puntos)', 3, 1, MAX_DOTS, item => item.native && item.native.thickness),
        ],
      }],
    };
  }

  PB.slices.ellipse.tspl = ellipse;
  PB.slices.ellipse.tsplCircle = circle;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
