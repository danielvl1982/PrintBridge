/**
 * Ellipse slice, ZPL language (Zebra): the circle ^GC and the ellipse ^GE.
 *   ^FOx,y ^GCd,t,c [^FR] ^FS        d = diameter 3..4095 (default 3), t = thickness (the guide's table: 2..4095, default 1: it extends INWARD), c = B | W
 *   ^FOx,y ^GEw,h,t,c [^FR] ^FS      w, h = 3..4095 (default t or 1)
 * Both become the neutral `ellipse` item (see js/core/model.js): the stroke is centred, so the ZPL ellipse whose border grows inward from the w x h
 * box is the centre ellipse inset by t / 2: x = X + t / 2, width = w - t, thickness = t (js/components/line/zpl.js describes the shared model of the
 * ZPL shapes). A border thicker than half of the shorter side meets in the middle: the stroke is limited to that half, the shape is solid. ^GC keeps
 * ref 'CIRCLE' (the `circle` slice) and ^GE ref 'ELLIPSE' (the `ellipse` slice), like TSPL; `white` (colour W) and `reverse` (^FR / ^LRY) are flags that
 * js/components/ellipse/render.js draws. native: { kind: 'GC', diameter, thickness, color, origin } or { kind: 'GE', w, h, thickness, color, origin }.
 * NOT VERIFIED ON A PRINTER: the 2003 guide has no picture of the geometry, nor the origin ^FT of ^GC / ^GE (assumed the bottom-left of the box, as ^GB).
 * Emit (the inverse): ^GCd,t[,W] for a circle item with equal axes in whole dots, ^GEw,h,t[,W] otherwise (the outer box is the neutral one plus t / 2 all
 * round), thickness 2..4095 and sizes 3..4095 (warning once each), ^FR for a reversed one; ^FT is kept for an item that came from an ^FT field.
 * Palette: Elipse = ^GE 30 x 20 mm, Círculo = ^GC 20 mm, both 3 dots thick.
 * factory(helpers) -> { handlers?, emit, build, coordinates, editable }; registered by js/components/ellipse/index.js as `languages.zpl` (ellipse) and
 * `languages.zpl` (circle, `zplCircle`).
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.ellipse = PB.slices.ellipse || {};

  const { diagnostics: diag } = PB;

  /** A freshly inserted ellipse: 30 x 20 mm in 0.1 mm; a circle: 20 mm across; both 3 dots thick. */
  const TEMPLATE_ELLIPSE = Object.freeze([300, 200]);
  const TEMPLATE_CIRCLE = 200;
  const TEMPLATE_THICKNESS = 3;

  /** Emit and the neutral geometry both slices share. */
  function shared(helpers) {
    const { exactDots, roundDots } = helpers;
    const S = PB.slices.line.zplShape(helpers);
    const { MAX_ROUND, MIN_ROUND_SIZE, MIN_ROUND_THICKNESS } = S;

    /** ^GCd,t[,W] or ^GEw,h,t[,W] of an ellipse item. */
    function emit(item, ctx) {
      const dots = v => exactDots(ctx, Number.isFinite(v) ? v : 0);
      const t = S.thickness(ctx, item.thickness, MIN_ROUND_THICKNESS, MAX_ROUND, 'zpl-ge-thickness', `Hay elipses o círculos con un grosor fuera de ${MIN_ROUND_THICKNESS}..${MAX_ROUND} puntos: ZPL (^GC / ^GE) lo limita`);
      const size = v => {
        const outer = roundDots(v + t.exact);
        if (outer > MAX_ROUND || outer < MIN_ROUND_SIZE) ctx.once('zpl-ge-size', () => diag.warning(`Hay elipses o círculos de más de ${MAX_ROUND} o menos de ${MIN_ROUND_SIZE} puntos: ZPL (^GC / ^GE) admite de ${MIN_ROUND_SIZE} a ${MAX_ROUND}, se ajustan`));
        return S.clamp(outer, MIN_ROUND_SIZE, MAX_ROUND);
      };
      const [w, h] = [size(dots(item.width)), size(dots(item.height))];
      const left = roundDots(dots(item.x) - t.exact / 2);
      const top = roundDots(dots(item.y) - t.exact / 2);
      const white = item.white === true ? ',W' : '';
      const body = item.ref === 'CIRCLE' && w === h ? `^GC${w},${t.dots}${white}` : `^GE${w},${h},${t.dots}${white}`;
      return `${S.place(ctx, item, left, top, h)}${body}${S.fr(item)}^FS`;
    }

    // Move: the field origin (^FO / ^FT), the default coordinates
    const coordinates = [{ applies: item => item.kind === 'ellipse' }];

    const native = key => item => (item.native && item.native[key] != null ? item.native[key] : undefined);
    return { S, emit, coordinates, native };
  }

  /** The `ellipse` slice (^GE): parse handlers for both commands, build, emit, move and edit. */
  function ellipse(helpers) {
    const { numberField, insertCommand, dropDots, lengthDots } = helpers;
    const { S, emit, coordinates, native } = shared(helpers);
    const { MAX_ROUND, MIN_ROUND_SIZE, MIN_ROUND_THICKNESS } = S;

    /** The neutral ellipse of a w x h box with thickness t (dots) at the field origin: the centre line is inset by half of the stroke. */
    function makeItem(ctx, field, cmd, ref, w, h, t, nativeValues) {
      const look = S.appearance(ctx, cmd, field, ref === 'CIRCLE' ? 2 : 3);
      const stroke = Math.min(t, Math.min(w, h) / 2);
      const o = S.origin(ctx, field, h);
      return {
        kind: 'ellipse', x: o.x + ctx.len(stroke / 2), y: o.y + ctx.len(stroke / 2), width: ctx.len(w - stroke), height: ctx.len(h - stroke), thickness: ctx.len(stroke),
        ...(look.white && { white: true }), ...(look.reverse && { reverse: true }),
        ...S.base(ctx, field, ref, { ...nativeValues, thickness: t, color: look.color, origin: o.kind }),
      };
    }

    /** Adds ^FOx,y^GEw,h,3^FS: TEMPLATE_ELLIPSE (0.1 mm) at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const [w, h] = TEMPLATE_ELLIPSE.map(size => lengthDots(options, size));
      return insertCommand(text, `^FO${x},${y}^GE${w},${h},${TEMPLATE_THICKNESS}^FS`);
    }

    return {
      emit,
      build,
      coordinates,
      editable: [{
        applies: (item, field) => item.kind === 'ellipse' && (field ? field.has('GE') : item.ref === 'ELLIPSE'),
        fields: [
          numberField('width', 'Ancho (puntos)', 'GE', 0, MIN_ROUND_SIZE, MAX_ROUND, native('w')),
          numberField('height', 'Alto (puntos)', 'GE', 1, MIN_ROUND_SIZE, MAX_ROUND, native('h')),
          numberField('thickness', 'Grosor (puntos)', 'GE', 2, MIN_ROUND_THICKNESS, MAX_ROUND, native('thickness')),
          S.colorField('GE', 3),
          S.reverse(),
        ],
      }],
      handlers: [
        {
          // ^GEw,h,t,c: an ellipse (width and height default to the thickness)
          pattern: /^\^GE$/,
          handle(m, cmd, ctx, field) {
            const t = S.readDots(ctx, cmd, 2, 'grosor', 1, MAX_ROUND) ?? 1;
            const w = S.readDots(ctx, cmd, 0, 'ancho', MIN_ROUND_SIZE, MAX_ROUND) ?? t;
            const h = S.readDots(ctx, cmd, 1, 'alto', MIN_ROUND_SIZE, MAX_ROUND) ?? t;
            ctx.addItem(makeItem(ctx, field, cmd, 'ELLIPSE', w, h, t, { kind: 'GE', w, h }));
          },
        },
        {
          // ^GCd,t,c: a circle (diameter 3 by default)
          pattern: /^\^GC$/,
          handle(m, cmd, ctx, field) {
            const t = S.readDots(ctx, cmd, 1, 'grosor', 1, MAX_ROUND) ?? 1;
            const d = S.readDots(ctx, cmd, 0, 'diámetro', MIN_ROUND_SIZE, MAX_ROUND) ?? MIN_ROUND_SIZE;
            ctx.addItem(makeItem(ctx, field, cmd, 'CIRCLE', d, d, t, { kind: 'GC', diameter: d }));
          },
        },
      ],
    };
  }

  /** The `circle` slice (^GC): build, emit, move and edit (its command is parsed by the ellipse slice). */
  function circle(helpers) {
    const { numberField, insertCommand, dropDots, lengthDots } = helpers;
    const { S, emit, coordinates, native } = shared(helpers);
    const { MAX_ROUND, MIN_ROUND_SIZE, MIN_ROUND_THICKNESS } = S;

    /** Adds ^FOx,y^GCd,3^FS: TEMPLATE_CIRCLE (0.1 mm) across at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      return insertCommand(text, `^FO${x},${y}^GC${lengthDots(options, TEMPLATE_CIRCLE)},${TEMPLATE_THICKNESS}^FS`);
    }

    return {
      emit,
      build,
      coordinates,
      editable: [{
        applies: (item, field) => item.kind === 'ellipse' && (field ? field.has('GC') : item.ref === 'CIRCLE'),
        fields: [
          numberField('diameter', 'Diámetro (puntos)', 'GC', 0, MIN_ROUND_SIZE, MAX_ROUND, native('diameter')),
          numberField('thickness', 'Grosor (puntos)', 'GC', 1, MIN_ROUND_THICKNESS, MAX_ROUND, native('thickness')),
          S.colorField('GC', 2),
          S.reverse(),
        ],
      }],
    };
  }

  PB.slices.ellipse.zpl = ellipse;
  PB.slices.ellipse.zplCircle = circle;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
