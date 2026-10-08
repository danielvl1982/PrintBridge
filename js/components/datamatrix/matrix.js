/**
 * Data Matrix slice: the ECC200 encoder, published as PB.datamatrix (pure, no DOM). Own implementation, no library.
 * Scope: ECC200, ASCII encodation only, square symbols only (see sizes.js); C40 / Text / X12 / EDIFACT / Base 256, rectangular
 * symbols, structured append and FNC1 are not supported (the printer may choose another encodation and size for the same data, so
 * the drawing can differ from the printed symbol).
 *
 *   ascii(text) -> { ok, codewords, unsupported }   ASCII encodation: two digits -> 130 + their value, a character 0..127 -> code + 1,
 *                                                   128..255 -> upper shift 235 then code - 127; above 255 is unsupported
 *   pad(codewords, capacity)                        pad codewords: the first is 129, the others use the 253-state randomisation
 *                                                   R = (149 x position mod 253) + 1; 129 + R, minus 254 when above 254 (position 1-based)
 *   stream(text, size, { codewords? }) -> { data, blocks: [{ data, ecc }], stream }
 *                                                   padded data codewords, the Reed-Solomon blocks (data codeword i goes to block
 *                                                   i mod blocks) and the final sequence: data, then the ecc interleaved (ecc k of block b
 *                                                   at data + k x blocks + b)
 *   place(n)                                        the placement of the n x n mapping matrix (placement.js)
 *   encode(text, { size? }) -> { ok: true, side, size, codewords, isDark(row, col) }
 *                            | { ok: false, reason: 'empty' | 'unsupported' | 'long' | 'size', unsupported? }
 *     size = the side of a forced square size (it must be in the table and hold the data; else reason 'size').
 *   SIZES, PLACE_UNUSED, PLACE_FIXED_DARK, rs (generator / encode)
 * The symbol is the data regions (placed as one mapping matrix, then split) each with its finder (solid left column and bottom row)
 * and clock track (top row and right column alternating; the top row is dark on even columns and the right column on odd rows).
 */
(function (PB) {
  'use strict';

  const { sizes: SIZES, rs, placement } = PB.slices.datamatrix;

  const PAD_FIRST = 129;
  const UPPER_SHIFT = 235;
  const DIGIT = /^[0-9]$/;

  function ascii(text) {
    const chars = Array.from(String(text ?? ''));
    const unsupported = [...new Set(chars.filter(ch => ch.codePointAt(0) > 255))];
    if (unsupported.length) return { ok: false, codewords: [], unsupported };
    const codewords = [];
    for (let i = 0; i < chars.length; i++) {
      const code = chars[i].charCodeAt(0);
      if (DIGIT.test(chars[i]) && DIGIT.test(chars[i + 1] || '')) {
        codewords.push(130 + Number(chars[i] + chars[i + 1]));
        i++;
      } else if (code <= 127) codewords.push(code + 1);
      else codewords.push(UPPER_SHIFT, code - 127);
    }
    return { ok: true, codewords, unsupported: [] };
  }

  function pad(codewords, capacity) {
    const out = [...codewords];
    while (out.length < capacity) {
      const position = out.length + 1;
      if (position === codewords.length + 1) out.push(PAD_FIRST);
      else {
        const randomised = PAD_FIRST + ((149 * position) % 253) + 1;
        out.push(randomised > 254 ? randomised - 254 : randomised);
      }
    }
    return out;
  }

  function stream(text, size, { codewords } = {}) {
    const data = pad(codewords || ascii(text).codewords, size.data);
    const eccPerBlock = size.ecc / size.blocks;
    const blocks = Array.from({ length: size.blocks }, () => ({ data: [], ecc: [] }));
    data.forEach((word, i) => blocks[i % size.blocks].data.push(word));
    for (const block of blocks) block.ecc = rs.encode(block.data, eccPerBlock);
    const out = [...data, ...new Array(size.ecc).fill(0)];
    blocks.forEach((block, b) => block.ecc.forEach((word, k) => { out[size.data + k * size.blocks + b] = word; }));
    return { data, blocks, stream: out };
  }

  /** Smallest size that holds `count` codewords, or undefined. */
  const smallestFor = count => SIZES.find(s => s.data >= count);

  function encode(text, { size: forced } = {}) {
    const coded = ascii(text);
    if (!coded.ok) return { ok: false, reason: 'unsupported', unsupported: coded.unsupported };
    if (coded.codewords.length === 0) return { ok: false, reason: 'empty' };
    let size;
    if (forced !== undefined && forced !== null) {
      size = SIZES.find(s => s.side === forced);
      if (!size || size.data < coded.codewords.length) return { ok: false, reason: 'size' };
    } else {
      size = smallestFor(coded.codewords.length);
      if (!size) return { ok: false, reason: 'long' };
    }
    const { stream: words } = stream(text, size, { codewords: coded.codewords });
    const n = size.regions * size.region;
    const cells = placement.place(n);
    const { side } = size;
    const grid = new Uint8Array(side * side);
    const step = size.region + 2;
    // Finder and clock of every region
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
        const [rr, cc] = [r % step, c % step];
        if (cc === 0 || rr === step - 1) grid[r * side + c] = 1;
        else if (rr === 0) grid[r * side + c] = c % 2 === 0 ? 1 : 0;
        else if (cc === step - 1) grid[r * side + c] = r % 2 === 1 ? 1 : 0;
      }
    }
    // Data: the mapping matrix cell (r, c) sits in region (r / region, c / region), inside its finder and clock
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = cells[r * n + c];
        const dark = cell === placement.FIXED_DARK || (cell >= 0 && ((words[cell >> 3] >> (7 - (cell & 7))) & 1) === 1);
        const row = Math.floor(r / size.region) * step + 1 + (r % size.region);
        const col = Math.floor(c / size.region) * step + 1 + (c % size.region);
        grid[row * side + col] = dark ? 1 : 0;
      }
    }
    return {
      ok: true, side, size, codewords: words,
      isDark: (row, col) => row >= 0 && col >= 0 && row < side && col < side && grid[row * side + col] === 1,
    };
  }

  PB.datamatrix = Object.freeze({
    SIZES, ascii, pad, stream, encode, rs, place: placement.place,
    PLACE_UNUSED: placement.UNUSED, PLACE_FIXED_DARK: placement.FIXED_DARK,
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
