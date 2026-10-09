/**
 * TSPL parser (language of the TSC TTP printers).
 * Converts TSPL text into the neutral model (js/core/model.js): the declared size and a list of drawable items.
 * TSPL gives every drawing coordinate and measure in printer dots: they are converted to 0.1 mm with the resolution
 * (dpi, a user setting: the manual gives no dpi per model) and the original value is kept in item.native.
 *
 * This file holds the language skeleton: the line tokenizer, the parse driver, the context (ctx) and the setup commands
 * (SIZE, GAP, DIRECTION, REFERENCE, SHIFT, ...). The drawing commands (TEXT, BARCODE, QRCODE, BAR, BOX, ELLIPSE, CIRCLE, REVERSE, ERASE, BITMAP) come
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

  /** Escapes of a quote inside a string: the manual's \["] and the common \" (an unquoted token is returned as is). */
  const QUOTE_ESCAPES = /\\\["\]|\\"/g;

  /** Argument text -> its value: quotes removed and the \["] / \" escapes resolved. */
  function unquote(raw) {
    if (raw.length === 0 || raw[0] !== '"') return raw;
    const body = raw.length > 1 && raw.endsWith('"') && !raw.endsWith('\\"') ? raw.slice(1, -1) : raw.slice(1);
    return body.replace(QUOTE_ESCAPES, '"');
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
      const text = src.slice(tokenStart, end);
      const raw = text.trim();
      // start/end: where the raw text sits in src (an empty argument sits at the end of its blanks)
      const start = tokenStart + (raw ? text.length - text.trimStart().length : text.length);
      args.push({ raw, value: unquote(raw), start, end: start + raw.length });
    };
    for (let i = from; i < to; i++) {
      const c = src[i];
      if (quoted && c === '\\' && src[i + 1] === '"') { i++; continue; }
      if (quoted && c === '\\' && src.startsWith('["]', i + 1)) { i += 3; continue; }
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

  /**
   * Stands for a 0x0D byte of a BITMAP payload while the text lives in the editor: the textarea turns CR / CRLF into LF,
   * which would alter the payload. PB.ui.decodeFile writes it (private-use code point, never in latin1 text); everything
   * that turns payload chars back into bytes maps it to 0x0D (this tokenizer, PB.convert.toBytes). One char, like the CR it
   * replaces, so the length-based reading of the payload is unchanged.
   */
  const CR_PLACEHOLDER = String.fromCharCode(0xE00D);

  /** Bytes of a BITMAP: each source char is one byte (the app reads files as text, see the note in commands()). */
  const toBytes = text => String.fromCharCode(...Array.from(text, ch => (ch === CR_PLACEHOLDER ? 0x0D : ch.charCodeAt(0) & 0xFF)));

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

  // ---------------------------------------------------------------------------------------------------------------
  // Emit helpers shared with the slices

  /** String argument: "..." with the \["] escape for the quotes inside (PB.emit.escapeQuotes). */
  const quoted = str => `"${PB.emit.escapeQuotes(str)}"`;

  /** Rounds to whole dots; the epsilon keeps x.5 values that float noise nudged just below from rounding down. */
  const roundDots = v => Math.round(v + 1e-6);

  /** 0.1 mm -> dots at the context's resolution, without rounding (for sums and centers before the final round). */
  const exactDots = (ctx, mm10) => mm10 / units.dotSize(ctx.dpi);

  /** 0.1 mm -> whole dots, never negative. */
  const toDots = (ctx, mm10) => Math.max(0, roundDots(exactDots(ctx, Number.isFinite(mm10) ? mm10 : 0)));

  /** Text of a line-oriented command argument: line breaks become spaces (one warning per emit). */
  const LINE_BREAKS = /[\r\n]/g;
  const VARIABLE_NAME = /#[A-Za-z_]\w*#/;

  /**
   * Field data as it can be written inside a TSPL string: CR/LF would end the command line, so each becomes a space
   * (one Spanish warning per emit); #NAME# placeholders (TPCL variables) have no TSPL substitution and are written
   * literally (one Spanish info per emit). Returns the unquoted, unescaped text.
   */
  function safeData(ctx, data) {
    const value = data == null ? '' : String(data);
    if (VARIABLE_NAME.test(value)) {
      ctx.once('tspl-variables', () => diag.info('Las variables #NOMBRE# se escriben como texto literal en TSPL (no hay sustitución)'));
    }
    if (!/[\r\n]/.test(value)) return value;
    ctx.once('tspl-framing', () => diag.warning('Hay datos con saltos de línea, que rompen el formato TSPL (un comando por línea): se sustituyen por espacios'));
    return value.replace(LINE_BREAKS, ' ');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Counters (B-442/443 manual, SET COUNTER): "SET COUNTER @n step" declares the increment of counter n (0..49 for text and barcode,
  // -999999999..999999999), "@n="0001"" assigns its start value and a TEXT / BARCODE content "@n" prints it, incremented per label.
  // The viewer shows the start value; the manual documents nothing else (no expressions, no per-label evaluation).

  const COUNTER_ARG = /^@(\d+)$/;
  const COUNTER_SLOTS = 50;
  const COUNTER_STEP_MAX = 999999999;
  const SET_COUNTER = /^SET\s+COUNTER\s+@(\d+)\s+([+-]?\d+)\s*$/id;
  const COUNTER_ASSIGNMENT = /^@(\d+)\s*=\s*([\s\S]*)$/;
  const COUNTER_NOTE = 'Los campos con incremento muestran su valor inicial: la impresora los incrementa en cada etiqueta';

  /** Value of the right side of "@n=value" when it is one quoted string (an expression is not documented: null). */
  function assignedValue(text) {
    const raw = text.trim();
    return raw.length >= 2 && raw[0] === '"' && raw.endsWith('"') && !raw.endsWith('\\"') ? unquote(raw) : null;
  }

  /**
   * Emit side of a counter item: { ref: '@n', lines: ['SET COUNTER @n step', '@n="start"'] } to write before its command, which then
   * uses ref as content; null when the item has no counter (0 is none), or when the 50 counters of the printer are used up (the
   * start value is written as plain text, with a warning once). A step beyond +-999999999 is clamped (warning once). A TPCL zero
   * suppression has no TSPL equivalent: one info per emit.
   */
  function counterSetup(ctx, item, data) {
    if (item.zeroSuppress > 0) ctx.once('tspl-zero-suppress', () => diag.info('Los ceros suprimidos (supresión de ceros iniciales) no tienen equivalente en TSPL: los contadores se escriben sin supresión de ceros'));
    const c = item.counter;
    if (!c || !Number.isFinite(c.step) || Math.trunc(c.step) === 0) return null;
    const n = Number(ctx.ids.next('COUNTER'));
    if (n >= COUNTER_SLOTS) {
      ctx.once('tspl-counters-max', () => diag.warning(`Hay más de ${COUNTER_SLOTS} contadores: TSPL solo tiene @0 a @${COUNTER_SLOTS - 1}, los demás se escriben con su valor inicial como texto`));
      return null;
    }
    let step = Math.trunc(c.step);
    if (Math.abs(step) > COUNTER_STEP_MAX) {
      ctx.once('tspl-counter-step', () => diag.warning(`Hay incrementos fuera de ±${COUNTER_STEP_MAX} (límite de SET COUNTER): se ajustan al límite de TSPL`));
      step = Math.sign(step) * COUNTER_STEP_MAX;
    }
    return { ref: `@${n}`, lines: [`SET COUNTER @${n} ${step}`, `@${n}=${quoted(data)}`] };
  }

  /**
   * Parse side: warns once per number when a counter does not exist in the printer (the manual has @0..@49 for text and barcode).
   * `where` names the command. The value is still read as written.
   */
  function counterNumberWarning(ctx, where, n) {
    if (n < COUNTER_SLOTS) return;
    ctx.counterNumbersNoted = ctx.counterNumbersNoted || new Set();
    if (ctx.counterNumbersNoted.has(n)) return;
    ctx.counterNumbersNoted.add(n);
    ctx.report(diag.warning(`${where}: el contador @${n} no existe, la impresora solo tiene @0 a @${COUNTER_SLOTS - 1}`));
  }

  /** Parse side: every "@n" reference of a content argument goes through counterNumberWarning (barcode, QR, Data Matrix). */
  function counterRefsWarning(ctx, where, arg) {
    for (const m of arg.raw.matchAll(/(?:^|\+)\s*@(\d+)/g)) counterNumberWarning(ctx, where, Number(m[1]));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Helpers of the palette `build` hooks

  /** <#NAME{k}#> with the smallest k >= 1 that does not appear in the text (as #NAME{k}# or <#NAME{k}#>), like TPCL's. */
  function freePlaceholder(text, name) {
    let k = 1;
    while (text.includes(`#${name}${k}#`)) k++;
    return `<#${name}${k}#>`;
  }

  /** Rotation of a new item: (360 - view rotation) % 360 so that it looks upright in the view (missing/invalid view = 0). */
  const itemRotation = options => {
    const view = options && ROTATIONS.includes(options.viewRotation) ? options.viewRotation : 0;
    return (360 - view) % 360;
  };

  /** Dots of a new command's top-left corner for a drop point in 0.1 mm (REFERENCE/SHIFT subtracted, never below 0). */
  const dropDots = (text, point, options) => PB.tsplEdit.dropDots(text, point, { dpi: options && options.dpi ? options.dpi : PB.config.resolutions[0] }, commands);

  /** Length in 0.1 mm of a new component -> whole dots at the build options' resolution (at least 1). */
  const lengthDots = (options, mm10) => Math.max(1, toDots({ dpi: options && options.dpi ? options.dpi : PB.config.resolutions[0] }, mm10));

  /** Helpers the slices' TSPL hooks share with this file. Passed once to each slice's `languages.tspl` factory. */
  const SLICE_HELPERS = Object.freeze({
    sourceOf, argValue, num, int, unquote, parseLength, ROTATIONS, INCH,
    quoted, roundDots, exactDots, toDots, safeData, counterSetup, counterNumberWarning, counterRefsWarning,
    insertCommand, freePlaceholder, itemRotation, dropDots, lengthDots,
    numberField: PB.tsplEdit.numberField, selectField: PB.tsplEdit.selectField, stringSelectField: PB.tsplEdit.stringSelectField, textField: PB.tsplEdit.textField,
  });

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

  // --- Setup ranges (B-442/443 manual: GAP 0 <= m <= 1 inch and |n| <= label length; BLINE 0.1..1 inch and 0 <= n <= label length;
  // OFFSET 0..1 inch; DENSITY 0..15; FEED and PRINT 1..65535). Lengths are 0.1 mm here; 1 inch = 25.4 mm. ---

  const EPS = 1e-6;
  /** [min, max] of the GAP distance, the BLINE height and the OFFSET distance, in 0.1 mm. */
  const GAP_LIMITS = Object.freeze([0, INCH]);
  const BLINE_LIMITS = Object.freeze([INCH / 10, INCH]);
  const OFFSET_LIMITS = GAP_LIMITS;
  const COUNT_MAX = 65535;
  const outside = (v, [lo, hi]) => v < lo - EPS || v > hi + EPS;
  const clampLength = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
  const mmText = mm10 => String(mm10 / 10).replace('.', ',');
  const lengthRange = ([lo, hi]) => `${mmText(lo)}..${mmText(hi)} mm`;

  /** Warning for a whole-number argument outside min..max (null when valid). */
  function countWarning(name, label, arg, min, max) {
    const v = int(arg);
    if (v !== null && v >= min && v <= max) return null;
    return diag.warning(`${name}: ${label} ${arg ? `"${arg.raw}" ` : 'ausente '}fuera de ${min}..${max} (número entero): la impresora puede no aceptarlo`);
  }

  const HANDLERS = [
    {
      // Label size: SIZE m[,n] (inches), SIZE 100 mm,60 mm, SIZE 800 dot,480 dot
      pattern: /^SIZE\b/i,
      handle(m, cmd, ctx) {
        sizeHandler(ctx, cmd, ([width, height]) => {
          ctx.model.size.native.sizeRaw = cmd.raw;
          if (width <= 0 || (height !== undefined && height <= 0)) {
            ctx.report(diag.warning(`SIZE: el ancho y el alto deben ser mayores que 0, no se aplica: ${cmd.raw.slice(0, 40)}`));
            return;
          }
          ctx.model.size.width = width;
          if (height !== undefined) ctx.model.size.height = height;
        }, 'SIZE');
      },
    },
    {
      // Gap between labels: GAP m,n; black line: BLINE m,n (the first value is the distance). A distance outside the manual range is
      // reported and drawn at the nearest limit (gapRaw keeps what was written); the offset n is checked against the label length at the end.
      pattern: /^(GAP|BLINE)\b/i,
      handle(m, cmd, ctx) {
        const name = m[1].toUpperCase();
        const limits = name === 'GAP' ? GAP_LIMITS : BLINE_LIMITS;
        sizeHandler(ctx, cmd, ([distance, offset]) => {
          let value = distance;
          if (outside(distance, limits)) {
            ctx.report(diag.warning(`${name}: ${name === 'GAP' ? 'separación' : 'altura de la marca'} "${cmd.args[0].raw}" fuera de ${lengthRange(limits)}: la impresora puede no aceptarla, se dibuja con el límite más cercano`));
            value = clampLength(distance, limits);
          }
          ctx.model.size.gap = value;
          ctx.model.size.native[name === 'GAP' ? 'gapRaw' : 'blineRaw'] = cmd.raw;
          if (offset !== undefined) ctx.offsets.push({ name, value: offset, raw: cmd.args[1].raw });
        }, name);
      },
    },
    {
      // OFFSET m: extra feed after each label, 0..1 inch
      pattern: /^OFFSET\b/i,
      handle(m, cmd, ctx) {
        const v = cmd.args.length ? parseLength(cmd.args[0], ctx.dot) : null;
        if (v === null) ctx.report(diag.warning(`OFFSET no válido: ${cmd.raw.slice(0, 40)}`));
        else if (outside(v, OFFSET_LIMITS)) ctx.report(diag.warning(`OFFSET: distancia "${cmd.args[0].raw}" fuera de ${lengthRange(OFFSET_LIMITS)}: la impresora puede no aceptarla`));
      },
    },
    {
      // DENSITY n: 0 (lightest) .. 15 (darkest); nothing to draw
      pattern: /^DENSITY\b/i,
      handle(m, cmd, ctx) {
        const w = countWarning('DENSITY', 'nivel', cmd.args[0], 0, 15);
        if (w) ctx.report(w);
      },
    },
    {
      // SPEED n: inches per second; the manual lists 1.5, 2.0 and 3.0 for its models, the other models of the family have other values
      pattern: /^SPEED\b/i,
      handle(m, cmd, ctx) {
        const v = num(cmd.args[0]);
        if (v === null || v <= 0) ctx.report(diag.warning(`SPEED no válido (se espera una velocidad positiva, por ejemplo 1.5, 2.0 o 3.0): ${cmd.raw.slice(0, 40)}`));
      },
    },
    {
      // FEED n: dots, 1..65535
      pattern: /^FEED\b/i,
      handle(m, cmd, ctx) {
        const w = countWarning('FEED', 'longitud', cmd.args[0], 1, COUNT_MAX);
        if (w) ctx.report(w);
      },
    },
    {
      // DIRECTION n[,m]: 1 = origin top-left; 0 = the printout is rotated 180 degrees (not applied by the viewer)
      pattern: /^DIRECTION\b/i,
      handle(m, cmd, ctx) {
        const direction = int(cmd.args[0]);
        const mirror = cmd.args.length > 1 ? int(cmd.args[1]) : 0;
        if (direction !== 0 && direction !== 1) {
          ctx.report(diag.warning(`DIRECTION no válido (0 o 1): ${cmd.raw.slice(0, 40)}`));
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
      // CLS delimits the label: nothing to draw
      pattern: /^CLS\b/i,
      handle() {},
    },
    {
      // PRINT m[,n]: m sets of labels and n copies of each, whole numbers 1..65535; nothing to draw
      pattern: /^PRINT\b/i,
      handle(m, cmd, ctx) {
        const problems = [countWarning('PRINT', 'juegos', cmd.args[0], 1, COUNT_MAX), cmd.args.length > 1 && countWarning('PRINT', 'copias', cmd.args[1], 1, COUNT_MAX)];
        for (const w of problems) if (w) ctx.report(w);
      },
    },
    {
      // SET COUNTER @n step: the increment of counter n (the viewer keeps it for the items that use "@n")
      pattern: /^SET\s+COUNTER\b/i,
      handle(m, cmd, ctx) {
        const parsed = SET_COUNTER.exec(cmd.raw);
        if (!parsed) {
          ctx.report(diag.warning(`SET COUNTER no válido (SET COUNTER @n paso, con paso entero): ${cmd.raw.slice(0, 40)}`));
          return;
        }
        const [n, step] = [Number(parsed[1]), Number(parsed[2])];
        // The printer rejects the command when the counter does not exist or the step is out of range: nothing is declared
        if (n >= COUNTER_SLOTS) { counterNumberWarning(ctx, 'SET COUNTER', n); return; }
        if (Math.abs(step) > COUNTER_STEP_MAX) {
          ctx.report(diag.warning(`SET COUNTER @${n}: incremento ${step} fuera de -${COUNTER_STEP_MAX} a ${COUNTER_STEP_MAX}, la impresora lo rechaza y el contador no se declara`));
          return;
        }
        // where the step sits in the text, for the panel (cmd.raw starts at cmd.start)
        ctx.counters.set(n, { step, start: cmd.start + parsed.indices[2][0], end: cmd.start + parsed.indices[2][1] });
      },
    },
    {
      // @n="start value": the start value of counter n (any other right side, an expression, is not documented and is left alone)
      pattern: COUNTER_ASSIGNMENT,
      handle(m, cmd, ctx) {
        const value = assignedValue(m[2]);
        counterNumberWarning(ctx, `@${m[1]}=`, Number(m[1]));
        if (value !== null) ctx.values.set(Number(m[1]), value);
      },
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
      /** GAP / BLINE offsets (n) to check against the label length once the whole text is read. */
      offsets: [],
      /** Declared counters (SET COUNTER) and assigned start values (@n="..."), by number, as the commands appear. */
      counters: new Map(),
      values: new Map(),
      report: d => model.diagnostics.push(d),
      /**
       * A content argument that is exactly "@n" with n assigned a start value: { n, data (the start value), counter? } where
       * counter = { step, native: { n, start, end } } when n was declared with a step other than 0 (start/end = the step in the
       * text). Anything else (unassigned counter, mixed content "x"+@1): null, the caller keeps the literal text. One info per label.
       */
      counterContent(arg) {
        const m = arg && COUNTER_ARG.exec(arg.raw);
        if (!m || !this.values.has(Number(m[1]))) return null;
        const n = Number(m[1]);
        const declared = this.counters.get(n);
        if (!this.counterShown) {
          this.counterShown = true;
          this.report(diag.info(COUNTER_NOTE));
        }
        return { n, data: this.values.get(n), ...(declared && declared.step !== 0 && { counter: { step: declared.step, native: { n, start: declared.start, end: declared.end } } }) };
      },
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
    const size = model.size;
    // GAP n is at most the label length (either sign); BLINE n is 0..label length (needs the height, so after the whole text)
    for (const { name, value, raw } of ctx.offsets) {
      const bad = name === 'GAP' ? Number.isFinite(size.height) && Math.abs(value) > size.height + EPS : value < -EPS || (Number.isFinite(size.height) && value > size.height + EPS);
      if (bad) model.diagnostics.push(diag.warning(`${name}: desplazamiento "${raw}" fuera de ${name === 'GAP' ? '±' : '0..'}alto de la etiqueta: la impresora puede no aceptarlo`));
    }
    // pitch = height + gap, whatever the order of SIZE and GAP in the text
    if (Number.isFinite(size.height) && Number.isFinite(size.gap) && size.gap > 0) size.pitch = size.height + size.gap;
    return { model, ctx };
  }

  /** opts: { dpi } (default: the first resolution of the configuration). */
  const parse = (src, opts) => run(src, opts).model;

  const COMPOSED = PB.composeSlices('tspl', SLICE_HELPERS, { handlers: HANDLERS });
  const ALL_HANDLERS = COMPOSED.handlers;
  // Move / describe / update engines (js/languages/tspl-edit.js) driven by the slices' coordinates and editable definitions
  const EDITING = PB.tsplEdit.createTsplEditing({ coordinates: COMPOSED.coordinates, editable: COMPOSED.editable, commands });

  // The counter step lives in the SET COUNTER line, not in the item's command: the panel field is added here and its write goes to
  // that line (item.counter.native holds where the step is, so the text must be the one the item was parsed from).
  const isCounterItem = item => !!(item && item.counter && item.counter.native && Number.isInteger(item.counter.native.n));

  /** Step as written in the SET COUNTER line of the item's counter, or undefined if the text does not have it where it was parsed. */
  function stepInText(text, { native }) {
    const head = text.slice(0, native.start);
    const line = head.slice(Math.max(head.lastIndexOf('\n'), head.lastIndexOf('\r')) + 1);
    const m = /^[ \t]*SET\s+COUNTER\s+@(\d+)\s+$/i.exec(line);
    const raw = text.slice(native.start, native.end);
    return m && Number(m[1]) === native.n && /^[+-]?\d+$/.test(raw) ? Number(raw) : undefined;
  }

  function describeItem(item, text, opts) {
    const base = EDITING.describeItem(item, text, opts);
    if (!isCounterItem(item)) return base;
    const value = typeof text === 'string' ? stepInText(text, item.counter) : item.counter.step;
    if (value === undefined) return base;
    const field = { key: 'counter', label: 'Incremento', type: 'number', value, min: -COUNTER_STEP_MAX, max: COUNTER_STEP_MAX, step: 1 };
    return { ...base, fields: [...base.fields, field] };
  }

  function updateItem(text, item, changes, opts) {
    if (!isCounterItem(item) || !changes || !Object.hasOwn(changes, 'counter')) return EDITING.updateItem(text, item, changes, opts);
    const rest = { ...changes };
    delete rest.counter;
    const v = changes.counter;
    const { native } = item.counter;
    const value = typeof v === 'number' && Number.isFinite(v) && stepInText(text, item.counter) !== undefined
      ? String(Math.min(COUNTER_STEP_MAX, Math.max(-COUNTER_STEP_MAX, Math.round(v)))) : null;
    const replace = s => (value === null ? s : s.slice(0, native.start) + value + s.slice(native.end));
    const span = item.source && item.source.spans && item.source.spans[0];
    // The later of the two edits goes first so the offsets of the earlier one stay valid
    return span && native.start > span.start
      ? EDITING.updateItem(replace(text), item, rest, opts)
      : replace(EDITING.updateItem(text, item, rest, opts));
  }

  /** Lines that only TSPL writes: SIZE <n>, CLS, or a drawing command followed by a number. TPCL text ({…|}) is never TSPL. */
  const TSPL_LINE = /^[ \t]*(?:SIZE[ \t]+\d|CLS[ \t]*$|(?:TEXT|BARCODE|QRCODE|DMATRIX|BITMAP|BAR|BOX|ELLIPSE|CIRCLE)[ \t]+\d)/im;
  const detect = src => typeof src === 'string' && !/\{[\s\S]*?\|\}/.test(src) && TSPL_LINE.test(src);

  // ---------------------------------------------------------------------------------------------------------------
  // Emit: neutral model -> TSPL text

  /** 0.1 mm -> the number of a "<n> mm" length, with at most one decimal ("991" -> "99.1"). */
  const mmNumber = mm10 => String(+(mm10 / 10).toFixed(1));

  const GAP_NOTE = `La separación entre etiquetas (GAP) se ajusta al rango de TSPL (${lengthRange(GAP_LIMITS)}, 0..1 pulgada)`;

  /**
   * Resolved size (0.1 mm: w, h, p) with the gap (pitch - height) limited to the GAP range: { size, diagnostics }. One warning when it had to
   * change. Used by the Formato row (PB.sizes.apply) and by sizeCommands.
   */
  function fitSize(size) {
    const pitch = size.p == null ? size.h : size.p;
    if (!(pitch - size.h > GAP_LIMITS[1] + EPS)) return { size, diagnostics: [] };
    return { size: { ...size, p: size.h + GAP_LIMITS[1] }, diagnostics: [diag.warning(GAP_NOTE)] };
  }

  /**
   * SIZE, GAP, DIRECTION and CLS. SIZE needs both measures (else it is omitted with a warning); GAP only when the model
   * knows the separation (else omitted with an info). REFERENCE and SHIFT are never written: the parser folds them into
   * the coordinates. DIRECTION 1 is the origin the parser assumes (top-left).
   */
  const ROTATED_NOTE = 'La etiqueta de origen se imprime girada 180° (DIRECTION 0 de TSPL o ^POI de ZPL): el visor la dibuja sin girar y el giro no se escribe en el destino, compruebe la orientación en su impresora';

  function headerLines(model, ctx) {
    const size = (model && model.size) || {};
    const out = [];
    if (Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0) {
      out.push(`SIZE ${mmNumber(size.width)} mm,${mmNumber(size.height)} mm`);
    } else if (Number.isFinite(size.width) && Number.isFinite(size.height)) {
      ctx.report(diag.warning('El tamaño de la etiqueta no es válido (el ancho y el alto deben ser mayores que 0): no se escribe SIZE, indique el tamaño antes de exportar'));
    } else {
      ctx.report(diag.warning('La etiqueta no declara su tamaño: no se escribe SIZE, indique el tamaño antes de exportar'));
    }
    // gap = pitch - height: a label that only knows its pitch (TPCL) still gets its GAP; the manual allows 0..1 inch, so more is clamped
    let gap = Number.isFinite(size.gap) ? size.gap : (size.pitch > size.height ? size.pitch - size.height : null);
    if (Number.isFinite(gap) && outside(gap, GAP_LIMITS)) {
      ctx.report(diag.warning(GAP_NOTE));
      gap = clampLength(gap, GAP_LIMITS);
    }
    if (Number.isFinite(gap)) out.push(`GAP ${mmNumber(gap)} mm,0 mm`);
    else ctx.report(diag.info('No se escribe GAP: la separación entre etiquetas o la marca negra no está especificada, compruebe el ajuste en su impresora'));
    // DIRECTION 0 (printed rotated 180 degrees) is written back as it was read; a ^POI of ZPL has no TSPL counterpart here and is reported
    const rotated = size.native && size.native.direction === 0;
    if (size.native && size.native.invert === true) ctx.report(diag.info(ROTATED_NOTE));
    out.push(rotated ? 'DIRECTION 0' : 'DIRECTION 1', 'CLS');
    return out;
  }

  /**
   * Neutral model -> { text, diagnostics }: header, the items (slices' emit hooks), then PRINT 1,1. Lines are joined
   * with CRLF (the line ending TSPL printers expect) and the text ends with one, so the last command is executed.
   */
  function emit(model, { dpi = PB.config.resolutions[0] } = {}) {
    const ctx = PB.emit.createContext({ dpi, language: 'tspl' });
    const header = headerLines(model, ctx);
    const { lines } = PB.emit.run(model, COMPOSED, ctx);
    return { text: [...header, ...lines, 'PRINT 1,1', ''].join('\r\n'), diagnostics: ctx.diagnostics };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Size writing: resolved size (0.1 mm: { w, h, p }) -> SIZE / GAP lines

  /** SIZE always; GAP (pitch - height) only when the pitch is larger than the height (else the separation is unknown). */
  function sizeCommands(wanted) {
    const size = fitSize(wanted).size;
    const out = [`SIZE ${mmNumber(size.w)} mm,${mmNumber(size.h)} mm`];
    const pitch = size.p == null ? size.h : size.p;
    if (pitch > size.h) out.push(`GAP ${mmNumber(pitch - size.h)} mm,0 mm`);
    return out;
  }

  /**
   * Writes the size in the text: the first SIZE line and the first GAP line are replaced in place, a missing SIZE is
   * added at the top and a missing GAP right after the SIZE line. Only those command lines change (found with the parser's
   * tokenizer, so BITMAP data and quoted content are never matched); the line ending and the trailing newline stay.
   * With pitch == height no GAP is written and an existing one is left alone.
   */
  function applySize(text, size) {
    const [sizeLine, gapLine] = sizeCommands(size);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let sizeCmd = null;
    let gapCmd = null;
    for (const cmd of commands(text)) {
      if (!sizeCmd && /^SIZE\b/i.test(cmd.raw)) sizeCmd = cmd;
      else if (!gapCmd && /^GAP\b/i.test(cmd.raw)) gapCmd = cmd;
    }
    const edits = []; // { start, end, value } on the original text
    const sizeValue = sizeLine + (gapLine && !gapCmd ? eol + gapLine : '');
    if (sizeCmd) edits.push({ start: sizeCmd.start, end: sizeCmd.end, value: sizeValue });
    else edits.push({ start: 0, end: 0, value: sizeValue + eol });
    if (gapLine && gapCmd) edits.push({ start: gapCmd.start, end: gapCmd.end, value: gapLine });
    let out = text;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.value + out.slice(e.end);
    return out;
  }

  /**
   * Adds a command to the text: right before the PRINT line or, without one, at the end. Uses the line ending of the
   * file (CRLF if it has any, else LF) and keeps its trailing newline (or lack of it). PRINT is found with the
   * tokenizer, so the word inside a quoted string or a BITMAP payload never matches.
   */
  function insertCommand(text, command) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    for (const cmd of commands(text)) {
      if (cmd.name !== 'PRINT') continue;
      const head = text.slice(0, cmd.start);
      const lineStart = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('\r')) + 1;
      return `${text.slice(0, lineStart)}${command}${eol}${text.slice(lineStart)}`;
    }
    if (text === '') return `${command}${eol}`;
    return /\n$/.test(text) ? `${text}${command}${eol}` : `${text}${eol}${command}`;
  }

  /** Component kinds of the palette (neutral), in display order: the slices that have a `build` hook (the image has none). */
  const COMPONENTS = COMPOSED.components;

  /**
   * Adds a palette component with its top-left corner at the point ({ x, y } in 0.1 mm) using the slice's `build` hook
   * (each slice owns its template; options: { dpi, viewRotation }). Unknown kind or invalid point: the text unchanged.
   */
  function buildComponent(text, kind, point, options) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return text;
    const slice = COMPOSED.slices.find(s => s.id === kind);
    return slice && slice.hooks.build ? slice.hooks.build(text, point, options || {}) : text;
  }

  /**
   * BITMAP command for the preview picture ({ xMm, yMm } in mm, empty or invalid = 0; w, h in dots; data = neutral
   * bitmap, 1 = black; dpi), ready for insertCommand. The editor holds a 0x0D payload byte as CR_PLACEHOLDER (a
   * textarea would normalize it), as when a file is opened. A bitmap over the BITMAP maximum is refused with an error.
   */
  function imageCommand({ xMm, yMm, w, h, data, dpi }) {
    const image = PB.slices.image.tspl;
    if (Math.ceil(w / 8) > image.MAX_WIDTH_BYTES || h > image.MAX_HEIGHT) {
      throw new Error(`${w}×${h} puntos supera el máximo de BITMAP (${image.MAX_WIDTH_BYTES * 8}×${image.MAX_HEIGHT})`);
    }
    const dots = mm => {
      const units = PB.units.fromMm(mm);
      return Number.isFinite(units) ? Math.max(0, Math.round(units / PB.units.dotSize(dpi))) : 0;
    };
    return image.bitmapCommand(dots(xMm), dots(yMm), { w, h, data }).replace(/\r/g, CR_PLACEHOLDER);
  }

  /** Tokenizer and driver, exposed for the slices' tests and the app. */
  PB.tspl = Object.freeze({ commands, run, createContext, SLICE_HELPERS, CR_PLACEHOLDER });

  // latin1: a BITMAP payload is raw bytes (one char per byte), so the file must be written byte for byte (PB.convert.toBytes)
  PB.languages.register({ id: 'tspl', name: 'TSPL (TSC TTP)', detect, parse, emit, fileEncoding: 'latin1', fileExtension: 'prn', sizeCommands, applySize, fitSize, sizeLimits: { gap: [...GAP_LIMITS] },
    insertCommand, insertImage: true, imageCommand, moveItem: EDITING.moveItem, describeItem, updateItem,
    componentTemplates: () => COMPONENTS.map(c => ({ ...c })), buildComponent });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
