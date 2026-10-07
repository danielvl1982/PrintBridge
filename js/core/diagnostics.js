/**
 * Diagnostic messages shown in the "Avisos" panel.
 * Every module creates them with these functions so the format is always the same.
 */
(function (PB) {
  'use strict';

  const LEVELS = Object.freeze({ error: 0, warning: 1, info: 2 });

  const make = level => text => ({ level, text });

  PB.diagnostics = Object.freeze({
    error: make('error'),
    warning: make('warning'),
    info: make('info'),
    /** Sorts: errors first, then warnings, then information. */
    sort: list => [...list].sort((a, b) => LEVELS[a.level] - LEVELS[b.level]),
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
