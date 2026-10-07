# TSPL parser (TSC TTP)

## Objective
Open and draw TSPL/TSPL2 labels (TSC TTP printers) in the viewer: paste or load a TSPL file, auto-detect the language, and render it from the neutral model, with source spans so selection, drag and the properties panel keep working where the language supports them. Parser first; emitter/conversion is a later feature. ZPL is deferred by the user (other tools already cover it).

## Why
The user's TEC SV4T is TPCL (already supported). TSC TTP uses TSPL and is the next printer family to support. No Interpreter pattern is needed: a tokenizer + per-command handler table + `ctx` already works (see Engram `odd/vertical-slice-refactor/tasks`); each language adds one file per component under `js/components/<kind>/tspl.js`.

## Verified syntax (TSC TSPL/TSPL2 Programming Manual v3.0, printed page numbers)
- Lines end CRLF, params comma-separated, strings in double quotes, `\["]` escapes a quote.
- `SIZE m[,n]` inches by default; `SIZE 100 mm,60 mm` / `SIZE 800 dot,480 dot` (space before unit). 203 dpi = 8 dots/mm, 300 dpi = 12, 600 dpi = 24 (p.1). All drawing coordinates are dots.
- `GAP m,n`, `BLINE m,n`, `OFFSET`, `SHIFT [x,]y`, `REFERENCE x,y` (dots), `DIRECTION n[,m]` (1 = origin top-left, X right, Y down; 0 = origin opposite corner, printout rotated 180 deg), `CLS`, `PRINT m[,n]`.
- `TEXT x,y,"font",rot,xmul,ymul,[align,]"content"`; rotation clockwise 0/90/180/270; fonts "0" (scalable, mul = points), "1".."8" (8x12, 12x20, 16x24, 24x32, 32x48, 14x19 OCR-B, 21x27 OCR-B, 14x25 OCR-A), "ROMAN.TTF"; also *.EFT/*.FNT emulation fonts (unknown -> fallback + warning).
- `BLOCK x,y,w,h,"font",rot,xmul,ymul,[space,][align,][fit,]"content"`.
- `BAR x,y,w,h` (filled), `BOX x,y,xend,yend,thick[,radius]`, `ELLIPSE`, `CIRCLE x,y,diameter,thick` (x,y top-left of bounding box), `ERASE`, `REVERSE x,y,w,h`.
- `BARCODE x,y,"type",height,hr,rot,narrow,wide,[align,]"content"`: hr 0 none/1 left/2 center/3 right; rotation clockwise; types 128, 128M, EAN128, 25 (ITF), 25C, 39, 39C, 39S, 93, EAN13(+2/+5), EAN8, UPCA, UPCE, CODA, MSI, ITF14, EAN14...; `128M` control codes `!104`, FNC1 = `!102`.
- `QRCODE x,y,ECC,cell,mode,rot,[J#,][M#,][S#,][X#,][L#,]"content"`: ECC L/M/Q/H, cell 1-10, mode A/M (manual-mode data prefixes A, N, B####, K, !), model M1/M2, mask S0-S8. Optional-parameter layout is printed ambiguously in the manual: parse tolerantly by prefix letters.
- `BITMAP x,y,widthBytes,heightDots,mode,<binary>`: mode 0 overwrite/1 OR/2 XOR, bit 0 = black, MSB first; data is raw binary of widthBytes*height bytes (parse by length, not by line). `PUTBMP/PUTPCX` print files stored in the printer: placeholder + warning.
- `SET COUNTER @n step` + `@n="value"` counters; ignore-able commands: DENSITY, SPEED, SET *, CODEPAGE, COUNTRY, FEED, BACKFEED, HOME, FORMFEED, SELFTEST, INITIALPRINTER, END.
- NOT in the manual: dpi per TTP model (so dpi is a user setting, default 203), per-dpi font cell tables, BF2 fonts. Barcode narrow/wide table cells are unclear; use numeric narrow value as module.

## Scope
- New `js/languages/tspl.js` (id `tspl`, name "TSPL (TSC TTP)"), registered with `detect` + `parse`; tolerant tokenizer; `ctx` same shape as TPCL; coordinates dots -> 0.1 mm via `units.dotSize(dpi)`; one source span per command line.
- Per-component slice files `js/components/{text,barcode,qr,line,box,image}/tspl.js`, registered via `languages: { tpcl, tspl }`.
- Generic slice composition helper shared by tpcl.js and tspl.js (no copy of the ALL_* machinery).
- UI/app: remove hardcoded `'tpcl'` fallbacks that would break TSPL (palette, insertCommand, buildComponent), TSPL example label, README.
- Out of scope: emitter / TPCL->TSPL conversion, write-back (move/update/describe/palette build) for TSPL unless trivial, ZPL, DMATRIX/PDF417/ELLIPSE/CIRCLE rendering (warn), counters evaluation.

## Open decisions (default shown)
- `DIRECTION 0`: render with 180 deg flip + info diagnostic (default) vs unsupported warning.
- `BAR` -> neutral `line` item with `rect` and fill; `BOX` -> `line` with `rect` outline thickness; `REVERSE` -> model reverse flag or warning (check neutral model).
- Text font mapping: "1".."5" mono/bitmap-like cells from the manual sizes, "0"/ROMAN sans, OCR fonts mono.

## Constraints
- Classic scripts/IIFE/`PB`, manifest + index.html identical order, tests via `loadUpTo`. Code/comments English, UI strings Spanish. Test-first with `node --test` (baseline 243/243). Planning heuristic ~400 changed lines per task, not a cap.

## Tasks
- [x] T1 Generic slice composition helper (`composeSlices(langId, helpers)`) used by tpcl.js; no behavior change.
- [x] T2 `js/languages/tspl.js` skeleton: detect, tokenizer (quotes, CRLF, BITMAP binary by length), ctx, SIZE/GAP/DIRECTION/REFERENCE/SHIFT, ignored commands, unknown-command warnings, source spans, dpi; registration + tests.
- [ ] T3 text slice `tspl.js`: TEXT and BLOCK (fonts, multipliers, rotation, alignment).
- [ ] T4 barcode slice `tspl.js`: BARCODE (type map, human readable, rotation, module).
- [ ] T5 qr slice `tspl.js`: QRCODE (tolerant optional params, manual-mode prefixes).
- [ ] T6 line/box slice `tspl.js`: BAR, BOX (+ REVERSE/ERASE decision).
- [ ] T7 image slice `tspl.js`: BITMAP (polarity, MSB, modes), PUTBMP/PUTPCX placeholder.
- [ ] T8 App/UI: auto-detect TSPL, remove hardcoded tpcl fallbacks, TSPL example label, README/CONTRIBUTING, browser smoke test (user).

## Acceptance
- Pasting valid TSPL draws the label; unsupported commands show warnings; selecting an item highlights its line; TPCL behavior unchanged (all existing tests pass); TSPL tests cover each command incl. BITMAP binary and quoted strings with commas.

## Routing
- Sequential delegated writers, one per task; native review per work-unit commit (high-risk candidates need consent); whole-branch review exceeds the reviewer budget, so review per commit.

## Progress
- Research done: manual v3.0 read directly (agent report), sample real TSPL files requested from the user.
- T1 done: RED observed (compose.js missing from manifest, test file failed to load), then GREEN; `node --test`: 248/248 pass (243 + 5 new), fail 0. Added `js/components/compose.js` (`PB.composeSlices`, on PB because `PB.components` is frozen), registered in manifest.json and index.html after registry.js; tpcl.js now composes through it with its legacy tables as `base`. Not yet committed.
- T2 done: RED observed (js/languages/tspl.js not in manifest, tests/tspl.test.js failed to load), then GREEN; node --test: 268/268 pass (248 + 20 new), fail 0. Added js/languages/tspl.js (tokenizer with quote-aware args and BITMAP by length, ctx with pos/len/sourceOf/direction/reference/shift, SLICE_HELPERS, setup handlers, ignore list, detect, PB.tspl = { commands, run, createContext, SLICE_HELPERS } for slice tests); registered after tpcl.js in manifest.json and index.html. Decision: DIRECTION 0 is NOT flipped in T2: it stores size.native.direction/mirror and emits an info diagnostic (drawn as DIRECTION 1). Not yet committed.
- Next: T3.
