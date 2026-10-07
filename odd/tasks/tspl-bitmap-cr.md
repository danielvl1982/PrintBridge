# tspl-bitmap-cr

Branch: `fix/tspl-bitmap-cr`. Delivery strategy: ask-on-risk (default). First of three pending items (then DIRECTION 0, then logo).

## Problem
The editor is a `<textarea>`: the browser normalizes newlines in its value (CRLF and lone CR become LF). TSPL `BITMAP` carries raw
bytes (latin1 file handling), so any 0x0D byte in the payload is altered when a file is opened or dropped (CRLF pairs also shrink the
payload, breaking the length-based tokenizer). Real images contain many 0x0D bytes, so the preview, conversion and edits of an
existing BITMAP label can be wrong.

## Design
- Use a placeholder character for 0x0D bytes inside BITMAP payloads while the text lives in the editor: `PB.tspl.CR_PLACEHOLDER`
  (a private-use code point, e.g. U+E00D; it cannot occur in latin1 decoded text). The CRLF line endings of the file itself are not touched.
- `PB.ui.decodeFile` (js/ui.js): when the bytes are decoded as latin1 TSPL with a BITMAP, find each BITMAP payload span with the TSPL
  tokenizer on the faithful decoded text and replace the 0x0D chars inside payload spans by the placeholder (before the text reaches
  the textarea).
- Everything that turns payload chars back into bytes maps the placeholder to 0x0D: the TSPL BITMAP item decoding (js/components/image/tspl.js,
  preview data), the TSPL emitter if it reads payload chars, `PB.convert.toBytes` for latin1 targets. Tokenizer length counting is
  unchanged (the placeholder is one char like the CR it replaces).
- Moves/edits of BITMAP headers keep the payload (placeholder included) byte for byte.

## Tasks
- [x] T1 Placeholder: constant, decodeFile mapping, mapping back in image decoding / emit / toBytes, tests (incl. fake-DOM-free pure tests,
      round trip file bytes -> editor text -> parse -> emit -> file bytes equal for a payload with 0x0D, 0x0A and CRLF pairs), docs.

## Verification
`node --test` all green. Browser (user): open a TSPL file with a BITMAP (an image label); the preview shows the image correctly;
converting TSPL -> TSPL and downloading gives the same bytes in the payload.

## Progress
- T1 done (route: delegated writer; heuristic ~400 lines respected). Where 0x0D is lost: the editor is a `<textarea>` whose `.value` replaces CRLF and
  lone CR with LF, so the text read by the parser/tokenizer (`getText()`) no longer has the payload CR (and a CR LF pair shrinks the payload by one).
  Placeholder design `PB.tspl.CR_PLACEHOLDER` (U+E00D, defined in js/languages/tspl.js): `PB.ui.decodeFile` replaces CR inside BITMAP payload spans (found by
  the tokenizer on the faithful text) for latin1 TSPL with a BITMAP; it also covers an ASCII-only file with a BITMAP (it used to return before the TSPL check).
  Payload readers: the only ones are the tokenizer `toBytes` (cmd.data, used by the image slice, which needs no change) now mapping the placeholder to 0x0D, and
  `PB.convert.toBytes` for latin1 targets. The TSPL emitter builds the payload from the bitmap, not from payload chars; move/size/update edits only rewrite
  header/other command spans, so payloads stay byte for byte. No other reader found, design unchanged.
  Files: js/languages/tspl.js, js/ui.js, js/core/convert.js, tests/tspl-bitmap-cr.test.js (12 tests; RED: 7 of 12 failed before the code, the rest passed vacuously),
  README.md (limitation note updated). `node --test`: 754 pass.
  Browser checklist: open a TSPL file with a BITMAP containing 0x0D bytes: the preview draws the image; the code box shows odd glyphs for those bytes; converting
  TSPL -> TSPL and downloading gives the same payload bytes; moving the image by drag keeps the payload.
