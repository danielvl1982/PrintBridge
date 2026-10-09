# size-from-label

Branch: `feat/layout-redesign` (continues the layout work). Delivery strategy: ask-on-risk (default).

## Objective
The label-size row stops being a "forced size + Apply button" and becomes a view of the label itself: the fields show what the
label declares, editing them (or picking a standard size) writes the label, like the Properties panel does.

## Problem
- The combo picked a "forced size" that overrides the drawing even when the label says something else, so warnings about
  mismatches appeared and "Aplicar a la etiqueta" was needed to sync (js/ui.js createSizePanel, js/core/sizes.js view/check).
- The only catalog entry, "Bobina 99×55 (TEC)", was printer specific, flagged `required: true` (error on mismatch,
  js/languages/tpcl.js matchesSize) and carried a TPCL-only `{AX…|}` in a language-agnostic catalog (js/config.js:22).

## Agreed design (user confirmed)
- Fields Ancho/Alto/Paso always show the label's declared size (mm). Editing a field and leaving it (`change`) writes the size
  to the label (same path as the old Apply: sizes.apply + editor.setText + refresh). Non-positive/invalid input reverts to the
  label's values. No "Aplicar a la etiqueta" button.
- Combo = standard label sizes + "Personalizado…". Picking a standard writes it to the label. Opening/editing a label marks the
  standard that equals the declared size, else "Personalizado". "Según la etiqueta" is removed.
- Standard sizes (mm, pitch = height + 3): 100×150, 100×100, 100×60, 80×50, 60×40, 50×30, 40×30.
- Removed: `required`, "— obligatorio", the "Bobina 99×55 (TEC)" entry and the AX in the catalog. A label that already has
  `{AX…|}` is left untouched; TPCL applySize writes only `{D…|}`.
- The drawing always follows the label. If the label declares no size, the fields show the fallback (config.fallbackSize,
  99×55, pitch empty) and editing them writes it.

## Tasks
- [x] T1 Size model: new catalog, no `required`/`native.tpcl.ax`/forced size in sizes.view; tpcl/tspl matchesSize and AX removed.
- [x] T2 Size panel + app wiring: fields reflect the label, write on change, combo writes standards, no #btnApply; index.html,
      tests, README/CONTRIBUTING.
- [x] T3 TSPL size writing (user confirmed): TSPL language gets sizeCommands/applySize: `SIZE w mm,h mm` and, when pitch > height,
      `GAP (pitch-height) mm,0 mm`; replaces existing SIZE/GAP lines, else inserts; pitch == height leaves an existing GAP untouched;
      BLINE/BITMAP bytes and line endings preserved; tests (incl. round trip with the parser) and README note updated.

## Route declaration
Delegated direct: one writer (2+ non-trivial files across ui/app/sizes/languages/tests/docs).

## Verification
`node --test` (all green). Browser checks by the user: combo lists the standards + Personalizado; editing Ancho and tabbing
out rewrites `{D…|}` / `SIZE`; picking a standard rewrites the label; opening a label selects the matching standard.

## Progress
- T1 done: config.sizes is now the seven standard sizes (id `<w>x<h>`, name `<w>×<h> mm`, p = h + 3, no `required`/`native`); sizes.view(model) follows the label or the
  fallback (warning now points to the Formato row); sizes.check and tpcl matchesSize/axOf removed; tpcl sizeCommands/applySize write only `{D…|}` and leave an
  existing `{AX…|}`; TPCL emit no longer takes AX from the catalog (reuses source axRaw only, else info "No se escribe {AX…|}"); examples lose `sizeId`.
  New tests/size-model.test.js (10 tests); 7 of them failed before the change; existing tests updated. Suite 617 green.
- T2 done: createSizePanel(els, catalog, { onApply }) with init/showArea/selectFor only; fields always show the label's size, `change` writes a custom size
  (empty Paso = height, invalid reverts), picking a standard writes it, Personalizado writes nothing, showArea skips the field being edited; app wires
  selectFor on every refresh, drops `fresh`/`sizeId`/current(); #btnApply removed from index.html and the structure tests; README (Formato section) and
  CONTRIBUTING updated. New tests/size-panel.test.js (9 tests, all failed before the panel change). Suite 626 green.
- T3 done: tspl.js gets sizeCommands/applySize (SIZE always, GAP = pitch - height only when pitch > height; replaces the first SIZE/GAP command found with the
  parser's tokenizer, else inserts SIZE at the top and GAP after it; keeps line ending/trailing newline; BITMAP/BLINE/quoted text untouched; pitch == height keeps an
  existing GAP). New tests/tspl-size.test.js (11 tests, all failed before: no hooks); tspl-app tests updated; README/CONTRIBUTING no longer say TSPL cannot write the size.
  Suite 637 green.
- Superseded 2026-10-09: RESOLVED by `feat/label-gap` (merge 83f3516, odd/tasks/label-gap.md): the TSPL parser now derives pitch = height + gap and the TSPL <-> TPCL conversion carries it, so the Paso / Separación field and the combo match work for TSPL; the README no longer says the pitch is not converted. Original open note:
- Open (historical): the TSPL parser reports the separation as size.gap and leaves size.pitch null (deriving it changed the TSPL -> TPCL conversion and 6 cross-conversion tests,
  and the README says the pitch is not converted), so the Paso field of a TSPL label stays empty and the combo shows "Personalizado…" even after writing a standard
  size. Decide whether the parser should expose pitch = height + gap (and the TSPL -> TPCL conversion then carries it).
  Browser checks pending (see Verification).
- T3 follow-up (user confirmed): sizes.declaredPitch(size) = declared pitch, else height + gap (TSPL) for display only; sizes.view and the
  combo matching (app.js selectFor) use it, the parser still leaves pitch null so TSPL<->TPCL conversion is unchanged. 640 tests green.
