/**
 * Box slice, ZPL language (Zebra): the graphic box command, which draws boxes, lines and the filled / reversed / white areas.
 *   ^FOx,y ^GBw,h,t,c,r [^FR] ^FS        w, h = the outer size in dots (from t to 32000, default t or 1), t = border thickness 1..32000 (default 1, it
 *                                          grows inward), c = B | W (default B), r = rounding degree 0..8 (default 0); ^FT: the bottom-left corner
 * The geometry, the neutral items and what the 2003 guide does not document are described in js/components/line/zpl.js (the shared model of the ZPL
 * shapes). This file parses ^GB into the three neutral items it can be and writes the boxes back:
 *   - an OUTLINE (2t < the shorter side): the neutral `line` item with rect true (this slice), inset by t / 2 with the stroke t and the radius of the
 *     guide's formula (radius = (r / 8) * (shorter side / 2)) minus t / 2; `white` / `reverse` flags for the colour W and ^FR / ^LRY;
 *   - a SOLID box (2t >= the shorter side): a bar (`line`, rect false) when black and square; a thick rounded rect when black and rounded; the `area`
 *     item (mode `clear` for W, `reverse` with ^FR / ^LRY) otherwise, drawn square (rounding reported once).
 * Emit (the inverse, for the boxes): ^GBw,h,t[,B[,r]] over the outer box (the corners plus t / 2 all round), the radius as the nearest degree 0..8 (one
 * info when it cannot be reproduced), thickness limited to 1..32000 (warning), ^FR for a reversed box, W for a white one.
 * Palette: a 30 x 20 mm box, 3 dots thick, written as `^GB300,200,3,B,0` (in dots).
 * factory(helpers) -> { handlers, emit, build, editable }; the move is the line slice's (same model kind); registered by js/components/box/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.box = PB.slices.box || {};

  const { diagnostics: diag } = PB;

  /** A freshly inserted box: 30 x 20 mm in 0.1 mm, 3 dots thick. */
  const TEMPLATE_SIZE = Object.freeze([300, 200]);
  const TEMPLATE_THICKNESS = 3;

  function zpl(helpers) {
    const { numberField, insertCommand, dropDots, lengthDots, exactDots, roundDots } = helpers;
    const S = PB.slices.line.zplShape(helpers);
    const { MAX_BOX } = S;

    // -------------------------------------------------------------------------------------------------------------
    // Palette

    /** Adds ^FOx,y^GBw,h,3,B,0^FS: TEMPLATE_SIZE (0.1 mm) at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const [w, h] = TEMPLATE_SIZE.map(size => lengthDots(options, size));
      return insertCommand(text, `^FO${x},${y}^GB${w},${h},${TEMPLATE_THICKNESS},B,0^FS`);
    }

    // -------------------------------------------------------------------------------------------------------------
    // Parse

    /** ^GBw,h,t,c,r -> the area, the bar or the box item of the field (see the header). */
    function gbItem(ctx, field, cmd) {
      const t = S.readDots(ctx, cmd, 2, 'grosor', 1, MAX_BOX) ?? 1;
      // The guide: w and h are "from t": a smaller value (the lines are drawn with a 0) is raised to the thickness; the default is the thickness
      const w = Math.max(S.readDots(ctx, cmd, 0, 'ancho', 0, MAX_BOX) ?? t, t);
      const h = Math.max(S.readDots(ctx, cmd, 1, 'alto', 0, MAX_BOX) ?? t, t);
      const look = S.appearance(ctx, cmd, field, 3);
      const rounding = S.readRounding(ctx, cmd, 4);
      const short = Math.min(w, h);
      const solid = 2 * t >= short;
      const o = S.origin(ctx, field, h);
      const native = { kind: 'GB', w, h, thickness: t, color: look.color, rounding, origin: o.kind };
      const common = S.base(ctx, field, 'GB', native);

      if (solid && (look.white || look.reverse)) {
        if (rounding > 0) ctx.once('zpl-gb-area-round', () => diag.info('^GB: un área invertida o en blanco con esquinas redondeadas se dibuja sin redondeo (las áreas del visor son rectángulos)'));
        return { kind: 'area', mode: look.white ? 'clear' : 'reverse', x: o.x, y: o.y, width: ctx.len(w), height: ctx.len(h), ...common };
      }
      if (solid && rounding === 0) {
        // A solid black box: a bar along its longer side, as TSPL BAR
        return {
          kind: 'line', rect: false,
          ...(w >= h
            ? { x1: o.x, y1: o.y + ctx.len(h) / 2, x2: o.x + ctx.len(w), y2: o.y + ctx.len(h) / 2, width: ctx.len(h) }
            : { x1: o.x + ctx.len(w) / 2, y1: o.y, x2: o.x + ctx.len(w) / 2, y2: o.y + ctx.len(h), width: ctx.len(w) }),
          ...common,
        };
      }
      // An outline, or a solid black rounded box (the border meets in the middle: stroke = half the shorter side)
      const stroke = solid ? short / 2 : t;
      const radius = S.radiusFor(rounding, short, stroke);
      return {
        kind: 'line', rect: true, width: ctx.len(stroke),
        x1: o.x + ctx.len(stroke / 2), y1: o.y + ctx.len(stroke / 2), x2: o.x + ctx.len(w - stroke / 2), y2: o.y + ctx.len(h - stroke / 2),
        ...(radius > 0 && { radius: ctx.len(radius) }), ...(look.white && { white: true }), ...(look.reverse && { reverse: true }),
        ...common,
      };
    }

    // -------------------------------------------------------------------------------------------------------------
    // Emit

    /** ^FOx,y^GBw,h,t[,B[,r]] of a box item: the outer box is the neutral corners plus half the thickness all round. */
    function emit(item, ctx) {
      const t = S.thickness(ctx, item.width, 1, MAX_BOX, 'zpl-gb-thickness', `Hay grosores de línea de más de ${MAX_BOX} puntos: ZPL (^GB / ^GD) admite de 1 a ${MAX_BOX}, se ajustan al máximo`);
      const [x1, y1, x2, y2] = [item.x1, item.y1, item.x2, item.y2].map(v => exactDots(ctx, v || 0));
      const size = span => Math.min(MAX_BOX, Math.max(t.dots, roundDots(span + t.exact)));
      const [w, h] = [size(Math.abs(x2 - x1)), size(Math.abs(y2 - y1))];
      const radius = Number.isFinite(item.radius) ? exactDots(ctx, item.radius) : 0;
      const short = Math.min(w, h);
      const rounding = S.degreeOf(item, radius, short, t.exact);
      if (radius > 0 && Math.abs((rounding / 8) * (short / 2) - (radius + t.exact / 2)) > 0.5) {
        ctx.once('zpl-gb-rounding', () => diag.info('El grado de redondeo de ^GB en ZPL (0 a 8: radio = grado / 8 de la mitad del lado corto) no reproduce el radio exacto de algunas cajas: se usa el grado más cercano'));
      }
      const left = roundDots(Math.min(x1, x2) - t.exact / 2);
      const top = roundDots(Math.min(y1, y2) - t.exact / 2);
      return `${S.place(ctx, item, left, top, h)}${S.gb(w, h, t.dots, { white: item.white === true, rounding })}${S.fr(item)}^FS`;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Edit

    const native = key => item => (item.native && item.native[key] != null ? item.native[key] : undefined);

    return {
      // emit(item, ctx) -> the ^GB field of a box item
      emit,
      // build(text, point, options) -> text with a new box (palette)
      build,
      // Properties: the box of the guide's parameters (the bars and areas have their own lists in the line and area slices)
      editable: [{
        applies: (item, field) => item.kind === 'line' && item.rect === true && (field ? field.has('GB') : item.ref === 'GB'),
        fields: [
          numberField('width', 'Ancho (puntos)', 'GB', 0, 1, MAX_BOX, native('w')),
          numberField('height', 'Alto (puntos)', 'GB', 1, 1, MAX_BOX, native('h')),
          numberField('thickness', 'Grosor (puntos)', 'GB', 2, 1, MAX_BOX, native('thickness')),
          S.roundingField('GB'),
          S.colorField('GB', 3),
          S.reverse(),
        ],
      }],
      handlers: [{
        // ^GBw,h,t,c,r: a box, a bar or an area
        pattern: /^\^GB$/,
        handle(m, cmd, ctx, field) { ctx.addItem(gbItem(ctx, field, cmd)); },
      }],
    };
  }

  PB.slices.box.zpl = zpl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
