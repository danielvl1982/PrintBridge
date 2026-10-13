/**
 * Barcode slice: neutral validation. Published on PB.slices.barcode.validate and registered by
 * js/components/barcode/index.js as the slice's `validate` hook, which PB.validator calls for every item of this kind.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  const { diagnostics: diag, gs1 } = PB;

  /** Barcode symbologies the drawing generates for real. */
  const EXACT_SYMBOLOGIES = Object.freeze(['code128', 'code39', 'itf', 'code93', 'codabar', 'msi', 'industrial25', 'ean13', 'ean8', 'upca', 'upce', 'gs1-128']);

  /** validate(item) -> diagnostics: barcodes the viewer does not generate exactly. */
  function validate(item) {
    // GS1-128: the element string is checked (AIs of the logistic subset, lengths, characters, mod 10, dates); variables are not known yet
    if (item.symbology === 'gs1-128') {
      const data = String(item.data ?? '');
      return /<?#\w+#>?/.test(data) ? [] : gs1.parse(data).diagnostics.map(d => diag[d.level](`${item.ref}: ${d.text}`));
    }
    return EXACT_SYMBOLOGIES.includes(item.symbology)
      ? []
      : [diag.warning(`${item.ref}: código "${item.symbology}"${item.native && item.native.type ? ` (tipo ${item.native.type})` : ''} dibujado aproximado (solo Code128, GS1-128, Code39, ITF, Code93, NW7, MSI, 2 de 5 industrial y EAN / UPC son exactos)`)];
  }

  PB.slices.barcode.validate = validate;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
