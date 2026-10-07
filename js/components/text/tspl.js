/**
 * Text slice, TSPL language (TSC TTP): the TEXT and BLOCK commands.
 *   TEXT x,y,"font",rotation,x-mul,y-mul,[alignment,]"content"
 *   BLOCK x,y,width,height,"font",rotation,x-mul,y-mul,[space,][align,][fit,]"content"
 * Both become the neutral `text` item (see js/core/model.js) so the SVG renderer of this slice needs no change:
 *   - bitmap fonts "1".."8" have a fixed dot cell (width x height, TSPL manual): font.size = cell height * y-mul dots, in
 *     0.1 mm, and font.scaleX stretches the simulated mono glyphs so the character advance matches the cell width;
 *   - font "0", ROMAN.TTF and every other (unknown) font are scalable: the multipliers are POINT sizes (y-mul = height).
 * The factory receives the helpers of js/languages/tspl.js (SLICE_HELPERS), which loads after this file:
 *   factory(helpers) -> { handlers }. Registered by js/components/text/index.js as `languages: { tpcl, tspl }`.
 * Limits (reported as info diagnostics): the model has no alignment nor word wrap, so alignment 2/3 draws left and BLOCK
 * is drawn as one line of text; counters/variables ("@1", "x"+@1) are kept as literal text.
 * Emit (the inverse): `emit(item, ctx)` writes a TEXT command. A mono font whose size and width are whole multiples of a
 * built-in bitmap font becomes that font "1".."8"; anything else becomes the scalable font "0" with POINT sizes (the
 * exact inverse of fontOf), with one info that the TSPL fonts differ from the source font when family, weight or style
 * cannot be represented.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.text = PB.slices.text || {};

  const { units, diagnostics: diag } = PB;

  /** Approximate advance of a mono glyph in em (what the CSS mono family draws), used to fit the TSPL cell width. */
  const MONO_ADVANCE = 0.6;

  /** TSPL built-in bitmap fonts: [cell width, cell height] in dots and the simulated family. */
  const BITMAP_FONTS = Object.freeze({
    1: [8, 12, 'mono'], 2: [12, 20, 'mono'], 3: [16, 24, 'mono'], 4: [24, 32, 'mono'], 5: [32, 48, 'mono'],
    6: [14, 19, 'mono'], 7: [21, 27, 'mono'], 8: [14, 25, 'mono'],
  });

  /** Scalable fonts drawn with the sans family without any warning. */
  const SCALABLE_FONTS = Object.freeze(['0', 'ROMAN.TTF']);

  /** Counter/variable content: "@1", "x"+@1+"y". */
  const COUNTER = /(?:^|\+)\s*@\d+/;

  /** Line-break escapes of BLOCK content (\[R], \[L]); the model draws one line, so they become a space. */
  const BLOCK_BREAK = /\\\[[RL]\]/g;

  /** How far (in multiplier units) a model font may be from an exact bitmap font + integer multipliers, and the TSPL maximum. */
  const MULTIPLIER_TOLERANCE = 0.05;
  const MAX_MULTIPLIER = 10;

  /** Fallback size (0.1 mm) for a text whose font has no usable size. */
  const DEFAULT_SIZE = 80;

  /**
   * Bitmap font that draws a mono model font: the entry of BITMAP_FONTS whose cell height times an integer y-mul (1..10)
   * reproduces the size and whose cell width times an integer x-mul (1..10) reproduces the width, both within
   * MULTIPLIER_TOLERANCE. Best fit first (smallest total deviation), then the lowest multiplier (the real cell of the
   * font is kept, e.g. font 3 x1 rather than font 1 x2), then the lowest font number. Null if none fits.
   */
  function bitmapChoice(font, dot) {
    if (font.family !== 'mono') return null;
    const heightDots = font.size / dot;
    let best = null;
    for (const [name, [cellW, cellH]] of Object.entries(BITMAP_FONTS)) {
      const y = heightDots / cellH;
      const x = (font.scaleX * heightDots * MONO_ADVANCE) / cellW;
      const [yi, xi] = [Math.round(y), Math.round(x)];
      if (yi < 1 || yi > MAX_MULTIPLIER || xi < 1 || xi > MAX_MULTIPLIER) continue;
      if (Math.abs(y - yi) > MULTIPLIER_TOLERANCE || Math.abs(x - xi) > MULTIPLIER_TOLERANCE) continue;
      const score = Math.round((Math.abs(y - yi) + Math.abs(x - xi)) * 1000);
      if (!best || score < best.score || (score === best.score && yi < best.ymul)) best = { name, xmul: xi, ymul: yi, score };
    }
    return best;
  }

  function tspl(helpers) {
    const { sourceOf, num, ROTATIONS, quoted, exactDots, roundDots, safeData } = helpers;

    /** Rotation in degrees: the nearest quarter turn, with a warning once if the item was not on one. */
    function rotationDegrees(ctx, rotation) {
      const turns = Number.isFinite(rotation) ? Math.round(rotation / 90) : 0;
      const degrees = (((turns * 90) % 360) + 360) % 360;
      if (degrees !== rotation && !(rotation == null && degrees === 0)) {
        ctx.once('tspl-rotation', () => diag.warning('Hay textos con una rotación que no es múltiplo de 90°: se ajustan al giro más cercano'));
      }
      return degrees;
    }

    /**
     * TEXT x,y,"font",rotation,x-mul,y-mul,"content". Built-in font "1".."8" when the model font is one of them (see
     * bitmapChoice); else font "0" with POINT sizes: y-mul = size in points, x-mul = y-mul * scaleX (minimum 1 both).
     */
    function emit(item, ctx) {
      const font = item.font || {};
      const size = Number.isFinite(font.size) && font.size > 0 ? font.size : DEFAULT_SIZE;
      const scaleX = Number.isFinite(font.scaleX) && font.scaleX > 0 ? font.scaleX : 1;
      const weight = font.weight == null ? 400 : font.weight;
      const regular = weight === 400 && (font.style || 'normal') === 'normal';
      const choice = bitmapChoice({ ...font, size, scaleX }, units.dotSize(ctx.dpi));
      let name = '0';
      let [xmul, ymul] = [0, 0];
      if (choice) {
        ({ name, xmul, ymul } = choice);
      } else {
        ymul = Math.max(1, Math.round(size / units.UNITS_PER_POINT));
        xmul = Math.max(1, Math.round(ymul * scaleX));
      }
      const exact = regular && (choice ? true : (font.family || 'sans') === 'sans');
      if (!exact) {
        ctx.once('tspl-fonts', () => diag.info('Las fuentes TSPL no coinciden con las de origen (familia, peso o cursiva): se usan las incorporadas más cercanas'));
      }
      // The scalable font only has whole point sizes: say so when the size or the width had to move
      if (!choice && (Math.abs(size / units.UNITS_PER_POINT - ymul) > MULTIPLIER_TOLERANCE || Math.abs(ymul * scaleX - xmul) > MULTIPLIER_TOLERANCE)) {
        ctx.once('tspl-size-rounding', () => diag.info('Hay textos cuyo tamaño se redondea a puntos enteros en la fuente escalable de TSPL: el tamaño impreso puede diferir ligeramente'));
      }
      const [x, y] = [roundDots(exactDots(ctx, item.x || 0)), roundDots(exactDots(ctx, item.y || 0))];
      return `TEXT ${x},${y},"${name}",${rotationDegrees(ctx, item.rotation)},${xmul},${ymul},${quoted(safeData(ctx, item.data))}`;
    }

    /** Multiplier or point size: a positive number, 1 (with a warning) otherwise. */
    function multiplier(ctx, ref, arg, label) {
      const v = num(arg);
      if (v !== null && v > 0) return v;
      ctx.report(diag.warning(`${ref}: ${label} "${arg ? arg.value : ''}" no válido, se usa 1`));
      return 1;
    }

    function rotationOf(ctx, ref, arg) {
      const v = num(arg);
      if (v !== null && ROTATIONS.includes(v)) return v;
      ctx.report(diag.warning(`${ref}: rotación "${arg ? arg.value : ''}" no válida, se dibuja sin rotar`));
      return 0;
    }

    /** Font name + multipliers -> neutral font { size, scaleX, family, weight, style } (size in 0.1 mm). */
    function fontOf(ctx, ref, name, xmul, ymul) {
      const key = name.toUpperCase();
      const bitmap = BITMAP_FONTS[key];
      if (bitmap) {
        const [cellW, cellH, family] = bitmap;
        return {
          size: cellH * ymul * ctx.dot,
          scaleX: (cellW * xmul) / (cellH * ymul * MONO_ADVANCE),
          family, weight: 400, style: 'normal',
        };
      }
      if (!SCALABLE_FONTS.includes(key)) {
        ctx.tsplFontsNoted = ctx.tsplFontsNoted || new Set();
        if (!ctx.tsplFontsNoted.has(key)) {
          ctx.tsplFontsNoted.add(key);
          ctx.report(diag.info(`${ref}: fuente "${name}" no disponible en el visor, se dibuja con una fuente sans`));
        }
      }
      return { size: ymul * units.UNITS_PER_POINT, scaleX: xmul / ymul, family: 'sans', weight: 400, style: 'normal' };
    }

    /** Content argument -> text. Counters are kept as written (no evaluation), noted once per label. */
    function contentOf(ctx, ref, arg) {
      if (COUNTER.test(arg.raw)) {
        if (!ctx.tsplCounterNoted) {
          ctx.tsplCounterNoted = true;
          ctx.report(diag.info(`${ref}: contador o variable (@n) sin evaluar, se dibuja como texto literal`));
        }
        return arg.raw;
      }
      return arg.value;
    }

    function noteAlignment(ctx, ref, align) {
      if (align === 2 || align === 3) ctx.report(diag.info(`${ref}: alineación no soportada, se dibuja a la izquierda`));
    }

    /** Builds the text item shared by TEXT and BLOCK; `fontArgs` = [font, rotation, xmul, ymul] argument objects. */
    function textItem(ctx, ref, cmd, point, fontArgs, data) {
      const [fontArg, rotArg, xArg, yArg] = fontArgs;
      const xmul = multiplier(ctx, ref, xArg, 'multiplicador X');
      const ymul = multiplier(ctx, ref, yArg, 'multiplicador Y');
      const { x, y } = ctx.pos(point.x, point.y);
      return {
        kind: 'text', ref, source: sourceOf(cmd), x, y, raw: { x: String(point.x), y: String(point.y) },
        font: fontOf(ctx, ref, fontArg.value, xmul, ymul),
        rotation: rotationOf(ctx, ref, rotArg),
        data,
        native: { font: fontArg.value, xmul, ymul },
      };
    }

    const point = (cmd, i) => ({ x: num(cmd.args[i]), y: num(cmd.args[i + 1]) });
    const validPoint = p => p.x !== null && p.y !== null;

    return {
      // emit(item, ctx) -> the TEXT command of a text item
      emit,
      handlers: [
        {
          // TEXT x,y,"font",rotation,x-mul,y-mul,[alignment,]"content": 8 arguments when the alignment is present
          pattern: /^TEXT\b/i,
          handle(m, cmd, ctx) {
            if (cmd.args.length < 7) { ctx.report(diag.warning(`TEXT incompleto: ${cmd.raw.slice(0, 40)}`)); return; }
            const p = point(cmd, 0);
            if (!validPoint(p)) { ctx.report(diag.warning(`TEXT con coordenadas no válidas: ${cmd.raw.slice(0, 40)}`)); return; }
            const hasAlign = cmd.args.length >= 8;
            if (hasAlign) noteAlignment(ctx, 'TEXT', num(cmd.args[6]));
            const content = cmd.args[hasAlign ? 7 : 6];
            const item = textItem(ctx, 'TEXT', cmd, p, cmd.args.slice(2, 6), contentOf(ctx, 'TEXT', content));
            if (hasAlign) item.native.align = num(cmd.args[6]);
            ctx.addItem(item);
          },
        },
        {
          // BLOCK x,y,w,h,"font",rotation,x-mul,y-mul,[space,][align,][fit,]"content": optional fields by count
          pattern: /^BLOCK\b/i,
          handle(m, cmd, ctx) {
            if (cmd.args.length < 9) { ctx.report(diag.warning(`BLOCK incompleto: ${cmd.raw.slice(0, 40)}`)); return; }
            const p = point(cmd, 0);
            if (!validPoint(p)) { ctx.report(diag.warning(`BLOCK con coordenadas no válidas: ${cmd.raw.slice(0, 40)}`)); return; }
            const content = cmd.args[cmd.args.length - 1];
            const [space, align, fit] = cmd.args.slice(8, -1).map(num);
            noteAlignment(ctx, 'BLOCK', align);
            if (!ctx.tsplBlockNoted) {
              ctx.tsplBlockNoted = true;
              ctx.report(diag.info('BLOCK se dibuja como texto simple (sin ajuste de línea)'));
            }
            const data = contentOf(ctx, 'BLOCK', content).replace(BLOCK_BREAK, ' ');
            const item = textItem(ctx, 'BLOCK', cmd, p, cmd.args.slice(4, 8), data);
            item.native.width = num(cmd.args[2]);
            item.native.height = num(cmd.args[3]);
            if (space !== undefined) item.native.space = space;
            if (align !== undefined) item.native.align = align;
            if (fit !== undefined) item.native.fit = fit;
            ctx.addItem(item);
          },
        },
      ],
    };
  }

  PB.slices.text.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
