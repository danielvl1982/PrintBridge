# tspl-edit

Branch: `feat/tspl-edit`. Delivery strategy: ask-on-risk (default). Planning forecast: ~1300 authored lines in 4 tasks (one commit each).

## Objective
TSPL labels support what TPCL already does: drag items (moveItem), edit properties in the Propiedades panel (describeItem/updateItem) and the
component palette (componentTemplates/buildComponent/insertCommand). Today TSPL only parses, emits and writes the size.

## Findings (read-only exploration)
- Optional language hooks (js/core/languages.js:1-33; TPCL registration js/languages/tpcl.js:384-400): `insertCommand(text, command)`,
  `moveItem(text, item, dx, dy, {dpi})`, `updateItem(text, item, changes, {dpi})`, `describeItem(item, text?)`, `componentTemplates()`,
  `buildComponent(text, kind, {x,y}, {dpi, viewRotation})`. A missing hook disables the feature (js/app.js:41,183,192,219,236,254).
- `PB.composeSlices` already returns `coordinates`, `editable`, `movable`, `components` per language; TSPL passes only `{handlers}`
  (js/languages/tspl.js:317). `commands(src)` (tspl.js:91) gives `{name, raw, args:[{raw,value}], start, end}` but no per-argument offsets.
- Item x/y are 0.1 mm and already include REFERENCE and SHIFT; the command keeps dots in `item.raw`. BAR exposes x1..y2 as a midline, its
  truth is `native.width/height`. BITMAP: header digits then raw latin1 bytes (never touch the payload). TSPL emits CRLF.
- tests/tspl-app.test.js:85-92 asserts the editing hooks are absent: flip when they exist.

## Agreed decisions (user confirmed)
- REFERENCE/SHIFT: a drag lands the item under the cursor; written dots = target - REFERENCE - SHIFT.
- DIRECTION 0: edit as if DIRECTION 1 (same as the view); no block, no warning.
- Dragging clamps to 0 dots (no negatives).
- Palette templates: text (font "3"), barcode (CODE128), QR, line (BAR), box (BOX). Image entry stays hidden in TSPL for now.
- BAR properties: width and height in dots (not x2/y2).
- Counters (`@1`) and BLOCK: only numeric fields are editable; the text content is never touched.

## Tasks
- [x] T1 Infrastructure: argument offsets in `commands()`, `insertCommand` (before PRINT, EOL-aware), generic moveItem/describeItem/updateItem
      engines driven by slice `coordinates`/`editable`, registered in the TSPL language; pass `coordinates`/`editable` to composeSlices;
      update tests/tspl-app.test.js.
- [x] T2 Move: `coordinates` for TEXT/BLOCK, BARCODE, QRCODE, BAR, BOX, BITMAP (dots delta rounding, BOX shifts both corners, BITMAP header only), tests.
- [x] T3 Properties: `editable` for TEXT (rotation, multipliers), BARCODE (height, narrow/wide, readable, rotation), QRCODE (ecc, cell), BAR/BOX (width, height), tests.
- [x] T4 Palette: `build` per slice, `componentTemplates`, `buildComponent` (dots, viewRotation, REFERENCE/SHIFT), tests.

## Route declaration
Delegated direct, one writer per task (multi-file each), sequential.

## Verification
`node --test` all green after each task. Browser (user, after T4): open a TSPL example; drag items; edit properties; drop palette components.

## Progress
- T1 done: args carry start/end offsets; js/languages/tspl-edit.js (createTsplEditing, numberField, selectField); insertCommand; hooks registered; 672 tests green (645 + 27).
- T2 done: `coordinates` in the text (TEXT/BLOCK), barcode, qr, line (BAR), box (BOX, both corners) and image (BITMAP header only) slices; tests/tspl-move.test.js (19 tests; RED observed: 19/19 failing before the slices); tspl-edit.test.js "no definitions" test narrowed to describe/update.
- T3 done: `editable` in the text (TEXT only: rotation, x/y multipliers; bitmap fonts 1..10, scalable fonts up to 200 pt; BLOCK not editable), barcode (height, readable 0..3, rotation, narrow; wide only for Code 39/ITF types), qr (ECC L/M/Q/H, cell 1..10, rotation), line (BAR width/height) and box (thickness, radius when present) slices; tests/tspl-properties.test.js (29 tests; RED observed: 24 of 29 failing before the slices, the 5 passing were negative cases); tspl-edit.test.js 'no definitions' test replaced by an ignored-keys test.
- T4 done: `build` in the text/barcode/qr/line/box TSPL slices; `componentTemplates`/`buildComponent` in js/languages/tspl.js; `dropDots` (tspl-edit.js, shares an `offsetTracker` with the move engine: REFERENCE/SHIFT before PRINT subtracted, clamp 0) and `insertCommand`/`freePlaceholder`/`itemRotation`/`dropDots`/`lengthDots` helpers for the slices. Templates: TEXT font "3"; BARCODE "128" 8 mm, readable 1, narrow/wide 2; QRCODE M,4,A with rotation always 0 (like the TPCL QR: the viewer draws QR unrotated); BAR 40 mm x 3 dots; BOX 30 x 20 mm, thickness 3. Image entry: new language capability `insertImage: true` (TPCL only, documented in js/core/languages.js), used by `PB.ui.paletteEntries` (js/palette.js, called by app.js `updatePalette`) and by app.js `insertImage`. tests/tspl-palette.test.js (17 tests; RED observed: 17/17 failing before the implementation), tspl-app/tspl-edit tests flipped; README/CONTRIBUTING updated. 737 tests green.
- Browser checklist (user, after T4): open the TSPL example; the palette shows Texto, Código de barras, QR, Línea, Caja and no Imagen; drop each on the label (it lands under the cursor, also with Rotación 90/180/270 and at 203/300 dpi) and click each entry (default point); the new command is selected in the code and sits before `PRINT`; Ctrl+Z undoes it; drag it and edit its properties; with a TPCL label the palette still offers Imagen.
