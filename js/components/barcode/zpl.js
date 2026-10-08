/**
 * Barcode slice, ZPL language (Zebra): the linear barcode commands.
 *   ^BYw,r,h                the module width, wide / narrow ratio and default height of the barcodes that follow (persistent, js/languages/zpl.js)
 *   ^FOx,y ^BCo,h,f,g,e,m ^FDdata ^FS     (^FT instead of ^FO: the base of the bars)
 * Parameter layouts of the 2003 guide (Volume One): o = orientation (N R I B, default ^FW), h = height in dots (default ^BY), f = print the
 * interpretation line (Y, default Y), g = line above the code (Y / N, default N).
 *   ^BC  Code 128          o,h,f,g,e,m   e = UCC check digit (default N), m = mode N / U / A (the guide) and D (later guides)
 *   ^B3  Code 39           o,e,h,f,g     e = Mod 43 check digit (Y / N, default N)
 *   ^B2  Interleaved 2/5   o,h,f,g,e     e = Mod 10 check digit (default N)
 *   ^BE  EAN-13            o,h,f,g       data: 12 characters (the printer pads / truncates on the left)
 *   ^B8  EAN-8             o,h,f,g       data: 7 characters
 *   ^BU  UPC-A             o,h,f,g,e     e = print the check digit (default Y); data: 11 characters
 *   ^B9  UPC-E             o,h,f,g,e     e = print the check digit (default Y); data: 10 characters (manufacturer and product code, the
 *                                        printer calculates the shortened version: the viewer keeps the zero-suppressed 6 digits)
 *   ^BA  Code 93           o,h,f,g,e     e = print the check digit (default N; the check characters are always in the bars)
 *   ^BK  Codabar (ANSI)    o,e,h,f,g,k,l e fixed N; k / l = start / stop character A..D (default A); the data has neither
 *   ^BM  MSI               o,e,h,f,g,e2  e = A none, B 1 Mod 10 (default), C 2 Mod 10, D 1 Mod 10 and 1 Mod 11; e2 = start character (Y / N)
 *   ^BI  Industrial 2/5    o,h,f,g       ^BJ  Standard 2 of 5: same layout; the viewer draws it as Industrial 2 of 5 (one info)
 * Postnet, Planet, Code 11, LOGMARS, Plessey, Code 49, Codablock, PDF417 and MaxiCode are out of scope (the field is reported as unsupported).
 *
 * ---- Neutral item (js/core/model.js) -----------------------------------------------------------------------------------------------
 * symbology: the neutral name; module = ^BY w in dots -> 0.1 mm; the wide / narrow symbologies (Code 39, ITF, Codabar, MSI, Industrial 2/5) get
 * widths { narrowBar, narrowSpace, wideBar, wideSpace } with the wide element = floor(w * r) dots (the guide's Table J: the printer rounds to
 * whole dots, and its table shows the lower value), interCharGap = the module (0 for ITF and MSI); the others have a fixed ratio and no widths.
 * check: Code 39 e -> none | mod43, ITF e -> none | auto (modulus 10 attached), MSI e -> none | auto | mod1010 | mod1110, EAN / UPC / Code 93 'auto'
 * (the check digit is always part of the symbol), Codabar and Industrial 2/5 'none'. humanReadable = f. data: Code 128 `>` invocation
 * codes are decoded (FNC1 = PB.barcodeData.FNC1), the Codabar data carries its start and stop letters, the UPC-E data is the 6 digits.
 * native: { type: the command name, module, ratio (^BY at that field), height (dots as written, null = from ^BY), origin: 'FO' | 'FT' | 'default',
 * orientationArg, above (g), zplData (the data as written, decoded of ^FH: emit writes it back when it still stands for the item's data), and
 * the command extras: ucc / mode (^BC), printCheck (^BU ^B9 ^BA), k / l (^BK), e2 (^BM) }.
 *
 * ---- Position ---------------------------------------------------------------------------------------------------------------------
 * The renderer rotates a barcode around its anchor (item.x, item.y), the top-left corner of the unrotated bars (what TPCL and TSPL give). With
 * H = the height of the bars and W = their length (PB.slices.barcode.measure; the human-readable line is not counted):
 *   ^FO is "the upper-left corner of the field area ... independent of the rotation" (guide): the bounding box of the rotated bars, so
 *       the anchor is FO + (0,0) for N, (H,0) for R, (W,H) for I and (0,W) for B.
 *   ^FT "the origin is at the base of the bar code, even when an interpretation is present below" (guide): the corner of the bars where
 *       they start, at their base; the anchor is FT + (0,-H) for N, (H,0) for R, (0,H) for I and (-H,0) for B. It needs no length.
 * NOT VERIFIED on a printer: that the ^FO box holds only the bars (the interpretation line may belong to it), and the length of rotated bars
 * with variables (<#NAME#>), which is measured on the text as written. The guide does not document the default ratio of ^BY (only the
 * initial module 2 and height 10): 3.0 is assumed, as in js/languages/zpl.js.
 *
 * ---- Not drawn / approximated -------------------------------------------------------------------------------------------------------
 * The line above the code (g) is drawn below; the UCC check digit and the modes U / A / D of ^BC are not applied; mode N uses subset B unless the
 * data gives a start code, while the viewer's Code 128 chooses the subsets itself (the drawn length can differ; reported); the EAN / UPC
 * data is not padded or truncated as the printer does (the viewer reports data of the wrong length); the full ASCII of Code 39 / Code 93 is not drawn.
 *
 * ---- Emit (the inverse) -----------------------------------------------------------------------------------------------------------------
 * Every barcode field is preceded by its own ^BY (module, and the ratio for the wide / narrow symbologies): the simplest rule that never
 * depends on what an earlier barcode left in the printer. The parameters of the command are always written complete (o,h,f,g and e) except
 * the optional trailing ones (m, k, l, e2). ^FO when the item came from a ^FO field (or has no origin and a rotation of 0 / 90), else ^FT.
 * TPCL / TSPL features ZPL lacks are reported once per label: the EAN / UPC add-on (dropped from the data), the price check digits, the
 * guard bar length, counters, types without a ZPL command (skipped), a module outside 1..10 dots and a ratio outside 2.0..3.0.
 *
 * ---- Editing ----------------------------------------------------------------------------------------------------------------------
 * The type selector re-emits the whole command (the parameter layouts differ) and keeps ^FO / ^FT, ^FD and everything else byte for byte; it
 * refuses when it would lose a Code 128 invocation code, a UCC check / mode, Codabar start / stop characters or an MSI e2.
 * The module and ratio live in ^BY, which persists and may govern other barcodes. RULE: the argument is rewritten in place when the ^BY that
 * sets it (the last one before the field that sets that parameter) is seen by no other barcode field; otherwise a field-local ^BY with the new
 * value goes right before the field and a ^BY with the previous value right after its ^FS, so the following barcodes are not affected
 * (a barcode with no ^BY at all and no other barcode gets a plain ^BY before it). A ^BY inside the field that others share is not rewritten (refused).
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  const { diagnostics: diag, barcodeData } = PB;
  const { selector } = PB.slices.barcode;

  /** Command table: the symbology and the order of the parameters (after the command name) of each command. */
  const COMMANDS = Object.freeze({
    BC: { symbology: 'code128', params: ['o', 'h', 'f', 'g', 'e', 'm'] },
    B3: { symbology: 'code39', params: ['o', 'e', 'h', 'f', 'g'] },
    B2: { symbology: 'itf', params: ['o', 'h', 'f', 'g', 'e'] },
    BE: { symbology: 'ean13', params: ['o', 'h', 'f', 'g'] },
    B8: { symbology: 'ean8', params: ['o', 'h', 'f', 'g'] },
    BU: { symbology: 'upca', params: ['o', 'h', 'f', 'g', 'e'] },
    B9: { symbology: 'upce', params: ['o', 'h', 'f', 'g', 'e'] },
    BA: { symbology: 'code93', params: ['o', 'h', 'f', 'g', 'e'] },
    BK: { symbology: 'codabar', params: ['o', 'e', 'h', 'f', 'g', 'k', 'l'] },
    BM: { symbology: 'msi', params: ['o', 'e', 'h', 'f', 'g', 'e2'] },
    BI: { symbology: 'industrial25', params: ['o', 'h', 'f', 'g'] },
    BJ: { symbology: 'industrial25', params: ['o', 'h', 'f', 'g'] },
  });
  const NAMES = Object.freeze(Object.keys(COMMANDS));

  /** What the parameter e means in each command: the neutral check option, the print flag of the check digit, the UCC check, or nothing (fixed). */
  const E_ROLE = Object.freeze({ BC: 'ucc', B3: 'check', B2: 'check', BM: 'check', BU: 'print', B9: 'print', BA: 'print', BK: 'fixed' });
  const E_DEFAULT = Object.freeze({ BC: 'N', B3: 'N', B2: 'N', BM: 'B', BU: 'Y', B9: 'Y', BA: 'N', BK: 'N' });

  /** The command of each selectable symbology (the selector's emit table), and the e parameter of each check option (the selector's check table). */
  const TYPE_CODES = Object.freeze({ code128: 'BC', code39: 'B3', itf: 'B2', code93: 'BA', codabar: 'BK', msi: 'BM', industrial25: 'BI', ean13: 'BE', ean8: 'B8', upca: 'BU', upce: 'B9' });
  const CHECK_CODES = Object.freeze({
    code39: { none: 'N', mod43: 'Y' }, itf: { none: 'N', auto: 'Y' }, msi: { none: 'A', auto: 'B', mod1010: 'C', mod1110: 'D' },
    // The commands without a check parameter (the check characters / digit are always part of the symbol): the option is listed, nothing is written
    code93: { auto: '' }, codabar: { none: '' }, industrial25: { none: '' }, ean13: { auto: '' }, ean8: { auto: '' }, upca: { auto: '' }, upce: { auto: '' },
  });
  PB.slices.barcode.zplTables = Object.freeze({ COMMANDS, TYPE_CODES, CHECK_CODES });

  const isWpc = symbology => Object.hasOwn(PB.ean.NAMES, symbology);
  const defaultCheck = symbology => (isWpc(symbology) || symbology === 'code93' ? 'auto' : 'none');
  /** Symbologies with a wide / narrow ratio (the others have a fixed one: ^BY r has no effect on them). */
  const WIDE_NARROW = Object.freeze(['code39', 'itf', 'codabar', 'msi', 'industrial25']);
  /** Symbologies without a space between characters. */
  const NO_GAP = Object.freeze(['itf', 'msi']);
  const PRINT_GROUP = Object.freeze(['BU', 'B9', 'BA']);
  /** The symbologies whose data this slice validates at emit besides EAN / UPC (PB[symbology].encode). */
  const LINEAR = Object.freeze(['code93', 'codabar', 'msi', 'industrial25']);

  /** ^BY limits (the guide) and the power-up values of the module and ratio (the guide gives module 2 and height 10; the ratio 3.0 is assumed). */
  const MODULE_RANGE = Object.freeze([1, 10]);
  const RATIO_RANGE = Object.freeze([2, 3]);
  const BY_DEFAULT = Object.freeze({ module: 2, ratio: 3, height: 10 });
  const MAX_HEIGHT = 32000;
  /** Height of a freshly inserted barcode, in 0.1 mm (8 mm, like TPCL and TSPL). */
  const TEMPLATE_HEIGHT = 80;

  const MODES = Object.freeze(['N', 'U', 'A']);
  const START_STOP = Object.freeze(['A', 'B', 'C', 'D']);

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  /** The wide element in whole dots for a module and a ratio (Table J of the guide rounds down). */
  const wideDots = (module, ratio) => Math.floor(module * ratio + 1e-9);
  const formatRatio = r => (Number.isInteger(r) ? r.toFixed(1) : String(r));

  // ---------------------------------------------------------------------------------------------------------------
  // Data: ZPL field data <-> neutral data (pure functions, shared by parse, emit and the editing)

  /** The 6 zero-suppressed digits of a UPC-E from the 10 characters (manufacturer + product code) of ^B9, or null when no rule applies. */
  function upceFrom(ten) {
    const m = ten.slice(0, 5);
    const p = ten.slice(5);
    if ('012'.includes(m[2]) && m.slice(3) === '00' && p.slice(0, 2) === '00') return m[0] + m[1] + p.slice(2) + m[2];
    if (m.slice(3) === '00' && p.slice(0, 3) === '000') return m.slice(0, 3) + p.slice(3) + '3';
    if (m[4] === '0' && p.slice(0, 4) === '0000') return m.slice(0, 4) + p[4] + '4';
    if (p.slice(0, 4) === '0000' && '56789'.includes(p[4])) return m + p[4];
    return null;
  }

  /**
   * Field data as written (^FH decoded) -> { data, notes } for a command. Code 128: `>8` FNC1, `>0` `><` `>=` the characters > ^ ~; the start codes
   * and subset changes (>9 >: >; >5 >6 >7) are dropped (the viewer chooses the subsets) and flagged in notes.subsets; DEL / FNC2 / FNC3 / SHIFT
   * (>1 >2 >3 >4) and unknown codes are dropped and listed in notes.dropped. UPC-E: the 10 characters become the 6 digits (notes.upceFail
   * when no zero suppression rule applies). Codabar: the start and stop letters (p.k, p.l) go around the data.
   */
  function decodeData(name, value, p = {}) {
    const notes = { subsets: false, dropped: [], upceFail: false };
    if (name === 'BC') {
      let data = '';
      for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (c !== '>' || i === value.length - 1) { data += c; continue; }
        const code = value[++i];
        if (code === '8') data += barcodeData.FNC1;
        else if (code === '0') data += '>';
        else if (code === '<') data += '^';
        else if (code === '=') data += '~';
        else if ('9:;567'.includes(code)) notes.subsets = true;
        else notes.dropped.push(`>${code}`);
      }
      return { data, notes };
    }
    if (name === 'B9') {
      const six = /^\d{10}$/.test(value) ? upceFrom(value) : null;
      if (six === null) notes.upceFail = true;
      return { data: six === null ? value : six, notes };
    }
    if (name === 'BK') return { data: `${p.k || 'A'}${value}${p.l || 'A'}`, notes };
    return { data: value, notes };
  }

  /** The inverse for an item: { data, k?, l?, upceInvalid?, upceSystem? } as written after ^FD (before the ^FH escapes). */
  function encodeData(item) {
    const data = String(item.data ?? '');
    if (item.symbology === 'code128') return { data: data.replaceAll('>', '>0').replaceAll(barcodeData.FNC1, '>8') };
    if (item.symbology === 'upce') {
      if (!/^\d{6,8}$/.test(data)) return { data, upceInvalid: true };
      const system = data.length === 6 ? '0' : data[0];
      return { data: PB.ean.upceToUpca(data).slice(1, 11), upceSystem: system };
    }
    if (item.symbology === 'codabar') {
      const body = [...data];
      const k = body.length && START_STOP.includes(body[0]) ? body.shift() : undefined;
      const l = body.length && START_STOP.includes(body.at(-1)) ? body.pop() : undefined;
      return { data: body.join(''), k, l };
    }
    return { data };
  }

  /** Neutral check option of a command from its e parameter (undefined: the symbology has none, Code 128). */
  function checkOf(name, e) {
    switch (name) {
      case 'B3': return e === 'Y' ? 'mod43' : 'none';
      case 'B2': return e === 'Y' ? 'auto' : 'none';
      case 'BM': return { A: 'none', B: 'auto', C: 'mod1010', D: 'mod1110' }[e || 'B'] || 'auto';
      case 'BE': case 'B8': case 'BU': case 'B9': case 'BA': return 'auto';
      case 'BK': case 'BI': case 'BJ': return 'none';
      default: return undefined;
    }
  }

  /** The command of the barcode field (the last of its commands that is a barcode command). */
  const barcodeCmd = field => field.findAll(NAMES).pop();
  /** Raw value (upper case) of a parameter of a command: '' when absent or empty; undefined when the command has no such parameter. */
  function param(cmd, key) {
    const i = COMMANDS[cmd.name].params.indexOf(key);
    return i < 0 ? undefined : cmd.args[i] ? cmd.args[i].raw.toUpperCase() : '';
  }
  const paramIndex = (cmd, key) => COMMANDS[cmd.name].params.indexOf(key);

  function zpl(helpers) {
    const {
      sourceOf, int, ROTATIONS, rotationOf, orientationOf, toDots, fieldData, fo, ft, commands, byValues, isImmediate, argEdit,
      contentField, insertCommand, freePlaceholder, itemRotation, dropDots, lengthDots,
    } = helpers;

    const dotMm = ctx => PB.units.dotSize(ctx.dpi);
    const measure = item => PB.slices.barcode.measure(item);

    // -------------------------------------------------------------------------------------------------------------
    // Position: the anchor of the renderer <-> the origin of the field (see the header)

    /** Anchor - origin in 0.1 mm for the bounding box of the rotated bars (^FO). */
    const FO_OFFSET = (rotation, h, w) => ({ 0: { x: 0, y: 0 }, 90: { x: h, y: 0 }, 180: { x: w, y: h }, 270: { x: 0, y: w } })[rotation];
    /** Anchor - origin in 0.1 mm for the base of the bars (^FT). */
    const FT_OFFSET = (rotation, h) => ({ 0: { x: 0, y: -h }, 90: { x: h, y: 0 }, 180: { x: 0, y: h }, 270: { x: -h, y: 0 } })[rotation];

    // -------------------------------------------------------------------------------------------------------------
    // Palette

    /** Adds ^BY2,3,h ^FOx,y ^BCo,h,Y,N,N ^FD<#CODIGOn#> ^FS (Code 128, 8 mm tall) before ^XZ at the drop point, upright in the rotated view. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const height = Math.min(MAX_HEIGHT, lengthDots(options, TEMPLATE_HEIGHT));
      return insertCommand(text, `^BY${BY_DEFAULT.module},${BY_DEFAULT.ratio},${height}^FO${x},${y}^BC${orientationOf(itemRotation(options))},${height},Y,N,N^FD${freePlaceholder(text, 'CODIGO')}^FS`);
    }

    // -------------------------------------------------------------------------------------------------------------
    // Parse

    /** All the parameters of a command as upper-case raw text, by name. */
    function paramsOf(cmd) {
      const out = {};
      COMMANDS[cmd.name].params.forEach((key, i) => { out[key] = cmd.args[i] ? cmd.args[i].raw.toUpperCase() : ''; });
      return out;
    }

    function barcodeItem(ctx, field, cmd) {
      const name = cmd.name;
      const { symbology } = COMMANDS[name];
      const p = paramsOf(cmd);
      const ref = `^${name}`;
      // Orientation: the parameter, else ^FW
      let rotation = rotationOf(ctx.orientation);
      let orientationArg = null;
      if (p.o) {
        const given = rotationOf(p.o[0]);
        if (given === null) ctx.report(diag.warning(`${ref}: orientación "${p.o}" no válida, se usa ${ctx.orientation}`));
        else { rotation = given; orientationArg = p.o[0]; }
      }
      // Height: the parameter, else the one of ^BY
      let heightDots = null;
      if (p.h !== '') {
        const h = int(p.h);
        if (h === null || h < 1 || h > MAX_HEIGHT) ctx.report(diag.warning(`${ref}: altura "${p.h}" no válida, se usa la de ^BY (${ctx.by.height})`));
        else heightDots = h;
      }
      const height = heightDots ?? ctx.by.height;
      const start = p.k === undefined ? undefined : START_STOP.includes(p.k) ? p.k : p.k === '' ? 'A' : null;
      const stop = p.l === undefined ? undefined : START_STOP.includes(p.l) ? p.l : p.l === '' ? 'A' : null;
      if (start === null || stop === null) ctx.report(diag.warning(`${ref}: carácter de inicio o de parada "${start === null ? p.k : p.l}" no válido (A..D), se usa A`));
      const value = field.data.value;
      const { data, notes } = decodeData(name, value, { k: start || 'A', l: stop || 'A' });
      reportData(ctx, name, value, ref, notes);

      const e = p.e === undefined ? undefined : p.e || E_DEFAULT[name];
      const above = p.g === 'Y';
      const humanReadable = p.f !== 'N';
      const dot = ctx.dot;
      const module = ctx.by.module;
      const item = {
        kind: 'barcode', ref: name, source: sourceOf(field), x: 0, y: 0, symbology, module: module * dot, rotation, height: height * dot, humanReadable, data,
      };
      if (WIDE_NARROW.includes(symbology)) {
        const wide = wideDots(module, ctx.by.ratio) * dot;
        item.widths = { narrowBar: module * dot, narrowSpace: module * dot, wideBar: wide, wideSpace: wide };
        item.interCharGap = NO_GAP.includes(symbology) ? 0 : module * dot;
      }
      const check = checkOf(name, e);
      if (check !== undefined) item.check = check;
      if (isWpc(symbology)) item.addon = 0;
      item.native = {
        type: name, module, ratio: ctx.by.ratio, height: heightDots, orientationArg, above, zplData: value,
        ...(name === 'BC' && { ucc: e === 'Y', mode: p.m || 'N' }),
        ...(PRINT_GROUP.includes(name) && { printCheck: e === 'Y' }),
        ...(name === 'BK' && { k: start || 'A', l: stop || 'A' }),
        ...(name === 'BM' && { e2: p.e2 || 'N' }),
      };
      const o = ctx.origin(field);
      item.native.origin = o.kind;
      // The anchor from the origin of the field (see the header): ^FT needs no length, ^FO needs it for 180 and 270
      const h = height * dot;
      const off = o.kind === 'FT' ? FT_OFFSET(rotation, h) : FO_OFFSET(rotation, h, rotation === 180 || rotation === 270 ? measure(item) : 0);
      item.x = o.x + off.x;
      item.y = o.y + off.y;
      if (above) ctx.once('zpl-barcode-above', () => diag.info('Hay códigos de barras con la línea de interpretación sobre el código (parámetro g): el visor la dibuja debajo'));
      if (item.native.ucc || (name === 'BC' && item.native.mode !== 'N')) {
        ctx.once('zpl-barcode-bc-extras', () => diag.info('Code 128 con dígito de control UCC (e) o modo U / A / D (m): el visor lo dibuja como un Code 128 normal'));
      }
      if (name === 'BJ') ctx.once('zpl-barcode-bj', () => diag.info('^BJ (2 de 5 estándar) se dibuja como 2 de 5 industrial (no verificado en impresora)'));
      return item;
    }

    /** The notes of the data decoding as diagnostics (see decodeData). */
    function reportData(ctx, name, value, ref, notes) {
      if (notes.subsets) ctx.once('zpl-bc-subsets', () => diag.info('Code 128: los códigos de inicio y de cambio de subconjunto (>9 >: >; >5 >6 >7) se omiten: el visor elige los subconjuntos solo'));
      if (notes.dropped.length) ctx.report(diag.warning(`${ref}: códigos de invocación no soportados por el visor (${notes.dropped.join(', ')}), se omiten`));
      if (notes.upceFail) {
        ctx.report(diag.warning(`${ref}: los datos (${value.slice(0, 12)}) no son los 10 dígitos de un UPC-E que se puedan abreviar con las reglas de la guía; se dibujan tal cual y el visor los reporta`));
      }
      if (name === 'BC' && !/^>[9:;]/.test(value) && /\d{4}/.test(value)) {
        ctx.once('zpl-bc-subset-b', () => diag.info('Code 128 en modo N usa el subconjunto B salvo que los datos indiquen otro (>9 >: >;): el visor elige los subconjuntos solo y la longitud dibujada puede diferir'));
      }
    }

    // -------------------------------------------------------------------------------------------------------------
    // Emit

    /** Rotation in degrees: the nearest quarter turn, with a warning once if the item was not on one. */
    function rotationDegrees(ctx, rotation) {
      const turns = Number.isFinite(rotation) ? Math.round(rotation / 90) : 0;
      const degrees = (((turns * 90) % 360) + 360) % 360;
      if (degrees !== rotation && !(rotation == null && degrees === 0)) {
        ctx.once('zpl-barcode-rotation', () => diag.warning('Hay códigos de barras con una rotación que no es múltiplo de 90°: se ajustan al giro más cercano'));
      }
      return degrees;
    }

    /** One warning per symbology when the data of an EAN / UPC / Code 93 / NW7 / MSI / Industrial 2 of 5 barcode cannot be encoded (variables stand for values not known here). */
    function dataWarning(ctx, item, data) {
      if (PB.variables.namesIn(data).length) return;
      let encoded = null;
      if (isWpc(item.symbology)) encoded = PB.ean.encode(item.symbology, data, { check: item.check, addon: item.addon });
      else if (LINEAR.includes(item.symbology)) {
        const out = PB[item.symbology].encode(data, { check: 'none' });
        encoded = { ok: (out.widths || out.elements).length > 0, warnings: out.warnings };
      }
      if (encoded && !encoded.ok) ctx.once(`zpl-data-${item.symbology}`, () => diag.warning(`Hay códigos de barras con datos que no son válidos para su tipo (${encoded.warnings[0]}): la impresora puede rechazarlos`));
    }

    /** The check option of the item for its command: the e parameter value, with the fallback and its warning when ZPL has no such option. */
    function checkCode(ctx, item) {
      const { symbology } = item;
      const table = CHECK_CODES[symbology];
      if (item.check === 'unsupported') {
        ctx.once('zpl-check-unsupported', () => diag.warning('Hay códigos de barras con un dígito de control de precio de TPCL, que ZPL no tiene: se escriben con el dígito de control automático'));
        return table[defaultCheck(symbology)];
      }
      const check = item.check ?? defaultCheck(symbology);
      if (Object.hasOwn(table, check)) return table[check];
      const fallback = defaultCheck(symbology);
      ctx.once(`zpl-check-${symbology}`, () => diag.warning(`Código de barras ${symbology}: dígito de control "${check}" sin equivalente en ZPL, se escribe ${fallback === 'auto' ? 'con dígito de control automático' : 'sin dígito de control'}`));
      return table[fallback];
    }

    /** Module in dots (1..10) and the ratio for ^BY: the ratio whose rounded wide bar is the item's (see the header); warns once when out of range. */
    function byValuesOf(ctx, item) {
      const raw = toDots(ctx, item.module);
      const module = clamp(Math.max(1, raw), ...MODULE_RANGE);
      if (module !== raw) ctx.once('zpl-barcode-module', () => diag.warning('Hay códigos de barras con módulo fuera de 1..10 puntos: se ajustan al límite de ZPL (^BY)'));
      if (!WIDE_NARROW.includes(item.symbology)) return { module };
      const w = item.widths;
      if (!w || !(w.narrowBar > 0) || !Number.isFinite(w.wideBar)) {
        ctx.once('zpl-ratio-default', () => diag.info('Código de barras sin anchos explícitos: se escriben con relación 3:1 a partir del módulo'));
        return { module, ratio: BY_DEFAULT.ratio };
      }
      const wide = Math.max(1, toDots(ctx, w.wideBar));
      const native = item.native && item.native.ratio;
      if (Number.isFinite(native) && native >= RATIO_RANGE[0] && native <= RATIO_RANGE[1] && wideDots(module, native) === wide) return { module, ratio: native };
      const ratio = Math.ceil((wide / module) * 10 - 1e-9) / 10;
      if (ratio < RATIO_RANGE[0] || ratio > RATIO_RANGE[1]) {
        ctx.once('zpl-ratio-range', () => diag.info('ZPL solo admite relación ancho / estrecho entre 2.0 y 3.0 (^BY): se ajusta al límite'));
        return { module, ratio: clamp(ratio, ...RATIO_RANGE) };
      }
      return { module, ratio };
    }

    /** Commands the item can be written as: the one it was read from when it still stands for it (^BJ), else the selector's one. */
    function nameOf(item) {
      const native = item.native && item.native.type;
      return typeof native === 'string' && Object.hasOwn(COMMANDS, native) && COMMANDS[native].symbology === item.symbology ? native : TYPE_CODES[item.symbology];
    }

    /** Notes about what the model has and ZPL lacks (once per label each). */
    function noteLosses(ctx, item) {
      if (isWpc(item.symbology) && item.addon > 0) {
        ctx.once('zpl-addon', () => diag.warning('Hay códigos EAN / UPC con complemento (+2 / +5), que ZPL no tiene: se escriben sin el complemento (sus dígitos se quitan de los datos)'));
      }
      if (isWpc(item.symbology) && item.guard > 0) ctx.once('zpl-guard', () => diag.info('La longitud de la barra de guarda de los códigos EAN / UPC de TPCL no se escribe en ZPL'));
      if (item.counter) ctx.once('zpl-barcode-counter', () => diag.warning('Hay códigos de barras con contador: ZPL los escribe como datos fijos con el valor inicial (el contador ^SN aún no se escribe)'));
      if (item.zeroSuppress) ctx.once('zpl-barcode-zero', () => diag.info('Hay códigos de barras con supresión de ceros, que ZPL no tiene: se escriben sin ella'));
    }

    /** The field data: written back as read when the item's data is still what it decodes to, else encoded from the item. */
    function dataOf(ctx, item, name) {
      const native = item.native || {};
      if (native.type === name && typeof native.zplData === 'string') {
        const again = decodeData(name, native.zplData, { k: native.k, l: native.l });
        if (again.data === item.data) return { data: native.zplData, k: native.k, l: native.l };
      }
      const out = encodeData(item);
      if (out.upceInvalid) ctx.once('zpl-upce-data', () => diag.warning('UPC-E: los datos no son un UPC-E de 6, 7 u 8 dígitos: se escriben tal cual en ^B9'));
      if (out.upceSystem && out.upceSystem !== '0') ctx.once('zpl-upce-system', () => diag.warning('UPC-E con sistema numérico distinto de 0: ^B9 solo lo admite con el 0 (la guía de ZPL), el sistema numérico se pierde'));
      return out;
    }

    /** The value of every parameter a command can have, written complete except the optional trailing ones; trailing empty ones are dropped. */
    function parameterText(name, values) {
      const list = COMMANDS[name].params.map(key => values[key] ?? '');
      while (list.length && list[list.length - 1] === '') list.pop();
      return list.join(',');
    }

    /**
     * ^BYw[,r] and the field ^FO / ^FT x,y ^<cmd><parameters> ^FD data ^FS (see the header for the rules). Only neutral fields are read, plus
     * what native holds for a field that came from ZPL (above, UCC, mode, print check digit, start / stop, the data as written).
     */
    function emit(item, ctx) {
      const name = nameOf(item);
      if (!name) {
        ctx.once('zpl-barcode-skipped', () => diag.warning('Hay códigos de barras sin equivalente en ZPL (solo Code 128, Code 39, ITF, Code 93, NW7, MSI, 2 de 5 industrial y EAN / UPC): no se exportan'));
        return [];
      }
      noteLosses(ctx, item);
      const native = item.native || {};
      const written = dataOf(ctx, item, name);
      dataWarning(ctx, item, String(item.data ?? ''));
      let data = written.data;
      if (isWpc(item.symbology) && item.addon > 0) {
        const { SPECS } = PB.ean;
        const lengths = [...SPECS[item.symbology].bare, SPECS[item.symbology].full];
        if (lengths.includes(data.length - item.addon)) data = data.slice(0, data.length - item.addon);
      }
      const by = byValuesOf(ctx, item);
      const degrees = rotationDegrees(ctx, item.rotation);
      const heightDots = clamp(Math.max(1, toDots(ctx, item.height)), 1, MAX_HEIGHT);
      // The check option is validated for every symbology that has a table, also where the command has no parameter for it (EAN / UPC, Code 93)
      const checkE = Object.hasOwn(CHECK_CODES, item.symbology) ? checkCode(ctx, item) : undefined;
      const e = { check: () => checkE, print: () => (typeof native.printCheck === 'boolean' && PRINT_GROUP.includes(native.type) ? (native.printCheck ? 'Y' : 'N') : E_DEFAULT[name]), ucc: () => (native.ucc ? 'Y' : 'N'), fixed: () => 'N' }[E_ROLE[name]];
      const values = {
        o: orientationOf(degrees), h: String(heightDots), f: item.humanReadable ? 'Y' : 'N', g: native.above ? 'Y' : 'N', e: e ? e() : undefined,
      };
      if (name === 'BC' && native.type === 'BC' && ['U', 'A', 'D'].includes(native.mode)) values.m = native.mode;
      if (name === 'BM' && native.type === 'BM' && native.e2 === 'Y') values.e2 = 'Y';
      if (name === 'BK' && (written.k || written.l)) {
        const [k, l] = [written.k || 'A', written.l || 'A'];
        if (k !== 'A' || l !== 'A') [values.k, values.l] = [k, l];
      }
      // The origin: ^FO unless the rotated bars need their length (180 / 270) and it is unknown, ^FT for the items that are not from a ^FO field
      const h = heightDots * dotMm(ctx);
      const fromFo = native.origin === 'FO' || native.origin === 'default' || (!native.origin && degrees <= 90);
      const length = fromFo && degrees >= 180 ? measure(item) : 0;
      const useFo = fromFo && (degrees < 180 || length > 0);
      const [x, y] = [item.x || 0, item.y || 0];
      let origin;
      if (useFo) {
        const off = FO_OFFSET(degrees, h, length);
        origin = [x - off.x, y - off.y];
      } else {
        const off = FT_OFFSET(degrees, h);
        origin = [x - off.x, y - off.y];
      }
      if (origin.some(v => v < -dotMm(ctx) / 2)) ctx.once('zpl-barcode-origin', () => diag.info('Hay códigos de barras girados cuyo origen queda fuera de la etiqueta (por la izquierda o por arriba): el origen se ajusta a 0'));
      const at = useFo ? fo(ctx, ...origin) : ft(ctx, ...origin);
      const line = `${at}^${name}${parameterText(name, values)}${fieldData(ctx, data)}^FS`;
      return [`^BY${by.module}${by.ratio === undefined ? '' : `,${formatRatio(by.ratio)}`}`, line];
    }

    // -------------------------------------------------------------------------------------------------------------
    // Edit: the ^BY that governs a field

    /**
     * The fields of the whole text with what ^BY says at each one: [{ start, end, barcode, setters: { module, ratio, height } }] where a setter is
     * { cmd, value } of the last ^BY before the end of the field that gave a valid value for that parameter (null: the power-up default).
     * Follows the parser's field rules (a field is closed by ^FS, by the next ^FO / ^FT or by ^XA / ^XZ; the setup commands are not part of it).
     */
    function scanFields(text) {
      const fields = [];
      const state = { module: null, ratio: null, height: null };
      let open = null;
      const close = () => {
        if (open) fields.push({ start: open.start, end: open.end, barcode: open.barcode, setters: { ...state } });
        open = null;
      };
      for (const cmd of commands(text)) {
        const { id } = cmd;
        if (id === '^BY') {
          const v = byValues(cmd);
          for (const key of Object.keys(state)) if (v[key] !== undefined) state[key] = { cmd, value: v[key] };
          continue;
        }
        if (id === '^XA' || id === '^XZ') { close(); continue; }
        if (id === '^FX' || isImmediate(id)) continue;
        if (id === '^FO' || id === '^FT') {
          if (open && open.content) close();
          open = { start: cmd.start, end: cmd.end, barcode: false, content: false };
          continue;
        }
        if (!open) open = { start: cmd.start, end: cmd.end, barcode: false, content: false };
        open.end = cmd.end;
        if (id === '^FS') { close(); continue; }
        if (!['^FD', '^FV', '^FH', '^FR', '^FN', '^FP', '^SN'].includes(id)) open.content = true;
        if (NAMES.includes(cmd.name)) open.barcode = true;
      }
      close();
      return fields;
    }

    const fieldOf = (text, item) => {
      const span = item && item.source && item.source.spans && item.source.spans[0];
      return span ? scanFields(text).find(f => f.start === span.start) : undefined;
    };
    const sameSetter = (a, b) => (a === null || b === null ? a === b : a.cmd.start === b.cmd.start);

    /** The ^BY text of a set of values: ^BY5, ^BY,2.5 or ^BY5,2.5. */
    const byText = values => `^BY${values.module === undefined ? '' : values.module}${values.ratio === undefined ? '' : `,${formatRatio(values.ratio)}`}`;

    /**
     * New module and / or ratio of a barcode field: see the header for the rule. Returns the edits, or null when it changes nothing or refuses.
     * values = { module?, ratio? } already validated.
     */
    function byEdits(text, item, values) {
      const fields = scanFields(text);
      const span = item.source.spans[0];
      const target = fields.find(f => f.start === span.start);
      if (!target || !target.barcode) return null;
      const barcodes = fields.filter(f => f.barcode && f !== target);
      const edits = [];
      const local = {};
      const restore = {};
      for (const key of ['module', 'ratio']) {
        if (values[key] === undefined) continue;
        const setter = target.setters[key];
        const current = setter ? setter.value : BY_DEFAULT[key];
        if (values[key] === current) continue;
        const shared = barcodes.some(f => sameSetter(f.setters[key], setter));
        if (setter && !shared) {
          edits.push(argEdit(setter.cmd, key === 'module' ? 0 : 1, key === 'module' ? String(values[key]) : formatRatio(values[key])));
        } else if (!setter && !shared) {
          local[key] = values[key];
        } else {
          if (setter && setter.cmd.start >= target.start && setter.cmd.start < target.end) return null;
          local[key] = values[key];
          restore[key] = current;
        }
      }
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      if (Object.keys(local).length) {
        const lineStart = Math.max(text.lastIndexOf('\n', target.start - 1), text.lastIndexOf('\r', target.start - 1)) + 1;
        const own = /^[ \t]*$/.test(text.slice(lineStart, target.start));
        edits.push({ start: target.start, end: target.start, value: byText(local) + (own ? eol : '') });
      }
      if (Object.keys(restore).length) {
        const endsLine = /^[ \t]*(\r\n|\r|\n)/.test(text.slice(target.end));
        edits.push({ start: target.end, end: target.end, value: (endsLine ? eol : '') + byText(restore) });
      }
      return edits.length ? edits : null;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Edit: the fields of the panel

    /**
     * A custom field over one parameter of the barcode command: read(raw, cmd, item, text) -> value | undefined (raw = the parameter upper-cased,
     * '' when empty or missing), write(value, cmd) -> the raw text | null, applies(cmd) = the command has it. Nothing is written when the
     * value is the one already in force.
     */
    function parameterField({ key, label, type, param: p, applies = () => true, read, write, ...rest }) {
      const locate = found => {
        const cmd = found && barcodeCmd(found.field);
        return cmd && paramIndex(cmd, p) >= 0 && applies(cmd) ? cmd : undefined;
      };
      const valueOf = (found, item, text) => { const cmd = locate(found); return cmd ? read(param(cmd, p), cmd, item, text) : undefined; };
      return {
        key, label, type, custom: true, ...rest,
        read: (text, found, item) => valueOf(found, item, text),
        edits(text, found, item, value) {
          const cmd = locate(found);
          const raw = cmd ? write(value, cmd) : null;
          if (raw === null || raw === undefined || valueOf(found, item, text) === value) return null;
          return [argEdit(cmd, paramIndex(cmd, p), raw)];
        },
      };
    }

    /** Effective ^BY value of a field (module, ratio, default height): the last ^BY before it that sets it, else the power-up default. */
    const stateValue = (text, item, key) => {
      const f = fieldOf(text, item);
      return f ? (f.setters[key] ? f.setters[key].value : BY_DEFAULT[key]) : undefined;
    };

    /** A Y / N parameter; def = its default (a boolean, or a function of the command). */
    const yesNo = (key, label, p, def, applies) => parameterField({
      key, label, type: 'checkbox', param: p, applies,
      read: (raw, cmd) => (raw === '' ? (typeof def === 'function' ? def(cmd) : def) : raw === 'Y'),
      write: v => (typeof v === 'boolean' ? (v ? 'Y' : 'N') : null),
    });
    const letters = (key, label, p, options, def, applies, extra = []) => parameterField({
      key, label, type: 'select', param: p, applies, options: options.map(value => ({ value, label: value })),
      optionsFor: value => (options.includes(value) ? options.map(v => ({ value: v, label: v })) : [...options, value].map(v => ({ value: v, label: v }))),
      read: raw => (raw === '' ? def : raw),
      write: v => (options.includes(v) || extra.includes(v) ? v : null),
    });
    const isName = (...names) => cmd => names.includes(cmd.name);

    const fields = [];
    /** Type and check: re-emitted as a whole by `reemit`, read from the command here. */
    const symbologyField = {
      key: 'symbology', label: 'Tipo de código', type: 'select', custom: true, reemit: true, options: selector.symbologyOptions(TYPE_CODES),
      model: item => (Object.hasOwn(COMMANDS, item.ref) && Object.hasOwn(TYPE_CODES, item.symbology) ? item.symbology : undefined),
      read: (text, found) => { const cmd = barcodeCmd(found.field); return cmd && Object.hasOwn(TYPE_CODES, COMMANDS[cmd.name].symbology) ? COMMANDS[cmd.name].symbology : undefined; },
      edits: () => null,
    };
    const checkField = {
      key: 'check', label: 'Dígito de control', type: 'select', custom: true, reemit: true,
      optionsFor: (value, item, field) => {
        const cmd = field && barcodeCmd(field);
        const options = selector.checkOptions(CHECK_CODES, cmd ? COMMANDS[cmd.name].symbology : item.symbology);
        return options.some(o => o.value === value) ? options : [...options, { value, label: 'Otro (no editable)' }];
      },
      model: item => (Object.hasOwn(COMMANDS, item.ref) && Object.hasOwn(CHECK_CODES, item.symbology) ? (item.check ?? defaultCheck(item.symbology)) : undefined),
      read: (text, found) => {
        const cmd = barcodeCmd(found.field);
        return cmd && Object.hasOwn(CHECK_CODES, COMMANDS[cmd.name].symbology) ? checkOf(cmd.name, param(cmd, 'e')) : undefined;
      },
      edits: () => null,
    };

    const dotsOf = (item, { dpi }) => (Number.isFinite(item.height) ? Math.round(item.height / PB.units.dotSize(dpi)) : undefined);
    const heightField = parameterField({
      key: 'height', label: 'Alto (puntos)', type: 'number', param: 'h', min: 1, max: MAX_HEIGHT, step: 1, model: dotsOf,
      read: (raw, cmd, item, text) => (/^\d+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : raw === '' ? stateValue(text, item, 'height') : undefined),
      write: v => (typeof v === 'number' && Number.isFinite(v) ? String(clamp(Math.round(v), 1, MAX_HEIGHT)) : null),
    });
    const rotationField = parameterField({
      key: 'rotation', label: 'Rotación', type: 'select', param: 'o', options: ROTATIONS.map(value => ({ value, label: `${value}°` })), model: item => item.rotation,
      read: (raw, cmd, item) => (raw === '' ? item && item.rotation : rotationOf(raw[0]) ?? undefined),
      write: v => (ROTATIONS.includes(v) ? orientationOf(v) : null),
    });

    const moduleField = {
      key: 'module', label: 'Módulo (puntos, ^BY)', type: 'number', min: MODULE_RANGE[0], max: MODULE_RANGE[1], step: 1, custom: true,
      model: item => (item.native && item.native.module !== undefined ? item.native.module : undefined),
      read: (text, found, item) => stateValue(text, item, 'module'),
      edits(text, found, item, value, { changes }) {
        const values = {};
        if (typeof value === 'number' && Number.isFinite(value)) values.module = clamp(Math.round(value), ...MODULE_RANGE);
        else return null;
        if (typeof changes.ratio === 'number' && Number.isFinite(changes.ratio)) values.ratio = clamp(Math.round(changes.ratio * 10) / 10, ...RATIO_RANGE);
        return byEdits(text, item, values);
      },
    };
    const ratioField = {
      key: 'ratio', label: 'Relación ancho / estrecho (^BY)', type: 'number', min: RATIO_RANGE[0], max: RATIO_RANGE[1], step: 0.1, custom: true,
      model: item => (item.widths && item.native && item.native.ratio !== undefined ? item.native.ratio : undefined),
      read: (text, found, item) => {
        const cmd = barcodeCmd(found.field);
        return cmd && WIDE_NARROW.includes(COMMANDS[cmd.name].symbology) ? stateValue(text, item, 'ratio') : undefined;
      },
      edits(text, found, item, value, { changes }) {
        if (changes.module !== undefined) return null; // written together by the module field
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        return byEdits(text, item, { ratio: clamp(Math.round(value * 10) / 10, ...RATIO_RANGE) });
      },
    };

    fields.push(
      symbologyField, checkField, heightField, rotationField,
      yesNo('readable', 'Texto legible', 'f', true),
      yesNo('above', 'Línea de texto sobre el código', 'g', false),
      moduleField, ratioField,
      yesNo('printCheck', 'Imprimir el dígito de control', 'e', cmd => E_DEFAULT[cmd.name] === 'Y', isName('BU', 'B9', 'BA')),
      yesNo('ucc', 'Dígito de control UCC', 'e', false, isName('BC')),
      letters('mode', 'Modo (N, U, A)', 'm', MODES, 'N', isName('BC'), ['D']),
      letters('start', 'Carácter de inicio', 'k', START_STOP, 'A'),
      letters('stop', 'Carácter de parada', 'l', START_STOP, 'A'),
      contentField('content', 'Contenido', item => item.data),
    );

    /**
     * Changes the symbology and / or the check option: the whole command is written again with the layout of the new one (see the header). The
     * parameters o, h, f and g are carried as written; e is the check option, the print flag of the same kind, or the new command's default.
     * null (refuse): not a row of the tables, nothing changes, or information would be lost (Code 128 invocation codes, a UCC check or a
     * mode, Codabar start / stop characters, an MSI e2, a print flag the new command lacks).
     */
    function reemit(field, item, changes) {
      const cmd = barcodeCmd(field);
      if (!cmd) return null;
      const from = COMMANDS[cmd.name].symbology;
      const to = Object.hasOwn(changes, 'symbology') ? changes.symbology : from;
      if (!selector.symbologyOptions(TYPE_CODES).some(o => o.value === to)) return null;
      const checks = Object.hasOwn(CHECK_CODES, to) ? CHECK_CODES[to] : {};
      if (Object.hasOwn(changes, 'check') && !Object.hasOwn(checks, changes.check)) return null;
      const known = checkOf(cmd.name, param(cmd, 'e'));
      const sameFamily = isWpc(from) === isWpc(to);
      const check = Object.hasOwn(changes, 'check') ? changes.check : (sameFamily && Object.hasOwn(checks, known) ? known : defaultCheck(to));
      if (to === from && check === (known ?? defaultCheck(from))) return null;
      const toName = TYPE_CODES[to];
      const lost = [];
      if (cmd.name === 'BC' && to !== from) {
        const data = field.find(['FD', 'FV']);
        if (data && data.args[0] && data.args[0].value.includes('>')) lost.push('invocation');
      }
      const extra = key => { const v = param(cmd, key); return v !== undefined && v !== '' ? v : undefined; };
      if (to !== from) {
        if (extra('e') !== undefined && cmd.name === 'BC' && extra('e') !== 'N') lost.push('ucc');
        if (extra('m') !== undefined && extra('m') !== 'N') lost.push('mode');
        if (['k', 'l'].some(k => extra(k) !== undefined && extra(k) !== 'A')) lost.push('start-stop');
        if (extra('e2') !== undefined && extra('e2') !== 'N') lost.push('e2');
        if (PRINT_GROUP.includes(cmd.name) && !PRINT_GROUP.includes(toName) && extra('e') !== undefined && extra('e') !== E_DEFAULT[cmd.name]) lost.push('print');
      }
      if (lost.length) return null;
      const raw = key => { const i = paramIndex(cmd, key); return i >= 0 && cmd.args[i] ? cmd.args[i].raw : ''; };
      const role = E_ROLE[toName];
      let e;
      if (role === 'check') e = checks[check];
      else if (role === 'print') e = PRINT_GROUP.includes(cmd.name) && param(cmd, 'e') !== '' ? param(cmd, 'e') : E_DEFAULT[toName];
      else if (role === 'ucc') e = cmd.name === toName ? raw('e') || 'N' : 'N';
      else if (role === 'fixed') e = 'N';
      const text = `^${toName}${parameterText(toName, { o: raw('o'), h: raw('h'), f: raw('f'), g: raw('g'), e })}`;
      return [{ start: cmd.start, end: cmd.end, value: text.replace(/^\^/, cmd.raw[0]) }];
    }

    return {
      // emit(item, ctx) -> [^BY..., the field] of a barcode item
      emit,
      // build(text, point, options) -> text with a new barcode field (palette)
      build,
      // Move: the field origin (^FO / ^FT), which is what the default coordinates are
      coordinates: [{ applies: item => item.kind === 'barcode' }],
      editable: [{
        applies: (item, field) => item.kind === 'barcode' && (field ? field.has(NAMES) : Object.hasOwn(COMMANDS, item.ref)),
        fields,
        reemit,
      }],
      handlers: [
        {
          // ^BCo,h,f,g,e,m ^B3 ^B2 ^BE ^B8 ^BU ^B9 ^BA ^BK ^BM ^BI ^BJ ... ^FD data ^FS: a barcode field (no data: nothing to draw)
          pattern: new RegExp(`^\\^(${NAMES.join('|')})$`),
          handle(m, cmd, ctx, field) {
            if (field.data) ctx.addItem(barcodeItem(ctx, field, cmd));
          },
        },
      ],
    };
  }

  PB.slices.barcode.zpl = zpl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
