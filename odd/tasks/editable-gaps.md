# editable-gaps

Branch: `feat/editable-gaps`. Delivery strategy: ask-on-risk (default). Planning forecast: ~1200 authored lines in 6 tasks (one commit each).

## Objective
Finish what the designer already has before adding components: close the gaps between the properties panel and the printer manuals
(Toshiba B-SV4 external equipment interface spec, TEC B-442/443 TSPL manual; local copies in `docs/`, git-ignored).

## Findings (read-only exploration)
- Field contract: `describeItem(item, text?) -> { kind, fields:[{key,label,type:'number'|'select'|'checkbox',...}] }` and
  `updateItem(text, item, changes, {dpi})` (js/core/languages.js:21-23). Slices declare `editable` through their language factories.
- TPCL engine (js/languages/tpcl.js:224-382) rewrites only a capture-group span inside the format command (`item.source.spans[0]`); it cannot
  touch another command (RC/RV/RB) nor edit free text or letter selects. TSPL engine (js/languages/tspl-edit.js:36-169) works by argument
  offsets, so a quoted argument (content, font id) can be rewritten with a custom field.
- Panel (js/properties.js:13-63): renders number / select / checkbox only; `coerceFieldValue` would turn a string into NaN. A `'text'` type needs
  a control branch and a coercion branch.
- Content: TPCL inline `=data` lives in the format span; with a separate RC/RV/RB command the data is NOT in `item.source` (find
  `{R[CVB]<id>;...|}` by regex). Unsafe chars `| { } CR LF` cannot be escaped (emit replaces them with spaces). TSPL: TEXT content is arg 6/7,
  quotes escaped as `\["]` (`quoted()` in tspl.js:167); BARCODE 128M/EAN128 data is rewritten by the parser; QR manual mode strips a prefix.
- TPCL text attribute (`B`/`W(aabb)`/`F(aabb)`/`C(aa)`), spacing `±hh`, bold `Jkkll`, alignment `Pq` are skipped by TEXT_TAIL
  (js/components/text/tpcl.js:132) and never reach the item; the renderer (text/render.js:19-28) draws none of them; `C` does not even match `[BWF]`.
- Barcode type: changes the whole tail layout in TPCL (two forms) and wide/narrow applicability in TSPL: not a one-field edit.

## Agreed scope (user: resolve the gaps before adding components)
In: G1 content, G2 font, G3 attribute W/F/C, G4 alignment, G5 spacing and bold.
Out for now (cost/risk, decide later): G6 barcode type selector, G7 check digit / increment / zero-suppress.

## Tasks
- [x] T1 Panel `text` field type + TSPL content editing: `type:'text'` control and coercion in js/properties.js, TSPL TEXT content (quote-safe), BARCODE and QRCODE content where the parser keeps the raw data; tests.
- [ ] T2 TPCL content editing: inline `=data` and the separate RC/RV/RB command (framing-unsafe chars rejected, FNC1 `>8` round trip), PC/PV/XB; tests.
- [ ] T3 Font: TPCL PC font letter select, TSPL TEXT font id (string select); tests.
- [ ] T4 TPCL text attribute: parse B/W/F/C (extend the regex) into the item, draw reverse / boxed / stroked in the preview, edit the attribute; tests.
- [ ] T5 TPCL alignment `P1..P4`: parse, draw in the preview, edit; tests.
- [ ] T6 TPCL spacing `±hh` and bold `Jkkll`: parse, show, edit; README and contract docs.

## Route declaration
Delegated direct, one writer per task (multi-file each, sequential). Reading that prepares each write belongs to its writer.

## Acceptance
Every field round-trips through updateItem without touching other commands; unknown or invalid values leave the text unchanged; existing
behaviour (rotation, magnification, drag) unchanged; `node --test` green after each task.

## Verification
`node --test` after each task. Browser (user, after T6): edit content, font, attribute and alignment from the panel in TPCL and TSPL labels.

## Progress
Branch created; exploration done.
T1 done: panel `text` field + TSPL content (TEXT/BARCODE/QR); `node --test` 771/771 green; commit COMMIT_ID. Next: T2.
