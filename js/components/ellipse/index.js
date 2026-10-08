/**
 * Ellipse slice: registers the `ellipse` and `circle` components. Both draw the neutral `ellipse` model kind (a circle is an
 * ellipse with equal axes whose ref is CIRCLE), like line and box share `line`. TSPL and ZPL (^GE, ^GC): TPCL has no equivalent, so its
 * hook just skips the item with one warning. Loads after the other files of this slice.
 * NOT VERIFIED ON A PRINTER: ELLIPSE and CIRCLE come from the TSC TSPL2 manual v3.0, which is not available locally.
 */
(function (PB) {
  'use strict';

  const { render, layout, tpcl, tspl, tsplCircle, zpl, zplCircle } = PB.slices.ellipse;

  PB.components.register({
    kind: 'ellipse',
    order: 55,
    modelKind: 'ellipse',
    matches: item => item.ref !== 'CIRCLE',
    label: 'Elipse',
    glyph: '⬭',
    // Like lines and boxes, no data command
    carriesData: false,
    render,
    layout,
    languages: { tpcl, tspl, zpl },
  });

  PB.components.register({
    kind: 'circle',
    order: 56,
    modelKind: 'ellipse',
    matches: item => item.ref === 'CIRCLE',
    label: 'Círculo',
    glyph: '○',
    carriesData: false,
    render,
    layout,
    languages: { tpcl, tspl: tsplCircle, zpl: zplCircle },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
