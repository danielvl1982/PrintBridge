# zpl-support

Delivery strategy: ask-on-risk; the forecast is far over 400 authored lines, so the work is delivered as four feature branches merged to `main` one after the other (stacked-to-main), one commit per task, each branch tested and merged on the user's OK. Planning forecast: ~8000 authored lines in 4 groups.

## Objective
Add Zebra ZPL II as the third printer language and give it everything TPCL and TSPL have now: read and draw, write (emit), move, edit
properties (including the content, font, counters and test values), palette insertion, image insertion with rotation, the barcode selector,
and conversion to and from TPCL and TSPL ("Convertir a…"). Reference: `docs/zpl/Zebra_ZPL-II_programming-guide-vol-1_2003.pdf` (local, git-ignored).

## Decisions
- Same exclusions as before: PDF417 / MicroPDF417 (`^B7`, `^BF`), MaxiCode (`^BD`), the text block (`^FB`) and the other out-of-scope symbologies; everything else
  valued for TPCL/TSPL is in.
- The ZPL support follows the existing architecture: a language registered in the registry (detect/parse/emit/...), and one `zpl` factory per component slice
  (`languages: { tpcl, tspl, zpl }`), the shared composeSlices and emit drivers, the neutral model and the data-driven selectors.
- Unverified formats: anything the 2003 guide (Volume One) does not document is marked "not verified on a printer" in code comments and the README.

## Groups and tasks
### Group A: foundation and text (branch `feat/zpl-foundation`)
- [x] Z1 ZPL language core: tokenizer for `^XX` / `~XX` commands (parameters separated by commas, fields closed by `^FS`, `^XA` .. `^XZ` blocks, `^FX` comments, several labels in a
      file), detection, registration, label size from `^PW` / `^LL` / `^LH` / `^LS`, orientation `^PO`, default font `^CF` and field orientation `^FW`, `^CI`, `^FH`
      escapes, parse errors reported in the existing style, emit skeleton (`^XA` header, `^PW`/`^LL`, `^XZ` trailer), `insertCommand`, `sizeCommands`/`applySize`
      (the Formato row), `.zpl` file extension and encoding, the example label, the converter target list, language detection tests, app wiring of the new language
      (palette hooks, Convertir panel), README stub.
      Done in `ca1e060` (core, engines) and `31764b2` (app wiring, README). Route: inline single writer. The example label is NOT added yet (nothing is drawable until Z2: add it there).
- [x] Z2 Text: `^FO` / `^FT` origin semantics (`^FT` is the baseline origin), `^A` fonts (bitmap A..H, `0` scalable, others per the guide) with height / width, rotation N/R/I/B,
      `^FD` content with `^FH` hex escapes, `^FR` reverse: parse, draw (font simulation like TPCL/TSPL), emit, move, edit (font, size, rotation, content, reverse), palette entry, tests.

### Group B: barcodes and 2D (branch `feat/zpl-barcodes`)
- [x] Z3 Linear barcodes: `^BY` module and ratio, Code 128 (`^BC`), Code 39 (`^B3`), Interleaved 2 of 5 (`^B2`), EAN-13 (`^BE`), EAN-8 (`^B8`), UPC-A (`^BU`), UPC-E (`^B9`),
      Code 93 (`^BA`), Codabar (`^BK`), MSI (`^BM`), Industrial 2 of 5 (`^BI`): parse/emit/edit/move, rotation, height, human-readable, check digit options,
      the data-driven selector rows, palette entry, tests with the encoders already built.
      Done in `bed1c4c` (code, tests, README; one commit because the parse / emit / edit code lives in one slice file). Route: inline single writer.
- [ ] Z4 QR (`^BQ`) and Data Matrix (`^BX`): parse/emit/edit/move/palette, parameters of the guide (QR model, magnification, error correction level, mask; Data Matrix quality
      200, columns/rows, aspect), tests.

### Group C: graphics and images (branch `feat/zpl-graphics`)
- [ ] Z5 Shapes: `^GB` lines and boxes with thickness and corner rounding (0..8), `^GC` circle, `^GE` ellipse, `^GD` diagonal line, `^LR` / `^FR` reverse (the inverted area): parse,
      draw (respecting command order), emit, move, edit, palette entries, tests.
- [ ] Z6 Images: `^GF` graphic field (ASCII hex `A` and compressed/binary variants the guide documents; Z64 only if the guide documents it), `^IM` / `~DG` out of scope unless trivial;
      read, draw, insert from the palette with the image rotation, tests.

### Group D: counters, variables, conversion, docs (branch `feat/zpl-conversion`)
- [ ] Z7 Counters (`^SN` serial number with increment and leading-zero options) and field variables (`^FN` fields and `^DF`/`^XF` stored formats as far as the guide documents; the
      app's `<#NAME#>` test values keep working for ZPL data), tests.
- [ ] Z8 Conversion matrix: TPCL <-> ZPL and TSPL <-> ZPL for every component with the fidelity warnings in the existing style, round-trip tests, the "Convertir a…" panel with
      three targets, cross-conversion tests.
- [ ] Z9 Documentation and closing: README (ZPL section, command table, limitations, conversion losses), CONTRIBUTING if it lists languages, the Chrome pass over every ZPL feature.

## Route declaration
Delegated direct, one writer per task (multi-file each, sequential), read-only exploration folded into each writer's brief. Native review per work-unit commit group as the repository switch asks.

## Acceptance
Each task round-trips parse -> emit -> parse, keeps unrelated commands untouched on edit, reports unsupported conversions with a warning, and keeps `node --test` green.

## Verification
`node --test` after each task. Chrome check by the assistant after each group (puppeteer-core outside the repo); user checks with real labels and a Zebra printer when available.

## Progress
Manual renamed to `docs/zpl/Zebra_ZPL-II_programming-guide-vol-1_2003.pdf` and documented in `docs/README.md`. Plan created. Z1 done on `feat/zpl-foundation` (`ca1e060`, `31764b2`; `node --test` 1351 green, 92 new). Z2 done (`08698aa` code and tests, `a954bde` README; `node --test` 1389 green, 38 new in tests/zpl-text.test.js, RED observed first). Next: Chrome check of the ZPL text and example, then merge group A.
Z3 done on `feat/zpl-barcodes` (`bed1c4c`; `node --test` 1531 green, 142 new in tests/zpl-barcodes.test.js, RED observed first: 137 of 139 failed before the implementation, the 2 that passed were vacuous and were tightened). The 2003 guide documents the parameter layouts, the `^FT` base-of-the-bars origin, the Code 128 invocation codes (Table G, an image in the PDF) and `^BY` (initial module 2 and height 10, Table J of ratios); it does NOT give the default ratio (3.0 assumed), the `^FO` box of rotated bars (bars only assumed), the font of the line, or the exact rounding of the wide bar. Engine additions: `custom` descriptor fields and `argEdit` in zpl-edit.js, `byValues` shared with the barcode slice; the ITF encoder got the modulus 10 check (`check: auto`), render.js got `measure`.

## Result of group A
ZPL reads, draws, emits, edits and conversions of text work: `^FO` / `^FT` origins, `^A` fonts (bitmapped A..H as multiples of the matrix, scalable `0`), `^CF` / `^FW` defaults, `^FH` escapes, `^FR` reverse (white text blended with difference), Propiedades fields (font, height, width, rotation, content, reverse), the Texto palette entry and one ZPL example. Not in the 2003 Volume One (so unverified, marked in code and README): the font matrices (Volume Two), the baseline of `^FO` and the length of rotated `^FO` text. Engine additions: `flag` fields (presence of `^FR`) and fields sharing one argument. Pending: browser check of the reverse blend and the example.
