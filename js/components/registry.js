/**
 * Component registry (vertical slices).
 *
 * Each label component (text, barcode, qr, line, box, image) owns one folder, js/components/<id>/, and registers one
 * definition. `kind` (the component id, the registry key) is the only required property; the others are optional and
 * are added by each slice as it is migrated:
 *   {
 *     kind,                      component id: 'line', 'box', ...
 *     order,                     number that fixes the palette position and the order in which the slices' hooks are
 *                                composed (all(), kinds(), the languages' handler/coordinate/editable tables). Lower
 *                                first, ties and definitions without one keep registration order (after the rest), so
 *                                the result never depends on which file loads first. Slices set it explicitly: text 10,
 *                                barcode 20, qr 30, line 40, box 50, image 60
 *                                (the image has no `build` hook, so languages do not list it as a template)
 *     modelKind,                kind of the neutral model items it draws (default: kind). Box is its own slice but
 *                                its items are { kind: 'line', rect: true }
 *     matches(item),             picks the slice among those sharing a modelKind (line: !rect, box: rect)
 *     label, glyph,              palette entry (name and short text glyph)
 *     carriesData,               false when the component has no data command (skipped by the "no content" rule)
 *     render(item, ctx),         SVG: returns { markup, info?, warnings?, anchor? } (ctx: see drawing.js)
 *     languages: {
 *       tpcl: helpers => ({ handlers?, build?, coordinates?, editable?, rules? })
 *     }
 *   }
 * Parse handlers are tried in slice `order` and the first whose pattern matches wins, so patterns of different slices
 * must not overlap: a generic pattern excludes what a more specific slice owns (the barcode XB handler skips well-formed
 * QR commands with a negative lookahead) instead of relying on registration or `order`.
 * A language hook is a factory because the helpers shared by every component (insertCommand, pad4, clampCoord,
 * numberField, sourceOf...) are owned by the language file, which loads after the slices: the language calls the
 * factory once with its helpers object and composes the result with the kinds that are not migrated yet.
 * Slice file layout, loaded in this order (see js/manifest.json): <id>/render.js and <id>/<language>.js publish their
 * pieces on PB.slices.<id>; <id>/index.js is the only file that calls register().
 * Consumers (languages, drawing, validator, palette) look slices up with get(kind) or forItem(item) and fall back to
 * their own tables for kinds with no slice. This file depends on nothing and must load before any slice.
 */
(function (PB) {
  'use strict';

  const definitions = new Map();

  function register(def) {
    if (!def || typeof def.kind !== 'string' || !def.kind) {
      throw new Error('Component definition needs a string "kind"');
    }
    if (definitions.has(def.kind)) {
      throw new Error('Component already registered: ' + def.kind);
    }
    if (def.order !== undefined && !Number.isFinite(def.order)) {
      throw new Error('Component "order" must be a finite number: ' + def.kind);
    }
    const stored = Object.freeze({ ...def });
    definitions.set(def.kind, stored);
    return stored;
  }

  function get(kind) {
    return definitions.get(kind);
  }

  function kinds() {
    return all().map(def => def.kind);
  }

  /** Definitions sorted by `order` (ties and definitions without one: registration order, the latter after the rest). */
  function all() {
    return [...definitions.values()]
      .map((def, index) => ({ def, index }))
      .sort((a, b) => (a.def.order ?? Infinity) - (b.def.order ?? Infinity) || a.index - b.index)
      .map(({ def }) => def);
  }

  /**
   * Slice that owns a model item: the first definition whose model kind (default: its own kind) is the item's kind and
   * whose `matches` (when it has one) accepts the item. Undefined if no registered slice owns it.
   */
  function forItem(item) {
    if (!item) return undefined;
    return all().find(def => (def.modelKind || def.kind) === item.kind && (!def.matches || def.matches(item)));
  }

  PB.components = Object.freeze({ register, get, kinds, all, forItem });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
