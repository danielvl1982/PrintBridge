# Draggable component palette

## Objective
A palette panel with design components the user drags onto the label preview; dropping inserts the new item, at the drop position, into the code. Text and barcodes are inserted as variable fields (`<#NAME#>`), as in the user's labels.

## Scope
- Components: text (PV outline + RV), Code128 barcode (XB + RB), QR (XB + RB), line (LC), box (LC).
- Out of scope: image (has its own panel), fixed-text mode, resizing, touch dragging, other languages (TPCL only).

## Decisions (user)
- Text and barcodes drop as variable fields: format command plus a data command with a unique placeholder (`<#TEXTO1#>`, `<#CODIGOBARRAS1#>`, `<#QR1#>`), so the variables panel creates the input.
- Drop point = top-left anchor of the new item.

## Constraints
- Language-agnostic: the palette talks to optional language hooks `componentTemplates()` and `buildComponent(text, kind, {x, y}, {dpi})` (text in, text out), like `moveItem`.
- Free ids computed per namespace (PC/PV/XB share their number with RC/RV/RB); data command must come after its format command; inserted before `{XS…|}` via `insertCommand`.
- Coordinates in 0.1 mm, 4 digits, clamped 0..9999 (LC end point too).
- Write through `editor.replaceText` (keeps Ctrl+Z).
- Drop point converted to label coordinates with the view rotation (`toView` + `viewRotation.inverse`), clamped.
- HTML5 drag & drop for the first version.
- Code/comments in English, UI strings in the project's language (Spanish).

## Tasks
- [x] T1 TPCL builder: `componentTemplates`, `buildComponent`, next-free-id and next-free-placeholder helpers in `js/languages/tpcl.js` (+ registry doc in `js/core.js`), tests RED first in `tests/component-palette.test.js` (parse back, ids with gaps/mixed widths, clamp, before `{XS`, CRLF, RV after PV no error, unknown kind unchanged).
- [ ] T2 UI: palette panel (`index.html`, `css/`), `labelPointAt` in `createPreview`, drop wiring in `js/app.js`, README note.

## Acceptance
- Dragging each component onto the preview inserts it at the drop point (top-left), correct with rotated views; the variable appears in the variables panel; Ctrl+Z undoes; all tests pass.

## Routing
- T1 and T2: delegated writers (2+ non-trivial files each); sequential.

## Progress / Evidence
- T1 (delegated writer): RED 17 failing, GREEN 17/17; all 11 test files pass (parent spot check).
