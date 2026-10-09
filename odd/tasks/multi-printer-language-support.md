# Feature: multi-printer-language-support

## Objective
Let the label viewer load, visualize and **convert between** the three printer languages used in the plant:
TPCL (Toshiba TEC), TSPL/TSPL2 (TSC TTP) and ZPL II (Zebra).

## Problem / why
The viewer only understands TPCL (`.ter`). The parser (`js/tpcl.js`) mixes language-neutral logic (units, variables,
sizes, diagnostics) with TPCL-specific parsing. The drawing layer already consumes a neutral model
(`text | qr | barcode | line`, measures in 0.1 mm), which is the natural pivot for N languages.

## Scope
- In: language registry, language auto-detection (+ manual override), ZPL parser, TSPL parser, emitters for the
  three languages, fidelity warnings on conversion, UI to pick language / convert / copy / download, docs, tests.
- Out: sending data to printers (now planned: odd/tasks/print-agent.md), printer discovery, font-exact rendering. Graphics/images (`^GF`, `BITMAP`, TPCL `SG`) were first out of scope and were added later (superseded 2026-10-09: images exist in the three languages, see odd/tasks/image-overlay.md and zpl-support.md).

## Constraints
- Vanilla JS, no build step, must keep working by double-clicking `index.html` (globals under `PrintBridge`, IIFE modules).
- UI/user text stays Spanish; code identifiers, comments, tests and technical docs are English (T10).
- Existing TPCL behavior must not regress (the reference 99x55 spool example label stays the reference).
- Planning heuristic: ~400 authored changed lines per task (advisory only).
- Superseded 2026-10-09: the project IS a git repository now (public: https://github.com/danielvl1982/PrintBridge); work-unit commits and feature branches are the normal flow. (It was not a repository when this plan was written.)

## Authorized scope
Files under the project root only (`js/`, `css/`, `index.html`, `README.md`, `odd/`, `tests/`).
Project name is now PrintBridge (done in T10).

## Tasks
- [x] T1 Core extraction: split `js/tpcl.js` into language-neutral core (diagnostics, units, variables, sizes) and
      `js/languages/tpcl.js`; add `PB.languages` registry `{ id, name, detect, parse, emit, fonts, sizeCommand }`.
      No behavior change; neutral wording in UI ("etiqueta", not ".ter").
- [x] T2 Neutral model: normalize fonts (height in 0.1 mm, bold, family) and label size into the model so any
      language can read/write it; keep TPCL parse output identical visually.
- [x] T2b Pre-language hardening (from refactor review, user-approved): (1) `parse(src, {dpi})` and truly neutral
      units (QR cell, barcode module, line width, barcode height all in 0.1 mm); (2) replace `cmd` with
      `source {start, end, label}` (multi-span capable, null-safe in `app.js` click-to-select and renderer tooltip);
      (3) move TPCL leftovers out of core/UI/README (`magnification`/`pad4`, FNC1 `>8`, `.ter` accept filter, `{D…|}`
      tooltips, example field `ter` -> `source` with `language`); (4) harden pipeline (try/catch -> error diagnostic,
      registry shape/duplicate checks, "unknown language" instead of silent TPCL fallback, unknown item kind safe).
- [x] T8 View rotation (user request, out of language scope): top-bar option to rotate the preview 0/90/180/270
      degrees clockwise so long labels printed "horizontally" fit without vertical scroll. Must keep correct: cursor
      x/y readout (label units), click-to-select, grid, origin points, overlap marks. Display only: never modifies
      the label source. Persisted per session only (no storage). Tests for the pure coordinate mapping.
- [x] T9 Barcode types: exact rendering of Code 39 and Interleaved 2 of 5 (Code 128 already exact). User scope:
      Code39, Code128, ITF only. TPCL XB types (source: Toshiba B-SX4T spec on ManualsLib pp.98-102, legacy
      `[ESC]XB` form; the `{XB..|}` form for B-EX4/B-FV4/B-EP4 NOT verified): `2`=ITF, `3`=Code39 standard,
      `B`=Code39 full ASCII, `9`/`A`=Code128 (auto / no auto code-set). 1D layouts differ per type:
      Code39/ITF: `e` check digit(1-5), `ff` narrow bar, `gg` narrow space, `hh` wide bar, `ii` wide space,
      `jj` inter-char space, `k` rotation, `llll` height 0.1mm, `p` human-readable 0/1, optional `qq`, `r`(T/P/N
      start-stop). Code128: `e`, `ff` module, `k`, `llll`, ..., `p`. Wide/narrow ratio is given by widths in dots,
      not a ratio code. Verified: Code39 mod43 check = option 3 (attach), `*` start/stop automatic unless `r`.
      Gaps (warn, do not invent): ITF odd-digit/leading-zero rule, ITF check digit options 2-5, Code39 option 2.
- [x] T10 Code internationalization (user decision: "code in English, UI in Spanish"): rename files, folders, global
      namespace (`Ter` -> `PrintBridge`, `index.html`, `js/core.js`, `js/config.js`, `js/drawing.js`, `js/ui.js`, `js/barcodes.js`, `js/view.js`, `js/languages/`, `css/viewer.css`, `css/label.css`), identifiers, CSS classes/ids, comments, tests and technical docs to English;
      user-visible strings stay Spanish. Must be behavior-neutral (tests green, rendered SVG equal modulo renames).
      Runs BEFORE T9 by user request.
- [x] T3 ZPL parser (`^XA ^PW ^LL ^FO ^FT ^A ^FD ^FV ^BC ^BQ ^GB ^FR ^FB basic`) + tests. Done (the hold was lifted): the whole ZPL language (parser, emitter, conversion, images, barcodes, shapes, counters, variables, `^FB`) is in odd/tasks/zpl-support.md (merges up to d1b4d06) and zpl-vol2.md (b7ae979), all merged into main.
- [x] T4 TSPL parser. Done in odd/tasks/tspl-parser.md (372 tests at the time; editing in tspl-edit.md, BITMAP CR fix in tspl-bitmap-cr.md).
- [x] T5 Emitters. TPCL and TSPL done in odd/tasks/emitters.md; the ZPL emitter is done in odd/tasks/zpl-support.md (Z1..Z7).
- [x] T6 UI: "Convertir a…" panel with copy/download. Done in odd/tasks/emitters.md (T7 there, js/convert-panel.js); the placement is tracked in layout-redesign.md.
- [x] T7 Round-trip tests TPCL <-> TSPL exist (tests/convert.test.js and the emit tests); the ZPL round trip is covered by the six-direction conversion matrix (tests/conversion-matrix.test.js, Z8 in odd/tasks/zpl-support.md).

## Acceptance criteria
- Pasting valid TPCL, ZPL or TSPL draws the label and reports unknown commands as warnings.
- Converting the reference spool TPCL to ZPL and TSPL and loading the output back yields the same positions/sizes (tolerance of
  1 dot) and the viewer lists what was approximated.
- No regression on the existing TPCL example and its size validation.

## Checks
- Test runner: `node --test` if Node is available (modules are globals; tests load them in order). If Node is not
  available: documented exception, structural checks in the browser.
- Manual: open the `.html`, load each language example, compare drawing.

## Route declaration
Per task, delegated direct (one writer, 2+ non-trivial files each); the parent reads/reconciles this document first.

## Progress
- Note: entries below written before T10 use the old Spanish file names (`nucleo.js`=`core.js`, `configuracion.js`=`config.js`, `dibujo.js`=`drawing.js`, `interfaz.js`=`ui.js`, `codigos-barras.js`=`barcodes.js`, `vista.js`=`view.js`, `lenguajes/`=`languages/`, `Ter`=`PrintBridge`).
- Created after exploring README, `js/tpcl.js`, `js/configuracion.js`. No source written yet.
- T1 done (route: delegated, one writer). `js/tpcl.js` split into `js/nucleo.js` (diagnostics, units, variables, `Ter.languages` registry, neutral validator, sizes) and `js/lenguajes/tpcl.js` (parser + TPCL rules, registered as `tpcl`); `js/tpcl.js` removed; `Ter.parser` removed, `app.js` now uses `languages.detect(...) || get('tpcl')` and `validator.validate(model, language)`; HTML script order updated; UI wording neutralized. Evidence: `node --test` 10/10 pass (tests/tpcl.test.js, tests/helpers/load.js); `node --check` ok on all changed js. Note: `node --test tests/` fails on Node 22 (treats dir as module); use `node --test`. Registry emit/fonts/sizeCommand fields are deferred to T2/T5. Sizes still read TPCL-shaped model.size (dRaw/axRaw) until T2.

- T2 done (route: delegated, one writer; trigger: 2+ non-trivial files). RED first: new tests/modelo-neutro.test.js (8 tests, 8 failed before). Core now: `model.language`, neutral `model.size {width,height,pitch,gap,native}`, `symbology` + `native.type` on barcode/qr, optional registry fields `sizeCommands/matchesSize/applySize`, `Ter.sizes.apply(language,text,size)` and `catalog.findBySize(size)` (replace `applyToTer`/`dCommand`/`findByDCommand`); TPCL font tables, control commands, D/AX logic moved to `js/lenguajes/tpcl.js`; catalog `ax` became `native.tpcl.ax`; `Ter.code128.supports` removed. Adapted old assertions in tests/tpcl.test.js only for `size.native.dRaw/axRaw` and `sizes.apply(tpcl, ...)`. Evidence: `node --test` 18/18 pass; `node --check` ok on all js. Browser files readback-checked by grep (no remaining refs to removed names).

- T2b done (route: delegated, one writer; trigger: 2+ non-trivial files + preparation reading). RED first: 3 new test files (tests/unidades-origen.test.js, registro-robustez.test.js, dibujo.test.js; 27 failed/11 passed before). Core: `parse(src,{dpi})`; every measure in 0,1 mm (TPCL converts qr.cell/barcode.module/line.width with `units.dotSize(dpi)`, originals in `native.cell|module|width`; barcode.height was already 0,1 mm); `item.source {spans,label}` replaces `cmd` (`Ter.sources.rangeOf/labelOf`, null-safe); FNC1 neutral marker `Ter.barcodeData.FNC1` (GS, U+001D) produced by the TPCL parser from `>8` only in barcode data; `magnification`/`pad4` private to tpcl.js; preview cursor shows plain integers; QR `ecc` neutral L|M|Q|H mapped in tpcl.js (unknown letter -> warning + M); registry validates shape and rejects duplicate ids; `Ter.sizes.apply` returns `{text, supported}`; renderer skips unknown kinds with a warning and has no `ctx.dot`; example `ter` -> `source` + `language:'tpcl'`; app.js analyzes once per refresh/open inside try/catch, no-language -> single error + empty drawing. Evidence: `node --test` 39/39 pass; `node --check` ok on all js; reference spool SVG at 203 and 300 dpi (plus a synthetic label with lines, rect, Code128 with `>8`) byte-identical before/after. Adapted old assertions only for shape: `example.ter` -> `example.source`, `native` now includes cell/module, `qr.cell` -> `native.cell`, `sizes.apply(...)` -> `.text`.

- T8 done (route: delegated, one writer; trigger: 2+ non-trivial files). RED first: tests/vista.test.js (7 tests; failed on missing js/vista.js). New pure module `js/vista.js` (`Ter.viewRotation`: `rotate`, `inverse`, `viewBoxFor`, `transformFor`, invalid angle throws RangeError), loaded before `dibujo.js` (HTML, tests/dibujo.test.js, tests/vista.test.js). Renderer takes `opts.rotation` (default 0): swaps the viewBox at 90/270 and wraps background, grid, items, overlap layer and origin points in `<g class="giro" transform="matrix(...)">`; at 0 no wrapper is emitted and the SVG is byte-identical to before (tested). New top-bar "Giro" select (`#rotation`, not persisted) wired to `refresh`; preview mousemove maps the screen point through `viewRotation.inverse`; click-to-select is DOM based (`closest('.item')`) so unaffected. CSS: `#svgwrap svg` got `max-height: calc(100vh - 140px)` so tall rotated labels fit without vertical scroll. `Ter.layout` verified by code reading: `boxInGroup` uses `parent.getCTM().inverse() * el.getCTM()` (ancestor transform cancels) and non-text uses `getBBox()` in own space, so measurements, hit rects and overlap marks stay in label space. README "Barra superior" row added. Evidence: `node --test` 46/46 pass (39 existing + 7 new); `node --check` ok on vista.js, dibujo.js, interfaz.js, app.js. NOT verified (no browser): the manual checks below.
  Manual checks: open the .html, load the example, pick 0/90/180/270 in Giro; hover and confirm x/y match the grid labels at each angle; click a text/QR/barcode and confirm the editor selects its line; confirm overlap marks, origin points and out-of-bounds messages look right; resize the window and confirm the 90/270 view fits without vertical scroll.

- T10 done (route: delegated, one writer; trigger: 2+ non-trivial files, large mechanical rename; no RED/GREEN, characterization instead). Files renamed with `git mv` (html, 2 css, 7 js, 1 folder, 5 tests); namespace `Ter` -> `PrintBridge` (IIFE param `PB`); CSS classes/ids and comments/tests/README translated to English; UI strings stay Spanish. Class/id mapping: fuente-X->font-X, negrita->bold, cursiva->italic, codigo-legible->human-readable, trazo->stroke, rejilla-texto->grid-text, rejilla-linea->grid-line, etiqueta-fondo->label-background, giro->view-rotation, origen->origin, rayado->hatch, no-generado->not-generated (class and pattern id); size id/example id '<customer>-bobina'/'bobina-<customer>' -> 'spool-99x55'. Developer exceptions (registry shape/duplicate, RangeError) translated to English; FNC1 literal GS char written as ''. Evidence: reference spool SVG at 203/300 dpi x rotation 0/90 byte-equal to the pre-rename output after applying the inverse class/id mapping, diagnostics equal; `node --test` 46/46 pass; `node --check` ok on all js. NOT verified (no browser): manual checks below.
  Manual checks: open `index.html`, load the example, change Giro, hover (x/y), click an item (selects its line), toggle Rejilla/Puntos origen/Marcar solapas, confirm the fonts look as before.

- T9 done (route: delegated, one writer; trigger: 2+ non-trivial files). RED first: tests/wide-narrow-barcodes.test.js (22 tests; 21 failed before). Neutral model: symbologies `code39`, `itf` exact (validator: code128/code39/itf); barcode items gain optional `widths {narrowBar,narrowSpace,wideBar,wideSpace}`, `interCharGap` (0.1 mm) and `check` ('none'|'mod43'|'unsupported'); renderer fallback without widths = module and 3:1. `PB.code39` / `PB.itf` encoders (js/barcodes.js) return `{elements:[{bar,wide,gap?}], text, characters, warnings}`; mod-43 check (CODE39 -> W). TPCL: types 2=itf, 3/B=code39 (B sets native.fullAscii + warning), own `XB` layout for those types (comment: legacy [ESC]XB form verified only; {XB..|} unverified for B-EX4/B-FV4/B-EP4); Code128 parsing untouched. Renderer: shared barcode markup, Code39/ITF drawn from real widths, warnings from encoders surfaced as diagnostics, unencodable content -> hatched box. New example 'barcodes-code39-itf-code128'. README table + limitations. Evidence: `node --test` 68/68 pass (46 existing + 22 new); `node --check` ok on core, tpcl, barcodes, drawing, config; reference spool and synthetic Code128 SVG (203/300 dpi, grid and anchors on) byte-identical before/after (cmp); new example renders 70/24/37 bars (Code39 with mod-43 check, ITF, Code128) with 3 info diagnostics and no warnings at 203 and 300 dpi. NOT verified (no browser): manual checks below.
  Gaps kept (warned, not invented): ITF odd digit count (leading 0 drawn + warning), ITF check options 2-5, Code39 option 2 and others (drawn without check + warning), Code39 start/stop option r T/P/N (automatic * drawn + warning), Code39 full ASCII (type B: only standard characters; others warned and not drawn), whether the printer's human-readable line includes the check character (viewer shows data only), `{XB..|}` layout on B-EX4/B-FV4/B-EP4.
  Manual checks: open index.html, load "Códigos de barras — Code39, ITF y Code128", check the three barcodes and the Avisos panel (3 info lines, no warnings), switch Giro and the resolution, edit a type/data to see the warnings (lowercase in Code39, odd ITF), scan each with a phone/scanner app.

## Next step
Reconciled 2026-10-09: every task of this plan (T1..T10) is done; ZPL (T3, T5, T7) was completed in odd/tasks/zpl-support.md and zpl-vol2.md (the earlier "T3 on hold, the only open item" is superseded). What is still pending lives in `odd/tasks/optional-backlog.md` (optional items and the verification debt that needs a printer or a browser) and in the planned task files `odd/tasks/gs1-128.md`, `odd/tasks/print-agent.md` and `odd/tasks/zpl-sf-mask.md`.
