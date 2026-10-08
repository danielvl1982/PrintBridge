/**
 * Barcode slice: constants shared by the encoders (code39.js, itf.js), published on PB.slices.barcode. Loads before them.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  /** Warning for a check digit option the viewer does not know (the barcode is drawn without it). */
  PB.slices.barcode.UNSUPPORTED_CHECK = 'opción de dígito de control no soportada por el visor, se dibuja sin dígito de control';

  /**
   * Barcode type selector (properties panel). The options are DATA: a symbology is offered when the language's emit table
   * (TYPE_CODES in tpcl.js / tspl.js) has a row for it and LABELS has its name; a check option when the language's check
   * table (CHECK_CODES) lists it for that symbology. A later symbology only adds rows to those tables and a label here.
   * The order of the options is the order of LABELS.
   */
  const LABELS = Object.freeze({ code128: 'Code 128', code39: 'Code 39', itf: 'ITF (2 de 5 intercalado)' });
  const CHECK_LABELS = Object.freeze({ none: 'Sin dígito de control', mod43: 'Módulo 43' });

  /** [{ value, label }] of the symbologies that have a row in typeCodes (an object keyed by symbology) and a label. */
  const symbologyOptions = (typeCodes, labels = LABELS) => Object.keys(labels)
    .filter(symbology => Object.hasOwn(typeCodes, symbology))
    .map(symbology => ({ value: symbology, label: labels[symbology] }));

  /** [{ value, label }] of the check options a symbology has in checkCodes (symbology -> { check: code }); none when it has no row. */
  const checkOptions = (checkCodes, symbology, labels = CHECK_LABELS) => Object.keys(Object.hasOwn(checkCodes, symbology) ? checkCodes[symbology] : {})
    .map(check => ({ value: check, label: labels[check] || check }));

  PB.slices.barcode.selector = Object.freeze({ LABELS, CHECK_LABELS, symbologyOptions, checkOptions });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
