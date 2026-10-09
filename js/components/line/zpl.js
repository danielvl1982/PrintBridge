/**
 * Line slice, ZPL language (Zebra): the diagonal line ^GD, the bars ^GB (the solid boxes, which are lines) and the tools every ZPL shape shares.
 *   ^FOx,y ^GDw,h,t,c,o ^FS        w, h = the box the line crosses (3..32000), t = thickness 1..32000, c = B | W, o = R (/) | L (\)
 *   ^FOx,y ^GBw,h,t,c,r ^FS        a graphic box (see js/components/box/zpl.js, which parses it): a box whose border meets in the middle is a bar
 * Source: ZPL II Programming Guide, Volume One (2003), local copy in docs/zpl (never committed). What it documents: the parameter layouts above,
 * the defaults (w and h = the thickness or 1, t = 1, c = B, r = 0, o = R), that the same command draws boxes and lines (a width or height of 0
 * becomes the thickness, so ^GB0,100,20 is a vertical line 20 wide), the rounding formula (radius = (r / 8) * (shorter side / 2)), that ^FT is the
 * bottom-left corner of a box, that ^FR reverses the field against its background and ^LRY every later field until ^LRN.
 * NOT in the guide (so what follows is the viewer's model, NOT VERIFIED ON A PRINTER): the picture of the geometry (the thickness of a box grows
 * inward from the w x h box: assumed, like the thickness of ^GC "extends inward"); the minimum of w and h of ^GB under the thickness (the guide says
 * "from the value of t": a smaller value is raised to t, which is how the lines are drawn); where a ^GD line lies inside its box with a thickness
 * (assumed: its centre line goes corner to corner); the origin ^FT of ^GD, ^GC and ^GE (assumed the bottom-left of the box, like ^GB); that a
 * border meets in the middle when 2t >= the shorter side (assumed: the box is solid); the result of ^FR on a white (W) shape (the viewer draws it
 * white).
 *
 * ---- Neutral items ---------------------------------------------------------------------------------------------------------------
 * The neutral line / box are stroked on their centre line (TPCL LC, TSPL BOX), so a ZPL box w x h with thickness t is the rectangle inset by t / 2
 * with the stroke t: x1 = X + t / 2, x2 = X + w - t / 2 (the same for y), width = t. The corner radius of the neutral rect is the centre line's: the
 * guide's radius R = (r / 8) * (shorter side / 2) minus t / 2 (never below 0); native.rounding keeps the degree r, which a thick border can swallow.
 * A solid box (2t >= the shorter side) is: a BAR (line item, rect false: along the longer side, its width the shorter side, like TSPL BAR) when it is
 * black and square; a thick rect with the stroke t = shorter / 2 when it is black and rounded; the area `reverse` with ^FR and the area `clear` when it
 * is white (js/components/area/zpl.js). White (W) and reversed (^FR / ^LR) outlines and diagonals are the line items with `white: true` /
 * `reverse: true` (js/components/line/render.js draws them). ^GD: rect false, R = (X, Y + h) -> (X + w, Y), L = (X, Y) -> (X + w, Y + h).
 * native: { kind: 'GB' | 'GD', w, h, thickness, color, rounding (GB), orientation (GD), origin: 'FO' | 'FT' | 'default', labelReverse? } in dots.
 * Emit (the inverse, in this file for the line items): an axis-aligned line (within one dot) is a bar ^GBlength,t,t centred on the line; a slanted one
 * ^GDw,h,t[,c[,o]] over its bounding box (R when it goes up to the right). Limits of the guide: thickness 1..32000 and w, h 3..32000 for ^GD (a
 * warning once each). ^FT is kept when the item came from an ^FT field. The `shape` helpers below are shared with the box, ellipse and area slices.
 * factory(helpers) -> { handlers, emit, build, coordinates, editable }; registered by js/components/line/index.js as `languages: { tpcl, tspl, zpl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.line = PB.slices.line || {};

  const { diagnostics: diag } = PB;

  /** Limits of the guide: ^GB / ^GD up to 32000 dots, ^GC / ^GE up to 4095 (thickness from 2: the guide's table says 2, its default 1). */
  const MAX_BOX = 32000;
  const MAX_ROUND = 4095;
  const MIN_DIAGONAL = 3;
  const MIN_ROUND_SIZE = 3;
  const MIN_ROUND_THICKNESS = 2;

  /** A freshly inserted line: 40 mm long (0.1 mm, like the TPCL line) and 3 dots thick. */
  const TEMPLATE_LENGTH = 400;
  const TEMPLATE_THICKNESS = 3;

  const COLOR_OPTIONS = Object.freeze([{ value: 'B', label: 'Negro' }, { value: 'W', label: 'Blanco' }]);
  const ORIENTATION_OPTIONS = Object.freeze([{ value: 'R', label: 'Derecha (/)' }, { value: 'L', label: 'Izquierda (\\)' }]);
  const BAR_ORIENTATIONS = Object.freeze([{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]);

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /**
   * The tools every ZPL shape shares (built once per slice factory because they need the helpers of js/languages/zpl.js). Parse: readDots, readColor,
   * readRounding, appearance, origin. Geometry: radiusFor, degreeOf. Emit: place, gb, flags, clampThickness. Edit: colorField, rounding, groups.
   */
  function shape(helpers) {
    const { int, exactDots, roundDots, setArgs, paramField, reverseField, fitCoord } = helpers;

    // ---- Parse ------------------------------------------------------------------------------------------------------------------

    /** The whole number of an argument within min..max (null when it is omitted, empty or not a number: the default applies); a bad one is reported. */
    function readDots(ctx, cmd, index, label, min, max) {
      const a = cmd.args[index];
      if (!a || a.raw === '') return null;
      const v = int(a);
      if (v === null) { ctx.report(diag.warning(`${cmd.id}: ${label} "${a.raw.slice(0, 20)}" no válido, se usa el valor por defecto`)); return null; }
      if (v < min || v > max) {
        const fixed = clamp(v, min, max);
        ctx.report(diag.warning(`${cmd.id}: ${label} ${v} fuera de rango (${min}..${max}), se usa ${fixed}`));
        return fixed;
      }
      return v;
    }

    /** The colour letter (B black, W white; any case): default B, an unknown letter is reported. */
    function readColor(ctx, cmd, index) {
      const a = cmd.args[index];
      const raw = a ? a.raw.toUpperCase() : '';
      if (raw === '' || raw === 'B' || raw === 'W') return raw === 'W' ? 'W' : 'B';
      ctx.report(diag.warning(`${cmd.id}: color "${a.raw.slice(0, 10)}" no válido (B o W), se usa B`));
      return 'B';
    }

    /** The rounding degree of ^GB (0..8, default 0). */
    const readRounding = (ctx, cmd, index) => readDots(ctx, cmd, index, 'grado de redondeo', 0, 8) ?? 0;

    /** Colour and reversal of a field: { color, white, reverse }. White wins over ^FR / ^LR (reported once). */
    function appearance(ctx, cmd, field, colorIndex) {
      const color = readColor(ctx, cmd, colorIndex);
      const white = color === 'W';
      if (field.reverse && white) ctx.once('zpl-fr-white', () => diag.info('^FR (o ^LR) con color blanco (W): se ignora la inversión y se dibuja en blanco (no verificado en impresora)'));
      return { color, white, reverse: field.reverse && !white };
    }

    /** Top-left corner of a shape of `h` dots, in 0.1 mm: ^FO as written, ^FT is the bottom-left corner. */
    function origin(ctx, field, h) {
      const o = ctx.origin(field);
      return { x: o.x, y: o.kind === 'FT' ? o.y - ctx.len(h) : o.y, kind: o.kind };
    }

    /** Fields every item of a ZPL shape shares: the source, the reference, native and the ^LR marker. */
    const base = (ctx, field, ref, native) => ({ ref, source: ctx.sourceOf(field), native: { ...native, ...(field.labelReverse && { labelReverse: true }) } });

    // ---- Geometry -----------------------------------------------------------------------------------------------------------------

    /** Corner radius in dots of the neutral centre line for a degree: the guide's (r / 8) * (shorter / 2) minus half the thickness (never below 0). */
    const radiusFor = (rounding, shorter, thickness) => Math.max(0, (rounding / 8) * (shorter / 2) - thickness / 2);

    /**
     * Rounding degree (0..8) of a neutral box for a centre-line radius in dots (the outer box has `shorter` dots on its shorter side, the stroke is
     * `thickness`). Without a radius the degree the item came from is kept when it is one a thick border swallowed (radiusFor 0 for it).
     */
    function degreeOf(item, radius, shorter, thickness) {
      const kept = item.native && item.native.kind === 'GB' && Number.isInteger(item.native.rounding) ? item.native.rounding : 0;
      if (!(radius > 0)) return kept > 0 && radiusFor(kept, shorter, thickness) === 0 ? kept : 0;
      return clamp(roundDots(((radius + thickness / 2) / (shorter / 2)) * 8), 0, 8);
    }

    // ---- Emit ---------------------------------------------------------------------------------------------------------------------

    /** Thickness in dots of an item (its stroke, 0.1 mm): { exact, dots } limited to 1..max with one warning when it was beyond it. */
    function thickness(ctx, mm10, min, max, key, message) {
      const raw = exactDots(ctx, Number.isFinite(mm10) ? mm10 : 0);
      const exact = clamp(raw, min, max);
      if (roundDots(raw) > max || (min > 1 && roundDots(raw) < min)) ctx.once(key, () => diag.warning(message));
      return { exact, dots: clamp(roundDots(exact), min, max) };
    }

    /** ^FOx,y, or ^FTx,y+h when the item came from an ^FT field (x, y = the top-left corner in dots; limited to 0..32000, reported once). */
    function place(ctx, item, x, y, h) {
      const [px, py] = [fitCoord(ctx, x), fitCoord(ctx, y)];
      return item.native && item.native.origin === 'FT' ? `^FT${px},${fitCoord(ctx, py + h)}` : `^FO${px},${py}`;
    }

    /** ^GBw,h,t[,c[,r]]: the colour letter only when it is not the default or the rounding follows. */
    function gb(w, h, t, { white = false, rounding = 0 } = {}) {
      const args = [w, h, t];
      if (white || rounding > 0) args.push(white ? 'W' : 'B');
      if (rounding > 0) args.push(rounding);
      return `^GB${args.join(',')}`;
    }

    /** ^FR for a reversed item (white wins: a white shape has nothing to reverse). */
    const fr = item => (item.reverse === true && item.white !== true ? '^FR' : '');

    // ---- Edit ---------------------------------------------------------------------------------------------------------------------

    /** The colour of a shape: an argument whose omission stands for B. */
    const colorField = (cmd, arg) => paramField({
      key: 'color', label: 'Color', type: 'select', cmd, arg, options: COLOR_OPTIONS, model: item => (item.white === true ? 'W' : 'B'),
      read: raw => (raw === '' ? 'B' : /^[BW]$/i.test(raw) ? raw.toUpperCase() : undefined),
      write: v => (v === 'B' || v === 'W' ? v : null),
    });

    /** The ^FR checkbox of a shape (see reverseField in js/languages/zpl-edit.js). */
    const reverse = () => reverseField('reverse', 'Impresión inversa (^FR)');

    /** The rounding degree select of ^GB: each option is labelled with the shape it gives. */
    const ROUNDING_OPTIONS = Object.freeze(Array.from({ length: 9 }, (_, n) => ({
      value: n,
      label: n === 0 ? '0 · Sin redondeo (esquinas rectas)' : n === 8 ? '8 · Máximo (extremos semicirculares)' : `${n} · Esquinas redondeadas (${n}/8 del radio máximo)`,
    })));
    const roundingField = cmd => paramField({
      key: 'rounding', label: 'Redondeo de esquinas', type: 'select', cmd, arg: 4, options: ROUNDING_OPTIONS, model: item => (item.native && item.native.rounding) || 0,
      read: raw => (raw === '' ? 0 : /^[0-8]$/.test(raw) ? Number(raw) : undefined),
      write: v => (Number.isInteger(v) && v >= 0 && v <= 8 ? String(v) : null),
    });

    /**
     * The values of a ^GB command as the parser reads them (no reports): thickness t, and w, h with the defaults and the minimum t applied.
     * The editing of the bars and areas works on these.
     */
    function boxValues(cmd) {
      const num = i => { const a = cmd.args[i]; return a && /^\d+$/.test(a.raw) ? Number(a.raw) : null; };
      const t = clamp(num(2) === null ? 1 : num(2), 1, MAX_BOX);
      return { t, w: Math.max(num(0) === null ? t : num(0), t), h: Math.max(num(1) === null ? t : num(1), t) };
    }

    /**
     * Fields that edit several arguments of a ^GB together (a bar's length / thickness / orientation, an area's width / height, which also
     * keep the thickness so the box stays solid): each is a custom field; the first of `keys` present in the update writes for all of them.
     * value(cur) reads from boxValues; write(cur, changes) -> { index: text } to set (setArgs), only the arguments that change.
     */
    function group({ keys, key, label, type, min, max, options, model, value, write }) {
      return {
        key, label, type, custom: true, model, ...(min !== undefined && { min, max, step: 1 }), ...(options && { options }),
        read: (text, found) => { const cmd = found.field.find('GB'); return cmd ? value(boxValues(cmd)) : undefined; },
        edits(text, found, item, v, opts) {
          const changes = (opts && opts.changes) || { [key]: v };
          const cmd = found.field.find('GB');
          if (!cmd || keys.find(k => Object.hasOwn(changes, k)) !== key) return null;
          const set = write(boxValues(cmd), changes);
          return set && Object.keys(set).length ? setArgs(cmd, set) : null;
        },
      };
    }

    const longer = cur => Math.max(cur.w, cur.h);
    const shorter = cur => Math.min(cur.w, cur.h);

    /** Which args of ^GB change for a new (w, h, t): only the ones that differ from what the command says now (the thickness stays while the shorter side does). */
    function boxEdits(cur, next) {
      const set = {};
      if (next.w !== cur.w) set[0] = String(next.w);
      if (next.h !== cur.h) set[1] = String(next.h);
      if (Math.min(next.w, next.h) !== shorter(cur)) set[2] = String(next.t);
      return set;
    }

    const whole = (v, fallback, min, max) => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), min, max) : fallback);

    const TOO_LONG = `Hay líneas o cajas de más de ${MAX_BOX} puntos de largo: ZPL (^GB / ^GD) admite hasta ${MAX_BOX}, se ajustan al máximo`;

    return {
      MAX_BOX, TOO_LONG, MAX_ROUND, MIN_DIAGONAL, MIN_ROUND_SIZE, MIN_ROUND_THICKNESS, COLOR_OPTIONS, ORIENTATION_OPTIONS, ROUNDING_OPTIONS,
      readDots, readColor, readRounding, appearance, origin, base, radiusFor, degreeOf, thickness, place, gb, fr,
      colorField, reverse, roundingField, boxValues, group, whole, clamp, longer, shorter, boxEdits,
    };
  }

  function zpl(helpers) {
    const { numberField, paramField, insertCommand, dropDots, lengthDots, exactDots, roundDots } = helpers;
    const S = shape(helpers);
    const { MAX_BOX, MIN_DIAGONAL, clamp: bound } = S;

    // -------------------------------------------------------------------------------------------------------------
    // Palette

    /** Adds ^FOx,y^GBlength,3,3^FS: a horizontal bar of TEMPLATE_LENGTH (0.1 mm) and TEMPLATE_THICKNESS dots at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      return insertCommand(text, `^FO${x},${y}^GB${lengthDots(options, TEMPLATE_LENGTH)},${TEMPLATE_THICKNESS},${TEMPLATE_THICKNESS}^FS`);
    }

    // -------------------------------------------------------------------------------------------------------------
    // Parse: ^GD

    /** ^GDw,h,t,c,o: the diagonal line across its w x h box. */
    function diagonalItem(ctx, field, cmd) {
      const t = S.readDots(ctx, cmd, 2, 'grosor', 1, MAX_BOX) ?? 1;
      const w = S.readDots(ctx, cmd, 0, 'ancho', MIN_DIAGONAL, MAX_BOX) ?? t;
      const h = S.readDots(ctx, cmd, 1, 'alto', MIN_DIAGONAL, MAX_BOX) ?? t;
      const look = S.appearance(ctx, cmd, field, 3);
      const rawOrientation = cmd.args[4] ? cmd.args[4].raw : '';
      let orientation = 'R';
      if (/^[Ll\\]$/.test(rawOrientation)) orientation = 'L';
      else if (rawOrientation !== '' && !/^[Rr/]$/.test(rawOrientation)) ctx.report(diag.warning(`^GD: orientación "${rawOrientation.slice(0, 10)}" no válida (R o L), se usa R`));
      const o = S.origin(ctx, field, h);
      const right = o.x + ctx.len(w);
      const bottom = o.y + ctx.len(h);
      return {
        kind: 'line', rect: false, width: ctx.len(t),
        ...(orientation === 'R' ? { x1: o.x, y1: bottom, x2: right, y2: o.y } : { x1: o.x, y1: o.y, x2: right, y2: bottom }),
        ...(look.white && { white: true }), ...(look.reverse && { reverse: true }),
        ...S.base(ctx, field, 'GD', { kind: 'GD', w, h, thickness: t, color: look.color, orientation, origin: o.kind }),
      };
    }

    // -------------------------------------------------------------------------------------------------------------
    // Emit

    /** A bar (^GB) or a diagonal (^GD) of a line item. */
    function emit(item, ctx) {
      const [x1, y1, x2, y2] = [item.x1, item.y1, item.x2, item.y2].map(v => exactDots(ctx, v || 0));
      const t = S.thickness(ctx, item.width, 1, MAX_BOX, 'zpl-gb-thickness', `Hay grosores de línea de más de ${MAX_BOX} puntos: ZPL (^GB / ^GD) admite de 1 a ${MAX_BOX}, se ajustan al máximo`);
      const white = item.white === true;
      const [dx, dy] = [x2 - x1, y2 - y1];
      const horizontal = Math.abs(dy) <= 1;
      if (horizontal || Math.abs(dx) <= 1) {
        // A bar: ^GBlength,t,t centred on the line. One shorter than its thickness is a solid box of length x thickness: the border is then
        // the shorter side (^GB raises w and h to the border, so t would make the bar longer)
        const span = roundDots(Math.abs(horizontal ? dx : dy));
        if (span < 1) {
          ctx.once('zpl-line-empty', () => diag.warning('Hay líneas de longitud 0 que no se escriben: no dibujan nada'));
          return [];
        }
        const border = Math.min(span, t.dots);
        if (span > MAX_BOX) ctx.once('zpl-shape-size', () => diag.warning(S.TOO_LONG));
        const length = bound(Math.max(span, border), border, MAX_BOX);
        const [w, h] = horizontal ? [length, t.dots] : [t.dots, length];
        const left = horizontal ? Math.min(x1, x2) : (x1 + x2) / 2 - t.exact / 2;
        const top = horizontal ? (y1 + y2) / 2 - t.exact / 2 : Math.min(y1, y2);
        return `${S.place(ctx, item, roundDots(left), roundDots(top), h)}${S.gb(w, h, border, { white })}${S.fr(item)}^FS`;
      }
      const sizes = [Math.abs(dx), Math.abs(dy)].map(v => roundDots(v));
      if (sizes.some(v => v < MIN_DIAGONAL)) ctx.once('zpl-gd-min', () => diag.warning(`Hay líneas diagonales de menos de ${MIN_DIAGONAL} puntos de ancho o alto: ZPL (^GD) admite de ${MIN_DIAGONAL} a ${MAX_BOX}, se ajustan`));
      if (sizes.some(v => v > MAX_BOX)) ctx.once('zpl-shape-size', () => diag.warning(S.TOO_LONG));
      const [w, h] = sizes.map(v => bound(v, MIN_DIAGONAL, MAX_BOX));
      const leaning = dx * dy < 0 ? 'R' : 'L';
      const args = [w, h, t.dots];
      if (white || leaning === 'L') args.push(white ? 'W' : 'B');
      if (leaning === 'L') args.push('L');
      return `${S.place(ctx, item, roundDots(Math.min(x1, x2)), roundDots(Math.min(y1, y2)), h)}^GD${args.join(',')}${S.fr(item)}^FS`;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Edit

    const native = key => item => (item.native && item.native[key] != null ? item.native[key] : undefined);
    const { longer, shorter, boxEdits } = S;

    /** A bar edits as length (the longer side), thickness (the shorter one, also the ^GB thickness) and orientation. */
    const BAR_KEYS = ['length', 'thickness', 'orientation'];
    function barWrite(cur, changes) {
      const horizontal = changes.orientation === 'horizontal' ? true : changes.orientation === 'vertical' ? false : cur.w >= cur.h;
      const t = S.whole(changes.thickness, shorter(cur), 1, MAX_BOX);
      const length = Math.max(S.whole(changes.length, longer(cur), 1, MAX_BOX), t);
      const next = horizontal ? { w: length, h: t, t } : { w: t, h: length, t };
      return boxEdits(cur, next);
    }
    const barFields = [
      S.group({ keys: BAR_KEYS, key: 'length', label: 'Largo (puntos)', type: 'number', min: 1, max: MAX_BOX, model: item => (item.native ? Math.max(item.native.w, item.native.h) : undefined), value: longer, write: barWrite }),
      S.group({ keys: BAR_KEYS, key: 'thickness', label: 'Grosor (puntos)', type: 'number', min: 1, max: MAX_BOX, model: item => (item.native ? Math.min(item.native.w, item.native.h) : undefined), value: shorter, write: barWrite }),
      S.group({
        keys: BAR_KEYS, key: 'orientation', label: 'Orientación', type: 'select', options: BAR_ORIENTATIONS, write: barWrite,
        model: item => (item.native ? (item.native.w >= item.native.h ? 'horizontal' : 'vertical') : undefined), value: cur => (cur.w >= cur.h ? 'horizontal' : 'vertical'),
      }),
    ];

    const orientationField = paramField({
      key: 'orientation', label: 'Orientación', type: 'select', cmd: 'GD', arg: 4, options: S.ORIENTATION_OPTIONS, model: native('orientation'),
      read: raw => (raw === '' || /^[Rr/]$/.test(raw) ? 'R' : /^[Ll\\]$/.test(raw) ? 'L' : undefined),
      write: v => (v === 'R' || v === 'L' ? v : null),
    });
    const diagonalFields = [
      numberField('width', 'Ancho de la caja (puntos)', 'GD', 0, MIN_DIAGONAL, MAX_BOX, native('w')),
      numberField('height', 'Alto de la caja (puntos)', 'GD', 1, MIN_DIAGONAL, MAX_BOX, native('h')),
      numberField('thickness', 'Grosor (puntos)', 'GD', 2, 1, MAX_BOX, native('thickness')),
      orientationField,
      S.colorField('GD', 3),
      S.reverse(),
    ];

    return {
      // emit(item, ctx) -> the bar or the diagonal of a line item
      emit,
      // build(text, point, options) -> text with a new bar (palette)
      build,
      // Move: the field origin (^FO / ^FT), which is what the default coordinates are (the box slice shares the model kind)
      coordinates: [{ applies: item => item.kind === 'line' }],
      editable: [
        { applies: (item, field) => item.kind === 'line' && !item.rect && (field ? field.has('GB') : item.ref === 'GB'), fields: barFields },
        { applies: (item, field) => item.kind === 'line' && !item.rect && (field ? field.has('GD') : item.ref === 'GD'), fields: diagonalFields },
      ],
      handlers: [{
        // ^GDw,h,t,c,o: a diagonal line
        pattern: /^\^GD$/,
        handle(m, cmd, ctx, field) { ctx.addItem(diagonalItem(ctx, field, cmd)); },
      }],
    };
  }

  PB.slices.line.zpl = zpl;
  PB.slices.line.zplShape = shape;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
