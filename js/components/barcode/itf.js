/**
 * Barcode slice: Interleaved 2 of 5 (ITF) encoder (wide/narrow symbology), published as PB.itf.
 * encode(data, { check }) returns { elements, text, characters, warnings } like PB.code39 (see code39.js): elements are
 * alternating bars and spaces, starting with a bar, as { bar, wide }; if the data cannot be encoded, elements is [].
 */
(function (PB) {
  'use strict';

  const { UNSUPPORTED_CHECK } = PB.slices.barcode;

  /** 'n' / 'w' pattern -> elements; the first one is a bar. */
  const toElements = pattern => [...pattern].map((c, i) => ({ bar: i % 2 === 0, wide: c === 'w' }));

  /** ITF: each digit is 5 elements (2 of them wide); the pair interleaves bars (1st digit) and spaces (2nd). */
  const ITF_PATTERNS = Object.freeze({
    0: 'nnwwn', 1: 'wnnnw', 2: 'nwnnw', 3: 'wwnnn', 4: 'nnwnw', 5: 'wnwnn', 6: 'nwwnn', 7: 'nnnww', 8: 'wnnwn', 9: 'nwnwn',
  });
  const ITF_START = 'nnnn';
  const ITF_STOP = 'wnn';

  function encodeItf(data, { check = 'none' } = {}) {
    let text = String(data);
    if (!/^\d*$/.test(text)) {
      return { elements: [], text, characters: 0, warnings: ['ITF: solo admite dígitos, no se dibuja'] };
    }
    const warnings = check === 'unsupported' ? [`ITF: ${UNSUPPORTED_CHECK}`] : [];
    if (text.length % 2) {
      // Unverified printer behavior (research gap): the viewer assumes a leading 0, as is usual for ITF
      text = '0' + text;
      warnings.push('ITF: número impar de dígitos; se dibuja con un 0 a la izquierda, pero el comportamiento de la impresora no ha sido verificado');
    }
    const pairs = text.match(/\d\d/g) || [];
    const body = pairs.flatMap(([a, b]) => [...ITF_PATTERNS[a]].flatMap((c, i) => [{ bar: true, wide: c === 'w' }, { bar: false, wide: ITF_PATTERNS[b][i] === 'w' }]));
    return { elements: [...toElements(ITF_START), ...body, ...toElements(ITF_STOP)], text, characters: text.length, warnings };
  }

  PB.itf = Object.freeze({ PATTERNS: ITF_PATTERNS, encode: encodeItf });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
