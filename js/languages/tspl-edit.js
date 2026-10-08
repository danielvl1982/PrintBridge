/**
 * TSPL editing engines: move, describe and update an item by rewriting only the numeric arguments of its command.
 * Language hooks with the same signatures as TPCL's (see js/core/languages.js); what is TSPL specific lives in the
 * definitions the slices provide in js/components/<kind>/tspl.js (`coordinates` and `editable`), so this file knows no
 * command by name. It is loaded before js/languages/tspl.js, which builds the engines with the composed definitions.
 *
 * Definitions (arguments are addressed by their index in cmd.args of PB.tspl.commands):
 *   coordinates: [{ applies(item, cmd) -> bool, fields: [{ arg, axis: 'x' | 'y' }] }]
 *     the first entry that applies is used; each field is a coordinate argument in dots, moved with the item.
 *   editable: [{ applies(item, cmd) -> bool, fields: [field] }] (describeItem without text calls applies(item, undefined):
 *     decide by item.kind then), field =
 *     { key, label, type: 'number' | 'select' | 'text', arg, min?, max?, step?, options?: [{ value, label }],
 *       read(arg, cmd) -> value | undefined, write(value) -> new raw text | null, model?(item, { dpi }) -> value }
 *     arg is an argument index, or a function (cmd) -> index when the position depends on the optional arguments.
 *     optional?: the value of a trailing argument when it is omitted (e.g. the BOX radius, 0): describeItem lists that value,
 *     updateItem appends the argument (",value" after the last one) for any other value and writes nothing for the default.
 *     numberField(), selectField(), stringSelectField() and textField() build the usual ones; a field may give
 *     optionsFor(value, item, cmd) -> options to list the current value when it is not one of them.
 *   a shape may give reemit(cmd, item, changes, { dpi }) -> [{ start, end, value }] | null for the fields flagged `reemit`: they do not
 *     edit one argument but ask the shape to write the command again for the new value (the barcode type moves other arguments).
 *
 * Only the text of the targeted arguments is replaced (by source offsets), so quoted strings (commas inside), counters
 * (@1), BLOCK content, BITMAP bytes and every other line stay byte for byte. An argument that is not a plain number is
 * never edited. The coordinates of an item (0.1 mm) include REFERENCE and SHIFT while the command keeps plain dots, so a
 * move writes target - REFERENCE - SHIFT, rounded to whole dots and never below 0. DIRECTION 0 is edited as DIRECTION 1.
 * dropDots() applies the same rule to the position of a new palette component (see the slices' `build` hooks).
 */
(function (PB) {
  'use strict';

  const { units } = PB;

  const INTEGER = /^[+-]?\d+$/;
  const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

  const clampInt = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));

  /** Rounds to whole dots; the epsilon keeps x.5 values that float noise nudged just below from rounding down. */
  const roundDots = v => Math.round(v + 1e-6);

  /** Whole-number field: reads an integer argument, writes the value rounded and clamped to min..max. */
  const numberField = (key, label, arg, min, max, model) => ({
    key, label, type: 'number', arg, min, max, step: 1, model,
    read: a => (INTEGER.test(a.raw) ? Number(a.raw) : undefined),
    write: v => (typeof v === 'number' && Number.isFinite(v) ? String(clampInt(v, min, max)) : null),
  });

  /** Choice among numbers (e.g. rotations): options are numbers (labelled "<n>°") or { value, label }. */
  function selectField(key, label, arg, options, model) {
    const list = options.map(o => (typeof o === 'object' ? o : { value: o, label: `${o}°` }));
    return {
      key, label, type: 'select', arg, options: list, model,
      read: a => { const v = INTEGER.test(a.raw) ? Number(a.raw) : undefined; return list.some(o => o.value === v) ? v : undefined; },
      write: v => (list.some(o => o.value === v) ? String(v) : null),
    };
  }

  /**
   * Choice among quoted strings (e.g. a font id "3"): options are strings or { value, label }. Only an argument that is
   * exactly one quoted string is read; the quotes are kept when writing. A current value outside the list is shown as an
   * extra last option (optionsFor) but is never written: write() accepts the listed values only. model(item) gives the
   * value when there is no text.
   */
  function stringSelectField(key, label, arg, options, model) {
    const list = options.map(o => (typeof o === 'object' ? o : { value: o, label: o }));
    return {
      key, label, type: 'select', arg, options: list, model,
      optionsFor: value => (list.some(o => o.value === value) ? list : [...list, { value, label: value }]),
      read: a => (isQuotedString(a.raw) ? a.value : undefined),
      write: v => (list.some(o => o.value === v) ? `"${v}"` : null),
    };
  }

  /** Counter/variable content: "@1", "x"+@1+"y". */
  const COUNTER = /(?:^|\+)\s*@\d+/;
  const QUOTE_ESCAPES = /\\\["\]|\\"/g;

  /** True when raw is exactly one quoted string (no concatenation, no stray quote). */
  const isQuotedString = raw => raw.length >= 2 && raw[0] === '"' && raw.endsWith('"') && !raw.endsWith('\\"')
    && !raw.slice(1, -1).replace(QUOTE_ESCAPES, '').includes('"');

  /**
   * Quoted string argument (the content of a command). Only a single quoted string that is not a counter is read;
   * usable(cmd) can rule a command out (e.g. a barcode type whose data the parser rewrites). write() keeps the quoting
   * of the emitters (PB.emit.escapeQuotes), turns line breaks into spaces and ignores a non-string and a trailing
   * backslash (it would escape the closing quote). model(item) gives the value when there is no text (undefined leaves
   * the field out).
   */
  function textField(key, label, arg, model, usable) {
    return {
      key, label, type: 'text', arg, model,
      read: (a, cmd) => (isQuotedString(a.raw) && !COUNTER.test(a.raw) && (!usable || usable(cmd)) ? a.value : undefined),
      write: v => (typeof v === 'string' && !v.endsWith('\\') ? `"${PB.emit.escapeQuotes(v.replace(/\r\n|\r|\n/g, ' '))}"` : null),
    };
  }

  /** Argument of a command that a field addresses. */
  const argOf = (field, cmd) => cmd.args[typeof field.arg === 'function' ? field.arg(cmd) : field.arg];

  /**
   * A field with an `optional` default (its value when the argument is omitted) whose argument is the one right after the
   * last argument of the command: describeItem lists the default and updateItem can append the argument.
   */
  const isOmittedOptional = (field, cmd) => field.optional !== undefined && typeof field.arg === 'number' && cmd.args.length === field.arg;

  /** Replaces [start, end) ranges of text with values; ranges must not overlap. */
  function applyEdits(text, edits) {
    let out = text;
    for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.value + out.slice(e.end);
    return out;
  }

  /** Follows the REFERENCE and SHIFT commands fed to it: offset() is what they add to the later coordinates, in dots. */
  function offsetTracker() {
    const ref = { x: 0, y: 0 };
    const shift = { x: 0, y: 0 };
    return {
      feed(cmd) {
        const values = cmd.args.map(a => (DECIMAL.test(a.raw) ? Number(a.raw) : null));
        if (cmd.name === 'REFERENCE' && values.length >= 2 && values[0] !== null && values[1] !== null) { ref.x = values[0]; ref.y = values[1]; }
        else if (cmd.name === 'SHIFT' && values.length && !values.slice(0, 2).includes(null)) {
          if (values.length === 1) { shift.x = 0; shift.y = values[0]; } else { shift.x = values[0]; shift.y = values[1]; }
        }
      },
      offset: () => ({ x: ref.x + shift.x, y: ref.y + shift.y }),
    };
  }

  /**
   * Dots to write for a new command whose top-left corner should land at point ({ x, y } in 0.1 mm): the target minus the
   * REFERENCE and SHIFT in force where the language inserts it (before the first PRINT, else at the end), the same rule as
   * moveItem, rounded to whole dots and never below 0. commands: the PB.tspl.commands tokenizer (looked up lazily).
   */
  function dropDots(text, point, { dpi } = {}, commands) {
    const tracker = offsetTracker();
    for (const cmd of (commands || PB.tspl.commands)(text)) {
      if (cmd.name === 'PRINT') break;
      tracker.feed(cmd);
    }
    const offset = tracker.offset();
    const dot = units.dotSize(dpi);
    return { x: Math.max(0, roundDots(point.x / dot - offset.x)), y: Math.max(0, roundDots(point.y / dot - offset.y)) };
  }

  /**
   * Builds the engines. definitions: { coordinates, editable, commands } (commands: the PB.tspl.commands tokenizer,
   * looked up lazily when not given because js/languages/tspl.js loads after this file).
   */
  function createTsplEditing({ coordinates = [], editable = [], commands } = {}) {
    const walk = src => (commands || PB.tspl.commands)(src);

    /**
     * Command of an item (the one starting at its source span) and the REFERENCE / SHIFT offsets in dots in force there.
     * null when the item has no source or no command starts there.
     */
    function locate(text, item) {
      const span = item && item.source && item.source.spans && item.source.spans[0];
      if (!span || typeof text !== 'string') return null;
      const tracker = offsetTracker();
      for (const cmd of walk(text)) {
        if (cmd.start === span.start) return { cmd, offset: tracker.offset() };
        if (cmd.start > span.start) return null;
        tracker.feed(cmd);
      }
      return null;
    }

    /** Moves an item by (dx, dy) in 0.1 mm: only the coordinate arguments of its command change. */
    function moveItem(text, item, dx, dy, { dpi } = {}) {
      const found = locate(text, item);
      const entry = found && coordinates.find(c => c.applies(item, found.cmd));
      if (!entry || !Number.isFinite(dx) || !Number.isFinite(dy)) return text;
      const dot = units.dotSize(dpi);
      const delta = { x: dx, y: dy };
      const edits = [];
      for (const { arg, axis } of entry.fields) {
        const a = found.cmd.args[arg];
        if (!a || !DECIMAL.test(a.raw)) continue;
        const offset = found.offset[axis];
        const target = (Number(a.raw) + offset) * dot + delta[axis]; // 0.1 mm, where the item should land
        const dots = Math.max(0, roundDots(target / dot - offset));
        if (String(dots) !== a.raw) edits.push({ start: a.start, end: a.end, value: String(dots) });
      }
      return edits.length ? applyEdits(text, edits) : text;
    }

    const shapeOf = (item, cmd) => (item && cmd ? editable.find(s => s.applies(item, cmd)) : undefined);

    /**
     * Fields the panel can edit: { kind, fields: [{ key, label, type, value, min?, max?, step?, options? }] }. Values are
     * read from the command when the text is given and found, else from the field's model(item); unknown ones are left out.
     */
    function describeItem(item, text, { dpi } = {}) {
      const kind = (item && item.kind) || null;
      const found = typeof text === 'string' ? locate(text, item) : null;
      const shape = item && editable.find(s => (found ? s.applies(item, found.cmd) : s.applies(item, undefined)));
      if (!shape) return { kind, fields: [] };
      const fields = [];
      for (const f of shape.fields) {
        let value;
        const a = found && argOf(f, found.cmd);
        if (found) value = a ? f.read(a, found.cmd) : (isOmittedOptional(f, found.cmd) ? f.optional : undefined);
        else value = f.model ? f.model(item, { dpi }) : undefined;
        if (value === undefined || value === null) continue;
        const { key, label, type, min, max, step } = f;
        const options = f.optionsFor ? f.optionsFor(value, item, found ? found.cmd : undefined) : f.options;
        fields.push({ key, label, type, value, ...(min !== undefined && { min, max, step }), ...(options && { options }) });
      }
      return { kind, fields };
    }

    /** Rewrites only the fields in changes ({ key: value }, see describeItem); unknown keys and invalid values are ignored. */
    function updateItem(text, item, changes, opts) {
      const found = changes && locate(text, item);
      const shape = found && shapeOf(item, found.cmd);
      if (!shape) return text;
      // Fields flagged `reemit` (the barcode type and check digit) are written by the shape's hook: (cmd, item, changes, opts) ->
      // edits [{ start, end, value }] of that command, or null to refuse. They win over the edits of other fields on the same arguments.
      const claimed = shape.reemit && shape.fields.some(f => f.reemit && Object.hasOwn(changes, f.key)) ? shape.reemit(found.cmd, item, changes, opts || {}) : null;
      const edits = claimed ? [...claimed] : [];
      for (const f of shape.fields) {
        const a = argOf(f, found.cmd);
        if (f.reemit || !Object.hasOwn(changes, f.key)) continue;
        if (a && claimed && claimed.some(e => e.start === a.start)) continue;
        if (!a && isOmittedOptional(f, found.cmd)) {
          // Omitted trailing argument: a value other than its default is appended right after the last argument
          const value = f.write(changes[f.key]);
          const last = found.cmd.args[found.cmd.args.length - 1];
          if (value !== null && value !== String(f.optional) && last) edits.push({ start: last.end, end: last.end, value: `,${value}` });
          continue;
        }
        if (!a || f.read(a, found.cmd) === undefined) continue;
        const value = f.write(changes[f.key]);
        if (value !== null && value !== a.raw) edits.push({ start: a.start, end: a.end, value });
      }
      return edits.length ? applyEdits(text, edits) : text;
    }

    return { moveItem, describeItem, updateItem };
  }

  PB.tsplEdit = Object.freeze({ createTsplEditing, dropDots, numberField, selectField, stringSelectField, textField });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
