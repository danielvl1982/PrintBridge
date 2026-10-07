/**
 * Shared, language-agnostic helpers for the emitters (neutral model -> printer-language text).
 *
 * PB.emit exposes pure functions plus the driver:
 *   dots(mm10, dpi) / mm10(dots, dpi)   0.1 mm <-> integer dots
 *   escapeQuotes(str)                   TSPL string escape ("  ->  \["])
 *   createIds()                         allocator: next(namespace) -> unique zero-padded 2-digit id per namespace
 *   createContext({ dpi, language })    { dpi, language, dot, report, diagnostics, ids, once(key, fn) }
 *   run(model, composed, ctx)           calls each item's slice emitter (composed.emitters, see PB.composeSlices) in order
 *                                       and returns { lines, diagnostics }
 * Depends on PB.units, PB.diagnostics and (at call time) PB.components.
 */
(function (PB) {
  'use strict';

  const dots = (mm10, dpi) => Math.round(mm10 / PB.units.dotSize(dpi));
  const mm10 = (count, dpi) => Math.round(count * PB.units.dotSize(dpi));
  const escapeQuotes = str => String(str).replace(/"/g, '\\["]');

  function createIds() {
    const counters = new Map();
    return {
      next(namespace) {
        const n = counters.get(namespace) || 0;
        counters.set(namespace, n + 1);
        return String(n).padStart(2, '0');
      },
    };
  }

  function createContext({ dpi, language } = {}) {
    const diagnostics = [];
    const seen = new Set();
    return {
      dpi,
      language,
      dot: value => dots(value, dpi),
      report: d => { if (d) diagnostics.push(d); },
      diagnostics,
      ids: createIds(),
      /** Reports fn()'s diagnostic only the first time `key` is seen. */
      once(key, fn) {
        if (seen.has(key)) return;
        seen.add(key);
        const d = fn();
        if (d) diagnostics.push(d);
      },
    };
  }

  function run(model, composed, ctx) {
    const lines = [];
    for (const item of (model && model.items) || []) {
      const slice = PB.components.forItem(item);
      const emit = slice && composed.emitters && composed.emitters[slice.kind];
      if (!emit) {
        ctx.report(PB.diagnostics.warning(`No se puede exportar el elemento ${item.kind}: sin emisor para ${ctx.language}`));
        continue;
      }
      const out = emit(item, ctx);
      for (const line of Array.isArray(out) ? out : [out]) {
        if (typeof line === 'string' && line) lines.push(line);
      }
    }
    return { lines, diagnostics: ctx.diagnostics };
  }

  PB.emit = Object.freeze({ dots, mm10, escapeQuotes, createIds, createContext, run });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
