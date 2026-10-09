/**
 * Text slice, ZPL language (Zebra): the text field.
 *   ^FOx,y ^Afo,h,w ^FDdata ^FS        (^FT instead of ^FO: the baseline origin; ^FR: reverse print; ^FH: hex escapes in the data)
 * A ZPL field is dispatched when it closes (see js/languages/zpl.js): the main command is ^A, or none at all when the field only has
 * data (^FD / ^FV), which is a text in the default font (^CF, power-up A,9,5) and is dispatched with the key '^FD'. Both become the
 * neutral `text` item (see js/core/model.js), so the SVG renderer of this slice only gets the `reverse` flag.
 * factory(helpers) -> { handlers, emit, build, coordinates, editable }. Registered by js/components/text/index.js as `languages.zpl`.
 *
 * ---- What the 2003 guide (Volume One, local copy in docs/zpl) documents ----------------------------------------------------------
 *   ^A  f = A..Z, 1..9 (any font of the printer); o = N R I B (default: the ^FW value); h, w in dots. Scalable: 10..32000, default 15 and 12 (or
 *       the last ^CF value). Bitmapped: multiples of the standard matrix from 2 to 10 times, default the standard matrix. "If you specify only
 *       the height or width value, the standard matrix for that font automatically determines the other value. If the value is not given or a
 *       0 (zero) is entered, the height or width is determined by the standard font matrix."
 *   ^CF f,h,w (power-up A, 9, 5; only the height or only the width forces the magnification to be proportional), ^FW (default orientation).
 *   ^FO: "the upper-left corner of the field area ... independent of the rotation". ^FT: "the origin is at the start of the character string, at
 *       the baseline of the font" and does not change with the rotation (normal: characters rest on the baseline; rotated: drawn to the right
 *       of the baseline going down; inverted: down from the baseline, to the left; bottom-up: to the left, going up).
 *   ^FR: the colour of the output is the reverse of its background; ^LRY does the same for every later field (until ^LRN, see js/languages/zpl.js:
 *       the parser sets field.reverse for both and native.labelReverse for the second). ^FH: hex escapes in the data. ^FP: direction and gaps (vertical formatting).
 *   ^FBa,b,c,d,e (page 150): a = width of the block in dots (0 or missing: the text does not print), b = maximum lines 1..9999 (default 1; "text
 *       exceeding the maximum number of lines overwrites the last line": the viewer clips it), c = extra line space in dots (-9999..9999, default
 *       0), d = L C R J (default L; "last line is left-justified if J is used"), e = hanging indent of the second and later lines (kept in
 *       native, not drawn). "\&" in the data is a line break, "\\" a backslash (^CI13), "\*" a soft hyphen: only "\&" is read (it becomes "\n").
 *       A word longer than a line is hyphenated by the printer (the viewer cuts it without a hyphen). ^FO: the block grows from top to bottom;
 *       ^FT: "the baseline origin of the last possible line", so the first baseline is (lines - 1) pitches back (the pitch is the character height
 *       plus c: an approximation, the guide gives no line height). ^SN with ^FB does not print. The model keeps it as item.block (see js/core/model.js).
 * ---- Volume Two (2005, local copy in docs/zpl): fonts ---------------------------------------------------------------------------
 *   Printed pages 61 (Table 10: intercharacter gap and baseline of A..H, "the baseline for font E is 23 dots down from the top of the matrix")
 *   and 64-65 (the matrices by printhead: 8 dots/mm = 203 dpi, 12 dots/mm = 300 dpi). BITMAP_FONTS holds them (see there). Fonts GS (SYMBOL),
 *   1..9 and downloaded ones have no matrix here: they are drawn as a scalable sans font of the asked size, with one info. Font 0 is the
 *   scalable one: the viewer draws it sans bold (width = height means the normal proportions, a missing width follows the height) and the
 *   bitmapped ones mono (they are fixed pitch). The baseline of a ^FO field is the one of Table 10 for A..H and 3 x height / 4 for font 0
 *   (BASELINE); the length of a text rotated 180 or 270 degrees with ^FO (half the width per character for font 0, the advance of the cell
 *   for the bitmapped ones) is an approximation: ^FT is exact.
 * ---- What it does NOT document (so what follows is the viewer's simulation, NOT VERIFIED ON A PRINTER) -----------------------------
 *   The gap and baseline of P..V (none in the manual: gap 0, baseline 3/4 of the height), whether the baseline scales with the magnification
 *   (assumed: yes) and with the 300 dpi matrices of E and H (the same share of the height), the look of the glyphs (the viewer draws every
 *   bitmapped font with one mono face), and the real width of the scalable font 0 (proportional: the advance is an approximation).
 * ---- Neutral item ----------------------------------------------------------------------------------------------------------------
 *   x, y = the baseline origin (what the renderer draws from): ^FT as written, ^FO converted with the baseline offset of the orientation.
 *   font.size = the character height in dots; font.scaleX stretches it to the width. native: { font, fontArg, orientationArg, height, width,
 *   hMult, wMult, origin: 'FO' | 'FT' | 'default', cell }. reverse: true for ^FR (ZPL specific, never the TPCL attribute W).
 * Emit (the inverse): [^FB before the data for an item with a block,] ^FT with the baseline origin, or ^FO when the item came from a ^FO field; a mono model font whose size and width are
 * whole multiples of a bitmapped matrix becomes that font, anything else the scalable font 0, with one info when the family, weight or style
 * cannot be represented. Text attributes, alignment, spacing, bold and counters of other languages are reported and written without them.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.text = PB.slices.text || {};

  const { units, diagnostics: diag } = PB;

  /** Approximate advance of a mono glyph in em (what the CSS mono family draws), used to fit the cell advance. */
  const MONO_ADVANCE = 0.6;
  /** Advance of a character of the scalable font, as a share of its width (to size the text rotated 180 / 270 with ^FO). Not verified. */
  const SCALABLE_ADVANCE = 0.5;

  /**
   * Bitmapped fonts of the 8 dots/mm (203 dpi) printhead: [cell height, cell width, inter-character gap] in dots at 1x (Volume Two, printed
   * pages 61 and 64). A..H: the matrix column, with the gap of Table 10 (page 61), which the chars/inch column confirms (pitch = 203 / chars
   * per inch: A 6.1, B 8.9, C/D 12.0, E 19.9, F 16.0, G 48.3, H 18.8 dots). The matrix column prints font B as "11 x 17" (a typo): Table 10 and
   * the inch columns say 11 x 7 (0.054 x 0.044 in = 11 x 9 dots with the gap), so 11 x 7 is used. P..V (letters, U-L-D): the matrix column;
   * the manual gives no chars/inch for them (N/A) and their inch width equals the cell width, so the gap is 0 (not verified). C and D share
   * the matrix. GS (24 x 24 SYMBOL) is not here: it is a symbol font, and the manual shows only two of its glyphs (page 60, Figure 9).
   * The viewer draws every bitmapped font mono (fixed pitch), regular.
   */
  const FONTS_203 = Object.freeze({
    A: [9, 5, 1], B: [11, 7, 2], C: [18, 10, 2], D: [18, 10, 2], E: [28, 15, 5], F: [26, 13, 3], G: [60, 40, 8], H: [21, 13, 6],
    P: [20, 18, 0], Q: [28, 24, 0], R: [35, 31, 0], S: [40, 35, 0], T: [48, 42, 0], U: [59, 53, 0], V: [80, 71, 0],
  });
  /**
   * The 12 dots/mm (300 dpi) printhead (page 65): the same matrices except E = 42 x 20 and H = 34 x 22. The gaps are the ones of Table 10 where
   * the matrix is the same (the chars/inch of the table agree within 2%: A 50.8, B 33.8, C/D 25.4, F 19.06, G 6.36). E: the printed
   * chars/inch (23.4) is smaller than the cell, so it is not usable; the inch width 0.085 in = 25.5 dots is kept as pitch 25 (gap 5, the one of
   * Table 10). H: 10.20 chars/inch = 29.4 dots, so pitch 29 (gap 7). A different resolution (the 24 dots/mm table of the manual, 254...) uses
   * the 203 dpi table: 600 dpi is not offered by the viewer.
   */
  const FONTS_300 = Object.freeze({ ...FONTS_203, E: [42, 20, 5], H: [34, 22, 7] });
  /** The table of a printer resolution. */
  const fontsOf = dpi => (dpi === 300 ? FONTS_300 : FONTS_203);
  /** Fonts that are only written when the item came from them (C is D; P..V would match too many neutral mono sizes). */
  const SOURCE_ONLY = Object.freeze(new Set(['C', 'P', 'Q', 'R', 'S', 'T', 'U', 'V']));
  /** The scalable font. */
  const SCALABLE = '0';
  const FONT_NOTES = Object.freeze({ E: ' OCR-B', H: ' OCR-A' });
  /**
   * Baseline of the bitmapped fonts at 1x, in dots from the top of the matrix (Table 10, page 61: A 7, B 11, C/D 14, E 23, F 21, G 48, H 21),
   * and of font 0 (3 x height / 4). Kept as a share of the 203 dpi height, so it follows the magnification and the 300 dpi matrices of E and
   * H (assumed, not in the manual). P..V and the other fonts: the share of the scalable font (not in the manual).
   */
  const BASELINE = Object.freeze({ A: 7 / 9, B: 11 / 11, C: 14 / 18, D: 14 / 18, E: 23 / 28, F: 21 / 26, G: 48 / 60, H: 21 / 21 });
  const BASELINE_DEFAULT = 0.75;

  /**
   * Font ids the properties panel offers: the bitmapped fonts (letter, cell at 203 dpi, and where 300 dpi differs; mono), then the scalable one.
   * The cell shown is the 203 dpi one: the panel does not know the resolution of the file.
   */
  const FONT_OPTIONS = Object.freeze([
    ...Object.entries(FONTS_203).map(([id, [h, w]]) => {
      const [h3, w3] = FONTS_300[id];
      const other = h3 !== h || w3 !== w ? `, ${h3}×${w3} a 300 dpi` : '';
      return { value: id, label: `${id} · ${h}×${w} puntos${other} (monoespaciada${FONT_NOTES[id] ? `,${FONT_NOTES[id]}` : ''})` };
    }),
    { value: SCALABLE, label: `${SCALABLE} · Escalable (sans negrita)` },
  ]);

  /** Magnification range of the bitmapped fonts, the scalable size range of ^A, and the default of a ^A without sizes (all from the guide). */
  const MAX_MULTIPLIER = 10;
  const MAX_DOTS = 32000;
  const MIN_SCALABLE = 10;
  const SCALABLE_DEFAULT = Object.freeze({ height: 15, width: 12 });
  /** How far (in multiples) a model font may be from an exact bitmapped font to be written as one. */
  const MULTIPLIER_TOLERANCE = 0.05;
  /** Fallback size (0.1 mm) for a text whose font has no usable size. */
  const DEFAULT_SIZE = 80;
  /** Height and width in mm of a freshly inserted text (4 mm, whatever the resolution). */
  const TEMPLATE_SIZE = 40;

  const positive = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /**
   * The cell of a font for the h / w asked (dots, null = not given): { bitmap, height, width, advance, hMult, wMult } in dots. Neither given
   * means the last ^CF values when the font is the default one or the ^CF gave sizes (Volume Two, page 63: another font then "will be magnified
   * using values for the ^CF height and width parameters"), else the standard matrix / the guide's 15 x 12; only one given makes the
   * other proportional (same magnification for the bitmapped fonts, same dots for the scalable one). dpi picks the matrix table.
   */
  function cellOf(name, h, w, cf, dpi) {
    let [height, width] = [positive(h), positive(w)];
    if (height === null && width === null && cf && (cf.name === name || cf.explicit)) [height, width] = [positive(cf.height), positive(cf.width)];
    const matrix = fontsOf(dpi)[name];
    if (matrix) {
      const [cellH, cellW, gap] = matrix;
      const multiple = (v, std) => clamp(Math.round(v / std), 1, MAX_MULTIPLIER);
      const hMult = height !== null ? multiple(height, cellH) : width !== null ? multiple(width, cellW) : 1;
      const wMult = width !== null ? multiple(width, cellW) : height !== null ? multiple(height, cellH) : 1;
      return { bitmap: true, height: cellH * hMult, width: cellW * wMult, advance: (cellW + gap) * wMult, hMult, wMult };
    }
    if (height === null && width === null) [height, width] = [SCALABLE_DEFAULT.height, SCALABLE_DEFAULT.width];
    const hh = clamp(Math.round(height !== null ? height : width), 1, MAX_DOTS);
    const ww = clamp(Math.round(width !== null ? width : height), 1, MAX_DOTS);
    return { bitmap: false, height: hh, width: ww, advance: ww * SCALABLE_ADVANCE, hMult: null, wMult: null };
  }

  /** ^FB justification letters and the neutral block alignment. */
  const BLOCK_ALIGN = Object.freeze({ L: 'left', C: 'center', R: 'right', J: 'justify' });
  /** Largest ^FB width, line count, line space and indent of the guide (9999). */
  const MAX_FB = 9999;
  /** The ^FB line break escape of the data. */
  const BREAK = /\\&/g;

  /**
   * Offset in dots from the ^FT origin (the baseline of the last possible line of a block) to the baseline of the first line, for a rotation in
   * degrees clockwise: (lines - 1) pitches against the direction the lines advance (down in the text's own frame: (0, 1) at 0, (-1, 0) at 90...).
   */
  function lastLineOffset(rotation, lines, pitch) {
    const back = (lines - 1) * pitch;
    if (rotation === 90) return { x: back, y: 0 };
    if (rotation === 180) return { x: 0, y: back };
    if (rotation === 270) return { x: -back, y: 0 };
    return { x: 0, y: -back };
  }

  /** Dots from the top of the character box to the baseline (ascent) of a font of that character height; the rest is the descent. */
  const ascentOf = (name, height) => Math.round(height * (BASELINE[name] || BASELINE_DEFAULT));

  /** Length in dots of the text along its direction (approximation, only used for ^FO with a rotation of 180 or 270 degrees). */
  const lengthOf = (data, advance) => Math.round(Array.from(String(data == null ? '' : data)).length * advance);

  /**
   * Offset in dots from the top-left of the text box (^FO) to the baseline origin, for a rotation in degrees clockwise. The box holds the
   * ascent on the side the letters stand to and the descent on the other; text starting corner: N top-left, R top-right of the unrotated
   * view... ie the baseline is `ascent` below the top (N), `descent` right of the left side (R), `length` right and `descent` below (I),
   * `ascent` right and `length` below (B).
   */
  function baselineOffset(rotation, height, length, name) {
    const a = ascentOf(name, height);
    const d = height - a;
    if (rotation === 90) return { x: d, y: 0 };
    if (rotation === 180) return { x: length, y: d };
    if (rotation === 270) return { x: a, y: length };
    return { x: 0, y: a };
  }

  /** Neutral font of a cell: height in dots -> 0.1 mm, the width as a horizontal stretch; mono 400 for the bitmapped fonts, sans bold for 0. */
  function fontOf(name, cell, dot) {
    const size = cell.height * dot;
    if (cell.bitmap) return { size, scaleX: cell.advance / (MONO_ADVANCE * cell.height), family: 'mono', weight: 400, style: 'normal' };
    return { size, scaleX: cell.width / cell.height, family: 'sans', weight: name === SCALABLE ? 700 : 400, style: 'normal' };
  }

  /**
   * Bitmapped font that draws a mono model font: the entry whose cell height times an integer (1..10) reproduces the size and whose cell
   * advance times an integer (1..10) reproduces the width, both within MULTIPLIER_TOLERANCE. Best fit first, then the font the item came
   * from (so C stays C), then the lowest magnification, then the table order. SOURCE_ONLY fonts (C is D; P..V) are only candidates when they
   * came from the source. dpi picks the matrix table.
   */
  function bitmapChoice(font, dot, preferred, dpi) {
    if (font.family !== 'mono') return null;
    const heightDots = font.size / dot;
    let best = null;
    for (const [name, [cellH, cellW, gap]] of Object.entries(fontsOf(dpi))) {
      if (SOURCE_ONLY.has(name) && preferred !== name) continue;
      const y = heightDots / cellH;
      const x = (font.scaleX * heightDots * MONO_ADVANCE) / (cellW + gap);
      const [yi, xi] = [Math.round(y), Math.round(x)];
      if (yi < 1 || yi > MAX_MULTIPLIER || xi < 1 || xi > MAX_MULTIPLIER) continue;
      if (Math.abs(y - yi) > MULTIPLIER_TOLERANCE || Math.abs(x - xi) > MULTIPLIER_TOLERANCE) continue;
      const score = Math.round((Math.abs(y - yi) + Math.abs(x - xi)) * 1000);
      const rank = [score, name === preferred ? 0 : 1, yi];
      const firstDiff = best ? rank.findIndex((v, i) => v !== best.rank[i]) : -1;
      if (!best || (firstDiff >= 0 && rank[firstDiff] < best.rank[firstDiff])) best ={ name, hMult: yi, wMult: xi, rank };
    }
    return best;
  }

  function zpl(helpers) {
    const {
      sourceOf, int, ROTATIONS, rotationOf, orientationOf, exactDots, roundDots, dataCommands, fo, ft,
      numberField, stringSelectField, contentField, serialFields, insertCommand, freePlaceholder, itemRotation, dropDots, lengthDots, reverseField,
      paramField, argEdit, flagEdits,
    } = helpers;

    // -------------------------------------------------------------------------------------------------------------
    // Palette

    /** Adds ^FOx,y^A0o,h,w^FD<#TEXTOn#>^FS before ^XZ with the top-left of the text at the drop point, upright in the rotated view. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const size = lengthDots(options, TEMPLATE_SIZE);
      return insertCommand(text, `^FO${x},${y}^A${SCALABLE}${orientationOf(itemRotation(options))},${size},${size}^FD${freePlaceholder(text, 'TEXTO')}^FS`);
    }

    // -------------------------------------------------------------------------------------------------------------
    // Emit

    /** Rotation in degrees: the nearest quarter turn, with a warning once if the item was not on one. */
    function rotationDegrees(ctx, rotation) {
      const turns = Number.isFinite(rotation) ? Math.round(rotation / 90) : 0;
      const degrees = (((turns * 90) % 360) + 360) % 360;
      if (degrees !== rotation && !(rotation == null && degrees === 0)) {
        ctx.once('zpl-rotation', () => diag.warning('Hay textos con una rotación que no es múltiplo de 90°: se ajustan al giro más cercano'));
      }
      return degrees;
    }

    /** The fidelity notes of the model features the ZPL text field does not have (once per label each). */
    function noteLosses(ctx, item) {
      if (item.attribute && item.attribute.kind && item.attribute.kind !== 'black') {
        ctx.once('zpl-text-attribute', () => diag.warning('Hay textos con atributo (invertido, con marco o tachado), que ZPL no tiene como parte del texto: se escriben sin él (la impresión inversa de ZPL es ^FR)'));
      }
      if (item.align && item.align.kind && item.align.kind !== 'left') {
        ctx.once('zpl-text-align', () => diag.info('Hay textos con alineación (centro, derecha o texto repartido), que ^A de ZPL no escribe: se escriben a la izquierda'));
      }
      if (item.spacing) ctx.once('zpl-text-spacing', () => diag.info('Hay textos con espaciado entre caracteres, que ^A de ZPL no escribe: se escriben sin él'));
      if (item.bold) ctx.once('zpl-text-bold', () => diag.info('Hay textos en negrita (sobreimpresión), que ^A de ZPL no escribe: se escriben sin ella'));
    }

    /**
     * The ^FB parameters of an item with a block, in dots clamped to the guide's ranges: width (at least 1), lines (the block's, or what the
     * wrapped text needs, at least 1), extra line space, justification letter and the hanging indent the item came with (native.fb).
     */
    function blockFields(ctx, item, cell) {
      const b = item.block;
      const lines = Number.isInteger(b.lines) && b.lines > 0 ? b.lines : Math.max(1, PB.slices.text.wrapBlock(item.data, b, item.font).lines.length);
      const fb = item.native && item.native.fb;
      return {
        width: clamp(roundDots(exactDots(ctx, b.width)), 1, MAX_FB),
        lines: clamp(lines, 1, MAX_FB),
        space: clamp(roundDots(exactDots(ctx, b.lineSpace || 0)), -MAX_FB, MAX_FB),
        letter: Object.keys(BLOCK_ALIGN).find(k => BLOCK_ALIGN[k] === b.align) || 'L',
        indent: fb && Number.isInteger(fb.indent) ? clamp(fb.indent, 0, MAX_FB) : 0,
      };
    }

    /**
     * The data command of a block: the breaks are "\&" (the data is encoded for ^FH as usual). ^SN does not print inside a ^FB (guide), so a counter
     * is written as its start value with one info.
     */
    function blockData(ctx, item) {
      const counter = item.counter && Number.isFinite(item.counter.step) && Math.trunc(item.counter.step) !== 0;
      if (counter) ctx.once('zpl-fb-counter', () => diag.info('Hay contadores en bloques de texto: ^SN no imprime dentro de ^FB, se escribe el valor inicial como texto'));
      const data = String(item.data == null ? '' : item.data).replace(/\r\n|\r|\n/g, '\\&');
      return dataCommands(ctx, counter ? { ...item, counter: undefined } : item, data);
    }

    /**
     * ^FO / ^FT x,y ^Afo,h,w [^FR] ^FD data ^FS. The font is the bitmapped one the model font matches (see bitmapChoice) or the scalable 0
     * with the size and width in dots. ^FT writes the baseline origin of the model; ^FO (items that came from a ^FO field) the top-left
     * of the text box, the inverse of the parser's conversion.
     */
    function emit(item, ctx) {
      const font = item.font || {};
      const size = Number.isFinite(font.size) && font.size > 0 ? font.size : DEFAULT_SIZE;
      const scaleX = Number.isFinite(font.scaleX) && font.scaleX > 0 ? font.scaleX : 1;
      const weight = font.weight == null ? 400 : font.weight;
      const regular = weight === 400 && (font.style || 'normal') === 'normal';
      const dot = units.dotSize(ctx.dpi);
      const sizeDots = size / dot;
      const preferred = item.native && item.native.font;
      const choice = bitmapChoice({ ...font, size, scaleX }, dot, preferred, ctx.dpi);
      let name = SCALABLE;
      let cell;
      if (choice) {
        name = choice.name;
        const [cellH, cellW, gap] = fontsOf(ctx.dpi)[name];
        cell = { height: cellH * choice.hMult, width: cellW * choice.wMult, advance: (cellW + gap) * choice.wMult };
      } else {
        const height = roundDots(sizeDots);
        const width = roundDots(sizeDots * scaleX);
        cell = { height: clamp(height, MIN_SCALABLE, MAX_DOTS), width: clamp(width, MIN_SCALABLE, MAX_DOTS) };
        cell.advance = cell.width * SCALABLE_ADVANCE;
        if (cell.height !== height || cell.width !== width) {
          ctx.once('zpl-size-range', () => diag.info('Hay textos fuera del rango de tamaño de la fuente escalable de ZPL (entre 10 y 32000 puntos de impresora): se ajustan al límite'));
        }
      }
      const exact = choice ? regular : (font.family || 'sans') === 'sans' && weight >= 700 && (font.style || 'normal') === 'normal';
      if (!exact) {
        ctx.once('zpl-fonts', () => diag.info('Las fuentes ZPL no coinciden con las de origen (familia, peso o cursiva): se usan la fuente escalable 0 y las bitmap más cercanas (simulación del visor, no verificado en impresora)'));
      }
      noteLosses(ctx, item);
      const degrees = rotationDegrees(ctx, item.rotation);
      const baseline = { x: roundDots(exactDots(ctx, item.x || 0)), y: roundDots(exactDots(ctx, item.y || 0)) };
      const fromFo = item.native && (item.native.origin === 'FO' || item.native.origin === 'default');
      const fb = item.block ? blockFields(ctx, item, cell) : null;
      let origin;
      if (fromFo) {
        const off = baselineOffset(degrees, cell.height, fb ? fb.width : lengthOf(item.data, cell.advance), name);
        origin = `^FO${Math.max(0, baseline.x - off.x)},${Math.max(0, baseline.y - off.y)}`;
      } else if (fb) {
        // ^FT is the baseline of the last possible line: (lines - 1) pitches along the lines after the first baseline
        const off = lastLineOffset(degrees, fb.lines, cell.height + fb.space);
        origin = `^FT${Math.max(0, baseline.x - off.x)},${Math.max(0, baseline.y - off.y)}`;
      } else {
        origin = ft(ctx, item.x || 0, item.y || 0);
      }
      const block = fb ? `^FB${fb.width},${fb.lines},${fb.space},${fb.letter}${fb.indent ? `,${fb.indent}` : ''}` : '';
      return `${origin}^A${name}${orientationOf(degrees)},${cell.height},${cell.width}${block}${item.reverse ? '^FR' : ''}${fb ? blockData(ctx, item) : dataCommands(ctx, item)}^FS`;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Parse

    /**
     * ^FBa,b,c,d,e of a field (Volume One, page 150): width in dots (default 0: the printer prints nothing, so the viewer keeps a line and says so),
     * maximum lines 1..9999 (default 1), extra line space -9999..9999 dots (default 0), justification L C R J (default L) and hanging indent
     * 0..9999 dots (default 0, kept in native only: not drawn). null when the block has no usable width. Values are clamped to the guide's ranges.
     */
    function readFB(ctx, field) {
      const cmd = field.block;
      const arg = i => (cmd.args[i] && cmd.args[i].raw !== '' ? cmd.args[i] : null);
      const width = arg(0) ? int(arg(0)) : 0;
      if (!(width > 0)) {
        ctx.once('zpl-fb-width', () => diag.info('^FB sin ancho válido (0 o no numérico): la impresora no imprime el texto, el visor lo dibuja como una línea de texto'));
        return null;
      }
      const whole = (i, def, min, max) => { const v = arg(i) ? int(arg(i)) : null; return v === null ? def : clamp(v, min, max); };
      const letter = arg(3) ? arg(3).raw.toUpperCase() : 'L';
      if (!(letter in BLOCK_ALIGN)) ctx.once('zpl-fb-align', () => diag.info('^FB: justificación no válida (L, C, R o J), se dibuja a la izquierda'));
      if (field.serial) ctx.once('zpl-fb-sn', () => diag.info('^FB con ^SN: la guía dice que el campo no se imprime; el visor lo dibuja con el valor inicial'));
      return {
        width: Math.min(width, MAX_FB), lines: whole(1, 1, 1, MAX_FB), space: whole(2, 0, -MAX_FB, MAX_FB), indent: whole(4, 0, 0, MAX_FB),
        letter: letter in BLOCK_ALIGN ? letter : 'L', align: BLOCK_ALIGN[letter] || 'left',
      };
    }

    /** Text item of a field: `spec` = { ref, name, h, w, rotation, fontArg, orientationArg } (h, w as written, null when not a number). */
    function textItem(ctx, field, spec) {
      const cell = cellOf(spec.name, spec.h, spec.w, ctx.font, ctx.dpi);
      if (!fontsOf(ctx.dpi)[spec.name] && spec.name !== SCALABLE) {
        ctx.once(`zpl-font-${spec.name}`, () => diag.info(`^A: fuente "${spec.name}" sin definición en el visor (la guía de Zebra consultada no la describe): se dibuja con una fuente sans del tamaño pedido`));
      }
      const fp = field.find('FP');
      if (fp && ((fp.args[0] && fp.args[0].raw && fp.args[0].raw.toUpperCase() !== 'H') || (int(fp.args[1]) || 0) > 0)) {
        ctx.once('zpl-fp', () => diag.info('^FP (dirección vertical, inversa o con espacio entre caracteres) no se dibuja: el texto se muestra de izquierda a derecha'));
      }
      const o = ctx.origin(field);
      const fb = field.block ? readFB(ctx, field) : null;
      // In a block "\&" is a line break; the model keeps "\n"
      const data = fb ? field.data.value.replace(BREAK, '\n') : field.data.value;
      // The text of a block has its first line at the origin: ^FO (top-left of the block) as for a line, with the width of the block as the length;
      // ^FT is the baseline of the LAST possible line (guide, ^FB comments), so the first one is (lines - 1) pitches back, against the line direction
      let off;
      if (o.kind === 'FT') off = fb ? lastLineOffset(spec.rotation, fb.lines, cell.height + fb.space) : { x: 0, y: 0 };
      else off = baselineOffset(spec.rotation, cell.height, fb ? fb.width : lengthOf(data, cell.advance), spec.name);
      return {
        kind: 'text', ref: spec.ref, source: sourceOf(field),
        x: o.x + off.x * ctx.dot, y: o.y + off.y * ctx.dot,
        font: fontOf(spec.name, cell, ctx.dot),
        rotation: spec.rotation,
        data,
        ...(fb && { block: { width: fb.width * ctx.dot, lines: fb.lines, align: fb.align, lineSpace: fb.space * ctx.dot } }),
        ...(field.reverse && { reverse: true }),
        native: {
          font: spec.name, fontArg: spec.fontArg, orientationArg: spec.orientationArg, height: spec.h, width: spec.w,
          hMult: cell.hMult, wMult: cell.wMult, origin: o.kind, ...(field.labelReverse && { labelReverse: true }),
          ...(fb && { fb: { width: fb.width, lines: fb.lines, space: fb.space, align: fb.letter, indent: fb.indent } }),
        },
      };
    }

    /** ^Afo,h,w: the font letter and the orientation are glued in the first argument; what is missing comes from ^CF / ^FW. */
    function readA(ctx, cmd) {
      const raw = cmd.args[0] ? cmd.args[0].raw : '';
      const fontArg = /^[A-Za-z0-9]/.test(raw) ? raw[0].toUpperCase() : null;
      let rotation = rotationOf(ctx.orientation);
      let orientationArg = null;
      if (raw.length > 1) {
        const given = rotationOf(raw[1]);
        if (given === null) ctx.report(diag.warning(`^A: orientación "${raw[1]}" no válida, se usa ${ctx.orientation}`));
        else { rotation = given; orientationArg = raw[1].toUpperCase(); }
      }
      return { ref: 'A', name: fontArg || ctx.font.name, h: int(cmd.args[1]), w: int(cmd.args[2]), rotation, fontArg, orientationArg };
    }

    // -------------------------------------------------------------------------------------------------------------
    // Edit

    const rotationOptions = ROTATIONS.map(value => ({ value, label: `${value}°` }));
    const sizeField = (key, label, arg) => numberField(key, label, 'A', arg, 0, MAX_DOTS, item => (item.native && item.native[key] != null ? item.native[key] : undefined));

    /** The font letter and the orientation share the first argument of ^A: each field rewrites only its character. */
    const fontField = {
      ...stringSelectField('font', 'Fuente', 'A', 0, FONT_OPTIONS, item => item.native && item.native.fontArg),
      read: a => (/^[A-Za-z0-9]/.test(a.raw) ? a.raw[0].toUpperCase() : undefined),
      write: (v, a) => (FONT_OPTIONS.some(o => o.value === v) ? v + a.raw.slice(1) : null),
    };
    const rotationField = {
      key: 'rotation', label: 'Rotación', type: 'select', cmd: 'A', arg: 0, options: rotationOptions,
      model: item => (item.native && item.native.orientationArg ? item.rotation : undefined),
      read: a => (a.raw.length > 1 ? rotationOf(a.raw[1]) ?? undefined : undefined),
      write: (v, a) => (ROTATIONS.includes(v) ? a.raw[0] + orientationOf(v) + a.raw.slice(2) : null),
    };
    /** ^FR: the presence of the command, or the ^LRY state of the label (native.labelReverse): see reverseField in js/languages/zpl-edit.js. */
    const reverse = reverseField('reverse', 'Impresión inversa (^FR)');
    const contentOf = contentField('content', 'Contenido', item => item.data);
    /** In a block the data holds its line breaks as "\&": the label says so. */
    const blockContentOf = contentField('content', 'Contenido (\\& = salto de línea)', item => item.data.replace(/\n/g, '\\&'));
    /** Incremento and Ceros iniciales: the data command is ^FD or ^SN (see serialFields in js/languages/zpl-edit.js). */
    const counterFields = serialFields();

    // ---- Tipo (line / block) and the block fields (^FB)

    const KIND_OPTIONS = Object.freeze([{ value: 'line', label: 'Línea de texto' }, { value: 'block', label: 'Bloque de texto' }]);
    const ALIGN_OPTIONS = Object.freeze([{ value: 'L', label: 'Izquierda' }, { value: 'C', label: 'Centro' }, { value: 'R', label: 'Derecha' }, { value: 'J', label: 'Justificado' }]);
    /** A block made from a line is this many characters wide. */
    const DEFAULT_BLOCK_CHARS = 20;
    const INTEGER = /^[+-]?\d+$/;

    /**
     * Moves the ^FT origin of a field when it gains (sign 1) or loses (sign -1) its block, so that the first line stays where it was: ^FT is the baseline of
     * the LAST line of a block (lastLineOffset gives the way back to the first one). `lines` and `space` (dots) are those of the block.
     */
    function moveFt(field, item, lines, space, sign, edits) {
      const origin = field.find('FT');
      const [ax, ay] = origin ? [origin.args[0], origin.args[1]] : [];
      if (!ax || !ay || !INTEGER.test(ax.raw) || !INTEGER.test(ay.raw)) return;
      const dot = units.dotSize(item.dpi || PB.config.resolutions[0]);
      const off = lastLineOffset(item.rotation, lines, Math.max(1, Math.round(item.font.size / dot)) + space);
      const [x, y] = [Math.max(0, Number(ax.raw) - sign * off.x), Math.max(0, Number(ay.raw) - sign * off.y)];
      if (String(x) !== ax.raw) edits.push(argEdit(origin, 0, String(x)));
      if (String(y) !== ay.raw) edits.push(argEdit(origin, 1, String(y)));
    }

    /**
     * Line -> block: ^FB width, lines, 0, L is added after ^A (or after the origin when the field has only data); the width is DEFAULT_BLOCK_CHARS
     * characters of the font and the lines are what the wrapped text needs, so the text keeps showing whole. Block -> line: ^FB goes (with its
     * line if it sat alone) and the "\&" breaks of the data become spaces. An ^FT field keeps its first line where it was (moveFt).
     */
    function kindEdits(text, found, item, value, opts) {
      const { field } = found;
      const fb = field.find('FB');
      const edits = [];
      const dpi = (opts && opts.dpi) || PB.config.resolutions[0];
      const dot = units.dotSize(dpi);
      if (value === 'block' && !fb) {
        const { advanceOf, wrapBlock } = PB.slices.text;
        const width = clamp(Math.round(DEFAULT_BLOCK_CHARS * (item.font.size / dot) * advanceOf(item.font) * item.font.scaleX), 1, MAX_FB);
        const lines = clamp(Math.max(1, wrapBlock(item.data, { width: width * dot, align: 'left' }, item.font).lines.length), 1, MAX_FB);
        const anchor = field.find('A') || field.find(['FO', 'FT']);
        const at = anchor ? anchor.end : field.cmds[0].start;
        edits.push({ start: at, end: at, value: `^FB${width},${lines},0,L` });
        moveFt(field, { ...item, dpi }, lines, 0, 1, edits);
      } else if (value === 'line' && fb) {
        flagEdits(text, field, { cmd: 'FB' }, false, edits);
        for (const data of field.findAll(['FD', 'FV'])) {
          const arg = data.args[0];
          if (arg && /\\&/.test(arg.raw)) edits.push({ start: arg.start, end: arg.end, value: arg.raw.replace(/\\&/g, ' ') });
        }
        const native = item.native && item.native.fb;
        const lines = native ? native.lines : item.block && item.block.lines ? item.block.lines : 1;
        moveFt(field, { ...item, dpi }, lines, native ? native.space : 0, -1, edits);
      }
      return edits.length ? edits : null;
    }

    /** The Tipo select over the whole field (the field has ^FB or not): custom, see js/languages/zpl-edit.js. A counter (^SN) stays a line: it does not print in a block. */
    const kindField = {
      key: 'kind', label: 'Tipo', type: 'select', custom: true, options: KIND_OPTIONS,
      model: item => (item.counter ? undefined : item.block ? 'block' : 'line'),
      read(text, found) {
        const data = found.field.find(['FD', 'FV', 'SN']);
        return data && data.name === 'SN' ? undefined : found.field.has('FB') ? 'block' : 'line';
      },
      edits: (text, found, item, value, opts) => (value === 'block' || value === 'line' ? kindEdits(text, found, item, value, opts) : null),
    };

    /** One ^FB number: raw '' is the guide's default `def`; written clamped to min..max. */
    const fbNumber = (key, label, index, def, min, max) => paramField({
      key, label, type: 'number', cmd: 'FB', arg: index, min, max, step: 1,
      read: raw => (raw === '' ? def : INTEGER.test(raw) ? Number(raw) : undefined),
      write: v => (typeof v === 'number' && Number.isFinite(v) ? String(clamp(Math.round(v), min, max)) : null),
      model: item => (item.native && item.native.fb ? item.native.fb[{ blockWidth: 'width', blockLines: 'lines', blockSpace: 'space' }[key]] : undefined),
    });
    const blockPanelFields = [
      fbNumber('blockWidth', 'Ancho del bloque (puntos)', 0, 0, 1, MAX_FB),
      fbNumber('blockLines', 'Líneas máx.', 1, 1, 1, MAX_FB),
      fbNumber('blockSpace', 'Interlineado (puntos)', 2, 0, -MAX_FB, MAX_FB),
      paramField({
        key: 'blockAlign', label: 'Alineación', type: 'select', cmd: 'FB', arg: 3, options: ALIGN_OPTIONS,
        read: raw => (raw === '' ? 'L' : ALIGN_OPTIONS.some(o => o.value === raw.toUpperCase()) ? raw.toUpperCase() : undefined),
        write: v => (ALIGN_OPTIONS.some(o => o.value === v) ? v : null),
        model: item => (item.native && item.native.fb ? item.native.fb.align : undefined),
      }),
    ];

    /** A text field's shape: with ^A or only data, with ^FB or not (the block has its own fields and the content label of its breaks). */
    const shapeOf = (withA, block) => ({
      applies: (item, field) => item.kind === 'text' && (field ? field.has('A') === withA && field.has('FB') === block : item.ref === (withA ? 'A' : 'FD') && Boolean(item.block) === block),
      fields: [
        kindField, ...(block ? blockPanelFields : []),
        ...(withA ? [fontField, sizeField('height', 'Alto (puntos, 0 = estándar)', 1), sizeField('width', 'Ancho (puntos, 0 = proporcional)', 2), rotationField] : []),
        block ? blockContentOf : contentOf, ...counterFields, reverse,
      ],
    });

    return {
      // emit(item, ctx) -> the field of a text item
      emit,
      // build(text, point, options) -> text with a new text field (palette)
      build,
      // Move: the field origin (^FO / ^FT), which is what the default coordinates are
      coordinates: [{ applies: item => item.kind === 'text' }],
      // Properties: the Tipo select first (line or block), the block fields (^FB), then a field with ^A (font, sizes, orientation), or with only data (default font)
      editable: [shapeOf(true, true), shapeOf(true, false), shapeOf(false, true), shapeOf(false, false)],
      handlers: [
        {
          // ^Afo,h,w ... ^FD data ^FS: a text field
          pattern: /^\^A$/,
          handle(m, cmd, ctx, field) {
            if (field.data) ctx.addItem(textItem(ctx, field, readA(ctx, cmd)));
          },
        },
        {
          // A field with only data (^FD / ^FV): text in the default font (^CF) and the default orientation (^FW)
          pattern: /^\^FD$/,
          handle(m, cmd, ctx, field) {
            if (!field.data) return;
            ctx.addItem(textItem(ctx, field, { ref: 'FD', name: ctx.font.name, h: null, w: null, rotation: rotationOf(ctx.orientation), fontArg: null, orientationArg: null }));
          },
        },
      ],
    };
  }

  PB.slices.text.zpl = zpl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
