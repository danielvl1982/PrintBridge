/**
 * Barcode slice: constants shared by the encoders (code39.js, itf.js), published on PB.slices.barcode. Loads before them.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  /** Warning for a check digit option the viewer does not know (the barcode is drawn without it). */
  PB.slices.barcode.UNSUPPORTED_CHECK = 'opción de dígito de control no soportada por el visor, se dibuja sin dígito de control';
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
