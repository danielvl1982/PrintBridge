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
 * Emit (the inverse): ^FT with the baseline origin, or ^FO when the item came from a ^FO field; a mono model font whose size and width are
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
   * means the last ^CF values when the font is the default one, else the standard matrix / the guide's 15 x 12; only one given makes the
   * other proportional (same magnification for the bitmapped fonts, same dots for the scalable one). dpi picks the matrix table.
   */
  function cellOf(name, h, w, cf, dpi) {
    let [height, width] = [positive(h), positive(w)];
    if (height === null && width === null && cf && cf.name === name) [height, width] = [positive(cf.height), positive(cf.width)];
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
      let origin;
      if (fromFo) {
        const off = baselineOffset(degrees, cell.height, lengthOf(item.data, cell.advance), name);
        origin = `^FO${Math.max(0, baseline.x - off.x)},${Math.max(0, baseline.y - off.y)}`;
      } else {
        origin = ft(ctx, item.x || 0, item.y || 0);
      }
      return `${origin}^A${name}${orientationOf(degrees)},${cell.height},${cell.width}${item.reverse ? '^FR' : ''}${dataCommands(ctx, item)}^FS`;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Parse

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
      const data = field.data.value;
      const off = o.kind === 'FT' ? { x: 0, y: 0 } : baselineOffset(spec.rotation, cell.height, lengthOf(data, cell.advance), spec.name);
      return {
        kind: 'text', ref: spec.ref, source: sourceOf(field),
        x: o.x + off.x * ctx.dot, y: o.y + off.y * ctx.dot,
        font: fontOf(spec.name, cell, ctx.dot),
        rotation: spec.rotation,
        data,
        ...(field.reverse && { reverse: true }),
        native: {
          font: spec.name, fontArg: spec.fontArg, orientationArg: spec.orientationArg, height: spec.h, width: spec.w,
          hMult: cell.hMult, wMult: cell.wMult, origin: o.kind, ...(field.labelReverse && { labelReverse: true }),
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
    /** Incremento and Ceros iniciales: the data command is ^FD or ^SN (see serialFields in js/languages/zpl-edit.js). */
    const counterFields = serialFields();

    return {
      // emit(item, ctx) -> the field of a text item
      emit,
      // build(text, point, options) -> text with a new text field (palette)
      build,
      // Move: the field origin (^FO / ^FT), which is what the default coordinates are
      coordinates: [{ applies: item => item.kind === 'text' }],
      // Properties: a field with ^A (font, sizes, orientation), or a field with only data (default font)
      editable: [
        {
          applies: (item, field) => item.kind === 'text' && (field ? field.has('A') : item.ref === 'A'),
          fields: [fontField, sizeField('height', 'Alto (puntos, 0 = estándar)', 1), sizeField('width', 'Ancho (puntos, 0 = proporcional)', 2), rotationField, contentOf, ...counterFields, reverse],
        },
        {
          applies: (item, field) => item.kind === 'text' && (field ? !field.has('A') : item.ref === 'FD'),
          fields: [contentOf, ...counterFields, reverse],
        },
      ],
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
