# pending-browser-checks

Browser checks the user will do on 2026-10-08 (the agent cannot run a browser). The work below is already merged to `main`
(merged on 2026-10-07 before testing, at the user's request); a failed check means a follow-up fix.

## Checks
- [ ] B1 BITMAP 0x0D (commit 8e40b9b): open a TSPL file with a `BITMAP` image; the preview draws the image
      correctly, the code box shows odd glyphs for the 0x0D bytes; Convertir TSPL -> TSPL and download: payload bytes identical.
- [x] B2 DIRECTION 0: nothing to test, deferred to the printer checks (P5 in printer-validation.md).
- [ ] B3 Logo (commit 4bbbfea): the header icon and the favicon show barcode bars forming a bridge arch (teal tile,
      white bars, orange arch and deck); legible at 28 px; the two-colour "PrintBridge" name next to it.
