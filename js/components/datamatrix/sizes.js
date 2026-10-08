/**
 * Data Matrix slice: the symbol size table of ECC200, square symbols only (published on PB.slices.datamatrix.sizes).
 *
 * HAND TYPED from memory of ISO/IEC 16022 table 7 (the standard is not available). It is validated by properties in
 * tests/datamatrix-encoder.test.js instead of by comparison with the standard:
 *   - side = regions per side x (data region side + 2)            (each region adds a one module wide finder L and clock track)
 *   - data + ecc codewords = floor(data region modules / 8)       (the placement fills whole codewords; 0 or 4 modules are left over)
 *   - the numeric capacity column of the B-SV4 specification (page 86) equals 2 x data codewords up to 104x104
 *   - the ecc codewords split evenly over the Reed-Solomon blocks, each block length fits GF(256)
 * Each entry: { side, region (data region side), regions (per side: 1, 2, 4 or 6), data (data codewords), ecc (error correction
 * codewords of the whole symbol), blocks (interleaved Reed-Solomon blocks) }. Rectangular symbols (8x18, 8x32, 12x26, 12x36, 16x36,
 * 16x48) are not supported.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.datamatrix = PB.slices.datamatrix || {};

  /** [side, data region side, regions per side, data codewords, ecc codewords, blocks] */
  const ROWS = [
    [10, 8, 1, 3, 5, 1], [12, 10, 1, 5, 7, 1], [14, 12, 1, 8, 10, 1], [16, 14, 1, 12, 12, 1], [18, 16, 1, 18, 14, 1],
    [20, 18, 1, 22, 18, 1], [22, 20, 1, 30, 20, 1], [24, 22, 1, 36, 24, 1], [26, 24, 1, 44, 28, 1],
    [32, 14, 2, 62, 36, 1], [36, 16, 2, 86, 42, 1], [40, 18, 2, 114, 48, 1], [44, 20, 2, 144, 56, 1], [48, 22, 2, 174, 68, 1],
    [52, 24, 2, 204, 84, 2], [64, 14, 4, 280, 112, 2], [72, 16, 4, 368, 144, 4], [80, 18, 4, 456, 192, 4], [88, 20, 4, 576, 224, 4],
    [96, 22, 4, 696, 272, 4], [104, 24, 4, 816, 336, 6], [120, 18, 6, 1050, 408, 6], [132, 20, 6, 1304, 496, 8], [144, 22, 6, 1558, 620, 10],
  ];

  PB.slices.datamatrix.sizes = Object.freeze(ROWS.map(([side, region, regions, data, ecc, blocks]) => Object.freeze({ side, region, regions, data, ecc, blocks })));
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
