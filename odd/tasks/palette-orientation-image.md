# Palette orientation and image component (phase 1)

## Objective
New palette items must be inserted upright in the orientation the user is designing in (the view rotation), and the image must be available as a palette component.

## Scope
- T1: `buildComponent` receives the view rotation and writes rotation codes so the item looks upright: item rotation = (360 - view) mod 360. Text (PV) codes 00/11/22/33 for views 0/90/180/270 mapped to item rotations 0/270/180/90, i.e. view 0 -> `00`, 90 -> `33`, 180 -> `22`, 270 -> `11`; barcode digits 0/3/2/1 the same way. QR and line/box unchanged (no rotation in parser/drawing).
- T2: "Imagen" entry in the palette. Click/Enter opens the file picker; the loaded image becomes the overlay preview positioned at the default point (or the drop point); the existing "insert" flow stays. Drop of the image entry onto the preview cannot open a file picker (browser gesture rules): it is handled as a click at that point only if the browser allows it, otherwise ignored with a notice.
- Out of scope: the properties panel (phase 2), QR rotation (unknown field meaning).

## Constraints
- View rotation default is 0. The inversion table was checked for view 90 by the explorer; add tests for all four views.
- `tests/component-palette.test.js` currently pins `B,11,B`; update deliberately (view 270 keeps `11`).
- `buildComponent(text, kind, {x,y}, {dpi, viewRotation})`: backwards compatible (missing viewRotation = 0).
- Code/comments English; UI strings Spanish.

## Tasks
- [x] T1 Orientation-aware `buildComponent` + tests (RED first) + `insertComponent` passes the current view rotation.
- [ ] T2 "Imagen" palette entry (file picker flow) + glyph + README note.

## Acceptance
- With view 0 a dropped text/barcode reads left-to-right; with 90/180/270 it also looks upright; all tests pass.
- Palette shows Imagen; clicking it loads an image into the overlay.

## Routing
- T1, T2: delegated writers, sequential.

## Progress / Evidence
- T1 (delegated writer): RED 5 failing, GREEN; all 11 test files pass (parent spot check). Not verified in browser.
