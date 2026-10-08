/**
 * Ellipse slice, TPCL language: TPCL has no ellipse or circle command, so there is nothing to parse, build or move. The only
 * hook is an emitter that skips the item and reports it with one warning per export (TSPL -> TPCL conversion). Having no `build`
 * hook, the slice adds no entry to the TPCL palette.
 * Shared by the `ellipse` and `circle` slices; registered by js/components/ellipse/index.js as `languages: { tpcl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.ellipse = PB.slices.ellipse || {};

  const { diagnostics: diag } = PB;

  PB.slices.ellipse.tpcl = () => ({
    emit(item, ctx) {
      ctx.once('tpcl-ellipse', () => diag.warning('Las elipses y círculos no se escriben en TPCL: no tiene un comando equivalente, se omiten'));
      return [];
    },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
