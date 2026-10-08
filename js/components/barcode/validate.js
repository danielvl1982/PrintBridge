/**
 * Barcode slice: neutral validation. Published on PB.slices.barcode.validate and registered by
 * js/components/barcode/index.js as the slice's `validate` hook, which PB.validator calls for every item of this kind.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  const { diagnostics: diag } = PB;

  /** Barcode symbologies the drawing generates for real. */
  const EXACT_SYMBOLOGIES = Object.freeze(['code128', 'code39', 'itf', 'ean13', 'ean8', 'upca', 'upce']);

  /** validate(item) -> diagnostics: barcodes the viewer does not generate exactly. */
  function validate(item) {
    return EXACT_SYMBOLOGIES.includes(item.symbology)
      ? []
      : [diag.warning(`${item.ref}: código "${item.symbology}"${item.native && item.native.type ? ` (tipo ${item.native.type})` : ''} dibujado aproximado (solo Code128, Code39, ITF y EAN / UPC son exactos)`)];
  }

  PB.slices.barcode.validate = validate;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
