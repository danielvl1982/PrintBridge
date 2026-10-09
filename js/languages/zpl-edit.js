/**
 * ZPL editing engines: move, describe and update an item by rewriting only the arguments of the commands of its field.
 * Language hooks with the same signatures as TPCL's and TSPL's (see js/core/languages.js); what is ZPL specific lives in the
 * definitions the slices provide in js/components/<kind>/zpl.js (`coordinates` and `editable`), so this file knows no drawing
 * command by name. It is loaded before js/languages/zpl.js, which builds the engines with the composed definitions.
 *
 * The difference with TSPL (one command per item): a ZPL item is a FIELD, several commands (^FO ... ^A ... ^FD ... ^FS), and the
 * item's source span covers all of them. The engines walk the commands inside that span (PB.zpl.commands) and a definition
 * addresses an argument as { cmd, arg }: the NAME of a command inside the field (without the prefix: 'FD', 'A', 'BC'; or an array
 * of names, the last command of the field that matches is used) and the index of the argument in cmd.args.
 *
 * Definitions:
 *   coordinates: [{ applies(item, field) -> bool, fields?: [{ cmd, arg, axis: 'x' | 'y' }] }]
 *     the first entry that applies is used. `fields` default to the field origin: ^FO / ^FT x and y (arguments 0 and 1, in dots), which
 *     is what every ZPL item moves with; an entry adds more only for a command with coordinates of its own.
 *   editable: [{ applies(item, field) -> bool, fields: [field], reemit?(field, item, changes, opts) -> edits | null }]
 *     (describeItem without text calls applies(item, undefined): decide by item.kind then). `field` is the object of
 *     the engine: { cmds, find(names), findAll(names), has(names) }. A descriptor field is
 *     { key, label, type: 'number' | 'select' | 'checkbox' | 'text', cmd, arg, min?, max?, step?, maxLength?, options?: [{ value, label }],
 *       read(arg, cmd, field) -> value | undefined, write(value, arg, cmd, field) -> new raw text | null | { value, edits: [{ start, end, value }] },
 *       model?(item, { dpi }) -> value, optional?, optionsFor?, reemit? }
 *     arg is an argument index, or a function (cmd) -> index. write receives the argument too, so a field can rewrite a PART of it
 *     (^A glues the font letter and the orientation in its first argument). `edits` are extra edits the write needs (the ^FH that
 *     switches on the hex escapes before a ^FD). optional: the value of a trailing or empty argument when it is omitted (e.g. ^GB colour B):
 *     describeItem lists it, updateItem fills or appends the argument for any other value and writes nothing for the default.
 *     numberField(), selectField(), stringSelectField(), checkboxField(), textField() and contentField() build the usual ones.
 *     flag: the field is the PRESENCE of the command `cmd` (no arguments, ^FR): describeItem gives true / false, updateItem adds it before the
 *     ^FS or removes it. Fields that share one argument (^A: font letter and orientation) are written one over the other's result.
 *     reemit: the field is not written by itself: the shape's reemit hook writes the command again for the new value (barcode type).
 *     custom: the field is not one argument: it has its own read and write over the whole text (the barcode's module and ratio live in a
 *       ^BY command that can sit outside the field and be shared with other fields; an empty argument stands for a state value). A custom
 *       field has read(text, found, item) -> value | undefined (found = { field, offset }) and edits(text, found, item, value, opts) ->
 *       [{ start, end, value }] | null (null = refuse); opts.changes holds every key of the update. Without text, model(item) is used.
 *       argEdit(cmd, index, value) writes one argument of a command, filling the missing ones before it with empty arguments.
 *       paramField({ key, label, type, cmd, arg, read(raw, cmd, item), write(value, cmd, item) }) builds the usual custom field over one
 *       argument whose empty value stands for a default (QR model, Data Matrix module and orientation).
 *       reverseField(key, label) is the ^FR checkbox (own ^FR or the ^LRY state of the label: custom, see its comment); setArgs(cmd, { index: text })
 *       edits several arguments of a command at once.
 *       serialFields() are the two counter fields of the text and bar code slices (Incremento, Ceros iniciales): the data command of a field is
 *       ^FD / ^FV or ^SNv,n,z (the counter), and the Incremento field converts one into the other (a step of 0 is a plain ^FD; a step other than
 *       0 on a ^FD whose data ^SN can carry writes ^SN with z = Y). contentField reads and writes the first argument of ^SN too (its start value).
 *       A field with ^FN has no content or counter fields: its data is the variable <#FNn#> (the ^FD of the field is only the default test value).
 *
 * Only the text of the targeted arguments is replaced (by source offsets), so the other commands of the field, other fields,
 * comments and line endings stay byte for byte. An argument that is not a plain number is never moved. The coordinates of an item
 * (0.1 mm) include ^LH, ^LS and ^LT while the command keeps plain dots, so a move writes target - offset, rounded to whole dots and
 * never below 0 (createOffsets() follows those three commands). dropDots() applies the same rule to a new palette component.
 *
 * Field data and ^FH: the characters ^ and ~ cannot appear in field data (they start a command), so data that has them is written with
 * the ^FH hex escapes: the indicator (default _) followed by the two hex digits of the character (_5E for ^, _7E for ~, _5F for _ itself,
 * which must be escaped once ^FH is on). encodeData() / decodeData() are the two directions. Not verified on a printer; the guide
 * documents ^FH only with the hex value of the character in the active character set.
 */
(function (PB) {
  'use strict';

  const { units } = PB;

  const INTEGER = /^[+-]?\d+$/;
  const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

  /** Largest ^FD / ^FV data of the guide (3072 characters). */
  const MAX_DATA = 3072;

  /** ^SN increment: the guide gives 12 digits maximum. */
  const SERIAL_MAX = 999999999999;

  /**
   * A start value ^SN can carry: at least one digit (the right-most digits are the ones indexed), no comma, ^ or ~ (they split or start a command),
   * no line break, no blank at either end (the parameters are trimmed) and no variable placeholder (it would be written as text, not substituted).
   */
  function serializable(text) {
    return typeof text === 'string' && /\d/.test(text) && !/[,^~\r\n]/.test(text) && text === text.trim() && !PB.variables.namesIn(text).length;
  }

  const clampInt = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));

  /** Rounds to whole dots; the epsilon keeps x.5 values that float noise nudged just below from rounding down. */
  const roundDots = v => Math.round(v + 1e-6);

  // ---------------------------------------------------------------------------------------------------------------
  // ^FH hex escapes

  const isHex = ch => /^[0-9A-Fa-f]$/.test(ch);

  /** Data with the ^FH escapes resolved: indicator + two hex digits -> that character (a latin1 code point). */
  function decodeData(text, indicator) {
    if (!indicator) return text;
    let out = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === indicator && i + 2 < text.length && isHex(text[i + 1]) && isHex(text[i + 2])) {
        out += String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16));
        i += 2;
      } else out += text[i];
    }
    return out;
  }

  /**
   * Data as it can be written after ^FD: { hex, text }. ^ and ~ cannot be written as they are, so they (and the indicator, once ^FH is
   * on) become indicator + hex code and hex is true: the caller writes ^FH before the ^FD. hex = true on input says ^FH is already on.
   */
  function encodeData(value, { indicator = '_', hex = false } = {}) {
    const text = String(value);
    if (!hex && !/[\^~]/.test(text)) return { hex: false, text };
    const escape = ch => `${indicator}${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
    let out = '';
    for (const ch of text) out += ch === '^' || ch === '~' || ch === indicator ? escape(ch) : ch;
    return { hex: true, text: out };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Descriptor fields (the usual ones)

  /** Whole-number field: reads an integer argument, writes the value rounded and clamped to min..max. */
  const numberField = (key, label, cmd, arg, min, max, model) => ({
    key, label, type: 'number', cmd, arg, min, max, step: 1, model,
    read: a => (INTEGER.test(a.raw) ? Number(a.raw) : undefined),
    write: v => (typeof v === 'number' && Number.isFinite(v) ? String(clampInt(v, min, max)) : null),
  });

  /** Choice among numbers (e.g. rotations): options are numbers (labelled "<n>°") or { value, label }. */
  function selectField(key, label, cmd, arg, options, model) {
    const list = options.map(o => (typeof o === 'object' ? o : { value: o, label: `${o}°` }));
    return {
      key, label, type: 'select', cmd, arg, options: list, model,
      read: a => { const v = INTEGER.test(a.raw) ? Number(a.raw) : undefined; return list.some(o => o.value === v) ? v : undefined; },
      write: v => (list.some(o => o.value === v) ? String(v) : null),
    };
  }

  /**
   * Choice among letters (N / R / I / B, Y / N, B / W...): options are strings or { value, label }. The argument is read case-insensitively
   * (the listed spelling is returned); a current value outside the list is shown as an extra last option (optionsFor) but is never written.
   */
  function stringSelectField(key, label, cmd, arg, options, model) {
    const list = options.map(o => (typeof o === 'object' ? o : { value: o, label: o }));
    return {
      key, label, type: 'select', cmd, arg, options: list, model,
      optionsFor: value => (list.some(o => o.value === value) ? list : [...list, { value, label: value }]),
      read: a => {
        if (a.raw === '') return undefined;
        const hit = list.find(o => o.value.toUpperCase() === a.raw.toUpperCase());
        return hit ? hit.value : a.raw;
      },
      write: v => (list.some(o => o.value === v) ? v : null),
    };
  }

  /** Yes / no field written with two letters (Y / N for most ZPL parameters). */
  const checkboxField = (key, label, cmd, arg, on, off, model) => ({
    key, label, type: 'checkbox', cmd, arg, model,
    read: a => (a.raw.toUpperCase() === on ? true : a.raw.toUpperCase() === off ? false : undefined),
    write: v => (v === true ? on : v === false ? off : null),
  });

  /** Plain text argument (a file name): never written with a command prefix, the delimiter or a line break in it. */
  const textField = (key, label, cmd, arg, model, usable) => ({
    key, label, type: 'text', cmd, arg, model,
    read: (a, command) => (a.raw !== '' && (!usable || usable(command)) ? a.value : undefined),
    write: v => (typeof v === 'string' && v !== '' && !/[\^~,\r\n]/.test(v) ? v : null),
  });

  /**
   * The content of a field: the data of its ^FD (or ^FV). Read decoded (^FH escapes resolved); written with the escapes the characters
   * ^ and ~ need, adding ^FH before the ^FD when the field does not have it (extra edit); a line break becomes a space. usable(cmd, field)
   * can rule a field out (e.g. data the parser rewrites). model(item) gives the value when there is no text.
   */
  const contentField = (key, label, model, usable) => ({
    key, label, type: 'text', cmd: ['FD', 'FV', 'SN'], arg: 0, maxLength: MAX_DATA, model,
    // A field with ^FN has the variable as its data (the 2D codes keep their ^FD data: see js/languages/zpl.js)
    read: (a, cmd, field) => ((field.has('FN') && !field.has(['BQ', 'BX'])) || (usable && !usable(cmd, field)) ? undefined : cmd.name === 'SN' ? a.raw : a.value),
    write(v, a, cmd) {
      if (cmd.name === 'SN') return serializable(v) ? v : null;
      if (typeof v !== 'string' || v.length > MAX_DATA) return null;
      const encoded = encodeData(v.replace(/\r\n|\r|\n/g, ' '), { indicator: cmd.hex || '_', hex: !!cmd.hex });
      return encoded.hex && !cmd.hex ? { value: encoded.text, edits: [{ start: cmd.start, end: cmd.start, value: '^FH' }] } : encoded.text;
    },
  });

  /**
   * A custom field over ONE argument of a command of the field whose empty or missing value stands for a default the descriptor cannot see
   * (the orientation follows ^FW, an omitted model is 2...): read(raw, cmd, item) -> value | undefined (raw = the argument as written, '' when
   * empty or missing), write(value, cmd, item) -> the raw text | null (null refuses). Nothing is written when the value is the one in force.
   * names: the command(s) of the field (the last one that matches is used); index: the argument.
   */
  function paramField({ key, label, type, cmd: names, arg: index, read, write, ...rest }) {
    const locate = found => (found ? found.field.find(names) : undefined);
    const valueOf = (found, item, text) => {
      const cmd = locate(found);
      if (!cmd) return undefined;
      const a = cmd.args[index];
      return read(a ? a.raw : '', cmd, item, text);
    };
    return {
      key, label, type, custom: true, ...rest,
      read: (text, found, item) => valueOf(found, item, text),
      edits(text, found, item, value) {
        const cmd = locate(found);
        const raw = cmd ? write(value, cmd, item) : null;
        if (raw === null || raw === undefined || valueOf(found, item, text) === value) return null;
        return [argEdit(cmd, index, raw)];
      },
    };
  }

  /**
   * The reverse print checkbox of a field (text, shapes): `^FR` is the presence of a command, but a field can also be reversed by ^LRY, which
   * the parser records in native.labelReverse. Read: true with an own ^FR or under ^LRY. Write: true adds ^FR unless ^LRY already reverses the
   * field; false removes the own ^FR (^LRY stays: the label state is not part of the field, edit the text to turn it off).
   */
  function reverseField(key, label) {
    const viaLabel = item => Boolean(item && item.native && item.native.labelReverse === true);
    return {
      key, label, type: 'checkbox', custom: true, model: item => item.reverse === true || (item.kind === 'area' && item.mode === 'reverse') || viaLabel(item),
      read: (text, found, item) => found.field.has('FR') || viaLabel(item),
      edits(text, found, item, value) {
        if (typeof value !== 'boolean' || (value && viaLabel(item))) return null;
        const edits = [];
        flagEdits(text, found.field, { cmd: 'FR' }, value, edits);
        return edits.length ? edits : null;
      },
    };
  }

  /**
   * Edits that set several arguments of one command at once ({ index: new text }): an argument that exists is replaced, the missing ones are
   * appended in one run after the last argument (the gaps between them are written empty, so they keep their default).
   */
  function setArgs(cmd, values) {
    const edits = [];
    const missing = {};
    for (const [key, value] of Object.entries(values)) {
      const index = Number(key);
      const a = cmd.args[index];
      if (a) edits.push({ start: a.start, end: a.end, value });
      else missing[index] = value;
    }
    const indexes = Object.keys(missing).map(Number);
    if (indexes.length) {
      const parts = [];
      for (let i = cmd.args.length; i <= Math.max(...indexes); i++) parts.push(missing[i] === undefined ? '' : missing[i]);
      const at = appendPoint(cmd);
      edits.push({ start: at, end: at, value: (cmd.args.length ? ',' : '') + parts.join(',') });
    }
    return edits;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Counter fields (^SNv,n,z)

  /** The two counter fields of the text and bar code slices (see the header): [Incremento, Ceros iniciales]. */
  function serialFields() {
    const dataCmd = field => field.find(['FD', 'FV', 'SN']);
    const variable = field => field.has('FN') && !field.has(['BQ', 'BX']);
    /** n of a ^SN: default 1; undefined when it is not a whole number. */
    const stepOf = cmd => { const a = cmd.args[1]; return !a || a.raw === '' ? 1 : INTEGER.test(a.raw) ? Number(a.raw) : undefined; };
    /** z of a ^SN: default N (the guide); undefined when it is neither Y nor N. */
    const zerosOf = cmd => { const a = cmd.args[2]; const u = a ? a.raw.toUpperCase() : ''; return u === '' || u === 'N' ? false : u === 'Y' ? true : undefined; };
    const startOf = cmd => (cmd.args[0] && cmd.args[0].raw !== '' ? cmd.args[0].raw : '1');
    const counter = {
      key: 'counter', label: 'Incremento', type: 'number', min: -SERIAL_MAX, max: SERIAL_MAX, step: 1, custom: true,
      model: item => (item.counter && Number.isFinite(item.counter.step) ? item.counter.step : serializable(String(item.data ?? '')) ? 0 : undefined),
      read(text, found) {
        const cmd = dataCmd(found.field);
        if (!cmd || variable(found.field)) return undefined;
        if (cmd.name === 'SN') return stepOf(cmd);
        return serializable(cmd.args[0] ? cmd.args[0].value : undefined) ? 0 : undefined;
      },
      edits(text, found, item, value) {
        const { field } = found;
        const cmd = dataCmd(field);
        if (!cmd || variable(field) || typeof value !== 'number' || !Number.isFinite(value)) return null;
        const step = clampInt(value, -SERIAL_MAX, SERIAL_MAX);
        if (cmd.name === 'SN') {
          const current = stepOf(cmd);
          if (current === undefined || current === step) return null;
          if (step !== 0) return [argEdit(cmd, 1, String(step))];
          // Back to a plain ^FD: the data is escaped as the ^FH of the field says (the ^SN start value never is)
          const fh = field.cmds.find(c => c.name === 'FH' && c.start < cmd.start);
          const indicator = fh && fh.args[0] && fh.args[0].raw ? fh.args[0].raw[0] : '_';
          const encoded = encodeData(startOf(cmd), { indicator, hex: Boolean(fh) });
          return [{ start: cmd.start, end: cmd.end, value: `${cmd.prefix}FD${encoded.text}` }];
        }
        const data = cmd.args[0] ? cmd.args[0].value : undefined;
        if (step === 0 || !serializable(data)) return null;
        return [{ start: cmd.start, end: cmd.end, value: `${cmd.prefix}SN${data},${step},Y` }];
      },
    };
    const zeros = {
      key: 'zeros', label: 'Ceros iniciales', type: 'checkbox', custom: true,
      model: item => (item.counter ? !(item.zeroSuppress > 0) : undefined),
      read(text, found) {
        const cmd = dataCmd(found.field);
        return cmd && cmd.name === 'SN' && !variable(found.field) ? zerosOf(cmd) ?? false : undefined;
      },
      edits(text, found, item, value) {
        const cmd = dataCmd(found.field);
        if (!cmd || cmd.name !== 'SN' || variable(found.field) || typeof value !== 'boolean' || zerosOf(cmd) === value) return null;
        return [argEdit(cmd, 2, value ? 'Y' : 'N')];
      },
    };
    return [counter, zeros];
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Fields and offsets

  /** find / findAll / has over a list of commands (read at call time, so a growing list works): names without the prefix. */
  function fieldMethods(cmds) {
    const named = names => {
      const set = new Set([].concat(names).map(n => String(n).toUpperCase()));
      return cmds.filter(c => set.has(c.name));
    };
    return {
      find: names => named(names).pop(),
      findAll: names => named(names),
      has: names => named(names).length > 0,
    };
  }

  /**
   * Follows the ^LH, ^LS and ^LT commands fed to it (the same rules the parser uses): lh = { x, y } in dots, ls = shift left, lt = shift
   * down; offset() is what they add to the later coordinates, { x: lh.x - ls, y: lh.y + lt }. feed(cmd) returns true when the command
   * was one of the three and was applied, false when it was one and its value is not valid (nothing changes), null for any other command.
   * An omitted or empty ^LH argument keeps its previous value; at least one value is needed.
   */
  function createOffsets() {
    let lh = { x: 0, y: 0 };
    let ls = 0;
    let lt = 0;
    const whole = arg => (arg && INTEGER.test(arg.raw) ? Number(arg.raw) : null);
    return {
      get lh() { return lh; },
      get ls() { return ls; },
      get lt() { return lt; },
      feed(cmd) {
        if (cmd.id === '^LH') {
          const [x, y] = [whole(cmd.args[0]), whole(cmd.args[1])];
          if (x === null && y === null) return false;
          lh = { x: x === null ? lh.x : x, y: y === null ? lh.y : y };
          return true;
        }
        if (cmd.id === '^LS' || cmd.id === '^LT') {
          const v = whole(cmd.args[0]);
          if (v === null) return false;
          if (cmd.id === '^LS') ls = v; else lt = v;
          return true;
        }
        return null;
      },
      offset: () => ({ x: lh.x - ls, y: lh.y + lt }),
    };
  }

  /**
   * Dots to write for a new field whose top-left corner should land at point ({ x, y } in 0.1 mm): the target minus the offsets in force
   * where the language inserts it (before the first ^XZ), the same rule as moveItem, rounded to whole dots and never below 0.
   * commands: the PB.zpl.commands tokenizer (looked up lazily).
   */
  function dropDots(text, point, { dpi } = {}, commands) {
    const offsets = createOffsets();
    for (const cmd of (commands || PB.zpl.commands)(text)) {
      if (cmd.id === '^XZ') break;
      offsets.feed(cmd);
    }
    const offset = offsets.offset();
    const dot = units.dotSize(dpi);
    return { x: Math.max(0, roundDots(point.x / dot - offset.x)), y: Math.max(0, roundDots(point.y / dot - offset.y)) };
  }

  /** Replaces [start, end) ranges of text with values; ranges must not overlap (insertions at the same place keep their order). */
  function applyEdits(text, edits) {
    let out = text;
    const ordered = edits.map((e, order) => ({ ...e, order })).sort((a, b) => b.start - a.start || b.order - a.order);
    for (const e of ordered) out = out.slice(0, e.start) + e.value + out.slice(e.end);
    return out;
  }

  const DEFAULT_ORIGIN = Object.freeze([{ cmd: ['FO', 'FT'], arg: 0, axis: 'x' }, { cmd: ['FO', 'FT'], arg: 1, axis: 'y' }]);

  /** Index of the argument a descriptor field addresses in a command. */
  const argIndex = (field, cmd) => (typeof field.arg === 'function' ? field.arg(cmd) : field.arg);

  /** The write of a field as { value, edits } (null when it refuses). */
  function written(f, value, a, cmd, field) {
    const w = f.write(value, a, cmd, field);
    if (w === null || w === undefined) return null;
    return typeof w === 'string' ? { value: w, edits: [] } : { value: w.value, edits: w.edits || [] };
  }

  /** Where text can be added to a command that has fewer arguments than the one wanted: after its last argument, or after its name. */
  const appendPoint = cmd => (cmd.args.length ? cmd.args[cmd.args.length - 1].end : cmd.start + 1 + cmd.name.length);

  /**
   * The edit that sets argument `index` of a command to `value`: replaces it when it exists (an empty argument too), else appends it after the
   * last argument with empty arguments for the ones in between (^BC -> ^BC,,N for index 2).
   */
  function argEdit(cmd, index, value) {
    const a = cmd.args[index];
    if (a) return { start: a.start, end: a.end, value };
    const at = appendPoint(cmd);
    const gaps = Array(Math.max(0, index - cmd.args.length)).fill('');
    return { start: at, end: at, value: (cmd.args.length ? ',' : '') + [...gaps, value].join(',') };
  }

  /**
   * A `flag` field is the presence of a command with no arguments (^FR): true adds it before the ^FS of the field (or after its last
   * command), false removes every one, with the line break when it sat alone on its line. Pushes the edits into `edits`.
   */
  function flagEdits(text, field, f, want, edits) {
    if (typeof want !== 'boolean') return;
    const present = field.findAll(f.cmd);
    if (want && !present.length) {
      const last = field.cmds[field.cmds.length - 1];
      const at = last.id === '^FS' ? last.start : last.end;
      edits.push({ start: at, end: at, value: `^${f.cmd}` });
    } else if (!want) {
      for (const cmd of present) {
        let [start, end] = [cmd.start, cmd.end];
        const before = text.slice(0, start);
        const lineStart = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1;
        const after = /^[ \t]*(\r\n|\r|\n)/.exec(text.slice(end));
        if (/^[ \t]*$/.test(before.slice(lineStart)) && after) { start = lineStart; end += after[0].length; }
        edits.push({ start, end, value: '' });
      }
    }
  }

  /**
   * Builds the engines. definitions: { coordinates, editable, commands } (commands: the PB.zpl.commands tokenizer, looked up lazily
   * when not given because js/languages/zpl.js loads after this file).
   */
  function createZplEditing({ coordinates = [], editable = [], commands } = {}) {
    const walk = src => (commands || PB.zpl.commands)(src);

    /**
     * The field of an item: the commands inside its source span (the first must start where the span does), and the offsets in force
     * for it (^LH, ^LS, ^LT read before the end of the span, like the parser, which applies them when the field is closed).
     * null when the item has no source or no command starts there.
     */
    function locate(text, item) {
      const span = item && item.source && item.source.spans && item.source.spans[0];
      if (!span || typeof text !== 'string') return null;
      const offsets = createOffsets();
      const cmds = [];
      for (const cmd of walk(text)) {
        if (cmd.start >= span.end) break;
        offsets.feed(cmd);
        if (cmd.start < span.start) continue;
        if (!cmds.length && cmd.start !== span.start) return null;
        cmds.push(cmd);
      }
      // A span that does not end where its last command ends is not the field the item was parsed from
      return cmds.length && cmds[cmds.length - 1].end === span.end ? { field: { cmds, ...fieldMethods(cmds) }, offset: offsets.offset() } : null;
    }

    /** Moves an item by (dx, dy) in 0.1 mm: only the coordinate arguments (by default the origin ^FO / ^FT) change. */
    function moveItem(text, item, dx, dy, { dpi } = {}) {
      const found = locate(text, item);
      const entry = found && coordinates.find(c => c.applies(item, found.field));
      if (!entry || !Number.isFinite(dx) || !Number.isFinite(dy)) return text;
      const dot = units.dotSize(dpi);
      const delta = { x: dx, y: dy };
      const edits = [];
      const missing = new Map(); // command -> { arg index -> dots } for the arguments the command does not have
      for (const { cmd: names, arg, axis } of entry.fields || DEFAULT_ORIGIN) {
        const cmd = found.field.find(names);
        if (!cmd) continue;
        const a = cmd.args[arg];
        const current = a ? (a.raw === '' ? 0 : DECIMAL.test(a.raw) ? Number(a.raw) : null) : arg >= cmd.args.length ? 0 : null;
        if (current === null) continue;
        const offset = found.offset[axis];
        const target = (current + offset) * dot + delta[axis]; // 0.1 mm, where the item should land
        const dots = Math.max(0, roundDots(target / dot - offset));
        if (a) {
          if (String(dots) !== a.raw && !(a.raw === '' && dots === 0)) edits.push({ start: a.start, end: a.end, value: String(dots) });
        } else if (dots !== 0) {
          missing.set(cmd, { ...missing.get(cmd), [arg]: dots });
        }
      }
      // Omitted trailing arguments: written as one ",x,y" run after the last argument (gaps are 0, the default of ^FO / ^FT)
      for (const [cmd, byArg] of missing) {
        const last = Math.max(...Object.keys(byArg).map(Number));
        const values = [];
        for (let i = cmd.args.length; i <= last; i++) values.push(byArg[i] === undefined ? 0 : byArg[i]);
        const at = appendPoint(cmd);
        edits.push({ start: at, end: at, value: (cmd.args.length ? ',' : '') + values.join(',') });
      }
      return edits.length ? applyEdits(text, edits) : text;
    }

    const shapeOf = (item, field) => (item && field ? editable.find(s => s.applies(item, field)) : undefined);

    /**
     * Fields the panel can edit: { kind, fields: [{ key, label, type, value, min?, max?, step?, maxLength?, options? }] }. Values are
     * read from the field in the text when it is given and found, else from the descriptor field's model(item); unknown ones are left out.
     */
    function describeItem(item, text, { dpi } = {}) {
      const kind = (item && item.kind) || null;
      const found = typeof text === 'string' ? locate(text, item) : null;
      const shape = item && editable.find(s => s.applies(item, found ? found.field : undefined));
      if (!shape) return { kind, fields: [] };
      const fields = [];
      for (const f of shape.fields) {
        let value;
        if (f.custom) value = found ? f.read(text, found, item) : f.model ? f.model(item, { dpi }) : undefined;
        else if (f.flag) value = found ? found.field.has(f.cmd) : f.model ? f.model(item, { dpi }) : undefined;
        else if (found) {
          const cmd = found.field.find(f.cmd);
          const a = cmd && cmd.args[argIndex(f, cmd)];
          if (a) value = a.raw === '' && f.optional !== undefined ? f.optional : f.read(a, cmd, found.field);
          else value = cmd && f.optional !== undefined && argIndex(f, cmd) === cmd.args.length ? f.optional : undefined;
        } else value = f.model ? f.model(item, { dpi }) : undefined;
        if (value === undefined || value === null) continue;
        const { key, label, type, min, max, step, maxLength, note } = f;
        const options = f.optionsFor ? f.optionsFor(value, item, found ? found.field : undefined) : f.options;
        fields.push({ key, label, type, value, ...(min !== undefined && { min, max, step }), ...(maxLength !== undefined && { maxLength }), ...(options && { options }), ...(note && { note }) });
      }
      return { kind, fields };
    }

    /** Rewrites only the fields in changes ({ key: value }, see describeItem); unknown keys and invalid values are ignored. */
    function updateItem(text, item, changes, opts) {
      const found = changes && locate(text, item);
      const shape = found && shapeOf(item, found.field);
      if (!shape) return text;
      // Fields flagged `reemit` (the bar code type) are written by the shape's hook: (field, item, changes, opts) -> edits of that
      // field's commands, or null to refuse. They win over the edits of other fields on the same arguments.
      const claimed = shape.reemit && shape.fields.some(f => f.reemit && Object.hasOwn(changes, f.key)) ? shape.reemit(found.field, item, changes, opts || {}) : null;
      const edits = claimed ? [...claimed] : [];
      // Several fields may share one argument (^A: font letter + orientation): each writes over the result of the previous one
      const sameArg = new Map();
      for (const f of shape.fields) {
        if (f.reemit || !Object.hasOwn(changes, f.key)) continue;
        if (f.custom) {
          // Written over the whole text; skipped when the type hook already claimed the command (one change at a time in the panel)
          const written = claimed ? null : f.edits(text, found, item, changes[f.key], { ...opts, changes });
          if (written) edits.push(...written);
          continue;
        }
        if (f.flag) { flagEdits(text, found.field, f, changes[f.key], edits); continue; }
        const cmd = found.field.find(f.cmd);
        if (!cmd) continue;
        const index = argIndex(f, cmd);
        const original = cmd.args[index];
        const earlier = original && sameArg.get(original.start);
        const a = earlier ? { ...original, raw: earlier.value } : original;
        if (a && claimed && claimed.some(e => e.start === a.start)) continue;
        const omitted = !a && f.optional !== undefined && index === cmd.args.length;
        if (omitted || (a && a.raw === '' && f.optional !== undefined)) {
          // Omitted or empty optional argument: a value other than its default is written in its place
          const w = written(f, changes[f.key], a, cmd, found.field);
          const standard = f.write(f.optional, a, cmd, found.field);
          if (!w || w.value === standard) continue;
          if (a) edits.push({ start: a.start, end: a.end, value: w.value }, ...w.edits);
          else edits.push({ start: appendPoint(cmd), end: appendPoint(cmd), value: (cmd.args.length ? ',' : '') + w.value }, ...w.edits);
          continue;
        }
        if (!a || f.read(a, cmd, found.field) === undefined) continue;
        const w = written(f, changes[f.key], a, cmd, found.field);
        if (!w || w.value === a.raw) continue;
        if (earlier) earlier.value = w.value;
        else {
          const edit = { start: a.start, end: a.end, value: w.value };
          sameArg.set(a.start, edit);
          edits.push(edit);
        }
        edits.push(...w.edits);
      }
      return edits.length ? applyEdits(text, edits) : text;
    }

    return { moveItem, describeItem, updateItem };
  }

  PB.zplEdit = Object.freeze({
    createZplEditing, createOffsets, fieldMethods, dropDots, encodeData, decodeData, argEdit, MAX_DATA, SERIAL_MAX, serializable,
    numberField, selectField, stringSelectField, checkboxField, textField, contentField, paramField, reverseField, setArgs, flagEdits, serialFields,
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
