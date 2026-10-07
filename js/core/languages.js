/**
 * Printer language registry. Each language provides:
 *   { id, name, detect(text) -> boolean, parse(text, { dpi }) -> model, validate?(model) -> diagnostics,
 *     sizeCommands?(resolvedSize) -> string[],
 *     applySize?(text, resolvedSize) -> text, insertCommand?(text, command) -> text,
 *     moveItem?(text, item, dx, dy, { dpi }) -> text,
 *     updateItem?(text, item, changes, { dpi }) -> text, describeItem?(item, text?) -> { kind, fields },
 *     componentTemplates?() -> [{ kind, label }], buildComponent?(text, kind, { x, y }, { dpi, viewRotation }) -> text,
 *     emit?(model, { dpi }) -> { text, diagnostics }, fileEncoding?: 'utf-8' | 'latin1', fileExtension?: string }
 * The model returned by parse is the neutral one described above.
 * insertCommand (optional): the text with a command added in the place the language wants (TPCL: before {XS).
 * moveItem (optional): the text with only the position of that item's command moved by dx/dy (0.1 mm); unchanged
 *   if the item has no source.
 * updateItem (optional): the text with only the fields in changes ({ key: value }) rewritten in that item's command, with
 *   each field's width kept and numbers clamped to their range; unknown keys, invalid values, items without source or
 *   without editable fields are ignored (unchanged text if nothing changes).
 * describeItem (optional): the fields updateItem accepts for an item, language-agnostic, so the UI can build a panel:
 *   { kind, fields: [{ key, label, type: 'number' | 'select' | 'checkbox', value, min, max, step?, options?: [{ value, label }] }] }
 *   with the current values (read from the command in text if given, else from the item) and an empty list if none.
 * componentTemplates (optional): the neutral component kinds the palette offers, in order (text, barcode, qr, line, box).
 * buildComponent (optional): the text with a new component of that kind whose top-left corner is at x/y (0.1 mm,
 *   clamped); unchanged for an unknown kind or an invalid point. viewRotation (0/90/180/270 degrees clockwise, default 0)
 *   is the current view rotation: the item is written rotated (360 - viewRotation) % 360 so it looks upright in that view.
 * emit (optional): the printer-language text for a neutral model, plus the diagnostics (fidelity warnings) found while
 *   writing it. The language owns header, trailer, id numbering and ordering; items come from the slices' `emit` hooks
 *   (see PB.composeSlices). PB.languages.emit(id, model, opts) calls it and normalizes the result.
 * fileEncoding (optional, default 'utf-8'): how PB.convert.toBytes writes the emitted text to a file. 'latin1' is byte
 *   preserving (one byte per char code, '?' above 255) for languages whose text carries raw binary (TSPL BITMAP data).
 * fileExtension (optional, default 'txt'): the extension, without dot, PB.convert.fileName suggests for the emitted text.
 * Optional size fields (used by PB.sizes; without them the language does not write the size):
 *   - sizeCommands: source text lines the language needs to declare that size.
 *   - applySize: source text with the size written, replacing or adding its commands (idempotent).
 */
(function (PB) {
  'use strict';

  const list = [];

  /** Values of the optional fileEncoding property. */
  const FILE_ENCODINGS = Object.freeze(['utf-8', 'latin1']);

  /** First shape defect of a language, or null if it is valid. */
  function shapeProblem(language) {
    if (!language) return 'not provided';
    if (typeof language.id !== 'string' || !language.id) return 'id must be a non-empty string';
    if (typeof language.name !== 'string' || !language.name) return `name must be a non-empty string (id "${language.id}")`;
    const missing = ['detect', 'parse'].filter(k => typeof language[k] !== 'function').map(k => `${k} must be a function (id "${language.id}")`)[0];
    if (missing) return missing;
    if (language.emit !== undefined && typeof language.emit !== 'function') return `emit must be a function when present (id "${language.id}")`;
    if (language.fileEncoding !== undefined && !FILE_ENCODINGS.includes(language.fileEncoding)) return `fileEncoding must be one of ${FILE_ENCODINGS.join(', ')} when present (id "${language.id}")`;
    if (language.fileExtension !== undefined && !(typeof language.fileExtension === 'string' && /^[A-Za-z0-9]+$/.test(language.fileExtension))) return `fileExtension must be letters and digits without a dot when present (id "${language.id}")`;
    return null;
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
    /** Runs the language's emit hook: { text: string, diagnostics: array }. Throws Error if unknown or without emit. */
    emit(id, model, opts) {
      const language = list.find(l => l.id === id);
      if (!language) throw new Error(`Unknown language: "${id}"`);
      if (typeof language.emit !== 'function') throw new Error(`Language "${id}" cannot emit`);
      const result = language.emit(model, opts) || {};
      return { text: result.text == null ? '' : String(result.text), diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics : [] };
    },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
