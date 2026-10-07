/**
 * Label sizes: catalog of known sizes, check against the size the label declares
 * and computation of the drawing area. How a size is declared, checked and written in the
 * text is decided by each language (sizeCommands, matchesSize, applySize of the registry).
 *
 * A catalog "size" is in mm: { id, name, w, h, p, required?, native? }.
 * native keeps per-language data by id (e.g. native.tpcl.ax) and only that language reads it.
 * A "resolved" size is in 0.1 mm (returned by resolve) and is the one the other modules use.
 */
(function (PB) {
  'use strict';

  const { units, config, diagnostics: diag } = PB;

  /** Catalog size (mm) -> resolved size (0.1 mm). */
  function resolve(size) {
    return { ...size, w: units.fromMm(size.w), h: units.fromMm(size.h), p: units.fromMm(size.p || size.h) };
  }

  /** Catalog of the known sizes (config.sizes). */
  function createCatalog(list) {
    return Object.freeze({
      all: () => list,
      get: id => list.find(s => s.id === id) || null,
      /** Size with the same pitch, width and height (0.1 mm) as the model's neutral size, or null. */
      findBySize: size => list.find(s => {
        const r = resolve(s);
        return r.p === size.pitch && r.w === size.width && r.h === size.height;
      }) || null,
    });
  }

  /**
   * Drawing area for a model: the chosen (resolved) size or, if there is none, the one the label declares.
   * Returns { width, height, pitch, diagnostics }.
   */
  function view(model, chosen) {
    const declared = model.size;
    if (!chosen) {
      if (declared.width != null) return { width: declared.width, height: declared.height, pitch: declared.pitch, diagnostics: [] };
      const { w, h } = config.fallbackSize;
      return {
        width: w, height: h, pitch: null,
        diagnostics: [diag.warning(`La etiqueta no declara su tamaño: indica el tamaño en "Tamaño etiqueta". Se dibuja a ${units.formatMm(w)}×${units.formatMm(h)} mm`)],
      };
    }
    return { width: chosen.w, height: chosen.h, pitch: chosen.p, diagnostics: check(model, chosen) };
  }

  /** Differences between the label and the chosen size, per the language it was parsed with (no language or no matchesSize: none). */
  function check(model, chosen) {
    const language = PB.languages.get(model.language);
    return language && language.matchesSize ? language.matchesSize(model, chosen) : [];
  }

  /**
   * Label text with the size written by the given language: { text, supported }.
   * If the language has no applySize (or there is no language) the text does not change and supported is false.
   */
  function apply(language, text, chosen) {
    return language && language.applySize ? { text: language.applySize(text, chosen), supported: true } : { text, supported: false };
  }

  PB.sizes = Object.freeze({ resolve, createCatalog, view, apply });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
