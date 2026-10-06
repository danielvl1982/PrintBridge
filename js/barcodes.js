/**
 * Barcode generation: Code128 and QR.
 */

/**
 * Code128 encoder (automatic set selection).
 * Uses set B for text and set C for runs of 4 or more digits. FNC1 goes in the data as PB.barcodeData.FNC1.
 */
(function (PB) {
  'use strict';

  /** Bar/space widths of each symbol (0–105), starts 103–105 and stop 106. */
  const PATTERNS = (
    '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
    '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
    '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
    '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
    '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
    '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'
  ).split(' ');

  const { FNC1: FNC1_MARK } = PB.barcodeData;
  const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, FNC1 = 102, STOP = 106;

  const digitRun = (s, i) => { let n = 0; while (i + n < s.length && s[i + n] >= '0' && s[i + n] <= '9') n++; return n; };

  /** Symbol values, including start, control and stop. */
  function values(data) {
    const out = [];
    let set = null;
    const switchTo = target => {
      if (set === target) return;
      out.push(set === null ? (target === 'B' ? START_B : START_C) : (target === 'B' ? CODE_B : CODE_C));
      set = target;
    };
    String(data).split(FNC1_MARK).forEach((part, index) => {
      if (index > 0) { if (set === null) switchTo('C'); out.push(FNC1); }
      let i = 0;
      while (i < part.length) {
        const digits = digitRun(part, i);
        if (set === 'C' && digits >= 2) { out.push(Number(part.substr(i, 2))); i += 2; continue; }
        // Long run of digits: switch to C; if it is odd, the first digit goes before it in B
        if (digits >= 4 && digits % 2 === 0) { switchTo('C'); continue; }
        switchTo('B');
        const code = part.charCodeAt(i) - 32;
        out.push(code >= 0 && code < 96 ? code : 0);
        i++;
      }
    });
    if (!out.length) switchTo('B');
    const checksum = out.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
    return [...out, checksum, STOP];
  }

  /** Widths of alternating bars and spaces (starting with a bar), in modules. */
  function encode(data) {
    return values(data).map(v => PATTERNS[v]).join('').split('').map(Number);
  }

  PB.code128 = Object.freeze({
    PATTERNS,
    values,
    encode,
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Wide/narrow symbologies: Code 39 and Interleaved 2 of 5 (ITF).
 * encode(data, { check }) returns { elements, text, characters, warnings }:
 *   - elements: alternating bars and spaces, starting with a bar, as { bar, wide } (a separator between
 *     Code 39 characters is { bar: false, wide: false, gap: true }). The renderer gives them real widths.
 *   - text: the content that is encoded, for the human-readable line (without start/stop or check character).
 *   - warnings: Spanish messages for what the viewer cannot do. If the data cannot be encoded, elements is [].
 *   - check: 'none' | 'mod43' (Code 39 only) | 'unsupported' (an option the viewer does not know: it is drawn
 *     without check character and reported). It is neutral: each language maps its own options to it.
 */
(function (PB) {
  'use strict';

  const UNSUPPORTED_CHECK = 'opción de dígito de control no soportada por el visor, se dibuja sin dígito de control';

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

  PB.code39 = Object.freeze({ PATTERNS: CODE39_PATTERNS, checkCharacter, encode: encodeCode39 });
  PB.itf = Object.freeze({ PATTERNS: ITF_PATTERNS, encode: encodeItf });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * QR generation. Wraps the qrcode-generator library (js/lib/) so that the rest of the viewer
 * does not depend on its API.
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
