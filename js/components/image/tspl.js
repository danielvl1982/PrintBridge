/**
 * Image slice, TSPL language (TSC TTP): BITMAP and the stored-image commands.
 *   BITMAP x,y,widthBytes,heightDots,mode,<binary>   (manual p.67-69)
 * The tokenizer (js/languages/tspl.js) reads the binary by length and hands it in cmd.data, one char per byte. Rows are
 * widthBytes bytes, MSB first (leftmost dot = bit 7). In TSPL bit 0 is black and bit 1 white; the neutral bitmap of the
 * image item (the one the TPCL SG graphic produces and the renderer draws) is 1 = black, so the bits are inverted.
 * Modes 1 (OR) and 2 (XOR) combine with what is already printed; items are independent in the model, so they are drawn
 * as mode 0 (overwrite) with one info per label.
 * PUTBMP / PUTPCX / PUTPNG print a file stored in the printer: it is not in the stream, so only a warning is given.
 * factory(helpers) -> { handlers }; registered by js/components/image/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.image = PB.slices.image || {};

  const { diagnostics: diag } = PB;

  /** Limits that keep a malformed header from allocating a huge bitmap. */
  const MAX_WIDTH_BYTES = 1250;
  const MAX_HEIGHT = 9999;

  function tspl(helpers) {
    const { sourceOf, int } = helpers;

    return {
      handlers: [
        {
          // BITMAP x,y,widthBytes,heightDots,mode,<binary>
          pattern: /^BITMAP\b/i,
          handle(m, cmd, ctx) {
            const [px, py, widthBytes, height, mode] = cmd.args.slice(0, 5).map(int);
            if (cmd.args.length < 5 || cmd.data === undefined || [px, py, widthBytes, height, mode].includes(null) ||
                widthBytes < 1 || height < 1 || ![0, 1, 2].includes(mode)) {
              ctx.report(diag.warning(`BITMAP con valores no válidos o sin datos: ${cmd.raw.slice(0, 40)}`));
              return;
            }
            if (widthBytes > MAX_WIDTH_BYTES || height > MAX_HEIGHT) {
              ctx.report(diag.warning(`BITMAP de ${widthBytes * 8}×${height} puntos supera el máximo admitido, no se dibuja`));
              return;
            }
            const w = widthBytes * 8;
            const expected = widthBytes * height;
            if (cmd.data.length < expected) {
              ctx.report(diag.warning(
                `BITMAP: datos incompletos (${cmd.data.length} de ${expected} bytes); el archivo puede haberse corrompido al leerlo como texto y quizá deba cargarse como binario. Se rellena con blanco`));
            }
            if (mode !== 0 && !ctx.tsplBitmapModeNoted) {
              ctx.tsplBitmapModeNoted = true;
              ctx.report(diag.info(`modo ${mode === 1 ? 'OR' : 'XOR'} de BITMAP no soportado, se dibuja como sobrescritura`));
            }
            const data = new Uint8Array(w * height);
            for (let row = 0; row < height; row++) {
              for (let col = 0; col < w; col++) {
                const index = row * widthBytes + (col >> 3);
                // Missing bytes count as white (bit 1); TSPL bit 0 = black -> neutral 1
                const byte = index < cmd.data.length ? cmd.data.charCodeAt(index) & 0xFF : 0xFF;
                data[row * w + col] = (byte >> (7 - (col & 7))) & 1 ? 0 : 1;
              }
            }
            const at = ctx.pos(px, py);
            ctx.addItem({
              kind: 'image', ref: 'BITMAP', source: sourceOf(cmd),
              x: at.x, y: at.y, width: Math.round(ctx.len(w)), height: Math.round(ctx.len(height)),
              bitmap: { w, h: height, data },
              native: { mode, widthBytes },
              data: null,
            });
          },
        },
        {
          // Images stored in the printer's memory: nothing in the stream to draw
          pattern: /^(PUTBMP|PUTPCX|PUTPNG)\b/i,
          handle(m, cmd, ctx) {
            const file = cmd.args[2] ? cmd.args[2].value : '?';
            ctx.report(diag.warning(`${m[1].toUpperCase()}: imagen almacenada en la impresora (${file}): no se puede dibujar`));
          },
        },
      ],
    };
  }

  PB.slices.image.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
