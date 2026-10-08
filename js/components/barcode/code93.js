/**
 * Barcode slice: Code 93 encoder (module based symbology), published as PB.code93.
 * encode(data, { check }) returns { widths, text, characters, warnings }:
 *   - widths: alternating bar and space widths in modules, starting with a bar (like PB.code128.encode), for
 *     start * + data + check characters + stop * + the termination bar. If the data cannot be encoded, widths is [].
 *   - text: the data that is encoded, for the human-readable line (without start/stop or the attached check characters).
 *   - check: 'none' | 'check' | 'auto' | 'unsupported'. 'auto' attaches the two check characters C and K (modulo 47); 'check' draws
 *     the data as it is (it already carries them, the printer verifies them) and warns when they are wrong; 'none' draws the
 *     data alone; 'unsupported' (an option the viewer does not know) draws like 'none' and reports it.
 * Only the standard Code 93 characters are drawn (full ASCII needs the four shift characters, which are out of scope).
 */
(function (PB) {
  'use strict';

  const { UNSUPPORTED_CHECK } = PB.slices.barcode;

  /** The 43 data characters in the order of their value (0..42); values 43..46 are the shift characters ($) (%) (/) (+). */
  const VALUES = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

  /** Bar / space widths (modules, 6 per symbol) of the values 0..46 followed by the start/stop *. */
  const PATTERNS = Object.freeze((
    '131112 111213 111312 111411 121113 121212 121311 111114 131211 141111 ' +
    '211113 211212 211311 221112 221211 231111 112113 112212 112311 122112 132111 111123 111222 111321 121122 131121 ' +
    '212112 212211 211122 211221 221121 222111 112122 112221 122121 123111 ' +
    '121131 311112 311211 321111 112131 113121 211131 121221 312111 122211 311121 111141'
  ).split(' '));
  const STOP_VALUE = 47;

  /** Weights of the check characters cycle 1..20 (C) and 1..15 (K), counted from the right. */
  const C_CYCLE = 20;
  const K_CYCLE = 15;

  const weightedSum = (values, cycle) => values.reduceRight((sum, v, i) => sum + v * (((values.length - 1 - i) % cycle) + 1), 0);

  /** The check characters C and K of the data (all characters must be in VALUES), as their values 0..46. */
  function checkValues(data) {
    const values = [...data].map(c => VALUES.indexOf(c));
    const c = weightedSum(values, C_CYCLE) % 47;
    const k = weightedSum([...values, c], K_CYCLE) % 47;
    return [c, k];
  }

  function encodeCode93(data, { check = 'none' } = {}) {
    const text = String(data);
    const invalid = [...new Set([...text].filter(c => !VALUES.includes(c)))];
    if (invalid.length) {
      return { widths: [], text, characters: 0, warnings: [`Code93: no se puede codificar ${invalid.map(c => `"${c}"`).join(' ')} (solo caracteres del Code93 estándar: 0-9 A-Z - . espacio $ / + %), no se dibuja`] };
    }
    const warnings = check === 'unsupported' ? [`Code93: ${UNSUPPORTED_CHECK}`] : [];
    let values = [...text].map(c => VALUES.indexOf(c));
    if (check === 'auto') values = [...values, ...checkValues(text)];
    if (check === 'check') {
      const body = [...text].slice(0, -2).join('');
      const wrong = text.length < 2 || checkValues(body).some((v, i) => v !== VALUES.indexOf([...text].at(i - 2)));
      if (wrong) warnings.push('Code93: los dos últimos caracteres no son el dígito de control correcto (módulo 47), la impresora puede rechazar el dato');
    }
    const symbols = [STOP_VALUE, ...values, STOP_VALUE];
    // Each symbol is 6 widths; the termination bar (1 module) closes the symbol after the stop character
    const widths = [...symbols.map(v => PATTERNS[v]).join('')].map(Number).concat(1);
    return { widths, text, characters: symbols.length - 2, warnings };
  }

  PB.code93 = Object.freeze({ PATTERNS, VALUES, checkValues, encode: encodeCode93 });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
