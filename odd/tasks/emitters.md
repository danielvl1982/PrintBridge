# Emitters (neutral model -> TPCL / TSPL) and "Convertir a..." panel

## Objective
Generate printer-language text from the neutral model so a label parsed from one language can be exported to the other (TPCL <-> TSPL, e.g. from the user's TEC SV4T to TSC TTP), with fidelity warnings and a UI panel to convert, copy and download. ZPL stays deferred.

## Why
The viewer is read-only and TSPL has no editing yet. An emitter unlocks migration of labels between printer families and is the foundation for later write-back/editing and ZPL. Mapping evidence: Engram `odd/tspl-parser/tasks`, explorer report in this session (inverse of every parse handler).

## Design
- New optional language hook `emit(model, { dpi }) -> { text, diagnostics }` (documented in `js/core/languages.js`), composed per language: the language owns header/trailer, id numbering and ordering; each component slice contributes `emit(item, ctx)` through its `languages.<id>` factory (returns the lines for that item), composed by `PB.composeSlices` (new `emitters` list). Slices pick themselves by `PB.components.forItem(item)`.
- Shared pure helpers (dots conversion at dpi, escaping, id allocation, diagnostics) exposed through each language's SLICE_HELPERS, no duplication.
- Fidelity warnings are diagnostics (level info/warning) returned with the text and shown in the panel.
- Round-trip is the main safety net: parse(emit(parse(x))) equals parse(x) on neutral items (ignoring `source`, `raw`, `native`), within dot-rounding tolerance for cross-language.

## Mapping notes (from the parse handlers, inverted)
- Size/header: TPCL `{D<pitch>,<w>,<h>|}` (0.1 mm, reuse `size.native.dRaw/axRaw` when source is TPCL; AX from catalog `native.tpcl.ax` otherwise) + trailer `{C|}` and `{XS;...|}`; TSPL `SIZE w mm,h mm`, `GAP g mm,0 mm`, `DIRECTION 1`, `CLS`, trailing `PRINT 1,1`. TSPL parse folds REFERENCE/SHIFT into coordinates, so emit REFERENCE 0,0 (omit).
- Text: TPCL PC (`PCnn;x,y,hMag,vMag,fontLetter,rot2,B` + `RCnn;data`) or PV (`PVnn;...` + `RVnn;data`); TSPL `TEXT x,y,"font",rot,xmul,ymul,"data"` (fonts 1-8 mono cells, "0" scalable points).
- Barcode: TPCL `XBnn;...` + `RBnn;data` (types itf 2, code39 3, code128 9/A; widths form for code39/itf; FNC1 as `>8`); TSPL `BARCODE x,y,"128|39|39C|25|EAN13",height,hr,rot,narrow,wide,"data"` (FNC1 -> EAN128 / 128M `!102`).
- QR: TPCL `XBnn;x,y,T,<ecc>,<cell 2 digits>,A,0,M2` + `RBnn;data`; TSPL `QRCODE x,y,ecc,cell,A,0,"data"`.
- Line/box: TPCL `LC;x1,y1,x2,y2,<0|1>,<thickness dots>`; TSPL `BOX x1,y1,x2,y2,thick` and `BAR x,y,w,h` for lines.
- Image: TPCL `SG;x,y,w,h,0,<PB.images.bitmapToNibble>`; TSPL `BITMAP x,y,widthBytes,h,0,<binary>` (bits inverted: 0 = black, MSB first, rows padded to bytes; needs a new encoder). Overlay image without bitmap cannot be emitted (warning).
- Known losses: PC font letters/serif/italic have no TSPL equivalent; TPCL magnification 0.1 steps vs TSPL integer multipliers; barcode types without counterpart (EAN13 in TPCL, UPCE, 128M control codes); QR rotation; TPCL variables `#NAME#` written literally in TSPL (no substitution, warning); TSPL BLOCK/alignment/radius/bitmap modes already lost at parse time; rounding 0.1 mm <-> dots; TPCL 4-digit coordinate clamp and 2-digit ids.

## Open decisions (default shown)
- TPCL trailer `{XS;I,0001,0002C4100|}` taken from the reference spool example when source is TPCL; otherwise this default (parameters unverified against the printer: flagged with an info diagnostic).
- Text font choice for TPCL when coming from TSPL: nearest PC bitmap font by family/size, PV outline when no match.
- Download file extensions: `.prn` for TSPL, `.txt` for TPCL (`.tpcl` accepted by the open dialog).

## Scope
- In: emitters for TPCL and TSPL (all six components), cross-conversion with warnings, "Convertir a..." panel (target select, output, copy, download, warnings), tests, README/CONTRIBUTING.
- Out: ZPL, editing/move/palette for TSPL, evaluating TSPL counters, flipping DIRECTION 0, preserving unrecognized native-only data.

## Constraints
- Classic scripts/IIFE/`PB`, manifest + index.html identical order, tests via `loadUpTo`. Code/comments English, UI strings Spanish. Test-first (observe RED). Baseline `node --test` 372/372. Review per commit group (whole-branch exceeds the reviewer budget). Planning heuristic ~400 changed lines per task.

## Tasks
- [x] T1 Emit contract: optional language `emit` hook (documented), `PB.composeSlices` `emitters` list, shared emit helpers (dots conversion, escaping, id allocation, diagnostics) + tests with a fake slice/language.
- [x] T2 TPCL emitter part 1: header/trailer driver, text (PC/PV + RC/RV), line, box; round-trip TPCL->TPCL on the spool and barcodes examples (items only for the kinds done).
- [ ] T3 TPCL emitter part 2: barcode (XB + RB, widths form, FNC1), qr, image (SG); full TPCL->TPCL round trip on all TPCL examples.
- [ ] T4 TSPL emitter part 1: header/trailer driver, text (fonts 1-8/0), line (BAR), box (BOX); TSPL->TSPL round trip.
- [ ] T5 TSPL emitter part 2: barcode, qr, image (BITMAP encoder); full TSPL->TSPL round trip on the TSPL example.
- [ ] T6 Cross conversion TPCL->TSPL and TSPL->TPCL: fidelity warnings, rounding tolerance tests on all examples, variables handling.
- [ ] T7 UI "Convertir a..." panel (target select, output, copy, download, warnings), app wiring, README/CONTRIBUTING, browser smoke test (user).

## Acceptance
- Converting the reference spool TPCL to TSPL and loading the output back yields the same item kinds/positions/sizes within tolerance; TSPL example to TPCL likewise; emitting a parsed label in its own language and re-parsing is stable; all warnings for unsupported features are listed; all existing tests pass.

## Routing
- Sequential delegated writers, one per task; native review per commit group.

## Progress
- Explorer mapping done.
- T1 done (uncommitted): tests/emit-contract.test.js written first, RED observed (11/11 failing: no PB.emit, no languages.emit, no emitters); then js/core/emit.js, languages.js emit hook + PB.languages.emit, composeSlices emitters, registry header, manifest + index.html. tests/compose-slices.test.js deepEqual updated for the new emitters field. node --test: 383/383 (372 baseline + 11 new). Next: T2.
- T2 done (uncommitted): tests/tpcl-emit-text-line.test.js written first, RED observed (0/24 passing: no tpcl emit hook); then language emit (header D/AX/C, items, trailer XS) in js/languages/tpcl.js with new SLICE_HELPERS (wrap, safeData, coordText, allocId), text emit (PC/PV + RC/RV) in js/components/text/tpcl.js, LC emit shared by line and box (PB.slices.line.emitLC). node --test: 407/407 (383 + 24 new). Decisions: (1) PC/PV rule: PC when family/weight/style match a BITMAP_FONTS entry and size and size*scaleX are 0.1-step magnifications 1..99 within 0.05 (closest to 1.0x wins on ties), else PV with width = size*scaleX, height = size, font letter B; (2) framing: the parser has no escape, so { } | and line breaks in data become spaces with one Spanish warning; (3) the parser does not store the source XS (neutral-model tests pin size.native = { dRaw, axRaw }), so the trailer is always the spool default plus the Spanish info; (4) D/AX reused only while the model size equals dRaw, else built (AX from the catalog, info if absent); (5) text without data emits an empty RC/RV; (6) line thickness derives from item.width (min 1, max 99 dots with warning); ids start at 00 per namespace (PC, PV) and overflow past 99 warns. Output uses LF, no trailing newline (as the spool example). Next: T3.
