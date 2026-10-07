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

  /** Control commands that draw nothing. */
  const CONTROL_COMMANDS = Object.freeze(['C', 'XS', 'AX', 'XQ']);

  const DIGITS = /^\d+$/;

  /** TPCL rotation in degrees, clockwise: texts 00/11/22/33, barcodes 0/1/2/3. */
  const ROTATIONS = Object.freeze({ '00': 0, '11': 90, '22': 180, '33': 270, 0: 0, 1: 90, 2: 180, 3: 270 });

  /** Data commands (RC, RV, RB) and the format command they fill in. */
  const DATA_TARGET = Object.freeze({ C: 'PC', V: 'PV', B: 'XB' });

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
  ];

  /** D command (without braces) matching a resolved size: D<pitch>,<width>,<length>. */
  const dCommand = s => `D${pad4(s.p)},${pad4(s.w)},${pad4(s.h)}`;

  /** The {D…|} line that declares the size (the {AX…|} adjustment is printer specific and is never written here). */
  function sizeCommands(size) {
    return [`{${dCommand(size)}|}`];
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
      const pitch = size.pitch ?? size.height;
      const m = native.dRaw && /^D(\d+),(\d+),(\d+)/.exec(native.dRaw);
      const unchanged = !!m && +m[1] === pitch && +m[2] === size.width && +m[3] === size.height;
      out.push(wrap(unchanged ? native.dRaw : dCommand({ p: pitch, w: size.width, h: size.height })));
      const ax = native.axRaw && (unchanged || !native.dRaw) ? native.axRaw : null;
      if (ax) out.push(wrap(ax));
      else ctx.report(diag.info('No se escribe {AX…|}: la etiqueta de origen no lo declara, compruebe el ajuste en su impresora'));
      if (size.pitch == null) ctx.report(diag.info('El paso de etiqueta (pitch) no está especificado: se usa la altura de la etiqueta, compruebe el valor en su impresora'));
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

  /**
   * Helpers the slices' TPCL hooks share with this file (they stay here because other kinds use them too).
   * Passed once to each slice's `languages.tpcl` factory.
   */
  const SLICE_HELPERS = Object.freeze({
    sourceOf, insertCommand, pad4, clampCoord, numberField, rotationField, nextId, freePlaceholder,
    ROTATIONS, ROTATION_STEPS, ROTATION_CODES, MAX_COORD, DIGITS,
    wrap, safeData, coordText, allocId,
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
    validate: model => model.items.flatMap(item => ALL_RULES.flatMap(rule => rule(item))),
    sizeCommands,
    applySize,
    insertCommand,
    moveItem,
    updateItem,
    describeItem,
    componentTemplates: () => COMPONENTS.map(c => ({ ...c })),
    buildComponent,
    emit,
    fileExtension: 'txt',
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
