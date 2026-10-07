/**
 * Barcode content conventions, common to all languages.
 */
(function (PB) {
  'use strict';

  PB.barcodeData = Object.freeze({
    /** Function 1 (FNC1) inside the data: GS character (ASCII 29), which cannot appear in a normal Code128. */
    FNC1: '\u001d',
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
