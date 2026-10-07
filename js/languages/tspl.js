/**
 * TSPL parser (language of the TSC TTP printers).
 * Converts TSPL text into the neutral model (js/core/model.js): the declared size and a list of drawable items.
 * TSPL gives every drawing coordinate and measure in printer dots: they are converted to 0.1 mm with the resolution
 * (dpi, a user setting: the manual gives no dpi per model) and the original value is kept in item.native.
 *
 * This file holds the language skeleton: the line tokenizer, the parse driver, the context (ctx) and the setup commands
 * (SIZE, GAP, DIRECTION, REFERENCE, SHIFT, ...). The drawing commands (TEXT, BARCODE, QRCODE, BAR, BOX, BITMAP) come
 * from the slices of js/components/<kind>/tspl.js, registered with `languages: { tspl }`: PB.composeSlices adds their
 * handlers after the base ones and hands them SLICE_HELPERS so no slice duplicates the number/quote/unit code.
 *
 * Handler shape (same as TPCL): { pattern, handle(m, cmd, ctx) }; the pattern is tested against the command line
 * (cmd.raw), the first match wins. ctx offers: model, dot, report, pos(xDots, yDots) -> { x, y } in 0.1 mm with
 * REFERENCE and SHIFT applied, len(dots) -> 0.1 mm, sourceOf(cmd), addItem(item), direction, reference, shift.
 */
(function (PB) {
  'use strict';

  const { units, diagnostics: diag } = PB;

  /** Inch in 0.1 mm. */
  const INCH = 254;

  /** Commands that are accepted and change nothing the viewer draws. */
  const IGNORED_COMMANDS = Object.freeze([
    'DENSITY', 'SPEED', 'OFFSET', 'SET', 'CODEPAGE', 'COUNTRY', 'FEED', 'BACKFEED', 'HOME', 'FORMFEED', 'LIMITFEED',
    'SELFTEST', 'INITIALPRINTER', 'END', 'BLINEDETECT', 'AUTODETECT', 'KILL', 'FILES', 'DOWNLOAD', 'EOP', 'RUN', 'MOVE',
    'INPUT', 'OUT',
  ]);

  /** Valid TSPL rotations in degrees, clockwise. */
  const ROTATIONS = Object.freeze([0, 90, 180, 270]);

  // ---------------------------------------------------------------------------------------------------------------
  // Tokenizer

  const isEol = c => c === '\r' || c === '\n';
  const isBlank = c => c === ' ' || c === '\t';

  /** Argument text -> its value: quotes removed and the \["] escape resolved (an unquoted token is returned as is). */
  function unquote(raw) {
    if (raw.length === 0 || raw[0] !== '"') return raw;
    const body = raw.length > 1 && raw.endsWith('"') && !raw.endsWith('\\"') ? raw.slice(1, -1) : raw.slice(1);
    return body.replace(/\\"/g, '"');
  }

  /**
   * Splits src[from, to) at the commas that are outside double quotes (\" is an escaped quote). Each argument keeps its
   * raw text (trimmed) and its unquoted value. With `limit`, stops after that many commas and returns `next` = index
   * right after the last one (-1 if the text had fewer commas), so a caller can take the rest as raw data.
   */
  function splitArgs(src, from, to, limit = Infinity) {
    const args = [];
    let tokenStart = from;
    let commas = 0;
    let quoted = false;
    const push = end => {
      const raw = src.slice(tokenStart, end).trim();
      args.push({ raw, value: unquote(raw) });
    };
    for (let i = from; i < to; i++) {
      const c = src[i];
      if (quoted && c === '\\' && src[i + 1] === '"') { i++; continue; }
      if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) {
        push(i);
        tokenStart = i + 1;
        if (++commas === limit) return { args, next: i + 1 };
      }
    }
    if (tokenStart < to || commas > 0) push(to);
    return { args, next: -1 };
  }

  /** Bytes of a BITMAP: each source char is one byte (the app reads files as text, see the note in commands()). */
  const toBytes = text => String.fromCharCode(...Array.from(text, ch => ch.charCodeAt(0) & 0xFF));

  /**
   * Walks the commands of the text, one per non-empty line (CR, LF or CRLF), with their position:
   *   { name (upper case), raw (the line, trimmed), args: [{ raw, value }], start, end, data? }
   * [start, end) covers the command in src (for BITMAP, the binary too) and the walk resumes right after it.
   * BITMAP x,y,widthBytes,height,mode,<binary>: after the 5th comma the data is widthBytes*height raw bytes read by
   * length, never by line (they may hold CR/LF/quotes/commas); cmd.data holds them and cmd.raw only the header.
   * Note: the app currently reads files as text, so the binary fidelity of a BITMAP depends on how the file was loaded
   * (UTF-8 decoding replaces bytes >= 0x80); each char is taken as one byte (charCodeAt & 0xFF).
   */
  function* commands(src) {
    const n = src.length;
    let i = 0;
    while (i < n) {
      if (isEol(src[i]) || isBlank(src[i])) { i++; continue; }
      const start = i;
      let lineEnd = i;
      while (lineEnd < n && !isEol(src[lineEnd])) lineEnd++;
      let end = lineEnd;
      while (end > start && isBlank(src[end - 1])) end--;
      const nameMatch = /^[^\s,]+/.exec(src.slice(start, end));
      const name = nameMatch[0].toUpperCase();
      let argsFrom = start + nameMatch[0].length;
      while (argsFrom < end && isBlank(src[argsFrom])) argsFrom++;

      if (name === 'BITMAP') {
        const { args, next } = splitArgs(src, argsFrom, lineEnd, 5);
        const length = next < 0 ? 0 : (parseInt(args[2].value, 10) || 0) * (parseInt(args[3].value, 10) || 0);
        if (length > 0) {
          const dataEnd = Math.min(n, next + length);
          yield { name, raw: src.slice(start, next).trim(), args, start, end: dataEnd, data: toBytes(src.slice(next, dataEnd)) };
          i = dataEnd;
          continue;
        }
      }
      yield { name, raw: src.slice(start, end), args: splitArgs(src, argsFrom, end).args, start, end };
      i = lineEnd;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Helpers shared with the slices

  /** Value of the i-th argument of a command (undefined if absent). */
  const argValue = (cmd, i) => (cmd.args[i] ? cmd.args[i].value : undefined);

  /** Number of an argument (object, command argument or text): null if it is not a finite decimal number. */
  function num(arg) {
    const text = arg && typeof arg === 'object' ? arg.value : arg;
    if (typeof text !== 'string' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text.trim())) return null;
    return Number(text);
  }

  /** Whole number of an argument (null if it is not one). */
  const int = arg => { const v = num(arg); return v !== null && Number.isInteger(v) ? v : null; };

  /**
   * Length written the SIZE/GAP way -> 0.1 mm: inches by default, "100 mm", "800 dot" (space before the unit).
   * null if it is not a length.
   */
  function parseLength(arg, dot) {
    const text = arg && typeof arg === 'object' ? arg.value : arg;
    const m = typeof text === 'string' ? /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(mm|dot)?$/i.exec(text.trim()) : null;
    if (!m) return null;
    const unit = (m[2] || '').toLowerCase();
    return +m[1] * (unit === 'mm' ? 10 : unit === 'dot' ? dot : INCH);
  }

  /** Item -> position of the command in the source text (a single span: the command line). */
  const sourceOf = cmd => ({ spans: [{ start: cmd.start, end: cmd.end }], label: cmd.raw });

  /** Helpers the slices' TSPL hooks share with this file. Passed once to each slice's `languages.tspl` factory. */
  const SLICE_HELPERS = Object.freeze({ sourceOf, argValue, num, int, unquote, parseLength, ROTATIONS, INCH });

  // ---------------------------------------------------------------------------------------------------------------
  // Handlers of the setup commands

  /** Handler of a size-like command: SIZE keeps width/height, GAP and BLINE the separation between labels. */
  function sizeHandler(ctx, cmd, apply, label) {
    const values = cmd.args.slice(0, 2).map(a => parseLength(a, ctx.dot));
    if (!values.length || values.includes(null)) {
      ctx.report(diag.warning(`${label} no válido: ${cmd.raw.slice(0, 40)}`));
      return null;
    }
    apply(values);
    return values;
  }

  const HANDLERS = [
    {
      // Label size: SIZE m[,n] (inches), SIZE 100 mm,60 mm, SIZE 800 dot,480 dot
      pattern: /^SIZE\b/i,
      handle(m, cmd, ctx) {
        sizeHandler(ctx, cmd, ([width, height]) => {
          ctx.model.size.width = width;
          if (height !== undefined) ctx.model.size.height = height;
          ctx.model.size.native.sizeRaw = cmd.raw;
        }, 'SIZE');
      },
    },
    {
      // Gap between labels: GAP m,n; black line: BLINE m,n (the first value is the distance)
      pattern: /^(GAP|BLINE)\b/i,
      handle(m, cmd, ctx) {
        sizeHandler(ctx, cmd, ([distance]) => {
          ctx.model.size.gap = distance;
          ctx.model.size.native[m[1].toUpperCase() === 'GAP' ? 'gapRaw' : 'blineRaw'] = cmd.raw;
        }, m[1].toUpperCase());
      },
    },
    {
      // DIRECTION n[,m]: 1 = origin top-left; 0 = the printout is rotated 180 degrees (not applied by the viewer)
      pattern: /^DIRECTION\b/i,
      handle(m, cmd, ctx) {
        const direction = int(cmd.args[0]);
        const mirror = cmd.args.length > 1 ? int(cmd.args[1]) : 0;
        if (direction !== 0 && direction !== 1) {
          ctx.report(diag.warning(`DIRECTION no válido: ${cmd.raw.slice(0, 40)}`));
          return;
        }
        ctx.direction = direction;
        ctx.model.size.native.direction = direction;
        ctx.model.size.native.mirror = mirror;
        if (direction === 0) ctx.report(diag.info('DIRECTION 0 gira la impresión 180°: el visor la dibuja como DIRECTION 1'));
      },
    },
    {
      // REFERENCE x,y: origin offset in dots, added to the later coordinates
      pattern: /^REFERENCE\b/i,
      handle(m, cmd, ctx) {
        const [x, y] = [num(cmd.args[0]), num(cmd.args[1])];
        if (x === null || y === null) ctx.report(diag.warning(`REFERENCE no válido: ${cmd.raw.slice(0, 40)}`));
        else ctx.reference = { x, y };
      },
    },
    {
      // SHIFT [x,]y: fine adjustment in dots (a single value is Y)
      pattern: /^SHIFT\b/i,
      handle(m, cmd, ctx) {
        const values = cmd.args.slice(0, 2).map(num);
        if (!values.length || values.includes(null)) ctx.report(diag.warning(`SHIFT no válido: ${cmd.raw.slice(0, 40)}`));
        else ctx.shift = values.length === 1 ? { x: 0, y: values[0] } : { x: values[0], y: values[1] };
      },
    },
    {
      // CLS and PRINT delimit the label: nothing to draw
      pattern: /^(CLS|PRINT)\b/i,
      handle() {},
    },
    {
      // Commands for the printer only (and the counters, "@1="0001"")
      pattern: new RegExp(`^(?:(?:${IGNORED_COMMANDS.join('|')})\\b|@\\d+\\s*=)`, 'i'),
      handle() {},
    },
  ];

  // ---------------------------------------------------------------------------------------------------------------
  // Parse driver

  /** Context of a parse: the model under construction and the coordinate conversion. */
  function createContext(model, dpi) {
    return {
      model,
      dot: units.dotSize(dpi),
      direction: 1,
      reference: { x: 0, y: 0 },
      shift: { x: 0, y: 0 },
      report: d => model.diagnostics.push(d),
      addItem(item) { model.items.push(item); return item; },
      sourceOf,
      /** Dots -> 0.1 mm. */
      len(dots) { return dots * this.dot; },
      /** Point in dots (as written in the command) -> 0.1 mm, with REFERENCE and SHIFT added. */
      pos(xDots, yDots) {
        return { x: (xDots + this.reference.x + this.shift.x) * this.dot, y: (yDots + this.reference.y + this.shift.y) * this.dot };
      },
    };
  }

  /** Parses and returns { model, ctx } (the ctx as left by the last command). */
  function run(src, { dpi = PB.config.resolutions[0] } = {}) {
    const model = {
      language: 'tspl',
      size: { width: null, height: null, pitch: null, gap: null, native: { sizeRaw: null, gapRaw: null, blineRaw: null, direction: null, mirror: null } },
      items: [],
      diagnostics: [],
    };
    const ctx = createContext(model, dpi);
    for (const cmd of commands(src)) {
      const handler = ALL_HANDLERS.find(h => h.pattern.test(cmd.raw));
      if (handler) handler.handle(cmd.raw.match(handler.pattern), cmd, ctx);
      else ctx.report(diag.warning(`Comando no soportado por el visor: ${cmd.raw.slice(0, 40)}`));
    }
    return { model, ctx };
  }

  /** opts: { dpi } (default: the first resolution of the configuration). */
  const parse = (src, opts) => run(src, opts).model;

  const COMPOSED = PB.composeSlices('tspl', SLICE_HELPERS, { handlers: HANDLERS });
  const ALL_HANDLERS = COMPOSED.handlers;

  /** Lines that only TSPL writes: SIZE <n>, CLS, or a drawing command followed by a number. TPCL text ({…|}) is never TSPL. */
  const TSPL_LINE = /^[ \t]*(?:SIZE[ \t]+\d|CLS[ \t]*$|(?:TEXT|BARCODE|QRCODE|BITMAP|BAR|BOX)[ \t]+\d)/im;
  const detect = src => typeof src === 'string' && !/\{[\s\S]*?\|\}/.test(src) && TSPL_LINE.test(src);

  /** Tokenizer and driver, exposed for the slices' tests and the app. */
  PB.tspl = Object.freeze({ commands, run, createContext, SLICE_HELPERS });

  PB.languages.register({ id: 'tspl', name: 'TSPL (TSC TTP)', detect, parse });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
