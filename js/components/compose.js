/**
 * Generic slice composition (shared by every language file).
 *
 * PB.composeSlices(langId, helpers, base = {}) selects the registered slices that declare `languages[langId]` (a factory,
 * see js/components/registry.js), calls each factory once with the language's `helpers` object, in registry order
 * (PB.components.all(), already sorted by `order`), and returns:
 *   { slices, handlers, coordinates, movable, editable, rules, components }
 * - slices: [{ id, order, modelKind, label, hooks }] with hooks = what the factory returned
 * - handlers, coordinates, editable, rules: [...base.<list>, ...the slices' hooks of that list]
 * - movable: [...base.movable, modelKind of every slice that has coordinates]
 * - components: frozen palette list [{ kind, label }] of the slices with a `build` hook (the image has none)
 * The language's own (legacy) entries go in `base`, so they come first, then the slices. It is exposed on PB, not on
 * PB.components, because the registry object is frozen. Language agnostic; it depends only on the registry.
 */
(function (PB) {
  'use strict';

  function composeSlices(langId, helpers, base = {}) {
    const slices = PB.components.all()
      .filter(def => def.languages && def.languages[langId])
      .map(def => ({ id: def.kind, order: def.order, modelKind: def.modelKind || def.kind, label: def.label, hooks: def.languages[langId](helpers) }));
    return {
      slices,
      handlers: [...(base.handlers || []), ...slices.flatMap(s => s.hooks.handlers || [])],
      coordinates: [...(base.coordinates || []), ...slices.flatMap(s => s.hooks.coordinates || [])],
      movable: [...(base.movable || []), ...slices.filter(s => s.hooks.coordinates).map(s => s.modelKind)],
      editable: [...(base.editable || []), ...slices.flatMap(s => s.hooks.editable || [])],
      rules: [...(base.rules || []), ...slices.flatMap(s => s.hooks.rules || [])],
      components: Object.freeze(slices.filter(s => s.hooks.build).map(({ id, label }) => ({ kind: id, label }))),
    };
  }

  PB.composeSlices = composeSlices;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
