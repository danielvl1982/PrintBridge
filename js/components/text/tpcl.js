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

  function tpcl(helpers) {
    const {
      sourceOf, insertCommand, pad4, clampCoord, numberField, rotationField, nextId, freePlaceholder,
      ROTATIONS, ROTATION_STEPS, ROTATION_CODES, MAX_COORD,
    } = helpers;

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
