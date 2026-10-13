# TSPL small fixes (block height in mm, `GAP 0`)

Status: IN PROGRESS (started 2026-10-13 on `feat/tspl-small-fixes`). Both items come from `odd/tasks/optional-backlog.md` ("Other optional items");
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
- [ ] T1 Alto (mm) field for the TSPL block.
- [ ] T2 `GAP 0` written when the gap is emptied or typed as 0.

## Progress
(empty)
