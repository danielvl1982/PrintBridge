/**
 * Text slice, TPCL language: everything the PC (bitmap font) and PV (outline font) commands need, plus the RV data
 * command's palette template.
 *   PCnn;x,y,<h magnification>,<v magnification>,<font>,[±adj,]<rotation>,<attribute>[=text]
 *   PVnn;x,y,<width>,<height>,<font>,[±adj,]<rotation>,<attribute>[=text]
 * The hooks are built by a factory because they need the shared helpers of js/languages/tpcl.js, which loads after
 * this file: factory(helpers) -> { handlers, build, coordinates, editable } (see js/components/registry.js).
 * The RC/RV data handler is shared with the barcode and QR kinds and stays in js/languages/tpcl.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.text = PB.slices.text || {};

  const { units, diagnostics: diag } = PB;

  /** TPCL magnification: "08" -> 0.8 ; "14" -> 1.4 ; "1" -> 1. */
  const magnification = s => (s.length >= 2 ? Number(s) / 10 : Number(s));

  /**
   * TEC bitmap fonts of the PC command: size in points, family, weight and style they are simulated with.
   * The family (serif/sans/mono) is the "font-…" class of css/label.css.
   */
  const BITMAP_FONTS = Object.freeze({
    A: [8, 'serif', 400], B: [10, 'serif', 400], C: [10, 'serif', 700], D: [12, 'serif', 700], E: [14, 'serif', 700],
    F: [12, 'serif', 400, 'italic'], G: [6, 'sans', 400], H: [10, 'sans', 400], I: [12, 'sans', 400], J: [12, 'sans', 700],
    K: [14, 'sans', 700], L: [12, 'sans', 400, 'italic'], M: [18, 'sans', 700], N: [9.5, 'mono', 400], O: [7, 'mono', 400],
    P: [10, 'mono', 700], Q: [10, 'mono', 400], R: [12, 'mono', 700], S: [12, 'mono', 400], T: [12, 'mono', 400],
  });
  const DEFAULT_BITMAP_FONT = 'J';

  /** Outline font (PV command): always simulated with this family and weight. */
  const OUTLINE_FONT = Object.freeze({ family: 'sans', weight: 700 });

  // Options common to PC and PV after the font type: [spacing adjustment,]rotation,attribute[,…][=text]
  const TEXT_TAIL = String.raw`([A-Za-z0-9]),(?:[+-]\d+,)?(\d{2}),([BWF])[^=]*(?:=([\s\S]*))?$`;

  /** Format options of a freshly inserted PV command; {rot2} is the 2-digit rotation code. */
  const VARIABLE = Object.freeze({ format: 'PV', data: 'RV', name: 'TEXTO', tail: '0060,0080,B,{rot2},B' });

  /** How far (in 0.1 magnification steps) a model font may be from an exact PC font + magnifications to still be a PC. */
  const MAGNIFICATION_TOLERANCE = 0.05;

  /** Fallback outline size (0.1 mm) for a text whose font has no usable size. */
  const DEFAULT_OUTLINE_SIZE = 80;

  /**
   * PC font that draws a model font exactly: the entry of BITMAP_FONTS with the same family, weight and style whose
   * magnifications (steps of 0.1, 1..99) reproduce its size and scaleX within MAGNIFICATION_TOLERANCE. Several fit:
   * the one with the vertical magnification closest to 1. Null when none (the text becomes an outline PV).
   */
  function bitmapChoice(font) {
    let best = null;
    for (const [letter, [points, family, weight, style = 'normal']] of Object.entries(BITMAP_FONTS)) {
      if (family !== font.family || weight !== font.weight || style !== (font.style || 'normal')) continue;
      const v = (font.size / (points * units.UNITS_PER_POINT)) * 10;
      const h = v * font.scaleX;
      const [vi, hi] = [Math.round(v), Math.round(h)];
      if (vi < 1 || vi > 99 || hi < 1 || hi > 99) continue;
      if (Math.abs(v - vi) > MAGNIFICATION_TOLERANCE || Math.abs(h - hi) > MAGNIFICATION_TOLERANCE) continue;
      const distance = Math.abs(vi - 10);
      if (!best || distance < best.distance) best = { letter, h: hi, v: vi, distance };
    }
    return best;
  }

  function tpcl(helpers) {
    const {
      sourceOf, insertCommand, pad4, clampCoord, numberField, rotationField, nextId, freePlaceholder,
      ROTATIONS, ROTATION_STEPS, ROTATION_CODES, MAX_COORD, wrap, safeData, coordText, allocId,
    } = helpers;

    /** Text rotation code (00/11/22/33): the nearest quarter turn, with a warning once if the item was not on one. */
    function rotationCode(ctx, rotation) {
      const turns = Number.isFinite(rotation) ? Math.round(rotation / 90) : 0;
      const degrees = (((turns * 90) % 360) + 360) % 360;
      if (degrees !== rotation && !(rotation == null && degrees === 0)) {
        ctx.once('tpcl-rotation', () => diag.warning('Hay textos con una rotación que no es múltiplo de 90°: se ajustan al giro más cercano'));
      }
      return ROTATION_CODES[degrees];
    }

    /**
     * PC (bitmap font) when the model font matches BITMAP_FONTS, else PV (outline font: width = size * scaleX, height =
     * size, font letter B like the palette template), each followed by its RC / RV data command (empty without data).
     */
    function emit(item, ctx) {
      const font = item.font || {};
      const size = Number.isFinite(font.size) && font.size > 0 ? font.size : DEFAULT_OUTLINE_SIZE;
      const scaleX = Number.isFinite(font.scaleX) && font.scaleX > 0 ? font.scaleX : 1;
      const [x, y] = [coordText(ctx, item.x), coordText(ctx, item.y)];
      const rot = rotationCode(ctx, item.rotation);
      const data = safeData(ctx, item.data);
      const choice = bitmapChoice({ ...font, size, scaleX });
      if (choice) {
        const id = allocId(ctx, 'PC');
        const mag = n => String(n).padStart(2, '0');
        return [wrap(`PC${id};${x},${y},${mag(choice.h)},${mag(choice.v)},${choice.letter},${rot},B`), wrap(`RC${id};${data}`)];
      }
      // The outline font is always drawn sans bold: any other family, weight or style is lost
      if ((font.family || OUTLINE_FONT.family) !== OUTLINE_FONT.family || (font.weight == null ? OUTLINE_FONT.weight : font.weight) !== OUTLINE_FONT.weight || (font.style || 'normal') !== 'normal') {
        ctx.once('tpcl-fonts', () => diag.info('Las fuentes TPCL no coinciden con las de origen (familia, peso o cursiva): los textos sin fuente de mapa de bits equivalente se escriben con la fuente vectorial (PV)'));
      }
      const id = allocId(ctx, 'PV');
      const dim = n => pad4(Math.max(1, clampCoord(n)));
      return [wrap(`PV${id};${x},${y},${dim(size * scaleX)},${dim(size)},B,${rot},B`), wrap(`RV${id};${data}`)];
    }

    function textAttributes(ctx, ref, rotationCode, attribute) {
      if (!(rotationCode in ROTATIONS)) ctx.report(diag.warning(`${ref}: rotación "${rotationCode}" desconocida, se dibuja sin rotar`));
      if (attribute !== 'B') ctx.report(diag.warning(`${ref}: atributo "${attribute}" no soportado por el visor, se dibuja en negro`));
      return ROTATIONS[rotationCode] ?? 0;
    }

    function bitmapFont(ctx, ref, code, hMag, vMag) {
      let spec = BITMAP_FONTS[code];
      if (!spec) {
        ctx.report(diag.warning(`${ref}: fuente "${code}" desconocida, se dibuja como ${DEFAULT_BITMAP_FONT}`));
        spec = BITMAP_FONTS[DEFAULT_BITMAP_FONT];
      }
      const [points, family, weight, style = 'normal'] = spec;
      const v = magnification(vMag);
      return { size: points * units.UNITS_PER_POINT * v, scaleX: magnification(hMag) / v, family, weight, style };
    }

    /**
     * Adds a PV format command plus its RV data command with a unique <#TEXTO{k}#> variable, rotated
     * (360 - options.viewRotation) % 360 to look upright in the view (missing/invalid = 0).
     */
    function build(text, point, options) {
      const { format, data, name } = VARIABLE;
      // Rotated items extend from the anchor in the rotated direction, so near the label edges they can leave the label:
      // only the coordinate clamp applies, the item is not shifted to fit.
      const view = options && ROTATION_STEPS.includes(options.viewRotation) ? options.viewRotation : 0;
      const itemRotation = (360 - view) % 360; // clockwise, so that item + view = 0 (upright)
      const tail = VARIABLE.tail.replace('{rot2}', ROTATION_CODES[itemRotation]);
      const id = nextId(text, format, data);
      const placeholder = freePlaceholder(text, name);
      const withFormat = insertCommand(text, `{${format}${id};${pad4(clampCoord(point.x))},${pad4(clampCoord(point.y))},${tail}|}`);
      return insertCommand(withFormat, `{${data}${id};${placeholder}|}`);
    }

    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [
        {
          // Text with a bitmap font
          pattern: new RegExp(String.raw`^PC(\d+);(\d+),(\d+),(\d+),(\d+),` + TEXT_TAIL),
          handle(m, cmd, ctx) {
            const ref = 'PC' + m[1];
            ctx.addField(ref, {
              kind: 'text', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
              font: bitmapFont(ctx, ref, m[6].toUpperCase(), m[4], m[5]),
              rotation: textAttributes(ctx, ref, m[7], m[8]),
              data: m[9] ?? null,
            });
          },
        },
        {
          // Text with an outline font: character width and height in 0.1 mm
          pattern: new RegExp(String.raw`^PV(\d+);(\d+),(\d+),(\d+),(\d+),` + TEXT_TAIL),
          handle(m, cmd, ctx) {
            const ref = 'PV' + m[1];
            const { family, weight } = OUTLINE_FONT;
            ctx.addField(ref, {
              kind: 'text', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
              font: { size: +m[5], scaleX: +m[4] / +m[5], family, weight, style: 'normal' },
              rotation: textAttributes(ctx, ref, m[7], m[8]),
              data: m[9] ?? null,
            });
          },
        },
      ],
      // build(text, point, options) -> text with the new component
      build,
      // emit(item, ctx) -> the PC/PV command and its RC/RV data command
      emit,
      // Coordinate fields moved by moveItem (see COORDINATES in js/languages/tpcl.js)
      coordinates: [
        { pattern: /^\{(?:PC|PV)\d+;(\d+),(\d+)/d, fields: [[1, null, 'x'], [2, null, 'y']] },
      ],
      // Editable shapes for describeItem / updateItem (see EDITABLE in js/languages/tpcl.js)
      editable: [
        { // Outline text: PVnn;x,y,<width>,<height>,<font>,[±adj,]<rotation>,<attribute>
          applies: item => item.kind === 'text' && /^PV/.test(item.ref),
          pattern: /^\{PV\d+;\d+,\d+,(\d+),(\d+),[A-Za-z0-9],(?:[+-]\d+,)?(\d{2}),[BWF]/d,
          fields: [
            numberField('width', 'Ancho (0,1 mm)', 1, 1, MAX_COORD, item => Math.round(item.font.size * item.font.scaleX)),
            numberField('height', 'Alto (0,1 mm)', 2, 1, MAX_COORD, item => item.font.size),
            rotationField(3),
          ],
        },
        { // Bitmap text: PCnn;x,y,<h magnification>,<v magnification>,<font>,[±adj,]<rotation>,<attribute> (steps of 0.1)
          applies: item => item.kind === 'text' && /^PC/.test(item.ref),
          pattern: /^\{PC\d+;\d+,\d+,(\d+),(\d+),[A-Za-z0-9],(?:[+-]\d+,)?(\d{2}),[BWF]/d,
          fields: [
            numberField('hMag', 'Ampliación horizontal (×0,1)', 1, 1, 99),
            numberField('vMag', 'Ampliación vertical (×0,1)', 2, 1, 99),
            rotationField(3),
          ],
        },
      ],
    };
  }

  PB.slices.text.tpcl = tpcl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
