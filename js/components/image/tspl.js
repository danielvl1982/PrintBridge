/**
 * Image slice, TSPL language (TSC TTP): BITMAP and the stored-image commands.
 *   BITMAP x,y,widthBytes,heightDots,mode,<binary>   (manual p.67-69)
 * The tokenizer (js/languages/tspl.js) reads the binary by length and hands it in cmd.data, one char per byte. Rows are
 * widthBytes bytes, MSB first (leftmost dot = bit 7). In TSPL bit 0 is black and bit 1 white; the neutral bitmap of the
 * image item (the one the TPCL SG graphic produces and the renderer draws) is 1 = black, so the bits are inverted.
 * Modes 1 (OR) and 2 (XOR) combine with what is already printed; items are independent in the model, so they are drawn
 * as mode 0 (overwrite) with one info per label.
 * PUTBMP / PUTPCX / PUTPNG print a file stored in the printer: it is not in the stream, so only a warning is given.
 * Emit (the inverse): `emit(item, ctx)` writes BITMAP x,y,widthBytes,height,0,<payload> followed by the line break. The
 * payload is a JS string with one char (0..255) per byte, so the emitted TEXT holds raw bytes: it must be saved with a
 * byte-preserving encoding (latin1), never UTF-8 (the UI export of T7 takes care of it). The parser reads the payload by
 * length, so CR/LF/quote/comma bytes inside it are safe. Rows are ceil(w/8) bytes with white (1) padding bits, so a bitmap
 * whose width is not a multiple of 8 re-parses as widthBytes*8 dots wide, the extra columns white.
 * factory(helpers) -> { handlers, emit }; registered by js/components/image/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.image = PB.slices.image || {};

  const { diagnostics: diag } = PB;

  /** Limits that keep a malformed header from allocating a huge bitmap. */
  const MAX_WIDTH_BYTES = 1250;
  const MAX_HEIGHT = 9999;

  /** Bytes per row of a bitmap w dots wide. */
  const widthBytes = w => Math.ceil(w / 8);

  /** Neutral bitmap (1 = black) -> TSPL bytes: inverted (0 = black), MSB first, padding bits white. */
  function encodeBitmap({ w, h, data }) {
    const rowBytes = widthBytes(w);
    const out = new Uint8Array(rowBytes * h).fill(0xFF);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (data[row * w + col]) out[row * rowBytes + (col >> 3)] &= ~(0x80 >> (col & 7));
      }
    }
    return out;
  }

  function tspl(helpers) {
    const { sourceOf, int, exactDots, roundDots } = helpers;

    /** BITMAP command of an image with a bitmap; overlay images (no bitmap) and invalid bitmaps are skipped with a warning. */
    function emit(item, ctx) {
      const bm = item.bitmap;
      if (!bm) {
        ctx.once('tspl-image-overlay', () => diag.warning('Hay imágenes solo de vista previa (sin bitmap): no se pueden exportar a TSPL'));
        return [];
      }
      const valid = Number.isInteger(bm.w) && Number.isInteger(bm.h) && bm.w > 0 && bm.h > 0 && bm.data && bm.data.length === bm.w * bm.h;
      if (!valid) {
        ctx.once('tspl-image-invalid', () => diag.warning('Hay imágenes con un bitmap no válido (tamaño positivo y datos de w×h): no se exportan'));
        return [];
      }
      if (widthBytes(bm.w) > MAX_WIDTH_BYTES || bm.h > MAX_HEIGHT) {
        ctx.once('tspl-image-size', () => diag.warning(`Hay imágenes que superan el máximo de BITMAP (${MAX_WIDTH_BYTES * 8}×${MAX_HEIGHT} puntos): no se exportan`));
        return [];
      }
      const [x, y] = [roundDots(exactDots(ctx, item.x || 0)), roundDots(exactDots(ctx, item.y || 0))];
      const bytes = encodeBitmap(bm);
      let payload = '';
      // Chunked: spreading a whole bitmap into fromCharCode would overflow the call stack
      for (let i = 0; i < bytes.length; i += 8192) payload += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return [`BITMAP ${x},${y},${widthBytes(bm.w)},${bm.h},0,${payload}`];
    }

    return {
      // emit(item, ctx) -> the BITMAP command of an image item
      emit,
      // Move: BITMAP x,y are arguments 0 and 1 (dots); only the header changes, the payload bytes are never touched
      coordinates: [{ applies: (item, cmd) => !cmd || cmd.name === 'BITMAP', fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] }],
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

  // The encoder is exposed for the tests
  tspl.encodeBitmap = encodeBitmap;
  tspl.widthBytes = widthBytes;
  PB.slices.image.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
