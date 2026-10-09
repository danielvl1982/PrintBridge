# TPCL PC magnification: only the steps the printer accepts

Branch: `fix/tpcl-magnification`. Found by the user on a real TEC printer (2026-10-09): `{PC01;0878,0089,09,09,J,11,B|}` prints, a larger
value such as `14,19` makes the printer print nothing (the whole field is skipped).

## The rule (B-SV4 2004 p. ~1522-1545, B-452-R 2012 p. ~2111-2134, B-452-TS12 ES 2001 p. ~1836-1854)
`PC` horizontal (d) and vertical (e) magnification:
- one digit `1`..`9`: whole magnifications 1..9;
- two digits: `05`..`09` = 0.5..0.9 (steps of 0.1 below 1), and from 1 up in steps of **0.5** only: `10`, `15`, `20` ... `95` (second digit 0 or 5).
- Everything else (`01`..`04`, `11`..`14`, `16`..`19`, `21`.. ...) is NOT valid: the printer does not print the field.
The code read every two-digit value as tenths (`14` = 1.4) and wrote tenths (1..99 in 0.1 steps) when it picked a bitmap font for a text
coming from another language or from the properties panel. So it could write `14,19`.

## Tasks
- [x] M1 Parsing: a magnification outside the valid set is read as the nearest valid one for drawing and reported with a warning that says the
      printer will not print the field (Spanish); `magnification()` in js/components/text/tpcl.js is the place.
- [x] M2 Writing: every magnification written (conversion from TSPL / ZPL / PV, bitmapChoice / nearestBitmap, the properties panel,
      palette) is snapped to the valid set; the choice of bitmap font + magnifications searches only valid values (best fit as before).
- [x] M3 Properties panel: Ampliación horizontal / vertical become a select of the valid values (0,5 .. 0,9 and 1 .. 9,5 in steps of 0,5), not
      a free number 1..99; an existing invalid value in the code is shown as a warning option, not silently changed.
- [x] M4 Tests (RED first), README (the rule and its source), conversion matrix / cross-conversion expectations updated, Chrome probe.

## Acceptance
`node --test` green; no code path can write an invalid PC magnification; reading `14,19` warns; the panel offers only valid values.

## Progress
Order of the commits: M2 first (it keeps the conversion tests green), then M1, M3, M4. Route: delegated writer, direct (one writer, no parallel work).
- M2 e5f9034: `isValidMagnification` / `magnificationToken` / `MAGNIFICATIONS` in js/components/text/tpcl.js; the emitter, PV -> PC and the panel write only valid tokens (nearest valid value; always two digits as before: 05..09, 10, 15 ... 95); bitmapChoice / nearestBitmap iterate only the valid set. RED first: tests/tpcl-magnification-write.test.js failed 8/8 on the old tpcl.js. Conversion tests updated: text-block cases from TSPL now fall back to PV (28 pt = H at 2.8 is not a valid magnification), the second-round TSPL y may differ by one dot, PV -> PC tolerance 6% -> 8%.
- M1 0517395: invalid token drawn as the nearest valid magnification, one Spanish warning per text (with the PC ref, the tokens and the valid values), tokens as written kept in native.hMag / native.vMag. RED first (7 of 8 tests of tests/tpcl-magnification.test.js failed).
- M3 e39e266: hMag / vMag are selects of the 23 valid values (0,5x .. 9,5x); an invalid token is an extra option "N (no válido)"; choosing it again writes nothing. RED first (4 of 7 tests of tests/tpcl-magnification-panel.test.js failed).
- M4: README (**Ampliación** bullet with the rule and the manuals, the warning, the PV fallback), this document, Chrome probe (outside the repo, C:/Users/danielvl/AppData/Local/Temp/ui/magprobe.js): 12/12 checks, screenshots mag-1-picked.png and mag-2-invalid.png; the only console errors are the print agent health check blocked by CORS from file:// (unrelated, existing).
- Verification: `node --test` 3983 tests, 3982 pass, 0 fail (1 skipped / todo as before).

## Notes for the user
- Magnifications are always written with two digits (`10` is 1.0, `20` is 2.0, as before the fix); a single digit is still valid on read (whole number).
- A text from TSPL / ZPL whose size is not an exact valid magnification of a PC font (e.g. 28 pt = H at 2.8) is now written as a PV outline text; if it was a block (BLOCK / ^FB) it becomes one line (P5 needs a PC font), with the existing warning.
