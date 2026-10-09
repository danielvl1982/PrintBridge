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
- [x] V1 TPCL label setup and shapes: `{D`, `{AX`, `{C`, `{XS`, `{LC` lines, boxes, `{XR` areas, ellipses
- [x] V2 TPCL text: PC / PV (sizes, spacing, rotation, attribute, bold, counter, zero suppression, alignment, P5 block), RC / RV data
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

### V1 TPCL label setup and shapes
Manuals: B-SV4 2004 (SV4), B-452-R 2012 (R), B-452-TS12 ES 2001 (TS12), B-x72 ES 2001 (x72). Line numbers are those of `pdftotext -layout` of each PDF.
Printer behaviour quoted from SV4 (line 704+, "About D command"): a parameter with the wrong number of digits or a value out of range is a
command error, EXCEPT the {D values, which the printer changes to the limit itself; pitch < length is a command error; pitch - length < 2 mm
becomes length = pitch - 2 mm.

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| `{D` pitch (aaaa) | 0100..9999, 4 or 5 digits (R 1228+; SV4 779+ says max 6096 for its model, its table 10.0..1000.0 mm; TS12 1024+ requires 4 digits) | Formato input had min 5 mm, no max / min 10, max 999,9 mm (pitch field, TPCL only) | written unchecked (could be 5 digits or > 9999) / clamped, raised to the length if smaller, ONE warning | none / warning out of range, digits, pitch < length; info for gap < 2 mm |
| `{D` width (bbbb) | 0100..1080, exactly 4 digits (R 1228+: 1057; SV4 table: 108 +-0.2 mm, the widest; TS12 table 105.7) | min 5, no max / min 10, max 108 mm | unchecked / clamped, one warning | none / warning |
| `{D` length (cccc) | 0060..9970, 4 or 5 digits (R 1228+; TS12 table min 11 mm for its model; SV4 table min 8 mm) | min 5, no max / min 6, max 997 mm | unchecked / clamped, one warning | none / warning |
| `{D` 4th (backing paper) | 0300..1120 (R 1228+); SV4 "ignore" | not offered | kept only while the size is unchanged | none / none (Open) |
| `{AX` feed bbb | 000..500 (SV4 984+, R 1447+; TS12 1230+: 000..100) | not offered | source AX copied verbatim / copied only if valid, else dropped with a warning | none / warning with range or malformed |
| `{AX` cut ddd | 000..500 (R; SV4 000..350; TS12 000..100) | - | same | same |
| `{AX` back feed ff / correction hhh | 00..99 (all); hhh 000..100 in 0.1 % (TS12 1230+ only, optional 4th) | - | same | same |
| `{C` | no parameters (SV4 1215+) | - | always `{C|}` | unchanged ("not supported" if it had text) |
| `{XS;I,...` | count 0001..9999, cut 000..100, sensor 0..5 (TS12 1.. "5 is read as 2"), mode C/D/E, speed 1..9/A (SV4; R and TS12 list 2 and 4 only), ribbon 0..2, rotation 0..3, status 0..1 (SV4 4924+, R 6467+, TS12 4906+) | - | always the reference `XS;I,0001,0002C4100` (valid) / unchanged | none (ignored) / warning per out-of-range parameter, or malformed |
| `{LC` type e | 0 line, 1 rectangle, 2 dashed line, 3 dashed rectangle (R 1884+, TS12 1602+; SV4 1337+ and x72 3037+: 0..1) | select Linea/Caja / a dashed type shows its base shape | n/a / unchanged (dashed is not modelled) | type 2 was read as a rectangle, 4..9 silently / 2 = line and 3 = rectangle with an info (drawn continuous), 4..9 drawn as 3 with a warning |
| `{LC` width f | 1..9 (SV4, TS12, x72), 01..99 (R 1884+) | number 1..99 (already right) | clamped to 99 + warning (already) | 0 or > 99 or 3 digits silently / warning, drawn as the nearest valid thickness, native keeps what was written |
| `{LC` radius ggg | exactly 3 digits, 0.1 mm, rectangles only; no numeric range given (SV4 1337+, R 1884+) | number 0..999 (already right) | clamped to 999 + warning (already) | none / warning when not 3 digits |
| `{LC` / `{XR` coordinates | X exactly 4 digits, Y 4 or 5 digits (SV4 1237+ and 1337+, R 1775+ and 1884+; TS12 1602+ and x72 3037+: 4 digits all); inside the label area (note 3) | number 0..9999 (already right) | clamped to 0..9999 + one warning (already) | none / warning per command when X is not 4 digits or Y not 4 or 5, values read as written |
| `{XR` type e | A clear, B reverse | select (already right) | already | unknown type warns and skips (already) |
| Ellipses / circles | no TPCL command in any of the four manuals (a rounded LC rectangle with radius = half the side is a circle, LC note 5) | no palette entry (already) | skipped with one warning (already) | n/a |
| Coordinates shared by every item | clampCoord / MAX_COORD 9999: right for X; Y accepts 5 digits in SV4 / R but a label is at most 9970 long, so beyond 9999 is never inside the printable area | - | kept at 9999 | text items keep the existing 4-digit rule (V2) |

Other changes: the parsed {D size is drawn clamped (that is what the printer does) while `native.dRaw` keeps the command as written; `PB.languages` entries may
declare `sizeLimits` and `fitSize` (TPCL does); `PB.sizes.apply` returns the fit diagnostics and the app shows them as notices.
Expectation changes in existing tests: tests/area-slice.test.js fixture D now has a 3 mm gap (it had pitch = length, which now reports the 2 mm information); LC `native`
now also holds the type as written (tests/shape-radius.test.js, tests/units-and-source.test.js).

### V2 TPCL text (`{PC`, `{PV`, `{RC`, `{RV`)
Manuals as in V1 (SV4 6.3.7 / 6.3.8 and RC 6.3.10 from line 1498 of its text, R 6.3.8 / 6.3.9 from line 2090 / 2838, TS12 6.10 / 6.11 from line 1835 / 2470, x72 same family). Magnification
and the P5 block were done earlier (tpcl-magnification, tpcl-text-types) and are only re-checked. "Parse before" = what the parser did with a typed value.

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| String number PC aaa / PV aa | PC 000..199 (two digits 00..99 also valid), PV 00..99 (SV4 1498+, R 2098, TS12 PV 2478) | no field | the 101st PV was written `100` (invalid) with a generic "more than 100 fields" / one warning naming PC 000..199 / PV 00..99, not renumbered | none / warning per command (digit count, range) |
| X / Y | X exactly 4 digits, Y 4 or 5 (SV4, R); TS12 PV says 4 for both | number 0..9999 (V1) | clamp 0..9999 + warning (already) | a 5-digit Y warned as not 4 digits / valid (4 or 5), X still exactly 4 |
| PV width dddd / height eeee | 0020..0850, 4 digits (SV4 1531+, R 2852; TS12 2495+: fonts A, B 0850, E..I 0600, TrueType 0400; the widest is used) | number 1..9999 / 20..850 | `pad4(max(1, n))` up to 9999 / clamped to 0020..0850 + one warning | none; size 0 gave NaN / drawn clamped, warning with the range and the digits, panel still reads what is written |
| PV font f | A, B (all); E..J (R), E..I (TS12); 01..25 TrueType has another syntax (SV4 1539+, R 2858+, TS12 2515+) | A, B only (valid) | always B | any letter accepted / warning for a letter outside A, B, E..J |
| PC font ff | A..T (TS12 1865+; R has more incl. kanji, q, r, v, w, 01..55; SV4 only E, J, M, N, O, Q) | A..T (valid) | letters from the bitmap table | unknown letter warned (already) / unchanged |
| Spacing ghh (PC) / ghhh (PV) | PC +-00..99 (2 digits), PV +-000..512 (3 digits) (SV4 1553+ and 1580+, R 2238, TS12 1920 and 2535) | -99..99 / -512..512 (already) | clamped silently / clamped + one warning | any digit count / warning for the wrong digit count or range; drawn limited, native keeps the digits |
| Rotation ii | 00, 11, 22, 33 | select (valid) | nearest quarter turn + warning (already) | unknown code warned (already) |
| Attribute W / F aabb, C aa | 01..99 dots each; B has none (SV4 1568+, R, TS12 1950+) | 1..99 (already) | clamped silently / clamped + one warning | 0, wrong digit counts silently / warning; 00 drawn as 1, native keeps it |
| Bold Jkkll (PC) | kk, ll 00..16 (SV4 1580+, R 2301+, TS12 1975+); PV has none | 0..16 (already) | clamped silently / clamped + one warning | clamped to 16 silently, J on PV and bad digits silently / warning for each |
| Check digit Mm / Mk | 0, 1, 2 (SV4 1587+, R 2318, TS12 1985+) | not modelled | never written | ignored / warning for a value outside 0..2 (Open: not drawn) |
| Increment noooooooooo | sign + 10 digits, 0000000000..9999999999 | +-9999999999 (already) | clamped + warning (already) | malformed token silently ignored / warning |
| Zero suppression Zpp / Znn | 00..20 (SV4 1594+, R 2330, TS12 2006) | 0..20 (already) | clamped silently / clamped + one warning | Z25 read as 20 silently, malformed Z silently / warning with the range |
| Alignment P1..P3, P4aaaa | aaaa 0050..1040 (SV4, R) / 0050..1057 (TS12); 1057 used (V1 decision) | width 50..1057 (already) | width clamped silently / clamped + one warning | width read as written and drawn as written / drawn as the nearest valid, native keeps the digits (panel shows what is written), warning; P6, P4 without 4 digits, unknown tokens now warn |
| P5aaaabbbcc (PC only) | aaaa 0050..1057, bbb 010..500, cc 01..99 (done in tpcl-text-types) | fields with those ranges (already) | clamped + warning (already) | warning (already); P5 on PV now warns "only PC" |
| Data string | max 255 characters, the excess is discarded (SV4 1949+, R 2648, TS12 2027; 127 for kanji fonts, not modelled) | content field maxLength 255 (already) | any length / cut to 255 + one warning | any length / cut to 255 (what the printer prints) + warning, inline `=` and `{RC` / `{RV` |
| Link fields `;ss` | 01..99, up to 20 | not modelled | never written | ignored (swallowed by the optional parameters) / unchanged (Open) |
| Unknown optional parameter | order `(,J)(,M)(,n)(,Z)(,P)` | - | - | silently skipped / warning with the token |

Other changes: palette `build` and the PC <-> PV switch take a free number inside 00..99 (the lowest free one when the next is above 99, nothing when all 100 are used); the "Tipo de fuente" note says when the PC -> PV switch limits the size
to 0020..0850. `PB.languages` TPCL helpers gain `fitTextData` / `TEXT_DATA_MAX`.
Expectation changes in existing tests: PV sizes in tests/update-item.test.js (20..850 instead of 1..9999); the TSPL example label has a 1.5 mm text, which TPCL can only write as 2 mm (PV minimum 0020), so
tests/cross-conversion.test.js documents one extra warning for tspl-label-100x60 -> tpcl and the text-size comparison floors a PV text at 20; tests/conversion-matrix.test.js accepts the PV size warning among the font
diagnostics (and `font.size` / `font.width` as may-differ keys for the two example labels); the TSPL BLOCK-with-PV test tolerates the same warning.

## Open (manuals silent or contradictory; kept as is)
- V1 `{D` 4th parameter (backing paper width, R 0300..1120, ignored by SV4): not validated, kept only while the size is unchanged.
- V1 `{LC` radius: the manuals only fix 3 digits (0..999); no relation to the rectangle size is stated (the viewer limits the drawn radius to half the shorter side).
- V1 `{LC` width: R allows 01..99 but SV4, TS12 and x72 say 1..9 only; the widest (99) is kept and written with 2 digits as before.
- V1 Items outside the effective print area ({D width x length): LC / XR notes say they "must be inside"; no check is made (the viewer draws them).
- V1 `{D` model tables (SV4 table, TS12 table) give model-specific limits (for example length 8..998 mm, width 13..108 mm); only the command-level ranges are used.
- V1 A converted label without a pitch is written with pitch = length, which the printer shortens by 2 mm (information added to the existing pitch notice); inventing a 2 mm gap was not done.
- V1 TPCL could draw a circle as a rounded LC rectangle (LC note 5); today ellipses and circles are skipped with a warning (a feature, not a validation).
- V2 Check digit `Mm` / `Mk` is read but not modelled (never drawn, never written); a typed M3 only warns.
- V2 Link fields (`;01,02` instead of `=data`) are not modelled: the command is read without data.
- V2 PV fonts E..J (price fonts, TEC FONT 2 / 3, Gothic 725) and TrueType 01..25 are not offered (the viewer draws every PV font the same); R limits TrueType to 0400 and TS12 limits E..I to 0600, only 0850 is used.
- V2 PC fonts beyond A..T (kanji U..X, q, r, v, w, writable characters 01..55) are warned as unknown and drawn as J; data limit 127 for those fonts is not applied.
- V2 Equal-space and block width: SV4 / R say 0050..1040, TS12 0050..1057; 1057 is kept (V1 decision), so a 1041..1057 value is written without warning.
- V2 The character code table (allowed characters of the data) is not validated beyond the framing characters `{ } |` and line breaks, which become spaces.
- V2 Counters: the manual allows at most 32 incrementing fields and 40-digit data; not checked.
- V1 Issue speed: SV4 lists 1..9 and A, R and TS12 only 2 and 4 (model dependent); the widest is accepted.

## Progress
- V1 (route: delegated writer, one writer, direct; RED first: 22 of the 32 new tests failed on the old code): TPCL label setup and shapes (tests/tpcl-label-setup.test.js, tests/tpcl-shapes-validation.test.js). Verification: `node --test` 4015 tests, 4014 pass, 0 fail, 1 skipped (was 3983 / 3982 before; +32 new). Commit: see `git log` (fix: validate TPCL label setup and shape values against the manuals).
- V2 (route: delegated writer, one writer, direct; RED first: 31 of the 34 new tests failed on the old code): TPCL text (tests/tpcl-text-validation.test.js, 34 tests). Verification: `node --test` 4049 tests, 4048 pass, 0 fail, 1 skipped (was 4015 / 4014 before; +34 new). Commit: see `git log` (fix: validate TPCL text values against the manuals).
