/**
 * Component registry (vertical slices).
 *
 * Each label component (text, barcode, qr, line, box, image) owns one folder and registers one definition:
 *   { kind, ...optional hooks }
 * `kind` is the only required property. Hooks are optional and added by each slice as it is migrated
 * (for example render, parse, build, move, update, describe, validate, glyph, label, per-language encoders).
 * Consumers (languages, drawing, validator) look hooks up by kind and skip components that do not provide them.
 * This file depends on nothing and must load before any language or drawing file.
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
    const stored = Object.freeze({ ...def });
    definitions.set(def.kind, stored);
    return stored;
  }

  function get(kind) {
    return definitions.get(kind);
  }

  function kinds() {
    return [...definitions.keys()];
  }

  function all() {
    return [...definitions.values()];
  }

  PB.components = Object.freeze({ register, get, kinds, all });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
