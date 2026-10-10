/**
 * Area slice, ZPL language (Zebra): the inverted and the cleared area, and the label reverse print ^LR.
 *   ^FOx,y ^GBw,h,t ^FR ^FS        a SOLID box (t >= half of the shorter side, the guide's own example is ^GB70,70,70) reversed: the inverted area
 *   ^FOx,y ^GBw,h,t,W ^FS          the same in white: the cleared area (white ink over what is already drawn)
 *   ^LRY ... ^LRN                  every field opened after ^LRY is reversed, as if it had its own ^FR (the guide: "identical to placing an ^FR
 *                                  command in all current and subsequent fields", "^GB needs to be used together with ^LR")
 * The 2003 guide (Volume One, local copy in docs/zpl) documents ^FR ("the colour of the output is the reverse of its background"), ^LR (Y / N, active
 * until ^LRN or power off, only the fields after it) and the example of ^GB boxes with a white ^FR text over them. It does NOT document the picture of
 * what ^FR does to a white ^GB (the viewer draws white: reported once) or the order the printer composes the fields (the viewer paints in command order).
 * The ^GB parser is the box slice's (js/components/box/zpl.js); this file holds what is specific to the areas:
 *   - the neutral `area` item { ref: 'GB', mode: 'reverse' | 'clear', x, y, width, height, native: { kind: 'GB', w, h, thickness, color, rounding, origin,
 *     labelReverse? } } (js/components/area/render.js draws the white rect with the `difference` blend, the hit rect and the zero-size ink box, so
 *     the area takes part in the outside-the-label check but never in the overlaps; it is painted in command order, so it only inverts what came
 *     before it). Rounded corners cannot be drawn on an area: the parser reports it once and draws it square.
 *   - ^LR: the immediate handler sets ctx.labelReverse (the parser marks every field opened while it is on: field.reverse is set for the handlers
 *     and native.labelReverse records that the ^FR is not in the field itself). The emitters never write ^LR: every reversed item gets its own ^FR.
 * Emit (the inverse): ^FOx,y^GBw,h,min(w,h)^FR^FS for `reverse`, ^FOx,y^GBw,h,min(w,h),W^FS for `clear` (the thickness covers the shorter side, as
 * the guide's example); ^FT when the item came from an ^FT field. Sizes are limited to 1..32000 (warning).
 * Edit: width, height (the thickness follows the shorter side so the box stays solid) and the mode (Invertir = ^FR, Borrar = colour W). Move: the origin.
 * Palette: ONE entry (Área invertida) 30 x 10 mm: `^GB300,100,100^FR`, written before ^XZ (so after the items already drawn).
 * factory(helpers) -> { handlers, emit, build, coordinates, editable }; registered by js/components/area/index.js as `languages: { tpcl, tspl, zpl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.area = PB.slices.area || {};

  const { diagnostics: diag } = PB;

  /** A freshly inserted area: 30 x 10 mm in 0.1 mm. */
  const TEMPLATE = Object.freeze([300, 100]);

  const MODE_OPTIONS = Object.freeze([{ value: 'reverse', label: 'Invertir' }, { value: 'clear', label: 'Borrar' }]);

  function zpl(helpers) {
    const { insertCommand, dropDots, lengthDots, exactDots, roundDots, setArgs, argEdit, flagEdits } = helpers;
    const S = PB.slices.line.zplShape(helpers);
    const { MAX_BOX } = S;

    // -------------------------------------------------------------------------------------------------------------
    // Palette

    /** Adds ^FOx,y^GBw,h,h^FR^FS: a reverse area of TEMPLATE (0.1 mm) at the drop point. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const [w, h] = TEMPLATE.map(size => lengthDots(options, size));
      return insertCommand(text, `^FO${x},${y}^GB${w},${h},${Math.min(w, h)}^FR^FS`);
    }

    // -------------------------------------------------------------------------------------------------------------
    // Emit

    /** ^FOx,y^GBw,h,min(w,h)[,W][^FR]^FS of an area item. */
    function emit(item, ctx) {
      const dots = v => exactDots(ctx, Number.isFinite(v) ? v : 0);
      const size = v => {
        const n = Math.max(1, roundDots(dots(v)));
        if (n > MAX_BOX) ctx.once('zpl-area-size', () => diag.warning(`Hay áreas de más de ${MAX_BOX} puntos: ZPL (^GB) admite hasta ${MAX_BOX}, se ajustan al máximo`));
        return Math.min(n, MAX_BOX);
      };
      const [w, h] = [size(item.width), size(item.height)];
      const clear = item.mode === 'clear';
      return `${S.place(ctx, item, roundDots(dots(item.x)), roundDots(dots(item.y)), h)}${S.gb(w, h, Math.min(w, h), { white: clear })}${clear ? '' : '^FR'}^FS`;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Edit

    const native = key => item => (item.native && item.native[key] != null ? item.native[key] : undefined);
    const SIZE_KEYS = ['width', 'height'];
    /** The new size: only the sides in the update change; the thickness follows the shorter side (see S.boxEdits). */
    function sizeWrite(cur, changes) {
      const [w, h] = [S.whole(changes.width, cur.w, 1, MAX_BOX), S.whole(changes.height, cur.h, 1, MAX_BOX)];
      return S.boxEdits(cur, { w, h, t: Math.min(w, h) });
    }

    /**
     * The mode: Invertir = black ink with ^FR (or ^LRY), Borrar = colour W. Switching to Borrar writes the W and drops the field's own ^FR;
     * switching to Invertir writes the B back (when the colour argument is there) and adds the ^FR (not needed under ^LRY).
     */
    const modeField = {
      key: 'mode', label: 'Tipo', type: 'select', options: MODE_OPTIONS, custom: true, model: item => item.mode,
      read(text, found) {
        const cmd = found.field.find('GB');
        const color = cmd && cmd.args[3] ? cmd.args[3].raw.toUpperCase() : '';
        return cmd ? (color === 'W' ? 'clear' : 'reverse') : undefined;
      },
      edits(text, found, item, value) {
        const cmd = found.field.find('GB');
        if (!cmd || (value !== 'reverse' && value !== 'clear') || this.read(text, found) === value) return null;
        const edits = [];
        if (value === 'clear') {
          edits.push(...setArgs(cmd, { 3: 'W' }));
          flagEdits(text, found.field, { cmd: 'FR' }, false, edits);
        } else {
          if (cmd.args[3]) edits.push(argEdit(cmd, 3, 'B'));
          if (!(item.native && item.native.labelReverse)) flagEdits(text, found.field, { cmd: 'FR' }, true, edits);
        }
        return edits;
      },
    };

    return {
      // emit(item, ctx) -> the ^GB field of an area item
      emit,
      // build(text, point, options) -> text with a new inverted area (palette)
      build,
      // Move: the field origin (^FO / ^FT), which is what the default coordinates are
      coordinates: [{ applies: item => item.kind === 'area' }],
      editable: [{
        applies: (item, field) => item.kind === 'area' && (field ? field.has('GB') : item.ref === 'GB'),
        fields: [
          S.group({ keys: SIZE_KEYS, key: 'width', label: 'Ancho (puntos)', type: 'number', min: 1, max: MAX_BOX, model: native('w'), value: cur => cur.w, write: sizeWrite }),
          S.group({ keys: SIZE_KEYS, key: 'height', label: 'Alto (puntos)', type: 'number', min: 1, max: MAX_BOX, model: native('h'), value: cur => cur.h, write: sizeWrite }),
          modeField,
        ],
      }],
      handlers: [{
        // ^LRa: Y reverses every later field until ^LRN (an invalid value is reported and the state stays)
        pattern: /^\^LR$/,
        immediate: true,
        handle(m, cmd, ctx) {
          const a = cmd.args[0] ? cmd.args[0].raw.toUpperCase() : '';
          if (a === 'Y' || a === 'N') ctx.labelReverse = a === 'Y';
          else ctx.report(diag.warning(`^LR no válido: ${cmd.raw.slice(0, 40)}`));
        },
      }],
    };
  }

  PB.slices.area.zpl = zpl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
