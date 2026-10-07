/**
 * Barcode slice: Code 39 encoder (wide/narrow symbology), published as PB.code39.
 * encode(data, { check }) returns { elements, text, characters, warnings }:
 *   - elements: alternating bars and spaces, starting with a bar, as { bar, wide } (a separator between
 *     Code 39 characters is { bar: false, wide: false, gap: true }). The renderer gives them real widths.
 *   - text: the content that is encoded, for the human-readable line (without start/stop or check character).
 *   - warnings: Spanish messages for what the viewer cannot do. If the data cannot be encoded, elements is [].
 *   - check: 'none' | 'mod43' | 'unsupported' (an option the viewer does not know: it is drawn
 *     without check character and reported). It is neutral: each language maps its own options to it.
 */
(function (PB) {
  'use strict';

  const { UNSUPPORTED_CHECK } = PB.slices.barcode;

  /** 'n' / 'w' pattern -> elements; the first one is a bar. */
  const toElements = pattern => [...pattern].map((c, i) => ({ bar: i % 2 === 0, wide: c === 'w' }));

  /** Code 39: 9 elements (5 bars and 4 spaces, 3 of them wide) per character. */
  const CODE39_PATTERNS = Object.freeze({
    0: 'nnnwwnwnn', 1: 'wnnwnnnnw', 2: 'nnwwnnnnw', 3: 'wnwwnnnnn', 4: 'nnnwwnnnw', 5: 'wnnwwnnnn', 6: 'nnwwwnnnn',
    7: 'nnnwnnwnw', 8: 'wnnwnnwnn', 9: 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw',
    E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww',
    L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn',
    S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
    Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
    $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
  });

  /** Characters in the order of their value for the modulo 43 check character (the start/stop * has none). */
  const CODE39_VALUES = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

  /** Modulo 43 check character of the data (all characters must be in CODE39_VALUES). */
  const checkCharacter = data => CODE39_VALUES[[...data].reduce((sum, c) => sum + CODE39_VALUES.indexOf(c), 0) % 43];

  const CODE39_SEPARATOR = Object.freeze({ bar: false, wide: false, gap: true });

  function encodeCode39(data, { check = 'none' } = {}) {
    const text = String(data);
    const invalid = [...new Set([...text].filter(c => !CODE39_VALUES.includes(c)))];
    if (invalid.length) {
      return { elements: [], text, characters: 0, warnings: [`Code39: no se puede codificar ${invalid.map(c => `"${c}"`).join(' ')} (solo caracteres del Code39 estándar: 0-9 A-Z - . espacio $ / + %), no se dibuja`] };
    }
    const warnings = check === 'unsupported' ? [`Code39: ${UNSUPPORTED_CHECK}`] : [];
    const chars = ['*', ...text, ...(check === 'mod43' ? [checkCharacter(text)] : []), '*'];
    const elements = chars.flatMap((c, i) => [...(i ? [CODE39_SEPARATOR] : []), ...toElements(CODE39_PATTERNS[c])]);
    return { elements, text, characters: chars.length - 2, warnings };
  }

  PB.code39 = Object.freeze({ PATTERNS: CODE39_PATTERNS, checkCharacter, encode: encodeCode39 });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
