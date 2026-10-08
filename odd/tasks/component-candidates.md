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
- [ ] A2 Ellipse and circle (TSPL only: `ELLIPSE x,y,width,height,thickness`, `CIRCLE x,y,diameter,thickness`): parse, draw, move, edit, palette entries for TSPL, emit; TPCL conversion warns (no equivalent); neutral model kind(s).
- [ ] A3 Inverted / cleared area: TPCL `XR;x1,y1,x2,y2,A|B` (A clears, B reverses black/white, manual 6.3.5) and TSPL `REVERSE x,y,w,h` / `ERASE x,y,w,h` (B-442/443 manual): parse, draw respecting the drawing order, move, edit, palette ("Área invertida"), emit and conversion.

### Group B: counters and barcode options (branch `feat/barcode-options`)
- [ ] B1 Counters / increment: TPCL `n` (increment/decrement + skip value) and `Zpp` (zero suppression) in PC/PV/XB; TSPL counters `@n` (`SET COUNTER`): read, show in the preview (base value and step), edit.
- [ ] B2 Barcode type selector and check-digit option for the symbologies the viewer already draws (TPCL XB types, TSPL BARCODE types); the type change rewrites the whole tail layout (two TPCL forms).

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
