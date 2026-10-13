# TSPL small fixes (block height in mm, `GAP 0`)

Status: IMPLEMENTED, browser and printer checks pending (started 2026-10-13 on `feat/tspl-small-fixes`; not merged or pushed). Both items come from `odd/tasks/optional-backlog.md` ("Other optional items");
the user picked them as the easy ones (difficulty verified in the code the same day).

## Objective
1. **T1 "Alto (mm)" for the TSPL text block.** Today the block height is `lines * pitch` (js/components/text/tspl.js `emitBlock`) and Propiedades
   only has **Líneas máx.** Add an **Alto (mm)** field that shows the height of the block and, when edited, sets `lines` rounded to whole
   lines (`lines = max(1, round(height / pitch))`, the field then shows the rounded height). No model change.
2. **T2 `GAP 0`.** Today the TSPL writer writes `GAP` only when pitch > height (js/languages/tspl.js `sizeCommands`, ~line 675) and an existing
   `GAP` line is left alone when pitch == height (~line 683). Write `GAP 0 mm,0 mm` when the user empties the gap or types 0 (the manual allows
   `0 <= m <= 1 inch`), replacing an existing `GAP` line, and do not invent a `GAP` when the gap was never specified. This needs a way to tell
   "explicit zero gap" from "unknown" in the neutral size (check how the Formato row and `size.gap` / `size.pitch` derive each other, label-gap.md).

## Constraints
- Test first (RED, GREEN), full `node --test` green, README (TSPL section, Formato row) and this doc updated in the same commits as the behavior.
- Delivery: one branch, one work-unit commit per task, merged and pushed to `main` only on the user's go. Forecast well under 400 lines.
- Nothing is verified on a printer: a TSC test of `GAP 0` (continuous media) stays pending.

## Tasks
- [x] T1 Alto (mm) field for the TSPL block. Commit 1286e49. Route: delegated direct (writer). Tests: tests/tspl-block-height.test.js (10 cases).
- [x] T2 `GAP 0` written when the gap is emptied or typed as 0. Commit d8ab012. Route: delegated direct (writer). Tests: tests/tspl-gap-zero.test.js (13 cases).

## Decisions
- **T1.** New field `blockHeight` ("Alto (mm)", min 0, step 0.01) right after `blockLines`, flagged `reemit`: it shows `lines * pitch` in mm (pitch = character
  height in dots + the `BLOCK` space; rounded to 0.01 mm) and its write goes through `reemitText`, which turns `height * 10 / dot / pitch` into lines with the same
  `max(1, round(.))` and `MAX_BLOCK_LINES` (999) as **Líneas máx.**; if both keys are given, the lines win. No model change. A non-numeric or non-finite value
  refuses the edit (text unchanged); the pitch is always at least 1 dot, so it cannot be zero; a block without a valid height argument has neither field; a line
  gets the field once Tipo makes it a block. The height shown is `block.lines * pitch`, not the raw height argument (which can be a non-multiple of the pitch).
- **T2.** The neutral size already tells the cases apart: the TSPL parser sets `size.gap = 0` for `GAP 0` (and `pitch` stays null: `gap > 0` is still required to set
  it) and leaves `gap` null when there is no `GAP`. What was missing is the Formato row's way to say "explicit zero" in the resolved size `{ w, h, p }`, where
  pitch == height only means "unknown". Smallest change: the row sets `zeroGap: true` (TSPL mode only) when the gap field was edited and is emptied or typed as 0
  (a field that was already empty and is left alone sets nothing, so a gap never specified is not invented, and a width or height edit keeps working as before);
  `sizeCommands` writes `GAP 0 mm,0 mm` for `zeroGap` when pitch == height, and `applySize` replaces the existing `GAP` line or adds it after `SIZE`. A real gap wins
  over the flag. TPCL and ZPL ignore the flag (no change in their code), and the neutral model and the parsers are untouched.
- **Conversions.** TSPL `GAP 0` -> TSPL keeps the line; -> TPCL writes `{D<height>,...}` (pitch = height, with the existing information that the pitch was not specified);
  -> ZPL writes `^PW` / `^LL` with the existing information about the gap. Back to TSPL from TPCL or ZPL no `GAP` is written (TPCL cannot say "gap 0": pitch = height is
  also an unspecified gap), so nothing is invented, and the explicit zero is the only thing lost, as for any other gap in ZPL. No new matrix row was needed: the cases are
  in tests/tspl-gap-zero.test.js at 203 and 300 dpi.

## Progress
- 2026-10-13 T1 and T2 done test first (RED then GREEN). Full `node --test`: 4654 tests, 4652 pass, 0 fail, 2 skipped (4631 before the work).
  Two existing tests that pin the field list of a TSPL block were updated for the new `blockHeight` key (tests/text-block-properties.test.js, tests/tspl-properties.test.js).
  README: block fields (Alto (mm)) and the Formato row (GAP 0). Authored lines are well under 400 per task.
- Delivery: nothing pushed; merge to `main` on the user's go.

## Browser and printer checks pending
- Browser: **Alto (mm)** edited in the Propiedades panel of a TSPL block (value, step 0.01, rounding to whole lines, the field showing the rounded height afterwards, undo with Ctrl+Z).
- Browser: Formato row of a TSPL label: empty the **Separación (GAP)** field or type 0 and check that `GAP 0 mm,0 mm` replaces the line; leave an empty field alone and check nothing is added.
- Printer: `GAP 0 mm,0 mm` on a TSC printer with continuous media (not verified on any printer).
