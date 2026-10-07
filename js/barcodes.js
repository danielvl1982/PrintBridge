/**
 * QR generation. Wraps the qrcode-generator library (js/lib/) so that the rest of the viewer
 * does not depend on its API. The 1D barcode encoders live in js/components/barcode/.
 */
(function (PB) {
  'use strict';

  /**
   * QR matrix: { size, isDark(row, column) }, or null if it cannot be generated
   * (data too long or library not available).
   */
  function matrix(data, ecc) {
    const lib = globalThis.qrcode;
    if (!lib) return null;
    try {
      const qr = lib(0, ecc);
      qr.addData(String(data));
      qr.make();
      const size = qr.getModuleCount();
      return { size, isDark: (r, c) => qr.isDark(r, c) };
    } catch {
      return null;
    }
  }

  PB.qr = Object.freeze({ matrix });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
