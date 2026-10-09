# ZPL II Programming Guide Volume Two applied to ZPL support

Branch: `feat/zpl-vol2`. Strategy: single PR, `ask-on-risk`. Manual (local, git-ignored): `docs/zpl/Zebra_ZPL-II_programming-guide-vol-2_2005.pdf`.

## Objective
Resolve the ZPL points left "not verified" for lack of Volume Two: the font matrices (per printhead resolution), the fonts missing from
the code, and the image compression, and re-check the other open items against the new manual.

## Findings so far (parent)
- 203 dpi matrices in `js/components/text/zpl.js` BITMAP_FONTS match the manual (A 9x5, B 11x7 (manual prints 11 x 17, a typo), C/D 18x10, E 28x15, F 26x13, G 60x40, H 21x13).
- 300 dpi differs: E is 42x20 and H is 34x22 (manual p. 65); the code uses one table for both resolutions.
- Missing fonts: GS 24x24, P 20x18, Q 28x24, R 35x31, S 40x35, T 48x42, U 59x53, V 80x71 (203 dpi).

Verified by the writer: the text extraction of the font tables is garbled (columns shifted by a row); the page images (printed pages 61, 64, 65) are consistent and
Table 10 (page 61) gives the gap and the baseline. P is a letter font (U-L-D), not a symbol font: only GS is SYMBOL. V is 80x71 at 300 dpi too (not scalable).

## Tasks
- [x] V1 Font matrices by resolution (203 / 300) and the missing fonts, with the inter-character gap derived from the manual's chars/inch
      where it gives it (otherwise keep the current gap and say so); fonts P..V offered in the Propiedades font select (GS not offered: symbol font); tests, README.
- [x] V2 Image compression of `^GF` / `~DG` (Volume Two "Alternative Data Compression Scheme" and ZB64): compare with what the parser and
      the emitter do; decide with evidence what the emitter may write; fix gaps; tests, README.
- [x] V3 Re-check against Volume Two the other open items of `odd/tasks/zpl-support.md` / README "not verified": record what the manual
      settles and what it does not (no guessing).
- [x] V4 Docs: README, `odd/tasks/zpl-support.md` open points, this document.

## Acceptance
`node --test` green; every changed constant cites the manual page in a comment; open items that stay unverified are listed.

## Progress
- V1 `8e3b186`: 203 / 300 dpi tables (`fontsOf(dpi)`), fonts P..V, gaps of Table 10, baseline of `^FO` text from Table 10 (font 0: 3/4), `tests/zpl-fonts.test.js` (10 new, RED first: 9 of 10 failed), the select lists P..V; `tests/zpl-text.test.js` and one pinned TSPL conversion updated (ascent 0.8 -> 0.75 for font 0).
- V2 `7346af2`: the parser already decoded the whole scheme; tests with the manual's examples (M6, hB, MvB / vMB, every count letter, `,` `!` `:`); B64 read (CRC not checked, one info); Z64 stays unsupported; the emitter keeps the comma only by default.
- V3 `d15d07c` (`^A` without sizes uses the `^CF` sizes when the `^CF` gave them, page 63) and `4122ecb` (`^FA` recognised; tests with exercises 5 and 6 and the Mod 10 / Mod 43 examples).
- V4: README (fonts table, compression, not verified list), `odd/tasks/zpl-support.md` ("Volume Two follow-up"), this document.
- `node --test`: 3546 green (3524 before; 22 new).
- Open for the user: TSPL baseline share (0.8) vs ZPL (0.75 / per font); Mod 10 of an even-length ITF; simulating `^DF` / `^XF` recall in one file; Z64 (needs inflate + CRC algorithm).
