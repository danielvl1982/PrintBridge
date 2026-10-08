/**
 * Barcode slice: NW7 (Codabar) encoder (wide/narrow symbology), published as PB.codabar.
 * encode(data) returns { elements, text, characters, warnings } like PB.code39 (see code39.js): elements are alternating bars and
 * spaces, starting with a bar, as { bar, wide } (a separator between characters is { bar: false, wide: false, gap: true }).
 * The data may carry its start and stop characters (A, B, C or D at each end); a missing one is added as A (the TPCL manual only
 * says the printer attaches the start / stop code automatically, not which: viewer assumption). The text is the data as given.
 * The data characters are 0-9 - $ : / . + ; anything else is reported and nothing is drawn.
 */
(function (PB) {
  'use strict';

  const { UNSUPPORTED_CHECK } = PB.slices.barcode;

  /** 'n' / 'w' pattern -> elements; the first one is a bar. */
  const toElements = pattern => [...pattern].map((c, i) => ({ bar: i % 2 === 0, wide: c === 'w' }));

  /** NW7: 7 elements (4 bars and 3 spaces) per character. */
  const PATTERNS = Object.freeze({
    0: 'nnnnnww', 1: 'nnnnwwn', 2: 'nnnwnnw', 3: 'wwnnnnn', 4: 'nnwnnwn', 5: 'wnnnnwn', 6: 'nwnnnnw', 7: 'nwnnwnn', 8: 'nwwnnnn', 9: 'wnnwnnn',
    '-': 'nnnwwnn', $: 'nnwwnnn', ':': 'wnnnwnw', '/': 'wnwnnnw', '.': 'wnwnwnn', '+': 'nnwnwnw',
    A: 'nnwwnwn', B: 'nwnwnnw', C: 'nnnwnww', D: 'nnnwwwn',
  });
  const DATA_CHARACTERS = '0123456789-$:/.+';
  const START_STOP = 'ABCD';
  const DEFAULT_START_STOP = 'A';

  const SEPARATOR = Object.freeze({ bar: false, wide: false, gap: true });

  function encodeCodabar(data, { check = 'none' } = {}) {
    const text = String(data);
    let body = [...text];
    const start = START_STOP.includes(body[0]) ? body.shift() : DEFAULT_START_STOP;
    const stop = body.length && START_STOP.includes(body.at(-1)) ? body.pop() : DEFAULT_START_STOP;
    const invalid = [...new Set(body.filter(c => !DATA_CHARACTERS.includes(c)))];
    if (invalid.length) {
      return { elements: [], text, characters: 0, warnings: [`NW7: no se puede codificar ${invalid.map(c => `"${c}"`).join(' ')} (solo 0-9 - $ : / . + y las letras A-D de inicio y parada), no se dibuja`] };
    }
    const warnings = check === 'unsupported' ? [`NW7: ${UNSUPPORTED_CHECK}`] : [];
    const chars = [start, ...body, stop];
    const elements = chars.flatMap((c, i) => [...(i ? [SEPARATOR] : []), ...toElements(PATTERNS[c])]);
    return { elements, text, characters: body.length, warnings };
  }

  PB.codabar = Object.freeze({ PATTERNS, encode: encodeCodabar });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
