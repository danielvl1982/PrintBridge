/**
 * Barcode slice, TSPL language (TSC TTP): the BARCODE command.
 *   BARCODE x,y,"type",height,human readable,rotation,narrow,wide,[alignment,]"content"
 * It becomes the neutral `barcode` item (see js/core/model.js) so the renderer and validator of this slice need no change:
 *   - the alignment argument is present when the command has 10 arguments (count based);
 *   - height and narrow are dots: height = height dots, module = narrow dots, in 0.1 mm; for Code 39 / ITF the neutral
 *     widths come from narrow and wide (both in dots);
 *   - human readable 0 = none, 1/2/3 (left/center/right) = shown (the alignment is kept in native.align);
 *   - type 128, 128M (manual mode: !102 = FNC1, !103/!104/!105 start codes dropped), EAN128 (leading FNC1), 39/39C/39S,
 *     25/25C/ITF14/EAN14 and EAN13 have a neutral symbology; every other type is 'unknown' (drawn approximately, the
 *     validator of the slice warns) and keeps its TSPL type in native.type.
 * The factory receives the helpers of js/languages/tspl.js (SLICE_HELPERS), which loads after this file:
 *   factory(helpers) -> { handlers }. Registered by js/components/barcode/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  const { diagnostics: diag, barcodeData } = PB;

  /** Neutral symbology and check option of each TSPL type (the types not listed are 'unknown'). */
  const TYPES = Object.freeze({
    '128': { symbology: 'code128' },
    '128M': { symbology: 'code128' },
    'EAN128': { symbology: 'code128' },
    '39': { symbology: 'code39', check: 'none' },
    '39C': { symbology: 'code39', check: 'mod43' },
    '39S': { symbology: 'code39', check: 'none' },
    '25': { symbology: 'itf', check: 'none' },
    '25C': { symbology: 'itf', check: 'unsupported' },
    'ITF14': { symbology: 'itf', check: 'none' },
    'EAN14': { symbology: 'itf', check: 'none' },
    'EAN13': { symbology: 'ean13' },
  });

  /** Add-on variants (EAN13+2, UPCE+5...): the base type decides the symbology; the add-on is not drawn. */
  const ADD_ON = /^(.+)\+[25]$/;

  /** Counter/variable content: "@1", "x"+@1+"y". */
  const COUNTER = /(?:^|\+)\s*@\d+/;

  /** Manual-mode control code of Code128 in the 128M content: !102 (FNC1), !103/!104/!105 (start A/B/C). */
  const CONTROL_CODE = /!(\d{3})/g;
  const START_CODES = Object.freeze(['103', '104', '105']);

  function tspl(helpers) {
    const { sourceOf, num, ROTATIONS } = helpers;

    function contentOf(ctx, arg) {
      if (COUNTER.test(arg.raw)) {
        if (!ctx.tsplCounterNoted) {
          ctx.tsplCounterNoted = true;
          ctx.report(diag.info('BARCODE: contador o variable (@n) sin evaluar, se dibuja como texto literal'));
        }
        return arg.raw;
      }
      return arg.value;
    }

    /** 128M content: start codes dropped, !102 -> FNC1, any other !nnn dropped with an info. */
    function manualModeData(ctx, data) {
      const dropped = new Set();
      const text = data.replace(CONTROL_CODE, (all, code) => {
        if (code === '102') return barcodeData.FNC1;
        if (!START_CODES.includes(code)) dropped.add(code);
        return '';
      });
      if (dropped.size) ctx.report(diag.info(`BARCODE: códigos de control 128M no soportados por el visor (${[...dropped].map(c => '!' + c).join(', ')}), se omiten`));
      return text;
    }

    return {
      handlers: [
        {
          // BARCODE x,y,"type",height,human readable,rotation,narrow,wide,[alignment,]"content"
          pattern: /^BARCODE\b/i,
          handle(m, cmd, ctx) {
            const ref = 'BARCODE';
            if (cmd.args.length < 9) { ctx.report(diag.warning(`BARCODE incompleto: ${cmd.raw.slice(0, 40)}`)); return; }
            const [px, py, height] = [num(cmd.args[0]), num(cmd.args[1]), num(cmd.args[3])];
            if (px === null || py === null) { ctx.report(diag.warning(`BARCODE con coordenadas no válidas: ${cmd.raw.slice(0, 40)}`)); return; }
            if (height === null || height <= 0) { ctx.report(diag.warning(`BARCODE con altura no válida: ${cmd.raw.slice(0, 40)}`)); return; }
            const hasAlign = cmd.args.length >= 10;
            const type = cmd.args[2].value;
            const typeKey = type.toUpperCase();
            const addOn = ADD_ON.exec(typeKey);
            const known = TYPES[addOn ? addOn[1] : typeKey] || { symbology: 'unknown' };
            if (addOn && known.symbology !== 'unknown') ctx.report(diag.info(`${ref}: el complemento "+${typeKey.slice(-1)}" no se dibuja`));

            const readable = num(cmd.args[4]);
            const rotation = num(cmd.args[5]);
            if (rotation === null || !ROTATIONS.includes(rotation)) {
              ctx.report(diag.warning(`${ref}: rotación "${cmd.args[5].value}" no válida, se dibuja sin rotar`));
            }
            const narrowValue = num(cmd.args[6]);
            const narrow = narrowValue !== null && narrowValue > 0 ? narrowValue : 2;
            if (narrow !== narrowValue) ctx.report(diag.warning(`${ref}: ancho estrecho "${cmd.args[6].value}" no válido, se usa 2 puntos`));
            const wide = num(cmd.args[7]);

            let data = contentOf(ctx, cmd.args[hasAlign ? 9 : 8]);
            if (typeKey === '128M') data = manualModeData(ctx, data);
            if (typeKey === 'EAN128') data = barcodeData.FNC1 + data;

            const { x, y } = ctx.pos(px, py);
            const wideNarrow = known.symbology === 'code39' || known.symbology === 'itf';
            const dotWide = (wide !== null && wide > 0 ? wide : narrow * 3) * ctx.dot;
            const item = {
              kind: 'barcode', ref, source: sourceOf(cmd), x, y, raw: { x: String(px), y: String(py) },
              symbology: known.symbology, module: narrow * ctx.dot, rotation: ROTATIONS.includes(rotation) ? rotation : 0,
              height: height * ctx.dot,
              ...(wideNarrow && {
                widths: { narrowBar: narrow * ctx.dot, narrowSpace: narrow * ctx.dot, wideBar: dotWide, wideSpace: dotWide },
                interCharGap: narrow * ctx.dot,
              }),
              ...(known.check && { check: known.check }),
              native: { type, module: narrow, wide },
              humanReadable: readable !== null && readable >= 1 && readable <= 3,
              data,
            };
            if (hasAlign) item.native.align = num(cmd.args[8]);
            if (readable !== null) item.native.humanReadable = readable;
            ctx.addItem(item);
          },
        },
      ],
    };
  }

  PB.slices.barcode.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
