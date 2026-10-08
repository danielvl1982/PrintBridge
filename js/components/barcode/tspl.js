/**
 * Barcode slice, TSPL language (TSC TTP): the BARCODE command.
 *   BARCODE x,y,"type",height,human readable,rotation,narrow,wide,[alignment,]"content"
 * It becomes the neutral `barcode` item (see js/core/model.js) so the renderer and validator of this slice need no change:
 *   - the alignment argument is present when the command has 10 arguments (count based);
 *   - height and narrow are dots: height = height dots, module = narrow dots, in 0.1 mm; for Code 39 / ITF the neutral
 *     widths come from narrow and wide (both in dots);
 *   - human readable 0 = none, 1/2/3 (left/center/right) = shown (the alignment is kept in native.align);
 *   - type 128, 128M (manual mode: !102 = FNC1, !103/!104/!105 start codes dropped), EAN128 (leading FNC1), 39/39C/39S,
 *     25/25C/ITF14/EAN14, EAN13, EAN8, UPCA and UPCE (each also with +2 / +5, the add-on kept in item.addon; the check digit is
 *     'auto': the manual gives no option, the viewer attaches / validates it), 93 (Code 93, check 'auto': its two check characters are part of
 *     the symbology) and CODA (Codabar, wide / narrow, no check) have a neutral symbology; every other type (the manual has no MSI or
 *     Industrial 2 of 5) is 'unknown'
 *     (drawn approximately, the validator of the slice warns) and keeps its TSPL type in native.type. The data of a type with an
 *     add-on is the base digits followed by the add-on digits (the manual does not document it).
 * The factory receives the helpers of js/languages/tspl.js (SLICE_HELPERS), which loads after this file:
 *   factory(helpers) -> { handlers, emit, build, coordinates, editable }. Registered by js/components/barcode/index.js as `languages: { tpcl, tspl }`.
 * Emit (the inverse): `emit(item, ctx)` writes a BARCODE command.
 *   - code128 -> "128"; a leading FNC1 only -> "EAN128" (FNC1 removed from the data); FNC1 elsewhere -> "128M" with !102
 *     at each FNC1 (the parser drops start codes, so none is written);
 *   - code93 -> "93" (wide = 2 x narrow, the 1:2 ratio of the manual's table; a check other than auto is written as auto with a warning);
 *     codabar -> "CODA" (wide from the ratio of its widths, like Code 39);
 *   - code39 -> "39", or "39C" for a mod43 check; itf -> "25" (a check digit cannot be represented: warning); ean13 / ean8 / upca /
 *     upce -> "EAN13" / "EAN8" / "UPCA" / "UPCE" plus "+2" / "+5" for the add-on (check 'none' / 'check' have no counterpart: warning);
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
  const { selector } = PB.slices.barcode;

  /** Neutral symbology and check option of each TSPL type (the types not listed are 'unknown'). */
  const TYPES = Object.freeze({
    '128': { symbology: 'code128' },
    '128M': { symbology: 'code128' },
    'EAN128': { symbology: 'code128' },
    '39': { symbology: 'code39', check: 'none' },
    '39C': { symbology: 'code39', check: 'mod43' },
    '39S': { symbology: 'code39', check: 'none' },
    '93': { symbology: 'code93', check: 'auto' },
    'CODA': { symbology: 'codabar', check: 'none' },
    '25': { symbology: 'itf', check: 'none' },
    '25C': { symbology: 'itf', check: 'unsupported' },
    'ITF14': { symbology: 'itf', check: 'none' },
    'EAN14': { symbology: 'itf', check: 'none' },
    'EAN13': { symbology: 'ean13', check: 'auto' },
    'EAN8': { symbology: 'ean8', check: 'auto' },
    'UPCA': { symbology: 'upca', check: 'auto' },
    'UPCE': { symbology: 'upce', check: 'auto' },
  });

  /** Add-on variants (EAN13+2, UPCE+5...): the base type decides the symbology; only the EAN / UPC ones draw the add-on. */
  const ADD_ON = /^(.+)\+[25]$/;
  const isWpc = symbology => Object.hasOwn(PB.ean.NAMES, symbology);
  const ADDONS = Object.freeze([0, 2, 5]);
  const defaultCheck = symbology => (isWpc(symbology) || symbology === 'code93' ? 'auto' : 'none');

  /** Counter/variable content: "@1", "x"+@1+"y". */
  const COUNTER = /(?:^|\+)\s*@\d+/;

  /** Manual-mode control code of Code128 in the 128M content: !102 (FNC1), !103/!104/!105 (start A/B/C). */
  const CONTROL_CODE = /!(\d{3})/g;
  const START_CODES = Object.freeze(['103', '104', '105']);

  /** Height of a freshly inserted barcode, in 0.1 mm (the TPCL template is 8 mm too). */
  const TEMPLATE_HEIGHT = 80;

  /** Wide/narrow ratios the manual allows for Code 39 and ITF (1:2, 2:5, 1:3), and the one used without explicit widths. */
  /** Largest height / wide bar (dots) and narrow bar offered in the properties panel. */
  const MAX_DOTS = 9999;
  const MAX_NARROW = 10;

  const RATIOS = Object.freeze([2, 2.5, 3]);
  const DEFAULT_RATIO = 3;

  /** TSPL type of each selectable symbology and, for the ones with a check digit option, of each check (the selector's tables). */
  const TYPE_CODES = Object.freeze({ code128: '128', code39: '39', itf: '25', code93: '93', codabar: 'CODA', ean13: 'EAN13', ean8: 'EAN8', upca: 'UPCA', upce: 'UPCE' });
  const CHECK_CODES = Object.freeze({
    code39: { none: '39', mod43: '39C' }, itf: { none: '25' }, code93: { auto: '93' }, codabar: { none: 'CODA' },
    ean13: { auto: 'EAN13' }, ean8: { auto: 'EAN8' }, upca: { auto: 'UPCA' }, upce: { auto: 'UPCE' },
  });
  const CHECK_WARNING = Object.freeze({ itf: 'no se puede representar en TSPL' });

  /** Symbologies whose wide bar is a real parameter (the others write wide = narrow). */
  const WIDE_NARROW = Object.freeze(['code39', 'itf', 'codabar']);
  /** Symbologies written with a fixed wide / narrow ratio (the manual's table lists 93 with 1:2, 1:3 and 2:5, not 1:1): Code 93 uses 1:2. */
  const FIXED_RATIO = Object.freeze({ code93: 2 });
  /** The symbologies whose data this slice can validate besides EAN / UPC (PB[symbology].encode). */
  const LINEAR = Object.freeze(['code93', 'codabar']);

  /** Symbologies with a TSPL type. */
  const EMITTABLE = Object.freeze(['code128', 'code39', 'itf', 'code93', 'codabar', 'ean13', 'ean8', 'upca', 'upce']);

  /** FNC1 in the manual mode of 128M. */
  const FNC1_MANUAL = '!102';

  /** The wide/narrow ratio closest to `ratio` among the manual ones. */
  const nearestRatio = ratio => RATIOS.reduce((best, r) => (Math.abs(r - ratio) < Math.abs(best - ratio) ? r : best), RATIOS[0]);
  /** How the wide argument depends on the symbology: its own ratio (Code 39 / ITF / NW7), a fixed one (Code 93) or = narrow. */
  const wideClass = symbology => (WIDE_NARROW.includes(symbology) ? 'ratio' : Object.hasOwn(FIXED_RATIO, symbology) ? 'fixed' : 'narrow');

  function tspl(helpers) {
    const {
      sourceOf, num, ROTATIONS, quoted, exactDots, roundDots, toDots, safeData, numberField, selectField, textField,
      insertCommand, freePlaceholder, itemRotation, dropDots, lengthDots, counterSetup,
    } = helpers;

    /**
     * Adds BARCODE x,y,"128",height,1,rotation,2,2,"<#CODIGOBARRAS{k}#>" (Code 128 with the text below, 8 mm tall) at the
     * drop point, rotated (360 - options.viewRotation) % 360 to look upright in the view.
     */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const placeholder = quoted(freePlaceholder(text, 'CODIGOBARRAS'));
      return insertCommand(text, `BARCODE ${x},${y},"128",${lengthDots(options, TEMPLATE_HEIGHT)},1,${itemRotation(options)},2,2,${placeholder}`);
    }

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

    /** TSPL type string of a type string and add-on: "EAN13" + 2 -> "EAN13+2". */
    const withAddon = (type, symbology, addon) => (isWpc(symbology) && (addon === 2 || addon === 5) ? `${type}+${addon}` : type);

    /** TSPL type of a Code39 / ITF / EAN / UPC item (warns once when the check digit or the data cannot be written). */
    function typeOf(ctx, item) {
      const { symbology } = item;
      const check = item.check ?? defaultCheck(symbology);
      const types = CHECK_CODES[symbology];
      dataWarnings(ctx, item);
      if (Object.hasOwn(types, check)) return withAddon(types[check], symbology, item.addon);
      const fallback = defaultCheck(symbology);
      ctx.once(`tspl-check-${symbology}`, () => diag.warning(`Código de barras ${symbology}: dígito de control "${check}" ${CHECK_WARNING[symbology] || 'sin equivalente en TSPL'}, se escribe ${fallback === 'auto' ? 'con dígito de control automático' : 'sin dígito de control'}`));
      return withAddon(types[fallback], symbology, item.addon);
    }

    /** EAN / UPC / Code 93 / NW7: one warning per symbology when the data cannot be encoded (variables stand for values not known here), one info for the TPCL guard bar length. */
    function dataWarnings(ctx, item) {
      const data = String(item.data ?? '');
      let encoded = null;
      if (isWpc(item.symbology)) encoded = PB.ean.encode(item.symbology, data, { check: item.check, addon: item.addon });
      else if (LINEAR.includes(item.symbology)) {
        const out = PB[item.symbology].encode(data, { check: 'none' });
        encoded = { ok: (out.widths || out.elements).length > 0, warnings: out.warnings };
      }
      if (encoded && !PB.variables.namesIn(data).length) {
        if (!encoded.ok) ctx.once(`tspl-wpc-${item.symbology}`, () => diag.warning(`Hay códigos de barras con datos que no son válidos para su tipo (${encoded.warnings[0]}): la impresora puede rechazarlos`));
      }
      if (isWpc(item.symbology) && item.guard > 0) ctx.once('tspl-guard', () => diag.info('La longitud de la barra de guarda de los códigos EAN / UPC de TPCL no se escribe en TSPL'));
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
      if (WIDE_NARROW.includes(item.symbology)) {
        const w = item.widths;
        const explicit = w && w.narrowBar > 0 && Number.isFinite(w.wideBar);
        if (!explicit) ctx.once('tspl-ratio', () => diag.info(`Código de barras sin anchos explícitos: se escriben con relación ${DEFAULT_RATIO}:1 a partir del módulo`));
        wide = roundDots(narrow * nearestRatio(explicit ? w.wideBar / w.narrowBar : DEFAULT_RATIO));
      } else if (Object.hasOwn(FIXED_RATIO, item.symbology)) {
        wide = roundDots(narrow * FIXED_RATIO[item.symbology]);
      }
      const [x, y] = [roundDots(exactDots(ctx, item.x || 0)), roundDots(exactDots(ctx, item.y || 0))];
      const height = Math.max(1, toDots(ctx, item.height));
      const readable = item.humanReadable ? 1 : 0;
      // A counter writes SET COUNTER and the start value before the command, which then prints "@n"
      const counter = counterSetup(ctx, item, data);
      const line = `BARCODE ${x},${y},"${type}",${height},${readable},${rotationDegrees(ctx, item.rotation)},${narrow},${wide},${counter ? counter.ref : quoted(data)}`;
      return counter ? [...counter.lines, line] : line;
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

    /** 128M and EAN128 data is rewritten by the parser (control codes, FNC1), so it cannot be edited as plain text. */
    const rawContent = type => !['128M', 'EAN128'].includes(String(type).toUpperCase());

    // --- Type selector: the symbology and check digit fields rewrite the type and wide arguments of the command ---

    /** { symbology, check, addon } of a type string when it is a selectable one (an add-on only on the EAN / UPC types), else undefined. */
    const knownType = type => {
      const key = String(type).toUpperCase();
      const add = ADD_ON.exec(key);
      const known = TYPES[add ? add[1] : key];
      if (!known || !Object.hasOwn(TYPE_CODES, known.symbology) || (add && !isWpc(known.symbology))) return undefined;
      return { ...known, addon: add ? Number(key.slice(-1)) : 0 };
    };
    const typeOfCommand = cmd => knownType(cmd && cmd.args[2] && cmd.args[2].value);
    const typeOfItem = item => (item.native && item.native.type !== undefined ? knownType(item.native.type) : undefined);

    const symbologyField = {
      key: 'symbology', label: 'Tipo de código', type: 'select', arg: 2, reemit: true,
      options: selector.symbologyOptions(TYPE_CODES),
      model: item => (typeOfItem(item) ? item.symbology : undefined),
      read: (a, cmd) => (typeOfCommand(cmd) || {}).symbology,
      write: () => null,
    };
    const checkField = {
      key: 'check', label: 'Dígito de control', type: 'select', arg: 2, reemit: true,
      optionsFor: (value, item, cmd) => {
        const known = cmd ? typeOfCommand(cmd) : typeOfItem(item);
        const options = selector.checkOptions(CHECK_CODES, known ? known.symbology : item.symbology);
        return options.some(o => o.value === value) ? options : [...options, { value, label: 'Otro (no editable)' }];
      },
      model: item => (typeOfItem(item) && Object.hasOwn(CHECK_CODES, item.symbology) ? (item.check ?? defaultCheck(item.symbology)) : undefined),
      read: (a, cmd) => {
        const known = typeOfCommand(cmd);
        return known && Object.hasOwn(CHECK_CODES, known.symbology) ? (known.check ?? 'none') : undefined;
      },
      write: () => null,
    };
    /** The add-on (0, 2 or 5 digits) of the EAN / UPC types: part of the type string, so changing it re-emits the type. */
    const addonField = {
      key: 'addon', label: 'Complemento', type: 'select', arg: 2, reemit: true,
      options: selector.addonOptions(),
      model: item => (typeOfItem(item) && isWpc(item.symbology) ? (item.addon ?? 0) : undefined),
      read: (a, cmd) => {
        const known = typeOfCommand(cmd);
        return known && isWpc(known.symbology) ? known.addon : undefined;
      },
      write: () => null,
    };

    /**
     * Changes the symbology, check digit and / or add-on of a BARCODE: the type string and the wide argument are emitted again (the
     * same tables as emit(): "128", "39" / "39C", "25", "EAN13" / "EAN8" / "UPCA" / "UPCE" with "+2" / "+5"; wide = narrow x the default ratio when the new type has a wide bar and the old
     * one had none, = narrow when it has none, the written one between Code 39 and ITF). The other arguments (coordinates with
     * REFERENCE / SHIFT, height, readable, rotation, narrow, alignment, the content, counters) stay as written: all types share one
     * layout, so these two arguments are all that depends on the type. null (refuse, text unchanged): the type or the new value has
     * no row, an add-on, 128M / EAN128 content (the parser rewrites it, so it cannot move to another type), an invalid value or
     * nothing changes. The editors have no diagnostics path, so nothing is dropped silently.
     */
    function reemit(cmd, item, changes) {
      const known = typeOfCommand(cmd);
      if (!known) return null;
      const from = known.symbology;
      const to = Object.hasOwn(changes, 'symbology') ? changes.symbology : from;
      if (!selector.symbologyOptions(TYPE_CODES).some(o => o.value === to)) return null;
      const checks = Object.hasOwn(CHECK_CODES, to) ? CHECK_CODES[to] : {};
      if (Object.hasOwn(changes, 'check') && !Object.hasOwn(checks, changes.check)) return null;
      const addon = Object.hasOwn(changes, 'addon') ? changes.addon : known.addon;
      if (!ADDONS.includes(addon) || (addon > 0 && !isWpc(to))) return null;
      if (to === from && addon === known.addon && !Object.hasOwn(changes, 'check')) return null;
      const sameFamily = isWpc(from) === isWpc(to);
      const check = Object.hasOwn(changes, 'check') ? changes.check : (sameFamily && Object.hasOwn(checks, known.check) ? known.check : defaultCheck(to));
      if (to === from && addon === known.addon && check === (known.check ?? defaultCheck(from))) return null;
      if (!rawContent(cmd.args[2].value) && to !== from) return null;
      const type = withAddon(Object.hasOwn(CHECK_CODES, to) ? CHECK_CODES[to][check] : TYPE_CODES[to], to, addon);
      const edits = [{ start: cmd.args[2].start, end: cmd.args[2].end, value: `"${type}"` }];
      if (wideClass(from) !== wideClass(to)) {
        const narrow = num(cmd.args[6]);
        if (narrow === null || !Number.isInteger(narrow) || narrow < 1) return null;
        const wide = { ratio: roundDots(narrow * nearestRatio(DEFAULT_RATIO)), fixed: roundDots(narrow * (FIXED_RATIO[to] || 1)), narrow }[wideClass(to)];
        edits.push({ start: cmd.args[7].start, end: cmd.args[7].end, value: String(wide) });
      }
      return edits;
    }

    /** Properties of BARCODE (type untouched). The wide bar only matters for the wide/narrow symbologies. */
    const barcodeFields = wideNarrow => [
      symbologyField, checkField, addonField,
      numberField('height', 'Alto (puntos)', 3, 1, MAX_DOTS, (item, { dpi }) => dots(dpi, item.height)),
      selectField('readable', 'Texto legible', 4, [
        { value: 0, label: 'No' }, { value: 1, label: 'Izquierda' }, { value: 2, label: 'Centro' }, { value: 3, label: 'Derecha' },
      ], item => (item.native ? item.native.humanReadable : undefined)),
      selectField('rotation', 'Rotación', 5, [0, 90, 180, 270], item => item.rotation),
      numberField('narrow', 'Barra estrecha (puntos)', 6, 1, MAX_NARROW, item => item.native && item.native.module),
      ...(wideNarrow ? [numberField('wide', 'Barra ancha (puntos)', 7, 1, MAX_DOTS, item => item.native && item.native.wide)] : []),
      // The content is argument 8, or 9 when an alignment argument precedes it; counters are left out
      textField('content', 'Contenido', cmd => (cmd.args.length >= 10 ? 9 : 8),
        item => (item.native && rawContent(item.native.type) && item.native.counterN === undefined && !COUNTER.test(String(item.data)) ? item.data : undefined),
        cmd => rawContent(cmd.args[2] && cmd.args[2].value)),
    ];
    const isBarcode = (item, cmd) => (cmd ? cmd.name === 'BARCODE' : item.ref === 'BARCODE');
    const isWideNarrow = (item, cmd) => {
      const type = cmd ? cmd.args[2] && cmd.args[2].value : item.native && item.native.type;
      const known = TYPES[String(type).toUpperCase().replace(ADD_ON, '$1')];
      return !!known && WIDE_NARROW.includes(known.symbology);
    };

    return {
      // emit(item, ctx) -> the BARCODE command of a barcode item
      emit,
      // build(text, point, options) -> text with a new BARCODE command (palette)
      build,
      // Move: BARCODE x,y are arguments 0 and 1 (dots)
      coordinates: [{ applies: (item, cmd) => !cmd || cmd.name === 'BARCODE', fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] }],
      editable: [
        { applies: (item, cmd) => isBarcode(item, cmd) && isWideNarrow(item, cmd), fields: barcodeFields(true), reemit },
        { applies: isBarcode, fields: barcodeFields(false), reemit },
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
            if (addOn && known.symbology !== 'unknown' && !isWpc(known.symbology)) ctx.report(diag.info(`${ref}: el complemento "+${typeKey.slice(-1)}" no se dibuja`));

            const readable = num(cmd.args[4]);
            const rotation = num(cmd.args[5]);
            if (rotation === null || !ROTATIONS.includes(rotation)) {
              ctx.report(diag.warning(`${ref}: rotación "${cmd.args[5].value}" no válida, se dibuja sin rotar`));
            }
            const narrowValue = num(cmd.args[6]);
            const narrow = narrowValue !== null && narrowValue > 0 ? narrowValue : 2;
            if (narrow !== narrowValue) ctx.report(diag.warning(`${ref}: ancho estrecho "${cmd.args[6].value}" no válido, se usa 2 puntos`));
            const wide = num(cmd.args[7]);

            // A counter with an assigned start value shows it (the printer increments it per label); else the literal text
            const shown = ctx.counterContent(cmd.args[hasAlign ? 9 : 8]);
            let data = shown ? shown.data : contentOf(ctx, cmd.args[hasAlign ? 9 : 8]);
            if (typeKey === '128M') data = manualModeData(ctx, data);
            if (typeKey === 'EAN128') data = barcodeData.FNC1 + data;

            const { x, y } = ctx.pos(px, py);
            const wideNarrow = WIDE_NARROW.includes(known.symbology);
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
              ...(isWpc(known.symbology) && { addon: addOn ? Number(typeKey.slice(-1)) : 0 }),
              native: { type, module: narrow, wide },
              humanReadable: readable !== null && readable >= 1 && readable <= 3,
              data,
            };
            if (shown) {
              item.native.counterN = shown.n;
              if (shown.counter) item.counter = shown.counter;
            }
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
