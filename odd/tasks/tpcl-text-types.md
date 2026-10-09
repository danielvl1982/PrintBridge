# TPCL text: bitmap / vector selector and the PC automatic line feed block (P5)

Branch: `feat/tpcl-text-types`. Strategy: single PR (the two changes together, user's decision).

## Objective
1. TPCL texts are written with `PC` (bitmap font, text inline `=data` or in `{RC}`) or `PV` (vector / outline font, data in a separate `{RV}`).
   The Propiedades form gets a simple radio **Fuente: Mapa de bits (PC) / Vectorial (PV)**; switching rewrites the command.
2. TPCL has a text block: the `PC` alignment `Pq` accepts `P5aaaabbbcc` (automatic line feed): `aaaa` area width (0050..1040, 0.1 mm), `bbb`
   line spacing (010..500; 0.1 mm in the 2001 Spanish manual, "1 mm units" in the English 2004 / 2012 editions: use 0.1 mm and mark it
   unverified), `cc` number of lines (01..99). `PV` (`Po`) only has 1 left / 2 center / 3 right / 4 justify. With rotations 01, 12, 23, 30 the
   alignment and the line feed are ignored (manual).
   The **Tipo** select (Línea de texto / Bloque de texto) therefore also exists in TPCL, only for `PC` texts; a `PV` text offers only "Línea de texto"
   with a note that the block needs a bitmap font. This replaces the feat/text-block statement "TPCL has no text block" (wrong: fix README,
   code comments, diagnostics, the disabled Tipo select and the tests that assert it).

## Decisions (user, 2026-10-09)
- Both changes in one PR. The Tipo select values depend on the language (and, in TPCL, on the font type).
- TSPL / ZPL block -> TPCL becomes `PC` with `P5` when the font maps to a bitmap font, one line with a warning otherwise (PV font).
- The block has no alignment in TPCL (width / spacing / lines only); the block height comes from the lines, as in TSPL.

## Tasks
- [x] T1 Block in TPCL: read `P5aaaabbbcc` into the neutral `text.block`, draw it (the existing wrap), write it (PC), edit it (width, lines, spacing) in
      Propiedades through the Tipo select for PC texts; PV and rotated texts: line only; conversion from / to TSPL and ZPL; fix every
      "TPCL has no text block" statement.
- [x] T2 Radio **Fuente: Mapa de bits / Vectorial** for TPCL texts: switching PC <-> PV rewrites the command (nearest font, the size, the data: inline
      `=` / `{RC}` <-> `{RV}` as the manual and the existing code do), keeps position, rotation, attribute and variables; the font select lists
      the fonts of the chosen type; a block text switched to vector goes back to a line (say so).
- [x] T3 Tests, README, Chrome probe.

## Acceptance
`node --test` green; in the app: a TPCL `PC` text -> Tipo = Bloque de texto writes `P5aaaabbbcc` and wraps in the preview; a `PV` text only offers
"Línea de texto"; the radio switches PC <-> PV and the code is rewritten in one undoable edit; TSPL / ZPL blocks convert to TPCL `PC ... P5`.

## Progress
- T1 done (d55ab45): PC `P5aaaabbbcc` read into the neutral `text.block` (width = aaaa, lines = cc, lineSpace = bbb, native.block as written), drawn with the shared wrap, written back in the alignment slot (never with another alignment; clamped to the manual ranges with one warning), edited through the Tipo select (line <-> block, one rewritten command through the TPCL `reemit` hook) and the fields Ancho del área / Líneas / Interlineado; a PV text and a PC text with rotation code 01/12/23/30 only offer the line (with a note). TSPL / ZPL block -> `PC ...,P5` when the font maps to a bitmap font, else one line + the reworded warning; TPCL block -> TSPL BLOCK / ZPL ^FB. Every "TPCL has no text block" statement replaced (code, tests; README in T3). The radio code (see T2) shares tpcl.js with this commit.
- T2 done (code in d55ab45 together with T1 because it is the same hunks of js/components/text/tpcl.js, js/languages/tpcl.js, js/properties.js; tests in b18db50): radio field type in the panel, "Tipo de fuente" Mapa de bits (PC) / Vectorial (PV); the TPCL reemit hook may answer { command, edits, ref } so the RC / RV data command is renamed in the same text (one undoable edit); nearest font both ways (PC: sans bold J/K/M by smallest relative magnification error), the number is kept unless taken; bold (J) and block (P5) dropped going to PV with a note under the radio shown before the change.
- T3 done (this commit): README (Tipo, Tipo de fuente radio, TPCL block section, conversion row), tests (tests/tpcl-text-block.test.js 22, tests/tpcl-font-type.test.js 20, panel radio tests, conversion matrix block cases with a PC font), Chrome probe outside the repo (C:/Users/danielvl/AppData/Local/Temp/ui/tpclprobe.js): TPCL template PV text -> radio Vectorial with Tipo disabled + note; radio -> Mapa de bits writes PC03 + RC03 (PC00..02 were taken); Tipo = Bloque writes P5, the preview wraps ("ETIQUETA" / "BASICA"), width / lines / spacing edit the token; radio back to Vectorial from a block drops P5 in one edit and one Ctrl+Z restores it; Ctrl+Z x5 restores the template; no page errors.

## Manual findings
- B-452-TS12 (es, 2001): `5aaaabbbcc`, aaaa 0050..1057, bbb 010..500 "unidades de 0,1 mm", cc 01..99. B-SV4 (2004) and B-452-R (2012): aaaa 0050..1040, bbb 010..500 "in 1 mm units" (the unit conflict is unresolved: 0.1 mm is used and flagged everywhere). The figure of B-452-R p. 6-33 draws "Line feed spacing" as the gap between two lines of the block, whose first line starts at the designated origin: read as the extra line space (pitch = character height + bbb).
- The manuals do not say whether a line breaks at spaces or at characters: the shared word wrap (character-break fallback) is used. The ignored-alignment rule is for the rotation codes 01 / 12 / 23 / 30 (fonts U, V, W, X, v, w only), NOT for 00 / 11 / 22 / 33, so a rotated block (90, 180, 270 in the model) keeps its P5.
- Printer test (user, 2026-10-09, TEC): a `PC ...,P5aaaabbbcc` text breaks into lines in the printer. The first try failed because of a stray space in a hand-typed example (`P50600010 03`), not because of the command; the unit of `bbb` was not reported and stays unverified.
- B-452-R: the PV outline font has Po 1..4 only (no automatic line feed), and its optional parameters have no bold (J).

## Decisions taken without the user (open for review)
- The radio is labelled "Tipo de fuente" (the Fuente select keeps its label) to avoid two "Fuente" labels.
- Default block made from a line: 20 characters wide, spacing 010, the lines the text needs. bbb is the extra space between lines (model lineSpace), in 0.1 mm (unverified).
- A block whose model font only PV can write becomes one line (warning); no attempt to substitute a bitmap font.
- PV -> PC picks only among the sans bold PC fonts (J, K, M) because PV is drawn sans bold; PC -> PV always writes font B.
