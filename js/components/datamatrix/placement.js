/**
 * Data Matrix slice: ECC200 module placement, the "Utah" algorithm of ISO/IEC 16022 annex F, written from memory of the
 * standard (published on PB.slices.datamatrix.placement).
 *
 * place(n) fills the n x n mapping matrix (the data regions without their finder / clock, side by side: n = regions per side x
 * data region side) with the bits of the codewords. Result: an Int32Array of n * n entries, row by row:
 *   codeword * 8 + (bit - 1)    bit 1 is the most significant bit of the codeword (codewords are 0-based here, 1-based in the standard)
 *   UNUSED (-1)                 module no codeword reaches (light)
 *   FIXED_DARK (-2)             the fixed pattern of the bottom right corner: when that corner is not reached (12x12, 16x16, 20x20 and
 *                               24x24) its two diagonal modules (n-1, n-1) and (n-2, n-2) are dark, the other two stay light
 * The algorithm walks diagonals starting at row 4, col 0: a codeword is the "utah" shape (a 3 x 3 block missing its top right module):
 *        bit 1 (r-2, c-2)  bit 2 (r-2, c-1)
 *        bit 3 (r-1, c-2)  bit 4 (r-1, c-1)  bit 5 (r-1, c)
 *        bit 6 (r,   c-2)  bit 7 (r,   c-1)  bit 8 (r,   c)
 * Modules that fall outside the matrix wrap: row < 0 -> row += n and col += 4 - ((n + 4) mod 8); col < 0 -> col += n and
 * row += 4 - ((n + 4) mod 8). Four special corner patterns (corner1..4, typed below) take over where a utah shape would be cut by the
 * edge; which one applies follows n mod 4 / n mod 8 as in the standard. The matrices are square here, so rows = cols = n.
 * Verified by properties only (every bit of every codeword placed exactly once, for every size; see the tests): the bit order INSIDE
 * a corner pattern is not provable without the standard or a scanner.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.datamatrix = PB.slices.datamatrix || {};

  const UNUSED = -1;
  const FIXED_DARK = -2;

  function place(n) {
    const cells = new Int32Array(n * n).fill(UNUSED);
    const assigned = new Uint8Array(n * n);

    /** Puts bit `bit` (1..8) of codeword `word` (0-based) at (row, col), wrapping the modules outside the matrix. */
    function module(row, col, word, bit) {
      if (row < 0) { row += n; col += 4 - ((n + 4) % 8); }
      if (col < 0) { col += n; row += 4 - ((n + 4) % 8); }
      cells[row * n + col] = word * 8 + (bit - 1);
      assigned[row * n + col] = 1;
    }
    const utah = (row, col, word) => {
      module(row - 2, col - 2, word, 1); module(row - 2, col - 1, word, 2);
      module(row - 1, col - 2, word, 3); module(row - 1, col - 1, word, 4); module(row - 1, col, word, 5);
      module(row, col - 2, word, 6); module(row, col - 1, word, 7); module(row, col, word, 8);
    };
    const corner1 = word => {
      module(n - 1, 0, word, 1); module(n - 1, 1, word, 2); module(n - 1, 2, word, 3);
      module(0, n - 2, word, 4); module(0, n - 1, word, 5); module(1, n - 1, word, 6); module(2, n - 1, word, 7); module(3, n - 1, word, 8);
    };
    const corner2 = word => {
      module(n - 3, 0, word, 1); module(n - 2, 0, word, 2); module(n - 1, 0, word, 3);
      module(0, n - 4, word, 4); module(0, n - 3, word, 5); module(0, n - 2, word, 6); module(0, n - 1, word, 7); module(1, n - 1, word, 8);
    };
    const corner3 = word => {
      module(n - 3, 0, word, 1); module(n - 2, 0, word, 2); module(n - 1, 0, word, 3);
      module(0, n - 2, word, 4); module(0, n - 1, word, 5); module(1, n - 1, word, 6); module(2, n - 1, word, 7); module(3, n - 1, word, 8);
    };
    const corner4 = word => {
      module(n - 1, 0, word, 1); module(n - 1, n - 1, word, 2);
      module(0, n - 3, word, 3); module(0, n - 2, word, 4); module(0, n - 1, word, 5);
      module(1, n - 3, word, 6); module(1, n - 2, word, 7); module(1, n - 1, word, 8);
    };

    let word = 0;
    let row = 4;
    let col = 0;
    do {
      // The corner cases are checked first, at the start of every sweep
      if (row === n && col === 0) corner1(word++);
      if (row === n - 2 && col === 0 && n % 4 !== 0) corner2(word++);
      if (row === n - 2 && col === 0 && n % 8 === 4) corner3(word++);
      if (row === n + 4 && col === 2 && n % 8 === 0) corner4(word++);
      // Sweep up and to the right
      do {
        if (row < n && col >= 0 && !assigned[row * n + col]) utah(row, col, word++);
        row -= 2;
        col += 2;
      } while (row >= 0 && col < n);
      row += 1;
      col += 3;
      // Sweep down and to the left
      do {
        if (row >= 0 && col < n && !assigned[row * n + col]) utah(row, col, word++);
        row += 2;
        col -= 2;
      } while (row < n && col >= 0);
      row += 3;
      col += 1;
    } while (row < n || col < n);

    // Fixed pattern when the bottom right corner was never reached
    if (!assigned[n * n - 1]) {
      cells[n * n - 1] = FIXED_DARK;
      cells[n * n - n - 2] = FIXED_DARK;
    }
    return cells;
  }

  PB.slices.datamatrix.placement = Object.freeze({ UNUSED, FIXED_DARK, place });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
