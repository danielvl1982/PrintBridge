# printer-validation

Pending checks that need the real printer (TEC SV4T, TPCL; a TSC for P5). Not started: the user has no printer access for now.
Status: parked on main (docs only). Reconciled 2026-10-09: P3 is resolved in code (see below); P1, P2, P4 and P5 still need a printer.

## Why
Several TPCL details come from the app's own reference examples and the manuals, not from a print on the user's device.

## Tasks
- [ ] P1 Verify the default `{XS;I,0001,0002C4100|}` that the TPCL emitter always writes (the parser does not keep the source's `{XS|}`).
      Cheap check first, no printing: compare with the `{XS…|}` line of a TPCL label the user already prints well. If it differs,
      make the emitter use the user's value.
- [ ] P2 Print test of a converted label. Regenerate the file: choose the TSPL template of the Ejemplo combo ("Plantilla — TSPL (TSC)",
      id `template-tspl`), then Convertir a… -> TEC TPCL (203 dpi) -> Descargar, and send it the way the user prints TPCL files today.
      Check: exactly one label, the feed stops without extra blank labels, content correctly placed. (The old example `tspl-label-100x60`
      is no longer in the app; it only survives as a test fixture in `tests/helpers/legacy-examples.js`.)
- [x] P3 Pitch: RESOLVED in code (merge 83f3516, `feat/label-gap`, see `odd/tasks/label-gap.md`): the TSPL parser derives the pitch
      (height + gap) and the TPCL `D` command is written with it (and the reverse, pitch - height -> `GAP`), both ways, so no hand edit of
      `{D0630,...}` is needed any more (js/languages/tspl.js, README Formato rows). Superseded 2026-10-09: the old statement "the converter
      writes pitch = height" is no longer true. What still needs a printer (part of P2): that the printer accepts the converted
      `{D<pitch>,<width>,<height>|}` and that the label feed with the derived pitch (63 mm for a 60 mm label with a 3 mm gap) does not drift.
- [ ] P4 If P2 shows problems, record the observed behaviour here (what printed, what the printer did) and fix the emitter.
- [ ] P5 TSPL `DIRECTION 0`: the viewer draws it as DIRECTION 1 (info diagnostic). Research (official manual, only partly readable)
      could NOT confirm which value is the default/upright one; one secondary report (a TSC ML241P job) suggests DIRECTION 0 prints
      180 degrees from upright. Implementing the flip blind would show every label upside down if the assumption is wrong.
      Check on a real TSC printer: print an asymmetric TEXT at (0,0) with DIRECTION 0 and with DIRECTION 1 (or read the manual's
      DIRECTION figures). If DIRECTION 0 is the 180-degree one, implement: effective view rotation = (user rotation + 180 when
      DIRECTION 0) % 360 in js/app.js options()/refresh/insertComponent (view.js, drawing.js, ui.js already handle 180), emit
      `DIRECTION n[,m]` from `native` instead of the fixed `DIRECTION 1` (tspl.js headerLines), update the info message and the two
      "edited as DIRECTION 1" test wordings; mirror (m) needs its own transform and is out of the first change. TPCL has no direction.

## Expected file (TSPL template -> TPCL, 203 dpi)
Produced 2026-10-09 by the converter from the `template-tspl` example (`SIZE 100 mm,60 mm`, `GAP 3 mm,0 mm`); the pitch follows the GAP.
```
{D0630,1000,0600|}
{C|}
{LC;0025,0013,0976,0588,1,04|}
{PV00;0050,0070,0050,0040,B,00,B|}
{RV00;ETIQUETA BASICA|}
{PC00;0050,0143,10,09,N,00,B|}
{RC00;Producto: #PRODUCTO#|}
{PC01;0050,0193,10,09,N,00,B|}
{RC01;Lote: #LOTE#|}
{PC02;0050,0243,10,09,N,00,B|}
{RC02;Cant: #CANTIDAD#|}
{LC;0025,0271,0976,0271,0,03|}
{XB00;0050,0300,9,0,02,0,0150,0,000,1,00|}
{RB00;#CODIGO#|}
{XB01;0726,0313,T,L,06,A,0,M2|}
{RB01;https://example.com/#CODIGO#|}
{XS;I,0001,0002C4100|}
```
