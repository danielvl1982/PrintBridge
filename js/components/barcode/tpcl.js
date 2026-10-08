/**
 * Barcode slice, TPCL language: everything the 1D barcode XB commands need (Code 39 / ITF with explicit bar widths and the
 * alternative form with a module), plus the RB data command's palette template.
 *   Code 39 / ITF: XBnn;x,y,<type>,<e check digit>,<ff narrow bar>,<gg narrow space>,<hh wide bar>,<ii wide space>,
 *     <jj inter-character space>,<k rotation>,<llll height 0.1 mm>,<p human readable>[,<qq zero suppression>][,<r T|P|N start/stop>]
 *   1D barcode: XBnn;x,y,<type>,<check digit>,<module>,<rotation>,<height>,<increment>,<000>,<human readable text>,<00>
 * The hooks are built by a factory because they need the shared helpers of js/languages/tpcl.js, which loads after
 * this file: factory(helpers) -> { handlers, build, coordinates, editable } (see js/components/registry.js).
 * The RB data handler is shared with the other kinds and stays in js/languages/tpcl.js; the XB QR command is the qr slice's.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  const { diagnostics: diag, barcodeData } = PB;

  /** Neutral symbology of each TPCL barcode type (the other types are 'unknown'). */
  const SYMBOLOGIES = Object.freeze({ 2: 'itf', 3: 'code39', B: 'code39', 9: 'code128', A: 'code128', T: 'qr' });
  const symbologyOf = type => SYMBOLOGIES[type] || 'unknown';

  /** Check digit option (field e of Code 39 / ITF) -> neutral check; the options not listed are 'unsupported'. */
  const CHECK_OPTIONS = Object.freeze({ code39: { 1: 'none', 3: 'mod43' }, itf: { 1: 'none' } });

  /** TPCL barcode type of each emittable neutral symbology (the inverse of SYMBOLOGIES). */
  const TYPE_CODES = Object.freeze({ itf: '2', code39: '3', code128: '9' });

  /** Check digit option (field e) of each neutral check: the inverse of CHECK_OPTIONS, per wide/narrow symbology. */
  const CHECK_CODES = Object.freeze({ code39: { none: '1', mod43: '3' }, itf: { none: '1' } });

  /** Code 39 / ITF without explicit widths: wide elements are this many narrow ones (the renderer's default ratio). */
  const DEFAULT_RATIO = 3;

  /** TPCL notation of FNC1 in the data of a barcode. */
  const FNC1_NOTATION = '>8';

  /** Largest value of the 2-digit dot fields (module, bar and space widths). */
  const MAX_DOTS = 99;

  /** Format options of a freshly inserted Code128 barcode; {rot1} is the 1-digit rotation code. */
  const VARIABLE = Object.freeze({ format: 'XB', data: 'RB', name: 'CODIGOBARRAS', tail: '9,1,02,{rot1},0080,+0000000000,000,0,00' });

  function tpcl(helpers) {
    const {
      sourceOf, insertCommand, pad4, clampCoord, numberField, rotationField, nextId, freePlaceholder,
      ROTATIONS, ROTATION_STEPS, MAX_COORD, DIGITS, wrap, safeData, coordText, allocId,
      COUNTER_TOKEN, COUNTER_MAX, ZERO_MAX, counterToken, zeroDigits, readCounterStep, counterFields,
    } = helpers;

    const clampInt = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));
    const isNumber = v => typeof v === 'number' && Number.isFinite(v);
    const hasCounter = item => !!item.counter && Number.isFinite(item.counter.step) && Math.trunc(item.counter.step) !== 0;

    /**
     * The increment field over the one token after the height (written whole: `exact`). `slot` = the Code 39 / ITF form, where the
     * token is optional (an empty range with its comma is an insertion point, "+0000000001" is written as ",+0000000001"); else
     * the generic form, where it always exists ("0" or a signed token) and is replaced. A token that is neither is never rewritten.
     * 0 on an omitted / "0" token writes nothing; 0 on a signed one keeps it as +0000000000.
     */
    function counterField(group, slot) {
      const bare = raw => (slot ? raw.replace(/^,/, '') : raw);
      const written = text => (slot ? `,${text}` : text);
      return {
        key: 'counter', label: 'Incremento', type: 'number', min: -COUNTER_MAX, max: COUNTER_MAX, step: 1, group, exact: true,
        read: raw => readCounterStep(bare(raw)),
        model: item => (hasCounter(item) ? item.counter.step : 0),
        write: (v, width, raw) => {
          if (!isNumber(v) || readCounterStep(bare(raw)) === undefined) return null;
          const n = clampInt(v, -COUNTER_MAX, COUNTER_MAX);
          if (n === 0) return COUNTER_TOKEN.test(bare(raw)) ? written('+0000000000') : null;
          return written(counterToken(n));
        },
      };
    }

    /** The zero suppression field over the optional ",qq" slot at the end (written whole with its comma, empty when omitted). */
    const zeroField = group => ({
      key: 'zeroSuppress', label: 'Ceros suprimidos', type: 'number', min: 0, max: ZERO_MAX, step: 1, group, exact: true,
      read: raw => (raw === '' ? 0 : Number(raw.slice(1))),
      model: item => item.zeroSuppress || 0,
      write: (v, width, raw) => {
        if (!isNumber(v)) return null;
        const n = clampInt(v, 0, ZERO_MAX);
        return n === 0 && raw === '' ? null : `,${zeroDigits(n)}`;
      },
    });

    const humanReadableField = group => ({
      key: 'humanReadable', label: 'Texto legible', type: 'checkbox', group, model: item => item.humanReadable,
      read: raw => (raw === '1' ? true : raw === '0' ? false : undefined),
      write: v => (typeof v === 'boolean' ? (v ? '1' : '0') : null),
    });
    const barcodeHeight = group => numberField('height', 'Alto (0,1 mm)', group, 1, MAX_COORD, item => item.height);

    /**
     * Adds a Code128 XB format command plus its RB data command with a unique <#CODIGOBARRAS{k}#> variable, rotated
     * (360 - options.viewRotation) % 360 to look upright in the view (missing/invalid = 0).
     */
    function build(text, point, options) {
      const { format, data, name } = VARIABLE;
      // Rotated items extend from the anchor in the rotated direction, so near the label edges they can leave the label:
      // only the coordinate clamp applies, the item is not shifted to fit.
      const view = options && ROTATION_STEPS.includes(options.viewRotation) ? options.viewRotation : 0;
      const itemRotation = (360 - view) % 360; // clockwise, so that item + view = 0 (upright)
      const tail = VARIABLE.tail.replace('{rot1}', String(ROTATION_STEPS.indexOf(itemRotation)));
      const id = nextId(text, format, data);
      const placeholder = freePlaceholder(text, name);
      const withFormat = insertCommand(text, `{${format}${id};${pad4(clampCoord(point.x))},${pad4(clampCoord(point.y))},${tail}|}`);
      return insertCommand(withFormat, `{${data}${id};${placeholder}|}`);
    }

    /** Width in dots (0.1 mm -> dots at the resolution) as 2 digits, at least `min`, at most 99 (warns once if it was clamped). */
    function dotsText(ctx, value, min) {
      const raw = Number.isFinite(value) ? ctx.dot(value) : min;
      const dots = Math.min(MAX_DOTS, Math.max(min, raw));
      if (dots !== raw) ctx.once('tpcl-barcode-dots', () => diag.warning(`Hay códigos de barras con módulo o anchos fuera de ${min}..${MAX_DOTS} puntos: se ajustan al límite de TPCL`));
      return String(dots).padStart(2, '0');
    }

    /** Rotation digit 0..3: the nearest quarter turn, with a warning once if the item was not on one. */
    function rotationDigit(ctx, rotation) {
      const turns = Number.isFinite(rotation) ? Math.round(rotation / 90) : 0;
      const degrees = (((turns * 90) % 360) + 360) % 360;
      if (degrees !== rotation && !(rotation == null && degrees === 0)) {
        ctx.once('tpcl-barcode-rotation', () => diag.warning('Hay códigos de barras con una rotación que no es múltiplo de 90°: se ajustan al giro más cercano'));
      }
      return String(ROTATION_STEPS.indexOf(degrees));
    }

    /** Check digit option of a wide/narrow barcode; a check TPCL cannot express is written as none, with a warning. */
    function checkCode(ctx, symbology, check) {
      const code = CHECK_CODES[symbology][check ?? 'none'];
      if (code) return code;
      ctx.once(`tpcl-check-${symbology}`, () => diag.warning(`Código de barras ${symbology}: dígito de control "${check}" sin equivalente en TPCL, se escribe sin dígito de control`));
      return CHECK_CODES[symbology].none;
    }

    /** Data of an RB command: framing-safe, with FNC1 in the TPCL notation (a literal ">8" would read back as FNC1). */
    function barcodeText(ctx, data) {
      const value = safeData(ctx, data);
      if (value.includes(FNC1_NOTATION)) {
        ctx.once('tpcl-fnc1-literal', () => diag.warning('Hay datos de código de barras con ">8", que TPCL lee como FNC1: no se puede escribir literalmente'));
      }
      return value.replaceAll(barcodeData.FNC1, FNC1_NOTATION);
    }

    /**
     * XB command of a 1D barcode + its RB data command. Code 128 uses the generic form (type 9, module, rotation, height);
     * Code 39 and ITF the widths form (check option, narrow/wide bars and spaces and inter-character gap in dots). Without
     * explicit widths the wide elements are 3 x module (info). Symbologies TPCL has no type for (EAN13, unknown...) are
     * skipped with a warning. Only neutral fields are read: native (e.g. the TSPL type) is ignored.
     */
    function emit(item, ctx) {
      const type = TYPE_CODES[item.symbology];
      if (!type) {
        ctx.report(diag.warning(`Código de barras ${item.symbology}: sin equivalente en TPCL, no se exporta`));
        return [];
      }
      const [x, y] = [coordText(ctx, item.x), coordText(ctx, item.y)];
      const rotation = rotationDigit(ctx, item.rotation);
      const height = pad4(Math.max(1, clampCoord(Number.isFinite(item.height) ? item.height : 0)));
      const readable = item.humanReadable ? '1' : '0';
      const id = allocId(ctx, 'XB');
      const module = dotsText(ctx, item.module, 1);
      const head = `XB${id};${x},${y},${type}`;
      const data = wrap(`RB${id};${barcodeText(ctx, item.data)}`);
      if (item.symbology === 'code128') {
        const [inc, zero] = [hasCounter(item) ? counterToken(item.counter.step) : '0', item.zeroSuppress > 0 ? zeroDigits(item.zeroSuppress) : '00'];
        return [wrap(`${head},0,${module},${rotation},${height},${inc},000,${readable},${zero}`), data];
      }
      const w = item.widths;
      if (!w) ctx.once('tpcl-ratio', () => diag.info(`Código de barras sin anchos explícitos: se escriben con relación ${DEFAULT_RATIO}:1 a partir del módulo`));
      const wide = w ? null : dotsText(ctx, item.module * DEFAULT_RATIO, 1);
      const [narrowBar, narrowSpace, wideBar, wideSpace] = w
        ? [dotsText(ctx, w.narrowBar, 1), dotsText(ctx, w.narrowSpace, 0), dotsText(ctx, w.wideBar, 0), dotsText(ctx, w.wideSpace, 0)]
        : [module, module, wide, wide];
      // Code 39 gap defaults to the module, ITF has none
      const gap = dotsText(ctx, item.interCharGap ?? (item.symbology === 'itf' ? 0 : item.module), 0);
      const check = checkCode(ctx, item.symbology, item.check);
      // The increment sits right after the height (manual: llll(,mnnnnnnnnnn,p,qq)(,r)); a zero suppression is written after the readable flag
      const inc = hasCounter(item) ? `,${counterToken(item.counter.step)}` : '';
      const zero = item.zeroSuppress > 0 ? `,${zeroDigits(item.zeroSuppress)}` : '';
      return [wrap(`${head},${check},${narrowBar},${narrowSpace},${wideBar},${wideSpace},${gap},${rotation},${height}${inc},${readable}${zero}`), data];
    }

    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [
        {
          // Code 39 / ITF: XBnn;x,y,<type>,<e check digit>,<ff narrow bar>,<gg narrow space>,<hh wide bar>,<ii wide space>,
          //   <jj inter-character space>,<k rotation>,<llll height 0.1 mm>,<p human readable>[,<qq zero suppression>][,<r T|P|N start/stop>]
          // Verified only for the legacy [ESC]XB form of the B-SX4T specification (research T9). The {XB…|} form is the
          // same command but is NOT verified for B-EX4 / B-FV4 / B-EP4.
          pattern: /^XB(\d+);(\d+),(\d+),([23B]),(.*)$/,
          handle(m, cmd, ctx) {
            const ref = 'XB' + m[1];
            const symbology = symbologyOf(m[4]);
            const [e, ff, gg, hh, ii, jj, k, height, ...rest] = m[5].split(',');
            // The manual puts the increment right after the height; the older form goes straight to the readable flag
            const [inc, readable, ...optional] = COUNTER_TOKEN.test(rest[0] ?? '') ? rest : [undefined, ...rest];
            const dots = [ff, gg, hh, ii, jj];
            const validWidths = dots.every(v => DIGITS.test(v)) && +ff > 0;
            const [narrowBar, narrowSpace, wideBar, wideSpace, interCharGap] = dots.map(v => +v * ctx.dot);
            const startStop = optional.find(v => /^[TPN]$/.test(v)) ?? null;
            if (!validWidths) ctx.report(diag.warning(`${ref}: anchos de barra y espacio no válidos, se dibuja con el módulo y relación 3:1`));
            if (m[4] === 'B') ctx.report(diag.warning(`${ref}: Code39 con todo el ASCII (tipo B) no soportado por el visor: solo se dibujan los caracteres del Code39 estándar`));
            if (startStop) ctx.report(diag.warning(`${ref}: opción de inicio/parada "${startStop}" no verificada por el visor, se dibuja con * automático`));
            ctx.addField(ref, {
              kind: 'barcode', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
              symbology, module: (+ff || 2) * ctx.dot, rotation: ROTATIONS[k] ?? 0, height: +height || 100,
              ...(validWidths && { widths: { narrowBar, narrowSpace, wideBar, wideSpace }, interCharGap }),
              check: CHECK_OPTIONS[symbology][e] ?? 'unsupported',
              native: {
                type: m[4], checkDigit: e, narrowBar: +ff, narrowSpace: +gg, wideBar: +hh, wideSpace: +ii, interCharGap: +jj,
                startStop, zeroSuppression: optional.find(v => DIGITS.test(v)) ?? null,
                ...(symbology === 'code39' && { fullAscii: m[4] === 'B' }),
              },
              ...counterFields(ctx, inc, optional.find(v => /^\d{2}$/.test(v))),
              humanReadable: readable === '1', data: null,
            });
          },
        },
        {
          // 1D barcode: XBnn;x,y,<type>,<check digit>,<module>,<rotation>,<height>,<increment>,<000>,<human readable text>,<00>
          // Skips well-formed QR commands (T,<ecc>,<cell>…), which the qr slice parses: handler order never decides between
          // them. A malformed type T command still ends up here (symbology 'qr').
          pattern: /^XB(\d+);(\d+),(\d+),(?!T,\w,\d)([^,]),(.*)$/,
          handle(m, cmd, ctx) {
            const ref = 'XB' + m[1];
            const p = m[5].split(',');
            ctx.addField(ref, {
              kind: 'barcode', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
              symbology: symbologyOf(m[4]), module: (+p[1] || 2) * ctx.dot, rotation: ROTATIONS[p[2]] ?? 0, height: +p[3] || 100,
              native: { type: m[4], module: +p[1] || 2 },
              ...counterFields(ctx, p[4], p[7]),
              humanReadable: p[6] === '1', data: null,
            });
          },
        },
      ],
      // build(text, point, options) -> text with the new component
      build,
      // emit(item, ctx) -> the XB command and its RB data command
      emit,
      // Coordinate fields moved by moveItem (see COORDINATES in js/languages/tpcl.js)
      coordinates: [
        { pattern: /^\{XB\d+;(\d+),(\d+)/d, fields: [[1, null, 'x'], [2, null, 'y']] },
      ],
      // Editable shapes for describeItem / updateItem (see EDITABLE in js/languages/tpcl.js)
      editable: [
        { // Code 39 / ITF: …,<type>,e,ff,gg,hh,ii,jj,<rotation>,<height>(,<increment>),<human readable>(,<zero suppression>) (module widths not editable)
          applies: item => item.kind === 'barcode' && ['2', '3', 'B'].includes(item.native && item.native.type),
          pattern: /^\{XB\d+;\d+,\d+,[23B],(?:[^,]*,){6}(\d+),(\d+)((?:,[+-]\d{10})?),([^,;|]*)((?:,\d{2})?)/d,
          fields: [barcodeHeight(2), rotationField(1), counterField(3, true), humanReadableField(4), zeroField(5)],
        },
        { // Other 1D barcodes: …,<type>,<check>,<module>,<rotation>,<height>,<increment>,<000>,<human readable>(,<zero suppression>)
          applies: item => item.kind === 'barcode',
          pattern: /^\{XB\d+;\d+,\d+,[^,],[^,]*,(\d+),(\d+),(\d+),([^,]*),[^,]*,([^,;|]*)((?:,\d{2})?)/d,
          fields: [
            numberField('module', 'Módulo (puntos)', 1, 1, 99, item => item.native.module),
            barcodeHeight(3), rotationField(2), counterField(4, false), humanReadableField(5), zeroField(6),
          ],
        },
      ],
    };
  }

  PB.slices.barcode.tpcl = tpcl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
