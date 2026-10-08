/**
 * Barcode slice: Industrial 2 of 5 (standard 2 of 5) encoder (wide/narrow symbology), published as PB.industrial25.
 * encode(data, { check }) returns { elements, text, characters, warnings } like PB.code39 (see code39.js): elements are alternating
 * bars and spaces, starting with a bar, as { bar, wide }; characters are separated by { bar: false, wide: false, gap: true }.
 * Digits only; the bars carry the data (5 bars per digit, 2 of them wide) and the spaces are all narrow (the TPCL manual fixes the wide
 * space to 00 and calls the narrow space the element-to-element space). Start = wide, wide, narrow bars; stop = wide, narrow, wide bars
 * (the manuals do not give the patterns: the usual ones). check: 'none' | 'check' (the data already ends with the check digit) |
 * 'auto' (attached) | 'unsupported'. The manual only says "modulus check character": the viewer uses modulus 10 (weights 3, 1 from the right).
 */
(function (PB) {
  'use strict';

  const { UNSUPPORTED_CHECK } = PB.slices.barcode;

  /** Bar widths of each digit ('n' narrow, 'w' wide). */
  const PATTERNS = Object.freeze({
    0: 'nnwwn', 1: 'wnnnw', 2: 'nwnnw', 3: 'wwnnn', 4: 'nnwnw', 5: 'wnwnn', 6: 'nwwnn', 7: 'nnnww', 8: 'wnnwn', 9: 'nwnwn',
  });
  const START = 'wwn';
  const STOP = 'wnw';

  /** Modulus 10 check digit: weights 3, 1, 3... from the right. */
  function checkDigit(data) {
    const total = [...data].reduceRight((sum, d, i) => sum + Number(d) * ((data.length - 1 - i) % 2 === 0 ? 3 : 1), 0);
    return (10 - (total % 10)) % 10;
  }

  /** One character: its bars separated by narrow spaces. */
  const character = pattern => [...pattern].flatMap((c, i) => [...(i ? [{ bar: false, wide: false }] : []), { bar: true, wide: c === 'w' }]);
  const SEPARATOR = Object.freeze({ bar: false, wide: false, gap: true });

  function encodeIndustrial25(data, { check = 'none' } = {}) {
    const text = String(data);
    if (!/^\d*$/.test(text)) return { elements: [], text, characters: 0, warnings: ['2 de 5 industrial: solo admite dígitos, no se dibuja'] };
    const warnings = check === 'unsupported' ? [`2 de 5 industrial: ${UNSUPPORTED_CHECK}`] : [];
    if (check === 'check' && (text.length < 2 || checkDigit(text.slice(0, -1)) !== Number(text.at(-1)))) {
      warnings.push('2 de 5 industrial: el último dígito no es el dígito de control correcto (módulo 10), la impresora puede rechazar el dato');
    }
    const digits = check === 'auto' ? text + checkDigit(text) : text;
    const patterns = [START, ...[...digits].map(d => PATTERNS[d]), STOP];
    const elements = patterns.flatMap((p, i) => [...(i ? [SEPARATOR] : []), ...character(p)]);
    return { elements, text, characters: digits.length, warnings };
  }

  PB.industrial25 = Object.freeze({ PATTERNS, START, STOP, checkDigit, encode: encodeIndustrial25 });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
