# GS1-128 element editor (Propiedades)

Objective: make a GS1-128 barcode easy to build in the properties panel (no hand-typed parentheses) and stop it from falling back to Code 128. Branch: `feat/gs1-editor`. Delivery: ask-on-risk (small, one PR slice). Test runner: `node --test tests/*.test.js`.

## Specs
- S1 "¿Podemos mejorar la experiencia con los GS1-128? Ahora no es muy intuitivo, es excesivamente complejo montarlo, además cada ver que existe error volvemos a code128" (user, 2026-10-14).
- S2 Editor of elements in Propiedades for a gs1-128 barcode: one row per element `[AI select] [value] [remove]` and `+ Añadir elemento`; the AI select offers the 20 logistic AIs with name and length ("Lo hacemos así, con los 20 logísticos"); each row validates as typed (length, digits, date, mod 10); the readable string `(01)...(17)...` is shown under the rows with the FNC1 note; the text field of the Contenido stays as advanced mode. Same in TPCL, TSPL and ZPL.
- S3 Nothing invalid reaches the file and the panel never goes back to Code 128 because of a typing error: an incomplete or invalid row stays in the panel (draft) with its error, the code keeps the last good content.
- S4 Switching Code 128 -> GS1-128 always works: 14 / 18 digits get `(01)` / `(00)`, other data starts from the example `(01)09501101530003` and an aviso says so (assumption: the previous data is replaced, not kept).
- S5 Assumption (not asked): an AI outside the 20 (read from a file) still reads as Code 128, as before; it is not made GS1-128 because the model cannot round-trip its length / separator rule. Reported to the user.

## Tasks
- T1 S2 S3 S4: `PB.gs1` pure helpers (AI list with names, rows <-> notation, row check, notationFor) + tests. inline. commit: see Log
- T2 S4: the three languages switch with notationFor; aviso in app.js. inline. commit: see Log
- T3 S2 S3: `editor: 'gs1'` on the content field, widget in js/properties.js + css. inline. commit: see Log
- T4 docs (README / docs) and help text. inline. commit: see Log

## Log
- L1 2026-10-14 user: "¿Podemos mejorar la experiencia con los GS1-128? Ahora no es muy intuitivo, es excesivamente complejo montarlo, además cada ver que existe error volvemos a code128"
- L2 2026-10-14 user: "Ambos puntos, principalmente el 1, teniendo en cuenta que herramientas como bartender lo implementan pero de forma compleja, vamos a buscar una manera de poder mostrarlo"
- L3 2026-10-14 user: "Lo hacemos así, con los 20 logísticos"
- Route: all inline (one understood change, no Writer trigger). Risk: none expected (new optional field type; `guessNotation` is the only shared code touched).
- L4 2026-10-14 T1-T4 done in one commit; 4712 tests (4710 pass, 0 fail, 2 skipped). Widget checked in headless Chrome (bad date row stays in the panel with its error and nothing is notified; a valid one notifies `(01)...(17)251231`; add row keeps the draft). Real-browser check of the full app (select a barcode, edit rows) stays with the user.
