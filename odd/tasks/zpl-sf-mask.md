# ZPL `^SF` (serialization field with a mask)

Status: PLANNED (added 2026-10-09; not started). Branch when started: `feat/zpl-sf-mask`. Create the Engram mirror `odd/zpl-sf-mask/tasks`
before the first write.

## Objective
Today `^SF` is read as a plain `^FD` field with one warning ("no se modela"): js/languages/zpl.js (`^SF` is a field modifier, the warning is
`zpl-sf`, around line 744) and README (ZPL section, around line 446). Model it so that a field with `^SF` is drawn with its first value,
edited in Propiedades, written back unchanged, and converted to and from the TPCL and TSPL counters where that is possible.

## What the manual says (Volume One 2003, `^SF`, printed pages 298-300; Basic ZPL Exercises, exercise 4)
- Format `^SFa,b`; it serializes a standard `^FD` string (`^SN` is the other serialization command, already modelled as the neutral `counter`).
- `a` = mask string: its length is the number of characters of the `^FD` string that are serialized, aligned with the right-most
  character of the data (the characters before it stay as they are). Placeholders: `D`/`d` decimal 0-9, `H`/`h` hexadecimal 0-9 a-f A-F,
  `O`/`o` octal 0-7, `A`/`a` alphabetic a-z A-Z, `N`/`n` alphanumeric 0-9 a-z A-Z, `%` ignore the character (skip). Mask plus increment: 3K
  combined at most.
- `b` = increment string, added on each label, aligned with the mask from the right-most position; default equivalent to a decimal one. Its
  characters are those of the serial scheme; invalid characters count as zero; for alphabetic fields the zero is `A`/`a` (an increment of one
  is `B`/`b`); `%` in the increment marks characters that are not incremented.
- Examples of the manual: `^FD12A^SFnnA,F^FS` with `^PQ3` (mask `nnA`: two alphanumeric characters and one uppercase letter, increment F = 5);
  `^FDBL0000^SFAAdddd,1` gives BL0000, BL0001 ... BL9999, BM0000; `^FDBL00-0^SFAAdd%d,1%1` gives BL00-0, BL01-1 ... BL09-9, BL11-0;
  exercise 4 `^FDABCD1000EFGH^SF%%%%dddd%%%%,10000` increments only the middle digits (the last of 15 labels prints ABCD1014EFGH).
- Volume Two has no `^SF` reference (only the programming exercises). Read both volumes again when starting, the text above is a first read.

## Tasks (to refine when started)
- [ ] S1 Read the manual (Volume One pages 298-300 and the exercises, Volume Two) and decide the model: extend the existing `counter` model of `^SN`
      (start, step, zero suppression, digits only) with an optional mask / alphabet per position, or add a separate mask serialization item
      property. Decide first how much of the alpha / hex / octal behaviour is worth the cost (the TPCL and TSPL counters are decimal only).
- [ ] S2 Parse and draw: read `^SF` into the model (mask, increment, the `^FD` data as the first value), remove the `zpl-sf` warning, draw the
      first value as `^SN` does, with the neutral flags documented in js/core/model.js.
- [ ] S3 Emit and edit: write `^SF` back exactly as read; Propiedades fields for the mask and the increment (and the counter fields that apply);
      move, undo and the edit engines keep working; the `^FD` data stays editable.
- [ ] S4 Conversion: to and from the TPCL and TSPL counters (decimal masks with a numeric increment map to a counter; masks with letters,
      hex, octal or `%` in the middle degrade with one warning, the field is written as its first value); update the loss table; the conversion matrix cases.
- [ ] S5 Tests (RED first: the manual's examples above as pinned cases, round trip parse -> emit -> parse, the matrix), README (ZPL section and
      limitations: remove "not modelled", add what is verified and what is not), an example in the ZPL templates if it fits, Chrome probe, and a
      printer check on a Zebra (the real test of the alphabetic and `%` behaviour).

## Acceptance
A ZPL field with `^SF` is drawn with its first value without the "no se modela" warning, round-trips unchanged, is editable in Propiedades,
converts to a TPCL / TSPL counter when the mask is decimal (with a warning otherwise), and `node --test` stays green.

## Open questions for the user (ask when starting)
- Is the alphabetic / hexadecimal / octal serialization needed, or only the decimal masks (the counters the plant uses today)?
- What does `^SF` do on a QR or Data Matrix, and combined with `^FN` (the manual does not say; `^SN` has the same open points).
- Should the Variables panel or the preview show the next values of the sequence (the first label only, as `^SN` does today)?
