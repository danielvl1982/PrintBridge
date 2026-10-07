/**
 * Image slice: registers the `image` component (TPCL SG graphic and the preview overlay). Loads after the other files of
 * the slice (codec.js, render.js, tpcl.js). It has no `build` hook, so the language does not list it as a template: the
 * app adds its palette entry itself (it opens a file picker) after the language's templates, which is why it is last.
 */
(function (PB) {
  'use strict';

  const { render, tpcl } = PB.slices.image;

  PB.components.register({
    kind: 'image',
    // Last palette entry (see `order` in js/components/registry.js)
    order: 60,
    label: 'Imagen',
    glyph: '🖼',
    // No data command: skipped by the "no content" rule
    carriesData: false,
    render,
    languages: { tpcl },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
