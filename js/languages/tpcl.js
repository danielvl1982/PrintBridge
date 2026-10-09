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
 * The model is the neutral one described in js/core/model.js. The items also carry kind and raw
 * (values as they were written, only for the TPCL format rules); size.native = { dRaw, axRaw }.
 * The FNC1 of the barcode data (">8" in TPCL) is translated to PB.barcodeData.FNC1.
 */
(function (PB) {
  'use strict';

  const { units, barcodeData, diagnostics: diag } = PB;

  /** Number with 4 digits, as TPCL requires ("610" -> "0610"). */
  const pad4 = n => String(n).padStart(4, '0');

  /** FNC1 in the TPCL notation of a barcode's data. */
  const FNC1_NOTATION = />8/g;

  /** Control commands that draw nothing and have no parameters to check ({AX and {XS have their own handlers). */
  const CONTROL_COMMANDS = Object.freeze(['C', 'XQ']);

  const DIGITS = /^\d+$/;

  /** TPCL rotation in degrees, clockwise: texts 00/11/22/33, barcodes 0/1/2/3. */
  const ROTATIONS = Object.freeze({ '00': 0, '11': 90, '22': 180, '33': 270, 0: 0, 1: 90, 2: 180, 3: 270 });

  /** Data commands (RC, RV, RB) and the format command they fill in. */
  const DATA_TARGET = Object.freeze({ C: 'PC', V: 'PV', B: 'XB' });

  /** Item -> position of the command in the source text (a single span: the format command). */
  const sourceOf = cmd => ({ spans: [{ start: cmd.start, end: cmd.end }], label: `{${cmd.raw}|}` });

  // --- Label setup ranges (0.1 mm). Sources: B-452-R 2012 6.3.1 (pitch 0100..9999, width 0100..1057, length 0060..9970), B-SV4 2004 6.3.1
  // (print width up to 108 mm, the widest of the manuals), B-452-TS12 ES 6.3. Only the widest value any manual allows is used. ---

  /** {D limits [min, max]: pitch (aaaa), effective print width (bbbb) and effective print length (cccc). */
  const SIZE_LIMITS = Object.freeze({ pitch: Object.freeze([100, 9999]), width: Object.freeze([100, 1080]), height: Object.freeze([60, 9970]) });
  const rangeText = ([lo, hi]) => `${pad4(lo)}..${pad4(hi)}`;
  const clampTo = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));
  /** The pitch has to leave at least 2 mm after the print length (B-SV4 note 8, B-452-TS12 note 5). */
  const MIN_GAP = 20;

  /**
   * Diagnostics of a parsed {D command (match of its pattern + pitch and length already limited to the ranges). A gap under 2 mm is only
   * information: the printer fixes it itself (and the app writes it when the source has no pitch); the rest are warnings.
   */
  function dProblems(m, { pitch, height }) {
    const out = [];
    if (![4, 5].includes(m[1].length) || m[2].length !== 4 || ![4, 5].includes(m[3].length)) {
      out.push(diag.warning('D: paso y alto con 4 o 5 dígitos, ancho con 4 (0,1 mm): la impresora puede no aceptarlo'));
    }
    for (const [name, raw, range] of [['paso', m[1], SIZE_LIMITS.pitch], ['ancho', m[2], SIZE_LIMITS.width], ['alto', m[3], SIZE_LIMITS.height]]) {
      if (+raw < range[0] || +raw > range[1]) out.push(diag.warning(`D: ${name} ${raw} fuera de ${rangeText(range)} (0,1 mm): la impresora lo ajusta al límite`));
    }
    if (pitch < height) out.push(diag.warning(`D: el paso (${pad4(pitch)}) es menor que el alto (${pad4(height)}): la impresora da error de comando`));
    else if (pitch - height < MIN_GAP) out.push(diag.info(`D: paso - alto = ${pitch - height} (0,1 mm), menos de 2 mm: la impresora reduce el alto efectivo a paso - 2 mm`));
    return out;
  }

  /**
   * {D size (resolved, 0.1 mm: w, h, p) limited to the manual ranges, the pitch at least the length: { size, diagnostics }.
   * One warning when something had to be changed. Used by the Formato row (PB.sizes.apply), applySize and the emit.
   */
  function fitSize(size) {
    const num = v => (Number.isFinite(v) ? Math.round(v) : null);
    const h0 = num(size.h);
    const h = clampTo(h0 ?? SIZE_LIMITS.height[0], SIZE_LIMITS.height);
    const w0 = num(size.w);
    const w = clampTo(w0 ?? SIZE_LIMITS.width[0], SIZE_LIMITS.width);
    const p0 = num(size.p) ?? h0;
    const p = Math.max(h, clampTo(p0 ?? h, SIZE_LIMITS.pitch));
    const changed = h !== h0 || w !== w0 || p !== p0;
    const note = `El tamaño de la etiqueta se ajusta a los rangos de {D} de TPCL (paso ${rangeText(SIZE_LIMITS.pitch)}, ancho ${rangeText(SIZE_LIMITS.width)}, alto ${rangeText(SIZE_LIMITS.height)}, en 0,1 mm; el paso no puede ser menor que el alto)`;
    return { size: { ...size, w, h, p }, diagnostics: changed ? [diag.warning(note)] : [] };
  }

  /**
   * {AX;abbb,cddd,eff(,ghhh)|} problems as warning texts (none when valid). Ranges: feed 000..500 and cut 000..500 (B-SV4 6.3.2: 500 and 350,
   * B-452-R 6.3.2: 500 and 500, B-452-TS12 ES 6.4: 100 and 100: the widest), back feed 00..99, correction 000..100 (0.1 %, TS12 only).
   */
  function axProblems(raw) {
    const m = /^AX;([+-])(\d{3}),([+-])(\d{3}),([+-])(\d{2})(?:,([+-])(\d{3}))?$/.exec(raw.replace(/\s+/g, ''));
    if (!m) return ['AX no válido: se esperaba {AX;±bbb,±ddd,±ff(,±hhh)|} (signo y 3, 3, 2 y 3 dígitos): la impresora puede no aceptarlo'];
    const out = [];
    for (const [name, value, max, unit] of [['alimentación', m[2], 500, '0,1 mm'], ['corte', m[4], 500, '0,1 mm'], ['corrección', m[8], 100, '0,1 %']]) {
      if (value !== undefined && +value > max) out.push(`AX: ${name} ${value} fuera de 000..${String(max).padStart(3, '0')} (${unit}): la impresora puede no aceptarlo`);
    }
    return out;
  }

  /**
   * {XS;I,aaaa,bbbcdefgh|} problems as warning texts (none when valid): count 0001..9999, cut interval 000..100, sensor 0..5, mode C|D|E,
   * speed 1..9|A, ribbon 0..2, rotation 0..3, status response 0..1 (B-SV4 6.3.13, B-452-R 6.3.14, B-452-TS12 ES 6.16: the widest).
   */
  function xsProblems(raw) {
    const m = /^XS;I,(\d{4}),(\d{3})(\d)([A-Za-z])([0-9A-Za-z])(\d)(\d)(\d)$/.exec(raw.replace(/\s+/g, ''));
    if (!m) return ['XS no válido: se esperaba {XS;I,aaaa,bbbcdefgh|} (cantidad de 4 dígitos y 9 caracteres de condiciones): la impresora puede no aceptarlo'];
    const checks = [
      ['cantidad de etiquetas', m[1], +m[1] >= 1, '0001..9999'],
      ['intervalo de corte', m[2], +m[2] <= 100, '000..100'],
      ['sensor', m[3], +m[3] <= 5, '0..5'],
      ['modo de emisión', m[4], /^[CDE]$/.test(m[4]), 'C, D o E'],
      ['velocidad', m[5], /^[1-9A]$/.test(m[5]), '1..9 o A'],
      ['cinta', m[6], +m[6] <= 2, '0..2'],
      ['giro', m[7], +m[7] <= 3, '0..3'],
      ['respuesta de estado', m[8], +m[8] <= 1, '0..1'],
    ];
    return checks.filter(([, , ok]) => !ok).map(([name, value, , range]) => `XS: ${name} ${value} fuera de ${range}: la impresora puede no aceptarlo`);
  }

  /**
   * Warning for the coordinates of a command whose digits are fixed: X exactly 4 digits, Y 4 or 5 (B-SV4 / B-452-R LC and XR).
   * coords: [[name, digits as written]] with names starting x or y. Returns a diagnostic or null.
   */
  function coordDigitsWarning(ref, coords) {
    const bad = coords.filter(([name, raw]) => !(name.startsWith('x') ? /^\d{4}$/ : /^\d{4,5}$/).test(raw));
    if (!bad.length) return null;
    const list = bad.map(([name, raw]) => `${name}="${raw}"`).join(', ');
    return diag.warning(`${ref}: ${list} fuera del formato (X con 4 dígitos, Y con 4 o 5, en 0,1 mm): la impresora puede no aceptarlo`);
  }

  /** Longest data string of a PC / PV text (B-SV4 6.3.7, B-452-R 6.3.8, B-452-TS12 6.10: "Max. 255 digits", the excess is discarded). */
  const TEXT_DATA_MAX = 255;

  /** Data of a field as the printer keeps it: cut to `max` characters, with a warning when something was discarded. */
  function fitData(ctx, ref, data, max) {
    const value = data == null ? data : String(data);
    if (value == null || value.length <= max) return value;
    ctx.report(diag.warning(`${ref}: datos de ${value.length} caracteres: la impresora descarta lo que pase de ${max} (máximo del manual), se dibujan los ${max} primeros`));
    return value.slice(0, max);
  }
  const fitTextData = (ctx, ref, data) => fitData(ctx, ref, data, TEXT_DATA_MAX);

  /**
   * Longest data of a 1D barcode (B-SV4 6.3.12, B-452-R 6.3.13, B-452-TS12 6.15: "bar codes other than the above: 126 digits") and of
   * QR / Data Matrix (2000), the excess is discarded. Data with variables is left alone: its value is not known here.
   */
  const BARCODE_DATA_MAX = 126;
  const MATRIX_DATA_MAX = 2000;
  function fitBarcodeData(ctx, ref, kind, data) {
    if (data != null && PB.variables.namesIn(String(data)).length) return data;
    return fitData(ctx, ref, data, kind === 'barcode' ? BARCODE_DATA_MAX : MATRIX_DATA_MAX);
  }

  /**
   * Warning for a numeric parameter of a command as written (digits): outside min..max or without the `digits` the manual fixes.
   * The range is shown with that many digits ("01..15"). A diagnostic or null.
   */
  function rangeWarning(ref, label, raw, min, max, digits = 1) {
    const text = String(raw ?? '');
    const shown = n => String(n).padStart(digits, '0');
    if (/^\d+$/.test(text) && +text >= min && +text <= max && (digits === 1 || text.length === digits)) return null;
    return diag.warning(`${ref}: ${label} "${text}" fuera de ${shown(min)}..${shown(max)}${digits > 1 ? ` (${digits} dígitos)` : ''}: la impresora puede no aceptarlo`);
  }

  /** Bar code number of an XB command: exactly 2 digits, 00..31 (B-SV4 6.3.9, B-452-R 6.3.10, B-452-TS12 6.12). A diagnostic or null. */
  const BARCODE_NUMBER_MAX = 31;
  function barcodeNumberWarning(ref, digits) {
    if (/^\d{2}$/.test(digits) && +digits <= BARCODE_NUMBER_MAX) return null;
    return diag.warning(`${ref}: número de código de barras "${digits}" fuera de 00..${BARCODE_NUMBER_MAX} (2 dígitos): la impresora puede no aceptarlo`);
  }

  const HANDLERS = [
    {
      // Label size: D<pitch>,<width>,<length>
      pattern: /^D(\d+),(\d+),(\d+)/,
      handle(m, cmd, ctx) {
        // The printer changes a value beyond the limits to the limit itself (B-SV4 note 8): the label is drawn that way, the
        // command as written stays in native.dRaw and the warnings say what the printer will do
        const size = ctx.model.size;
        const pitch = clampTo(+m[1], SIZE_LIMITS.pitch);
        const width = clampTo(+m[2], SIZE_LIMITS.width);
        const height = clampTo(+m[3], SIZE_LIMITS.height);
        dProblems(m, { pitch, height }).forEach(d => ctx.report(d));
        Object.assign(size, { pitch, width, height });
        // pitch = height + gap: the gap is what the pitch leaves after the label
        size.gap = pitch > height ? pitch - height : null;
        size.native.dRaw = cmd.raw;
      },
    },
    {
      // Position fine adjustment: kept as written (it is printer specific), checked against the manual ranges
      pattern: /^AX(;|$)/,
      handle(m, cmd, ctx) {
        ctx.model.size.native.axRaw = cmd.raw;
        for (const text of axProblems(cmd.raw)) ctx.report(diag.warning(text));
      },
    },
    {
      // Issue command: the viewer prints nothing, but a value the printer does not accept is reported
      pattern: /^XS(;|$)/,
      handle(m, cmd, ctx) {
        for (const text of xsProblems(cmd.raw)) ctx.report(diag.warning(text));
      },
    },
    {
      // Data of a field: RCnn (bitmap text), RVnn (outline text), RBnn (barcode / QR)
      pattern: /^R([CVB])(\d+);([\s\S]*)$/,
      handle(m, cmd, ctx) {
        const target = DATA_TARGET[m[1]] + m[2];
        const field = ctx.fields[target];
        if (field && field.kind === 'text') field.data = fitTextData(ctx, target, m[3]);
        else if (field) field.data = fitBarcodeData(ctx, target, field.kind, field.kind === 'barcode' ? m[3].replace(FNC1_NOTATION, barcodeData.FNC1) : m[3]);
        else ctx.report(diag.error(`R${m[1]}${m[2]} no tiene un ${target} definido antes`));
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
    // Coordinates with 4 digits (text: Y may have 4 or 5, B-SV4 6.3.7 / 6.3.8 and B-452-R 6.3.8 / 6.3.9)
    item => ['x', 'y']
      .filter(k => item.raw && item.raw[k] != null && !(k === 'y' && item.kind === 'text' ? /^\d{4,5}$/ : /^\d{4}$/).test(item.raw[k]))
      .map(k => diag.warning(`${item.ref}: ${k}="${item.raw[k]}" no tiene ${k === 'y' && item.kind === 'text' ? '4 o 5' : '4'} dígitos (la impresora puede no aceptarlo)`)),
  ];

  /** D command (without braces) matching a resolved size: D<pitch>,<width>,<length>. */
  const dCommand = s => `D${pad4(s.p)},${pad4(s.w)},${pad4(s.h)}`;

  /** The {D…|} line that declares the size (the {AX…|} adjustment is printer specific and is never written here). */
  function sizeCommands(size) {
    return [`{${dCommand(fitSize(size).size)}|}`];
  }

  /** Writes the size in the text, replacing the {D…|} command or adding it at the start. An existing {AX…|} is left untouched. */
  function applySize(text, size) {
    const [d] = sizeCommands(size);
    return /\{D\d[^|]*\|\}/.test(text) ? text.replace(/\{D\d[^|]*\|\}/, () => d) : `${d}\n${text}`;
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

  /**
   * Adds a palette component with its top-left corner at (x, y) in 0.1 mm (rounded, clamped to 0..9999) using the
   * slice's `build` hook (each slice owns its template; options.viewRotation makes rotated items look upright in the
   * view). Unknown kind or invalid point: the text unchanged.
   */
  function buildComponent(text, kind, point, options) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return text;
    const slice = SLICES.find(s => s.id === kind);
    return slice && slice.hooks.build ? slice.hooks.build(text, point, options) : text;
  }

  // Coordinate fields of the kinds not migrated to a slice (none), as capture groups: [value group, D suffix group | null,
  // axis]. Newlines are stripped before matching (like commands()), so the groups are mapped back to the original text.
  const COORDINATES = [];
  const MOVABLE = [];

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

  // Editable shapes of the kinds not migrated to a slice (none: the image has no editable fields). Each shape:
  // pattern: match indices (d flag) over the command without newlines; group of each field: capture group with its digits.
  const EDITABLE = [];

  // --- Emit: neutral model -> TPCL text ---

  /** A command with its {…|} framing. */
  const wrap = body => `{${body}|}`;

  /** What would break the framing of a command: the parser has no escape for { } | and strips line breaks. */
  const UNSAFE_DATA = /[|{}\r\n]/;

  /** Field data safe to write inside a command: unsafe characters become spaces (one warning per emit). */
  function safeData(ctx, data) {
    const value = data == null ? '' : String(data);
    if (!UNSAFE_DATA.test(value)) return value;
    ctx.once('tpcl-framing', () => diag.warning('Hay datos con caracteres que rompen el formato TPCL ({ } | o saltos de línea): se sustituyen por espacios'));
    return value.replace(new RegExp(UNSAFE_DATA, 'g'), ' ');
  }

  /** Coordinate (0.1 mm) as the 4 digits TPCL requires, clamped to 0..9999 (one warning per emit if it had to be). */
  function coordText(ctx, n) {
    const value = Number.isFinite(n) ? Math.round(n) : 0;
    const clamped = clampCoord(value);
    if (clamped !== value) ctx.once('tpcl-clamp', () => diag.warning(`Hay coordenadas fuera de 0..${MAX_COORD} (0,1 mm): se ajustan al límite de TPCL`));
    return pad4(clamped);
  }

  /** Next id (2 digits) of a format command namespace (PC, PV, XB); beyond 99 it grows to 3 digits and warns once. */
  function allocId(ctx, namespace) {
    const id = ctx.ids.next(namespace);
    if (id.length > 2) ctx.once('tpcl-ids', () => diag.warning('Hay más de 100 campos del mismo tipo: los números de campo superan los 2 dígitos de TPCL'));
    if (namespace === 'XB' && +id > BARCODE_NUMBER_MAX) {
      ctx.once('tpcl-xb-number', () => diag.warning(`Hay más de ${BARCODE_NUMBER_MAX + 1} códigos de barras, QR o Data Matrix: sus números van de 00 a ${BARCODE_NUMBER_MAX} en TPCL, la impresora puede no aceptar los demás`));
    }
    return id;
  }

  /** Print command written when the source does not provide one (parameters of the reference spool example). */
  const DEFAULT_XS = 'XS;I,0001,0002C4100';

  /** {D…|}, {AX…|} and {C|}: D/AX are reused from the source while the size is unchanged, else D is built and AX is dropped. */
  function headerLines(model, ctx) {
    const size = (model && model.size) || {};
    const native = size.native || {};
    const out = [];
    if (size.width == null || size.height == null) {
      ctx.report(diag.warning('La etiqueta no declara su tamaño: no se escribe {D…|}, indique el tamaño antes de exportar'));
    } else {
      // Pitch = height + gap: a label that only knows its gap (TSPL) still gets its pitch
      const gap = Number.isFinite(size.gap) && size.gap > 0 ? size.gap : null;
      const wanted = size.pitch ?? (gap == null ? size.height : size.height + gap);
      // Never written out of the {D ranges: limited (and reported once) like the Formato row does
      const fit = fitSize({ w: size.width, h: size.height, p: wanted });
      fit.diagnostics.forEach(d => ctx.report(d));
      const { w, h, p: pitch } = fit.size;
      const m = native.dRaw && /^D(\d+),(\d+),(\d+)/.exec(native.dRaw);
      const unchanged = !!m && +m[1] === pitch && +m[2] === w && +m[3] === h;
      out.push(wrap(unchanged ? native.dRaw : dCommand({ p: pitch, w, h })));
      const source = native.axRaw && (unchanged || !native.dRaw) ? native.axRaw : null;
      const axBad = source ? axProblems(source) : [];
      if (axBad.length) ctx.report(diag.warning(`No se escribe {AX…|}: el de la etiqueta de origen no es válido en TPCL (${axBad.join('; ')})`));
      if (source && !axBad.length) out.push(wrap(source));
      else if (!axBad.length) ctx.report(diag.info('No se escribe {AX…|}: la etiqueta de origen no lo declara, compruebe el ajuste en su impresora'));
      if (size.pitch == null && gap == null) ctx.report(diag.info('El paso de etiqueta (pitch) no está especificado: se usa la altura de la etiqueta (la impresora reduce el alto efectivo a paso - 2 mm), compruebe el valor en su impresora'));
    }
    if (native.direction === 0 || native.invert === true) {
      ctx.report(diag.info('La etiqueta de origen se imprime girada 180° (DIRECTION 0 de TSPL o ^POI de ZPL): el visor la dibuja sin girar y el giro no se escribe en el destino, compruebe la orientación en su impresora'));
    }
    out.push(wrap('C'));
    return out;
  }

  /** Neutral model -> { text, diagnostics }: header, the items (slices' emit hooks), then the print command. */
  function emit(model, { dpi = PB.config.resolutions[0] } = {}) {
    const ctx = PB.emit.createContext({ dpi, language: 'tpcl' });
    const header = headerLines(model, ctx);
    const { lines } = PB.emit.run(model, COMPOSED, ctx);
    // The parser does not keep the source's {XS|}, so the reference default is always written
    ctx.report(diag.info('Parámetros de {XS} por defecto, verifíquelos en su impresora'));
    return { text: [...header, ...lines, wrap(DEFAULT_XS)].join('\n'), diagnostics: ctx.diagnostics };
  }

  // --- Counters: increment / decrement "noooooooooo" (PC, PV, XB) and zero suppression "Zpp" / "qq" (manual 6.3.7 to 6.3.9) ---

  /** Increment token: a sign and the skip value 0000000000..9999999999 (+ increments, - decrements). */
  const COUNTER_TOKEN = /^[+-]\d{10}$/;
  const COUNTER_MAX = 9999999999;
  /** Number of zeros to be suppressed: 00..20. */
  const ZERO_MAX = 20;

  /** Increment token ("+0000000010", "-0000000003") of a signed step, clamped to the manual range; 0 gives "+0000000000". */
  function counterToken(step) {
    const n = clampInt(Number.isFinite(step) ? step : 0, -COUNTER_MAX, COUNTER_MAX);
    return `${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(10, '0')}`;
  }

  /**
   * counterToken for the emitters: a step beyond the 10 digits of the manual (ZPL ^SN allows 12) is clamped, with one warning per label
   * instead of silently.
   */
  function emitCounterToken(ctx, step) {
    if (Number.isFinite(step) && Math.abs(Math.trunc(step)) > COUNTER_MAX) {
      ctx.once('tpcl-counter-step', () => diag.warning(`Hay incrementos de contador fuera de ±${COUNTER_MAX} (10 dígitos, límite de TPCL): se ajustan al límite`));
    }
    return counterToken(step);
  }

  /** Zero suppression digits ("05") of a count, clamped to 0..20. */
  const zeroDigits = n => String(clampInt(Number.isFinite(n) ? n : 0, 0, ZERO_MAX)).padStart(2, '0');

  /** Signed step of an increment token as found in a command: 0 for "" / "0" (no counter), undefined when it is anything else. */
  function readCounterStep(raw) {
    if (raw === '' || raw === '0') return 0;
    return COUNTER_TOKEN.test(raw) ? Number(raw) : undefined;
  }

  /**
   * { counter?, zeroSuppress? } of the item from the increment token and the zero suppression digits as written (undefined when
   * omitted). A step of 0 and Z00 are the same as omitting them, so neither is stored. The parse reports ONE info per label
   * (ctx.once-like flag on the parse context) that the viewer shows the start value, not the incremented one.
   */
  function counterFields(ctx, token, zero) {
    const out = {};
    if (COUNTER_TOKEN.test(token || '') && Number(token) !== 0) out.counter = { step: Number(token), native: token };
    const pp = /^\d{2}$/.test(zero || '') ? Math.min(+zero, ZERO_MAX) : 0;
    if (pp > 0) out.zeroSuppress = pp;
    if (out.counter && !ctx.counterNoted) {
      ctx.counterNoted = true;
      ctx.report(diag.info('Los campos con incremento muestran su valor inicial: la impresora los incrementa en cada etiqueta'));
    }
    return out;
  }

  /**
   * Helpers the slices' TPCL hooks share with this file (they stay here because other kinds use them too).
   * Passed once to each slice's `languages.tpcl` factory.
   */
  const SLICE_HELPERS = Object.freeze({
    sourceOf, insertCommand, pad4, clampCoord, numberField, rotationField, nextId, freePlaceholder, coordDigitsWarning,
    ROTATIONS, ROTATION_STEPS, ROTATION_CODES, MAX_COORD, DIGITS,
    wrap, safeData, coordText, allocId, fitTextData, TEXT_DATA_MAX, fitData, fitBarcodeData, BARCODE_DATA_MAX, MATRIX_DATA_MAX, barcodeNumberWarning, rangeWarning,
    COUNTER_TOKEN, COUNTER_MAX, ZERO_MAX, counterToken, emitCounterToken, zeroDigits, readCounterStep, counterFields,
  });

  // The tables above hold the kinds not migrated to a slice yet; the generic composition (js/components/compose.js)
  // adds the slices' hooks after them, in slice `order`.
  const COMPOSED = PB.composeSlices('tpcl', SLICE_HELPERS, { handlers: HANDLERS, coordinates: COORDINATES, movable: MOVABLE, editable: EDITABLE, rules: RULES });
  const SLICES = COMPOSED.slices;
  const ALL_HANDLERS = COMPOSED.handlers;
  const ALL_COORDINATES = COMPOSED.coordinates;
  const ALL_MOVABLE = COMPOSED.movable;
  const ALL_EDITABLE = COMPOSED.editable;
  const ALL_RULES = COMPOSED.rules;
  /** Component kinds of the palette (neutral), in display order. A slice without a `build` hook (the image) is not a template. */
  const COMPONENTS = COMPOSED.components;

  // --- Content (the data of text, barcode and QR items): it lives outside the capture groups of the format command ---

  /** Kinds whose data can be edited and the data command letter of each format command (the inverse of DATA_TARGET). */
  const CONTENT_KINDS = Object.freeze(['text', 'barcode', 'qr', 'datamatrix']);
  const DATA_COMMAND = Object.freeze(Object.fromEntries(Object.entries(DATA_TARGET).map(([letter, format]) => [format, letter])));

  /** Content field of the panel: the manual caps the data at 255 characters (B-SV4 specification). */
  const CONTENT_FIELD = Object.freeze({ key: 'content', label: 'Contenido', type: 'text', maxLength: 255 });

  /** Data as the panel shows it: a barcode's FNC1 character in the TPCL notation (">8"), the form the file stores. */
  const contentOfModel = item => (item.data == null ? undefined : item.kind === 'barcode' ? item.data.replaceAll(barcodeData.FNC1, '>8') : item.data);

  /**
   * Where the data of an item is stored in the text: { start, end, value } over the whole text (start..end is the data
   * only, value is it without line breaks), or null when there is none or it cannot be located unambiguously. The parser
   * keeps the last data command (R?<id>) after the format command, which wins over an inline "=data"; else the inline
   * data is used. Two format commands with the same reference are ambiguous.
   */
  function contentTarget(text, item) {
    const span = item && CONTENT_KINDS.includes(item.kind) && typeof text === 'string' && item.source && item.source.spans && item.source.spans[0];
    const ref = span && /^(PC|PV|XB)(\d+)$/.exec(item.ref || '');
    if (!ref) return null;
    const original = text.slice(span.start, span.end);
    if (!stripNewlines(original).stripped.startsWith(`{${item.ref};`)) return null;
    const letter = DATA_COMMAND[ref[1]];
    let formats = 0;
    let data = null;
    for (const cmd of commands(text)) {
      if (cmd.raw.startsWith(`${item.ref};`)) formats++;
      else if (cmd.start >= span.end && cmd.raw.startsWith(`R${letter}${ref[2]};`)) data = cmd;
    }
    if (formats !== 1) return null;
    if (data) {
      const { stripped, map } = stripNewlines(text.slice(data.start, data.end));
      const prefix = `{R${letter}${ref[2]};`.length;
      return { start: data.start + map[prefix - 1] + 1, end: data.end - 2, value: stripped.slice(prefix, -2) };
    }
    const eq = item.kind === 'text' ? original.indexOf('=') : -1;
    if (eq < 0) return null;
    return { start: span.start + eq + 1, end: span.end - 2, value: original.slice(eq + 1, -2).replace(/[\r\n]/g, '') };
  }

  /** Editable shape of an item (null: not editable) and, with a text and a source, its match over the command. */
  function editableOf(item, text) {
    const shape = item && ALL_EDITABLE.find(s => s.applies(item));
    if (!shape) return null;
    const span = item.source && item.source.spans && item.source.spans[0];
    if (typeof text !== 'string' || !span) return { shape, match: null };
    const original = text.slice(span.start, span.end);
    const { stripped, map } = stripNewlines(original);
    return { shape, original, stripped, map, span, match: shape.pattern.exec(stripped) };
  }

  /**
   * Fields the panel can edit for an item: { kind, fields: [{ key, label, type, value, min, max, step?, options? }] }
   * (type number | select | checkbox). Values are read from the command in text when given (needed for the PC
   * magnifications), else from the item model; a field whose value is unknown is left out. Image and unknown kinds: none.
   */
  function describeItem(item, text) {
    const found = editableOf(item, text);
    const kind = (item && item.kind) || null;
    const fields = [];
    if (found) {
      const { shape, match } = found;
      for (const f of shape.fields) {
        const value = match ? f.read(match[f.group], item) : f.model && f.model(item);
        if (value === undefined || value === null) continue;
        const { key, label, type, min, max, step } = f;
        // optionsFor lists a current value outside the options; it also gets the item and the matched command text (the
        // options of the barcode check digit depend on the symbology written there). noteFor does the same for the note
        const raw = match ? match[f.group] : undefined;
        const options = f.optionsFor ? f.optionsFor(value, item, raw) : f.options;
        const note = f.noteFor ? f.noteFor(value, item, raw) : f.note;
        fields.push({ key, label, type, value, ...(min !== undefined && { min, max, step }), ...(options && { options }), ...(note && { note }) });
      }
    }
    // Content: from the text when given (where its data is stored), else from the item model
    if (item && CONTENT_KINDS.includes(item.kind)) {
      const target = typeof text === 'string' ? contentTarget(text, item) : null;
      const value = typeof text === 'string' ? target && target.value : contentOfModel(item);
      if (typeof value === 'string') fields.push({ ...CONTENT_FIELD, value });
    }
    return { kind, fields };
  }

  /**
   * Rewrites only the fields in changes ({ key: value }, see describeItem) of an item's command, keeping each field's
   * digit width and clamping numbers to their range (rounded). Unknown keys, invalid values, items without source or
   * of a kind without editable fields are ignored: the text is returned unchanged if nothing changes.
   */
  function updateItem(text, item, changes, { dpi = PB.config.resolutions[0] } = {}) {
    if (!changes) return text;
    const found = editableOf(item, text);
    // Fields flagged `reemit` (the barcode type and check digit, the text's Tipo and font type) rewrite the whole format command through
    // the shape's `reemit` hook: (found, item, changes, { dpi, text }) -> the new command, or null to refuse (text unchanged). A hook may
    // answer { command, edits, ref } instead: the command plus edits [{ start, end, value }] over the text AFTER the command (its RC / RV
    // data command follows the format command's number) and the new ref of the item. The remaining changes of the same call are then
    // applied to the new command, which is parsed again (the type moves the parameters).
    const reemitKeys = found && found.shape.reemit ? found.shape.fields.filter(f => f.reemit && Object.hasOwn(changes, f.key)).map(f => f.key) : [];
    if (reemitKeys.length) {
      const answer = found.match ? found.shape.reemit(found, item, changes, { dpi, text }) : null;
      const [command, extra, ref] = answer !== null && typeof answer === 'object' ? [answer.command, answer.edits || [], answer.ref || item.ref] : [answer, [], item.ref];
      let rewritten = null;
      if (command !== null) {
        // The extra edits lie after the command: right to left, then the command itself
        rewritten = [...extra].sort((a, b) => b.start - a.start).reduce((out, { start, end, value }) => out.slice(0, start) + value + out.slice(end), text);
        rewritten = rewritten.slice(0, found.span.start) + command + rewritten.slice(found.span.end);
      }
      const rest = Object.fromEntries(Object.entries(changes).filter(([k]) => !reemitKeys.includes(k)));
      if (rewritten === null || rewritten === text) return Object.keys(rest).length ? updateItem(text, item, rest, { dpi }) : text;
      if (!Object.keys(rest).length) return rewritten;
      const again = parse(rewritten, { dpi }).items.find(i => i.ref === ref);
      return again ? updateItem(rewritten, again, rest, { dpi }) : rewritten;
    }
    // Edits as absolute ranges of the text: { start, end, value }
    const edits = [];
    if (found && found.match) {
      const { shape, match, map, span } = found;
      for (const f of shape.fields) {
        if (!Object.hasOwn(changes, f.key)) continue;
        const [s, e] = match.indices[f.group];
        const digits = f.write(changes[f.key], e - s, match[f.group], changes);
        // `exact` fields write a whole token (not digits): no zero padding
        // An empty range (an omitted optional token) is an insertion point: it has no end to map back through the stripped line breaks
        if (digits !== null) edits.push({ start: span.start + map[s], end: s === e ? span.start + map[s] : span.start + map[e - 1] + 1, value: f.exact ? digits : digits.padStart(e - s, '0') });
      }
    }
    // Content: the framing characters have no escape, so a value holding one is rejected (never altered)
    const content = changes.content;
    if (Object.hasOwn(changes, 'content') && typeof content === 'string' && !UNSAFE_DATA.test(content)) {
      const target = contentTarget(text, item);
      if (target) edits.push({ start: target.start, end: target.end, value: item.kind === 'barcode' ? content.replaceAll(barcodeData.FNC1, '>8') : content });
    }
    if (!edits.length) return text;
    let out = text;
    // Right to left so the earlier indices stay valid (fields are in group order, not necessarily command order)
    // Same start: the longer range first (a replacement before an insertion in front of it), then the later field first so
    // that insertions at one point end up in field order
    const ordered = edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.start - a.start || b.end - a.end || b.i - a.i);
    for (const { start, end, value } of ordered) out = out.slice(0, start) + value + out.slice(end);
    return out;
  }

  /**
   * SG command for the preview picture ({ xMm, yMm } in mm, empty or invalid = 0; w, h in dots; data = neutral bitmap, 1 = black), ready for
   * insertCommand. A position outside 0..999.9 mm (X has 4 digits in 0.1 mm) or a size the printer cannot hold (width 1..9999, height 1..99999,
   * 512 KB of dot data) is refused with an error: the app shows it as the reason the image was not inserted.
   */
  function imageCommand({ xMm, yMm, w, h, data }) {
    const { SG_LIMITS: limits } = PB.images;
    const tenths = mm => PB.units.fromMm(mm);
    for (const [name, mm] of [['X', xMm], ['Y', yMm]]) {
      const value = tenths(mm);
      if (Number.isFinite(value) && (value < 0 || value > MAX_COORD)) {
        throw new Error(`la posición ${name} debe estar entre 0 y 999,9 mm (TPCL la escribe con 4 dígitos en 0,1 mm)`);
      }
    }
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error(`${w}×${h} puntos no es un tamaño de imagen válido`);
    if (w > limits.maxWidth || h > limits.maxHeight) {
      throw new Error(`${w}×${h} puntos supera el máximo de SG (ancho ${limits.maxWidth}, alto ${limits.maxHeight})`);
    }
    if (PB.images.sgBytes(w, h) > limits.maxBytes) throw new Error(`${w}×${h} puntos supera el búfer de imagen de la impresora (512 KB)`);
    return PB.images.buildSG({ xMm, yMm, w, h, data: PB.images.bitmapToNibble(data, w, h) });
  }

  PB.languages.register({
    id: 'tpcl',
    name: 'TPCL (Toshiba TEC)',
    detect: src => /\{[\s\S]*?\|\}/.test(src),
    parse,
    validate: model => model.items.flatMap(item => ALL_RULES.flatMap(rule => rule(item))),
    sizeCommands,
    applySize,
    fitSize,
    sizeLimits: { width: [...SIZE_LIMITS.width], height: [...SIZE_LIMITS.height], pitch: [...SIZE_LIMITS.pitch] },
    insertCommand,
    insertImage: true, // the app writes the preview image as a TPCL SG command (imageCommand, which checks the limits); see js/core/languages.js
    imageCommand,
    moveItem,
    updateItem,
    describeItem,
    componentTemplates: () => COMPONENTS.map(c => ({ ...c })),
    buildComponent,
    emit,
    fileExtension: 'txt',
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
