const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// Data Matrix ECC200 encoder (ASCII encodation, square symbols). The ISO/IEC 16022 standard is NOT available, so the tables of the
// encoder were typed from memory and are proven here by PROPERTIES instead of by comparison with the standard:
//   - the capacity column against the B-SV4 specification table (typed below, independent of the encoder's table);
//   - data + ecc codewords = floor(data region modules / 8) for every size (the placement fills whole codewords);
//   - the Reed-Solomon syndromes (own GF(256) arithmetic, shift-and-reduce, no tables) vanish for every block of every size;
//   - the placement assigns every bit of every codeword exactly once;
//   - an independent decoder (own placement written annex F style, own GF) reads back what the encoder wrote.
// What these cannot prove: that the bit ORDER inside a corner pattern / utah shape matches the standard (a swapped pair of modules
// stays a bijection). That needs a real scanner: see the report of task D1.
const PB = loadUpTo('js/components/datamatrix/matrix.js');
const dm = PB.datamatrix;

// ---------------------------------------------------------------------------------------------------------------------------
// Typed independently of js/components/datamatrix/sizes.js

/** Square sizes of the task: side -> [data region side, regions per side, data codewords, ecc codewords, RS blocks]. */
const EXPECTED = {
  10: [8, 1, 3, 5, 1], 12: [10, 1, 5, 7, 1], 14: [12, 1, 8, 10, 1], 16: [14, 1, 12, 12, 1], 18: [16, 1, 18, 14, 1],
  20: [18, 1, 22, 18, 1], 22: [20, 1, 30, 20, 1], 24: [22, 1, 36, 24, 1], 26: [24, 1, 44, 28, 1],
  32: [14, 2, 62, 36, 1], 36: [16, 2, 86, 42, 1], 40: [18, 2, 114, 48, 1], 44: [20, 2, 144, 56, 1], 48: [22, 2, 174, 68, 1],
  52: [24, 2, 204, 84, 2], 64: [14, 4, 280, 112, 2], 72: [16, 4, 368, 144, 4], 80: [18, 4, 456, 192, 4], 88: [20, 4, 576, 224, 4],
  96: [22, 4, 696, 272, 4], 104: [24, 4, 816, 336, 6], 120: [18, 6, 1050, 408, 6], 132: [20, 6, 1304, 496, 8], 144: [22, 6, 1558, 620, 10],
};
const SIDES = Object.keys(EXPECTED).map(Number);

/** "Numeric capacity" column of the B-SV4 spec (page 86) for the square sizes; 120, 132 and 144 are capped at 2000 digits there. */
const MANUAL_NUMERIC = {
  10: 6, 12: 10, 14: 16, 16: 24, 18: 36, 20: 44, 22: 60, 24: 72, 26: 88, 32: 124, 36: 172, 40: 228, 44: 288, 48: 348, 52: 408,
  64: 560, 72: 736, 80: 912, 88: 1152, 96: 1392, 104: 1632, 120: 2000, 132: 2000, 144: 2000,
};

// ---------------------------------------------------------------------------------------------------------------------------
// Deterministic pseudo random data

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const randomCodewords = (n, seed) => { const r = rng(seed); return Array.from({ length: n }, () => Math.floor(r() * 256)); };

// ---------------------------------------------------------------------------------------------------------------------------
// Independent GF(256), primitive polynomial 0x12D (x^8 + x^5 + x^3 + x^2 + 1), shift-and-reduce (no log tables)

function gfMul(a, b) {
  let product = 0;
  while (b) {
    if (b & 1) product ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x12D;
    b >>= 1;
  }
  return product;
}
const alphaPow = n => { let v = 1; for (let i = 0; i < n; i++) v = gfMul(v, 2); return v; };

/** The block's codeword polynomial (first codeword = highest degree) evaluated at alpha^1..alpha^n. */
function syndromes(block, n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const x = alphaPow(i);
    let acc = 0;
    for (const c of block) acc = gfMul(acc, x) ^ c;
    out.push(acc);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// 1. Tables

test('the size table lists the 24 square sizes of the task, in order, with the typed parameters', () => {
  assert.deepEqual(dm.SIZES.map(s => s.side), SIDES);
  for (const s of dm.SIZES) {
    const [region, regions, data, ecc, blocks] = EXPECTED[s.side];
    assert.deepEqual([s.region, s.regions, s.data, s.ecc, s.blocks], [region, regions, data, ecc, blocks], `size ${s.side}`);
  }
});

test('table property: side = regions per side x (data region + 2) and the dimensions grow', () => {
  for (const s of dm.SIZES) assert.equal(s.side, s.regions * (s.region + 2), `size ${s.side}`);
  for (let i = 1; i < dm.SIZES.length; i++) {
    assert.ok(dm.SIZES[i].side > dm.SIZES[i - 1].side && dm.SIZES[i].data > dm.SIZES[i - 1].data, `size ${dm.SIZES[i].side} grows`);
  }
});

test('table property: data + ecc codewords = floor(data region modules / 8) (the leftover modules are the fill pattern)', () => {
  for (const s of dm.SIZES) {
    const modules = (s.regions * s.region) ** 2;
    assert.equal(s.data + s.ecc, Math.floor(modules / 8), `size ${s.side}`);
    assert.ok([0, 4].includes(modules % 8), `size ${s.side} leaves 0 or 4 modules`);
  }
});

test('table property: the ecc codewords split evenly over the blocks and each block fits GF(256)', () => {
  const PER_BLOCK = [5, 7, 10, 12, 14, 18, 20, 24, 28, 36, 42, 48, 56, 62, 68];
  for (const s of dm.SIZES) {
    assert.equal(s.ecc % s.blocks, 0, `size ${s.side} ecc split`);
    assert.ok(PER_BLOCK.includes(s.ecc / s.blocks), `size ${s.side}: ${s.ecc / s.blocks} ecc per block`);
    assert.ok(Math.ceil(s.data / s.blocks) + s.ecc / s.blocks <= 255, `size ${s.side} block length`);
  }
});

test('capacity agrees with the manual: numeric capacity = 2 x data codewords (capped at 2000 digits by the printer)', () => {
  for (const s of dm.SIZES) assert.equal(Math.min(2000, 2 * s.data), MANUAL_NUMERIC[s.side], `size ${s.side}`);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 2. ASCII encodation (digit pairs 130 + value, others ASCII + 1, upper shift 235 for 128..255)

test('digit pairs become 130 + value (1234 -> 142, 164)', () => {
  assert.deepEqual(dm.ascii('1234').codewords, [130 + 12, 130 + 34]);
  assert.deepEqual(dm.ascii('1234').codewords, [142, 164]);
  assert.deepEqual(dm.ascii('00').codewords, [130]);
  assert.deepEqual(dm.ascii('99').codewords, [229]);
});

test('other characters are ASCII + 1 and an odd digit stays single', () => {
  assert.deepEqual(dm.ascii('A').codewords, [66]);
  assert.deepEqual(dm.ascii('12345').codewords, [142, 164, 54]); // 12 34 5, a lone 5 is 53 + 1
  assert.deepEqual(dm.ascii('AB12').codewords, [66, 67, 142]);
  assert.deepEqual(dm.ascii('A1').codewords, [66, 50]);
  assert.deepEqual(dm.ascii('1A2').codewords, [50, 66, 51]); // no pair across a letter
  assert.deepEqual(dm.ascii('12A34').codewords, [142, 66, 164]);
  assert.deepEqual(dm.ascii('\n\u007f').codewords, [11, 128]);
});

test('extended ASCII 128..255 uses the upper shift (235) and the code minus 127', () => {
  assert.deepEqual(dm.ascii('é').codewords, [235, 233 - 127]);
  assert.deepEqual(dm.ascii('aÿ1').codewords, [98, 235, 128, 50]);
});

test('characters above 255 are reported, not encoded', () => {
  const out = dm.ascii('a€');
  assert.equal(out.ok, false);
  assert.deepEqual(out.unsupported, ['€']);
  assert.equal(dm.ascii('abc').ok, true);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 3. Pad codewords

test('known pad example: A in 10x10 is [66, 129, 70]', () => {
  // 'A' -> 65 + 1 = 66. The first pad is always 129. The next pad (position 3, 1-based) is randomised with the 253-state algorithm:
  //   R = ((149 * 3) mod 253) + 1 = (447 - 253) + 1 = 195;  129 + 195 = 324;  324 > 254 -> 324 - 254 = 70.
  assert.deepEqual(dm.pad([66], 3), [66, 129, 70]);
  assert.deepEqual(dm.stream('A', dm.SIZES[0]).data, [66, 129, 70]);
});

test('later pad codewords follow the same formula (hand computed)', () => {
  // position 4: R = (596 mod 253) + 1 = 90 + 1 = 91 -> 129 + 91 = 220
  // position 5: R = (745 mod 253) + 1 = 239 + 1 = 240 -> 129 + 240 = 369 -> 369 - 254 = 115
  assert.deepEqual(dm.pad([66], 5), [66, 129, 70, 220, 115]);
  assert.deepEqual(dm.pad([66, 67, 68], 3), [66, 67, 68], 'a full symbol gets no pad');
  const padded = dm.pad([], 40);
  assert.equal(padded[0], 129);
  assert.ok(padded.every((c, i) => (i === 0 ? c === 129 : c >= 1 && c <= 254 && c !== 129)), 'only the first pad is 129; the others are 1..254');
});

// ---------------------------------------------------------------------------------------------------------------------------
// 4. Reed-Solomon

test('generator polynomials are monic with roots alpha^1..alpha^n', () => {
  for (const n of [5, 7, 10, 12, 14, 18, 20, 24, 28, 36, 42, 48, 56, 62, 68]) {
    const g = [1, ...dm.rs.generator(n)]; // leading coefficient + the n stored ones, highest degree first
    assert.equal(g.length, n + 1);
    for (let i = 1; i <= n; i++) {
      const x = alphaPow(i);
      let acc = 0;
      for (const c of g) acc = gfMul(acc, x) ^ c;
      assert.equal(acc, 0, `g_${n}(alpha^${i})`);
    }
  }
});

test('the worked example 123456 in 10x10 has data 142 164 186 and ecc 114 25 5 88 102', () => {
  // Remembered from the worked example of ISO/IEC 16022 (also in the public Data Matrix tutorials); a match is strong evidence for the
  // data encodation, the primitive polynomial and the generator (a wrong root or polynomial changes all five values).
  const s = dm.stream('123456', dm.SIZES[0]);
  assert.deepEqual(s.data, [142, 164, 186]);
  assert.deepEqual(dm.rs.encode([142, 164, 186], 5), [114, 25, 5, 88, 102]);
  assert.deepEqual(s.stream, [142, 164, 186, 114, 25, 5, 88, 102]);
});

test('Reed-Solomon property: every block of every size has zero syndromes at alpha^1..alpha^n', () => {
  for (const s of dm.SIZES) {
    const { blocks } = dm.stream('', s, { codewords: randomCodewords(s.data, s.side) });
    assert.equal(blocks.length, s.blocks);
    for (const [i, block] of blocks.entries()) {
      assert.equal(block.ecc.length, s.ecc / s.blocks);
      assert.ok(syndromes([...block.data, ...block.ecc], block.ecc.length).every(v => v === 0), `size ${s.side} block ${i}`);
    }
  }
});

test('flipping one codeword of a block breaks the syndromes (any position, any size)', () => {
  for (const s of dm.SIZES) {
    const { blocks } = dm.stream('', s, { codewords: randomCodewords(s.data, 1000 + s.side) });
    const word = [...blocks[0].data, ...blocks[0].ecc];
    for (const at of [0, Math.floor(word.length / 2), word.length - 1]) {
      const broken = [...word];
      broken[at] ^= 0x5A;
      assert.ok(syndromes(broken, blocks[0].ecc.length).some(v => v !== 0), `size ${s.side} flip at ${at}`);
    }
  }
});

test('interleaving: codeword i of the data goes to block i mod blocks, ecc k of block b to data + k x blocks + b', () => {
  const s = dm.SIZES.at(-1); // 144x144: 10 blocks, the first 8 hold 156 data codewords and the last 2 hold 155
  const data = randomCodewords(s.data, 7);
  const out = dm.stream('', s, { codewords: data });
  assert.deepEqual(out.blocks.map(b => b.data.length), [156, 156, 156, 156, 156, 156, 156, 156, 155, 155]);
  assert.equal(out.stream.length, s.data + s.ecc);
  assert.deepEqual(out.stream.slice(0, s.data), data, 'data codewords stay in order in the stream');
  out.blocks.forEach((block, b) => {
    block.data.forEach((word, k) => assert.equal(data[k * s.blocks + b], word, `data of block ${b}`));
    block.ecc.forEach((word, k) => assert.equal(out.stream[s.data + k * s.blocks + b], word, `ecc of block ${b}`));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// 5. Placement

test('placement property: every bit of every codeword is placed exactly once, nothing else is left but the fill pattern', () => {
  for (const s of dm.SIZES) {
    const n = s.regions * s.region;
    const cells = dm.place(n);
    assert.equal(cells.length, n * n);
    const total = (s.data + s.ecc) * 8;
    const seen = new Set();
    let free = 0;
    const fixed = [];
    cells.forEach((v, i) => {
      if (v >= 0) {
        assert.ok(v < total, `size ${s.side}: bit ${v} out of range`);
        assert.ok(!seen.has(v), `size ${s.side}: bit ${v} placed twice`);
        seen.add(v);
      } else if (v === dm.PLACE_UNUSED) free++;
      else fixed.push(i);
    });
    assert.equal(seen.size, total, `size ${s.side}: all ${total} bits placed`);
    assert.equal(free + fixed.length, n * n - total, `size ${s.side}: leftover modules`);
    if (n * n === total) {
      assert.deepEqual([free, fixed], [0, []], `size ${s.side}: no fill pattern`);
    } else {
      // The four leftover modules are the bottom right 2x2: the diagonal is dark, the other two light
      assert.deepEqual(fixed, [(n - 2) * n + n - 2, (n - 1) * n + n - 1], `size ${s.side}: fixed dark diagonal`);
      assert.equal(free, 2, `size ${s.side}: two light leftovers`);
      assert.equal(cells[(n - 2) * n + n - 1], dm.PLACE_UNUSED);
      assert.equal(cells[(n - 1) * n + n - 2], dm.PLACE_UNUSED);
    }
  }
});

test('placement of the 10x10 symbol: codeword 1 is the first utah shape at row 4, col 0 (hand traced)', () => {
  // Mapping matrix 8x8. The first utah shape has its bit 8 at (row 4, col 0); the modules above and to the left wrap with the
  // standard's rule (col < 0: col += ncol and row += 4 - ((ncol + 4) mod 8)); here ncol = 8 so the row stays and col -2 -> 6, -1 -> 7.
  // Bit b of codeword 1 is cell index b - 1 (bit 1 = most significant).
  const cells = dm.place(8);
  const at = (r, c) => cells[r * 8 + c];
  assert.equal(at(2, 6), 0, 'bit 1 = (row-2, col-2) wraps to the right edge');
  assert.equal(at(2, 7), 1, 'bit 2 = (row-2, col-1)');
  assert.equal(at(3, 6), 2, 'bit 3 = (row-1, col-2)');
  assert.equal(at(3, 7), 3, 'bit 4 = (row-1, col-1)');
  assert.equal(at(3, 0), 4, 'bit 5 = (row-1, col)');
  assert.equal(at(4, 6), 5, 'bit 6 = (row, col-2)');
  assert.equal(at(4, 7), 6, 'bit 7 = (row, col-1)');
  assert.equal(at(4, 0), 7, 'bit 8 = (row, col)');
});

// ---------------------------------------------------------------------------------------------------------------------------
// 6. Symbol structure

test('structure: dimensions, finder (solid L), clock tracks and region count for every size', () => {
  for (const s of dm.SIZES) {
    const out = dm.encode('A'.repeat(s.data), { size: s.side });
    assert.equal(out.ok, true, `size ${s.side}`);
    assert.equal(out.side, s.side);
    const step = s.region + 2; // every region is its data plus a one module wide L and clock
    assert.equal((s.side / step) ** 2, s.regions ** 2, `size ${s.side}: regions`);
    for (let r = 0; r < s.side; r++) {
      for (let c = 0; c < s.side; c++) {
        const [rr, cc] = [r % step, c % step];
        // Every region has its own L (left column and bottom row solid) and clock (top row and right column alternating); the step is
        // even, so the alternation of each region is the global parity: top row dark on even columns, right column dark on odd rows.
        if (cc === 0) assert.equal(out.isDark(r, c), true, `size ${s.side}: left solid (${r},${c})`);
        else if (rr === step - 1) assert.equal(out.isDark(r, c), true, `size ${s.side}: bottom solid (${r},${c})`);
        else if (rr === 0) assert.equal(out.isDark(r, c), c % 2 === 0, `size ${s.side}: top clock (${r},${c})`);
        else if (cc === step - 1) assert.equal(out.isDark(r, c), r % 2 === 1, `size ${s.side}: right clock (${r},${c})`);
      }
    }
    assert.equal(out.isDark(0, 0), true, 'top left is dark');
    assert.equal(out.isDark(0, s.side - 1), false, 'top right is light');
    assert.equal(out.isDark(s.side - 1, s.side - 1), true, 'bottom right is dark');
  }
});

test('structure: the 10x10 symbol of A matches the finder and clock drawn by hand', () => {
  const out = dm.encode('A');
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let line = '';
    for (let c = 0; c < 10; c++) line += out.isDark(r, c) ? '#' : '.';
    rows.push(line);
  }
  assert.equal(rows[0], '#.#.#.#.#.');
  assert.equal(rows[9], '##########');
  assert.equal(rows.map(l => l[0]).join(''), '##########');
  assert.equal(rows.map(l => l[9]).join(''), '.#.#.#.#.#');
});

test('isDark is false outside the symbol', () => {
  const out = dm.encode('A');
  assert.equal(out.isDark(-1, 0), false);
  assert.equal(out.isDark(0, 10), false);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 7. Size selection

test('capacity boundaries: the largest payload of each size picks that size, one more character picks the next', () => {
  dm.SIZES.forEach((s, i) => {
    const fits = dm.encode('A'.repeat(s.data));
    assert.equal(fits.side, s.side, `${s.data} characters fit ${s.side}`);
    assert.deepEqual(fits.codewords.slice(0, 3), [66, 66, 66]);
    if (i + 1 < dm.SIZES.length) assert.equal(dm.encode('A'.repeat(s.data + 1)).side, dm.SIZES[i + 1].side, `${s.data + 1} characters need the next size`);
    // digits compact two per codeword
    assert.equal(dm.encode('7'.repeat(2 * s.data)).side, s.side, `${2 * s.data} digits fit ${s.side}`);
    if (i + 1 < dm.SIZES.length) assert.equal(dm.encode('7'.repeat(2 * s.data + 1)).side, dm.SIZES[i + 1].side);
  });
});

test('too much data is refused with a reason', () => {
  const out = dm.encode('A'.repeat(1559));
  assert.deepEqual([out.ok, out.reason], [false, 'long']);
  assert.equal(dm.encode('A'.repeat(1558)).side, 144);
});

test('empty data, characters above 255 and unknown forced sizes are refused with a reason', () => {
  assert.deepEqual([dm.encode('').ok, dm.encode('').reason], [false, 'empty']);
  assert.deepEqual([dm.encode('€').ok, dm.encode('€').reason], [false, 'unsupported']);
  assert.deepEqual([dm.encode('A', { size: 11 }).ok, dm.encode('A', { size: 11 }).reason], [false, 'size']);
  assert.deepEqual([dm.encode('A'.repeat(4), { size: 10 }).ok, dm.encode('A'.repeat(4), { size: 10 }).reason], [false, 'size']);
});

test('a forced size larger than needed pads the symbol', () => {
  const out = dm.encode('A', { size: 26 });
  assert.equal(out.side, 26);
  assert.deepEqual(out.codewords.slice(0, 3), [66, 129, 70]);
  assert.equal(out.codewords.length, 44 + 28);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 8. End to end with an independent decoder

/** Annex F style placement written for this test only: an int array of chr * 10 + bit (chr 1-based, bit 1..8), 0 = free. */
function annexF(nrow, ncol) {
  const array = new Array(nrow * ncol).fill(0);
  const put = (row, col, chr, bit) => {
    if (row < 0) { row += nrow; col += 4 - ((nrow + 4) % 8); }
    if (col < 0) { col += ncol; row += 4 - ((ncol + 4) % 8); }
    array[row * ncol + col] = chr * 10 + bit;
  };
  const utah = (row, col, chr) => {
    put(row - 2, col - 2, chr, 1); put(row - 2, col - 1, chr, 2);
    put(row - 1, col - 2, chr, 3); put(row - 1, col - 1, chr, 4); put(row - 1, col, chr, 5);
    put(row, col - 2, chr, 6); put(row, col - 1, chr, 7); put(row, col, chr, 8);
  };
  const corner1 = chr => { put(nrow - 1, 0, chr, 1); put(nrow - 1, 1, chr, 2); put(nrow - 1, 2, chr, 3); put(0, ncol - 2, chr, 4); put(0, ncol - 1, chr, 5); put(1, ncol - 1, chr, 6); put(2, ncol - 1, chr, 7); put(3, ncol - 1, chr, 8); };
  const corner2 = chr => { put(nrow - 3, 0, chr, 1); put(nrow - 2, 0, chr, 2); put(nrow - 1, 0, chr, 3); put(0, ncol - 4, chr, 4); put(0, ncol - 3, chr, 5); put(0, ncol - 2, chr, 6); put(0, ncol - 1, chr, 7); put(1, ncol - 1, chr, 8); };
  const corner3 = chr => { put(nrow - 3, 0, chr, 1); put(nrow - 2, 0, chr, 2); put(nrow - 1, 0, chr, 3); put(0, ncol - 2, chr, 4); put(0, ncol - 1, chr, 5); put(1, ncol - 1, chr, 6); put(2, ncol - 1, chr, 7); put(3, ncol - 1, chr, 8); };
  const corner4 = chr => { put(nrow - 1, 0, chr, 1); put(nrow - 1, ncol - 1, chr, 2); put(0, ncol - 3, chr, 3); put(0, ncol - 2, chr, 4); put(0, ncol - 1, chr, 5); put(1, ncol - 3, chr, 6); put(1, ncol - 2, chr, 7); put(1, ncol - 1, chr, 8); };
  let chr = 1;
  let row = 4;
  let col = 0;
  do {
    if (row === nrow && col === 0) corner1(chr++);
    if (row === nrow - 2 && col === 0 && ncol % 4) corner2(chr++);
    if (row === nrow - 2 && col === 0 && ncol % 8 === 4) corner3(chr++);
    if (row === nrow + 4 && col === 2 && !(ncol % 8)) corner4(chr++);
    do {
      if (row < nrow && col >= 0 && !array[row * ncol + col]) utah(row, col, chr++);
      row -= 2; col += 2;
    } while (row >= 0 && col < ncol);
    row += 1; col += 3;
    do {
      if (row >= 0 && col < ncol && !array[row * ncol + col]) utah(row, col, chr++);
      row += 2; col -= 2;
    } while (row < nrow && col >= 0);
    row += 3; col += 1;
  } while (row < nrow || col < ncol);
  return array;
}

/** Reads a symbol (isDark) back to its ASCII text: strips the regions' finder and clock, reads the codewords, checks Reed-Solomon. */
function decode(symbol) {
  const { side, isDark } = symbol;
  const size = dm.SIZES.find(s => s.side === side);
  assert.ok(size, `a size with side ${side}`);
  const n = size.regions * size.region;
  const step = size.region + 2;
  // mapping matrix <- the data cells of every region
  const mapping = new Array(n * n).fill(false);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const [R, C] = [Math.floor(r / size.region) * step + 1 + (r % size.region), Math.floor(c / size.region) * step + 1 + (c % size.region)];
      mapping[r * n + c] = isDark(R, C);
    }
  }
  // Inverse mapping: which (chr, bit) sits in each module, then the codewords from the bits
  const array = annexF(n, n);
  const total = size.data + size.ecc;
  const words = new Array(total).fill(0);
  array.forEach((tag, i) => {
    if (!tag) return;
    const [chr, bit] = [Math.floor(tag / 10), tag % 10];
    if (mapping[i]) words[chr - 1] |= 1 << (8 - bit);
  });
  assert.equal(Math.max(0, ...array.map(t => Math.floor(t / 10))), total, 'the placement numbers exactly the codewords of the size');
  // de-interleave and verify every block
  const blocks = Array.from({ length: size.blocks }, () => ({ data: [], ecc: [] }));
  for (let i = 0; i < size.data; i++) blocks[i % size.blocks].data.push(words[i]);
  for (let i = 0; i < size.ecc; i++) blocks[i % size.blocks].ecc.push(words[size.data + i]);
  for (const b of blocks) assert.ok(syndromes([...b.data, ...b.ecc], b.ecc.length).every(v => v === 0), 'Reed-Solomon of the decoded block');
  // ASCII decode: stop at the first pad
  const data = words.slice(0, size.data);
  let text = '';
  for (let i = 0; i < data.length; i++) {
    const cw = data[i];
    if (cw === 129) break;
    if (cw >= 1 && cw <= 128) text += String.fromCharCode(cw - 1);
    else if (cw >= 130 && cw <= 229) text += String(cw - 130).padStart(2, '0');
    else if (cw === 235) text += String.fromCharCode(data[++i] + 127);
    else assert.fail(`codeword ${cw} is outside the ASCII encodation`);
  }
  return text;
}

function randomText(length, seed, alphabet) {
  const r = rng(seed);
  return Array.from({ length }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
}
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -./:';
const DIGITS = '0123456789';
const FULL = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join('');

test('round trip: random strings of many lengths survive encode -> placement read back -> Reed-Solomon -> decode', () => {
  const lengths = [1, 2, 3, 4, 5, 6, 7, 10, 13, 20, 33, 50, 99, 150, 321, 700, 1000, 1500, 1558];
  let seed = 1;
  for (const length of lengths) {
    for (const alphabet of [ALNUM, DIGITS, FULL]) {
      const text = randomText(length, seed++, alphabet);
      const out = dm.encode(text);
      if (!out.ok) { assert.equal(out.reason, 'long', `length ${length} refuses only for size`); continue; }
      assert.equal(decode(out), text, `length ${length}`);
    }
  }
});

test('round trip: a string that exactly fills every size, and the same one in a larger forced size', () => {
  for (const [i, s] of dm.SIZES.entries()) {
    const text = randomText(s.data, 5000 + i, ALNUM.replace(/[0-9]/g, ''));
    const out = dm.encode(text);
    assert.equal(out.side, s.side);
    assert.equal(decode(out), text, `size ${s.side}`);
    const bigger = dm.SIZES[Math.min(dm.SIZES.length - 1, i + 1)];
    assert.equal(decode(dm.encode(text, { size: bigger.side })), text, `forced ${bigger.side}`);
  }
});

test('round trip: the worked examples', () => {
  for (const text of ['A', '123456', 'PrintBridge', 'https://example.com/a?b=c', '0123456789012345678901234567890123456789']) {
    assert.equal(decode(dm.encode(text)), text);
  }
});
