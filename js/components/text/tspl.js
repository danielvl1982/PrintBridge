/**
 * Text slice, TSPL language (TSC TTP): the TEXT and BLOCK commands.
 *   TEXT x,y,"font",rotation,x-mul,y-mul,[alignment,]"content"
 *   BLOCK x,y,width,height,"font",rotation,x-mul,y-mul,[space,][align,][fit,]"content"
 * Both become the neutral `text` item (see js/core/model.js); BLOCK adds item.block (width, lines, align, lineSpace), which the renderer of this
 * slice wraps (the TSC TSPL2 manual documents BLOCK; the local B-442/443 one does not: the syntax is the one this file reads and is NOT
 * VERIFIED ON A PRINTER). The align argument is 0 / 1 left, 2 center, 3 right (no justification); the optional arguments are positional
 * (space, align, fit); the height of the block holds floor(height / (character height + space)) lines, which is the block's `lines`.
 *   - bitmap fonts "1".."8" have a fixed dot cell (width x height, TSPL manual): font.size = cell height * y-mul dots, in
 *     0.1 mm, and font.scaleX stretches the simulated mono glyphs so the character advance matches the cell width;
 *   - font "0", ROMAN.TTF and every other (unknown) font are scalable: the multipliers are POINT sizes (y-mul = height).
 * The factory receives the helpers of js/languages/tspl.js (SLICE_HELPERS), which loads after this file:
 *   factory(helpers) -> { handlers, emit, build, coordinates, editable }. Registered by js/components/text/index.js as `languages: { tpcl, tspl }`.
 * Limits (reported as info diagnostics): the TEXT alignment 2/3 draws left (the model has no alignment for a line of text); a counter "@n" content shows the start value assigned with @n="..." (SET COUNTER gives the step, the
 * printer increments it per label); an unassigned counter, a mix ("x"+@1) and a BLOCK content keep the literal text.
 * Origin: TEXT x,y is the top-left corner of the character cell (TSC manual) while the model draws from the baseline, so the reader adds the
 * ascent (ASCENT / SCALABLE_ASCENT of the height, whole dots, on the side the letters stand to) and emit takes it off.
 * Emit (the inverse): `emit(item, ctx)` writes a TEXT command, or BLOCK for an item with a block (height = lines * pitch, see emitBlock). A mono font whose size and width are whole multiples of a
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

  /** Font ids the properties panel offers: the bitmap fonts of BITMAP_FONTS, then the scalable ones of SCALABLE_FONTS. */
  const FONT_OPTIONS = Object.freeze([
    ...Object.entries(BITMAP_FONTS).map(([id, [w, h]]) => ({ value: id, label: `${id} · ${w}×${h} puntos (monoespaciada)` })),
    ...SCALABLE_FONTS.map(id => ({ value: id, label: `${id} · Escalable (sans)` })),
  ]);

  /** Counter/variable content: "@1", "x"+@1+"y". */
  const COUNTER = /(?:^|\+)\s*@\d+/;

  /** Line-break escapes of BLOCK content: \[R] (CR) and \[L] (LF), one break each, \[R]\[L] (CR LF) together one. The model keeps "\n". */
  const BLOCK_BREAK = /\\\[R\]\\\[L\]|\\\[[RL]\]/g;
  /** What the BLOCK align argument says (TSC manual: 0 default = left, 1 left, 2 center, 3 right) as the neutral block alignment. */
  const BLOCK_ALIGN = Object.freeze({ 0: 'left', 1: 'left', 2: 'center', 3: 'right' });

  /** How far (in multiplier units) a model font may be from an exact bitmap font + integer multipliers, and the TSPL maximum. */
  const MULTIPLIER_TOLERANCE = 0.05;
  const MAX_MULTIPLIER = 10;
  /** Largest point size of a scalable font offered in the properties panel. */
  const MAX_POINTS = 200;

  /**
   * Share of the character height above the baseline (ascent). The scalable font takes 3/4, the share of the ZPL font 0 (ZPL II Volume Two,
   * Table 10) so that a ZPL <-> TSPL conversion of a scalable text keeps its top edge; the bitmap fonts keep 0.8 (no manual gives it).
   * Neither is verified on a TSC printer.
   */
  const ASCENT = 0.8;
  const SCALABLE_ASCENT = 0.75;

  /**
   * Offset (0.1 mm) from the TEXT reference point (the top-left corner of the character cell, TSC manual) to the baseline origin the
   * neutral model draws from, for a rotation in degrees: the ascent lies on the side the letters stand to.
   */
  function baselineShift(rotation, size, dot, scalable) {
    const a = Math.round(Math.round(size / dot) * (scalable ? SCALABLE_ASCENT : ASCENT)) * dot; // height in whole dots first, as ZPL does // whole dots, so a read / write round trip does not drift
    if (rotation === 90) return { x: -a, y: 0 };
    if (rotation === 180) return { x: 0, y: -a };
    if (rotation === 270) return { x: a, y: 0 };
    return { x: 0, y: a };
  }

  /** Bitmap font of a freshly inserted TEXT (16 x 24 dots cell). */
  const TEMPLATE_FONT = '3';

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
    const {
      sourceOf, num, ROTATIONS, quoted, exactDots, roundDots, safeData, numberField, selectField, stringSelectField, textField,
      insertCommand, freePlaceholder, itemRotation, dropDots, counterSetup,
    } = helpers;

    /**
     * Adds TEXT x,y,"3",rotation,1,1,"<#TEXTO{k}#>" (font "3", multipliers 1) at the drop point, rotated
     * (360 - options.viewRotation) % 360 to look upright in the view. The placeholder is a free TPCL-style variable.
     */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      return insertCommand(text, `TEXT ${x},${y},"${TEMPLATE_FONT}",${itemRotation(options)},1,1,${quoted(freePlaceholder(text, 'TEXTO'))}`);
    }

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
      if (item.attribute && item.attribute.kind !== 'black') {
        ctx.once('tspl-text-attribute', () => diag.warning('Hay textos con atributo (invertido, con marco o tachado), que TSPL no tiene: se escriben sin él'));
      }
      if (item.align && item.align.kind !== 'left' && item.align.kind) {
        ctx.once('tspl-text-align', () => diag.info('Hay textos con alineación (centro, derecha o espaciado igual), que TEXT de TSPL no escribe: se escriben a la izquierda'));
      }
      if (item.spacing) ctx.once('tspl-text-spacing', () => diag.info('Hay textos con espaciado entre caracteres, que TEXT de TSPL no escribe: se escriben sin él'));
      if (item.reverse) ctx.once('tspl-text-reverse', () => diag.warning('Hay textos con impresión inversa (^FR de ZPL): TSPL no la tiene en el texto, se escriben normales'));
      if (item.bold) ctx.once('tspl-text-bold', () => diag.info('Hay textos en negrita (sobreimpresión), que TEXT de TSPL no escribe: se escriben sin ella'));
      const degrees = rotationDegrees(ctx, item.rotation);
      // The model keeps the baseline origin; TEXT writes the top-left corner of the character cell
      const shift = baselineShift(degrees, size, units.dotSize(ctx.dpi), !choice);
      const [x, y] = [roundDots(exactDots(ctx, (item.x || 0) - shift.x)), roundDots(exactDots(ctx, (item.y || 0) - shift.y))];
      if (item.block) return emitBlock(item, ctx, { x, y, name, xmul, ymul, degrees, choice });
      const data = safeData(ctx, item.data);
      // A counter writes SET COUNTER and the start value before the command, which then prints "@n"
      const counter = counterSetup(ctx, item, data);
      const line = `TEXT ${x},${y},"${name}",${degrees},${xmul},${ymul},${counter ? counter.ref : quoted(data)}`;
      return counter ? [...counter.lines, line] : line;
    }

    /**
     * BLOCK x,y,width,height,"font",rotation,x-mul,y-mul,[space,][align,][fit,]"content" for an item with a block. The font, the origin and
     * the multipliers are the ones of TEXT (the caller worked them out). width = the block width in dots; height = lines * pitch, where the
     * pitch is the character height of the WRITTEN font plus the space (the inverse of the reader: floor(height / pitch) = lines), and lines is
     * the block's, or what the wrapped text needs (at least 1) when it has none; space = the extra line space in dots, align 0 (left; 1 when the
     * source said 1), 2 center, 3 right (TSPL has no justification: written left, one info) and fit as it was read. Optional arguments are
     * positional, so one is only written when it or a later one is needed. The line breaks of the data are \[R]. A counter is not written
     * (BLOCK content is literal): its start value is, with one info.
     */
    function emitBlock(item, ctx, { x, y, name, xmul, ymul, degrees, choice }) {
      const b = item.block;
      const dot = units.dotSize(ctx.dpi);
      const writtenSize = choice ? BITMAP_FONTS[name][1] * ymul * dot : ymul * units.UNITS_PER_POINT;
      const space = roundDots(exactDots(ctx, b.lineSpace || 0));
      const pitch = Math.max(1, Math.round(writtenSize / dot)) + space;
      const lines = Number.isInteger(b.lines) && b.lines > 0 ? b.lines : Math.max(1, PB.slices.text.wrapBlock(item.data, b, item.font).lines.length);
      const width = Math.max(1, roundDots(exactDots(ctx, b.width)));
      if (b.align === 'justify') ctx.once('tspl-block-justify', () => diag.info('Hay bloques de texto justificados, que BLOCK de TSPL no tiene: se escriben alineados a la izquierda'));
      const native = item.native || {};
      const align = b.align === 'center' ? 2 : b.align === 'right' ? 3 : native.align === 1 ? 1 : 0;
      const fit = Number.isFinite(native.fit) ? native.fit : null;
      const optional = fit !== null ? [space, align, fit] : align !== 0 ? [space, align] : space !== 0 ? [space] : [];
      if (item.counter && Number.isFinite(item.counter.step) && Math.trunc(item.counter.step) !== 0) {
        ctx.once('tspl-block-counter', () => diag.info('Hay contadores en bloques de texto, que BLOCK de TSPL no incrementa: se escribe el valor inicial'));
      }
      const data = String(item.data == null ? '' : item.data).replace(/\r\n|\r/g, '\n').split('\n').map(part => safeData(ctx, part)).join('\\[R]');
      return `BLOCK ${[x, y, width, lines * pitch, `"${name}"`, degrees, xmul, ymul, ...optional, quoted(data)].join(',')}`;
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

    /**
     * The neutral block of a BLOCK command (see js/core/model.js): width in 0.1 mm, lines = how many lines of the font fit the height
     * (floor(height / (character height + space)), at least 1; absent without a valid height), align and the extra line space.
     * null when the width is not a positive number (the printer draws nothing: the viewer keeps a one-line text, with an info).
     */
    function blockOf(ctx, cmd, font, space, align) {
      const [width, height] = [num(cmd.args[2]), num(cmd.args[3])];
      if (width === null || width <= 0) {
        ctx.report(diag.info('BLOCK: ancho no válido, se dibuja como una línea de texto'));
        return null;
      }
      const spaceDots = Number.isFinite(space) ? space : 0;
      const pitch = Math.max(1, Math.round(font.size / ctx.dot)) + spaceDots;
      const kind = align === undefined ? 'left' : BLOCK_ALIGN[align];
      if (!kind) ctx.report(diag.info(`BLOCK: alineación ${align} no válida, se dibuja a la izquierda`));
      return {
        width: width * ctx.dot,
        ...(height !== null && height > 0 && pitch > 0 && { lines: Math.max(1, Math.floor(height / pitch + 1e-6)) }),
        align: kind || 'left',
        lineSpace: spaceDots * ctx.dot,
      };
    }

    /** Builds the text item shared by TEXT and BLOCK; `fontArgs` = [font, rotation, xmul, ymul] argument objects. */
    function textItem(ctx, ref, cmd, point, fontArgs, data) {
      const [fontArg, rotArg, xArg, yArg] = fontArgs;
      const xmul = multiplier(ctx, ref, xArg, 'multiplicador X');
      const ymul = multiplier(ctx, ref, yArg, 'multiplicador Y');
      const font = fontOf(ctx, ref, fontArg.value, xmul, ymul);
      const rotation = rotationOf(ctx, ref, rotArg);
      const origin = ctx.pos(point.x, point.y);
      const shift = baselineShift(rotation, font.size, ctx.dot, !(fontArg.value.toUpperCase() in BITMAP_FONTS));
      const [x, y] = [origin.x + shift.x, origin.y + shift.y];
      return {
        kind: 'text', ref, source: sourceOf(cmd), x, y, raw: { x: String(point.x), y: String(point.y) },
        font, rotation,
        data,
        native: { font: fontArg.value, xmul, ymul },
      };
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Properties: the Tipo select (TEXT <-> BLOCK) and the block fields

    const KIND_OPTIONS = Object.freeze([{ value: 'line', label: 'Línea de texto' }, { value: 'block', label: 'Bloque de texto' }]);
    const ALIGN_OPTIONS = Object.freeze([{ value: 'left', label: 'Izquierda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Derecha' }]);
    /** The align argument written for each alignment (0 = left: the default). */
    const ALIGN_CODES = Object.freeze({ left: 0, center: 2, right: 3 });
    /** Width of a block made from a line: this many characters of the font. */
    const DEFAULT_BLOCK_CHARS = 20;
    /** Largest block width (dots) and number of lines the panel writes (the manual gives no limit). */
    const MAX_BLOCK_WIDTH = 9999;
    const MAX_BLOCK_LINES = 999;

    /** True when the content argument of a command is a counter ("@n"): such a text stays a line (BLOCK content is literal). */
    const counterContent = cmd => COUNTER.test(cmd.args[cmd.args.length - 1].raw);
    const isCounter = item => COUNTER.test(String(item.data)) || (item.native && item.native.counterN !== undefined);

    /** The Tipo select. Not written by itself: the shape's `reemit` hook rewrites the command (reemitText). */
    const kindField = {
      key: 'kind', label: 'Tipo', type: 'select', arg: 0, options: KIND_OPTIONS, reemit: true,
      model: item => (isCounter(item) ? undefined : item.ref === 'BLOCK' ? 'block' : 'line'),
      read: (a, cmd) => (counterContent(cmd) ? undefined : cmd.name === 'BLOCK' ? 'block' : 'line'),
      write: () => null,
    };
    /** Block width: the third argument, in dots. */
    const widthField = numberField('blockWidth', 'Ancho del bloque (puntos)', 2, 1, MAX_BLOCK_WIDTH, item => item.native && item.native.width);
    /** Maximum lines: the height argument holds lines * pitch, so this field is the block's `lines` and is written through the hook. */
    const linesField = {
      key: 'blockLines', label: 'Líneas máx.', type: 'number', arg: 3, min: 1, max: MAX_BLOCK_LINES, step: 1, reemit: true,
      model: item => (item.block ? item.block.lines : undefined),
      read: (a, cmd, ctx) => (ctx && ctx.item && ctx.item.block ? ctx.item.block.lines : undefined),
      write: () => null,
    };
    /** Alignment: the align argument, which follows the optional space, so it is written through the hook (left, center, right: no justification). */
    const alignField = {
      key: 'blockAlign', label: 'Alineación', type: 'select', arg: 3, options: ALIGN_OPTIONS, reemit: true,
      model: item => (item.block && item.block.align in ALIGN_CODES ? item.block.align : item.block ? 'left' : undefined),
      read: (a, cmd) => { const kind = BLOCK_ALIGN[num(cmd.args.slice(8, -1)[1])]; return kind === 'center' || kind === 'right' ? kind : 'left'; },
      write: () => null,
    };

    /** TEXT -> BLOCK: the same x, y, font, rotation, multipliers and content, a width of DEFAULT_BLOCK_CHARS characters and the lines the text needs. */
    function blockFromText(cmd, item, dot) {
      const raws = cmd.args.map(a => a.raw);
      const [x, y, font, rotation, xmul, ymul] = raws;
      const { advanceOf, wrapBlock } = PB.slices.text;
      const width = Math.max(1, Math.round(DEFAULT_BLOCK_CHARS * (item.font.size / dot) * advanceOf(item.font) * item.font.scaleX));
      const lines = Math.max(1, wrapBlock(item.data, { width: width * dot, align: 'left' }, item.font).lines.length);
      const pitch = Math.max(1, Math.round(item.font.size / dot));
      return `BLOCK ${[x, y, width, lines * pitch, font, rotation, xmul, ymul, raws[raws.length - 1]].join(',')}`;
    }

    /** BLOCK -> TEXT: x, y, font, rotation, multipliers and content stay; the width, height, space, align and fit go and the breaks become spaces. */
    function textFromBlock(cmd) {
      const raws = cmd.args.map(a => a.raw);
      const [x, y, , , font, rotation, xmul, ymul] = raws;
      return `TEXT ${[x, y, font, rotation, xmul, ymul, raws[raws.length - 1].replace(BLOCK_BREAK, ' ')].join(',')}`;
    }

    /**
     * Shape hook for the fields flagged `reemit` (see js/languages/tspl-edit.js): the edits [{ start, end, value }] of the command, or null to refuse.
     *   kind: block / line rewrite the whole command (blockFromText, textFromBlock); the same kind changes nothing.
     *   blockLines: the height argument = lines * pitch (character height of the font in dots + the space of the command).
     *   blockAlign: the optional arguments after the multipliers become [space (0 when omitted), align, fit (if there was one)].
     */
    function reemitText(cmd, item, changes, opts) {
      const dot = units.dotSize((opts && opts.dpi) || PB.config.resolutions[0]);
      if (Object.hasOwn(changes, 'kind')) {
        if (changes.kind === 'block' && cmd.name === 'TEXT') return [{ start: cmd.start, end: cmd.end, value: blockFromText(cmd, item, dot) }];
        if (changes.kind === 'line' && cmd.name === 'BLOCK') return [{ start: cmd.start, end: cmd.end, value: textFromBlock(cmd) }];
        return changes.kind === 'block' || changes.kind === 'line' ? [] : null;
      }
      if (cmd.name !== 'BLOCK') return null;
      if (Object.hasOwn(changes, 'blockLines')) {
        const v = changes.blockLines;
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
        const space = item.native && Number.isFinite(item.native.space) ? item.native.space : 0;
        const pitch = Math.max(1, Math.round(item.font.size / dot)) + space;
        const height = cmd.args[3];
        const value = String(Math.min(MAX_BLOCK_LINES, Math.max(1, Math.round(v))) * pitch);
        return value === height.raw ? [] : [{ start: height.start, end: height.end, value }];
      }
      if (Object.hasOwn(changes, 'blockAlign')) {
        const code = ALIGN_CODES[changes.blockAlign];
        if (code === undefined) return null;
        const optional = cmd.args.slice(8, -1);
        if (!optional.length && code === 0) return [];
        const list = [optional[0] ? optional[0].raw : '0', String(code), ...(optional[2] ? [optional[2].raw] : [])];
        const [from, to] = [cmd.args[7].end, cmd.args[cmd.args.length - 1].start];
        return [{ start: from, end: to, value: `,${list.join(',')},` }];
      }
      return null;
    }

    /**
     * Properties of a TEXT or BLOCK command: the Tipo select first (a line or a block, written by reemitText); a block adds its width, maximum
     * lines and alignment. The multipliers are 1..10 for a bitmap font and POINT sizes (up to MAX_POINTS) for a scalable one, so there is one
     * definition for each; BLOCK has the same arguments two places later (its width and height come before the font).
     */
    const textShape = (bitmap, block) => {
      const max = bitmap ? MAX_MULTIPLIER : MAX_POINTS;
      const [name, shift] = block ? ['BLOCK', 2] : ['TEXT', 0];
      return {
        applies: (item, cmd) => {
          const isShape = cmd ? cmd.name === name : item.ref === name;
          const font = cmd ? cmd.args[2 + shift] && cmd.args[2 + shift].value : item.native && item.native.font;
          return isShape && (String(font).toUpperCase() in BITMAP_FONTS) === bitmap;
        },
        reemit: reemitText,
        fields: [
          kindField,
          ...(block ? [widthField, linesField, alignField] : []),
          selectField('rotation', 'Rotación', 3 + shift, [0, 90, 180, 270], item => item.rotation),
          numberField('xmul', bitmap ? 'Multiplicador X' : 'Tamaño X (pt)', 4 + shift, 1, max, item => item.native && item.native.xmul),
          numberField('ymul', bitmap ? 'Multiplicador Y' : 'Tamaño Y (pt)', 5 + shift, 1, max, item => item.native && item.native.ymul),
          // Font id (a quoted string): the ids the viewer knows; any other id is listed as the current value
          stringSelectField('font', 'Fuente', 2 + shift, FONT_OPTIONS, item => item.native && item.native.font),
          // The content is the last argument (TEXT: argument 6, or 7 when an alignment argument precedes it); counters are left out. The content of
          // a block shows its line breaks as written (\[R], \[L]), so they are never lost
          textField('content', block ? 'Contenido (\\[R] = salto de línea)' : 'Contenido', cmd => cmd.args.length - 1,
            item => (isCounter(item) ? undefined : block ? String(item.data).replace(/\n/g, '\\[R]') : item.data)),
        ],
      };
    };

    const point = (cmd, i) => ({ x: num(cmd.args[i]), y: num(cmd.args[i + 1]) });
    const validPoint = p => p.x !== null && p.y !== null;

    return {
      // emit(item, ctx) -> the TEXT command of a text item
      emit,
      // build(text, point, options) -> text with a new TEXT command (palette)
      build,
      // Move: TEXT and BLOCK both start with x,y (arguments 0 and 1, dots); everything else of the command is left alone
      coordinates: [{ applies: (item, cmd) => !cmd || cmd.name === 'TEXT' || cmd.name === 'BLOCK', fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] }],
      // Properties: Tipo (TEXT / BLOCK), rotation, multipliers, font id and content of TEXT and BLOCK (counters keep their text), block width, lines and alignment
      editable: [textShape(true, false), textShape(false, false), textShape(true, true), textShape(false, true)],
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
            // A counter with an assigned start value shows it (the printer increments it per label); else the literal text
            const shown = ctx.counterContent(content);
            const item = textItem(ctx, 'TEXT', cmd, p, cmd.args.slice(2, 6), shown ? shown.data : contentOf(ctx, 'TEXT', content));
            if (shown) {
              item.native.counterN = shown.n;
              if (shown.counter) item.counter = shown.counter;
            }
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
            const data = contentOf(ctx, 'BLOCK', content).replace(BLOCK_BREAK, '\n');
            const item = textItem(ctx, 'BLOCK', cmd, p, cmd.args.slice(4, 8), data);
            const block = blockOf(ctx, cmd, item.font, space, align);
            if (block) item.block = block;
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
