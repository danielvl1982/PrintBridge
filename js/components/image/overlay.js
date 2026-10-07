/**
 * Image slice: the file-picker side of the overlay image. The palette entry opens the hidden file input and remembers
 * where the picture must land (a drop position); the app takes that position once the file is loaded. Published on
 * PB.slices.image.overlay and exposed by the registered definition as `overlay` (see js/components/registry.js).
 * The overlay state itself (state.image, conversion, preview) stays in js/app.js: it is closure state shared with refresh.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.image = PB.slices.image || {};

  /**
   * deps: { fileInput (the hidden <input type="file">), refresh({ notices }) (redraws the label showing the notices) }
   * Returns { pick(x, y, { dropped }), takePosition(), clear() }.
   */
  function createPicker({ fileInput, refresh }) {
    /** Position (mm) the next loaded image takes, set when the picker is opened from the palette; null = keep the fields. */
    let pendingPosition = null;
    fileInput.addEventListener('cancel', () => { pendingPosition = null; });

    return Object.freeze({
      /**
       * Opens the file picker for the image entry; the loaded picture is placed at x, y (label units, 0.1 mm).
       * A drop is not a reliable user gesture for file pickers: if the browser reports no active gesture, or click() throws,
       * the user is told to click the entry instead.
       */
      pick(x, y, { dropped = false } = {}) {
        const hint = PB.diagnostics.warning('El navegador no permite abrir el selector de archivos al soltar: haz clic en "Imagen" de la paleta');
        if (dropped && navigator.userActivation && !navigator.userActivation.isActive) {
          refresh({ notices: [hint] });
          return;
        }
        const toMm = value => Math.min(999.9, Math.max(0, Math.round(value) / 10));
        pendingPosition = [toMm(x), toMm(y)];
        try {
          fileInput.click();
        } catch (error) {
          pendingPosition = null;
          refresh({ notices: [hint] });
        }
      },
      /** The position chosen by pick() (mm: [x, y]) or null; it is handed over once. */
      takePosition() {
        const position = pendingPosition;
        pendingPosition = null;
        return position;
      },
      /** Forgets the pending position (the picture failed to load). */
      clear() { pendingPosition = null; },
    });
  }

  PB.slices.image.overlay = Object.freeze({ createPicker });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
