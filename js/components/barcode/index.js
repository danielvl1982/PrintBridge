/**
 * Barcode slice: registers the `barcode` component (1D barcodes: Code128, Code 39, ITF and the other TPCL XB barcode
 * types). Loads after the other files of the slice (code128.js, code39.js, itf.js, render.js, tpcl.js, tspl.js, zpl.js).
 */
(function (PB) {
  'use strict';

  const { render, validate, tpcl, tspl, zpl } = PB.slices.barcode;

  PB.components.register({
    kind: 'barcode',
    // Second palette entry (see `order` in js/components/registry.js)
    order: 20,
    label: 'Código de barras',
    glyph: '|||',
    render,
    validate,
    languages: { tpcl, tspl, zpl },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
