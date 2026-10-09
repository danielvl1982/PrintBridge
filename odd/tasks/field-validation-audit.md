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
- [x] V3 TPCL barcodes (`{XB` types, widths, ratios, heights, check digits, data lengths and character sets), QR, Data Matrix
- [x] V4 TPCL images (`{SG`)
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

## Open (manuals silent or contradictory; kept as is)
- V4 The 512 KB image buffer is read as the limit of the dot data of one graphic, not of the whole label image (the manual's sentence is about the width drawn); the printer's exact behaviour (cut width or error) is not given.
- V4 `{SG0;` (printer driver compression, mode A with a data count), hex mode (1, 5), BMP / PCX (2, 6) and TOPIX (3, 7) are not read (warned as not supported by the viewer); the `D` dots suffix is only in R.
- V4 TS12 says 4 digits for Y and height, SV4 / R 4 or 5: the wider form is accepted. The conversion in app.js still refuses a picture over 9999 dots on either side before the language check (js/app.js is outside this task's surface).
- V3 The shipped example `template-tpcl` (js/config.js, outside this task's surface) writes check digit option `0` for Code 128, which is outside 1..5: the parse tolerates `0` for types 9 / A only so the example stays warning-free; change the example to `1` and drop the exception in V14.
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
