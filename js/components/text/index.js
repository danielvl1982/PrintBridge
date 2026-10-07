/**
 * Text slice: registers the `text` component (TPCL PC bitmap-font and PV outline-font text). Loads after the other
 * files of the slice (render.js, tpcl.js).
 */
(function (PB) {
  'use strict';

  const { render, layout, tpcl, tspl } = PB.slices.text;

  PB.components.register({
    kind: 'text',
    // First palette entry (see `order` in js/components/registry.js)
    order: 10,
    label: 'Texto',
    glyph: 'Aa',
    render,
    layout,
    languages: { tpcl, tspl },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
