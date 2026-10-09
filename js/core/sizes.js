/**
 * Label sizes: catalog of standard sizes and computation of the drawing area, which always follows the size the
 * label declares. How a size is declared and written in the text is decided by each language (sizeCommands,
 * applySize of the registry).
 *
 * A catalog "size" is in mm: { id, name, w, h, p }.
 * A "resolved" size is in 0.1 mm (returned by resolve) and is the one the other modules use.
 */
(function (PB) {
  'use strict';

  const { units, config, diagnostics: diag } = PB;

  /** Catalog size (mm) -> resolved size (0.1 mm). */
  function resolve(size) {
    return { ...size, w: units.fromMm(size.w), h: units.fromMm(size.h), p: units.fromMm(size.p || size.h) };
  }

  /** Catalog of the standard sizes (config.sizes). */
  function createCatalog(list) {
    return Object.freeze({
      all: () => list,
      get: id => list.find(s => s.id === id) || null,
      /**
       * Size with the same pitch, width and height (0.1 mm) as the model's neutral size, or null. A size that is only known to within
       * `size.tolerance` (0.1 mm; ZPL declares whole dots, so 100 x 60 mm reads back as 100.0 x 60.1) matches a standard one when the width
       * and the height are that close, and its missing pitch (ZPL has none) is not compared. Without a tolerance the match is exact.
       */
      findBySize: size => list.find(s => {
        const r = resolve(s);
        const tolerance = Number.isFinite(size.tolerance) && size.tolerance > 0 ? size.tolerance : 0;
        const pitchOk = tolerance > 0 && size.pitch == null ? true : r.p === size.pitch;
        return pitchOk && Math.abs(r.w - size.width) <= tolerance && Math.abs(r.h - size.height) <= tolerance;
      }) || null,
    });
  }

  /**
   * Pitch of the size a label declares, for display: the declared pitch or, for a hand-made model that only states the
   * separation, height + gap (the parsers already derive it). null if neither is known. The parsed model is not changed.
   */
  function declaredPitch(size) {
    if (size.pitch != null) return size.pitch;
    return size.width != null && Number.isFinite(size.gap) ? size.height + size.gap : null;
  }

  /**
   * Drawing area for a model: the size the label declares or, if it declares none, the fallback with a warning.
   * Returns { width, height, pitch, diagnostics }.
   */
  function view(model) {
    const declared = model.size;
    if (declared.width != null) return { width: declared.width, height: declared.height, pitch: declaredPitch(declared), diagnostics: [] };
    const { w, h } = config.fallbackSize;
    return {
      width: w, height: h, pitch: null,
      diagnostics: [diag.warning(`La etiqueta no declara su tamaño: puedes indicarlo en la fila Formato, que lo escribe en la etiqueta. Se dibuja a ${units.formatMm(w)}×${units.formatMm(h)} mm`)],
    };
  }

  /**
   * Label text with the size written by the given language: { text, supported, diagnostics? } (diagnostics only when the language
   * had to adjust the size to its limits).
   * If the language has no applySize (or there is no language) the text does not change and supported is false.
   */
  function apply(language, text, chosen) {
    if (!language || !language.applySize) return { text, supported: false };
    // A language with limits (TPCL {D) has `fitSize(size) -> { size, diagnostics }`: what it adjusts is written and reported
    const fit = language.fitSize ? language.fitSize(chosen) : null;
    const result = { text: language.applySize(text, fit ? fit.size : chosen), supported: true };
    if (fit && fit.diagnostics.length) result.diagnostics = fit.diagnostics;
    return result;
  }

  PB.sizes = Object.freeze({ resolve, createCatalog, declaredPitch, view, apply });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
