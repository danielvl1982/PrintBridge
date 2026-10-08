# component-candidates

Delivery strategy: ask-on-risk; the forecast is well over 400 authored lines, so the work is delivered as four feature branches merged to `main` one after the other (stacked-to-main), one commit per task, each branch tested and merged on the user's OK. Planning forecast: ~4500 authored lines in 4 groups.

## Objective
After closing the editable-property gaps (odd/tasks/editable-gaps.md), add the component candidates valued with the user against the manuals
(Toshiba B-SV4 spec, TEC B-442/443 TSPL manual; local copies in `docs/`, git-ignored).

## Decisions (user)
- Out: PDF417 / MicroPDF417, MaxiCode, text block (TSPL `BLOCK` wrapping, TPCL P4 auto line feed). Everything else valued in the assessment is in.
- Unverified formats (no local manual): TSPL `ELLIPSE`/`CIRCLE` and the `BOX` radius come from the TSC TSPL2 manual v3.0, which is not in `docs/`: mark them "not verified on a printer" in code comments and README.

## Groups and tasks
### Group A: shapes (branch `feat/shapes`)
- [x] A1 Rounded corners: TPCL `LC` rectangle radius `ggg` (3 digits, 0.1 mm; manual 6.3.6) and TSPL `BOX` radius (dots): parse, draw, emit, edit (`Radio`), TPCL<->TSPL conversion, palette unchanged.
- [x] A2 Ellipse and circle (TSPL only: `ELLIPSE x,y,width,height,thickness`, `CIRCLE x,y,diameter,thickness`): parse, draw, move, edit, palette entries for TSPL, emit; TPCL conversion warns (no equivalent); neutral model kind(s).
- [x] A3 Inverted / cleared area: TPCL `XR;x1,y1,x2,y2,A|B` (A clears, B reverses black/white, manual 6.3.5) and TSPL `REVERSE x,y,w,h` / `ERASE x,y,w,h` (B-442/443 manual): parse, draw respecting the drawing order, move, edit, palette ("Área invertida"), emit and conversion.

### Group B: counters and barcode options (branch `feat/barcode-options`)
- [x] B1 Counters / increment: TPCL `n` (increment/decrement + skip value) and `Zpp` (zero suppression) in PC/PV/XB; TSPL counters `@n` (`SET COUNTER`): read, show in the preview (base value and step), edit.
- [x] B2 Barcode type selector and check-digit option for the symbologies the viewer already draws (TPCL XB types, TSPL BARCODE types); the type change rewrites the whole tail layout (two TPCL forms).

### Group C: linear symbologies (branch `feat/linear-symbologies`)
- [ ] C1 EAN13 / EAN8 / UPC-A / UPC-E with +2 / +5 add-ons (TPCL types 0,5,6,7,8,G..M; TSPL equivalents): encoders, drawing with human-readable digits, check digit, parse/emit/convert, selector entries.
- [ ] C2 Code93, NW7/Codabar, MSI, Industrial 2 of 5 (TPCL C, 4, 1, O): encoders, drawing, parse/emit/convert, selector entries.

### Group D: Data Matrix (branch `feat/data-matrix`)
- [ ] D1 Data Matrix ECC200 (TPCL `XB` type `Q`, TSPL `DMATRIX`): encoder (own implementation or a vendored MIT library in js/lib), drawing, parse/emit/convert, palette entry, properties.

## Route declaration
Delegated direct, one writer per task (multi-file each, sequential), read-only exploration folded into each writer's brief. Native review per work-unit commit group as the repository switch asks.

## Acceptance
Each task round-trips parse -> emit -> parse, keeps unrelated commands untouched on edit, reports unsupported conversions with a warning, and keeps `node --test` green.

## Verification
`node --test` after each task. Browser (user) after each group.

## Progress
Plan created from the user's decision.
- A1 done on `feat/shapes` (commit 7ad63d8). Neutral `radius` (0.1 mm) on rect line items, SVG rx/ry clamped to half the shorter side, TPCL `,ggg` / TSPL BOX radius parse+emit+edit+conversion; RED observed (22 of 24 new tests failing) then GREEN. Browser check pending (user). Next: A2.
- A2 done on `feat/shapes` (commit 58c5edc). Two slices share the neutral kind `ellipse` (`ellipse` and `circle`, selected by ref, because the palette needs one entry per slice): TSPL ELLIPSE/CIRCLE parse, SVG <ellipse>, move, edit (Ancho/Alto/Grosor, Diámetro/Grosor), palette Elipse/Círculo, emit; TPCL emit hook only warns once and skips (no TPCL palette entry). Ellipses count for the outside-the-label check but not for overlaps (like boxes). RED observed (30 of 33 new tests failing) then GREEN, node --test 949/949. Not verified on a printer (TSPL2 v3.0 manual). Browser check pending (user). Next: A3.
- A3 done on `feat/shapes` (commit 1fcafdd). New slice `area` (kind `area`, mode reverse|clear, order 58): TPCL `XR` (type A clear, B reverse, corners in any order normalised, native kept for the round trip, unknown type -> warning and no item), TSPL `REVERSE`/`ERASE` (dots, REFERENCE/SHIFT folded), SVG white rect (clear) or white rect with `mix-blend-mode:difference` (reverse) plus a `.hit` rect, no overlap check (zero ink box) but the outside-the-label check, move, edit (TSPL Ancho/Alto; TPCL Final X/Y and Tipo Invertir/Borrar), one palette entry Área invertida in both languages (30 x 10 mm, written before the print command), TPCL<->TSPL conversion (XR B<->REVERSE, XR A<->ERASE). Drawing order: drawing.js paints model.items in order and the parsers add items in command order, so no change was needed. RED observed (32 of 34 new tests failing) then GREEN, node --test 983/983. Not verified on a printer (TSPL manual gives syntax only). Browser check pending (user): inversion and drawing order.
- B1 done on `feat/barcode-options` (commit 349ec26). TPCL increment `n` (item.counter = { step, native }) and zero suppression `Zpp`/`qq` (item.zeroSuppress) on PC, PV and 1D XB (not QR): parse, write back in the manual order, edit (Incremento, Ceros suprimidos), preview shows the start value (one info) with the manual zero-suppression table (pp = characters kept; text only, never the data). TSPL `SET COUNTER @n step` + `@n="v"` + content `@n`: shows the start value, step editable in the SET COUNTER line, emit writes SET COUNTER/@n (50 counters), both-way conversion; the TPCL zero suppression is dropped with one info. RED observed (39 of 43 new tests failing) then GREEN, node --test 1026/1026. Pinned field lists updated in tests/tpcl-content.test.js and tests/update-item.test.js. Browser check pending (user). Next: B2.
- B2 done on `feat/barcode-options` (commit eddd278). Data-driven selector (`PB.slices.barcode.selector` over each language's emit tables: Code 128 / Code 39 / ITF; a later symbology adds rows to TYPE_CODES / CHECK_CODES and a label) with the fields `symbology` (Tipo de código) and `check` (Dígito de control: Code 39 none / mod43, ITF none, Code 128 none shown) in both languages; TPCL re-emits the whole XB command (two forms, `=data` kept, RB untouched), TSPL re-emits the type and wide arguments; refuses (text unchanged) what would lose information (TPCL start/stop or guard bar leaving their form, TSPL 128M/EAN128 content, add-ons, types without a row). RED observed (24 of 27 new tests failing) then GREEN, node --test 1053/1053. Pinned field lists updated in tests/tpcl-content.test.js, tests/update-item.test.js, tests/tspl-properties.test.js. Browser check pending (user).

## Result of group A
Group A (shapes) adds rounded rectangle corners (A1), TSPL ellipses and circles (A2) and inverted / cleared areas (A3), each as a parse -> draw -> move -> edit -> insert -> emit -> convert round trip with its tests (949 -> 983 tests green). The TSPL `BOX` radius, `ELLIPSE`, `CIRCLE`, `REVERSE` and `ERASE` are not verified on a printer. The user must check in a browser: the rounded corners, the ellipse and circle strokes, and above all the area inversion (SVG `mix-blend-mode: difference`, including with a rotated view) and that items drawn after an area stay untouched.

## Result of group B
Group B adds counters (B1: TPCL increment and zero suppression, TSPL `SET COUNTER` / `@n`) and the barcode type and check-digit selector (B2) for the symbologies the viewer already draws (Code 128, Code 39, ITF), in TPCL and TSPL, with parse, preview, edit and conversion tests (1026 -> 1053 tests green). The selector is table driven, so groups C and D only add rows (emit type, check options, label) to the barcode slice. Changing the type re-emits the format command instead of patching digits; whatever the neutral model cannot carry across the two TPCL forms (start/stop option, guard bar) or TSPL 128M/EAN128 content makes the change refuse instead of dropping it silently, because the editors have no diagnostics path. Browser check pending (user): open the Propiedades panel on a barcode of each type in both languages, change the type and the check digit, and check the preview and the code.
