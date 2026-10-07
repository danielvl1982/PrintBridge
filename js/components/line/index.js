/**
 * Line slice: registers the `line` component. Loads after the other files of the slice (render.js, tpcl.js).
 * The slice owns its model kind `line` for the items that are not rectangles (rect false); rectangles belong to the
 * box slice, which shares the same model kind.
 */
(function (PB) {
  'use strict';

  const { render, tpcl } = PB.slices.line;

  PB.components.register({
    kind: 'line',
    order: 40,
    modelKind: 'line',
    matches: item => !item.rect,
    label: 'Línea',
    glyph: '─',
    // A line carries no data command by design (the neutral "no content" validation rule skips it)
    carriesData: false,
    render,
    languages: { tpcl },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
