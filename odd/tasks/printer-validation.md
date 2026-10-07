# printer-validation

Pending checks that need the real printer (TEC SV4T, TPCL). Not started: the user has no printer access for now.
Status: parked on main (docs only).

## Why
Several TPCL details come from the app's own reference examples and the manuals, not from a print on the user's device.

## Tasks
- [ ] P1 Verify the default `{XS;I,0001,0002C4100|}` that the TPCL emitter always writes (the parser does not keep the source's `{XS|}`).
      Cheap check first, no printing: compare with the `{XS…|}` line of a TPCL label the user already prints well. If it differs,
      make the emitter use the user's value.
- [ ] P2 Print test of a converted label. Regenerate the file: convert the example `tspl-label-100x60` to TPCL at 203 dpi
      (Ejemplo -> Convertir a… -> TEC TPCL -> Descargar) and send it the way the user prints TPCL files today.
      Check: exactly one label, the feed stops without extra blank labels, content correctly placed.
- [ ] P3 Pitch: the converter writes pitch = height (`{D0600,1000,0600|}`) because TSPL `GAP` is not converted to the TPCL pitch.
      With gapped labels this can make the feed drift. Before P2, edit the first number of the D command to height + gap
      (in 0.1 mm, e.g. `{D0630,1000,0600|}` for a 3 mm gap). Follow-up feature once P2 is verified: derive the pitch from `GAP`
      (display already does it: sizes.declaredPitch) and the reverse (pitch - height -> `GAP`) in the emitters.
- [ ] P4 If P2/P3 show problems, record the observed behaviour here (what printed, what the printer did) and fix the emitter.

## Expected file (TSPL example -> TPCL, 203 dpi)
```
{D0600,1000,0600|}
{C|}
{LC;0025,0013,0976,0588,1,04|}
{PV00;0050,0038,0050,0040,B,00,B|}
{RV00;ETIQUETA TSPL|}
{PC00;0050,0113,10,09,N,00,B|}
{RC00;Producto: Muestra 100|}
{PV01;0050,0163,0025,0025,B,00,B|}
{RV01;Lote: 200001|}
{PV02;0050,0206,0017,0015,B,00,B|}
{RV02;Cant: 400 mts|}
{PC01;0526,0050,10,10,H,00,B|}
{RC01;Fuente escalable|}
{LC;0025,0258,0976,0258,0,03|}
{XB00;0050,0288,9,0,02,0,0125,0,000,1,00|}
{RB00;100001200001|}
{XB01;0701,0300,T,L,06,A,0,M2|}
{RB01;https://example.com/100001|}
{XS;I,0001,0002C4100|}
```
