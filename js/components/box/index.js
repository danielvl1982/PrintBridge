/**
 * Box slice: registers the `box` component. Its model kind is still `line` (items with rect true), so the drawing is
 * the line slice's renderer. Loads after the line slice and the other files of this slice.
 */
(function (PB) {
  'use strict';

  PB.components.register({
    kind: 'box',
    modelKind: 'line',
    matches: item => !!item.rect,
    label: 'Caja',
    glyph: '▭',
    carriesData: false,
    render: PB.slices.line.render,
    languages: { tpcl: PB.slices.box.tpcl },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
