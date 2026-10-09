# pending-browser-checks

Browser checks the user will do on 2026-10-08 (the agent cannot run a browser). The work below is already merged to `main`
(merged on 2026-10-07 before testing, at the user's request); a failed check means a follow-up fix.

Closed 2026-10-09; see `odd/tasks/optional-backlog.md` ("Verification debt") for the browser checks still pending (the ZPL groups).

## Checks
- [x] B1 BITMAP 0x0D (commit 8e40b9b; checked 2026-10-08: payload identical after Convertir, binary note shown on Copiar): open a TSPL file with a `BITMAP` image; the preview draws the image
      correctly, the code box shows odd glyphs for the 0x0D bytes; Convertir TSPL -> TSPL and download: payload bytes identical.
- [x] B2 DIRECTION 0: nothing to test, deferred to the printer checks (P5 in printer-validation.md).
- [x] B3 Logo (checked by the user on 2026-10-08, approved) (commit 4bbbfea): the header icon and the favicon show barcode bars forming a bridge arch (teal tile,
      white bars, orange arch and deck); legible at 28 px; the two-colour "PrintBridge" name next to it.
