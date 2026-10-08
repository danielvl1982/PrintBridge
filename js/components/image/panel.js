/**
 * Image slice: "Imagen" controls (published as PB.ui.createImagePanel and PB.slices.image.createImagePanel): place a picture on the label (position and optional width in mm); the file itself is chosen from the palette.
 * It does not read the file or draw anything: it notifies and whoever uses it does the work.
 *  - onFile(file): the user chose a picture file (the hidden file input is opened by the palette entry).
 *  - onChange(): x, y or width changed.
 *  - onThreshold(): the "Umbral" slider moved (its value is already shown next to it).
 *  - onRotation(): the user picked a "Rotación" (0/90/180/270, clockwise on the label, like text items).
 *  - onRemove(): "Quitar imagen" was pressed.
 *  - onInsert(): "Insertar en el código" was pressed.
 */
(function (PB) {
  'use strict';

  /** els: { fileInput, x, y, width, rotation (select), threshold, thresholdValue, insert, remove } */
  function createImagePanel(els, { onFile, onChange, onThreshold, onRotation, onRemove, onInsert }) {
    const inputs = [els.x, els.y, els.width, els.rotation, els.threshold];
    const QUARTER_TURNS = [0, 90, 180, 270];
    const showThreshold = () => { els.thresholdValue.textContent = `${els.threshold.value} %`; };

    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files[0];
      if (file) onFile(file);
      els.fileInput.value = '';
    });
    [els.x, els.y, els.width].forEach(i => i.addEventListener('input', onChange));
    els.threshold.addEventListener('input', () => { showThreshold(); onThreshold(); });
    els.rotation.addEventListener('input', onRotation);
    els.remove.addEventListener('click', onRemove);
    els.insert.addEventListener('click', onInsert);
    showThreshold();

    return Object.freeze({
      /** Raw values typed in the inputs (mm; text, possibly empty). */
      placement: () => ({ xMm: els.x.value, yMm: els.y.value, widthMm: els.width.value }),
      /** Shows a new position (mm) in the X / Y inputs; it does not notify. */
      setPosition(xMm, yMm) {
        els.x.value = xMm;
        els.y.value = yMm;
      },
      /** Rotation shown in the select: 0, 90, 180 or 270 (anything else reads as 0). */
      rotation() {
        const degrees = Number(els.rotation.value);
        return QUARTER_TURNS.includes(degrees) ? degrees : 0;
      },
      /** Shows a rotation (degrees) in the select; it does not notify. */
      setRotation(degrees) {
        els.rotation.value = String(degrees);
      },
      /** Raw value of the "Umbral" slider (percent, text). */
      thresholdPercent: () => els.threshold.value,
      /** Enables the placement controls only while there is an image to place. */
      setActive(active) {
        inputs.forEach(i => { i.disabled = !active; });
        els.remove.disabled = !active;
        els.insert.disabled = !active;
      },
    });
  }

  // Same name and signature as before it moved here: callers keep using PB.ui.createImagePanel. PB.ui is extended, never
  // replaced, so the load order relative to js/ui.js does not matter.
  PB.slices = PB.slices || {};
  PB.slices.image = PB.slices.image || {};
  PB.slices.image.createImagePanel = createImagePanel;
  PB.ui = PB.ui || {};
  PB.ui.createImagePanel = createImagePanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
