# ZPL `^SF` (serialization field with a mask)

Status: IN PROGRESS (added 2026-10-09; started 2026-10-13, S1 done). Branch when started: `feat/zpl-sf-mask`. Create the Engram mirror `odd/zpl-sf-mask/tasks`
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

## Decisions
- 2026-10-13 (user): **decimal masks only** (`d` / `D` and `%`). Alphabetic, hexadecimal, octal and alphanumeric placeholders (`A`, `H`, `O`, `N`)
  are out of scope: a field with one of them keeps today's behaviour (plain `^FD`, with a warning that names the unsupported placeholder).
  Document it in the README (what is covered, what is not).
- 2026-10-13 (defaults taken without asking, open for review): `^SF` on a QR / Data Matrix and combined with `^FN` follows what `^SN` already
  does in the same cases (the manual is silent); the preview shows the first value only, as `^SN` does.
- 2026-10-13 (delivery, cached from the GS1-128 feature): one branch `feat/zpl-sf-mask`, one work-unit commit per task (tests and docs with the
  behavior), everything merged and pushed to `main` together after S5; push / merge only on the user's go. Forecast about 700 authored lines.

## S1 findings (2026-10-13, read-only; printed pages of Volume One)
- `^SF` pp. 298-300, exercise 4 of the Basic ZPL Exercises; Volume Two has no `^SF` reference.
- The increment `b` is a **positional string** aligned with the mask from the right, not an integer: `^FDABCD1000EFGH^SF%%%%dddd%%%%,10000`
  has the increment `10000` right-aligned on the 12-character mask: its `1` lands on the last `d` and the four zeros on the `%%%%`, so the
  step is +1 on the number 1000 (15 labels end at ABCD1014EFGH). Do not model `b` as an integer step.
- Inferred, not stated (needs a Zebra): in `^FDBL00-0^SFAAdd%d,1%1` the jump BL09-9 -> BL11-0 means each position adds its own increment
  character and a carry skips the `%` positions.
- Not stated in either volume: `^SF` with `^PQ` replicate, `^FN`, `^FV`, `^FH`, `^FB`, QR / Data Matrix (only PDF417 says serialization is not
  allowed), a `^FD` shorter than the mask, wrap order, media-out recovery.
- Code: `^SF` is only a field modifier with the `zpl-sf` warning (js/languages/zpl.js:850, README ZPL section); pinned by
  `tests/zpl-counters.test.js:134-141` (S2 rewrites that test first). The neutral `counter` is a never-zero signed integer `step`; the TPCL
  (10 digits) and TSPL (+-999999999, 50 slots) counters are decimal only and count the whole trailing digit run.
- Model chosen: a separate item property `serialMask = { mask, increment }` (counter untouched); a plain decimal mask whose `d` run covers the whole
  trailing digit run of the data, with an all-digit increment, also sets `counter = { step }` so it converts to TPCL / TSPL; every other mask
  (`%` inside or around, partial run) degrades with one warning and the field is written as its first value.

## Tasks (to refine when started)
- [ ] S1 Read the manual (Volume One pages 298-300 and the exercises, Volume Two) and decide the model: extend the existing `counter` model of `^SN`
      (start, step, zero suppression, digits only) with an optional mask / alphabet per position, or add a separate mask serialization item
      property. Decide first how much of the alpha / hex / octal behaviour is worth the cost (the TPCL and TSPL counters are decimal only).
- [x] S2 (8ff7d5c, route: delegated direct writer; RED: 14 failing tests, GREEN: full suite) Parse and draw: read `^SF` into the model (mask, increment, the `^FD` data as the first value), remove the `zpl-sf` warning, draw the
      first value as `^SN` does, with the neutral flags documented in js/core/model.js.
- [x] S3 (28fa686, RED: 9 failing edit tests; the emit path shipped with S2, so its tests were green on arrival) Emit and edit: write `^SF` back exactly as read; Propiedades fields for the mask and the increment (and the counter fields that apply);
      move, undo and the edit engines keep working; the `^FD` data stays editable.
- [ ] S4 Conversion: to and from the TPCL and TSPL counters (decimal masks with a numeric increment map to a counter; masks with letters,
      hex, octal or `%` in the middle degrade with one warning, the field is written as its first value); update the loss table; the conversion matrix cases.
- [ ] S5 Tests (RED first: the manual's examples above as pinned cases, round trip parse -> emit -> parse, the matrix), README (ZPL section and
      limitations: remove "not modelled", add what is verified and what is not), an example in the ZPL templates if it fits, Chrome probe, and a
      printer check on a Zebra (the real test of the alphabetic and `%` behaviour).

## S2 / S3 results (2026-10-13)
- Model: `serialMask = { mask, increment }` (strings as written, increment '' when omitted) on text and barcode items, documented in js/core/model.js.
  Only `d D %` masks and digit / `%` increments no longer than the mask are modelled; anything else keeps the plain `^FD` with one warning that names the
  placeholder (A a H h O o N n) or the problem. A mask longer than the data is modelled with one warning (manual silent).
- Bridge: a `d` run covering the whole trailing digit run of the data, with an all-digit increment (or none: 1) in 1..999999999999, also sets
  `counter = { step }` (no native). `serialMask` wins over `counter` when the ZPL emitter writes the field (`^FD...^SFmask[,increment]`, never `^SN`).
- QR / Data Matrix: info, no mask (as `^SN`); `^FN` + `^SF`: warning, the variable wins; `^SN` + `^SF`: warning, the counter wins; `^FB` + `^SF`: info,
  the mask is kept and written back. All manual-silent, recorded as such.
- Edit: fields `serialMask` and `serialIncrement` (only for a modelled mask; an empty mask removes `^SF`, an empty increment removes the argument).
  A field with any `^SF` has no Incremento / Ceros iniciales (they would write `^SN` over the `^FD`). Adding a mask to a plain `^FD` is not offered.
- For S4: the TPCL / TSPL emitters already see the bridged `counter` (untouched); a `serialMask` without `counter` is silently dropped there, so S4 needs the
  warning and the loss table entry; `serialMask` and `counter` can disagree after a counter edit in another language (ZPL writes the mask).

## Acceptance
A ZPL field with `^SF` is drawn with its first value without the "no se modela" warning, round-trips unchanged, is editable in Propiedades,
converts to a TPCL / TSPL counter when the mask is decimal (with a warning otherwise), and `node --test` stays green.

## Open questions for the user (ask when starting)
- Is the alphabetic / hexadecimal / octal serialization needed, or only the decimal masks (the counters the plant uses today)?
- What does `^SF` do on a QR or Data Matrix, and combined with `^FN` (the manual does not say; `^SN` has the same open points).
- Should the Variables panel or the preview show the next values of the sequence (the first label only, as `^SN` does today)?
