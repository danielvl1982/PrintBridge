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
 *   factory(helpers) -> { handlers, emit }. Registered by js/components/barcode/index.js as `languages: { tpcl, tspl }`.
 * Emit (the inverse): `emit(item, ctx)` writes a BARCODE command.
 *   - code128 -> "128"; a leading FNC1 only -> "EAN128" (FNC1 removed from the data); FNC1 elsewhere -> "128M" with !102
 *     at each FNC1 (the parser drops start codes, so none is written);
 *   - code39 -> "39", or "39C" for a mod43 check; itf -> "25" (a check digit cannot be represented: warning); ean13 -> "EAN13";
 *   - any other symbology has no TSPL type and is skipped with a warning (never guessed);
 *   - narrow = module in dots (min 1); wide = narrow for 128/EAN13, else narrow * the nearest manual ratio (1:2, 2:5, 1:3)
 *     of the item's widths (3:1 without widths); height in dots (min 1);
 *   - human readable: 1 (text below, left aligned) when shown, 0 otherwise. 1 rather than 2 (centered): the model keeps no
 *     alignment, and 1 is what the TSPL parser reads back as "shown" and what the shipped example uses.
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

  /** Wide/narrow ratios the manual allows for Code 39 and ITF (1:2, 2:5, 1:3), and the one used without explicit widths. */
  /** Largest height / wide bar (dots) and narrow bar offered in the properties panel. */
  const MAX_DOTS = 9999;
  const MAX_NARROW = 10;

  const RATIOS = Object.freeze([2, 2.5, 3]);
  const DEFAULT_RATIO = 3;

  /** Symbologies with a TSPL type. */
  const EMITTABLE = Object.freeze(['code128', 'code39', 'itf', 'ean13']);

  /** FNC1 in the manual mode of 128M. */
  const FNC1_MANUAL = '!102';

  /** The wide/narrow ratio closest to `ratio` among the manual ones. */
  const nearestRatio = ratio => RATIOS.reduce((best, r) => (Math.abs(r - ratio) < Math.abs(best - ratio) ? r : best), RATIOS[0]);

  function tspl(helpers) {
    const { sourceOf, num, ROTATIONS, quoted, exactDots, roundDots, toDots, safeData, numberField, selectField } = helpers;

    /** Rotation in degrees: the nearest quarter turn, with a warning once if the item was not on one. */
    function rotationDegrees(ctx, rotation) {
      const turns = Number.isFinite(rotation) ? Math.round(rotation / 90) : 0;
      const degrees = (((turns * 90) % 360) + 360) % 360;
      if (degrees !== rotation && !(rotation == null && degrees === 0)) {
        ctx.once('tspl-rotation', () => diag.warning('Hay elementos con una rotación que no es múltiplo de 90°: se ajustan al giro más cercano'));
      }
      return degrees;
    }

    /** TSPL type and content of a Code128 item: "128", "EAN128" (leading FNC1) or "128M" (FNC1 elsewhere, as !102). */
    function code128Of(ctx, data) {
      const parts = data.split(barcodeData.FNC1);
      if (parts.length === 1) return { type: '128', data };
      if (parts.length === 2 && parts[0] === '') return { type: 'EAN128', data: parts[1] };
      if (parts.some(p => /!\d{3}/.test(p))) {
        ctx.once('tspl-128m-literal', () => diag.warning('Hay códigos Code128 con FNC1 y texto "!nnn", que 128M lee como código de control: no se puede escribir literalmente'));
      }
      return { type: '128M', data: parts.join(FNC1_MANUAL) };
    }

    /** TSPL type of a Code39 / ITF / EAN13 item (warns once when the check digit or the data cannot be written). */
    function typeOf(ctx, item) {
      const { symbology, check } = item;
      if (symbology === 'code39') {
        if (check === 'mod43') return '39C';
        if (check && check !== 'none') ctx.once('tspl-check-code39', () => diag.warning(`Código de barras code39: dígito de control "${check}" sin equivalente en TSPL, se escribe sin dígito de control`));
        return '39';
      }
      if (symbology === 'itf') {
        if (check && check !== 'none') ctx.once('tspl-check-itf', () => diag.warning(`Código de barras itf: dígito de control "${check}" no se puede representar en TSPL, se escribe sin dígito de control`));
        return '25';
      }
      if (!/^\d{12,13}$/.test(String(item.data ?? ''))) {
        ctx.once('tspl-ean13-digits', () => diag.warning('Hay códigos EAN13 cuyos datos no son 12 o 13 dígitos: la impresora puede rechazarlos'));
      }
      return 'EAN13';
    }

    /**
     * BARCODE x,y,"type",height,human readable,rotation,narrow,wide,"content" (see the header comment for the mapping).
     * Only neutral fields are read: native (e.g. the source type) is ignored.
     */
    function emit(item, ctx) {
      if (!EMITTABLE.includes(item.symbology)) {
        ctx.report(diag.warning(`Código de barras ${item.symbology}: sin equivalente en TSPL, no se exporta`));
        return [];
      }
      let type;
      let data = safeData(ctx, item.data);
      if (item.symbology === 'code128') ({ type, data } = code128Of(ctx, data));
      else type = typeOf(ctx, item);

      const narrow = Math.max(1, toDots(ctx, item.module));
      let wide = narrow;
      if (item.symbology === 'code39' || item.symbology === 'itf') {
        const w = item.widths;
        const explicit = w && w.narrowBar > 0 && Number.isFinite(w.wideBar);
        if (!explicit) ctx.once('tspl-ratio', () => diag.info(`Código de barras sin anchos explícitos: se escriben con relación ${DEFAULT_RATIO}:1 a partir del módulo`));
        wide = roundDots(narrow * nearestRatio(explicit ? w.wideBar / w.narrowBar : DEFAULT_RATIO));
      }
      const [x, y] = [roundDots(exactDots(ctx, item.x || 0)), roundDots(exactDots(ctx, item.y || 0))];
      const height = Math.max(1, toDots(ctx, item.height));
      const readable = item.humanReadable ? 1 : 0;
      return `BARCODE ${x},${y},"${type}",${height},${readable},${rotationDegrees(ctx, item.rotation)},${narrow},${wide},${quoted(data)}`;
    }

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

    const dots = (dpi, v) => (Number.isFinite(v) ? Math.round(v / PB.units.dotSize(dpi)) : undefined);

    /** Properties of BARCODE (content and type untouched). The wide bar only matters for the wide/narrow symbologies. */
    const barcodeFields = wideNarrow => [
      numberField('height', 'Alto (puntos)', 3, 1, MAX_DOTS, (item, { dpi }) => dots(dpi, item.height)),
      selectField('readable', 'Texto legible', 4, [
        { value: 0, label: 'No' }, { value: 1, label: 'Izquierda' }, { value: 2, label: 'Centro' }, { value: 3, label: 'Derecha' },
      ], item => (item.native ? item.native.humanReadable : undefined)),
      selectField('rotation', 'Rotación', 5, [0, 90, 180, 270], item => item.rotation),
      numberField('narrow', 'Barra estrecha (puntos)', 6, 1, MAX_NARROW, item => item.native && item.native.module),
      ...(wideNarrow ? [numberField('wide', 'Barra ancha (puntos)', 7, 1, MAX_DOTS, item => item.native && item.native.wide)] : []),
    ];
    const isBarcode = (item, cmd) => (cmd ? cmd.name === 'BARCODE' : item.ref === 'BARCODE');
    const isWideNarrow = (item, cmd) => {
      const type = cmd ? cmd.args[2] && cmd.args[2].value : item.native && item.native.type;
      const known = TYPES[String(type).toUpperCase().replace(ADD_ON, '$1')];
      return !!known && (known.symbology === 'code39' || known.symbology === 'itf');
    };

    return {
      // emit(item, ctx) -> the BARCODE command of a barcode item
      emit,
      // Move: BARCODE x,y are arguments 0 and 1 (dots)
      coordinates: [{ applies: (item, cmd) => !cmd || cmd.name === 'BARCODE', fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] }],
      editable: [
        { applies: (item, cmd) => isBarcode(item, cmd) && isWideNarrow(item, cmd), fields: barcodeFields(true) },
        { applies: isBarcode, fields: barcodeFields(false) },
      ],
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
