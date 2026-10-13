# Optional backlog

Ideas agreed with the user as "optional, only if wanted". Nothing here is scheduled. Each item that is taken up gets its own feature
document under `odd/tasks/` (and the Engram mirror) before the first write.

## Printer settings section (TPCL configuration commands) **[difícil]**
Added 2026-10-09. In the future the app may get a **settings** section for the printer: commands that configure or operate the printer
instead of drawing the label. TPCL commands of the B-452-TS12 guide (Spanish, 2001) command list:

| Group | Command | In the app today |
|---|---|---|
| Label setup | `{D` label size definition (pitch, width, height) | read, edited in Formato, written |
| Fine adjustments | `{AX` position fine adjustment | read and written (the template headers) |
| | `{AY` print density fine adjustment | not covered |
| | `{RM` ribbon motor tension fine adjustment | not covered |
| Clear | `{C` image memory clear | written (header) |
| | `{XR` area clear | drawn and edited (types A / B) |
| Drawing formats | `{LC` line, `{PC` bitmap text, `{PV` vector text, `{XB` bar code | drawn and edited |
| Print data | `{RC`, `{RV`, `{RB` | drawn and edited |
| Issue / feed | `{XS` issue command | written (the header / trailer) |
| | `{T` feed command | not covered |
| | `{IB` eject command | not covered |
| | `{U` forward and backward feed command | not covered |
| External characters | `{J1` flash memory initialization | not covered |
| | `{XE` external 2-byte character code range | not covered |
| | `{XD` external character generation | not covered |
| Graphics | `{SG` graphic generation | drawn (modes 0 and 4); not verified on a printer |

The `docs/tpcl/` manuals have the details (printer-side commands such as `{AY`, `{RM`, `{T`, `{IB`, `{U`, `{J1` need a printer to test).
A settings section would also need its TSPL (`SET ...`, `CUT`, `HOME`...) and ZPL (`^MD`, `~SD`, `^MN`...) counterparts to make sense in all three
languages: decide the scope with the user before designing it.

## Other optional items
Each item is tagged with its difficulty ([fácil] / [media] / [difícil]), verified against the code; keep the tag when adding items.
- **[difícil]** Z64 (LZ77 + Base64) graphic data in `^GF`: needs a synchronous inflate and the CRC algorithm the manual does not give.
- **[media]** `^DF` / `^XF` format recall simulated inside one file (ZPL Volume Two exercise 6).
- **[media]** Mod 10 of an even-length Interleaved 2 of 5 (manual and viewer may disagree; needs a printer or a clearer manual).
- **[fácil, hecho: odd/tasks/tspl-small-fixes.md T1, 1286e49]** A TSPL "Alto (mm)" field for the block, rounded to whole lines.
- **[fácil, hecho: odd/tasks/tspl-small-fixes.md T2, d8ab012]** `GAP 0` written when the TSPL gap is emptied or typed as 0 (today the existing `GAP` line is left as it is).
- **[media]** `^SF` with alphabetic / hexadecimal / octal / alphanumeric placeholders (`A`, `H`, `O`, `N`): out of scope by the user's decision of 2026-10-13 (decimal masks only), see `odd/tasks/zpl-sf-mask.md`.
- GS1-128 is done and confirmed working by the user (2026-10-13; logistic AI subset, sample template), only the unverified rules are open: see `odd/tasks/gs1-128.md` and the Verification debt below.
- `^SF` (ZPL decimal mask) is done (branch `feat/zpl-sf-mask`, see `odd/tasks/zpl-sf-mask.md`), pending the user's browser and printer checks; the optional leftovers are the alphabetic (`A` / `a`), hexadecimal (`H` / `h`), octal (`O` / `o`) and alphanumeric (`N` / `n`) placeholders (today a plain `^FD` with a warning, which also leaves the manual's `^FD12A^SFnnA,F` and `^FDBL00-0^SFAAdd%d,1%1` samples unsupported), `^SF` on QR / Data Matrix, `^SF` with `^FN` and the `^PQ` replicate simulation of the sequence.
- Printing from the app (the local print agent) is done and verified on real printers (RAW), see `odd/tasks/print-agent.md`; the driver image mode is in `odd/tasks/print-image.md`.

## Verification debt (needs a printer or a browser)
Nothing here is a feature: it is what is implemented but never checked. Added 2026-10-09 so that nothing is lost.

### Printer checks (odd/tasks/printer-validation.md)
- P1 the `{XS;I,0001,0002C4100|}` default of the TPCL emitter; P2 the print test of a converted label (also covers that the printer accepts
  the converted `D<pitch>` and that the feed with the derived pitch does not drift); P4 record and fix what P2 shows;
  P5 TSPL `DIRECTION 0` (180-degree flip; needs a TSC printer). P3 (pitch / gap conversion) is implemented, only its printer side is in P2.

### Browser checks never run (ZPL, odd/tasks/zpl-support.md "Browser checks pending")
- The reverse blend (`^FR`), rotations and `^FT` of barcodes / QR / Data Matrix, shapes, the image insertion with rotation, the counters and
  variables panels (Propiedades, Variables), and the Convertir a… panel (three targets, `.zpl` download, Formato combo with a ZPL label,
  the "Origen:" lines).

### Implemented but not verified on a printer
- ZPL `^SF` decimal masks (odd/tasks/zpl-sf-mask.md "Browser and printer checks pending"): nothing was run in a browser or on a Zebra; the carry that skips the `%` positions and the right-aligned increment string are inferences from the manual's examples.
- TPCL `P5` text block: P5 itself was tested by the user on a TEC printer on 2026-10-09 (it breaks into lines), but the unit of `bbb` (0.1 mm
  or 1 mm: the manuals disagree) is still unverified.
- The TSPL baseline shares (0.75 for the scalable fonts, 0.8 for the bitmap fonts) and the TSPL `BLOCK`, `ELLIPSE`, `CIRCLE` and `BOX` radius.
- TPCL `SG` graphic generation and the TPCL `XS` default (P1).
- Every ZPL output and every conversion (the last list of the README ZPL section has the details).

### GS1-128 (odd/tasks/gs1-128.md "Browser and printer checks pending")
- Browser flow, real printing and scanning of the sample: confirmed working by the user on 2026-10-13 (not itemized per printer).
- Not individually confirmed: whether TSPL `EAN128` prepends FNC1 by itself (the TSC v3.0 manual is not in docs/).
- Unverified rules: day `00`, the 48 character limit, parentheses only in the readable line, the exact GS1 mod 10 text, ZPL `^BC` mode `D` / `e`. Only the logistic AIs are covered, the rest of the GS1 table is out of scope.

### Open decisions taken without the user (open for review)
- odd/tasks/text-block.md (Progress, last "Decisions taken without the user"): default block width = 20 characters of the font, default lines =
  what the text needs, the extra line pitch = character height + space, TSPL has no justification (written left with an info), `^FT` blocks.
- odd/tasks/tpcl-text-types.md ("Decisions taken without the user"): the "Tipo de fuente" radio label, the default block of 20 characters
  with spacing 010, a block that only PV can write becomes one line with a warning, PV -> PC only among sans bold fonts.

### Not settled by the manuals
- ZPL: `^SF` with `^PQ`, `^FN`, `^FH`, `^FB`, a `^FD` shorter than the mask and on QR / Data Matrix, the `^BY` default ratio, the `^FT` origin of 2D symbols and their quiet zone, the `^FO` box of rotated bars, `^LS` / `^LT`, `^SN` on 2D
  codes and with `^FN`, the ECC 200 range, the QR mixed mode, the shapes geometry, whether `^GF` accepts the compression, the `^FN` prompt, the
  default character set (Code Page 850: UTF-8 bytes above ASCII are not what a printer expects by default).
- Mod 10 of an even-length Interleaved 2 of 5 (also listed above).

### Not supported in TSPL (reported, not converted)
- `PUTBMP` / `PUTPCX` / `PUTPNG` and the `DIRECTION` mirror parameter; `DIRECTION 0` (180-degree flip) is drawn as `DIRECTION 1` until P5 is answered.
