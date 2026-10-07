/**
 * TPCL parser (language of the TEC/Toshiba printers).
 * Converts TPCL text (.ter file) into a model with the declared size and a list of drawable items.
 * TPCL gives the QR module, the barcode module and the line thickness in printer dots: here they are converted
 * to 0.1 mm with the resolution (dpi) and the original value is kept in item.native.
 *
 * To support a new command: add a handler to HANDLERS (pattern + function) and, if it draws something,
 * a renderer for its "kind" in RENDERERS of drawing.js. Components migrated to a slice (js/components/<id>/, see
 * js/components/registry.js) bring their own TPCL handlers, build template, move coordinates and editable fields in
 * `languages.tpcl`; this file composes them with its tables (ALL_*) and shares its helpers with them (SLICE_HELPERS).
 *
 * The model is the neutral one described in js/core.js. The items also carry kind and raw
 * (values as they were written, only for the TPCL format rules); size.native = { dRaw, axRaw }.
 * The FNC1 of the barcode data (">8" in TPCL) is translated to PB.barcodeData.FNC1.
 */
(function (PB) {
  'use strict';

  const { units, barcodeData, diagnostics: diag } = PB;

  /** TPCL magnification: "08" -> 0.8 ; "14" -> 1.4 ; "1" -> 1. */
  const magnification = s => (s.length >= 2 ? Number(s) / 10 : Number(s));

  /** Number with 4 digits, as TPCL requires ("610" -> "0610"). */
  const pad4 = n => String(n).padStart(4, '0');

  /** FNC1 in the TPCL notation of a barcode's data. */
  const FNC1_NOTATION = />8/g;

  /** QR error correction level: TPCL letter -> neutral level. */
  const ECC_LEVELS = Object.freeze({ L: 'L', M: 'M', Q: 'Q', H: 'H' });
  const DEFAULT_ECC = 'M';

  /**
   * TEC bitmap fonts of the PC command: size in points, family, weight and style they are simulated with.
   * The family (serif/sans/mono) is the "font-…" class of css/label.css.
   */
  const BITMAP_FONTS = Object.freeze({
    A: [8, 'serif', 400], B: [10, 'serif', 400], C: [10, 'serif', 700], D: [12, 'serif', 700], E: [14, 'serif', 700],
    F: [12, 'serif', 400, 'italic'], G: [6, 'sans', 400], H: [10, 'sans', 400], I: [12, 'sans', 400], J: [12, 'sans', 700],
    K: [14, 'sans', 700], L: [12, 'sans', 400, 'italic'], M: [18, 'sans', 700], N: [9.5, 'mono', 400], O: [7, 'mono', 400],
    P: [10, 'mono', 700], Q: [10, 'mono', 400], R: [12, 'mono', 700], S: [12, 'mono', 400], T: [12, 'mono', 400],
  });
  const DEFAULT_BITMAP_FONT = 'J';

  /** Outline font (PV command): always simulated with this family and weight. */
  const OUTLINE_FONT = Object.freeze({ family: 'sans', weight: 700 });

  /** Control commands that draw nothing. */
  const CONTROL_COMMANDS = Object.freeze(['C', 'XS', 'AX', 'XQ']);

  /** Neutral symbology of each TPCL barcode type (the other types are 'unknown'). */
  const SYMBOLOGIES = Object.freeze({ 2: 'itf', 3: 'code39', B: 'code39', 9: 'code128', A: 'code128', T: 'qr' });
  const symbologyOf = type => SYMBOLOGIES[type] || 'unknown';

  /** Check digit option (field e of Code 39 / ITF) -> neutral check; the options not listed are 'unsupported'. */
  const CHECK_OPTIONS = Object.freeze({ code39: { 1: 'none', 3: 'mod43' }, itf: { 1: 'none' } });

  const DIGITS = /^\d+$/;

  /** TPCL rotation in degrees, clockwise: texts 00/11/22/33, barcodes 0/1/2/3. */
  const ROTATIONS = Object.freeze({ '00': 0, '11': 90, '22': 180, '33': 270, 0: 0, 1: 90, 2: 180, 3: 270 });

  /** Data commands (RC, RV, RB) and the format command they fill in. */
  const DATA_TARGET = Object.freeze({ C: 'PC', V: 'PV', B: 'XB' });

  // Options common to PC and PV after the font type: [spacing adjustment,]rotation,attribute[,…][=text]
  const TEXT_TAIL = String.raw`([A-Za-z0-9]),(?:[+-]\d+,)?(\d{2}),([BWF])[^=]*(?:=([\s\S]*))?$`;

  function textAttributes(ctx, ref, rotationCode, attribute) {
    if (!(rotationCode in ROTATIONS)) ctx.report(diag.warning(`${ref}: rotación "${rotationCode}" desconocida, se dibuja sin rotar`));
    if (attribute !== 'B') ctx.report(diag.warning(`${ref}: atributo "${attribute}" no soportado por el visor, se dibuja en negro`));
    return ROTATIONS[rotationCode] ?? 0;
  }

  function bitmapFont(ctx, ref, code, hMag, vMag) {
    let spec = BITMAP_FONTS[code];
    if (!spec) {
      ctx.report(diag.warning(`${ref}: fuente "${code}" desconocida, se dibuja como ${DEFAULT_BITMAP_FONT}`));
      spec = BITMAP_FONTS[DEFAULT_BITMAP_FONT];
    }
    const [points, family, weight, style = 'normal'] = spec;
    const v = magnification(vMag);
    return { size: points * units.UNITS_PER_POINT * v, scaleX: magnification(hMag) / v, family, weight, style };
  }

  /** Item -> position of the command in the source text (a single span: the format command). */
  const sourceOf = cmd => ({ spans: [{ start: cmd.start, end: cmd.end }], label: `{${cmd.raw}|}` });

  const HANDLERS = [
    {
      // Label size: D<pitch>,<width>,<length>
      pattern: /^D(\d+),(\d+),(\d+)/,
      handle(m, cmd, ctx) {
        Object.assign(ctx.model.size, { pitch: +m[1], width: +m[2], height: +m[3] });
        ctx.model.size.native.dRaw = cmd.raw;
      },
    },
    {
      pattern: /^AX;/,
      handle(m, cmd, ctx) { ctx.model.size.native.axRaw = cmd.raw; },
    },
    {
      // Text with a bitmap font
      pattern: new RegExp(String.raw`^PC(\d+);(\d+),(\d+),(\d+),(\d+),` + TEXT_TAIL),
      handle(m, cmd, ctx) {
        const ref = 'PC' + m[1];
        ctx.addField(ref, {
          kind: 'text', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
          font: bitmapFont(ctx, ref, m[6].toUpperCase(), m[4], m[5]),
          rotation: textAttributes(ctx, ref, m[7], m[8]),
          data: m[9] ?? null,
        });
      },
    },
    {
      // Text with an outline font: character width and height in 0.1 mm
      pattern: new RegExp(String.raw`^PV(\d+);(\d+),(\d+),(\d+),(\d+),` + TEXT_TAIL),
      handle(m, cmd, ctx) {
        const ref = 'PV' + m[1];
        const { family, weight } = OUTLINE_FONT;
        ctx.addField(ref, {
          kind: 'text', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
          font: { size: +m[5], scaleX: +m[4] / +m[5], family, weight, style: 'normal' },
          rotation: textAttributes(ctx, ref, m[7], m[8]),
          data: m[9] ?? null,
        });
      },
    },
    {
      // QR code: XBnn;x,y,T,<correction>,<module size>,…
      pattern: /^XB(\d+);(\d+),(\d+),T,(\w),(\d+)/,
      handle(m, cmd, ctx) {
        const ref = 'XB' + m[1];
        if (!(m[4] in ECC_LEVELS)) ctx.report(diag.warning(`${ref}: corrección de errores "${m[4]}" desconocida, se dibuja con ${DEFAULT_ECC}`));
        ctx.addField(ref, {
          kind: 'qr', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3], cell: m[5] },
          ecc: ECC_LEVELS[m[4]] ?? DEFAULT_ECC, cell: +m[5] * ctx.dot, symbology: 'qr', native: { type: 'T', cell: +m[5] }, data: null,
        });
      },
    },
    {
      // Code 39 / ITF: XBnn;x,y,<type>,<e check digit>,<ff narrow bar>,<gg narrow space>,<hh wide bar>,<ii wide space>,
      //   <jj inter-character space>,<k rotation>,<llll height 0.1 mm>,<p human readable>[,<qq zero suppression>][,<r T|P|N start/stop>]
      // Verified only for the legacy [ESC]XB form of the B-SX4T specification (research T9). The {XB…|} form is the
      // same command but is NOT verified for B-EX4 / B-FV4 / B-EP4.
      pattern: /^XB(\d+);(\d+),(\d+),([23B]),(.*)$/,
      handle(m, cmd, ctx) {
        const ref = 'XB' + m[1];
        const symbology = symbologyOf(m[4]);
        const [e, ff, gg, hh, ii, jj, k, height, readable, ...optional] = m[5].split(',');
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
          humanReadable: readable === '1', data: null,
        });
      },
    },
    {
      // 1D barcode: XBnn;x,y,<type>,<check digit>,<module>,<rotation>,<height>,<increment>,<000>,<human readable text>,<00>
      pattern: /^XB(\d+);(\d+),(\d+),([^,]),(.*)$/,
      handle(m, cmd, ctx) {
        const ref = 'XB' + m[1];
        const p = m[5].split(',');
        ctx.addField(ref, {
          kind: 'barcode', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
          symbology: symbologyOf(m[4]), module: (+p[1] || 2) * ctx.dot, rotation: ROTATIONS[p[2]] ?? 0, height: +p[3] || 100,
          native: { type: m[4], module: +p[1] || 2 },
          humanReadable: p[6] === '1', data: null,
        });
      },
    },
    {
      // Data of a field: RCnn (bitmap text), RVnn (outline text), RBnn (barcode / QR)
      pattern: /^R([CVB])(\d+);([\s\S]*)$/,
      handle(m, cmd, ctx) {
        const target = DATA_TARGET[m[1]] + m[2];
        const field = ctx.fields[target];
        if (field) field.data = field.kind === 'barcode' ? m[3].replace(FNC1_NOTATION, barcodeData.FNC1) : m[3];
        else ctx.report(diag.error(`R${m[1]}${m[2]} no tiene un ${target} definido antes`));
      },
    },
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
    {
      // Control commands: they draw nothing
      pattern: new RegExp(`^(${CONTROL_COMMANDS.join('|')})(;|$)`),
      handle() {},
    },
  ];

  /** Walks the {…|} commands of the text with their position. */
  function* commands(src) {
    const re = /\{([\s\S]*?)\|\}/g;
    let m;
    while ((m = re.exec(src))) yield { raw: m[1].replace(/[\r\n]/g, ''), start: m.index, end: m.index + m[0].length };
  }

  /** opts: { dpi } (default: the first resolution of the configuration). */
  function parse(src, { dpi = PB.config.resolutions[0] } = {}) {
    const model = {
      language: 'tpcl',
      size: { width: null, height: null, pitch: null, gap: null, native: { dRaw: null, axRaw: null } },
      items: [],
      diagnostics: [],
    };
    const ctx = {
      model,
      dot: units.dotSize(dpi),
      fields: {},
      report: d => model.diagnostics.push(d),
      addField(ref, item) { this.fields[ref] = item; model.items.push(item); },
    };
    for (const cmd of commands(src)) {
      const handler = ALL_HANDLERS.find(h => h.pattern.test(cmd.raw));
      if (handler) handler.handle(cmd.raw.match(handler.pattern), cmd, ctx);
      else ctx.report(diag.warning(`Comando no soportado por el visor: {${cmd.raw.slice(0, 40)}|}`));
    }
    return model;
  }

  // TPCL format rules that do not prevent drawing but that the printer may reject.
  // Each rule is independent: to add one, add it to RULES.
  const RULES = [
    // Coordinates with 4 digits
    item => ['x', 'y']
      .filter(k => item.raw && item.raw[k] != null && item.raw[k].length !== 4)
      .map(k => diag.warning(`${item.ref}: ${k}="${item.raw[k]}" no tiene 4 dígitos (la impresora puede no aceptarlo)`)),

    // QR module size with 2 digits
    item => (item.kind === 'qr' && item.raw.cell.length !== 2
      ? [diag.warning(`${item.ref}: tamaño de módulo "${item.raw.cell}" no tiene 2 dígitos`)]
      : []),
  ];

  /** D command (without braces) matching a resolved size: D<pitch>,<width>,<length>. */
  const dCommand = s => `D${pad4(s.p)},${pad4(s.w)},${pad4(s.h)}`;

  /** AX adjustment that goes with the catalog size (null if it has none). */
  const axOf = size => (size.native && size.native.tpcl && size.native.tpcl.ax) || null;

  /** {D…|} lines and, if the size requires it, {AX…|} that declare that size. */
  function sizeCommands(size) {
    const ax = axOf(size);
    return [`{${dCommand(size)}|}`, ...(ax ? [`{${ax}|}`] : [])];
  }

  /** Differences between the label's D/AX and the chosen size. Error if the size is required, warning if not. */
  function matchesSize(model, size) {
    const make = size.required ? diag.error : diag.warning;
    const { dRaw, axRaw } = model.size.native;
    const want = dCommand(size);
    const ax = axOf(size);
    const out = [];
    if (dRaw !== want) {
      out.push(make(`${size.name}: la etiqueta debería llevar {${want}|} (${units.formatMm(size.w)}×${units.formatMm(size.h)} mm) y lleva ${dRaw ? '{' + dRaw + '|}' : 'ninguno'}. Usa "Aplicar a la etiqueta"`));
    }
    if (ax && axRaw !== ax) {
      out.push(make(`${size.name}: el ajuste debe ser {${ax}|} y es ${axRaw ? '{' + axRaw + '|}' : 'inexistente'}`));
    }
    return out;
  }

  /** Writes the size (and its AX, if it has one) in the text, replacing or adding the commands. */
  function applySize(text, size) {
    const [d, ax] = sizeCommands(size);
    let out = /\{D\d[^|]*\|\}/.test(text) ? text.replace(/\{D\d[^|]*\|\}/, d) : `${d}\n${text}`;
    if (ax) out = /\{AX;[^|]*\|\}/.test(out) ? out.replace(/\{AX;[^|]*\|\}/, ax) : out.replace(d, `${d}\n${ax}`);
    return out;
  }

  /**
   * Adds a command to the text: right before the print command {XS…|} (so after {C|}) or, without one, at the end.
   * Uses the line ending of the file and keeps its trailing newline (or lack of it).
   */
  function insertCommand(text, command) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const print = /\{XS[;|]/.exec(text);
    if (print) {
      const before = text.slice(0, print.index);
      const lead = before === '' || before.endsWith('\n') ? '' : eol;
      return `${before}${lead}${command}${eol}${text.slice(print.index)}`;
    }
    if (text === '') return `${command}${eol}`;
    return /\n$/.test(text) ? `${text}${command}${eol}` : `${text}${eol}${command}`;
  }

  /** Palette kinds not migrated to a slice yet, in display order (the slices' entries follow, see COMPONENTS). */
  const LEGACY_COMPONENTS = Object.freeze([
    { kind: 'text', label: 'Texto' },
    { kind: 'barcode', label: 'Código de barras' },
    { kind: 'qr', label: 'QR' },
  ]);

  const MAX_COORD = 9999;
  const clampCoord = n => Math.min(MAX_COORD, Math.max(0, Math.round(n)));

  /**
   * Next free number of a format command (PV, XB) and its data command (RV, RB): the max of both plus one, with the
   * digits already used by that namespace (2 if none). PC/PV/XB are independent namespaces.
   */
  function nextId(text, format, data) {
    const used = [...text.matchAll(new RegExp(String.raw`\{(?:${format}|${data})(\d+);`, 'g'))].map(m => m[1]);
    const width = Math.max(2, ...used.map(d => d.length));
    return String(Math.max(0, ...used.map(Number)) + 1).padStart(width, '0');
  }

  /** <#NAME{k}#> with the smallest k >= 1 that does not appear in the text (as #NAME{k}# or <#NAME{k}#>). */
  function freePlaceholder(text, name) {
    let k = 1;
    while (text.includes(`#${name}${k}#`)) k++;
    return `<#${name}${k}#>`;
  }

  // Item rotation in degrees clockwise -> 2-digit text code; the position in ROTATION_STEPS is the barcode digit.
  const ROTATION_STEPS = Object.freeze([0, 90, 180, 270]);
  const ROTATION_CODES = Object.freeze({ 0: '00', 90: '11', 180: '22', 270: '33' });

  /** Kinds that carry a variable: format/data command names, placeholder name and format options ({rot2}/{rot1}: rotation). */
  const VARIABLE_COMPONENTS = Object.freeze({
    text: { format: 'PV', data: 'RV', name: 'TEXTO', tail: '0060,0080,B,{rot2},B' },
    barcode: { format: 'XB', data: 'RB', name: 'CODIGOBARRAS', tail: '9,1,02,{rot1},0080,+0000000000,000,0,00' },
    qr: { format: 'XB', data: 'RB', name: 'QR', tail: 'T,H,04,A,0,M2' },
  });

  /**
   * Adds a palette component with its top-left corner at (x, y) in 0.1 mm (rounded, clamped to 0..9999). Text and
   * barcodes get a format command plus a data command with a unique <#NAME{k}#> variable, rotated
   * (360 - options.viewRotation) % 360 to look upright in the view (missing/invalid = 0). Unknown kind or invalid
   * point: the text unchanged.
   */
  function buildComponent(text, kind, point, options) {
    if (!COMPONENTS.some(c => c.kind === kind) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return text;
    const slice = SLICES.find(s => s.id === kind);
    if (slice && slice.hooks.build) return slice.hooks.build(text, point, options);
    const { format, data, name } = VARIABLE_COMPONENTS[kind];
    // Rotated items extend from the anchor in the rotated direction, so near the label edges they can leave the label:
    // only the coordinate clamp above applies, the item is not shifted to fit.
    const view = options && ROTATION_STEPS.includes(options.viewRotation) ? options.viewRotation : 0;
    const itemRotation = (360 - view) % 360; // clockwise, so that item + view = 0 (upright)
    const tail = VARIABLE_COMPONENTS[kind].tail
      .replace('{rot2}', ROTATION_CODES[itemRotation]).replace('{rot1}', String(ROTATION_STEPS.indexOf(itemRotation)));
    const id = nextId(text, format, data);
    const placeholder = freePlaceholder(text, name);
    const withFormat = insertCommand(text, `{${format}${id};${pad4(clampCoord(point.x))},${pad4(clampCoord(point.y))},${tail}|}`);
    return insertCommand(withFormat, `{${data}${id};${placeholder}|}`);
  }

  // Coordinate fields of each command, as capture groups: [value group, D suffix group | null, axis]. Newlines are
  // stripped before matching (like commands()), so the groups are mapped back to the original text.
  const COORDINATES = [
    { pattern: /^\{(?:PC|PV|XB)\d+;(\d+),(\d+)/d, fields: [[1, null, 'x'], [2, null, 'y']] },
    { pattern: /^\{SG;(\d+)(D?),(\d+)(D?),/d, fields: [[1, 2, 'x'], [3, 4, 'y']] },
  ];
  const MOVABLE = ['text', 'barcode', 'qr', 'image'];

  /**
   * Moves an item by (dx, dy) in 0.1 mm: only the coordinate digits of its command are rewritten (same width, clamped
   * to 0..9999, SG with the D suffix in dots). Items without a source or of an unknown kind leave the text unchanged.
   */
  function moveItem(text, item, dx, dy, { dpi }) {
    const span = item && ALL_MOVABLE.includes(item.kind) && item.source && item.source.spans && item.source.spans[0];
    if (!span) return text;
    const original = text.slice(span.start, span.end);
    const { stripped, map } = stripNewlines(original);
    for (const { pattern, fields } of ALL_COORDINATES) {
      const m = pattern.exec(stripped);
      if (!m) continue;
      const delta = { x: dx, y: dy };
      const dot = units.dotSize(dpi);
      let out = original;
      // Right to left so the earlier indices stay valid
      for (const [valueGroup, suffixGroup, axis] of [...fields].reverse()) {
        const [s, e] = m.indices[valueGroup];
        const dots = suffixGroup != null && m[suffixGroup] === 'D';
        const value = Math.round(+m[valueGroup] + delta[axis] / (dots ? dot : 1));
        const digits = String(Math.min(9999, Math.max(0, value))).padStart(e - s, '0');
        out = out.slice(0, map[s]) + digits + out.slice(map[e - 1] + 1);
      }
      return text.slice(0, span.start) + out + text.slice(span.end);
    }
    return text;
  }

  /** Text of a command without its newlines (as commands() matches it) and the index of each kept char in the original. */
  function stripNewlines(original) {
    let stripped = '';
    const map = []; // index in stripped -> index in original
    for (let i = 0; i < original.length; i++) {
      if (original[i] === '\r' || original[i] === '\n') continue;
      map.push(i);
      stripped += original[i];
    }
    return { stripped, map };
  }

  const clampInt = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));

  // Editable field kinds. read(raw digits) -> value (undefined if not recognised); write(value, width) -> new digits or
  // null to ignore the change; model(item) -> value from the parsed item (used when the command text is not given).
  const numberField = (key, label, group, min, max, model) => ({
    key, label, type: 'number', min, max, step: 1, group, model,
    read: raw => (DIGITS.test(raw) ? +raw : undefined),
    write: v => (typeof v === 'number' && Number.isFinite(v) ? String(clampInt(v, min, max)) : null),
  });
  // Rotation: texts always use the 2-digit codes (00/11/22/33), barcodes the digit 0..3 (2-digit codes if the field has 2)
  const rotationField = group => ({
    key: 'rotation', label: 'Rotación', type: 'select', group, model: item => item.rotation,
    options: ROTATION_STEPS.map(d => ({ value: d, label: `${d}°` })),
    read: raw => ROTATIONS[raw],
    write: (v, width) => (ROTATION_STEPS.includes(v) ? (width === 2 ? ROTATION_CODES[v] : String(ROTATION_STEPS.indexOf(v))) : null),
  });
  const humanReadableField = group => ({
    key: 'humanReadable', label: 'Texto legible', type: 'checkbox', group, model: item => item.humanReadable,
    read: raw => (raw === '1' ? true : raw === '0' ? false : undefined),
    write: v => (typeof v === 'boolean' ? (v ? '1' : '0') : null),
  });
  const barcodeHeight = group => numberField('height', 'Alto (0,1 mm)', group, 1, MAX_COORD, item => item.height);
  const ECC_OPTIONS = Object.freeze([['L', 'L - Baja'], ['M', 'M - Media'], ['Q', 'Q - Alta'], ['H', 'H - Máxima']]
    .map(([value, label]) => ({ value, label })));

  // Editable shapes of the commands, in the order of the parser's patterns. pattern: match indices (d flag) over the
  // command without newlines; group of each field: capture group with its digits.
  const EDITABLE = [
    { // Outline text: PVnn;x,y,<width>,<height>,<font>,[±adj,]<rotation>,<attribute>
      applies: item => item.kind === 'text' && /^PV/.test(item.ref),
      pattern: /^\{PV\d+;\d+,\d+,(\d+),(\d+),[A-Za-z0-9],(?:[+-]\d+,)?(\d{2}),[BWF]/d,
      fields: [
        numberField('width', 'Ancho (0,1 mm)', 1, 1, MAX_COORD, item => Math.round(item.font.size * item.font.scaleX)),
        numberField('height', 'Alto (0,1 mm)', 2, 1, MAX_COORD, item => item.font.size),
        rotationField(3),
      ],
    },
    { // Bitmap text: PCnn;x,y,<h magnification>,<v magnification>,<font>,[±adj,]<rotation>,<attribute> (steps of 0.1)
      applies: item => item.kind === 'text' && /^PC/.test(item.ref),
      pattern: /^\{PC\d+;\d+,\d+,(\d+),(\d+),[A-Za-z0-9],(?:[+-]\d+,)?(\d{2}),[BWF]/d,
      fields: [
        numberField('hMag', 'Ampliación horizontal (×0,1)', 1, 1, 99),
        numberField('vMag', 'Ampliación vertical (×0,1)', 2, 1, 99),
        rotationField(3),
      ],
    },
    { // QR: XBnn;x,y,T,<correction>,<module size>,… (the field after the module size is deliberately not exposed)
      applies: item => item.kind === 'qr',
      pattern: /^\{XB\d+;\d+,\d+,T,(\w),(\d+)/d,
      fields: [
        numberField('cell', 'Tamaño de módulo (puntos)', 2, 1, 99, item => item.native.cell),
        {
          key: 'ecc', label: 'Corrección de errores', type: 'select', group: 1, options: ECC_OPTIONS, model: item => item.ecc,
          read: raw => (raw in ECC_LEVELS ? raw : undefined),
          write: v => (typeof v === 'string' && v in ECC_LEVELS ? v : null),
        },
      ],
    },
    { // Code 39 / ITF: …,<type>,e,ff,gg,hh,ii,jj,<rotation>,<height>,<human readable> (module widths not editable)
      applies: item => item.kind === 'barcode' && ['2', '3', 'B'].includes(item.native && item.native.type),
      pattern: /^\{XB\d+;\d+,\d+,[23B],(?:[^,]*,){6}(\d+),(\d+),([^,|]*)/d,
      fields: [barcodeHeight(2), rotationField(1), humanReadableField(3)],
    },
    { // Other 1D barcodes: …,<type>,<check>,<module>,<rotation>,<height>,<increment>,<000>,<human readable>
      applies: item => item.kind === 'barcode',
      pattern: /^\{XB\d+;\d+,\d+,[^,],[^,]*,(\d+),(\d+),(\d+),[^,]*,[^,]*,([^,|]*)/d,
      fields: [
        numberField('module', 'Módulo (puntos)', 1, 1, 99, item => item.native.module),
        barcodeHeight(3), rotationField(2), humanReadableField(4),
      ],
    },
  ];

  /**
   * Helpers the slices' TPCL hooks share with this file (they stay here because other kinds use them too).
   * Passed once to each slice's `languages.tpcl` factory.
   */
  const SLICE_HELPERS = Object.freeze({ sourceOf, insertCommand, pad4, clampCoord, numberField, MAX_COORD });

  /** Slices that provide TPCL hooks (js/components/*), with their hooks built from SLICE_HELPERS, in registration order. */
  const SLICES = PB.components.all()
    .filter(def => def.languages && def.languages.tpcl)
    .map(def => ({ id: def.kind, modelKind: def.modelKind || def.kind, label: def.label, hooks: def.languages.tpcl(SLICE_HELPERS) }));

  // The tables above hold the kinds not migrated to a slice yet; each ALL_* adds the slices' entries after them.
  const ALL_HANDLERS = [...HANDLERS, ...SLICES.flatMap(s => s.hooks.handlers || [])];
  const ALL_COORDINATES = [...COORDINATES, ...SLICES.flatMap(s => s.hooks.coordinates || [])];
  const ALL_MOVABLE = [...MOVABLE, ...SLICES.filter(s => s.hooks.coordinates).map(s => s.modelKind)];
  const ALL_EDITABLE = [...EDITABLE, ...SLICES.flatMap(s => s.hooks.editable || [])];
  /** Component kinds of the palette (neutral), in display order. */
  const COMPONENTS = Object.freeze([...LEGACY_COMPONENTS, ...SLICES.map(({ id, label }) => ({ kind: id, label }))]);

  /** Editable shape of an item (null: not editable) and, with a text and a source, its match over the command. */
  function editableOf(item, text) {
    const shape = item && ALL_EDITABLE.find(s => s.applies(item));
    if (!shape) return null;
    const span = item.source && item.source.spans && item.source.spans[0];
    if (typeof text !== 'string' || !span) return { shape, match: null };
    const original = text.slice(span.start, span.end);
    const { stripped, map } = stripNewlines(original);
    return { shape, original, map, span, match: shape.pattern.exec(stripped) };
  }

  /**
   * Fields the panel can edit for an item: { kind, fields: [{ key, label, type, value, min, max, step?, options? }] }
   * (type number | select | checkbox). Values are read from the command in text when given (needed for the PC
   * magnifications), else from the item model; a field whose value is unknown is left out. Image and unknown kinds: none.
   */
  function describeItem(item, text) {
    const found = editableOf(item, text);
    const kind = (item && item.kind) || null;
    if (!found) return { kind, fields: [] };
    const { shape, match } = found;
    const fields = [];
    for (const f of shape.fields) {
      const value = match ? f.read(match[f.group]) : f.model && f.model(item);
      if (value === undefined || value === null) continue;
      const { key, label, type, min, max, step, options } = f;
      fields.push({ key, label, type, value, ...(min !== undefined && { min, max, step }), ...(options && { options }) });
    }
    return { kind, fields };
  }

  /**
   * Rewrites only the fields in changes ({ key: value }, see describeItem) of an item's command, keeping each field's
   * digit width and clamping numbers to their range (rounded). Unknown keys, invalid values, items without source or
   * of a kind without editable fields are ignored: the text is returned unchanged if nothing changes.
   */
  function updateItem(text, item, changes) {
    const found = changes && editableOf(item, text);
    if (!found || !found.match) return text;
    const { shape, match, original, map, span } = found;
    const edits = [];
    for (const f of shape.fields) {
      if (!Object.hasOwn(changes, f.key)) continue;
      const [s, e] = match.indices[f.group];
      const digits = f.write(changes[f.key], e - s);
      if (digits !== null) edits.push({ s, e, digits: digits.padStart(e - s, '0') });
    }
    if (!edits.length) return text;
    let out = original;
    // Right to left so the earlier indices stay valid (fields are in group order, not necessarily command order)
    for (const { s, e, digits } of edits.sort((a, b) => b.s - a.s)) {
      out = out.slice(0, map[s]) + digits + out.slice(map[e - 1] + 1);
    }
    return text.slice(0, span.start) + out + text.slice(span.end);
  }

  PB.languages.register({
    id: 'tpcl',
    name: 'TPCL (Toshiba TEC)',
    detect: src => /\{[\s\S]*?\|\}/.test(src),
    parse,
    validate: model => model.items.flatMap(item => RULES.flatMap(rule => rule(item))),
    sizeCommands,
    matchesSize,
    applySize,
    insertCommand,
    moveItem,
    updateItem,
    describeItem,
    componentTemplates: () => COMPONENTS.map(c => ({ ...c })),
    buildComponent,
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
