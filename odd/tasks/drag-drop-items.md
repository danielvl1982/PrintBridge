# Drag & drop of label items

## Objective
Let the user drag every item shown in the label preview and have the new position written back to the code (or, for the not-yet-inserted overlay image, to the image panel X/Y fields).

## Scope
- All items with a source command: text (PC/PV), barcode and QR (XB), line (LC), image (SG).
- The overlay image preview (no source): updates the panel fields imgX/imgY on drop.
- Works with the view rotation (0/90/180/270).
- Out of scope: resizing, multi-select, snapping, other languages (only TPCL implements the hook).

## Constraints
- Units are 0.1 mm, except SG with a `D` suffix (dots, converted with the dpi).
- Coordinate fields keep 4 digits; values are clamped to 0..9999.
- A click without movement must keep selecting the command in the editor (3 px threshold).
- The SVG is rebuilt on every refresh, so the code is written on pointerup, not during the drag.
- Code and comments in English; UI strings follow the project's existing language.
- Planning heuristic: ~400 authored changed lines per task (advisory).

## Tasks
- [x] T1 Pure `moveItem(text, item, dx, dy, { dpi })` in `js/languages/tpcl.js`, exposed as an optional language hook, with tests (RED first) in `tests/`. Covers PC/PV/XB/QR/LC (both points)/SG (with and without D), 4-digit width, clamping, CR/LF inside the command.
- [x] T2 Pointer drag in `createPreview` (`js/ui.js`) with threshold, pointer capture, rotation-aware delta (`view.js` helper if needed), visual translate during drag, `onMove` callback; wiring in `js/app.js` (language hook, overlay image to panel fields, undo-friendly text write); CSS cursor; README note.

## Acceptance
- Dragging any item moves it and the code text changes only in that command's coordinates.
- Works with a rotated view; click still selects.
- Ctrl+Z in the editor undoes a move.
- All `tests/*.test.js` pass.

## Routing
- T1: delegated writer (tpcl.js + new tests). T2: delegated writer (ui.js, app.js, css, README). Trigger: 2+ non-trivial files per task.

## Progress / Evidence
- T1 (delegated writer): RED observed (22 failing), GREEN 22/22; all 10 test files pass (parent spot check). Commit: see git log.
- T2 (delegated writer): RED 2 failing (viewRotation.delta), GREEN; all 10 test files pass (parent spot check). NOT verified in a browser: pointer capture/threshold, transform at 4 rotations, Ctrl+Z via execCommand (Firefox, setText fallback), cursors, caret after move. Known edge: typing then dragging within the 150 ms edit delay can use stale source spans.
