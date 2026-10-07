/**
 * QR slice: registers the `qr` component (TPCL XB type T). Loads after the other files of the slice (matrix.js,
 * render.js, tpcl.js).
 */
(function (PB) {
  'use strict';

  const { render, tpcl } = PB.slices.qr;

  PB.components.register({
    kind: 'qr',
    // Third palette entry (see `order` in js/components/registry.js)
    order: 30,
    label: 'QR',
    glyph: '▦',
    render,
    languages: { tpcl },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
