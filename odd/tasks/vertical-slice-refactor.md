# Vertical slice refactor

## Objective
Split the code by component (vertical slice): one folder per label component holding its encoder/model constants, parse, draw, build, move, update/describe and validation. Pure refactor: zero behavior change, all 201 tests stay green.

## Why
Before adding ZPL/TSPL (multi-printer-language-support T3+), each component must own its behavior so a new language adds one file per component instead of editing giant dispatch tables in `tpcl.js`, `drawing.js` and `core.js`.

## Scope
- Slices: `text`, `barcode` (code128/code39/itf), `qr`, `line`, `box` (own slice; shares the `line` kind with `rect`), `image` (codec, overlay, render, tpcl).
- `js/core.js` (diagnostics, units, sources, variables, languages registry, validator, sizes, images) split into `js/core/*`.
- `js/languages/tpcl.js` reduced to parse context, `insertCommand`, size commands and composition of the slices' hooks.
- Out of scope: new features, ZPL/TSPL, changing UI, bundler/ES modules (keep classic scripts + IIFE + `PB` namespace).

## Constraints
- Classic scripts, one IIFE per file, load order in `index.html` and in tests via a single shared manifest (no per-test file lists).
- Component registry `PB.components.register({kind, ...})`; slices register before `tpcl.js` and `drawing.js` load.
- Small steps, `node --test` (Node 22+, from repo root) green after every task. Code/comments English; no behavior or UI-string change.
- ~400 changed lines per task is a planning heuristic only.

## Tasks
- [x] T1 Foundation: `PB.components` registry + shared file manifest for `index.html` and `tests/helpers/load.js` (tests use it). No code moved yet.
- [x] T2 `line` + `box` slices (render, parse LC, build, move, edit, validate).
- [x] T3 `text` slice (PC/PV).
- [x] T4 `barcode` slice (encoders from `barcodes.js`, render, parse, build, move, edit).
- [x] T5 `qr` slice (matrix, render, parse, build, move, edit).
- [x] T6 `image` slice (codec from `PB.images`, overlay, SG parse, render).
- [x] T7 Split `core.js` into `js/core/*`; `tpcl.js`/`drawing.js` become composition only; validator and `PB.layout.analyze` per component.
- [x] T7b Image overlay leftovers: move `IMAGE_KIND`, palette append, `pickImage`/`pendingImagePosition` (js/app.js) and `createImagePanel` (js/ui.js) behind image slice hooks; no behavior change.
- [x] T8 Docs (README/CONTRIBUTING layout) and final regression (243/243). Browser smoke test (focus, drag, overlay, layout, palette) is PENDING: run by the user, Node tests cannot cover DOM.

## Acceptance
- `node --test` passes with the same 201 tests (plus registry tests); app behaves identically in the browser; each component's behavior is found in its own folder.

## Routing
- Sequential delegated writers, one per task (each touches 2+ non-trivial files). Explorer map done (see Engram `odd/vertical-slice-refactor/tasks`).

## Delivery
- Branch `refactor/vertical-slice`; work-unit commit per task (Conventional Commits). Strategy `ask-on-risk`. Push/PR/merge are the user's call.

## Progress
- Baseline: 201/201 tests pass on `main` (a12e6e4).
- T1 done: RED observed (registry file missing), then GREEN; `node --test`: 206/206 pass (201 + 5 new). Added `js/components/registry.js`, `js/manifest.json`, `loadUpTo`/`loadApp`/`manifest` helpers; all tests migrated to `loadUpTo`; manifest-sync test covers index.html. Not yet committed.
- T2 done: RED observed (4/5 new slice tests failing before registration), then GREEN; `node --test`: 212/212 pass (206 + 5 slice tests + 1 forItem registry test), existing tests unchanged. Slices `js/components/line/{render,tpcl,index}.js` and `box/{tpcl,index}.js`; `PB.components.forItem`; tpcl.js/drawing.js/core.js validator/palette.js compose from the registry. Pattern: `<id>/render.js` and `<id>/<language>.js` publish on `PB.slices.<id>`, `<id>/index.js` registers; language hooks are `languages.tpcl = helpers => ({handlers, build, coordinates, editable})`. Not yet committed.
- T3 done: RED observed (4/4 new tests failing before wiring), then GREEN; `node --test`: 216/216 pass (212 + 4 in tests/text-slice.test.js). Slice `js/components/text/{render,tpcl,index}.js` (PC/PV parse, fonts, build, move, edit, glyph). New contract field `order` (number): registry `all()`/`kinds()` sort by it and `COMPONENTS` in tpcl.js interleaves legacy kinds (barcode 20, qr 30) with slices (text 10, line 40, box 50), keeping palette text, barcode, qr, line, box. SLICE_HELPERS extended (rotationField, nextId, freePlaceholder, ROTATIONS, ROTATION_STEPS, ROTATION_CODES); drawing ctx gains `esc`. One existing assertion adjusted (line-box-slice test: forItem undefined now checked with `qr`, since text is a slice). Not yet committed.
- T4 done: RED observed (5/5 new tests failing before the slice existed), then GREEN; `node --test`: 221/221 pass (216 + 5 in tests/barcode-slice.test.js), existing tests unchanged except the `kinds()` expectation in text-slice.test.js (now `['text', 'barcode', 'line', 'box']`). Slice `js/components/barcode/{code128,code39,itf,render,tpcl,index}.js` (`order: 20`, glyph `|||`); encoders keep `PB.code128/code39/itf`; `js/barcodes.js` now holds only `PB.qr`. SLICE_HELPERS gains `DIGITS`; drawing ctx gains `rectsPath`. The legacy XB coordinate pattern stays in tpcl.js for QR (the barcode slice declares its own identical one). Note for T5: the generic 1D handler `^XB..,([^,]),` also matches QR (`T`); the QR handler must keep running before it (give it a lower handler priority or keep it ahead of slice handlers). Not yet committed.
- T5 done: RED observed (3/6 new tests failing before the slice existed), then GREEN; `node --test`: 227/227 pass (221 + 6 in tests/qr-slice.test.js). Slice `js/components/qr/{matrix,render,tpcl,index}.js` (`order: 30`, glyph `▦`; `PB.qr` kept); `js/barcodes.js` deleted (manifest + index.html updated; 7 tests now `loadUpTo('js/languages/tpcl.js')`). Parse-order fix: the barcode generic XB pattern now carries `(?!T,\w,\d)` so it skips well-formed QR commands (a malformed type T command still falls to barcode, as before); documented in the registry contract. New optional language hook `rules` (format rules per slice; QR 2-digit module rule moved there). `UNSUPPORTED_CHECK` shared via `js/components/barcode/constants.js`. Legacy XB coordinate pattern removed from tpcl.js, LEGACY_COMPONENTS/VARIABLE_COMPONENTS removed; tpcl.js legacy tables now hold only image (SG parse, SG coordinates) plus shared handlers (D, AX, RB/RC/RV data, control). Assertions adjusted: `kinds()` in text/barcode slice tests, `forItem` undefined now checked with `image`. Not yet committed.
- T6 done: RED observed (2/5 new tests failing before the slice existed), then GREEN; `node --test`: 232/232 pass (227 + 5 in tests/image-slice.test.js). Slice `js/components/image/{codec,render,tpcl,index}.js` (`order: 60`, label Imagen, glyph, `carriesData: false`; `PB.images` kept, moved out of core.js and loaded right after the box slice). SG parse + coordinates in the slice hook (no build, no editable); RENDERERS/bitmapMarkup removed from drawing.js, GLYPHS removed from palette.js, validator fallback simplified. COMPONENTS in tpcl.js now lists only slices with a `build` hook, so the image stays out of `componentTemplates()` (app.js still appends the Imagen entry last). Assertions adjusted: `kinds()` now ends with 'image' in text/barcode/qr slice tests, forItem-undefined check uses 'unknown'. Left for T7/T8: js/app.js (IMAGE_KIND, updatePalette append, pickImage/insertComponent image branch) and js/ui.js createImagePanel still hold image wiring. Not yet committed.
- T7 done: RED observed (20/25 failing: manifest files missing, hooks absent), then GREEN; `node --test`: 237/237 pass (232 + 5 in tests/core-split.test.js), existing tests unchanged. `js/core.js` removed and split into `js/core/{model,diagnostics,units,barcode-data,sources,variables,languages,validator,sizes}.js` (model.js is the comment-only neutral-model doc; manifest and index.html updated identically, no test load boundary referenced core.js). New slice hooks documented in the registry: `layout(group, item)` (text: `text/layout.js` keeps boxInGroup/textBoxes and the .hit fit; line and box: `() => null` skip; default group getBBox) so `PB.layout.analyze` in drawing.js is generic; `validate(item)` (barcode: `barcode/validate.js` owns EXACT_SYMBOLOGIES and the approximate-drawing warning, run after the shared no-content rule so text and order are unchanged). The no-content rule stays in the validator (cross-kind, it reads `carriesData`). Remaining sizes: js/languages/tpcl.js 361 lines (the one `kind === 'barcode'` left is the shared RB data handler), js/drawing.js 140 lines. Not yet committed.
- T7b done: RED observed (6/6 new tests failing before the files existed), then GREEN; `node --test`: 243/243 pass (237 + 6 in tests/image-ui-slice.test.js); `node --check` clean on js/app.js, js/ui.js and image/{panel,overlay,index}.js. Moved: `createImagePanel` from js/ui.js to `js/components/image/panel.js` (still `PB.ui.createImagePanel`, extends `PB.ui` with `PB.ui = PB.ui || {}`, loaded before ui.js; also on `PB.slices.image.createImagePanel`); `pendingImagePosition`, the `cancel` listener and `pickImage` to `js/components/image/overlay.js` (`createPicker({ fileInput, refresh })` -> `pick/takePosition/clear`, exposed as the registry field `overlay`); `IMAGE_KIND` and the hardcoded Imagen entry replaced by `PB.components.get('image')` kind/label in app.js. Manifest and index.html both gained panel.js and overlay.js. Left in js/app.js (closure state shared with refresh/preview/state.image): `state.image`, `withImage`, `readImage`/`loadImage`/`removeImage`, `rasterize`, `conversionParams`/`convertImage`, `updatePreview`/`cancelPreview` timers, `insertImage`, `isOverlay`, overlay branches of `moveItem`/`updateProperties`. Not verified in a browser (no DOM in node). Not yet committed.
- T7: core split, layout/validate hooks (29c4953). T7b: image panel/picker in slice (e5e90b6); conversion/preview state stays in js/app.js (closure state). T8: docs updated; 243/243. Browser smoke test pending (user).
- Native review: whole branch exceeded the reviewer budget (lens_context_budget_exceeded), so each work unit was reviewed on its own (worktrees at each commit): T1 (4 lenses), T2, T3, T4, T6, T7, T7b (1 consolidated lens each), T5 (4 lenses) — all approved and acknowledged. T8 docs-only, passive, not reviewed.
- Next: user browser smoke test (focus, drag, overlay, layout, palette), then push/PR decision.
