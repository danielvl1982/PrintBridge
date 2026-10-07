/**
 * Unit conversion. Internally everything is worked in tenths of a millimetre (0.1 mm).
 */
(function (PB) {
  'use strict';

  /** Tenths of mm per typographic point (1 pt = 0.35278 mm). */
  const UNITS_PER_POINT = 3.5278;

  PB.units = Object.freeze({
    UNITS_PER_POINT,

    /** Size of a printer dot in tenths of mm. */
    dotSize: dpi => 254 / dpi,

    /** Millimetres (number or text with a comma) -> tenths of mm. */
    fromMm: mm => Math.round(parseFloat(String(mm).replace(',', '.')) * 10),

    /** Tenths of mm -> millimetres (number). */
    toMm: units => units / 10,

    /** Tenths of mm -> text in mm with Spanish formatting ("99", "299,5"). */
    formatMm: units => (units / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 }),
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
