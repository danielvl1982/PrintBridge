/**
 * Area slice: registers the `area` component, the inverted / cleared area (TPCL XR, TSPL REVERSE and ERASE, ZPL ^GB with ^FR or white). One neutral model
 * kind `area` with mode 'reverse' or 'clear'; the palette has ONE entry (Área invertida, reverse) for both languages, clearing
 * areas are read, edited and written but not offered. Loads after the other files of this slice.
 */
(function (PB) {
  'use strict';

  const { render, layout, tpcl, tspl, zpl } = PB.slices.area;

  PB.components.register({
    kind: 'area',
    order: 58,
    modelKind: 'area',
    label: 'Área invertida',
    glyph: '◩',
    // No data command
    carriesData: false,
    render,
    layout,
    languages: { tpcl, tspl, zpl },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
