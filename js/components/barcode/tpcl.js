/**
 * Barcode slice, TPCL language: everything the 1D barcode XB commands need (Code 39 / ITF / MSI / NW7 / Industrial 2 of 5 with explicit
 * bar widths and the alternative form with a module, which also carries Code 128, Code 93 and the WPC types EAN-13 / EAN-8 / UPC-A /
 * UPC-E with their +2 / +5 add-ons), plus the RB data command's palette template.
 *   Code 39 (3, B) / ITF (2) / MSI (1) / NW7 (4) / Industrial 2 of 5 (O): XBnn;x,y,<type>,<e check digit>,<ff narrow bar>,<gg narrow space>,<hh wide bar>,<ii wide space>,
 *     <jj inter-character space>,<k rotation>,<llll height 0.1 mm>,<p human readable>[,<qq zero suppression>][,<r T|P|N start/stop>]
 *     (spec 6.3.9: e = 1 none, 2 check, 3 / 4 / 5 attach; MSI jj = 00, Industrial 2 of 5 ii = 00; r = start only / stop only / none)
 *   1D barcode (Code 128 and Code 93 = type C, e = 1 none / 2 check / 3 attach modulus 47): XBnn;x,y,<type>,<check digit>,<module>,<rotation>,<height>,<increment>,<000>,<human readable text>,<00>
 *     (WPC types, B-SV4 spec 6.3.9: 5 EAN-13, 7 +2, 8 +5; 0 EAN-8, I +2, J +5; K UPC-A, L +2, M +5; 6 UPC-E, G +2, H +5. The check digit
 *     option e is 1 none, 2 check, 3 auto attach (modulus 10), 4 / 5 attach with a price check digit (not drawn: unsupported). The
 *     000 is the WPC guard bar length in 0.1 mm, omitted = no guard bar; p prints the digits under the bars.)
 * The hooks are built by a factory because they need the shared helpers of js/languages/tpcl.js, which loads after
 * this file: factory(helpers) -> { handlers, build, coordinates, editable } (see js/components/registry.js).
 * The RB data handler is shared with the other kinds and stays in js/languages/tpcl.js; the XB QR command is the qr slice's.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  const { diagnostics: diag, barcodeData } = PB;
  const { selector } = PB.slices.barcode;

  /** Neutral symbology of each TPCL barcode type (the other types are 'unknown'). */
  const SYMBOLOGIES = Object.freeze({ 1: 'msi', 2: 'itf', 3: 'code39', 4: 'codabar', B: 'code39', O: 'industrial25', 9: 'code128', A: 'code128', C: 'code93', T: 'qr' });

  /** The WPC types: neutral symbology and add-on digits (0, 2 or 5) of each TPCL type character. */
  const WPC_TYPES = Object.freeze({
    5: { symbology: 'ean13', addon: 0 }, 7: { symbology: 'ean13', addon: 2 }, 8: { symbology: 'ean13', addon: 5 },
    0: { symbology: 'ean8', addon: 0 }, I: { symbology: 'ean8', addon: 2 }, J: { symbology: 'ean8', addon: 5 },
    K: { symbology: 'upca', addon: 0 }, L: { symbology: 'upca', addon: 2 }, M: { symbology: 'upca', addon: 5 },
    6: { symbology: 'upce', addon: 0 }, G: { symbology: 'upce', addon: 2 }, H: { symbology: 'upce', addon: 5 },
  });
  const symbologyOf = type => (Object.hasOwn(WPC_TYPES, type) ? WPC_TYPES[type].symbology : SYMBOLOGIES[type] || 'unknown');
  const isWpc = symbology => Object.hasOwn(PB.ean.NAMES, symbology);
  const ADDONS = Object.freeze([0, 2, 5]);

  /** Check digit option (field e of Code 39 / ITF) -> neutral check; the options not listed are 'unsupported'. */
  const WPC_CHECK_OPTIONS = Object.freeze({ 1: 'none', 2: 'check', 3: 'auto' });
  /** Code 93 (generic form) and Industrial 2 of 5 take the same three options; MSI has two more (IBM modulus 10 + 10, 11 + 10); NW7 has none. */
  const CHECK_OPTIONS = Object.freeze({
    code39: { 1: 'none', 3: 'mod43' }, itf: { 1: 'none' }, ean13: WPC_CHECK_OPTIONS, ean8: WPC_CHECK_OPTIONS, upca: WPC_CHECK_OPTIONS, upce: WPC_CHECK_OPTIONS,
    code93: WPC_CHECK_OPTIONS, codabar: { 1: 'none' }, msi: { ...WPC_CHECK_OPTIONS, 4: 'mod1010', 5: 'mod1110' }, industrial25: WPC_CHECK_OPTIONS,
  });

  /** TPCL barcode type of each emittable neutral symbology (the inverse of SYMBOLOGIES). */
  const TYPE_CODES = Object.freeze({ itf: '2', code39: '3', code128: '9', code93: 'C', codabar: '4', msi: '1', industrial25: 'O', ean13: '5', ean8: '0', upca: 'K', upce: '6' });

  /** TPCL type character of each WPC symbology with an add-on of 2 or 5 digits. */
  const ADDON_TYPE_CODES = Object.freeze({ ean13: { 2: '7', 5: '8' }, ean8: { 2: 'I', 5: 'J' }, upca: { 2: 'L', 5: 'M' }, upce: { 2: 'G', 5: 'H' } });
  const typeChar = (symbology, addon) => (isWpc(symbology) && ADDON_TYPE_CODES[symbology][addon] ? ADDON_TYPE_CODES[symbology][addon] : TYPE_CODES[symbology]);

  /** Check digit option (field e) of each neutral check: the inverse of CHECK_OPTIONS, per wide/narrow symbology. */
  const WPC_CHECK_CODES = Object.freeze({ none: '1', check: '2', auto: '3' });
  const CHECK_CODES = Object.freeze({
    code39: { none: '1', mod43: '3' }, itf: { none: '1' }, ean13: WPC_CHECK_CODES, ean8: WPC_CHECK_CODES, upca: WPC_CHECK_CODES, upce: WPC_CHECK_CODES,
    code93: WPC_CHECK_CODES, codabar: { none: '1' }, msi: { ...WPC_CHECK_CODES, mod1010: '4', mod1110: '5' }, industrial25: WPC_CHECK_CODES,
  });

  /** Check option of a symbology whose item has none (the WPC types and Code 93, whose check characters are part of the symbology, attach them by default). */
  const defaultCheck = symbology => (isWpc(symbology) || symbology === 'code93' ? 'auto' : 'none');
  /** The generic-form symbologies whose check digit option is a neutral field (Code 128 keeps the digit character as written). */
  const hasGenericCheck = symbology => isWpc(symbology) || symbology === 'code93';
  /** Symbologies without space between characters (the manual fixes the field to 00), and the one without wide space. */
  const NO_GAP = Object.freeze(['itf', 'msi']);
  const NO_WIDE_SPACE = 'industrial25';

  /** Form of the XB command of each emittable symbology: the generic one (module, rotation, height) or the one with explicit widths. */
  const FORM_OF = Object.freeze({ code128: 'generic', code93: 'generic', code39: 'widths', itf: 'widths', codabar: 'widths', msi: 'widths', industrial25: 'widths', ean13: 'generic', ean8: 'generic', upca: 'generic', upce: 'generic' });

  /** Largest WPC guard bar length (0.1 mm). */
  const MAX_GUARD = 100;

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
      COUNTER_TOKEN, COUNTER_MAX, ZERO_MAX, counterToken, emitCounterToken, zeroDigits, readCounterStep, counterFields,
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
      const code = CHECK_CODES[symbology][check ?? defaultCheck(symbology)];
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
      if (!TYPE_CODES[item.symbology]) {
        ctx.report(diag.warning(`Código de barras ${item.symbology}: sin equivalente en TPCL, no se exporta`));
        return [];
      }
      const [x, y] = [coordText(ctx, item.x), coordText(ctx, item.y)];
      dataWarning(ctx, item);
      const shared = sharedValues(item, ctx);
      const id = allocId(ctx, 'XB');
      const data = wrap(`RB${id};${barcodeText(ctx, item.data)}`);
      return [wrap(`XB${id};${x},${y},${parameters(item, ctx, shared)}`), data];
    }

    /** The symbologies with their own encoder in this slice besides EAN / UPC (PB[symbology].encode). */
    const LINEAR = Object.freeze(['code93', 'codabar', 'msi', 'industrial25']);

    /** One warning per symbology when the data of an EAN / UPC / Code 93 / NW7 / MSI / Industrial 2 of 5 barcode cannot be encoded (a variable stands for its value, which is not known here). */
    function dataWarning(ctx, item) {
      const data = String(item.data ?? '');
      if (PB.variables.namesIn(data).length) return;
      let encoded = null;
      if (isWpc(item.symbology)) encoded = PB.ean.encode(item.symbology, data, { check: item.check, addon: item.addon });
      else if (LINEAR.includes(item.symbology)) {
        const out = PB[item.symbology].encode(data, { check: 'none' });
        encoded = { ok: (out.widths || out.elements).length > 0, warnings: out.warnings };
      }
      if (encoded && !encoded.ok) ctx.once(`tpcl-wpc-${item.symbology}`, () => diag.warning(`Hay códigos de barras con datos que no son válidos para su tipo (${encoded.warnings[0]}): la impresora puede rechazarlos`));
    }

    /** The WPC guard bar length as 3 digits (0.1 mm, 0..100; 000 = none). */
    const guardText = item => String(Math.min(MAX_GUARD, Math.max(0, Math.round(Number.isFinite(item.guard) ? item.guard : 0)))).padStart(3, '0');

    /** The values of a command that do not depend on its form: rotation digit, height, readable flag and module (dots, 2 digits). */
    function sharedValues(item, ctx) {
      return {
        rotation: rotationDigit(ctx, item.rotation),
        height: pad4(Math.max(1, clampCoord(Number.isFinite(item.height) ? item.height : 0))),
        readable: item.humanReadable ? '1' : '0',
        module: dotsText(ctx, item.module, 1),
      };
    }

    /**
     * The parameters of the XB command after the coordinates, from the type character on, for the symbology of the item (the form
     * follows it: Code 128 the generic one, Code 39 / ITF the widths one). `keep` carries what the neutral model does not hold, when
     * the caller rewrites an existing command: { type, checkDigit, startStop, guard } (the type character as written, e.g. B; the check
     * digit character of the generic form (Code 128; the WPC types write theirs from item.check); the start/stop option of the widths
     * form; the guard bar length of the generic form as written).
     */
    function parameters(item, ctx, { rotation, height, readable, module }, keep = {}) {
      const type = keep.type || typeChar(item.symbology, item.addon);
      if (FORM_OF[item.symbology] === 'generic') {
        const [inc, zero] = [hasCounter(item) ? emitCounterToken(ctx, item.counter.step) : '0', item.zeroSuppress > 0 ? zeroDigits(item.zeroSuppress) : '00'];
        const check = hasGenericCheck(item.symbology) ? checkCode(ctx, item.symbology, item.check) : (keep.checkDigit ?? '0');
        return `${type},${check},${module},${rotation},${height},${inc},${keep.guard ?? (isWpc(item.symbology) ? guardText(item) : '000')},${readable},${zero}`;
      }
      const w = item.widths;
      if (!w) ctx.once('tpcl-ratio', () => diag.info(`Código de barras sin anchos explícitos: se escriben con relación ${DEFAULT_RATIO}:1 a partir del módulo`));
      const wide = w ? null : dotsText(ctx, item.module * DEFAULT_RATIO, 1);
      const [narrowBar, narrowSpace, wideBar, wideSpace] = w
        ? [dotsText(ctx, w.narrowBar, 1), dotsText(ctx, w.narrowSpace, 0), dotsText(ctx, w.wideBar, 0), dotsText(ctx, w.wideSpace, 0)]
        : [module, module, wide, wide];
      // The gap defaults to the module, ITF and MSI have none (00); Industrial 2 of 5 has no wide space (00)
      const gap = dotsText(ctx, item.interCharGap ?? (NO_GAP.includes(item.symbology) ? 0 : item.module), 0);
      const wideSpaceText = item.symbology === NO_WIDE_SPACE ? '00' : wideSpace;
      const check = checkCode(ctx, item.symbology, item.check);
      // The increment sits right after the height (manual: llll(,mnnnnnnnnnn,p,qq)(,r)); a zero suppression is written after the readable flag
      const inc = hasCounter(item) ? `,${emitCounterToken(ctx, item.counter.step)}` : '';
      const zero = item.zeroSuppress > 0 ? `,${zeroDigits(item.zeroSuppress)}` : '';
      return `${type},${check},${narrowBar},${narrowSpace},${wideBar},${wideSpaceText},${gap},${rotation},${height}${inc},${readable}${zero}${keep.startStop ? `,${keep.startStop}` : ''}`;
    }

    // --- Type selector: the symbology and check digit fields rewrite the whole format command ---

    /** The type character and check digit field of a command (from its first characters), as { symbology, check } of the tables. */
    const TYPE_AND_CHECK = /^\{XB\d+;\d+,\d+,([^,]),([^,]*)/;
    const symbologyOfCommand = raw => {
      const m = TYPE_AND_CHECK.exec(raw || '');
      return m && TYPE_CODES[symbologyOf(m[1])] ? symbologyOf(m[1]) : undefined;
    };

    const symbologyField = {
      key: 'symbology', label: 'Tipo de código', type: 'select', group: 0, reemit: true,
      options: selector.symbologyOptions(TYPE_CODES),
      model: item => (TYPE_CODES[item.symbology] ? item.symbology : undefined),
      read: raw => symbologyOfCommand(raw),
      write: () => null,
    };

    /** Check digit options of the symbology written in the command (or of the item); the current value is listed even if it is not one. */
    const checkOptionsOf = (value, item, raw) => {
      const options = selector.checkOptions(CHECK_CODES, symbologyOfCommand(raw) || (item && item.symbology));
      return options.some(o => o.value === value) ? options : [...options, { value, label: 'Otro (no editable)' }];
    };
    const checkField = {
      key: 'check', label: 'Dígito de control', type: 'select', group: 0, reemit: true,
      optionsFor: checkOptionsOf,
      model: item => (Object.hasOwn(CHECK_CODES, item.symbology) ? (item.check ?? defaultCheck(item.symbology)) : undefined),
      read: raw => {
        const m = TYPE_AND_CHECK.exec(raw || '');
        const options = m && CHECK_OPTIONS[symbologyOf(m[1])];
        return options ? (options[m[2]] ?? 'unsupported') : undefined;
      },
      write: () => null,
    };

    /** The add-on (0, 2 or 5 digits) of the WPC types: written in the type character, so changing it re-emits the command. */
    const addonField = {
      key: 'addon', label: 'Complemento', type: 'select', group: 0, reemit: true,
      options: selector.addonOptions(),
      model: item => (isWpc(item.symbology) ? (item.addon ?? 0) : undefined),
      read: raw => {
        const m = TYPE_AND_CHECK.exec(raw || '');
        return m && Object.hasOwn(WPC_TYPES, m[1]) ? WPC_TYPES[m[1]].addon : undefined;
      },
      write: () => null,
    };

    /**
     * Changes the symbology, check digit and / or add-on of a barcode: the format command is emitted again for the item with the new
     * values (parameters() above) and replaces the old one (its {XBnn;x,y, head, its coordinates and any "=data" / ";link" after
     * the parameters stay as written; the RB data command is not touched). Carried over: position, rotation, height, readable
     * flag, module / widths, counters; the check digit when the new type has that option (within the same family: EAN / UPC to EAN /
     * UPC, or Code 39 / ITF / Code 128 among themselves), else the default of the new type (none; automatic for EAN / UPC); the add-on
     * of the EAN / UPC types (it is part of the type character); the type character (B) and the Code 39 / ITF start/stop option when
     * staying in the widths form; the guard bar length when staying in the generic form. Code 39 -> ITF writes the inter-character
     * space 00 (manual).
     * null (refuse, text unchanged): the current or new symbology has no row, an invalid value, a start/stop option or a guard bar
     * that the generic form cannot hold, an add-on that the new type cannot carry, an EAN / UPC price check digit (4 / 5) that is not
     * replaced, or nothing changes. The editors have no diagnostics path, so nothing is dropped silently.
     */
    function reemit({ stripped, span }, item, changes, { dpi }) {
      const from = item.symbology;
      const to = Object.hasOwn(changes, 'symbology') ? changes.symbology : from;
      if (!TYPE_CODES[from] || !selector.symbologyOptions(TYPE_CODES).some(o => o.value === to)) return null;
      const checks = Object.hasOwn(CHECK_CODES, to) ? CHECK_CODES[to] : {};
      if (Object.hasOwn(changes, 'check') && !Object.hasOwn(checks, changes.check)) return null;
      const addonFrom = isWpc(from) ? (item.addon ?? 0) : 0;
      const addon = Object.hasOwn(changes, 'addon') ? changes.addon : addonFrom;
      if (!ADDONS.includes(addon) || (addon > 0 && !isWpc(to))) return null;
      if (to === from && addon === addonFrom && !Object.hasOwn(changes, 'check')) return null;
      if (hasGenericCheck(from) && item.check === 'unsupported' && !Object.hasOwn(changes, 'check')) return null;
      const sameFamily = isWpc(from) === isWpc(to);
      const check = Object.hasOwn(changes, 'check') ? changes.check : (sameFamily && Object.hasOwn(checks, item.check) ? item.check : defaultCheck(to));
      if (to === from && addon === addonFrom && check === (item.check ?? defaultCheck(from))) return null;
      const head = /^\{XB\d+;\d+,\d+,/.exec(stripped);
      if (!head || !stripped.endsWith('|}')) return null;
      const native = item.native || {};
      const rest = stripped.slice(head[0].length);
      const cut = rest.search(/[=;]/);
      // Guard bar (ooo) of the generic form: the 7th parameter from the type character on
      const guard = (rest.slice(0, cut < 0 ? -2 : cut).split(',')[6] || '');
      const [fromForm, toForm] = [FORM_OF[from], FORM_OF[to]];
      if (fromForm === 'widths' && toForm !== 'widths' && native.startStop) return null;
      if (fromForm === 'generic' && toForm !== 'generic' && /[1-9]/.test(guard)) return null;
      // Industrial 2 of 5 writes its wide space as 00: leaving it, the wide space is the wide bar again; MSI and ITF write no space between characters
      const leavingNoWideSpace = from === NO_WIDE_SPACE && to !== NO_WIDE_SPACE && item.widths;
      const next = {
        ...item, symbology: to, check, addon, interCharGap: NO_GAP.includes(to) ? 0 : (NO_GAP.includes(from) ? undefined : item.interCharGap),
        ...(leavingNoWideSpace && { widths: { ...item.widths, wideSpace: item.widths.wideBar } }),
      };
      const ctx = PB.emit.createContext({ dpi, language: 'tpcl' });
      const keep = {
        ...(to === from && addon === addonFrom && native.type && { type: native.type }),
        checkDigit: '1',
        ...(fromForm === 'widths' && toForm === 'widths' && native.startStop && { startStop: native.startStop }),
        ...(fromForm === 'generic' && toForm === 'generic' && guard !== '' && { guard }),
      };
      const suffix = cut < 0 ? '' : rest.slice(cut, -2);
      return `${head[0]}${parameters(next, ctx, sharedValues(next, ctx), keep)}${suffix}|}`;
    }

    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [
        {
          // Code 39 / ITF / MSI / NW7 / Industrial 2 of 5: XBnn;x,y,<type>,<e check digit>,<ff narrow bar>,<gg narrow space>,<hh wide bar>,<ii wide space>,
          //   <jj inter-character space>,<k rotation>,<llll height 0.1 mm>,<p human readable>[,<qq zero suppression>][,<r T|P|N start/stop>]
          // Verified only for the legacy [ESC]XB form of the B-SX4T specification (research T9). The {XB…|} form is the
          // same command but is NOT verified for B-EX4 / B-FV4 / B-EP4.
          pattern: /^XB(\d+);(\d+),(\d+),([1234BO]),(.*)$/,
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
            if (startStop) ctx.report(diag.warning(`${ref}: opción de inicio/parada "${startStop}" no verificada por el visor, se dibuja con inicio y parada automáticos`));
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
          // Skips well-formed QR commands (T,<ecc>,<cell>…) and Data Matrix commands (Q,<ecc>,<cell>,<id>,<rotation>…), which their
          // slices parse: handler order never decides between them. A malformed type T command still ends up here (symbology 'qr').
          pattern: /^XB(\d+);(\d+),(\d+),(?!T,\w,\d|Q,\d+,\d+,\d+,[0-3](?:[,=;]|$))([^,]),(.*)$/,
          handle(m, cmd, ctx) {
            const ref = 'XB' + m[1];
            const p = m[5].split(',');
            const wpc = Object.hasOwn(WPC_TYPES, m[4]) ? WPC_TYPES[m[4]] : null;
            ctx.addField(ref, {
              kind: 'barcode', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
              symbology: symbologyOf(m[4]), module: (+p[1] || 2) * ctx.dot, rotation: ROTATIONS[p[2]] ?? 0, height: +p[3] || 100,
              // WPC types: the add-on is part of the type, the check digit option and the guard bar length (0.1 mm) are neutral fields
              ...(wpc && { addon: wpc.addon, check: CHECK_OPTIONS[wpc.symbology][p[0]] ?? 'unsupported', guard: DIGITS.test(p[5]) ? +p[5] : 0 }),
              ...(symbologyOf(m[4]) === 'code93' && { check: CHECK_OPTIONS.code93[p[0]] ?? 'unsupported' }),
              native: { type: m[4], module: +p[1] || 2, ...((wpc || symbologyOf(m[4]) === 'code93') && { checkDigit: p[0] }) },
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
          applies: item => item.kind === 'barcode' && ['1', '2', '3', '4', 'B', 'O'].includes(item.native && item.native.type),
          pattern: /^\{XB\d+;\d+,\d+,[1234BO],(?:[^,]*,){6}(\d+),(\d+)((?:,[+-]\d{10})?),([^,;|]*)((?:,\d{2})?)/d,
          fields: [symbologyField, checkField, barcodeHeight(2), rotationField(1), counterField(3, true), humanReadableField(4), zeroField(5)],
          reemit,
        },
        { // Other 1D barcodes: …,<type>,<check>,<module>,<rotation>,<height>,<increment>,<000>,<human readable>(,<zero suppression>)
          applies: item => item.kind === 'barcode',
          pattern: /^\{XB\d+;\d+,\d+,[^,],[^,]*,(\d+),(\d+),(\d+),([^,]*),[^,]*,([^,;|]*)((?:,\d{2})?)/d,
          reemit,
          fields: [
            symbologyField, checkField, addonField,
            numberField('module', 'Módulo (puntos)', 1, 1, 99, item => item.native.module),
            barcodeHeight(3), rotationField(2), counterField(4, false), humanReadableField(5), zeroField(6),
          ],
        },
      ],
    };
  }

  PB.slices.barcode.tpcl = tpcl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
