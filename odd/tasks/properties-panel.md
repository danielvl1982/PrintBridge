# Properties panel for the selected object (phase 2)

## Objective
Replace the image toolbar with a contextual properties panel driven by the selected item: rotation, size and the other fields that make sense for its kind. Editing a field rewrites only that field in the item's command.

## Scope (fields per kind)
- Text PV: width, height (0.1 mm), rotation (0/90/180/270). Text PC: horizontal and vertical magnification, rotation.
- Barcode (1D XB): module width, height, rotation, human-readable flag.
- QR: module size and error-correction level (no rotation: the 5th field is unverified).
- Line/box LC: end point (x2, y2), thickness, line/box.
- Image SG: position only (drag); no resize (data tied to size).
- Overlay image (preview, no source): X, Y, width, threshold, insert, remove (the existing controls move into the panel).
- The old "Añadir imagen" toolbar button disappears (the palette has Imagen). When an overlay exists and nothing is selected, the panel shows the overlay controls.
- Out of scope: delete item, multi-select, QR rotation, font family changes.

## Constraints
- New optional language hook `updateItem(text, item, changes, { dpi })` following `moveItem` (per-kind pattern table with the `d` flag / match indices, CR/LF tolerant, keep field width, clamp to valid ranges). Panels offer only TPCL-native valid values.
- `createPreview` needs a selection-change callback (select and deselect; today there is no deselect event). After each edit the spans change: refresh, then re-select by index.
- Write through `editor.replaceText` (keeps Ctrl+Z).
- Code/comments English; UI strings Spanish.

## Tasks
- [x] T1 `updateItem` hook in `js/languages/tpcl.js` (+ registry doc in `js/core.js`) with tests RED first in `tests/update-item.test.js`.
- [x] T2 Properties panel UI: selection-change event in `js/ui.js`, panel module, move the overlay image controls into it, `js/app.js` wiring, `index.html`/CSS, README.

## Acceptance
- Selecting an item shows its fields; editing one rewrites only that field, preview updates, Ctrl+Z undoes, selection stays on the item; overlay controls work as before; all tests pass.

## Routing
- T1, T2: delegated writers, sequential.

## Progress / Evidence
- T1 (delegated writer): RED 38 failing, GREEN 38/38; all 12 test files pass (parent spot check). Ranges guessed (not in parser/README): PC magnification 1-99, QR cell 1-99, barcode module 1-99, line width 1-99. Not verified on a printer.
- T2 (delegated writer): RED (module missing) then 4/4; all 13 test files pass, node --check ok (parent spot check). NOT verified in a browser: change event/focus restore, panel updates on click/drag/deselect, overlay controls inside the panel, layout <=900px, palette image flow without the toolbar button. Known: after a panel edit the editor range is not re-selected (focus); selecting a normal item hides overlay controls until empty-space click.
