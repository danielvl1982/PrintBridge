# Feature: image-overlay

## Objective
Let the user add an image to the label preview: pick an image file on screen and enter its x,y position (mm). The image is drawn on the label and takes part in out-of-bounds and overlap diagnostics.

## Problem / why
The viewer only draws items parsed from the label code. TPCL here has no graphic command and there is no item-to-code serializer, so images cannot come from the code text.

## Scope
- In: app-level image overlay (preview only), UI controls (file, x mm, y mm, optional width mm), `image` item kind, renderer, diagnostics, unit tests for pure parts.
- In (phase 2, user-requested, "si" to nibble mode): insert the image into the label code as a TPCL `{SG;x,y,w,h,0,<nibble data>|}` command, and parse `SG` back so it is drawn from the code.
- Out: ZPL/TSPL image commands, persistence, drag-to-move, multiple-image management UI, hex/BMP/PCX/TOPIX SG modes (parser warns "unsupported mode").

## TPCL SG facts (researched, B-SX4T manual via ManualsLib; NOT verified on B-EX4 or a real printer)
- Graphic command: `{SG;aaaa,bbbb,cccc,dddd,e,data|}`. aaaa/bbbb = x/y in 0.1 mm (append `D` for dots); cccc/dddd = width/height in DOTS; e=0 nibble overwrite (e=4 nibble OR).
- Nibble data: 4 dots per ASCII char `0`..`?` (30H-3FH), 1 = black; chars per image = ((w+7)/8)*h*2; rows padded to a multiple of 8 dots with 0. Nibble chars include `:` and `;` but never `,`, `{`, `|`, `}`: the parser MUST take the first 5 comma-separated fields and treat the rest up to `|}` as raw data (do not split on `;`).
- Insert the SG command before the print command `{XS;...|}` (after `{C|}`) when present, otherwise append.
- Unverified framing risk: the `{...|}` form with SG data was inferred; user must test the first print on a real printer.

## Constraints
- User: local changes only. NO commits, NO push. Ask before any git upload (and before committing).
- Code and comments in English; on-screen text in Spanish.
- Units: model is 0.1 mm; UI in mm (`units.fromMm/toMm`). Default size = natural pixels * `units.dotSize` (254/dpi); height keeps aspect ratio.
- Image state lives in `app.js`; `#src` textarea stays the single source of truth for the code.

## Authorized scope (edit surfaces)
- index.html, css/viewer.css, js/core.js, js/drawing.js, js/ui.js, js/app.js, js/languages/tpcl.js, README.md, tests/image.test.js, tests/sg.test.js

## Tasks
- [x] T1 Pure helper `PB.images.makeItem({href, naturalW, naturalH, xMm, yMm, widthMm, dpi})` -> neutral `image` item (+ tests, RED first). Route: delegated (writer, with T2-T4).
- [x] T2 Core + drawing: document `image` kind, exempt from "no data" rule (core.js:197), `RENDERERS.image` with `<image>` + `.hit` rect same size (+ render tests).
- [x] T3 UI: `createImagePanel` + controls in index.html (file input, x, y, width, add/remove).
- [x] T4 App wiring: hold image state, append items to `model.items` after parse and before validate/render/analyze.
- [x] T5 Update README (files table + usage) and verify full `node --test`.

- [x] T6 Pure DOM-free helpers in core.js `PB.images`: `bitmapToNibble(bits,w,h)` / `nibbleToBitmap(data,w,h)` (round-trip, padding, 1=black), `buildSG({xMm,yMm,w,h,data})`. Tests RED first.
- [x] T7 TPCL parser: `SG` handler in js/languages/tpcl.js (nibble e=0/4; other modes -> warning), produces `image` item with `bitmap {w,h,data}`; x/y in 0.1 mm or dots (`D`). Plus `insertCommand` helper to put a command before `{XS;` (or append). Tests RED first.
- [x] T8 Renderer: `RENDERERS.image` draws `bitmap` as an SVG path of black row runs (DOM-free, no canvas), keeps `.hit` rect; `href` overlay path unchanged. Tests.
- [x] T9 Browser conversion + UI: canvas resample to width_dots x height_dots (dots from width mm and dpi), composite alpha over white, luminance threshold 50% -> nibble; new button "Insertar en el código" inserts the SG line into `#src` and clears the preview overlay; README update; full `node --test`.

- [x] T10 (quality, user: mostly logos/line art, e.g. food-contact and PFC symbols; no dithering) DOM-free in core.js `PB.images`: `thresholdRGBA(rgba,w,h,threshold)` with optional threshold 0-255 (default 128, existing behavior unchanged), and `downscaleSteps(srcW,srcH,dstW,dstH)` returning intermediate sizes (successive halving until within 2x of the target; never upscale in steps). Tests RED first.
- [ ] T11 Browser: `rasterize` uses stepwise downscale (canvas halving, `imageSmoothingQuality = 'high'`); new "Umbral" slider (0-100%, default 50) in the image toolbar; while an image is loaded the preview shows the converted 1-bit bitmap (an `image` item with `bitmap`, same data that "Insertar en el código" inserts) so threshold changes are visible; latest-wins async guard, fall back to the plain `href` preview if rasterizing fails; guard images with 0 natural size (e.g. SVG without width/height) with the existing error notice. README update. Full `node --test`.

## Acceptance criteria
- Inserting an image adds a `{SG;...|}` line to the label code before `{XS;`; the image then renders from the code and survives re-parse (round trip).
- Choosing an image and entering x,y draws it at that position on the preview.
- Out-of-bounds and overlap warnings work for images; no spurious "no data" warning.
- Existing tests still pass; new tests cover helper and renderer.

## Route declaration
Delegated direct: 2+ non-trivial files (core, drawing, ui, app, html) -> one writer. Trigger: Writer trigger. Mapping done by one read-only explorer.

## Progress / evidence
- Explored (explorer): plug-in points identified (RENDERERS in drawing.js, rule in core.js:197, ui factories, app.js refresh).
- Writer: RED observed first (node --test: 77 tests, 68 pass, 9 fail, all in tests/image.test.js); GREEN after implementation (77 pass, 0 fail).
- T1: PB.images.makeItem added in js/core.js (DOM-free, covered by tests). T2: image kind documented, exempted from "sin texto" rule, RENDERERS.image in js/drawing.js (<image> + .hit rect after it).
- T3/T4: index.html third toolbar (btnImage, imageFile, imgX, imgY, imgW, btnImageRemove), ui.createImagePanel, app.js state.image + withImage() appended after parse (before validate/render/analyze), FileReader + Image probe.
- T5: README "Imagen" section added; final node --test: 77 pass, 0 fail.
- NOT verified: browser behavior (DOM wiring, FileReader, layout.analyze with image bbox, hover/selection); checked structurally (IDs match between index.html and app.js, node --check passes).
- Phase 2 (T6-T9), writer: RED observed first (node --test: 104 tests, 81 pass, 23 fail, all in new tests/sg.test.js); GREEN after implementation (104 pass, 0 fail).
- T6: PB.images.bitmapToNibble / nibbleToBitmap / buildSG / targetDots / thresholdRGBA in js/core.js (bits = flat Uint8Array of 0/1, row-major; xMm/yMm are mm, written as 0.1 mm).
- T7: SG handler + insertCommand in js/languages/tpcl.js. The tokenizer needed no change: nibble chars never contain `|`, `}` or `{` (covered by a test with `;:<=>?`).
- T8: RENDERERS.image draws item.bitmap as one path of row runs under a scaled group; the href path is unchanged.
- T9: btnImageInsert (index.html), ui.createImagePanel (insert/onInsert, enabled with the image), app.js insertImage + rasterize (canvas, white background, 50% threshold), README Imagen section + SG row.
- NOT verified (phase 2): canvas conversion, button wiring and live refresh in a browser (structural checks only: IDs match across index.html/ui.js/app.js, node --check passes); SG framing on a real printer or B-EX4 (documented as unverified in a code comment and the README).
- Quality pass (T10-T11), writer: RED observed first (node --test: 113 tests, 104 pass, 9 fail, all new tests in tests/sg.test.js); GREEN after implementation (113 pass, 0 fail).
- T10: PB.images.thresholdRGBA(rgba,w,h,threshold) (optional 0-255, clamped, default/invalid 128), thresholdFromPercent (slider % -> 0-255, 50 -> 128), downscaleSteps, makeBitmapItem (bitmap item sized in dots like the parsed SG) in js/core.js.
- T11 (implemented, NOT checked off: browser behavior unverified): app.js rasterize steps through canvases with imageSmoothingQuality 'high'; conversionParams/convertImage shared by the preview (updatePreview, latest-wins token, 150 ms debounce, falls back to the plain href item + error notice) and insertImage; withImage uses the converted bitmap when its key (WxH@threshold) matches; 0-size guard in rasterize (readImage already had one); ui.createImagePanel threshold slider + readout (onThreshold); index.html #imgThreshold/#imgThresholdValue; css range/output; README Imagen section.
- NOT verified (T11): canvas stepping, slider, live 1-bit preview, debounce and stale-result dropping in a browser (structural checks only: IDs match across index.html/ui.js/app.js, node --check passes).
- Commits: none by user instruction (local only).

## Next step
Browser smoke test by the user (preview overlay, "Insertar en el código", re-render from the code); first real print on the printer; then ask before any commit.
