# Field validation audit (UI, conversion, typed code) against the manuals

Status: DONE, PENDING USER REVIEW (started 2026-10-09 on branch `feat/field-validation-audit`). Requested by the user: after the TPCL block width limit turned out
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
- [x] V3 TPCL barcodes (`{XB` types, widths, ratios, heights, check digits, data lengths and character sets), QR, Data Matrix
- [x] V4 TPCL images (`{SG`)
TSPL (manual: docs/tspl)
- [x] V5 TSPL label setup and shapes: `SIZE`, `GAP`, `DIRECTION`, `REFERENCE`, `SPEED`, `DENSITY`, `LINE`/`BAR`, `BOX`, `ELLIPSE`, `CIRCLE`, `ERASE`, `REVERSE`
- [x] V6 TSPL text: `TEXT`, `BLOCK`, fonts, multipliers, rotation, `SET COUNTER` / `@` variables
- [x] V7 TSPL barcodes, `QRCODE`, `DMATRIX`
- [x] V8 TSPL images (`BITMAP`)
ZPL (manuals: docs/zpl vol 1 and 2)
- [x] V9 ZPL label setup and shapes: `^PW`, `^LL`, `^LH`, `^FO`/`^FT`, `^GB`, `^GC`, `^GD`, `^GE`, `^FR`, `^LR`
- [x] V10 ZPL text: `^A`, `^CF`, `^FB`, `^FW`, `^SN`, `^FN`, character sizes per resolution
- [x] V11 ZPL barcodes (`^B*`, `^BY`), `^BQ` QR, `^BX` Data Matrix
- [x] V12 ZPL images (`^GF`, `~DG`)
Cross cutting
- [x] V13 Conversions: every value converted TPCL / TSPL / ZPL lands valid in the target (clamp / snap + one aviso); matrix of tests per pair
- [x] V15 Report every value the Propiedades panel adjusts: generic `adjustmentNotice` (js/properties.js) called from `changeProperty` (js/app.js); RED/GREEN
      unit tests, Chrome probe of the 49 out-of-range cases (closes the V14 Open item).
- [x] V14 Close: README (validation rules and their sources), conversion matrix doc, full `node --test`, Chrome probe of the panels for the three
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

### V3 TPCL barcodes, QR, Data Matrix (`{XB`, `{RB`)
Manuals: SV4 6.3.9 / 6.3.12 (text lines 2686+ / 4316+), R 6.3.10 / 6.3.13 (3479+ / 5699+), TS12 6.12 / 6.15 (3100+), x72 same family. Check digit table at R 3500+, widths examples at R 4540+, data lengths at R 5720+ and
the per-type data tables of SV4 chapter 13 (10214+: EAN / UPC digit counts, already handled by the EAN encoder). The three editions agree on every range below except where noted.

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| Bar code number aa | exactly 2 digits 00..31, all forms (R 3490+, 4177+, 3855+) | no field | the 33rd XB was written `32` unreported (only the 100 limit was checked) / one warning past 31 | none / warning per command (digits, range) |
| Type of check digit e | 1..5 (R 3530+); WPC 1..5, Code 93 / 128 1..3, Code 39 / ITF / MSI / 2 of 5 1..5, NW7 1 | select per type with the valid ones (already) | Code 128 was written with `0` (invalid) / written with `1` ("without attaching"; Code 128 always attaches it, R 4560+ note f) | unknown value read as unsupported / warning with 1..5 (Code 128 types 9 / A tolerate 0, see Open) |
| 1-module width ff (generic form: WPC, Code 93, Code 128, UCC/EAN128, postal) | 01..15 dots (SV4 2760+, R 3540+, TS12 3150+) | module field 1..99 / 1..15 | clamped to 99 silently-ish (one generic warning) / clamped to 15 + one warning naming 01..15 | module 0 read as 2, 40 drawn as 40 / warning with the range, drawn as the nearest valid (15 or 1), native and panel keep what was written |
| Bar / space widths ff gg hh ii jj (widths form: Code 39, ITF, MSI, NW7, 2 of 5) | 01..99 dots each; ii = 00 for Industrial 2 of 5, jj = 00 for MSI / ITF (R 3640+) | not exposed | narrow space, wide bar, wide space and gap could be written `00` / written 01..99 (one warning), the fixed fields always `00` (ITF / MSI gap used to be written as the item had it) with one warning when an ITF / MSI item carried a gap | 100, 000 or 1 digit silently / warning per field with the range and digit count, drawn as the nearest valid width, native keeps the digits |
| Rotation k | 0..3 | select (already) | nearest quarter turn + warning (already) | anything else silently 0 / warning with 0..3 |
| Height llll | 0000..1000 (0.1 mm), 4 digits; 0000 = not drawn (R 4600+) | number 1..9999 / 1..1000 | clamped to 9999 / clamped to 1000 + one warning | 1200 drawn as 1200, 0 silently 100, 3 digits silently / warning with the range, drawn as 1000; 0000 warns that the printer draws nothing (drawn with the default height) |
| Increment mnnnnnnnnnn | sign + 10 digits 0000000000..9999999999 | -9999999999..9999999999 (V2) | clamped + warning (V2) | malformed token silently ignored (and read as the readable flag) / warning |
| Guard bar ooo (WPC only) | 000..100 (0.1 mm), 3 digits | not exposed | clamped to 100 silently / one warning | 150 drawn as 150 / warning, drawn as 100 |
| Readable p, zero suppression qq, start / stop r | p 0 / 1, qq 00..20, r T / P / N | checkbox, 0..20 (V2) | already valid | 2 -> false, 25 -> 20, X ignored silently / warning for each (incl. unknown optional tokens) |
| Data string | max 126 characters for 1D codes, 2000 for QR / Data Matrix, the excess is discarded (R 5720+, SV4 4352+, TS12 4630+; SV4 inline `=` says 2048 for Data Matrix, RB 2000: 2000 used) | content field | any length / cut with one warning (data with variables is left alone) | any length / cut (what the printer prints) + warning; inline `=data` of the 1D and QR commands is now read (it was dropped) |
| Data per type | EAN / UPC / Code 93 / NW7 / MSI / 2 of 5 digit counts and characters (SV4 ch. 13); Code 39 standard set; ITF digits; Code 128 ASCII | - | EAN / UPC / Code 93 / NW7 / MSI / 2 of 5 already reported / Code 39, ITF and Code 128 (non ASCII 0-127) reported once per symbology | drawing warnings of the encoders (already) |
| QR 1-cell width ff | 00..52 dots; 00 = not drawn (SV4 3275+, R 4195+, TS12) | number 1..99 / 1..52 | clamped to 99 / clamped to 52 + one warning | 60 drawn as 60 / warning, drawn as 52; 00 warns that the printer draws nothing |
| QR error correction e, mode g, rotation h, model Mi, mask Kj, connection Jkkllmm | e L / M / Q / H, g M / A, h 0..3, Mi 1 / 2, Kj 0..8, kk 01..16, ll 01..16, mm 00..FF | ecc select (already) | fixed `A,0,M2` (valid) | only ecc checked / warning for each (missing parameters, mode, rotation, model, mask, connection, unknown token) |
| Data Matrix ECC type ee | 00..14 and 20 (SV4: 00..14 ignored, 20 = ECC200; R / TS12 list 00, 01, 04..14, 20) | not exposed | writes 20 (valid) | any value / warning outside 00..14 and 20 (the viewer still only draws ECC200, V-existing warning) |
| Data Matrix cell ff, format ID gg | ff 00..99; gg 01..06 / 11..16 (R, TS12), "no function" (SV4); 00 is written (SV4) | number 1..99 (already) | clamped + warning (already), `00` | 100 drawn as 100 / warning, drawn as 99; format ID outside 00..06, 11..16 warns |
| Data Matrix cells iii / jjj | 000..144; ECC200 even 10..144 square or the 6 rectangles, ECC000..140 odd 9..49; anything else = automatic | select of the table sizes (already) | only table sizes (already) | only the rectangles were reported / warning for any other value ("la impresora lo pone en automático"), rectangles keep their own message |
| Data Matrix connection Jkkllmmmnnn | kk 01..16, ll 02..16, ID 1 and 2 001..254 | not exposed | never written | read, reported as unsupported / also warned when out of range |

Other changes: shared helpers in `js/languages/tpcl.js` (`fitData`, `fitBarcodeData`, `rangeWarning`, `barcodeNumberWarning`, `BARCODE_DATA_MAX`, `MATRIX_DATA_MAX`) are passed to the slices; the generic-form
parse checks apply to the WPC types, Code 93, Code 128, UCC/EAN-128 and the postal types only (PDF417, MicroPDF417, MaxiCode, CP code have other parameters and are not touched).
Expectation changes in existing tests: Code 128 now writes check digit option `1` instead of `0` (tests/tpcl-emit-barcode-qr-image.test.js, tests/counter.test.js); module limit 15 (was 99), height limit 1000 (was 9999) and
QR cell limit 52 (was 99) in tests/tpcl-emit-barcode-qr-image.test.js and tests/update-item.test.js; ITF fixtures in the emit tests carry digits (letters now warn); the update-item Code 128 fixture has the manual's digit counts
and its short QR fixture is allowed its "faltan parámetros" warning.

### V4 TPCL images (`{SG`)
Manuals: SV4 6.3.21 (text line 6330+), R 6.3.22 (7965+), TS12 6.23 (6235+ of its text); x72 has no graphic command text. Line numbers are those of `pdftotext -layout`.
Related command: only `{SG`; the app uses no other image command (no graphic number, saving or recall exists in `{SG`; `{XO` / `{XQ` save whole command files, not modelled).

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| X aaaa | exactly 4 digits, 0.1 mm (SV4 6340, R 7975, TS12 6243); R adds the `D` dots suffix | position input without limits (a value over 999.9 mm gave a 5-digit X) / 0..999.9 mm | emitted images already clamped to 0..9999 (V1 coordText) / unchanged; the overlay insert wrote 5 digits or clamped negatives silently / refused with an error naming 0..999,9 mm | none / warning when not 4 digits |
| Y bbbb | 4 or 5 digits (SV4, R; TS12 says 4) | as X / as X | as X | none / warning when not 4 or 5 digits |
| Width cccc | exactly 4 digits, dots (all three; ignored for BMP / PCX modes) | no limit in the panel (the conversion refused > 9999 dots) / unchanged (width in mm; the insert states the limit) | refused > 9999 with the generic "bitmap no válido" text / refused with a warning naming the limits | 3 digits silently, 0 and > 9999 warned / also warning for the digit count (0001..9999) |
| Height dddd | 4 or 5 digits, dots (SV4 6346, R 7990; TS12 says 4); the widest, 99999, is used | as width | limit 9999 for both / 1..99999 | refused above 9999 / refused above 99999, 3 digits warned |
| Image buffer | "the graphic width for only the smaller value of either the designated value or the max. buffer size (512 KB) is drawn" (SV4 6542, R 8192, TS12 "Página 153"); read as 512 KB (524288 bytes) of dot data, ((w+7)>>3) x h | no limit / the insert refuses with an error | written whatever the size / refused with one warning | drawn whole / warning, drawn with the rows that fit (`native` keeps the command as written) |
| Data mode e | 0 nibble overwrite, 1 hex, 2 BMP, 3 TOPIX, 4 nibble OR, 5 hex OR, 6 PCX (SG;) and 7 TOPIX XOR (R, SV4 lists 0..6); A only for `{SG0;` | n/a | always 0 (valid) | 0 and 4 drawn, others "no soportado" / the same, plus 8..9 or 2 digits warn with 0..7 |
| Data | 30H..3FH, ((w+7)>>3) x h x 2 characters for nibble modes | n/a | built from the bitmap (valid) | length mismatch warned / also characters outside 30H..3FH warned (drawn white) |
| Graphic number, rotation, magnification | not parameters of `{SG` (no graphic numbers, the image is drawn into the buffer at once; the only way to rotate is to rotate the bitmap, which the overlay does) | - | - | - |
| Data count ffff (`{SG0;`, mode A) | 4 digits, 0..4294967295 (R 8031+) | - | never written | `{SG0;` is not read (Open) |

Other changes: shared limits live in `PB.images.SG_LIMITS` / `sgBytes` / `rowBytes` (js/components/image/codec.js); TPCL gains `imageCommand` (js/languages/tpcl.js), so the overlay insert is
checked before writing (position, size, buffer) and an out-of-range image is refused with the usual "No se pudo insertar la imagen" error instead of an invalid `{SG`.
Expectation changes in existing tests: tests/sg.test.js (a 5-digit width now also reports its format, so two warnings).

### V5 TSPL label setup and shapes
Manual: B-442/443 interface manual (docs/tspl, 137 pages; an older subset: no QRCODE, SHIFT, ELLIPSE, CIRCLE, BOX radius, units `dot`, DIRECTION mirror; the code follows TSC TSPL/TSPL2 v3.0, which is not local). Line numbers are those of
`pdftotext -layout`. A parameter only v3.0 defines keeps its behaviour and is listed under Open. Lengths below are 0.1 mm in the code (1 inch = 25.4 mm).

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| `SIZE` m,n | no range; inch by default, `mm` (lines 209-227; `dot` is v3.0) | width / height min 5 mm, no max (no manual limit, Open) / unchanged | written whatever the value, 0 or negative gave `SIZE 0 mm,...` / a size <= 0 is not written, one warning | a size <= 0 was applied / reported and not applied (the label keeps no size) |
| `GAP` m | 0 <= m <= 1 inch (25.4 mm) (253+) | Separación field min 0, no max / min 0, max 25.4 mm (`sizeLimits.gap`) | gap above 25.4 (a converted TPCL pitch) or negative written as is / clamped to 0..25.4 mm, one warning | any value read, negative or huge drawn / warning with the range, drawn at the nearest limit, `gapRaw` keeps the text |
| `GAP` n | [-]n <= label length (253+) | not offered (always 0) | always 0 / same | none / warning when |n| is above the SIZE height (any command order) |
| `BLINE` m,n | m 0.1..1 inch (2.54..25.4 mm), n 0 <= n <= label length (285+) | not offered | never written | none / warning for m and for n, m drawn at the nearest limit |
| `OFFSET` m | 0 <= m <= 1 inch (25.4 mm) (317+) | not offered | never written | silently ignored / warning outside 0..25,4 mm or malformed |
| `SPEED` n | 1.5, 2.0, 3.0 depending on the model (344+) | not offered | never written | silently ignored / warning only when not a positive number (the set is model dependent, Open) |
| `DENSITY` n | 0..15 (362+) | not offered | never written | silently ignored / warning outside 0..15 or not a whole number |
| `DIRECTION` n | 0 or 1 (381+); the mirror m is v3.0 | not offered | `DIRECTION 1`, or 0 as read | warned already / message now says "0 o 1" (mirror Open) |
| `REFERENCE` x,y | dots, no range (400+) | not offered | never written (folded into the coordinates) | non numeric warned already / unchanged (negative values Open) |
| `SHIFT` | not in the local manual (v3.0) | - | never written | unchanged (Open) |
| `CLS`, `CUT` | no parameters (502+, 21+) | - | `CLS` written, `CUT` never | `CUT` is reported "no soportado por el visor" (unchanged: it is a printer action, nothing to draw) |
| `FEED` n | 1..65535 dots (520+) | not offered | never written | silently ignored / warning outside 1..65535 or not a whole number |
| `PRINT` m[,n] | m, n 1..65535 (583+) | not offered | always `PRINT 1,1` (valid) | silently ignored / warning per argument (sets, copies, missing m) |
| `BAR` x,y,w,h | dots, no range (690+) | width / height 1..9999 (Open: no manual max) | written >= 1 dot thick / same, the clamp to 1 is now reported once | w or h <= 0 warned already / unchanged |
| `BOX` x,y,xe,ye,t | corners upper left and lower right, thickness dots, no range (883+); the radius is v3.0 | thickness 1..9999, radius 0..9999 (Open) | thickness at least 1 silently / reported once; corners already normalized | end before start was drawn silently / warning, drawn as the rectangle the corners span |
| `ELLIPSE`, `CIRCLE` | not in the local manual (v3.0) | width / height / diameter / thickness 1..9999 (Open) | negative position and sizes under 1 clamped silently / each reported once | non positive measures warned already / unchanged |
| `ERASE`, `REVERSE` | x, y start; width and height in dots, no range (905+, 1179+) | width / height 1..9999 (Open) | position < 0 and size < 1 clamped silently / each reported once | non positive size warned already / unchanged |
| Coordinates and units | dots; 200 dpi 1 mm = 8 dots, 300 dpi 1 mm = 12 dots (SIZE note); no range for x / y | - | always whole dots from 0.1 mm at the label dpi (already) | read as written (already) |

Other changes: `PB.languages` TSPL gains `sizeLimits: { gap }` and `fitSize` (the same hook TPCL uses: `PB.sizes.apply` returns its diagnostics and the Formato row reads `limits[mode]`); `sizeCommands` and the emit header share the GAP clamp;
`PRINT` and `CLS` are separate handlers, and `OFFSET`, `DENSITY`, `SPEED`, `FEED` moved from the ignored list to checking handlers (still nothing drawn).
Expectation changes in existing tests: tests/tspl.test.js BLINE fixture is 3 mm (2 mm is below the manual's 2.54 mm minimum).

### V6 TSPL text (`TEXT`, `BLOCK`, `SET COUNTER`, `@n`)
Manual: B-442/443 (docs/tspl); `TEXT` at text lines 1190-1245, `SET COUNTER` at 3116-3150. `BLOCK` is not in the local manual at all (v3.0 only), nor are fonts 0, 6, 7, 8 and ROMAN.TTF.

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| `TEXT` x, y | dots, no range (1200) | not limited here (move field) / unchanged | whole dots (already) | unchanged |
| font | 1..5 = 8x12, 12x20, 16x24, 24x32, 32x48 dots, plus Chinese / Japanese / Korean `.BF2` fonts (1203+); 0, 6..8, ROMAN.TTF are v3.0 | select 1..8, 0, ROMAN.TTF (already) / unchanged | only 1..8 or 0 (already) | unknown font: info only / info now lists the known ids (1 a 8, 0, ROMAN.TTF) |
| rotation | 0, 90, 180, 270 (1224+) | select (already right) | nearest quarter turn + warning (already) | warned without the values / warning states "0, 90, 180 o 270" |
| x / y multiplier, bitmap font | whole 1~8 (1229+); 1..10 kept (v3.0, widest, see Open) | number 1..10 (already) | choice only for whole 1..10 (already) | 11, 2.6 silently drawn as typed / drawn as the nearest whole 1..10, warning with the range; native and panel keep what was written |
| x / y multiplier, scalable font | not in the local manual (point sizes of v3.0) | 1..200 (convenience) | whole points >= 1 (already) | 0 or negative: "se usa 1" / same, the warning now says what is valid |
| content | `"` is written `\["]`, CR `\[R]`, LF `\[L]` (1236+); no length given | content field | quotes escaped (already, test added), CR / LF become spaces + warning (already) | unchanged |
| `SET COUNTER @n` n | 0..49, 50 counters for text and barcode (3116+) | no field | counters beyond @49 written as plain text + warning (already) | `@50` and above gave a generic "no válido" / warning with "@0 a @49", nothing declared; the same warning for `@n="..."` and for a TEXT / BLOCK content that uses `@n` (once per number) |
| `SET COUNTER` step | -999999999 .. 999999999 (3116+) | "Incremento" field with those limits (already) | clamped + warning (already) | generic "no válido" / warning with the range (declares nothing, as before: the printer rejects it); a malformed command warns with the form `SET COUNTER @n paso` |

Other changes: `PB.languages` TSPL helpers gain `counterNumberWarning` (shared with the barcode slice in V7); `multiplier()` of the TSPL text slice returns the value to draw and the one written.
Expectation changes in existing tests: none (one new file, tests/tspl-text-validation.test.js).

### V7 TSPL barcodes, QRCODE, DMATRIX
Manual: B-442/443 (docs/tspl); `BARCODE` at text lines 735-840 (type list 700-760, ratio table 800+), `DMATRIX` 918-939. `QRCODE` is not in the local manual (TSC v3.0 only); its ranges are the ones the code already had. Counters 3116-3150.

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| `BARCODE` x, y | dots, no range (740) | move fields (unchanged) | whole dots (already) | unchanged |
| code type | 128, 128M, EAN128, 25, 25C, 39, 39C, 93, EAN13 / EAN8 / UPCA / UPCE (+2 / +5), CODA, POST (755-785) | select of the nine symbologies with their check options (only valid TSPL types, already) | unsupported symbologies (MSI, 2 of 5, ...) skipped with a warning (already) | unknown type drawn approximately and warned by the slice validator (already) |
| height | dots, no range | 1..9999 (convenience, Open) | 0 was clamped to 1 silently / reported once | 0 or negative refused (already); a fraction was drawn as written / warning, drawn as the nearest whole dot count |
| human readable | 0 / 1 (790); 2 / 3 left / center / right are v3.0, kept (widest) | select 0..3 (already) | 1 or 0 (already) | any other value silently meant "not readable" / warning with 0 a 3 |
| rotation | 0, 90, 180, 270 (795) | select (already) | nearest quarter turn + warning (already) | warned / the warning now lists the four values |
| narrow | dots (800) | 1..10 (convenience, Open) | clamped to 1 silently / reported once | 0 or negative: "se usa 2" (already); a fraction drawn as written / warning, drawn rounded |
| wide | dots; ratios 1:2, 1:3, 2:5 per type (table 800-830, garbled by the extraction) | 1..9999 for Code 39, ITF, NW7 | nearest manual ratio (already) | 0, negative, text or a fraction silently became 3 x narrow / warning, drawn as the nearest valid (or 3 x narrow) |
| content | no length given (840) | content field | data of EAN / UPC / Code 93 / NW7 reported (already) / also Code 39, ITF and Code 128 (ASCII 0-127) | encoder warnings (already) |
| arguments | 9, or 10 with the alignment | - | - | an 11th and later argument was ignored silently / warning |
| counter `@n` in the content | n 0..49 (3116) | - | beyond 50 counters written as text (already) | `@50` and above in a barcode content silently / warning with "@0 a @49" (same helper as TEXT) |
| `QRCODE` ECC | L, M, Q, H (v3.0) | select (already) | unknown -> M + warning (already) | unknown level was an info / warning naming L, M, Q o H |
| QR cell width | whole dots, 1..10 in the code (v3.0, Open) | 1..10 (already) | clamped to 1..10 + warning (already) | 14 drawn as 14, 3.6 as 3.6 / warning, drawn as the nearest whole 1..10, native keeps the text |
| QR mode, rotation | A / M, 0 / 90 / 180 / 270 | select (already) | A, 0 (already) | warned (already) |
| QR model M, mask S, justification J | model 1 or 2, mask 0..8, J 1..9 (code, v3.0) | not offered | never written | out-of-range ignored silently, unknown letters ignored silently / warning for each |
| `DMATRIX` x, y, width, height | dots, no range (926) | width / height 1..9999 (convenience) | whole dots (already) | non positive refused (already) |
| DMATRIX module xm | dots (934) | 1..99 (convenience) | >= 1 (already) | 0 or negative warned (already); a fraction / warning, drawn rounded |
| DMATRIX rows, columns | no range given; the viewer draws the square ECC200 sizes 10..144 | select of the table sizes | only table sizes (already) | other sizes warned with the 10..144 range (already) |

Other changes: `PB.languages` TSPL helpers gain `counterRefsWarning` (every `@n` of a content argument through `counterNumberWarning`, used by the three slices); Code 39 / ITF / Code 128 data checks of the emit use the same encoders as the other symbologies (no TPCL code shared).
Expectation changes in existing tests: tests/qr-tspl.test.js (an unknown optional parameter such as Q9 is now reported); new file tests/tspl-barcode-validation.test.js.

### V8 TSPL images (`BITMAP`)
Manual: B-442/443 (docs/tspl); `BITMAP` at text lines 848-872 (`BITMAP X, Y, width, height, mode, bitmap data`, example `BITMAP 100,100,10,1,2,1111111111`). `PUTPCX` (1148+) and `DOWNLOAD` (1507+) name files stored in the printer; `PUTBMP` / `PUTPNG` are not in the local manual. The !B / !J commands (1452+) belong to the Windows driver and are not read.
The manual fixes only the mode; X, Y, width and height have no range (width "in bytes", height "in dot").

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| X, Y | dots, no range (856-861) | position input of the overlay, no limit / unchanged | the overlay insert moved a negative position to 0 silently; the emit of an item at a negative position wrote a negative X / Y / insert refused with an error naming the position; emit writes 0 and warns once | read as written (unchanged; negative values drawn there) |
| width | bytes, no range (864); the code keeps 1..1250 bytes (10000 dots) | no limit in the panel (the insert states the limit) / unchanged | skipped with a size warning (already) / insert error names the range | 0, negative or fractional gave the generic "valores no válidos o sin datos"; over 1250 "supera el máximo" without the range / warning names "ancho en bytes 1..1250, alto en puntos 1..9999", whole numbers |
| height | dots, no range (865); the code keeps 1..9999 | as width | as width | as width |
| mode | 0 overwrite, 1 OR, 2 XOR (866-869) | n/a | always 0 (valid) | 3, -1, 7 or 1.5 refused as "no válidos" (the image vanished) / one warning "0, 1 o 2", drawn as overwrite, `native.mode` keeps the value; a non numeric mode is still refused, with the modes in the message; 1 and 2 keep the existing info (drawn as overwrite) |
| bitmap data | width x height bytes (870) | n/a | payload always rows x ceil(w / 8) bytes (valid); the overlay insert accepted data of another length and a size of 0 or a fraction / insert refuses both with a Spanish error | truncated data warned already (padded with white) |
| `PUTBMP`, `PUTPCX`, `PUTPNG`, `DOWNLOAD` | file in the printer memory, not in the stream | - | never written | `PUT*` warned as not drawable (already); `DOWNLOAD` is not read by the viewer (unchanged) |

Other changes: none outside the image slice and `imageCommand` (the TSPL equivalent of the TPCL insert check from V4: position, size, data length, limits).
Expectation changes in existing tests: none (new file tests/tspl-image-validation.test.js, 13 tests).

### V9 ZPL label setup and shapes
Manuals: ZPL II Programming Guide vol 1 (2003) and vol 2 (2005); line numbers are those of `pdftotext -layout` of vol 1 (V1 below) unless marked V2. Vol 2 only repeats the descriptions of ^FR, ^LR, ^GB (V2 1623, 1627, 2072) and
the dots per mm (V2 1930+); it gives no ranges of its own, so every range below is vol 1's. Most shape ranges were already checked on typed code and on emit before this task; the table says so ("already").

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| `^PW` a | 2 .. label width, printer dependent (V1 9287+); 32000 dots is used as the widest | Formato width min 5 mm, no max / min 5 mm, max 32000 dots in mm at the selected dpi (`sizeLimitsFor`) | `max(1, dots)`, no maximum / limited to 2..32000, one warning | out of range or not a number: "no válido" without range, size not applied / 0, 1, > 32000 read as written (`native.pw`), drawn at the limit, warning with 2..32000; not a whole number: warning with the range, not applied |
| `^LL` y | 1 .. 32000 dots (V1 8296+) | as ^PW / as ^PW | `max(1, dots)`, no maximum / limited to 1..32000, one warning | as ^PW (range 1..32000) |
| `^LH` x,y | 0 .. 32000 (V1 8245+) | not offered | never written (folded into the coordinates) | any integer applied / warning with the range, applied at the nearest limit (also by the move / describe engines) |
| `^LS` a / `^LT` x | -9999 .. 9999 (V1 8390+) / -120 .. 120 (V1 8440+: "a maximum of 120 dot rows", may be smaller per platform) | not offered | never written | any integer applied / warning with the range, applied at the nearest limit |
| `^FO` / `^FT` x,y | 0 .. 32000 (V1 5907+, 6021+); `^FO` justification is not in these editions | no field (move only) / the move and a dropped palette item never write above 32000 | negative silently 0, above 32000 written / limited to 0..32000 for every item (shapes, text, bar codes, QR, Data Matrix), one warning | negative, > 32000 and fractional drawn as written / warning with the range, drawn at the nearest whole valid dot, `field.origin` keeps what was written |
| `^GB` w,h,t,c,r | t 1..32000; w, h t..32000; c B / W; r 0..8 (V1 6224+; rounding formula 6250+) | width / height 1..32000, thickness 1..32000, rounding select 0..8 (already) | thickness limited to 1..32000 with one warning, sizes limited (already) | out of range warned with the range, drawn at the limit; a w or h below t (or 0, as the guide's own lines) is raised to t silently (already) |
| `^GC` d,t,c | d 3..4095 (larger replaced by 4095), t 2..4095, c B / W (V1 6287+) | diameter 3..4095, thickness 2..4095 (already) | limited with one warning each (already) | diameter / thickness out of range warned, drawn at the limit (already; see Open for thickness 1) |
| `^GD` w,h,t,c,o | w, h 3..32000; t 1..32000; c B / W; o R (/) or L (\\) (V1 6320+) | 3..32000 / 1..32000, orientation select (already) | diagonals under 3 dots limited with one warning (already) | warned with the range (already) |
| `^GE` w,h,t,c | w, h 3..4095, t 2..4095 (the table of V1 6366+ is garbled, same ranges as ^GC) | 3..4095 / 2..4095 (already) | limited with one warning each (already) | warned with the range (already) |
| `^FR` / `^LR` a | `^FR` none; `^LR` Y or N (V1 5971+, 8352+) | checkbox (already) | `^FR` per item, `^LR` never written (already) | `^LR` other value warned (already) |
| `^PQ` q,p,r,o | q 1..99999999, p 0 (no pause) or 1..99999999, r 0..99999999, o Y / N (V1 9125+) | not offered | never written | ignored silently / warning per out-of-range or malformed argument |
| `^MD` a | -30 .. 30 (V1 8487+) | not offered | never written | ignored silently / warning with -30..30 |
| `^PR` p,s,b | A..E, 2..6, 8..12 (V1 9190+; 7 does not exist; `~PR` is another command and is not checked) | not offered | never written | ignored silently / warning for an unknown speed |
| `^PM` a, `^PO` a | Y / N (V1 9034+); N / I (V1 9069+) | not offered | `^POI` kept (already) | `^PM` ignored silently / warning outside Y / N; `^PO` already warned |
| `^CI` a | 0..24, 18..23 reserved (V1 4563+) | not offered | never written | "no válido" without range / message gives 0..24 |
| dots per mm | 6 / 8 / 12 / 24 dots per mm = 152.4 / 203.2 / 304.8 / 609.6 dpi (V1 8245+, V2 1930+) | the app offers 203 and 300 dpi; the Formato maximum follows the selected one | conversions mm -> dots use the document dpi (already) | - |

Other changes: `PB.languages` ZPL gains `fitSize`, `sizeLimits` and `sizeLimitsFor(dpi)` (the same hook as TPCL / TSPL; js/app.js passes the limits of the selected resolution, because 32000 dots are a different length at 203 and 300 dpi); `zplEdit` exports `COORD_MAX` and
`OFFSET_LIMITS`; the shape helper `place()` takes the emit context and the shared helpers `fitCoord` / `coordDots` limit every origin. A converted TPCL / TSPL shape at a negative position (for example a TSPL BAR) now reports the ZPL limit once.
Expectation changes in existing tests: tests/zpl.test.js (a `^PW0` is no longer "ignored, the last valid one wins": it is drawn as the smallest valid width, 2 dots, and warned).

### V10 ZPL text (`^A`, `^CF`, `^FW`, `^FB`, `^FD` / `^FV`, `^FN`, `^SN`)
Manuals: ZPL II Programming Guide vol 1 (2003; text lines of pdftotext -layout: ^A 1064+, ^CF 4520+, ^FB 5575+, ^FD 5722+, ^FH 5749+, ^FN 5873+, ^FV 6096+, ^FW 6142+, ^SN 9588+) and vol 2 (2005; bitmapped fonts "magnified from 2 to 10 times", whole numbers, 2517+;
fields of ^SN and ^FN 1636+, 1700+). Vol 2 gives no ranges of its own; the matrices per printhead (203 / 300 dpi) were already applied from it (FONTS_203 / FONTS_300).

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| `^A` font f | A..Z and 0..9 (V1 1064+) | select of the fonts with a known matrix plus 0 (valid) / unchanged | only those (valid) | an invalid character was silently the default font / warning, default font used |
| `^A` orientation o | N R I B | select (valid) | already | already warned |
| `^A` h, w, scalable (0 and the fonts without a matrix) | 0 (standard) or 10..32000 dots (V1 1064+) | number 0..32000, a typed 1..9 was written as is / typed value written as 0 or 10..32000 | already limited to 10..32000 with one info / same | 1..9 drawn at 1 dot, 40000, negative, 10.5, text silently / warning with the range, drawn at 10 or 32000, native keeps what was written |
| `^A` h, w, bitmapped (A..H, P..V) | whole multiples 1..10 of the matrix of the printhead (V1 1064+, V2 2517+; ^A@ says "rounded to the nearest") | any number / typed value written as the nearest multiple (the matrix of the document dpi) | always an exact multiple (already) | rounded silently / warning with the font and its matrix, drawn at the nearest multiple |
| `^CF` f, h, w | f A..Z 0..9; h, w 0..32000 (V1 4520+) | not offered | never written | invalid font and out of range or non numeric sizes silently / warning per argument with 0..32000 |
| `^FW` r | N R I B (V1 6142+) | not offered | never written | warned without the values / warning lists "N, R, I o B" |
| `^FB` a, b, c, e | a 0..9999 (0 does not print), b 1..9999, c -9999..9999, e 0..9999 (V1 5575+) | block fields 1..9999 / 1..9999 / -9999..9999 (already right) | clamped silently / clamped with one warning with the ranges | width over 9999 and the others silently clamped, non numeric silently default / warning per argument with the range, drawn at the limit |
| `^FB` d | L C R J | select (valid) | already | invalid letter was an info / warning |
| `^FD` / `^FV` data | up to 3072 characters; ^ and ~ only through ^FH or other prefixes (V1 5722+, 6096+) | content field maxLength 3072 (already) | any length, ^ ~ and the indicator escaped with ^FH (already) / cut to 3072 with one warning (^FD, ^FV, ^FB data, ^SN start, ^FN default) | any length / read whole, warning with the limit |
| `^FN` n | 0..9999 (V1 5873+) | not offered | only numbers read from a file | warned without the range / the message says 0..9999 |
| `^SN` v, n, z | v: 12 digits indexed, n: 12 digits, z Y / N (V1 9588+) | increment -999999999999..999999999999, zeros checkbox (already) | increment clamped + warning, start over 12 digits info (already) | n and z warned (already) / also a start value with more than 12 consecutive digits |
| `^FO` / `^FT` of a text | 0..32000 (V9) | - | text with ^FO or a block used a bare `max(0, x)` (above 32000 and negative silently) / goes through the V9 limit with one warning | V9 |
| Resolution | matrices of 203 and 300 dpi (V2 61+, 64+) | font labels show both | already per dpi | the multiple check follows the resolution of the document |

Other changes: the properties panel size field (`^A` h, w) is a custom field that snaps the typed value to the font in force (the font typed in the same edit counts) at the dpi of the document; `fitData` (js/languages/zpl.js) limits the data of every ^FD / ^FV written (shared with the barcode slices).
Expectation changes in existing tests: tests/zpl-fonts.test.js uses the standard size for the P..V fonts (30 x 30 is not a multiple of their matrices); tests/zpl-text.test.js updateItem of font D writes 54 x 60 (multiples of 18 x 10) instead of 60 x 55.

### V11 ZPL barcodes (`^B*`, `^BY`), QR (`^BQ`), Data Matrix (`^BX`)
Manuals: ZPL II Programming Guide vol 1 (2003; text lines of pdftotext -layout: ^B2 1285+ .. ^B3 1419+, ^B8 2047+, ^B9 2085+, ^BA 2188+, ^BC 2489+, ^BE 2921+, ^BI 3129+, ^BJ 3183+, ^BK 3241+, ^BM 3359+, ^BQ 3500+, ^BU 4046+, ^BX 4114+, ^BY 4302+, Table J 4330+) and vol 2 (2005; the XML table of ^BY limits 3941+).
Vol 2 has no barcode command pages, only that table. All linear commands share o N R I B, h 1..32000, f / g Y / N; the per-type data rules (EAN / UPC digit counts, MSI 1..14 digits, Code 39 / 93 character sets) were already checked by the encoders.

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| `^BY` w | 1..10 (V1 4302+, V2 3949) | module field 1..10 (already) | clamped + one warning (already) | out of range silently ignored (the previous module stayed) / drawn at the nearest limit, warning with 1..10; not a whole number warned and ignored |
| `^BY` r | 2.0..3.0 in 0.1 steps (V1 4302+, V2 3941) | 2..3 step 0.1 (already) | clamped + info (already) | out of range silently ignored / drawn at the nearest 0.1 step inside the range, warning (2.55 says "múltiplo de 0.1"); text warned and ignored |
| `^BY` h | V1 garbled ("2.0 to 3.0"), V2 1..9999; the bar codes say "1..32000, default set by ^BY": 32000 used | not a field | - | any value >= 1 / drawn at 1..32000, warning with the range; text warned and ignored |
| `^B*` o | N R I B (all) | select (already) | already | invalid letter warned (already) |
| `^B*` h | 1..32000 (1..9999 in ^BU, V1 4063) | number 1..32000 (already) | clamped silently / clamped, one warning | > 32000 or < 1 fell back to ^BY with a message without range / > 32000 drawn at 32000 (native keeps the written height), < 1 or text falls back to ^BY, both messages state 1..32000 |
| `^B*` f, g | Y / N | checkbox (already) | already | any other value silently meant yes (f) / no (g) / warning "Y o N", default used |
| `^B*` e | Y / N (^BC UCC, ^B3 Mod 43, ^B2 Mod 10, ^BU ^B9 ^BA print check digit); ^BM A..D; ^BK fixed N | select per type with the valid options (already) | valid table (already) | silently / warning with the valid values; ^BM e2 Y / N, ^BC m N U A (D of later guides, kept) also warned |
| Data per type | EAN-13 12, EAN-8 7, UPC-A 11, UPC-E 10 (padded on the left), ITF digits, Code 39 standard set, Code 128 ASCII, MSI 1..14 digits (V1 2047+ ..) | content field | EAN / UPC / Code 93 / Codabar / MSI / Industrial 2 of 5 reported / also Code 39, ITF and Code 128 (non ASCII 0-127) reported once per symbology | drawing warnings of the encoders (already) |
| `^BQ` a | fixed N (V1 3500+) | no field | N (already) | another letter: info, ignored (already) |
| `^BQ` b | 1 or 2, default 2 | select (already) | model from the file or 2 | warned (already) |
| `^BQ` c | 1..10 | number 1..10 (already) | clamped + warning (already) | 0 or 11 used the dpi default / drawn at the nearest limit (1 / 10), warning with 1..10; text: default + warning |
| `^BQ` ^FD prefix | level H Q M L, input mode A / M, mixed `D` form (V1 3560+) | ecc select (already) | `<ECC>A,` (already) | missing or unreadable prefix warned (already) |
| `^BX` o | N R I B | select (already) | already | warned (already) |
| `^BX` h | 1 .. width of the label (V1 4114+); 0 or omitted: from ^BY | 1..9999 (convenience, see Open) | clamped + warning (already) | a negative or text value: "ignored" without range / warning with 1..9999, ^BY height used |
| `^BX` s | 0 50 80 100 140 200 | not offered | the quality, else 200 + warning (already) | warned (already) |
| `^BX` c, r | quality 0..140: 9..49 odd, > 49 = 0 (automatic), even = INVALID-P, < 9 = no symbol; quality 200: even 10..144 (V1 4114+) | size select of the table (200 only, already) | forced size only for ECC 200 (already) | 200: sizes outside the table warned (already) / 0..140: 3 messages for the odd, > 49 and < 9 cases (silent before) |
| `^BX` f | 1..6 (the label says 0 to 6), not used with quality 200 | not offered | read value kept | any value silently / warning outside 1..6 for qualities below 200 |
| `^BX` g | any character, quality 200 only | not offered | kept | the first character used silently / warning when more than one character |

Other changes: `PB.languages` ZPL helpers gain `limited` and `rangeText` (shared with the slices); `byValues` (js/languages/zpl.js) now returns the nearest valid value, so the panel, the move / describe engines and the parser agree on what a bad ^BY means.
Expectation changes in existing tests: tests/zpl-barcodes.test.js (^BY99 is drawn as module 10; a non numeric ^BY still changes nothing), tests/zpl-2d.test.js (a ^BQ magnification of 0 or 11 is drawn as 1 or 10 instead of the default).

### V12 ZPL images (`^GF`)
Manuals: ZPL II Programming Guide vol 1 (2003; text lines of pdftotext -layout: ^GF 6389-6480, ~DG 5211+, ^FO 5907+, ^FT 6021+) and vol 2 (2005; B64 / Z64 at 4900+, "Alternative Data Compression Scheme" printed pages 52-53). The app reads and writes only `^GF`;
`~DG`, `~DY`, `^IM`, `^IL`, `^XG` are reported once as images stored in the printer (the data is not in the stream) and not validated. Vol 2 has no ^GF page of its own, so every range is vol 1's.

| Parameter | Manual range (source) | UI before / after | Emit before / after | Parse warning before / after |
|---|---|---|---|---|
| `^GF` a (compression) | A ASCII hex, B binary, C compressed binary, default A (V1 6400+); B64 / Z64 replace the hex data (V2 4915+) | n/a | always A / same | invalid letter warned with "A, B o C", B / C and Z64 reported as not drawable, B64 read (already) / unchanged |
| `^GF` b (bytes sent) | 1..99999, "out-of-range values are set to the nearest limit", should match c in ASCII (V1 6410+) | n/a | = total / same | clamped + warning with the range, mismatch with c warned (already) / unchanged |
| `^GF` c (total) | 1..99999, = width x height in bytes; ignored command when missing (V1 6430+) | n/a | rows x bytes per row (always consistent) / same | clamped + warning (already); missing or a non whole number: message without the range / the message states 1..99999 |
| `^GF` d (bytes per row) | 1..99999, c / d = the rows | n/a | ceil(w / 8), whole bytes / same | as c; a total that is not a multiple of d warned (already) |
| `^GF` image size | b, c, d up to 99999 bytes, so up to 99999 bytes of image (printer memory is not given) | the overlay refused above 99999 bytes (already) / the error names 1..99999 for total, bytes sent and bytes per row | not written, one warning (already) / unchanged | n/a |
| `^FO` / `^FT` x,y of the image | 0..32000 (V1 5907+, 6021+) | position input 0..999.9 mm (TPCL-driven, inside the ZPL range at both resolutions) / unchanged | negative or above 32000 silently clamped by `toDots` (only the negative side) / limited to 0..32000 with one warning (the `^FT` corner included) | V9 (warning, nearest dot) already covers the field origin |
| Overlay insert position | as above | no limit error / refused with a Spanish error naming `0..32000` | a negative position became 0 silently and one above 32000 was written / refused, never moved | n/a |
| Overlay insert data | w x h dots | n/a | accepted data of another length / refused with an error (same hook as TSPL) | n/a |
| Data (ASCII hex) | two hex digits per byte; data after the count ignored; `,` pads the row with 00; a `^` or `~` aborts the download (V1 6440+) | n/a | plain hex with the comma (already) | missing data padded with white, excess ignored, invalid characters ignored, each warned (already); compression letters of V2 read (already) |

Other changes: the image slice reads `fitCoord`, `roundDots`, `exactDots` from the ZPL helpers (no TPCL / TSPL file is shared); `PB.languages` ZPL `imageCommand` now checks position and data length like the TSPL hook.
Expectation changes in existing tests: tests/zpl-image.test.js (`imageCommand` with a negative position throws instead of writing 0).


### V13 Conversions land valid in the target
A conversion is parse(source) -> neutral model -> emit(target), so every range of V1..V12 already lives in the target's emit (and in its parser, which re-reads the result). The task proves it end to end (tests/conversion-validity.test.js, 20 tests).

Matrix: 6 ordered pairs (TPCL, TSPL, ZPL) x 2 resolutions (203, 300 dpi) x about 190 cases, each case a label written by the SOURCE emitter from a neutral item with extreme values (so the text is a valid label at the edge of the source's range), plus 6 native source labels per language with the maxima the source's emitter never writes (fonts, magnifications, blocks, counters, every shape and bar code parameter, QR / Data Matrix). Kinds: text lines (huge / tiny / very wide or narrow sizes, negative / far / fractional positions, 8 rotations, 4000 characters, forbidden characters, accents, variables, counters, 60 counters, 130 fields, spacing / bold / attribute / alignment extremes), text blocks (huge / tiny width, lines, line space, 4 alignments, breaks, rotated), line / box / ellipse / circle / area (huge, tiny, negative, reversed corners, radius), each of the 11 linear symbologies plus an unknown one (huge, tiny, position, 5 rotations, not readable, long data, forbidden data, wrong lengths, add-ons, checks, counter, 40 codes), QR (cell, position, 4 levels, long and unicode data), Data Matrix (cell, position, rotations, long data, forced sizes, no module, other ECC), images (wide, tall, large buffer, one dot, position, odd width) and a mixed label. Per conversion the test asserts: (1) the target's own parser reads the converted text with NO warning or error (the exceptions: the data validity warnings of a bar code, whose data is copied as it is and the emit reports it, and the TPCL field-number warnings of the two cases with more than 100 text fields / 32 codes, which the emit reports once); (2) no diagnostic text is repeated; (3) for 20 extreme cases the pairs that need an adjustment must report it (table REPORTS in the test, "from>to" -> the warning). The example labels (the 6 shipped in js/config.js at both resolutions, the 4 test fixtures at 203 dpi) are parsed without a warning, and converted to the other two languages and re-read without a warning.

| Pair | Result of the matrix |
|---|---|
| TPCL -> TSPL | the TSPL parser threw "Maximum call stack size exceeded" on a BITMAP of 500000 bytes (2000 x 2000 dots, a valid 512 KB SG image): fixed. Counters over 999999999, a QR cell over 10, a Data Matrix rotation and a symbology TSPL lacks (MSI, Industrial 2 of 5) are adjusted or skipped with ONE warning (the skipped symbology was reported once per item: fixed) |
| TPCL -> ZPL | already clean; position over 32000, bar code module over 10, QR module over 10, images over 99999 bytes are reported |
| TSPL -> TPCL | already clean: coordinates, line thickness 99, radius 999, height 1000, module 15 / 99, text 0020..0850, 255 / 126 / 2000 characters, ellipses skipped, counters of 10 digits, images over 9999 wide reported |
| TSPL -> ZPL | a line or box longer than 32000 dots (^GB / ^GD) was limited without any warning: now ONE warning; otherwise clean (thickness, ellipse, area, ^FB ranges, 3072 characters, positions, module reported) |
| ZPL -> TPCL | already clean; the 12 digit ^SN increment, height 32000, sizes over 0850, 255 characters, images are reported |
| ZPL -> TSPL | the skipped symbology was reported once per item (MSI, Industrial 2 of 5 with several codes): fixed, once per symbology; images over 9999 high reported |

Closed from earlier Open lists:
- The picture pre-check of js/app.js (V4 / V12) refused any side over 9999 dots before looking at the language. Each language now declares `imageSizeProblem(w, h)` (TPCL: SG width 1..9999, height 1..99999, 512 KB; TSPL: BITMAP 1250 bytes wide, 9999 high; ZPL: 99999 bytes), `imageCommand` uses the same function, and the app asks the language of the label (TPCL when it is not recognized; 9999 only for a language without the hook). A 10000 x 8 picture can now be written as BITMAP or ^GF, an 8 x 12000 one as SG or ^GF.
- The `template-tpcl` example (V3): the Code 128 now writes check digit option `1`, and the parser exception for `0` on types 9 / A is gone (the same 1..5 as every generic type). The fixture label of tests/helpers/legacy-examples.js (outside the listed surface, same kind of file) and the Code 128 fixtures of two tests got `1` too.

Other changes: `PB.languages` gain the optional `imageSizeProblem(w, h)`; TSPL `toBytes` (the BITMAP payload reader) converts in chunks of 8192 (it spread the whole payload into one `String.fromCharCode` call); the ZPL line / box emit shares one warning text (`TOO_LONG`, key `zpl-shape-size`) with the diagonal; the TPCL / TSPL "bar code without equivalent" warning is emitted once per symbology (`ctx.once`).
Expectation changes in existing tests: tests/tpcl-barcode-validation.test.js (a Code 128 check digit `0` now warns like any other generic type, `1` is valid), tests/update-item.test.js (one Code 128 fixture uses `1`), tests/helpers/legacy-examples.js (the TPCL fixture label uses `1`).

## Open (manuals silent or contradictory; kept as is)
- V13 TPCL numbers PV text fields 00..99 and bar code / QR / Data Matrix fields 00..31: a label converted from another language with more than 100 texts or 32 codes writes the extra numbers and reports it once ("más de 100 textos vectoriales", "más de 32 códigos"); the extra commands are not dropped or renumbered, so a printer may reject them (the TPCL parser repeats the warning per field).
- V13 A TSPL text, QR or bar code whose data ends with a backslash is written correctly (the manual's only escape is the quote written as backslash [ " ]), but the app's own TSPL reader takes a backslash followed by a quote as an escaped quote and loses the closing quote of such an argument when it reads the file back (the printer is not affected; the viewer shows a quote where the backslash was).
- V13 A TPCL area (XR) or a ZPL box whose size is 0 or below the thickness is written with 1 dot (^GB raises w and h to t, V9) with no warning; a TSPL TEXT whose baseline is at the top of the label gets a negative Y (TEXT is the top-left corner, the baseline origin minus 80 % of the height) and is written as such: the local manual gives TSPL coordinates no range (see V5).
- V13 Conversions are checked through the parsers of the three languages (every V1..V12 rule), not against a printer; the values the manuals do not bound (TSPL sizes, positions, BAR / BOX measures) pass unchanged between languages.
- V12 `~DG` / `~DB` / `~DY` / `^IM` / `^IL` / `^XG` store or recall images in the printer: the viewer cannot draw them and does not validate their parameters (`~DG` t and w would be 1..99999 like ^GF). No local manual gives a maximum image size by printer memory, so only the 99999 bytes of ^GF apply.
- V12 Whether a printer accepts the run-length compression and `:B64:` data inside `^GF` is documented for `~DG` / `~DB` only (V2 pages 52 and 112 list ^GF "with ASCII hex" among the commands): it is read, written back only for an image read compressed; Z64 and the B64 CRC are not read / checked.
- V11 `^BY` height: vol 1 prints "2.0 to 3.0" (a typo) and vol 2's XML table 1..9999; 32000 is used because every bar code command says "1 to 32000, default set by ^BY". `^BU` says 1..9999 (as `^B5` and `^BF`, which are not modelled): 32000 is applied to all.
- V11 `^BX` module h: "1 to the width of the label" (printer dependent): 9999 is kept as the viewer's limit; the title of f says "0 to 6" while the values list 1..6 (1..6 used); the aspect ratio (8th parameter) and `^BX` quality 200 escape sequences beyond `__` are of later guides and not validated.
- V11 `^BQ` capacity per level and mode (versions 1..40) is not applied to the data (only the 3072 characters of ^FD, V10); the mixed mode counts (code number, divisions, parity) and the manual character modes are read, not validated. `^BQ` model 1 is drawn as model 2 (existing info).
- V11 `^BS` (UPC / EAN extensions), `^BL` (LOGMARS), `^BP` (Plessey), `^B1` (Code 11), `^B4`, `^B5`, `^B7`, `^BB`, `^BD`, `^BF`, `^BR`, `^BT`, `^BZ` and the 2D symbols other than QR and Data Matrix are not modelled: the field is reported as unsupported and its parameters are not validated.
- V11 Data length per type in the panel content field is not limited (EAN / UPC counts, Code 39 set): the next parse reports it; the 3072 character limit of V10 applies. A type switch in the panel cannot report data that does not fit the new type.
- V11 Code 39 / Code 93 full ASCII (`+$`, `/` pairs), Code 128 modes U / A / D and the UCC check digit are read but drawn as the plain symbology (existing infos); the width of the field data ("limited to the width of the label") is not checked.
- V10 `^A@` (font by name) fields are read as an unsupported command (not drawn as text); `^FP`, `^FC` and `^CI13` backslash handling in `^FB` data are not validated. A literal backslash in block data is written as is (the guide needs ^CI13 to print it).
- V10 The sizes of a `^CF` are not checked against a font that comes later (a `^CFA,30` is only warned when out of 0..32000; a non multiple is silent because the font of the field decides). Changing the font in the panel does not re-snap the sizes already written (the next size edit does; the next parse warns).
- V10 Data length 3072 is counted in characters of the data before the ^FH escapes (the guide does not say which side); fonts without matrix (I..O, W..Z, 1..9, downloaded) are checked as scalable (10..32000), which may be wrong for a downloaded bitmapped font. ^SF (mask serialization) is still not modelled; the `^FB` width upper bound is "the label width (or 9999)": 9999 is used.
- V9 `^GC` and `^GE` thickness: the table says "2 to 4095" but also "default 1"; typed code accepts 1 without a warning (the default), the panel and the emit use 2..4095 as the accepted range. `^GB` w / h below t are raised to t silently because the guide's own examples use 0 (^GB0,100,20).
- V9 `^PW` upper limit is "the width of the label" (model dependent, no number given); 32000 dots is the widest the viewer accepts, so a width above the printhead is not warned. `^LL` also depends on the memory installed (V1 8296+).
- V9 `^LT` range "might be smaller depending on the printer platform", `^LS` and `^LH` do not say what happens beyond their ranges: the viewer applies the nearest limit. `^PO I`, `^PM`, `^LS` / `^LT` and the printer state commands are still not drawn (reported once).
- V9 `^FT` / `^FO` omitted parameters: `^FT` without values should continue after the last text field (V1 6021+); the viewer takes 0. `^FO` third parameter (justification) is of later guides, ignored.
- V9 The Formato row has a 5 mm minimum for ZPL (the guide allows 2 dots wide and 1 dot long), a convenience; `^PW` / `^LL` values below it typed in code are accepted. The 600 dpi (24 dots per mm) printheads of the guide are not among the app's resolutions (203, 300).
- V9 `^PQ`, `^MD`, `^PR` and `^PM` are only checked on typed code (never drawn or written); `^CC` / `^CT` / `^CD` prefix changes are not validated.
- V8 The local manual gives no range for BITMAP X, Y, width or height: 1..1250 bytes and 1..9999 dots are the code's safety limits (what a malformed header may allocate), not manual values. A negative position is refused / written as 0 without a manual statement; TSC v3.0 may define more.
- V8 Modes 1 (OR) and 2 (XOR) are valid but drawn as overwrite (items are independent in the model); `DOWNLOAD`, `PUTBMP`, `PUTPNG` and files stored in the printer are not drawn. The TPCL / ZPL images converted to TSPL use the same emit (size limit and negative position are reported once).
- V7 The ratio table of BARCODE (narrow : wide 1:1, 1:2, 1:3, 2:5 per type) is garbled in the extraction and gives no limit; the ratio of Code 39 / ITF / NW7 / 93 is not validated (the emit snaps to 1:2, 2:5 or 1:3 as before).
- V7 Height, narrow and wide have no maximum in the local manual; the 9999 / 10 limits of the properties panel are conveniences. Human readable 2 and 3, the alignment argument, 39S / ITF14 / EAN14 and 128M / EAN128 details are v3.0 only.
- V7 QRCODE is v3.0 only: cell 1..10, model 1 / 2, mask 0..8 and justification 1..9 are the ranges the code already had, not verified against a manual; X and L (area, length) are not validated. The viewer ignores the rotation of QR codes.
- V7 DMATRIX: the manual gives no range for width, height, module, rows or columns, nor how a symbol is placed in the area; rectangular symbols are not modelled. A type switch in the panel cannot report data that does not fit the new type (the next parse does).
- V6 The local manual says TEXT multipliers are 1~8; the code keeps 1..10 (TSC v3.0 range, which is not local). A bitmap multiplier of 9 or 10 is therefore not warned although the B-442/443 prints at most 8x.
- V6 Fonts 0, 6, 7, 8 and ROMAN.TTF, BLOCK (all arguments, alignment, fit, space), the TEXT alignment argument and the scalable font size limits are v3.0 only: validated as "positive number" only; the 200 pt panel limit is a convenience. The `.BF2` Asian fonts of the local manual are drawn with a sans font (info).
- V6 CR / LF in TEXT content are written as spaces; the manual's `\[R]` / `\[L]` escapes are read literally by TEXT (only BLOCK turns them into breaks). Content length: no limit in the manual.
- V5 SIZE has no range in the local manual (v3.0 and the model tables give limits per printer); no maximum is applied, the panel offers min 5 mm only. Same for every shape measure: the 9999 dot limit of the properties panel is an existing convenience, not a manual value.
- V5 DIRECTION mirror (m), REFERENCE (negative values), SHIFT, ELLIPSE, CIRCLE and the BOX radius are v3.0 only: not validated beyond "is a number".
- V5 SPEED lists 1.5 / 2.0 / 3.0 per model in the local manual; other models of the family accept other values, so only a non positive or non numeric speed is reported.
- V5 PRINT 1..65535 and FEED 1..65535 are the local manual's limits; if v3.0 allows more for PRINT, a large value is warned although the printer may accept it.
- V5 Negative coordinates of BAR and BOX are still written as they come (the manual says nothing); ellipse and area clamp them to 0 (reported now). The `GAP` offset n is always written 0, `BLINE` is only read.
- V5 `CUT` is the only local command of the task not read by the viewer ("no soportado por el visor"); not changed.
- V4 The 512 KB image buffer is read as the limit of the dot data of one graphic, not of the whole label image (the manual's sentence is about the width drawn); the printer's exact behaviour (cut width or error) is not given.
- V4 `{SG0;` (printer driver compression, mode A with a data count), hex mode (1, 5), BMP / PCX (2, 6) and TOPIX (3, 7) are not read (warned as not supported by the viewer); the `D` dots suffix is only in R.
- V4 TS12 says 4 digits for Y and height, SV4 / R 4 or 5: the wider form is accepted.
- V3 Data Matrix even sizes between 10 and 144 that ECC200 does not define (for example 28x28) are accepted without warning: the manual calls them valid, the viewer draws the smallest square that fits.
- V3 QR manual mode (`g` = M) needs the data to carry a mode prefix; not checked. Model default (omitted `Mi` = Model 1) is not modelled: the emitter always writes `M2`.
- V3 QR / Data Matrix capacity per ECC level and symbol size (R 5740+ tables) is not applied to the data; the Data Matrix 1558-codeword limit of the viewer is the only check.
- V3 Counters: 40 digit limit of incremented data (R 4690+) and the combination rules of the ratio between narrow and wide elements (the manuals give examples only, no limit) are not checked.
- V3 Types without a palette entry (PDF417, MicroPDF417, MaxiCode, CP code, GS1 DataBar, postal codes, UCC/EAN-128, MATRIX 2 of 5) are read as unknown and only reported as approximate drawings; their parameters are not validated.
- V3 Check digit options 4 / 5 (price check digits of WPC, DBP modulus of ITF) are read as unsupported and never written.
- V3 The `=data` / `;link` forms: inline data is now read for 1D and QR, link fields (`;01,02`) are not modelled (same as V2).
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
- V3 (route: delegated writer, one writer, direct; RED first: 34 of the 35 new tests failed on the old code): TPCL barcodes, QR and Data Matrix (tests/tpcl-barcode-validation.test.js, 35 tests). Verification: `node --test` 4084 tests, 4083 pass, 0 fail, 1 skipped (was 4049 / 4048 before; +35 new). Commit: see `git log` (fix: validate TPCL barcode, QR and Data Matrix values against the manuals).
- V4 (route: delegated writer, one writer, direct; RED first: 15 of the 16 new tests failed on the old code): TPCL images (tests/tpcl-image-validation.test.js, 16 tests). Verification: `node --test` 4100 tests, 4099 pass, 0 fail, 1 skipped (was 4084 / 4083 before; +16 new). Commit: see `git log` (fix: validate TPCL image values against the manuals).
- V5 (route: delegated writer, one writer, direct; RED first: 20 of the 23 new tests failed on the old code): TSPL label setup and shapes (tests/tspl-label-validation.test.js, 23 tests). Verification: `node --test` 4123 tests, 4122 pass, 0 fail, 1 skipped (was 4100 / 4099 before; +23 new). Commit: see `git log` (fix: validate TSPL label setup and shape values against the manual).
- V6 (route: delegated writer, one writer, direct; RED first: 11 of the 17 new tests failed on the old code): TSPL text (tests/tspl-text-validation.test.js, 17 tests). Verification: `node --test` 4140 tests, 4139 pass, 0 fail, 1 skipped (was 4123 / 4122 before; +17 new). Commit: see `git log` (fix: validate TSPL text values against the manual).
- V7 (route: delegated writer, one writer, direct; RED first: 12 of the 15 new tests failed on the old code): TSPL barcodes, QRCODE and DMATRIX (tests/tspl-barcode-validation.test.js, 15 tests). Verification: `node --test` 4155 tests, 4154 pass, 0 fail, 1 skipped (was 4140 / 4139 before; +15 new). Commit: see `git log` (fix: validate TSPL barcode, QR and Data Matrix values against the manual).
- V8 (route: delegated writer, one writer, direct; RED first: 9 of the 13 new tests failed on the old code): TSPL images (tests/tspl-image-validation.test.js, 13 tests). Verification: `node --test` 4168 tests, 4167 pass, 0 fail, 1 skipped (was 4155 / 4154 before; +13 new). Commit: see `git log` (fix: validate TSPL image values against the manual).
- V9 (route: delegated writer, one writer, direct; RED first: 16 of the 23 new tests failed on the old code): ZPL label setup and shapes (tests/zpl-label-validation.test.js, 23 tests). Verification: `node --test` 4191 tests, 4190 pass, 0 fail, 1 skipped (was 4168 / 4167 before; +23 new). Commit: see `git log` (fix: validate ZPL label setup and shapes against the manuals).
- V10 (route: delegated writer, one writer, direct; RED first: 17 of the 21 new tests failed on the old code): ZPL text (tests/zpl-text-validation.test.js, 21 tests). Verification: `node --test` 4212 tests, 4211 pass, 0 fail, 1 skipped (was 4191 / 4190 before; +21 new). Commit: see `git log` (fix: validate ZPL text values against the manuals).
- V11 (route: delegated writer, one writer, direct; RED first: 13 of the 16 new tests failed on the old code): ZPL barcodes, QR and Data Matrix (tests/zpl-barcode-validation.test.js, 16 tests). Verification: `node --test` 4228 tests, 4227 pass, 0 fail, 1 skipped (was 4212 / 4211 before; +16 new). Commit: see `git log` (fix: validate ZPL barcode, QR and Data Matrix values against the manuals).
- V12 (route: delegated writer, one writer, direct; RED first: 8 of the 17 new tests failed on the old code): ZPL images (tests/zpl-image-validation.test.js, 17 tests). Verification: `node --test` 4245 tests, 4244 pass, 0 fail, 1 skipped (was 4228 / 4227 before; +17 new). Commit: see `git log` (fix: validate ZPL image values against the manuals).
- V13 (route: delegated writer, one writer, direct; RED first: 11 of the 15 first tests failed on the old code, then the example and image-limit tests were added): conversions land valid in the target (tests/conversion-validity.test.js, 20 tests). Verification: `node --test` 4265 tests, 4264 pass, 0 fail, 1 skipped (was 4245 / 4244 before; +20 new). Commit: see `git log` (fix: make conversions land valid in the target language).
- V14 (route: delegated writer, one writer, direct; documentation and verification, no RED applicable): README section "Validation of values" (three surfaces, per-language ranges with manual editions, manual-disagreement policy, one Not validated / unverified list per language), the stale image limit of the SG paragraph fixed (width 1..9999, height 1..99999, 512 KB) and the "What a conversion adjusts" paragraph added under the conversion table. Verification: `node --test` 4265 tests, 4264 pass, 0 fail, 1 skipped (3983 at the start of the audit, +282). Commit: see `git log` (docs: document the value validation rules and close the audit).
  Browser probe (Chrome, puppeteer-core, file:// page; scripts and screenshots outside the repo in the Temp ui folder: v14probe.js, v14-*-props.png, v14-*-bad.png), 27 checks, 27 PASS, 0 FAIL; the only console errors are the known print agent CORS ones:
  - PASS x6 `blank-tpcl`, `template-tpcl`, `blank-tspl`, `template-tspl`, `blank-zpl`, `template-zpl` (the six shipped examples): the Avisos list holds no warning or error (information only).
  - PASS x3 every number input of every item of the three templates (text, line, barcode, QR; TPCL 28 inputs, TSPL 13, ZPL 13) has `min` and `max` set from the new limits (for example TPCL PV size 20..850, spacing -512..512, module 1..15, barcode height 1..1000, QR cell 1..52, line width 1..99; TSPL multipliers 1..10; ZPL sizes up to 32000).
  - PASS x3 typing a value above the maximum into each number input (23 TPCL, 13 TSPL, 13 ZPL fields tried): the value is clamped to the maximum in the field and in the code, never kept out of range. 31 of the 49 cases also show an aviso; the other 18 are clamped in the panel without one (see Open).
  - PASS x3 pasted labels with an out-of-range value give warnings in Avisos: TPCL `{PC01;0100,0100,14,19,B,00,B|}` (magnification) and `{XB00;...}` (module, height), TSPL `BARCODE ...,45,...` / `DENSITY 20` (rotation, range 0..15), ZPL `^BY99` ("módulo 99 fuera de 1..10 puntos, se usa 10").
  - PASS x12 Convertir a... for the 6 pairs on both examples of each language (blank and template): the converted text read back by the app has no warning or error (and the conversion list holds no warning).
  - Not covered by the probe: Data Matrix and image items (no shipped example has one; covered by tests/conversion-validity.test.js and the per-task validation tests).
- V15 (route: delegated writer, one writer, direct; RED first: the 4 new `adjustmentNotice` tests failed before the helper existed): `PB.ui.adjustmentNotice(field, typed, used)` in js/properties.js builds one Spanish warning (`<label>: <typed> está fuera del rango <min>..<max>; se usa <value>`, or `se ajusta a` for a rounded / snapped value inside the range); `changeProperty` in js/app.js re-reads the field from `describeItem` after the edit and shows the aviso on top of the list, unless the edit already produced a language warning that names the typed number (no duplicate). Verification: `node --test` 4269 tests, 4268 pass, 0 fail, 1 skipped (+4). Chrome probe (Temp ui folder: v15probe.js), 21 checks, 21 PASS: all 49 out-of-range cases (23 TPCL, 13 TSPL, 13 ZPL) now show an aviso (the 18 silent ones included), at most one adjustment aviso per edit, re-typing the current in-range value gives none, no console errors. Commit: see `git log` (fix: report every value the properties panel has to adjust).

## Summary
- TPCL (V1..V4): label setup `{D` / `{AX` / `{XS` / `{LC` / `{XR`, text `PC` / `PV` (sizes, spacing, attribute, bold, zero suppression, alignment, `P5`, 255 characters), barcodes (check digit, module 01..15, widths, height 0000..1000, 126 / 2000 characters), QR, Data Matrix and `SG` images (width 1..9999, height 1..99999, 512 KB) are limited in the panel, clamped on emit with one aviso, and warned with their range when typed. The Formato row limits pitch / width / length to the `{D` ranges; the 33rd `XB` and 101st `PV` are reported.
- TSPL (V5..V8): `SIZE`, `GAP` (0..25.4 mm), `BLINE`, `OFFSET`, `DENSITY`, `SPEED`, `FEED`, `PRINT`, shapes with at least 1 dot, `TEXT` font / rotation / multiplier / counters `@0..@49`, `BARCODE` height / rotation / narrow / wide / readable, `QRCODE`, `DMATRIX` and `BITMAP` (mode, size, data length) are checked; what only TSC v3.0 defines keeps its behavior (Open).
- ZPL (V9..V12): `^PW` / `^LL` / `^LH` / `^FO` / `^FT` (0..32000 for every item), `^LS` / `^LT`, `^GB` / `^GC` / `^GD` / `^GE`, `^A` sizes (scalable 10..32000, bitmapped whole multiples of the matrix of the dpi), `^CF`, `^FB`, 3072 characters, `^FN`, `^SN`, `^BY` (module 1..10, ratio 2.0..3.0, height), every `^B*` height / flag, `^BQ`, `^BX` and `^GF` (1..99999 bytes) are limited and warned; the Formato maximum follows the dpi.
- Conversions (V13): every converted value lands valid in the target; a matrix of 6 pairs x 2 resolutions x about 190 cases re-reads the result with the target parser without warning. Found and fixed: a TSPL parser stack overflow on a 500000 byte BITMAP, a ZPL line / box longer than 32000 dots limited silently, a skipped symbology reported once per item, and an image limit that refused 10000 dots wide before looking at the language.
- Tests: 3983 at the start of the audit, 4265 now (+282 in 13 new test files plus the V13 matrix; 0 fail, 1 skipped). README: new section "Validation of values" with the ranges per language, the manual-disagreement policy (widest value of at least one manual) and the Not validated / unverified lists.

Commits of the branch (`git log --oneline 56af94a..HEAD`, oldest last; the V14 commit is the latest, added with this document):
```
78d00fb fix: make conversions land valid in the target language
bf04c77 fix: validate ZPL image values against the manuals
fb65560 fix: validate ZPL barcode, QR and Data Matrix values against the manuals
b0dc83c fix: validate ZPL text values against the manuals
274baff fix: validate ZPL label setup and shapes against the manuals
6839e06 fix: validate TSPL image values against the manual
3dbcefc fix: validate TSPL barcode, QR and Data Matrix values against the manual
e5c68b8 fix: validate TSPL text values against the manual
9cee3e8 fix: validate TSPL label setup and shape values against the manual
09ea438 fix: validate TPCL image values against the manuals
5736057 fix: validate TPCL barcode, QR and Data Matrix values against the manuals
10bd957 fix: validate TPCL text values against the manuals
c883acb fix: validate TPCL label setup and shape values against the manuals
3415883 docs: plan the field validation audit
```

## How to review
1. Read the README section "Validation of values" first (README.md, before "Limitations"); then the per-task tables under Findings above for the sources of each range. Look at one commit per language: `c883acb` (TPCL setup), `10bd957` (TPCL text), `9cee3e8` (TSPL setup), `274baff` (ZPL setup), `78d00fb` (conversions).
2. In the app, open the **Plantilla — TPCL**, select a text, type 950 in the width field and leave it: it goes to 850 (the `PV` maximum). Do the same with the barcode module (limit 15) and the QR cell (limit 52).
3. Paste `{PC01;0100,0100,14,19,B,00,B|}` (TPCL), `BARCODE 100,100,"128",50,1,45,2,2,"X"` (TSPL) and `^XA^BY99^FO50,50^BCN,100,Y,N,N^FD12345^FS^XZ` (ZPL): each shows an orange warning with the valid range in Avisos, and the code you pasted is not rewritten.
4. In **Formato** type a width of 500 mm in TPCL (it stops at 108 mm), a GAP of 40 mm in TSPL (25.4 mm) and, in ZPL, a very long label (limit 32000 dots at the selected dpi); then change **Resolución** and see the ZPL limit follow it.
5. Load a template, **Convertir a…** each of the other two languages and paste the result back into the code box: no warning remains.

## Open (added by V14)
- V14 The browser probe covers the three languages' templates (text, line, barcode, QR) only; Data Matrix, images and TSPL / ZPL shapes other than lines are covered by the unit tests and the V13 matrix, not by the browser.
