/**
 * Barcode slice: Code128 encoder (automatic set selection), published as PB.code128.
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
