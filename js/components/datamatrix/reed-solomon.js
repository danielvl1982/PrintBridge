/**
 * Data Matrix slice: Reed-Solomon over GF(256) as ECC200 uses it (published on PB.slices.datamatrix.rs).
 *   - field: GF(2^8) with the primitive polynomial 0x12D = x^8 + x^5 + x^3 + x^2 + 1, alpha = 2;
 *   - generator of n ecc codewords: g(x) = (x + alpha^1)(x + alpha^2)...(x + alpha^n), roots alpha^1..alpha^n, computed here (not typed);
 *   - the ecc codewords are the remainder of data(x) * x^n divided by g(x), highest degree first (the order they are appended in).
 * generator(n) returns the n coefficients that follow the leading 1, highest degree first; encode(data, n) the n ecc codewords.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.datamatrix = PB.slices.datamatrix || {};

  const PRIMITIVE = 0x12D;

  const EXP = new Array(512);
  const LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIMITIVE;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  const generators = new Map();

  /** Coefficients of g(x) after the leading 1, highest degree first. */
  function generator(n) {
    if (generators.has(n)) return generators.get(n);
    let g = [1]; // highest degree first, monic
    for (let i = 1; i <= n; i++) {
      const next = new Array(g.length + 1).fill(0);
      // g(x) * (x + alpha^i)
      g.forEach((coefficient, j) => {
        next[j] ^= coefficient;
        next[j + 1] ^= mul(coefficient, EXP[i]);
      });
      g = next;
    }
    const out = Object.freeze(g.slice(1));
    generators.set(n, out);
    return out;
  }

  /** The n error correction codewords of the data codewords. */
  function encode(data, n) {
    const g = generator(n);
    const ecc = new Array(n).fill(0);
    for (const word of data) {
      const t = word ^ ecc[0];
      for (let i = 0; i < n - 1; i++) ecc[i] = ecc[i + 1] ^ mul(t, g[i]);
      ecc[n - 1] = mul(t, g[n - 1]);
    }
    return ecc;
  }

  PB.slices.datamatrix.rs = Object.freeze({ PRIMITIVE, generator, encode });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
