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
- [ ] M1 Parsing: a magnification outside the valid set is read as the nearest valid one for drawing and reported with a warning that says the
      printer will not print the field (Spanish); `magnification()` in js/components/text/tpcl.js is the place.
- [ ] M2 Writing: every magnification written (conversion from TSPL / ZPL / PV, bitmapChoice / nearestBitmap, the properties panel,
      palette) is snapped to the valid set; the choice of bitmap font + magnifications searches only valid values (best fit as before).
- [ ] M3 Properties panel: Ampliación horizontal / vertical become a select of the valid values (0,5 .. 0,9 and 1 .. 9,5 in steps of 0,5), not
      a free number 1..99; an existing invalid value in the code is shown as a warning option, not silently changed.
- [ ] M4 Tests (RED first), README (the rule and its source), conversion matrix / cross-conversion expectations updated, Chrome probe.

## Acceptance
`node --test` green; no code path can write an invalid PC magnification; reading `14,19` warns; the panel offers only valid values.

## Progress
