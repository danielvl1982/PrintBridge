/**
 * Data Matrix slice: neutral validation (published on PB.slices.datamatrix.validate, registered as the slice's `validate` hook).
 * Reports what the viewer cannot draw so the user knows why a hatched placeholder appears: an ECC type other than ECC200, a module of 0
 * (the printer draws nothing), data the ASCII encodation cannot hold (more than 1558 codewords, characters above 255) and a forced size
 * too small for the data (the drawing uses the smallest that fits). Data with variables is skipped: its value is not known here.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.datamatrix = PB.slices.datamatrix || {};

  const { diagnostics: diag, datamatrix: dm } = PB;

  function validate(item) {
    const out = [];
    if (item.ecc !== undefined && item.ecc !== 200) {
      out.push(diag.warning(`${item.ref}: ECC ${item.ecc} no soportado por el visor (solo ECC200): no se dibuja`));
    }
    if (item.cell === 0) out.push(diag.info(`${item.ref}: módulo 0: la impresora no dibuja el Data Matrix`));
    const data = item.data == null ? '' : String(item.data);
    if (data === '' || PB.variables.namesIn(data).length) return out;
    const coded = dm.encode(data, { size: item.size });
    if (coded.ok) return out;
    if (coded.reason === 'long') {
      out.push(diag.warning(`${item.ref}: los datos no caben en el mayor Data Matrix soportado (144×144, 1558 palabras de código): no se dibuja`));
    } else if (coded.reason === 'unsupported') {
      out.push(diag.warning(`${item.ref}: los datos tienen caracteres fuera de 0-255 (${coded.unsupported.slice(0, 3).join(' ')}), que el visor no codifica: no se dibuja`));
    } else if (coded.reason === 'size') {
      const fits = dm.encode(data);
      out.push(diag.warning(`${item.ref}: el tamaño ${item.size}×${item.size} no alcanza para los datos${fits.ok ? `: se dibuja el menor que cabe (${fits.side}×${fits.side})` : ''}`));
    }
    return out;
  }

  PB.slices.datamatrix.validate = validate;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
