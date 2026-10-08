/**
 * Data Matrix slice: registers the `datamatrix` component (TPCL XB type Q, TSPL DMATRIX). Loads after the other files of the slice
 * (sizes.js, reed-solomon.js, placement.js, matrix.js, render.js, validate.js, tpcl.js, tspl.js).
 */
(function (PB) {
  'use strict';

  const { render, validate, tpcl, tspl } = PB.slices.datamatrix;

  PB.components.register({
    kind: 'datamatrix',
    // Right after QR in the palette (see `order` in js/components/registry.js)
    order: 35,
    label: 'Data Matrix',
    glyph: '▩',
    render,
    validate,
    languages: { tpcl, tspl },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
