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
 *       image   { ref, x, y, width, height, href?, bitmap?, data:null }
 *               width/height = size in 0.1 mm. It has no data. Two origins:
 *               - preview overlay added by the viewer (PB.images.makeItem): href = data URL (or URL) of the picture.
 *               - graphic command of the code (TPCL SG): bitmap = { w, h, data } in printer dots, data = flat
 *                 Uint8Array of 0/1 (1 = black), row by row, length w * h.
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
 * Images the viewer overlays on the label (not part of any printer language's code).
 */
(function (PB) {
  'use strict';

  const { units } = PB;

  /** Millimetres (number or text with a comma) -> tenths of mm, or null if empty or not a number. */
  const mmOrNull = mm => {
    const v = units.fromMm(mm);
    return Number.isFinite(v) ? v : null;
  };

  /** Number with 4 digits, as TPCL requires ("55" -> "0055"). */
  const pad4 = n => String(Math.max(0, Math.round(n))).padStart(4, '0');

  /** Nibble data: each char holds 4 dots, '0' (0x30) .. '?' (0x3F). */
  const NIBBLE_BASE = 0x30;

  /** Bytes per bitmap row: dots padded up to a multiple of 8. */
  const rowBytes = w => (w + 7) >> 3;

  /** Luminance (0-255) below which a pixel is black unless another threshold is given: 50 %. */
  const DEFAULT_THRESHOLD = 128;

  PB.images = Object.freeze({
    /**
     * Bitmap -> nibble data (TPCL SG): rows top to bottom, 4 dots per char with the leftmost dot in the highest bit,
     * rows padded to a multiple of 8 dots with white. Length = ((w+7)>>3) * h * 2.
     * bits: flat array of 0/1 (1 = black), row by row, length w * h.
     */
    bitmapToNibble(bits, w, h) {
      const perRow = rowBytes(w) * 2;
      let out = '';
      for (let y = 0; y < h; y++) {
        for (let c = 0; c < perRow; c++) {
          let v = 0;
          for (let k = 0; k < 4; k++) {
            const x = c * 4 + k;
            v = (v << 1) | (x < w && bits[y * w + x] ? 1 : 0);
          }
          out += String.fromCharCode(NIBBLE_BASE + v);
        }
      }
      return out;
    },

    /**
     * Nibble data -> flat Uint8Array of 0/1 (1 = black), w * h. Tolerant: missing or foreign chars count as white and
     * extra chars are ignored (the TPCL parser reports the length mismatch).
     */
    nibbleToBitmap(data, w, h) {
      const perRow = rowBytes(w) * 2;
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = data.charCodeAt(y * perRow + (x >> 2)) - NIBBLE_BASE;
          out[y * w + x] = v >= 0 && v <= 0xf && (v >> (3 - (x & 3))) & 1 ? 1 : 0;
        }
      }
      return out;
    },

    /**
     * TPCL SG command: {SG;xxxx,yyyy,wwww,hhhh,0,<nibble data>|}
     * xMm/yMm = position in mm (number or text with a comma; empty or invalid = 0), written in 0.1 mm;
     * w/h = size in printer dots; data = nibble data (e = 0, overwrite).
     * The format comes from the B-SX4T manual; it has NOT been verified on a B-EX4 or on a real printer.
     */
    buildSG({ xMm, yMm, w, h, data }) {
      const at = mm => mmOrNull(mm) ?? 0;
      return `{SG;${pad4(at(xMm))},${pad4(at(yMm))},${pad4(w)},${pad4(h)},0,${data}|}`;
    },

    /**
     * Size in printer dots an image is converted to: the width in mm at the resolution (without a valid positive width,
     * the natural pixels) and the height by aspect ratio. { naturalW, naturalH, widthMm, dpi } -> { w, h }, at least 1 dot.
     */
    targetDots({ naturalW, naturalH, widthMm, dpi }) {
      const widthUnits = mmOrNull(widthMm);
      const w = Math.max(1, widthUnits > 0 ? Math.round(widthUnits / units.dotSize(dpi)) : naturalW);
      return { w, h: Math.max(1, Math.round(w * naturalH / naturalW)) };
    },

    /**
     * Slider percent (0-100, number or text) -> luminance threshold 0-255, clamped; invalid = 50% (128, the default of
     * thresholdRGBA).
     */
    thresholdFromPercent(percent) {
      const p = parseFloat(percent);
      return Number.isFinite(p) ? Math.round(Math.min(100, Math.max(0, p)) * 255 / 100) : DEFAULT_THRESHOLD;
    },

    /**
     * Sizes to draw a picture through when shrinking it, so each canvas step averages about 2x2 pixels instead of
     * skipping most of them: the width is halved (rounded, at least 1) while the next size is still at least twice the
     * target width; the height follows the source aspect ratio. Always ends at the target. When the target is not
     * smaller than the source (or the source size is not valid) it is just [target]. -> [{ w, h }, ...]
     */
    downscaleSteps(srcW, srcH, dstW, dstH) {
      const target = { w: dstW, h: dstH };
      const steps = [];
      if (!(srcW >= 1 && srcH >= 1) || dstW >= srcW) return [target];
      for (let w = Math.max(1, Math.round(srcW / 2)); w >= 2 * dstW && w < srcW; w = Math.max(1, Math.round(w / 2))) {
        steps.push({ w, h: Math.max(1, Math.round(w * srcH / srcW)) });
      }
      return [...steps, target];
    },

    /**
     * RGBA pixels (canvas ImageData) -> flat Uint8Array of 0/1 (1 = black): alpha is composited over white and a pixel
     * is black when its luminance is below the threshold (0-255, clamped; default and invalid values = 128, i.e. 50%).
     */
    thresholdRGBA(rgba, w, h, threshold) {
      const limit = typeof threshold === 'number' && Number.isFinite(threshold) ? Math.min(255, Math.max(0, threshold)) : DEFAULT_THRESHOLD;
      const out = new Uint8Array(w * h);
      for (let i = 0; i < out.length; i++) {
        const a = rgba[i * 4 + 3] / 255;
        const channel = k => rgba[i * 4 + k] * a + 255 * (1 - a);
        out[i] = 0.299 * channel(0) + 0.587 * channel(1) + 0.114 * channel(2) < limit ? 1 : 0;
      }
      return out;
    },

    /**
     * `image` item that shows the converted dots (what "Insertar en el código" writes): same placement as makeItem, but
     * drawn from bitmap = { w, h, data } (flat 0/1) and sized in printer dots, as the parsed SG command will be.
     */
    makeBitmapItem({ href, xMm, yMm, dpi, ref }, bitmap) {
      const { href: _href, ...item } = PB.images.makeItem({ href, naturalW: bitmap.w, naturalH: bitmap.h, xMm, yMm, dpi, ref });
      return { ...item, width: Math.round(bitmap.w * units.dotSize(dpi)), height: Math.round(bitmap.h * units.dotSize(dpi)), bitmap };
    },

    /**
     * Neutral `image` item from a picture and its placement.
     * { href, naturalW, naturalH (pixels), xMm, yMm, widthMm (optional), dpi }
     * Without a valid positive widthMm the size is the natural pixels times the printer dot size; the height always
     * keeps the aspect ratio. Empty or invalid x/y count as 0.
     */
    makeItem({ href, naturalW, naturalH, xMm, yMm, widthMm, dpi, ref = 'IMG1' }) {
      const widthUnits = mmOrNull(widthMm);
      const width = widthUnits > 0 ? widthUnits : naturalW * units.dotSize(dpi);
      return {
        kind: 'image',
        ref,
        x: mmOrNull(xMm) ?? 0,
        y: mmOrNull(yMm) ?? 0,
        width: Math.round(width),
        height: Math.round(width * naturalH / naturalW),
        href,
        data: null,
      };
    },
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
 *     applySize?(text, resolvedSize) -> text, insertCommand?(text, command) -> text,
 *     moveItem?(text, item, dx, dy, { dpi }) -> text,
 *     componentTemplates?() -> [{ kind, label }], buildComponent?(text, kind, { x, y }, { dpi, viewRotation }) -> text }
 * The model returned by parse is the neutral one described above.
 * insertCommand (optional): the text with a command added in the place the language wants (TPCL: before {XS).
 * moveItem (optional): the text with only the position of that item's command moved by dx/dy (0.1 mm); unchanged
 *   if the item has no source.
 * componentTemplates (optional): the neutral component kinds the palette offers, in order (text, barcode, qr, line, box).
 * buildComponent (optional): the text with a new component of that kind whose top-left corner is at x/y (0.1 mm,
 *   clamped); unchanged for an unknown kind or an invalid point. viewRotation (0/90/180/270 degrees clockwise, default 0)
 *   is the current view rotation: the item is written rotated (360 - viewRotation) % 360 so it looks upright in that view.
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
    // Fields without content (lines and images carry no data by design)
    item => (item.kind !== 'line' && item.kind !== 'image' && item.data == null
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
