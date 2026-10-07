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
      /** Size with the same pitch, width and height (0.1 mm) as the model's neutral size, or null. */
      findBySize: size => list.find(s => {
        const r = resolve(s);
        return r.p === size.pitch && r.w === size.width && r.h === size.height;
      }) || null,
    });
  }

  /**
   * Pitch of the size a label declares, for display: the declared pitch or, when the language only states the separation
   * (TSPL GAP), height + gap. null if neither is known. The parsed model is not changed.
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
   * Label text with the size written by the given language: { text, supported }.
   * If the language has no applySize (or there is no language) the text does not change and supported is false.
   */
  function apply(language, text, chosen) {
    return language && language.applySize ? { text: language.applySize(text, chosen), supported: true } : { text, supported: false };
  }

  PB.sizes = Object.freeze({ resolve, createCatalog, declaredPitch, view, apply });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
