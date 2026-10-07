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

  function tpcl() {
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
            if (mode !== 0 && mode !== 4) {
              ctx.report(diag.warning(`${ref}: Modo de datos SG no soportado por el visor (e=${mode}), no se dibuja`));
              return;
            }
            if (w < 1 || h < 1) {
              ctx.report(diag.warning(`${ref}: tamaño ${w}×${h} puntos no válido, no se dibuja`));
              return;
            }
            // The command's size fields have 4 digits; a larger value would allocate and draw w*h dots on every edit
            if (w > 9999 || h > 9999) {
              ctx.report(diag.warning(`${ref}: tamaño ${w}×${h} puntos supera el máximo de 9999, no se dibuja`));
              return;
            }
            const expected = ((w + 7) >> 3) * h * 2;
            if (data.length !== expected) {
              ctx.report(diag.warning(`${ref}: ${data.length} caracteres de datos y se esperaban ${expected} para ${w}×${h} puntos`));
            }
            const position = (digits, dots) => (dots ? Math.round(+digits * ctx.dot) : +digits);
            ctx.model.items.push({
              kind: 'image', ref,
              source: { spans: [{ start: cmd.start, end: cmd.end }], label: `{SG;${m[1]}${m[2]},${m[3]}${m[4]},${m[5]},${m[6]},${m[7]},…|}` },
              x: position(m[1], m[2]), y: position(m[3], m[4]), raw: { x: m[1], y: m[3] },
              width: Math.round(w * ctx.dot), height: Math.round(h * ctx.dot),
              bitmap: { w, h, data: PB.images.nibbleToBitmap(data, w, h) },
              native: { mode },
              data: null,
            });
          },
        },
      ],
      // Coordinate fields moved by moveItem, as capture groups: [value group, D suffix group | null, axis]
      // (see COORDINATES in js/languages/tpcl.js)
      coordinates: [
        { pattern: /^\{SG;(\d+)(D?),(\d+)(D?),/d, fields: [[1, 2, 'x'], [3, 4, 'y']] },
      ],
    };
  }

  PB.slices.image.tpcl = tpcl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
