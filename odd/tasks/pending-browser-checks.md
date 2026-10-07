# pending-browser-checks

Browser checks the user will do once all the current work is finished (the agent cannot run a browser). Nothing here is merged to
`main` until the user confirms. Branch stack: `fix/tspl-bitmap-cr` -> `feat/tspl-direction` (on top).

## Checks
- [ ] B1 BITMAP 0x0D (`fix/tspl-bitmap-cr`, commit 8e40b9b): open a TSPL file with a `BITMAP` image; the preview draws the image
      correctly, the code box shows odd glyphs for the 0x0D bytes; Convertir TSPL -> TSPL and download: payload bytes identical.
- [x] B2 DIRECTION 0: nothing to test, deferred to the printer checks (P5 in printer-validation.md).
- [ ] B3 Logo (retouch, last item): to be defined.
