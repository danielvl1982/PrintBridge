/**
 * PrintBridge core, independent of the printer language: diagnostics, units, variables,
 * language registry, neutral validation and label sizes.
 * Each language (TPCL, ...) lives in js/languages/ and registers itself in PB.languages.
 *
 * Neutral model: what parse(text, { dpi }) of any language returns and what the drawing and the emitters consume.
 * Every measure in the model is real, in 0.1 mm; the language converts with dpi the ones it gives in printer dots
 * and keeps the original value in item.native for its emitter.
 *   model { language, size, items, diagnostics }
 *   - language: id of the language that parsed it (key of PB.languages).
 *   - size: { width, height, pitch, gap, native }. Measures in 0.1 mm (null if the label does not declare them);
 *     pitch = distance between labels, gap = separation between labels; native = language-specific data
 *     (TPCL: dRaw, axRaw), which only that language interprets.
 *   - items (every measure in 0.1 mm, rotation in degrees clockwise):
 *       text    { ref, x, y, rotation, font:{ size, scaleX, family, weight, style }, data }
 *               font.size = height of the letter square (em) in 0.1 mm; scaleX = horizontal stretch;
 *               family = serif | sans | mono; weight = 400 | 700; style = normal | italic
 *       qr      { ref, x, y, ecc, cell, symbology:'qr', native:{ type, cell }, data }
 *               cell = side of each module in 0.1 mm (native.cell = the language's value, in dots)
 *               neutral ecc: 'L' | 'M' | 'Q' | 'H'; each language translates it to its own letter (TPCL: inside tpcl.js)
 *       barcode { ref, x, y, rotation, module, height, humanReadable, symbology, native:{ type, module }, data,
 *                 widths?, interCharGap?, check? }
 *               module = width of the narrowest module and height = height of the bars, both in 0.1 mm
 *               neutral symbology: code128 | code39 | itf | ean13 | qr | unknown; native.type = the language's code.
 *               Exact (generated for real): code128, code39, itf; the others are drawn approximately.
 *               Code 39 and ITF only (wide/narrow symbologies), all optional:
 *                 widths = { narrowBar, narrowSpace, wideBar, wideSpace } in 0.1 mm. Without them the renderer uses
 *                 module for the narrow elements and 3 x module for the wide ones (ratio 3:1).
 *                 interCharGap = space between Code 39 characters in 0.1 mm (default: module; ITF has none).
 *                 check = 'none' | 'mod43' (Code 39 only) | 'unsupported' (the language's check digit option has no
 *                 neutral equivalent: drawn without check character and reported). Default: 'none'.
 *       line    { ref, x1, y1, x2, y2, rect, width, native:{ width } }
 *               width = thickness in 0.1 mm (native.width = the language's value, in dots)
 *   - data: text of the field with #NAME# variables (null if it has no data). In barcodes, function 1
 *     (FNC1) is the character PB.barcodeData.FNC1: a language with another notation (TPCL: ">8") translates it
 *     when parsing, so neither the drawing nor the encoder know any language notation.
 *   - source { spans: [{ start, end }], label }: where the item is in the source text (several spans if the
 *     language spreads it over several commands) and a short text to display. Optional: without source the item
 *     cannot be selected in the editor and has no tooltip (see PB.sources).
 */

/**
 * Diagnostic messages shown in the "Avisos" panel.
 * Every module creates them with these functions so the format is always the same.
 */
(function (PB) {
  'use strict';

  const LEVELS = Object.freeze({ error: 0, warning: 1, info: 2 });

  const make = level => text => ({ level, text });

  PB.diagnostics = Object.freeze({
    error: make('error'),
    warning: make('warning'),
    info: make('info'),
    /** Sorts: errors first, then warnings, then information. */
    sort: list => [...list].sort((a, b) => LEVELS[a.level] - LEVELS[b.level]),
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Unit conversion. Internally everything is worked in tenths of a millimetre (0.1 mm).
 */
(function (PB) {
  'use strict';

  /** Tenths of mm per typographic point (1 pt = 0.35278 mm). */
  const UNITS_PER_POINT = 3.5278;

  PB.units = Object.freeze({
    UNITS_PER_POINT,

    /** Size of a printer dot in tenths of mm. */
    dotSize: dpi => 254 / dpi,

    /** Millimetres (number or text with a comma) -> tenths of mm. */
    fromMm: mm => Math.round(parseFloat(String(mm).replace(',', '.')) * 10),

    /** Tenths of mm -> millimetres (number). */
    toMm: units => units / 10,

    /** Tenths of mm -> text in mm with Spanish formatting ("99", "299,5"). */
    formatMm: units => (units / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 }),
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Barcode content conventions, common to all languages.
 */
(function (PB) {
  'use strict';

  PB.barcodeData = Object.freeze({
    /** Function 1 (FNC1) inside the data: GS character (ASCII 29), which cannot appear in a normal Code128. */
    FNC1: '\u001d',
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Origin of an item in the source text (item.source). Both functions accept items without source.
 */
(function (PB) {
  'use strict';

  PB.sources = Object.freeze({
    /** Span { start, end } covered by the item (from the first span to the last), or null if unknown. */
    rangeOf(item) {
      const spans = item.source && item.source.spans;
      return spans && spans.length ? { start: spans[0].start, end: spans[spans.length - 1].end } : null;
    },

    /** Short text to display the item (tooltip), or null if it has none. */
    labelOf: item => (item.source && item.source.label) || null,
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Template variables: #NAME# or <#NAME#>.
 */
(function (PB) {
  'use strict';

  const PATTERN = /<?#(\w+)#>?/g;

  PB.variables = Object.freeze({
    /** Variable names that appear in a text, without repeats and in order of appearance. */
    namesIn(text) {
      return text == null ? [] : [...new Set([...text.matchAll(PATTERN)].map(m => m[1]))];
    },

    /** Variable names of all the items of the model. */
    namesInModel(model) {
      return [...new Set(model.items.flatMap(it => PB.variables.namesIn(it.data)))];
    },

    /** Replaces the variables with their value; the ones without a value are left as they are. */
    substitute(text, values) {
      return text == null ? '' : text.replace(PATTERN, (match, name) => values[name] ?? match);
    },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Printer language registry. Each language provides:
 *   { id, name, detect(text) -> boolean, parse(text, { dpi }) -> model, validate?(model) -> diagnostics,
 *     sizeCommands?(resolvedSize) -> string[], matchesSize?(model, resolvedSize) -> diagnostics,
 *     applySize?(text, resolvedSize) -> text }
 * The model returned by parse is the neutral one described above.
 * Optional size fields (used by PB.sizes; without them the language neither checks nor writes the size):
 *   - sizeCommands: source text lines the language needs to declare that size.
 *   - matchesSize: diagnostics (error if the size is required) for the differences between the label and the size.
 *   - applySize: source text with the size written, replacing or adding its commands (idempotent).
 */
(function (PB) {
  'use strict';

  const list = [];

  /** First shape defect of a language, or null if it is valid. */
  function shapeProblem(language) {
    if (!language) return 'not provided';
    if (typeof language.id !== 'string' || !language.id) return 'id must be a non-empty string';
    if (typeof language.name !== 'string' || !language.name) return `name must be a non-empty string (id "${language.id}")`;
    return ['detect', 'parse'].filter(k => typeof language[k] !== 'function').map(k => `${k} must be a function (id "${language.id}")`)[0] || null;
  }

  PB.languages = Object.freeze({
    /** Adds a language. Throws Error if it lacks id, name, detect or parse, or if the id is already registered. */
    register(language) {
      const problem = shapeProblem(language);
      if (problem) throw new Error(`Invalid language: ${problem}`);
      if (list.some(l => l.id === language.id)) throw new Error(`Duplicate language: one is already registered with id "${language.id}"`);
      list.push(Object.freeze({ ...language }));
    },
    all: () => [...list],
    get: id => list.find(l => l.id === id) || null,
    /** First language whose detect recognizes the text, or null if none. */
    detect: src => list.find(l => l.detect(src)) || null,
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Language-independent validation rules. Those specific to a language go in its validate.
 * Each rule is independent: to add one, add it to RULES.
 */
(function (PB) {
  'use strict';

  const { diagnostics: diag } = PB;

  /** Barcode symbologies the drawing generates for real. */
  const EXACT_SYMBOLOGIES = Object.freeze(['code128', 'code39', 'itf']);

  const RULES = [
    // Fields without content
    item => (item.kind !== 'line' && item.data == null
      ? [diag.warning(`${item.ref}: sin texto ni comando de datos asociado`)]
      : []),

    // Barcodes the viewer does not generate exactly
    item => (item.kind === 'barcode' && !EXACT_SYMBOLOGIES.includes(item.symbology)
      ? [diag.warning(`${item.ref}: código "${item.symbology}"${item.native && item.native.type ? ` (tipo ${item.native.type})` : ''} dibujado aproximado (solo Code128, Code39 e ITF son exactos)`)]
      : []),
  ];

  PB.validator = Object.freeze({
    /** Neutral rules plus those of the model's language (if it has any). */
    validate: (model, language) => [
      ...model.items.flatMap(item => RULES.flatMap(rule => rule(item))),
      ...(language && language.validate ? language.validate(model) : []),
    ],
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Label sizes: catalog of known sizes, check against the size the label declares
 * and computation of the drawing area. How a size is declared, checked and written in the
 * text is decided by each language (sizeCommands, matchesSize, applySize of the registry).
 *
 * A catalog "size" is in mm: { id, name, w, h, p, required?, native? }.
 * native keeps per-language data by id (e.g. native.tpcl.ax) and only that language reads it.
 * A "resolved" size is in 0.1 mm (returned by resolve) and is the one the other modules use.
 */
(function (PB) {
  'use strict';

  const { units, config, diagnostics: diag } = PB;

  /** Catalog size (mm) -> resolved size (0.1 mm). */
  function resolve(size) {
    return { ...size, w: units.fromMm(size.w), h: units.fromMm(size.h), p: units.fromMm(size.p || size.h) };
  }

  /** Catalog of the known sizes (config.sizes). */
  function createCatalog(list) {
    return Object.freeze({
      all: () => list,
      get: id => list.find(s => s.id === id) || null,
      /** Size with the same pitch, width and height (0.1 mm) as the model's neutral size, or null. */
      findBySize: size => list.find(s => {
        const r = resolve(s);
        return r.p === size.pitch && r.w === size.width && r.h === size.height;
      }) || null,
    });
  }

  /**
   * Drawing area for a model: the chosen (resolved) size or, if there is none, the one the label declares.
   * Returns { width, height, pitch, diagnostics }.
   */
  function view(model, chosen) {
    const declared = model.size;
    if (!chosen) {
      if (declared.width != null) return { width: declared.width, height: declared.height, pitch: declared.pitch, diagnostics: [] };
      const { w, h } = config.fallbackSize;
      return {
        width: w, height: h, pitch: null,
        diagnostics: [diag.warning(`La etiqueta no declara su tamaño: indica el tamaño en "Tamaño etiqueta". Se dibuja a ${units.formatMm(w)}×${units.formatMm(h)} mm`)],
      };
    }
    return { width: chosen.w, height: chosen.h, pitch: chosen.p, diagnostics: check(model, chosen) };
  }

  /** Differences between the label and the chosen size, per the language it was parsed with (no language or no matchesSize: none). */
  function check(model, chosen) {
    const language = PB.languages.get(model.language);
    return language && language.matchesSize ? language.matchesSize(model, chosen) : [];
  }

  /**
   * Label text with the size written by the given language: { text, supported }.
   * If the language has no applySize (or there is no language) the text does not change and supported is false.
   */
  function apply(language, text, chosen) {
    return language && language.applySize ? { text: language.applySize(text, chosen), supported: true } : { text, supported: false };
  }

  PB.sizes = Object.freeze({ resolve, createCatalog, view, apply });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
