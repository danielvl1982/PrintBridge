/**
 * QR slice: registers the `qr` component (TPCL XB type T, TSPL QRCODE, ZPL ^BQ). Loads after the other files of the slice (matrix.js,
 * render.js, tpcl.js, tspl.js, zpl.js).
 */
(function (PB) {
  'use strict';

  const { render, tpcl, tspl, zpl } = PB.slices.qr;

  PB.components.register({
    kind: 'qr',
    // Third palette entry (see `order` in js/components/registry.js)
    order: 30,
    label: 'QR',
    glyph: '▦',
    render,
    languages: { tpcl, tspl, zpl },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
