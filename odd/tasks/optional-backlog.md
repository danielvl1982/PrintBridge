# Optional backlog

Ideas agreed with the user as "optional, only if wanted". Nothing here is scheduled. Each item that is taken up gets its own feature
document under `odd/tasks/` (and the Engram mirror) before the first write.

## Printer settings section (TPCL configuration commands)
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
- Z64 (LZ77 + Base64) graphic data in `^GF`: needs a synchronous inflate and the CRC algorithm the manual does not give.
- `^DF` / `^XF` format recall simulated inside one file (ZPL Volume Two exercise 6).
- Mod 10 of an even-length Interleaved 2 of 5 (manual and viewer may disagree).
- A TSPL "Alto (mm)" field for the block, rounded to whole lines.
- `GAP 0` written when the TSPL gap is emptied or typed as 0 (today the existing `GAP` line is left as it is).
- GS1-128 is NOT optional: it is a planned task, see `odd/tasks/gs1-128.md`.
- `^SF` (ZPL mask) is not optional: it is the next planned task, with the local print agent.
