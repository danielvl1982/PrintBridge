/**
 * Image slice, TPCL language: the SG graphic command.
 *   SG;<x>[D],<y>[D],<width dots>,<height dots>,<e data mode>,<data>
 * The image has no build template (the app inserts it from a picture through PB.images.buildSG and the language's
 * insertCommand) and no editable fields. The hooks are built by a factory like every slice's:
 * factory(helpers) -> { handlers, coordinates } (see js/components/registry.js).
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.image = PB.slices.image || {};

  const { diagnostics: diag } = PB;

  // Printer limits of the SG command (js/components/image/codec.js, PB.images.SG_LIMITS): width 1..9999, height 1..99999, 512 KB of dot data
  const KB = 'ancho 1..9999 y alto 1..99999 puntos, como máximo 512 KB de imagen';

  function tpcl(helpers) {
    const { coordText, coordDigitsWarning } = helpers;
    const limits = PB.images.SG_LIMITS;

    /**
     * SG command of an image with a bitmap: x, y in 0.1 mm, width and height in dots, nibble data from the bitmap
     * (1 = black). Data rows are padded to a multiple of 8 dots with white, so the data holds ((w+7)>>3)*h*2 chars while
     * the command keeps the exact w and h: parsing it back drops the padding and gives the identical bitmap. Overlay
     * images without a bitmap (preview only) and bitmaps with inconsistent data or size are skipped with a warning.
     */
    function emit(item, ctx) {
      const bm = item.bitmap;
      if (!bm) {
        ctx.once('tpcl-image-overlay', () => diag.warning('Hay imágenes solo de vista previa (sin bitmap): no se pueden exportar a TPCL'));
        return [];
      }
      const valid = Number.isInteger(bm.w) && Number.isInteger(bm.h) && bm.w >= 1 && bm.h >= 1;
      if (!valid || !bm.data || bm.data.length !== bm.w * bm.h) {
        ctx.once('tpcl-image-invalid', () => diag.warning('Hay imágenes con un bitmap no válido (tamaño de al menos 1 punto y datos de w×h): no se exportan'));
        return [];
      }
      if (bm.w > limits.maxWidth || bm.h > limits.maxHeight || PB.images.sgBytes(bm.w, bm.h) > limits.maxBytes) {
        ctx.once('tpcl-image-size', () => diag.warning(`Hay imágenes que la impresora no admite (${KB}): no se exportan`));
        return [];
      }
      const [x, y] = [+coordText(ctx, item.x), +coordText(ctx, item.y)];
      return [PB.images.buildSGAt({ x, y, w: bm.w, h: bm.h, data: PB.images.bitmapToNibble(bm.data, bm.w, bm.h) })];
    }

    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [
        {
          // Graphic: SG;<x>[D],<y>[D],<width dots>,<height dots>,<e data mode>,<data>. x/y in 0.1 mm (dots with the D suffix).
          // Everything after the 5th comma is raw data up to the closing |}: nibble chars include ";" and ":" so it is never split.
          // Modes: e=0 overwrite, e=4 OR (both nibble data). Verified only against the B-SX4T manual: the {SG…|} framing is
          // inferred and NOT verified for B-EX4 or on a real printer (test the first print).
          pattern: /^SG;(\d+)(D?),(\d+)(D?),(\d+),(\d+),(\d+),([\s\S]*)$/,
          handle(m, cmd, ctx) {
            const ref = 'SG' + (ctx.model.items.filter(i => i.kind === 'image').length + 1);
            const [w, h, mode, data] = [+m[5], +m[6], +m[7], m[8]];
            const coords = coordDigitsWarning(ref, [['x', m[1]], ['y', m[3]]]);
            if (coords) ctx.report(coords);
            // Digits the manual fixes: width exactly 4, height 4 or 5 (B-SV4 6.3.21, B-452-R 6.3.22); the values are read as written
            if (!/^\d{4}$/.test(m[5])) ctx.report(diag.warning(`${ref}: ancho "${m[5]}" fuera del formato (4 dígitos, 0001..${limits.maxWidth} puntos): la impresora puede no aceptarlo`));
            if (!/^\d{4,5}$/.test(m[6])) ctx.report(diag.warning(`${ref}: alto "${m[6]}" fuera del formato (4 o 5 dígitos, 0001..${limits.maxHeight} puntos): la impresora puede no aceptarlo`));
            // Types of graphic data are 0..7 (SG;) or A (SG0;); the viewer draws 0 and 4 (nibble overwrite and OR)
            if (!/^[0-7]$/.test(m[7])) {
              ctx.report(diag.warning(`${ref}: modo de datos SG "${m[7]}" fuera de 0..7 (un dígito): la impresora puede no aceptarlo, no se dibuja`));
              return;
            }
            if (mode !== 0 && mode !== 4) {
              ctx.report(diag.warning(`${ref}: Modo de datos SG no soportado por el visor (e=${mode}), no se dibuja`));
              return;
            }
            if (w < 1 || h < 1) {
              ctx.report(diag.warning(`${ref}: tamaño ${w}×${h} puntos no válido (ancho 1..${limits.maxWidth}, alto 1..${limits.maxHeight}), no se dibuja`));
              return;
            }
            // Beyond the digits of the size fields; a larger value would also allocate and draw w*h dots on every edit
            if (w > limits.maxWidth || h > limits.maxHeight) {
              ctx.report(diag.warning(`${ref}: tamaño ${w}×${h} puntos supera el máximo (ancho ${limits.maxWidth}, alto ${limits.maxHeight}), no se dibuja`));
              return;
            }
            // The image buffer is 512 KB: the printer draws only what fits, so the viewer draws the rows that fit
            const rowsFit = Math.max(1, Math.floor(limits.maxBytes / PB.images.rowBytes(w)));
            const drawnH = Math.min(h, rowsFit);
            if (drawnH < h) {
              ctx.report(diag.warning(`${ref}: ${w}×${h} puntos superan el búfer de imagen de 512 KB: la impresora dibuja solo parte, se dibujan las ${drawnH} primeras filas`));
            }
            const expected = ((w + 7) >> 3) * h * 2;
            if (data.length !== expected) {
              ctx.report(diag.warning(`${ref}: ${data.length} caracteres de datos y se esperaban ${expected} para ${w}×${h} puntos`));
            }
            if (/[^\x30-\x3f]/.test(data)) {
              ctx.report(diag.warning(`${ref}: los datos tienen caracteres fuera de 30H..3FH (0..?): se dibujan como puntos en blanco`));
            }
            const position = (digits, dots) => (dots ? Math.round(+digits * ctx.dot) : +digits);
            ctx.model.items.push({
              kind: 'image', ref,
              source: { spans: [{ start: cmd.start, end: cmd.end }], label: `{SG;${m[1]}${m[2]},${m[3]}${m[4]},${m[5]},${m[6]},${m[7]},…|}` },
              x: position(m[1], m[2]), y: position(m[3], m[4]), raw: { x: m[1], y: m[3] },
              width: Math.round(w * ctx.dot), height: Math.round(drawnH * ctx.dot),
              bitmap: { w, h: drawnH, data: PB.images.nibbleToBitmap(data, w, drawnH) },
              native: { mode },
              data: null,
            });
          },
        },
      ],
      // emit(item, ctx) -> the SG command
      emit,
      // Coordinate fields moved by moveItem, as capture groups: [value group, D suffix group | null, axis]
      // (see COORDINATES in js/languages/tpcl.js)
      coordinates: [
        { pattern: /^\{SG;(\d+)(D?),(\d+)(D?),/d, fields: [[1, 2, 'x'], [3, 4, 'y']] },
      ],
    };
  }

  PB.slices.image.tpcl = tpcl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
