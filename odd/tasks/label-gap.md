# Label gap / pitch: edit it in Formato and convert it between TPCL and TSPL

Branch: `feat/label-gap`. Strategy: single PR, `ask-on-risk`.

## Objective
The size of the label has a pitch (TPCL `D<pitch>,<w>,<h>`: start of one label to the start of the next) and a gap (TSPL `GAP g mm,0 mm`:
separation between labels). They are one value in two forms: pitch = height + gap. The viewer must derive each from the other when reading,
let the user edit the one of the language of the label in the Formato row, and convert it between TPCL and TSPL without a warning.

## Decisions (user, 2026-10-09)
- Neutral model: `size.pitch` and `size.gap` derive each other when reading (TSPL gap g -> pitch = height + g; TPCL pitch p -> gap = p - height).
- Formato row per language: TPCL shows "Paso"; TSPL shows "Separación (GAP)"; ZPL shows neither (it has nowhere to write it).
- Editing the field rewrites `D` (TPCL) or `GAP` (TSPL), like the width and the height already do.
- TPCL <-> TSPL conversion carries it without a warning; only the conversion to ZPL warns (already does).

## Tasks
- [x] G1 Model: derive pitch / gap on reading (TSPL parser sets pitch = height + gap when both exist; TPCL parser sets gap = pitch - height when
      pitch > height); emitters write each language's form from either value; the converters stop warning about the pitch / gap between TPCL
      and TSPL; ZPL still warns. (An earlier attempt to derive the pitch in the TSPL parser broke six cross-conversion tests: fix the tests
      with the new, correct expectation.)
- [x] G2 Formato row: the field and its label follow the language (Paso / Separación (GAP) / hidden for ZPL and for no language), editing
      rewrites D / GAP through the size path that already writes width and height; the size combo (pitch = height + 3) sets both consistently.
- [ ] G3 Tests, README (Formato row, conversion table / the warnings text), CONTRIBUTING if it mentions it, Chrome probe.

## Acceptance
`node --test` green; in the app: a TSPL label with `GAP 3 mm,0 mm` shows "Separación (GAP) 3"; editing it rewrites the GAP; converting it to
TPCL gives `D` with pitch = height + 3 and no warning; a TPCL label shows "Paso" and converts to a TSPL `GAP` of pitch - height.

## Progress
- G1 done (route: delegated writer, inline): parsers derive pitch/gap, emitters write either form, TPCL<->TSPL conversion silent about it; RED observed on tests/label-gap.test.js (7 failing) then GREEN; 3555 tests green. Commit: 8d7a7b2.
- G2 done (inline): the pitch input is a language field (setLanguage in js/ui.js, called from refresh in js/app.js): TPCL Paso, TSPL Separación (GAP), hidden for ZPL / no language; height and width edits keep the gap; RED observed on 5 new size-panel tests, then GREEN; 3560 tests green. Commit: see G3 notes.
