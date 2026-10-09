# Field validation audit (UI, conversion, typed code) against the manuals

Status: IN PROGRESS (started 2026-10-09 on branch `feat/field-validation-audit`). Requested by the user: after the TPCL block width limit turned out
to be 1040 (English manuals) vs 1057 (Spanish manual), check that EVERY value the app writes, converts or accepts is valid for the printer, in
TPCL, TSPL and ZPL. The user will review and test everything at the end (reviews are postponed until all tasks are done).

## Objective
For every command parameter the app handles, the three surfaces agree with the manuals:
1. **Properties panel (UI)**: min / max / step / select options of each field only offer values the printer accepts.
2. **Emit and conversion**: nothing is ever written out of range or in a form the printer rejects; a value that has to be adjusted is clamped
   or snapped AND reported once in the diagnostics frame (avisos), as the existing clamps do.
3. **Typed / pasted code**: a value out of the manual's range is read as written (never silently rewritten), drawn as the nearest valid one
   when needed, and reported in the diagnostics frame (warning that says what the printer will do, with the valid range).

## Rules for every task
- The manuals in `docs/` (local PDFs; use `pdftotext -layout` into the scratchpad) are the source of truth. When editions disagree (e.g. TPCL
  P5 width 1040 vs 1057) take the widest value supported by at least one manual of the target family and record it; when the manuals are silent,
  keep the current behavior and list it under "Open" (never invent a limit).
- Record per task a short table in "Findings": parameter, manual range (source + page / line), current UI limit, current emit behavior, current
  parse warning, and what was changed.
- Default test-first: RED (a failing test per fix), GREEN, `node --test` green. Tests live in `tests/`. UI text in Spanish, code, comments, docs,
  commits in English. No AI attribution in commits (conventional commits).
- About 400 authored changed lines per task is only a planning heuristic, not a cap.
- Each task ends with one work-unit commit on this branch; evidence (commit hash, test count) recorded below. No push.

## Tasks (one writer at a time; check off only after observed tests)
TPCL (manuals: docs/tpcl)
- [ ] V1 TPCL label setup and shapes: `{D`, `{AX`, `{C`, `{XS`, `{LC` lines, boxes, `{XR` areas, ellipses
- [ ] V2 TPCL text: PC / PV (sizes, spacing, rotation, attribute, bold, counter, zero suppression, alignment, P5 block), RC / RV data
- [ ] V3 TPCL barcodes (`{XB` types, widths, ratios, heights, check digits, data lengths and character sets), QR, Data Matrix
- [ ] V4 TPCL images (`{SG`)
TSPL (manual: docs/tspl)
- [ ] V5 TSPL label setup and shapes: `SIZE`, `GAP`, `DIRECTION`, `REFERENCE`, `SPEED`, `DENSITY`, `LINE`/`BAR`, `BOX`, `ELLIPSE`, `CIRCLE`, `ERASE`, `REVERSE`
- [ ] V6 TSPL text: `TEXT`, `BLOCK`, fonts, multipliers, rotation, `SET COUNTER` / `@` variables
- [ ] V7 TSPL barcodes, `QRCODE`, `DMATRIX`
- [ ] V8 TSPL images (`BITMAP`)
ZPL (manuals: docs/zpl vol 1 and 2)
- [ ] V9 ZPL label setup and shapes: `^PW`, `^LL`, `^LH`, `^FO`/`^FT`, `^GB`, `^GC`, `^GD`, `^GE`, `^FR`, `^LR`
- [ ] V10 ZPL text: `^A`, `^CF`, `^FB`, `^FW`, `^SN`, `^FN`, character sizes per resolution
- [ ] V11 ZPL barcodes (`^B*`, `^BY`), `^BQ` QR, `^BX` Data Matrix
- [ ] V12 ZPL images (`^GF`, `~DG`)
Cross cutting
- [ ] V13 Conversions: every value converted TPCL / TSPL / ZPL lands valid in the target (clamp / snap + one aviso); matrix of tests per pair
- [ ] V14 Close: README (validation rules and their sources), conversion matrix doc, full `node --test`, Chrome probe of the panels for the three
      languages (screenshots outside the repo), this document finished, Engram mirror, merge request to the user

## Findings (filled by each task)

## Open (manuals silent or contradictory; kept as is)

## Progress
