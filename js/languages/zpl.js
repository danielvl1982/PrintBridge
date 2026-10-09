/**
 * ZPL II parser and writer (language of the Zebra printers).
 * Converts ZPL text into the neutral model (js/core/model.js): the declared size and a list of drawable items. ZPL gives every
 * coordinate and measure in printer dots: they are converted to 0.1 mm with the resolution (dpi, a user setting) and the original
 * value is kept in item.native.
 *
 * Source: ZPL II Programming Guide, Volume One (2003), local copy in docs/zpl (never committed). What that guide does not document is marked
 * "not verified" below; nothing here has been checked on a printer.
 *
 * This file holds the language skeleton: the tokenizer, the field grouping and the DEFERRED DISPATCH, the context (ctx), the label setup
 * commands (^PW ^LL ^LH ^LS ^LT ^PO ^CF ^FW ^CI ^BY), detection, emit skeleton, size writing and insertCommand. The drawing commands come from
 * the slices of js/components/<kind>/zpl.js, registered with `languages: { zpl }` (Z2 onwards): PB.composeSlices adds their handlers after the
 * base ones and hands them SLICE_HELPERS. The generic move / describe / update engines are in js/languages/zpl-edit.js.
 *
 * ---- Tokenizer (commands()) ------------------------------------------------------------------------------------------------------
 * A command is a prefix, a name and its parameters up to the next prefix: `^` format commands and `~` control commands (the guide's
 * conventions). The name has 2 characters (^FO, ^BC, ~SD), except ^A (1: the font letter and the orientation are the start of its first
 * parameter, ^A0N,50,50) and ^A@ (2). Parameters are separated by the delimiter (comma), trimmed, with their [start, end) offsets. Blanks and
 * line breaks between commands are ignored. ^FD and ^FV take the whole run up to the next prefix as ONE argument (commas included; the line
 * break before the next command is not part of it; line breaks inside are dropped from its `value` but kept in `raw`); ^FX is a comment with
 * the same shape. ^FH switches on the hex escapes (indicator + two hex digits) for the data of the field, until ^FS: the `value` of the
 * data is decoded and `cmd.hex` holds the indicator. ^GF takes its data (everything after the fourth comma) as one argument because the
 * ASCII hex data uses commas as fill characters. ^CC / ~CC change the format prefix, ^CT / ~CT the control prefix and ^CD / ~CD the
 * delimiter: SUPPORTED by the tokenizer (one character right after the name); `id` always shows the standard prefix. The control characters
 * STX, ETX and SI are read as ^XA, ^XZ and ^FS, like the guide says. Each command: { name (upper case), id ('^FO', '~SD'), raw, args, start, end,
 * prefix (the character written), control (introduced by the control prefix), data? / hex? (data commands) }.
 *
 * ---- Fields and the deferred dispatch (run()) ------------------------------------------------------------------------------------
 * In ZPL a drawing is a FIELD: ^FO / ^FT (the origin), the command that says what it is (^A text, ^BC bar code, ^GB box...), its data (^FD /
 * ^FV, which may come BEFORE or AFTER the command) and ^FS. So no command can be turned into an item when it is read. The driver keeps
 * one open field (ctx.field) that accumulates the commands, and dispatches it to the slice handler when the field is CLOSED:
 *   - ^FO / ^FT open a field (origin x,y in dots, LH not applied yet); ^FS closes it; a field still open when the next ^FO / ^FT arrives is
 *     closed there (one warning per label: the guide shows the ^FS in every field), and one still open at ^XZ or at the end of the text is
 *     closed silently (the guide: ^XZ "ends the field data").
 *   - ^FD, ^FV, ^FH, ^FR, ^FB, ^FN, ^FP, ^SN, ^SF are field MODIFIERS: they are stored in the field (field.data, field.reverse, field.block (the ^FB command), field.fn, field.serial) and never dispatched.
 *   - the setup commands (^PW ^LL ^LH ^LS ^LT ^PO ^CF ^FW ^CI ^BY and the recognised-but-not-drawn configuration ones) are IMMEDIATE: they run when they
 *     are read, inside an open field too, so the state the handler sees at ^FS is the state after all of them (the guide's ^CF inside a field
 *     example relies on it). A slice may declare an immediate handler too (`immediate: true`: ^LR, in js/components/area/zpl.js).
 *   - any other command is the content of a field; one that arrives outside a field starts an implicit one with no origin (0,0, one info
 *     per label). A command with no handler is reported once (warning) when it is read.
 *   - at close, the MAIN command is the LAST command of the field that has a handler (so ^A0N,..^BCN,.. is a bar code, the ^A is ignored);
 *     a field with no content command but with data is a text field in the default font (^CF) and is dispatched with the key '^FD'; a field
 *     with only unknown commands, or with only an origin, draws nothing.
 *   - handler: { pattern, immediate?, handle(m, cmd, ctx, field) }. The pattern is tested against cmd.id of the main command ('^A', '^BC',
 *     '^FD'); the first match wins. `cmd` is the main command, `field` = { start, end, raw, cmds, origin: { cmd, kind: 'FO' | 'FT', x, y } | null
 *     (dots as written), data: { cmd, kind: 'FD' | 'FV', value (decoded), raw, start, end, hex } | null, reverse, closed, find(names), findAll(names),
 *     has(names) } (names without the prefix; find gives the last match). ctx.origin(field) -> { x, y, kind } in 0.1 mm with ^LH / ^LS / ^LT
 *     applied; sourceOf(field) -> item.source covering the whole field.
 *   - ctx: model, dot, dpi, report, once(key, fn), addItem, len(dots), pos(xDots, yDots) -> { x, y } in 0.1 mm, origin(field), sourceOf, and the
 *     printer state: lh { x, y }, ls, lt, orientation (^FW, 'N' at power-up), font { name, height, width } (^CF; A,9,5 at power-up; a null
 *     height or width is "proportional to the other"), by { module, ratio, height } (^BY; 2, 3, 10: the 2003 guide gives the initial module and height only, the ratio 3.0
 *     is assumed; read through byValues(), which the barcode slice's editing shares), charset (^CI), invert (^PO: the label orientation I), labelReverse (^LRY / ^LRN: every field OPENED while it is on gets field.reverse, like an ^FR of its own,
 *     and field.labelReverse; the slices that keep a native record native.labelReverse; the emitters never write ^LR).
 *
 * ---- Counters (^SN) and variables (^FN), Z7 ----------------------------------------------------------------------------------------
 * ^SNv,n,z replaces ^FD (guide): v = the starting value (default 1; 12 digits maximum for the portion to be indexed), n = the increment (default 1,
 * a minus sign decrements, 12 digits maximum), z = print the leading zeros Y / N (default N: they are replaced by spaces, the last zero of an
 * all-zero number is not suppressed). The driver turns it into the same field as a ^FD one with the start value as its data (field.data.kind
 * 'SN') and, after the slice handler ran, gives the text and bar code items item.counter = { step, native: { n, z } } (step 0 = none, like TPCL)
 * and item.zeroSuppress = 1 for z = N (TPCL's Zpp keeps that many characters: 1 keeps the last digit, the neutral preview helper then draws
 * exactly what the guide says for a numeric start value; for a mixed text the guide scans the right-most digits, which the viewer does not
 * model: not verified). QR and Data Matrix read the start value as data and report once that the counter is not modelled for 2D codes. ^SF (the
 * mask form of the serialization) is read as its plain ^FD with one warning: no counter, the mask and the increment string are not modelled.
 * Not in the guide: what n = 0 does, the suppression of a mixed text, ^SN on 2D codes, ^SN with ^FN.
 * ^FNn (0..9999, default 0; the quoted prompt ^FNn"prompt" is of later guides, read, not verified) numbers a field of a stored format (^DF) whose data
 * ^XF merges. The driver makes it the app's variable <#FNn#>: the field's data is the placeholder (so the Variables panel and "Valores de prueba"
 * list FNn and the preview substitutes it), the ^FD data of the field, when it has one, is the DEFAULT value (the guide: "the data in that field
 * prints for any other field containing the same ^FN value": ctx.variableDefaults, handed to the app as model.variableDefaults, which seeds the
 * test values that have none yet), and the item keeps native.fn = { n, prompt, default } so the emitters write ^FNn[prompt][^FDdefault] back. The
 * 2D codes keep their ^FD data (one info). ^DF is ignored with one info (the template is drawn as a normal label); ^XF is reported once (stored
 * template not available) and, after it, an ^FN field without a position is data for the missing template: it is not drawn, its data stays a default.
 *
 * ---- Formats ---------------------------------------------------------------------------------------------------------------------
 * A file may hold several ^XA .. ^XZ formats. The viewer draws the FIRST one (commands before the first ^XA are printer state and apply) and
 * reports one info with the number of formats; the other formats are ignored. Not verified: whether printers apply ^LH / ^PW changes made
 * in one format to the next (the guide says the settings are retained until power off).
 *
 * ---- Not drawn / not verified ----------------------------------------------------------------------------------------------------
 * ^PO I (inverted 180) is reported and not applied. ^FO's third parameter (justification, later guides) is accepted and ignored. ^LS / ^LT
 * are applied as the guide describes (shift left / label top), not verified. The ^PW / ^LL size is rounded to 0.1 mm. Ranges of the guide (V9):
 * ^PW 2..32000, ^LL 1..32000, ^FO / ^FT 0..32000, ^LH 0..32000, ^LS -9999..9999, ^LT -120..120: a value outside is read as written (native), drawn at the
 * nearest limit and reported with the range; the emit and the Formato row (fitSize / sizeLimitsFor) limit what they write and report it once. The configuration commands
 * of CONFIG_NAMES (^MM ^MN ^MT ^PR ~SD ^MD ^PM ^PQ ...) are listed in one info per label. Character set: the guide's ^CI table is about code
 * pages (default 0, USA 1; 13 = CP850); it does not mention UTF-8, so the viewer reads and writes the text as UTF-8 (the app decodes files
 * that way) and a non-ASCII emit reports one info. ^CC / ^CT / ^CD prefix changes are read by the tokenizer but the emitter always writes
 * the standard prefixes and never escapes the changed ones.
 */
(function (PB) {
  'use strict';

  const { units, diagnostics: diag, zplEdit } = PB;

  /** Valid ZPL orientations and their rotation in degrees, clockwise (the guide: N normal, R rotated 90, I inverted 180, B bottom-up 270). */
  const ORIENTATIONS = Object.freeze({ N: 0, R: 90, I: 180, B: 270 });
  const ROTATIONS = Object.freeze([0, 90, 180, 270]);

  /**
   * Ranges of the guide (Volume One, 2003) for the label setup, in dots: ^PW 2 .. the width of the label (printer dependent: 32000 is the widest this
   * viewer accepts), ^LL 1 .. 32000, the origin of a field (^FO / ^FT) 0 .. 32000. Out of range: read as written (native), drawn and written at the nearest limit.
   */
  const PW_RANGE = Object.freeze([2, 32000]);
  const LL_RANGE = Object.freeze([1, 32000]);
  const COORD_RANGE = Object.freeze([0, zplEdit.COORD_MAX]);
  const rangeText = ([min, max]) => `${min}..${max}`;
  const limit = (v, [min, max]) => Math.min(max, Math.max(min, v));
  const COORD_NOTE = `Hay campos con una posición fuera de ${rangeText(COORD_RANGE)} puntos (^FO / ^FT): ZPL no admite coordenadas negativas ni mayores, se escriben en el límite`;

  /** Names of the printer configuration commands that are recognised and not drawn (either prefix). FA (field allocate, Volume Two page 43) only reserves memory. */
  const CONFIG_NAMES = Object.freeze([
    'CM', 'CO', 'CV', 'CW', 'DB', 'DE', 'DN', 'DS', 'DT', 'DU', 'EF', 'EG', 'FA', 'HB', 'HD', 'HF', 'HG', 'HH', 'HI', 'HM', 'HS', 'HU', 'HW',
    'HY', 'HZ', 'ID', 'JA', 'JB', 'JC', 'JD', 'JE', 'JF', 'JG', 'JI', 'JJ', 'JL', 'JM', 'JN', 'JO', 'JP', 'JQ', 'JR', 'JS', 'JT', 'JU', 'JW',
    'JX', 'JZ', 'KB', 'KD', 'KL', 'KN', 'KP', 'MC', 'MD', 'MF', 'ML', 'MM', 'MN', 'MP', 'MT', 'MU', 'MW', 'NC', 'NI', 'NR', 'NS', 'NT', 'PF',
    'PM', 'PP', 'PQ', 'PR', 'PS', 'RO', 'SC', 'SD', 'SE', 'SL', 'SO', 'SP', 'SQ', 'SR', 'SS', 'ST', 'SX', 'SZ', 'TA', 'TO', 'WC', 'WD', 'XB',
    'ZZ',
  ]);

  /** Every command of the 2003 guide, for the detection (the drawing ones are matched by pattern below). */
  const KNOWN_NAMES = new Set([
    ...CONFIG_NAMES, 'A', 'A@', 'CC', 'CD', 'CF', 'CI', 'CT', 'DF', 'DG', 'DY', 'FB', 'FC', 'FD', 'FH', 'FM', 'FN', 'FO', 'FP', 'FR', 'FS', 'FT', 'FV',
    'FW', 'FX', 'GB', 'GC', 'GD', 'GE', 'GF', 'GS', 'IL', 'IM', 'IS', 'LH', 'LL', 'LR', 'LS', 'LT', 'PO', 'PW', 'SF', 'SN', 'XA', 'XF', 'XG', 'XZ',
  ]);
  const isKnownName = name => KNOWN_NAMES.has(name) || /^B[0-9A-Z]$/.test(name);

  /** Neutral kinds the viewer can draw reversed (^FR / ^LR): the text, the shapes and the areas. */
  const REVERSIBLE = new Set(['text', 'line', 'ellipse', 'area']);

  /** Commands that only complete a field (never its main command). */
  const MODIFIERS = new Set(['^FB', '^FD', '^FV', '^FH', '^FR', '^FN', '^FP', '^FS', '^FX', '^SN', '^SF']);

  /** ^FN numbers (guide: 0 to 9999) and the commands whose data carries a structure the variable placeholder would break (QR, Data Matrix). */
  const FN_MAX = 9999;
  const NO_VARIABLE = /^\^(BQ|BX)$/;
  const COUNTER_NOTE = 'Los campos con incremento muestran su valor inicial: la impresora los incrementa en cada etiqueta';

  // ---------------------------------------------------------------------------------------------------------------
  // Tokenizer

  const STX = '\x02';
  const ETX = '\x03';
  const SI = '\x0F';
  /** Control characters that stand for commands. */
  const CONTROL_CHARS = Object.freeze({ [STX]: 'XA', [ETX]: 'XZ', [SI]: 'FS' });
  /** Commands whose parameter is one character taken right after the name (they change the prefixes and the delimiter). */
  const SINGLE_CHAR = new Set(['CC', 'CD', 'CT']);
  /** Commands whose parameter is the whole run up to the next command (data and comments). */
  const RAW_RUN = new Set(['FD', 'FV', 'FX']);
  /** Commands that split only a number of parameters: the rest is data (^GF: format, total, total, bytes per row, DATA). */
  const ARG_LIMIT = Object.freeze({ GF: 4 });

  const isEol = c => c === '\r' || c === '\n';
  const isSpace = c => c === ' ' || c === '\t' || isEol(c);

  /**
   * Splits src[from, to) at the delimiter. Each argument keeps its raw text (trimmed), its value (the same) and where it sits in src (an
   * empty argument sits at the end of its blanks). With `limit`, only that many delimiters split: the rest is the last argument.
   */
  function splitArgs(src, from, to, delimiter, limit = Infinity) {
    const args = [];
    let tokenStart = from;
    let count = 0;
    const push = end => {
      const text = src.slice(tokenStart, end);
      const raw = text.trim();
      const start = tokenStart + (raw ? text.length - text.trimStart().length : text.length);
      args.push({ raw, value: raw, start, end: start + raw.length });
    };
    for (let i = from; i < to; i++) {
      if (src[i] !== delimiter) continue;
      push(i);
      tokenStart = i + 1;
      if (++count === limit) break;
    }
    if (tokenStart < to || count > 0) push(to);
    return args;
  }

  /** Walks the commands of the text in order (see the header for the shape of each one). */
  function* commands(src) {
    const n = src.length;
    let format = '^';
    let control = '~';
    let delimiter = ',';
    let hex = null; // ^FH indicator in force for the data of the current field
    const isBoundary = c => c === format || c === control || c === STX || c === ETX || c === SI;
    let i = 0;
    while (i < n) {
      const c = src[i];
      if (CONTROL_CHARS[c]) {
        const name = CONTROL_CHARS[c];
        hex = null;
        yield { name, id: `^${name}`, raw: c, args: [], start: i, end: i + 1, prefix: c, control: false };
        i++;
        continue;
      }
      if (c !== format && c !== control) { i++; continue; }
      const start = i;
      const isControl = c === format ? false : true;
      const at = start + 1;
      let nameEnd = at;
      if (src[at] === 'A' || src[at] === 'a') nameEnd = src[at + 1] === '@' ? at + 2 : at + 1;
      else while (nameEnd < at + 2 && nameEnd < n && /[0-9A-Za-z]/.test(src[nameEnd])) nameEnd++;
      const name = src.slice(at, nameEnd).toUpperCase();
      const id = `${isControl ? '~' : '^'}${name}`;
      let regionEnd = nameEnd;
      while (regionEnd < n && !isBoundary(src[regionEnd])) regionEnd++;

      if (SINGLE_CHAR.has(name)) {
        const has = nameEnd < regionEnd && !isSpace(src[nameEnd]);
        const end = has ? nameEnd + 1 : nameEnd;
        const ch = has ? src[nameEnd] : '';
        if (has) { if (name === 'CC') format = ch; else if (name === 'CT') control = ch; else delimiter = ch; }
        yield { name, id, raw: src.slice(start, end), args: has ? [{ raw: ch, value: ch, start: nameEnd, end }] : [], start, end, prefix: c, control: isControl };
        i = end;
        continue;
      }

      if (RAW_RUN.has(name)) {
        let end = regionEnd;
        while (end > nameEnd && isEol(src[end - 1])) end--;
        const raw = src.slice(nameEnd, end);
        const value = name === 'FX' ? raw : zplEdit.decodeData(raw.replace(/\r\n|\r|\n/g, ''), hex);
        yield {
          name, id, raw: src.slice(start, end), args: [{ raw, value, start: nameEnd, end }], start, end, prefix: c, control: isControl,
          data: true, hex: name === 'FX' ? null : hex,
        };
        i = regionEnd;
        continue;
      }

      let end = regionEnd;
      while (end > nameEnd && isSpace(src[end - 1])) end--;
      const args = splitArgs(src, nameEnd, end, delimiter, ARG_LIMIT[name]);
      if (name === 'FH') hex = args[0] && args[0].raw ? args[0].raw[0] : '_';
      else if (name === 'FS' || name === 'XA' || name === 'XZ') hex = null;
      yield { name, id, raw: src.slice(start, end), args, start, end, prefix: c, control: isControl };
      i = regionEnd;
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

  /** Orientation letter (N / R / I / B, any case) -> rotation in degrees clockwise; null if it is not one. */
  const rotationOf = letter => (typeof letter === 'string' && Object.hasOwn(ORIENTATIONS, letter.toUpperCase()) ? ORIENTATIONS[letter.toUpperCase()] : null);

  /** Rotation in degrees clockwise -> orientation letter; null if it is not 0 / 90 / 180 / 270. */
  const orientationOf = degrees => Object.keys(ORIENTATIONS).find(k => ORIENTATIONS[k] === degrees) || null;

  /** Item -> position of the field in the source text (one span: from its first command to its ^FS). */
  const sourceOf = field => ({ spans: [{ start: field.start, end: field.end }], label: field.raw.replace(/\s*[\r\n]+\s*/g, ' ').trim() });

  // ---------------------------------------------------------------------------------------------------------------
  // Emit helpers shared with the slices

  /** Rounds to whole dots; the epsilon keeps x.5 values that float noise nudged just below from rounding down. */
  const roundDots = v => Math.round(v + 1e-6);

  /** 0.1 mm -> dots at the context's resolution, without rounding. */
  const exactDots = (ctx, mm10) => mm10 / units.dotSize(ctx.dpi);

  /** 0.1 mm -> whole dots, never negative. */
  const toDots = (ctx, mm10) => Math.max(0, roundDots(exactDots(ctx, Number.isFinite(mm10) ? mm10 : 0)));

  /**
   * Field data as it can be written after ^FD / ^FV: { hex, text }. Line breaks become spaces (one warning per emit: ZPL ignores them inside the
   * data); ^ and ~ (and _ when they are present) are written as ^FH hex escapes (_5E, _7E, _5F), hex = true says the caller must write ^FH
   * before the ^FD; text outside ASCII is written as it is, with one info per emit (the guide ties it to ^CI and the font: not verified).
   */
  function safeData(ctx, data) {
    let value = data == null ? '' : String(data);
    if (/[\r\n]/.test(value)) {
      ctx.once('zpl-framing', () => diag.warning('Hay datos con saltos de línea: ZPL los ignora dentro del campo, se sustituyen por espacios'));
      value = value.replace(/\r\n|\r|\n/g, ' ');
    }
    if (/[^\x00-\x7F]/.test(value)) {
      ctx.once('zpl-charset', () => diag.info('Hay caracteres fuera de ASCII: ZPL los interpreta según ^CI y la fuente de la impresora (el archivo se guarda en UTF-8; no verificado en impresora)'));
    }
    return zplEdit.encodeData(value);
  }

  /** The data command of a field: "^FDtext" or "^FH^FDa_5Eb" when the text needs the hex escapes (tag: 'FD' or 'FV'). */
  function fieldData(ctx, data, tag = 'FD') {
    const { hex, text } = safeData(ctx, data);
    return `${hex ? '^FH' : ''}^${tag}${text}`;
  }

  /**
   * The data commands of a text or bar code field (the part between the symbology / font command and ^FS), for an item whose data is `data`
   * (the item's by default; a slice passes the data as the symbology writes it):
   *   - an item that came from an ^FN field (native.fn) and still has the variable <#FNn#> as its data: ^FNn["prompt"][^FDdefault], so a ZPL file
   *     round-trips exactly; any other placeholder (#NAME#, <#NAME#>, of the palette or of TPCL / TSPL) is written as literal data with one info;
   *   - a counter: ^SNstart,step,z with z = N when the item has zero suppression (all of the leading zeros: one info when it keeps more than one
   *     character) and Y when it does not. What ^SN cannot carry (see serializable in zpl-edit.js) is written as a plain ^FD with one warning; a
   *     step beyond the 12 digits of the guide is clamped (warning), a start value with more than 12 digits is written (the guide indexes the 12
   *     right-most; info);
   *   - anything else: ^FD (or ^FH^FD when the data needs the hex escapes). A zero suppression without a counter has no ZPL form (info).
   */
  function dataCommands(ctx, item, data = item.data) {
    const text = data == null ? '' : String(data);
    const fn = item.native && item.native.fn;
    if (fn && item.data === `<#FN${fn.n}#>`) {
      return `^FN${fn.n}${typeof fn.prompt === 'string' ? `"${fn.prompt}"` : ''}${fn.default === undefined ? '' : fieldData(ctx, fn.default)}`;
    }
    if (PB.variables.namesIn(text).length) {
      ctx.once('zpl-variables', () => diag.info('Las variables #NOMBRE# se escriben como texto literal en ZPL (solo los campos ^FN de un archivo ZPL se escriben como variables)'));
    }
    const c = item.counter;
    let step = c && Number.isFinite(c.step) ? Math.trunc(c.step) : 0;
    if (step === 0) {
      if (item.zeroSuppress > 0) ctx.once('zpl-zero-bare', () => diag.info('Hay campos con supresión de ceros iniciales sin contador: ZPL solo la tiene en ^SN, se escriben sin ella'));
      return fieldData(ctx, text);
    }
    if (!zplEdit.serializable(text)) {
      ctx.once('zpl-counter-start', () => diag.warning('Hay contadores cuyo valor inicial no se puede escribir con ^SN (necesita un dígito, sin comas, ^ ni ~, ni espacios en los extremos, ni variables): se escriben como texto fijo con el valor inicial'));
      return fieldData(ctx, text);
    }
    if (Math.abs(step) > zplEdit.SERIAL_MAX) {
      ctx.once('zpl-counter-step', () => diag.warning(`Hay incrementos fuera de ±${zplEdit.SERIAL_MAX} (los 12 dígitos de ^SN): se ajustan al límite`));
      step = Math.sign(step) * zplEdit.SERIAL_MAX;
    }
    if (/\d{13}/.test(text)) ctx.once('zpl-counter-digits', () => diag.info('Hay contadores con más de 12 dígitos seguidos: ^SN solo incrementa los 12 de la derecha'));
    if (item.zeroSuppress > 1) ctx.once('zpl-zero-count', () => diag.info('La supresión de ceros de ZPL (z = N) quita todos los ceros iniciales: se pierde el número de caracteres que se conservan'));
    return `^SN${text},${step},${item.zeroSuppress > 0 ? 'N' : 'Y'}`;
  }

  /** A coordinate in dots limited to the origin range 0..32000 of ^FO / ^FT; one warning per emit when it had to change. */
  function fitCoord(ctx, dots) {
    const fixed = limit(Number.isFinite(dots) ? dots : 0, COORD_RANGE);
    if (fixed !== dots) ctx.once('zpl-coordinate', () => diag.warning(COORD_NOTE));
    return fixed;
  }

  /** 0.1 mm -> whole dots of a field origin (see fitCoord). */
  const coordDots = (ctx, mm10) => fitCoord(ctx, roundDots(exactDots(ctx, Number.isFinite(mm10) ? mm10 : 0)));

  /** ^FOx,y / ^FTx,y for a position in 0.1 mm (limited to 0..32000, reported once). */
  const fo = (ctx, x, y) => `^FO${coordDots(ctx, x)},${coordDots(ctx, y)}`;
  const ft = (ctx, x, y) => `^FT${coordDots(ctx, x)},${coordDots(ctx, y)}`;

  // ---------------------------------------------------------------------------------------------------------------
  // Helpers of the palette `build` hooks

  /** <#NAME{k}#> with the smallest k >= 1 that does not appear in the text (as #NAME{k}# or <#NAME{k}#>), like TPCL's and TSPL's. */
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

  const optionDpi = options => (options && options.dpi ? options.dpi : PB.config.resolutions[0]);

  /** Dots of a new field's origin for a drop point in 0.1 mm (^LH / ^LS / ^LT subtracted, never below 0). */
  const dropDots = (text, point, options) => zplEdit.dropDots(text, point, { dpi: optionDpi(options) }, commands);

  /** Length in 0.1 mm of a new component -> whole dots at the build options' resolution (at least 1). */
  const lengthDots = (options, mm10) => Math.max(1, toDots({ dpi: optionDpi(options) }, mm10));

  /**
   * The valid values a ^BY command gives: { module, ratio, height } (undefined when the argument is absent, empty or out of range: module 1..10,
   * ratio 2.0..3.0, height 1 or more) and `invalid` (it has arguments and none is usable). The persistent state and the barcode editing of
   * js/components/barcode/zpl.js read ^BY through this one function.
   */
  function byValues(cmd) {
    const [w, r, h] = [int(cmd.args[0]), num(cmd.args[1]), int(cmd.args[2])];
    const out = { module: w !== null && w >= 1 && w <= 10 ? w : undefined, ratio: r !== null && r >= 2 && r <= 3 ? r : undefined, height: h !== null && h >= 1 ? h : undefined };
    out.invalid = cmd.args.some(a => a.raw !== '') && out.module === undefined && out.ratio === undefined && out.height === undefined;
    return out;
  }

  /** Helpers the slices' ZPL hooks share with this file. Passed once to each slice's `languages.zpl` factory. */
  const SLICE_HELPERS = Object.freeze({
    commands, byValues, isImmediate: id => Boolean(handlerFor(id, true)), argEdit: zplEdit.argEdit,
    sourceOf, argValue, num, int, ROTATIONS, ORIENTATIONS, rotationOf, orientationOf,
    roundDots, exactDots, toDots, fitCoord, coordDots, safeData, fieldData, dataCommands, fo, ft,
    insertCommand, freePlaceholder, itemRotation, dropDots, lengthDots,
    encodeData: zplEdit.encodeData, decodeData: zplEdit.decodeData,
    numberField: zplEdit.numberField, selectField: zplEdit.selectField, stringSelectField: zplEdit.stringSelectField,
    checkboxField: zplEdit.checkboxField, textField: zplEdit.textField, contentField: zplEdit.contentField, paramField: zplEdit.paramField,
    reverseField: zplEdit.reverseField, setArgs: zplEdit.setArgs, flagEdits: zplEdit.flagEdits, serialFields: zplEdit.serialFields,
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Handlers of the setup commands (all immediate)

  const brief = cmd => cmd.raw.slice(0, 40);

  /**
   * Checks of the configuration commands the viewer ignores but whose values the guide ranges (Volume One, 2003): ^PQ quantity 1..99999999, pause
   * 0..99999999 (0 = no pause), replicates 0..99999999, override Y | N; ^MD -30..30; ^PR speeds A..E and 2..12 (7 does not exist); ^PM Y | N.
   * Each returns the problems as text (an omitted or empty argument takes its default and is fine).
   */
  const PQ_MAX = 99999999;
  const PRINT_SPEEDS = /^(?:[A-E]|[2-6]|[8-9]|1[0-2])$/i;
  const argText = (cmd, i) => (cmd.args[i] ? cmd.args[i].raw : '');
  const wholeIn = (cmd, i, label, [min, max]) => {
    const raw = argText(cmd, i);
    if (raw === '') return [];
    const v = int(cmd.args[i]);
    return v !== null && v >= min && v <= max ? [] : [`${label} "${raw.slice(0, 20)}" fuera de ${rangeText([min, max])}`];
  };
  const CONFIG_CHECKS = Object.freeze({
    PQ: cmd => [
      ...wholeIn(cmd, 0, 'cantidad', [1, PQ_MAX]), ...wholeIn(cmd, 1, 'pausa', [0, PQ_MAX]), ...wholeIn(cmd, 2, 'réplicas', [0, PQ_MAX]),
      ...(['', 'Y', 'N'].includes(argText(cmd, 3).toUpperCase()) ? [] : [`anulación de pausa "${argText(cmd, 3).slice(0, 10)}" no válida (Y o N)`]),
    ],
    MD: cmd => wholeIn(cmd, 0, 'oscuridad', [-30, 30]),
    PR: cmd => [0, 1, 2].flatMap(i => (argText(cmd, i) === '' || PRINT_SPEEDS.test(argText(cmd, i)) ? [] : [`velocidad "${argText(cmd, i).slice(0, 10)}" no válida (A a E, 2 a 6, 8 a 12)`])),
    PM: cmd => (['', 'Y', 'N'].includes(argText(cmd, 0).toUpperCase()) ? [] : [`valor "${argText(cmd, 0).slice(0, 10)}" no válido (Y o N)`]),
  });
  const invalid = (ctx, label, cmd, valid) => ctx.report(diag.warning(`${label} no válido: ${brief(cmd)}${valid ? ` (${valid})` : ''}`));

  /** Reports a whole-number argument outside its range; returns it limited (the nearest valid value). */
  function limited(ctx, cmd, label, v, range, unit = 'puntos') {
    const fixed = limit(v, range);
    if (fixed !== v) ctx.report(diag.warning(`${cmd.id}: ${label ? `${label} ` : ''}${v} fuera de ${rangeText(range)} ${unit}, se usa ${fixed}`));
    return fixed;
  }

  /** 0.1 mm of a number of dots, rounded to 0.1 mm (the neutral size is never finer than that). */
  const toTenthMm = (dots, dot) => Math.round(dots * dot + 1e-6);

  const HANDLERS = [
    {
      // ^PWw: print width in dots (2 .. the label width): outside the range it is drawn at the nearest limit, native keeps what was written
      pattern: /^\^PW$/,
      immediate: true,
      handle(m, cmd, ctx) {
        const w = int(cmd.args[0]);
        if (w === null) { invalid(ctx, '^PW', cmd, `número entero de ${rangeText(PW_RANGE)} puntos`); return; }
        ctx.model.size.width = toTenthMm(limited(ctx, cmd, 'ancho', w, PW_RANGE), ctx.dot);
        ctx.model.size.tolerance = ctx.dot;
        ctx.model.size.native.pw = w;
        ctx.model.size.native.pwRaw = cmd.raw;
      },
    },
    {
      // ^LLy: label length in dots (1 .. 32000)
      pattern: /^\^LL$/,
      immediate: true,
      handle(m, cmd, ctx) {
        const l = int(cmd.args[0]);
        if (l === null) { invalid(ctx, '^LL', cmd, `número entero de ${rangeText(LL_RANGE)} puntos`); return; }
        ctx.model.size.height = toTenthMm(limited(ctx, cmd, 'largo', l, LL_RANGE), ctx.dot);
        ctx.model.size.tolerance = ctx.dot;
        ctx.model.size.native.ll = l;
        ctx.model.size.native.llRaw = cmd.raw;
      },
    },
    {
      // ^LHx,y label home, ^LSa shift left, ^LTx label top: they move every later field (state shared with the edit engines)
      pattern: /^\^(LH|LS|LT)$/,
      immediate: true,
      handle(m, cmd, ctx) {
        if (ctx.offsets.feed(cmd) === false) { invalid(ctx, `^${m[1]}`, cmd, m[1] === 'LH' ? 'x, y: números enteros de 0..32000 puntos' : `número entero de ${rangeText(zplEdit.OFFSET_LIMITS[m[1]])} puntos`); return; }
        // A value outside the guide's range is applied at the nearest limit by the offsets (shared with the editing engines); say so
        (m[1] === 'LH' ? [['x', 0], ['y', 1]] : [['', 0]]).forEach(([axis, i]) => {
          const v = int(cmd.args[i]);
          if (v !== null) limited(ctx, cmd, axis, v, zplEdit.OFFSET_LIMITS[m[1]]);
        });
      },
    },
    {
      // ^POa: N normal, I inverted 180 degrees (reported, not applied: the viewer draws it as N)
      pattern: /^\^PO$/,
      immediate: true,
      handle(m, cmd, ctx) {
        const a = cmd.args[0] ? cmd.args[0].raw.toUpperCase() : '';
        if (a !== 'N' && a !== 'I') { invalid(ctx, '^PO', cmd); return; }
        ctx.invert = a === 'I';
        ctx.model.size.native.invert = ctx.invert;
        if (ctx.invert) ctx.report(diag.info('^POI gira la etiqueta 180°: el visor la dibuja sin girar (no verificado en impresora)'));
      },
    },
    {
      // ^CFf,h,w: default font. Only the height (or only the width) given makes the other one proportional (null); nothing given keeps all
      pattern: /^\^CF$/,
      immediate: true,
      handle(m, cmd, ctx) {
        const name = cmd.args[0] && /^[A-Za-z0-9]$/.test(cmd.args[0].raw) ? cmd.args[0].raw.toUpperCase() : null;
        const [h, w] = [int(cmd.args[1]), int(cmd.args[2])];
        if (name === null && h === null && w === null) {
          if (cmd.args.some(a => a.raw !== '')) invalid(ctx, '^CF', cmd);
          return;
        }
        const f = ctx.font;
        // explicit: a ^CF gave sizes, so an ^A of another font without sizes uses them (Volume Two, page 63); the power-up default A 9 x 5 does not
        ctx.font = {
          name: name === null ? f.name : name,
          height: h !== null ? h : w !== null ? null : f.height,
          width: w !== null ? w : h !== null ? null : f.width,
          explicit: Boolean(f.explicit) || h !== null || w !== null,
        };
      },
    },
    {
      // ^FWr: default orientation of the fields (a missing parameter is ignored, as the guide says)
      pattern: /^\^FW$/,
      immediate: true,
      handle(m, cmd, ctx) {
        const r = cmd.args[0] ? cmd.args[0].raw.toUpperCase() : '';
        if (r === '') return;
        if (rotationOf(r) === null) invalid(ctx, '^FW', cmd);
        else ctx.orientation = r;
      },
    },
    {
      // ^CIa: international character set (kept; nothing is drawn differently)
      pattern: /^\^CI$/,
      immediate: true,
      handle(m, cmd, ctx) {
        const a = int(cmd.args[0]);
        if (a === null || a < 0 || a > 24) invalid(ctx, '^CI', cmd, 'conjunto de caracteres 0..24');
        else ctx.charset = a;
      },
    },
    {
      // ^BYw,r,h: module width (1..10 dots), wide/narrow ratio (2.0..3.0) and height (dots) of the bar codes that follow
      pattern: /^\^BY$/,
      immediate: true,
      handle(m, cmd, ctx) {
        const v = byValues(cmd);
        if (v.invalid) { invalid(ctx, '^BY', cmd); return; }
        ctx.by = { module: v.module ?? ctx.by.module, ratio: v.ratio ?? ctx.by.ratio, height: v.height ?? ctx.by.height };
      },
    },
    {
      // ^CC / ^CD / ^CT: the tokenizer applies the prefix and delimiter changes; nothing else to do
      pattern: /^[\^~](CC|CD|CT)$/,
      immediate: true,
      handle() {},
    },
    {
      // ^DFd:o.x: stores the format as a template for ^XF (the viewer does not store anything: the template is drawn as a normal label)
      pattern: /^\^DF$/,
      immediate: true,
      handle(m, cmd, ctx) {
        ctx.once('zpl-df', () => diag.info('^DF guarda este formato como plantilla para ^XF (sus campos ^FN se rellenan al recuperarla): el visor lo dibuja como una etiqueta normal, sin guardarlo'));
      },
    },
    {
      // ^XFd:o.x: recalls a stored template; the template lives on the printer, so it is not available here (see the header)
      pattern: /^\^XF$/,
      immediate: true,
      handle(m, cmd, ctx) {
        ctx.recalled = true;
        ctx.once('zpl-xf', () => diag.warning('^XF recupera una plantilla almacenada en la impresora (^DF): plantilla almacenada no disponible, los campos ^FN sin posición se toman como datos de esa plantilla y no se dibujan'));
      },
    },
    {
      // Printer configuration: recognised, not drawn (one info per label lists them)
      pattern: new RegExp(`^[\\^~](?:${CONFIG_NAMES.join('|')})$`),
      immediate: true,
      handle(m, cmd, ctx) {
        ctx.ignored.add(cmd.id);
        const check = cmd.control ? null : CONFIG_CHECKS[cmd.name];
        if (check) for (const problem of check(cmd)) ctx.report(diag.warning(`${cmd.id}: ${problem}`));
      },
    },
  ];

  // ---------------------------------------------------------------------------------------------------------------
  // Parse driver

  /** Context of a parse: the model under construction, the printer state and the coordinate conversion. */
  function createContext(model, dpi, src = '') {
    const offsets = zplEdit.createOffsets();
    const seen = new Set();
    return {
      model,
      src,
      dpi,
      dot: units.dotSize(dpi),
      offsets,
      get lh() { return offsets.lh; },
      get ls() { return offsets.ls; },
      get lt() { return offsets.lt; },
      orientation: 'N',
      font: { name: 'A', height: 9, width: 5, explicit: false },
      by: { module: 2, ratio: 3, height: 10 },
      charset: 0,
      invert: false,
      /** ^LR: true after ^LRY until ^LRN. Every field OPENED while it is on is reversed (see dispatch). */
      labelReverse: false,
      /** ^FN data by variable name (the default test values of the label) and whether an ^XF recall was read (see the header). */
      variableDefaults: {},
      recalled: false,
      /** The open field (see the header), and the ids of the configuration commands seen. */
      field: null,
      ignored: new Set(),
      report: d => model.diagnostics.push(d),
      /** Reports fn()'s diagnostic only the first time `key` is seen in this parse. */
      once(key, fn) {
        if (seen.has(key)) return;
        seen.add(key);
        const d = fn();
        if (d) model.diagnostics.push(d);
      },
      addItem(item) { model.items.push(item); return item; },
      sourceOf,
      /** Dots -> 0.1 mm. */
      len(dots) { return dots * this.dot; },
      /** Point in dots (as written in the command) -> 0.1 mm, with ^LH, ^LS and ^LT applied. */
      pos(xDots, yDots) {
        const o = offsets.offset();
        return { x: (xDots + o.x) * this.dot, y: (yDots + o.y) * this.dot };
      },
      /** Origin of a field in 0.1 mm: { x, y, kind: 'FO' | 'FT' | 'default' } (a field with no ^FO / ^FT sits at 0,0 of the label home). */
      origin(field) {
        if (!field.origin) {
          this.once('zpl-no-origin', () => diag.info('Hay campos sin ^FO ni ^FT: se colocan en el origen de la etiqueta (0,0)'));
          return { ...this.pos(0, 0), kind: 'default' };
        }
        const at = v => limit(Math.round(v), COORD_RANGE); // ^FO / ^FT 0..32000 whole dots: the field.origin keeps what was written
        return { ...this.pos(at(field.origin.x), at(field.origin.y)), kind: field.origin.kind };
      },
    };
  }

  const handlerFor = (id, immediate) => ALL_HANDLERS.find(h => Boolean(h.immediate) === immediate && h.pattern.test(id));

  /** Starts a field; its start offset is the one of its first command. */
  function openField(ctx) {
    const cmds = [];
    ctx.field = { start: null, end: null, raw: '', cmds, origin: null, data: null, fn: null, serial: null, block: null, reverse: false, labelReverse: ctx.labelReverse, closed: false, ...zplEdit.fieldMethods(cmds) };
    return ctx.field;
  }

  function addToField(ctx, cmd) {
    const field = ctx.field || openField(ctx);
    if (field.start === null) field.start = cmd.start;
    field.cmds.push(cmd);
    return field;
  }

  /** A field start (^FO / ^FT): the origin in dots as written; a missing or empty value is 0 (the guide's default), a non numeric one a warning. */
  function startField(ctx, cmd) {
    const open = ctx.field;
    if (open && open.cmds.some(c => c.id !== '^FO' && c.id !== '^FT')) {
      ctx.once('zpl-missing-fs', () => diag.warning('Hay campos sin ^FS: se cierran en el campo siguiente (^FO / ^FT) o en ^XZ'));
      closeField(ctx);
    }
    ctx.field = null;
    const field = addToField(ctx, cmd);
    const [x, y] = [0, 1].map(i => {
      const a = cmd.args[i];
      if (!a || a.raw === '') return 0;
      const v = num(a);
      if (v === null) { invalid(ctx, `^${cmd.name}`, cmd, `x, y: números enteros de ${rangeText(COORD_RANGE)} puntos`); return 0; }
      const fixed = limit(Math.round(v), COORD_RANGE);
      if (fixed !== v) ctx.report(diag.warning(`${cmd.id}: ${i === 0 ? 'x' : 'y'} ${a.raw.slice(0, 20)} no es un número entero de ${rangeText(COORD_RANGE)} puntos, se usa ${fixed}`));
      return v;
    });
    field.origin = { cmd, kind: cmd.name, x, y };
  }

  /** Closes the open field (explicitly with ^FS, or implicitly) and hands it to the slice handler of its main command. */
  function closeField(ctx, fs) {
    const field = ctx.field;
    if (!field) return;
    ctx.field = null;
    if (fs) { field.cmds.push(fs); field.closed = true; }
    if (field.start === null) return;
    field.end = field.cmds[field.cmds.length - 1].end;
    field.raw = ctx.src.slice(field.start, field.end);
    dispatch(ctx, field);
  }

  function dispatch(ctx, field) {
    const content = field.cmds.filter(c => !MODIFIERS.has(c.id) && c.id !== '^FO' && c.id !== '^FT');
    let main;
    let key;
    if (content.length) {
      main = content.filter(c => !c.unsupported).pop();
      if (!main) return; // only commands the viewer does not know: already reported
      key = main.id;
    } else if (field.data || field.fn) {
      main = field.data ? field.data.cmd : field.fn.cmd;
      key = '^FD';
    } else return; // only an origin: nothing to draw
    const handler = handlerFor(key, false);
    if (!handler) {
      if (!main.unsupported) ctx.report(diag.warning(`Comando no soportado por el visor: ${brief(main)}`));
      return;
    }
    const variable = useVariable(ctx, field, key);
    if (variable && ctx.recalled && !field.origin) return; // data for a template the viewer does not have
    // ^LRY is the same as an ^FR in every field after it (the guide): the handlers only see field.reverse; native.labelReverse (set by the
    // slices that keep a native) tells the editing engines the ^FR is not in the field itself
    if (field.labelReverse) field.reverse = true;
    const before = ctx.model.items.length;
    handler.handle(key.match(handler.pattern), main, ctx, field);
    const added = ctx.model.items.slice(before);
    if (variable) {
      for (const item of added) if (item.data === variable.placeholder) item.native = { ...item.native, fn: { n: variable.n, prompt: variable.prompt, default: variable.default } };
    } else if (field.serial) applySerial(ctx, field.serial, added);
    if (field.block && added.some(item => item.kind !== 'text')) {
      ctx.once('zpl-fb-not-text', () => diag.info('^FB (bloque de texto) solo se aplica al texto: en códigos de barras, QR, Data Matrix o imágenes el visor lo ignora'));
    }
    if (field.reverse && ctx.model.items.slice(before).some(item => !REVERSIBLE.has(item.kind))) {
      ctx.once('zpl-reverse-unsupported', () => diag.info('^FR / ^LR sobre códigos de barras, QR, Data Matrix o imágenes: el visor los dibuja sin invertir (no verificado en impresora)'));
    }
  }

  /**
   * ^SNv,n,z (see the header): { cmd, step, zeros, native: { n, z } (as written), data } where data is the field data the slices read (the start value).
   * A parameter that is not valid is reported and takes its default (n 1, z N); an increment over the 12 digits of the guide is clamped.
   */
  function readSerial(ctx, cmd) {
    const [a, b, c] = [0, 1, 2].map(i => cmd.args[i]);
    const start = a && a.raw !== '' ? a.raw : '1';
    let step = 1;
    if (b && b.raw !== '') {
      const n = int(b);
      if (n === null) ctx.report(diag.warning(`^SN: incremento "${b.raw}" no válido, se usa 1`));
      else if (Math.abs(n) > zplEdit.SERIAL_MAX) {
        ctx.report(diag.warning(`^SN: el incremento ${b.raw} supera los 12 dígitos del comando, se ajusta a ${n < 0 ? '-' : ''}${zplEdit.SERIAL_MAX}`));
        step = Math.sign(n) * zplEdit.SERIAL_MAX;
      } else step = n;
    }
    const z = c ? c.raw.toUpperCase() : '';
    if (!['', 'Y', 'N'].includes(z)) ctx.report(diag.warning(`^SN: ceros iniciales "${c.raw}" no válido (Y o N), se usa N`));
    return {
      cmd, step, zeros: z === 'Y', native: { n: b ? b.raw : '', z: c ? c.raw : '' },
      data: { cmd, kind: 'SN', value: start, raw: start, start: a ? a.start : cmd.end, end: a ? a.end : cmd.end, hex: false },
    };
  }

  /** ^FNn or ^FNn"prompt": { cmd, n, prompt } (prompt undefined when there is none); null (and a warning) when it is not valid. */
  function readFn(ctx, cmd) {
    const m = /^\s*(\d*)\s*(?:"([^"]*)")?\s*$/.exec(cmd.raw.slice(1 + cmd.name.length));
    const n = m ? (m[1] === '' ? 0 : Number(m[1])) : NaN;
    if (!m || n > FN_MAX) { invalid(ctx, '^FN', cmd); return null; }
    return { cmd, n, prompt: m[2] };
  }

  /**
   * A field with ^FN: its data becomes the placeholder <#FNn#> and the ^FD data it has is the default value (see the header). Returns
   * { n, prompt, default, placeholder } or null (no ^FN, an invalid one, or a 2D code, which keeps its own ^FD data).
   */
  function useVariable(ctx, field, key) {
    const fn = field.fn;
    if (!fn) return null;
    if (field.data && field.data.kind === 'SN') ctx.once('zpl-fn-sn', () => diag.warning('Hay campos con ^FN y ^SN a la vez: se usa ^FN (la variable) y se ignora el contador'));
    if (NO_VARIABLE.test(key)) {
      ctx.once('zpl-fn-2d', () => diag.info('^FN en QR o Data Matrix: no se modela como variable (el dato lleva el prefijo del QR y el símbolo se construye con él): se lee el dato ^FD por defecto'));
      return null;
    }
    const own = field.data && field.data.kind !== 'SN' && field.data.kind !== 'FN' ? field.data : null;
    const name = `FN${fn.n}`;
    const placeholder = `<#${name}#>`;
    const dflt = own ? own.value : undefined;
    if (dflt !== undefined && !Object.hasOwn(ctx.variableDefaults, name)) ctx.variableDefaults[name] = dflt;
    ctx.once('zpl-fn', () => diag.info('Los campos ^FN son variables <#FNn#>: se dibujan con su dato ^FD por defecto, que se puede cambiar en Variables'));
    field.data = { cmd: fn.cmd, kind: 'FN', value: placeholder, raw: placeholder, start: fn.cmd.start, end: fn.cmd.end, hex: false };
    field.serial = null;
    return { n: fn.n, prompt: fn.prompt, default: dflt, placeholder };
  }

  /** The counter of a ^SN field on the items its handler added: text and bar codes get it, the 2D codes are reported (see the header). */
  function applySerial(ctx, serial, items) {
    for (const item of items) {
      if (item.kind === 'text' || item.kind === 'barcode') {
        if (serial.step !== 0) {
          item.counter = { step: serial.step, native: serial.native };
          ctx.once('zpl-counter', () => diag.info(COUNTER_NOTE));
        }
        if (!serial.zeros) item.zeroSuppress = 1;
      } else if (item.kind === 'qr' || item.kind === 'datamatrix') {
        ctx.once('zpl-counter-2d', () => diag.info('^SN en QR o Data Matrix: se lee el valor inicial como dato, el contador no se modela para códigos 2D'));
      }
    }
  }

  /** One command read, in order. */
  function feed(ctx, cmd) {
    const { id } = cmd;
    if (id === '^FS') { closeField(ctx, cmd); return; }
    if (id === '^FX') return;
    if (id === '^FO' || id === '^FT') { startField(ctx, cmd); return; }
    const immediate = cmd.name ? handlerFor(id, true) : null;
    if (immediate) { immediate.handle(id.match(immediate.pattern), cmd, ctx); return; }
    if (MODIFIERS.has(id)) {
      const field = addToField(ctx, cmd);
      if (id === '^FR') field.reverse = true;
      else if (id === '^FB') field.block = cmd;
      else if (cmd.data) {
        field.data = { cmd, kind: cmd.name, value: cmd.args[0].value, raw: cmd.args[0].raw, start: cmd.args[0].start, end: cmd.args[0].end, hex: !!cmd.hex };
        field.serial = null;
      } else if (id === '^FN') field.fn = readFn(ctx, cmd);
      else if (id === '^SN') { field.serial = readSerial(ctx, cmd); field.data = field.serial.data; }
      else if (id === '^SF') ctx.once('zpl-sf', () => diag.warning('^SF (formato de serialización con máscara) no se modela: el campo se dibuja con el dato ^FD tal como está y sin contador'));
      return;
    }
    if (!handlerFor(id, false)) {
      cmd.unsupported = true;
      ctx.report(diag.warning(`Comando no soportado por el visor: ${brief(cmd)}`));
    }
    addToField(ctx, cmd);
  }

  /** Parses and returns { model, ctx } (the ctx as left by the last command). */
  function run(src, { dpi = PB.config.resolutions[0] } = {}) {
    const model = {
      language: 'zpl',
      size: { width: null, height: null, pitch: null, gap: null, native: { pw: null, ll: null, pwRaw: null, llRaw: null, invert: null } },
      items: [],
      diagnostics: [],
    };
    const ctx = createContext(model, dpi, src);
    let formats = 0;
    let done = false;
    for (const cmd of commands(src)) {
      if (cmd.id === '^XA') { formats++; if (!done) closeField(ctx); continue; }
      if (cmd.id === '^XZ') { if (!done) { closeField(ctx); done = true; } continue; }
      if (!done) feed(ctx, cmd);
    }
    if (!done) closeField(ctx);
    if (formats > 1) ctx.report(diag.info(`El archivo tiene ${formats} formatos (^XA ... ^XZ): el visor muestra solo el primero`));
    if (Object.keys(ctx.variableDefaults).length) model.variableDefaults = ctx.variableDefaults;
    if (ctx.ignored.size) ctx.report(diag.info(`Comandos de configuración de la impresora sin efecto en el visor: ${[...ctx.ignored].join(', ')}`));
    return { model, ctx };
  }

  /** opts: { dpi } (default: the first resolution of the configuration). */
  const parse = (src, opts) => run(src, opts).model;

  const COMPOSED = PB.composeSlices('zpl', SLICE_HELPERS, { handlers: HANDLERS });
  const ALL_HANDLERS = COMPOSED.handlers;
  // Move / describe / update engines (js/languages/zpl-edit.js) driven by the slices' coordinates and editable definitions
  const EDITING = zplEdit.createZplEditing({ coordinates: COMPOSED.coordinates, editable: COMPOSED.editable, commands });

  // ---------------------------------------------------------------------------------------------------------------
  // Detection

  const FORMAT_START = /\^XA/i;

  /**
   * A format (^XA) or at least two commands of the guide. TPCL ({...|}) and TSPL texts are never ZPL (the registry asks them first, and this
   * checks them too, so the order of registration does not matter).
   */
  function detect(src) {
    if (typeof src !== 'string' || src === '') return false;
    if (/\{[\s\S]*?\|\}/.test(src)) return false;
    if (['tpcl', 'tspl'].some(id => { const language = PB.languages.get(id); return language && language.detect(src); })) return false;
    if (FORMAT_START.test(src)) return true;
    let found = 0;
    for (const cmd of commands(src)) if (cmd.name && isKnownName(cmd.name) && ++found >= 2) return true;
    return false;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Emit: neutral model -> ZPL text

  /** Width or length in dots limited to its range, with one warning (naming the command and the range) when it had to change. */
  function fitLength(ctx, dots, range, command, label) {
    const fixed = limit(dots, range);
    if (fixed !== dots) ctx.report(diag.warning(`El ${label} de la etiqueta (${dots} puntos) está fuera del rango de ${command} de ZPL (${rangeText(range)}), se escribe ${fixed}`));
    return fixed;
  }

  /** ^XA, then ^PW and ^LL when the model knows the size (else omitted with a warning). ^LH is never written: the parser folds it into the coordinates. */
  function headerLines(model, ctx) {
    const size = (model && model.size) || {};
    const out = ['^XA'];
    const width = Number.isFinite(size.width);
    const height = Number.isFinite(size.height);
    if (width) out.push(`^PW${fitLength(ctx, roundDots(exactDots(ctx, size.width)), PW_RANGE, '^PW', 'ancho')}`);
    if (height) out.push(`^LL${fitLength(ctx, roundDots(exactDots(ctx, size.height)), LL_RANGE, '^LL', 'largo')}`);
    if (!width || !height) ctx.report(diag.warning('La etiqueta no declara su tamaño: no se escribe ^PW / ^LL, indique el tamaño antes de exportar'));
    // ^POI (printed rotated 180 degrees) is written back as it was read; a TSPL DIRECTION 0 has no ZPL counterpart here and is reported
    const native = size.native || {};
    if (native.invert === true) out.push('^POI');
    else if (native.direction === 0) ctx.report(diag.info('La etiqueta de origen se imprime girada 180° (DIRECTION 0 de TSPL o ^POI de ZPL): el visor la dibuja sin girar y el giro no se escribe en el destino, compruebe la orientación en su impresora'));
    // ZPL declares the width and the length only (^LS and ^LT are offsets): the TPCL pitch and the TSPL gap have nowhere to go
    if (Number.isFinite(size.pitch) || Number.isFinite(size.gap)) {
      ctx.report(diag.info('El paso de etiqueta (pitch de TPCL) o la separación entre etiquetas (GAP de TSPL) no se escriben: ZPL solo declara el ancho y el largo (^PW y ^LL), compruebe el ajuste en su impresora'));
    }
    return out;
  }

  /**
   * Neutral model -> { text, diagnostics }: ^XA, the size, the items (slices' emit hooks), ^XZ. Lines are joined with CRLF and the text ends with
   * one (printers accept either; the file keeps the line ending the other languages use).
   */
  function emit(model, { dpi = PB.config.resolutions[0] } = {}) {
    const ctx = PB.emit.createContext({ dpi, language: 'zpl' });
    const header = headerLines(model, ctx);
    const { lines } = PB.emit.run(model, COMPOSED, ctx);
    return { text: [...header, ...lines, '^XZ', ''].join('\r\n'), diagnostics: ctx.diagnostics };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Size writing: resolved size (0.1 mm: { w, h, p, dpi? }) -> ^PW / ^LL

  /**
   * Widest label the Formato row offers (0.1 mm): 32000 dots at the resolution. { width, height: [min, max] } with the generic 5 mm minimum
   * (^PW 2 dots and ^LL 1 dot are valid but not a label). The static `sizeLimits` are the widest of the configured resolutions.
   */
  const sizeLimitsFor = dpi => {
    const max = Math.round(PW_RANGE[1] * units.dotSize(dpi || PB.config.resolutions[0]));
    return { width: [50, max], height: [50, max] };
  };
  const SIZE_LIMITS = sizeLimitsFor(Math.min(...PB.config.resolutions));

  /**
   * Resolved size (0.1 mm: w, h, p; dpi when the app adds it) with the width and the length limited to ^PW 2..32000 and ^LL 1..32000 dots at that
   * resolution: { size, diagnostics } (one warning when something changed). Used by the Formato row (PB.sizes.apply) and by sizeCommands.
   */
  function fitSize(size) {
    const dot = units.dotSize(size.dpi || PB.config.resolutions[0]);
    const fit = (mm10, range) => {
      if (!Number.isFinite(mm10)) return mm10;
      const dots = roundDots(mm10 / dot);
      return limit(dots, range) === dots ? mm10 : limit(dots, range) * dot;
    };
    const [w, h] = [fit(size.w, PW_RANGE), fit(size.h, LL_RANGE)];
    if (w === size.w && h === size.h) return { size, diagnostics: [] };
    return {
      size: { ...size, w, h },
      diagnostics: [diag.warning(`El tamaño de la etiqueta se ajusta a los rangos de ZPL (^PW ${rangeText(PW_RANGE)} puntos, ^LL ${rangeText(LL_RANGE)} puntos)`)],
    };
  }

  /** ^PW and ^LL in dots at size.dpi (the app adds the resolution to the size it hands over; the first configured one otherwise), within the ranges. */
  function sizeCommands(wanted) {
    const size = fitSize(wanted).size;
    const dot = units.dotSize(size.dpi || PB.config.resolutions[0]);
    return [`^PW${limit(roundDots(size.w / dot), PW_RANGE)}`, `^LL${limit(roundDots(size.h / dot), LL_RANGE)}`];
  }

  /**
   * Writes the size in the text: the first ^PW and the first ^LL of the first format are replaced in place; a missing one is added right after
   * the first ^XA (on its line break when the ^XA ends its line, else glued to it); without any ^XA the commands go on top, and an empty text
   * becomes a new format. Found with the tokenizer, so data is never matched; the line ending of the file stays.
   */
  function applySize(text, size) {
    const [pwLine, llLine] = sizeCommands(size);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let xa = null;
    let pw = null;
    let ll = null;
    for (const cmd of commands(text)) {
      if (cmd.id === '^XZ') break;
      if (cmd.id === '^XA' && !xa) xa = cmd;
      else if (cmd.id === '^PW' && !pw) pw = cmd;
      else if (cmd.id === '^LL' && !ll) ll = cmd;
    }
    const missing = [...(pw ? [] : [pwLine]), ...(ll ? [] : [llLine])];
    if (!xa && text.trim() === '') return `^XA${eol}${missing.join(eol)}${eol}^XZ${eol}`;
    const edits = [];
    if (pw) edits.push({ start: pw.start, end: pw.end, value: pwLine });
    if (ll) edits.push({ start: ll.start, end: ll.end, value: llLine });
    if (missing.length) {
      if (!xa) edits.push({ start: 0, end: 0, value: missing.join(eol) + eol });
      else {
        const endsLine = /^[ \t]*[\r\n]/.test(text.slice(xa.end));
        edits.push({ start: xa.end, end: xa.end, value: missing.map(line => (endsLine ? eol : '') + line).join('') });
      }
    }
    let out = text;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.value + out.slice(e.end);
    return out;
  }

  /**
   * Adds a field (its commands, as written by a slice's `build` hook) to the text: before the closing ^XZ of the first format, at the start of
   * its line when it has the line to itself, else glued before it. Without ^XZ it goes at the end; an empty text becomes a new ^XA .. ^XZ
   * format. Uses the line ending of the file (CRLF if it has any, else LF). ^XZ is found with the tokenizer, so the letters inside field data
   * never match. Not handled: a field left open (no ^FS) just before the ^XZ is closed by the new one, which the parser reports.
   */
  function insertCommand(text, command) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    if (text.trim() === '') return `^XA${eol}${command}${eol}^XZ${eol}`;
    for (const cmd of commands(text)) {
      if (cmd.id !== '^XZ') continue;
      const head = text.slice(0, cmd.start);
      const lineStart = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('\r')) + 1;
      if (/^[ \t]*$/.test(head.slice(lineStart))) return `${text.slice(0, lineStart)}${command}${eol}${text.slice(lineStart)}`;
      return `${head}${command}${text.slice(cmd.start)}`;
    }
    return /\n$/.test(text) ? `${text}${command}${eol}` : `${text}${eol}${command}`;
  }

  /** Component kinds of the palette (neutral), in display order: the slices that have a `build` hook. */
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

  /** Tokenizer and driver, exposed for the slices' tests and the app. */
  PB.zpl = Object.freeze({ commands, run, createContext, SLICE_HELPERS, CONFIG_NAMES });

  /**
   * ^FO..^GFA..^FS for the preview picture ({ xMm, yMm } in mm, empty or invalid = 0; w, h in dots; data = neutral bitmap, 1 = black; dpi), ready for
   * insertCommand. A bitmap over the 99999 bytes of ^GF is refused with an error (the app shows it as the reason the image was not inserted).
   */
  function imageCommand({ xMm, yMm, w, h, data, dpi }) {
    const image = PB.slices.image.zpl;
    const bitmap = { w, h, data };
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error(`${w}×${h} puntos no es un tamaño de imagen válido`);
    if (image.totalBytes(bitmap) > image.MAX_BYTES) {
      throw new Error(`${w}×${h} puntos supera el máximo de ^GF (${image.MAX_BYTES} bytes de imagen)`);
    }
    const dots = mm => {
      const tenths = units.fromMm(mm);
      return Number.isFinite(tenths) ? Math.max(0, roundDots(tenths / units.dotSize(dpi))) : 0;
    };
    return image.graphicField(dots(xMm), dots(yMm), bitmap);
  }

  // UTF-8 (the default): see the note on ^CI in the header. The ^GF data is ASCII hexadecimal, so the file stays plain text.
  PB.languages.register({
    id: 'zpl', name: 'ZPL (Zebra)', detect, parse, emit, fileEncoding: 'utf-8', fileExtension: 'zpl', sizeCommands, applySize, fitSize, sizeLimits: SIZE_LIMITS, sizeLimitsFor,
    insertCommand, insertImage: true, imageCommand, moveItem: EDITING.moveItem, describeItem: EDITING.describeItem, updateItem: EDITING.updateItem,
    componentTemplates: () => COMPONENTS.map(c => ({ ...c })), buildComponent,
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
