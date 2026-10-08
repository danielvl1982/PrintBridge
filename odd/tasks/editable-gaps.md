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
- [x] T2 TPCL content editing: inline `=data` and the separate RC/RV/RB command (framing-unsafe chars rejected, FNC1 `>8` round trip), PC/PV/XB; tests.
- [x] T3 Font: TPCL PC font letter select, TSPL TEXT font id (string select); tests.
- [x] T4 TPCL text attribute: parse B/W/F/C (extend the regex) into the item, draw reverse / boxed / stroked in the preview, edit the attribute; tests.
- [x] T5 TPCL alignment `P1..P4`: parse, draw in the preview, edit; tests.
- [x] T6 TPCL spacing `±hh` and bold `Jkkll`: parse, show, edit; README and contract docs.

## Route declaration
Delegated direct, one writer per task (multi-file each, sequential). Reading that prepares each write belongs to its writer.

## Acceptance
Every field round-trips through updateItem without touching other commands; unknown or invalid values leave the text unchanged; existing
behaviour (rotation, magnification, drag) unchanged; `node --test` green after each task.

## Verification
`node --test` after each task. Browser (user, after T6): edit content, font, attribute and alignment from the panel in TPCL and TSPL labels.

## Progress
Branch created; exploration done.
T1 done: panel `text` field + TSPL content (TEXT/BARCODE/QR); `node --test` 771/771 green; commit a1cf696. Next: T2.
T2 done: TPCL content (inline =data, RC/RV/RB command, FNC1 >8 round trip, unsafe chars rejected, max 255); `node --test` 792/792 green; commit c81e1a6. Next: T3.
T3 done: TPCL PC/PV font letter select and TSPL TEXT font id (string select, extra option for a current unknown value); `node --test` 804/804 green; commit a442d2e. Next: T4.
T4 done: TPCL text attribute B/W/F/C parsed into item.attribute, drawn (pure geometry in text/render.js, sized from the measured text in layout.js), written back by emit and editable (kind + margins in dots); TSPL warns once; `node --test` 833/833 green; commit 573bef2 (browser check pending). Next: T5.
T5 done: TPCL alignment Pq/Po parsed into item.align (P1 = none), drawn via text-anchor / textLength (pure alignAttributes in text/render.js; center/right relative to the origin = approximation, the manual gives an area width only to P4), written back by emit and editable (kind + equal-space width); TSPL info once; `node --test` 858/858 green; commit 9551f47 (browser check pending). Next: T6.
T6 done: TPCL character spacing ghh/ghhh (item.spacing, signed dots in native + 0.1 mm) and PC bold Jkkll (item.bold) parsed, drawn (SVG letter-spacing; bold as shifted overprint copies, pure helpers in text/render.js), written back by emit and editable (spacing -99..99 PC / -512..512 PV, bold 0..16 PC only); TSPL info once each; `node --test` 892/892 green; commit 6e37274 (browser check pending).

## Result
The editable-gaps feature closed the panel-versus-manual gaps for text in six commits: panel `text` field and TSPL content (T1), TPCL content inline or in RC/RV/RB (T2), font letter / TSPL font id (T3), TPCL attribute B/W/F/C drawn and editable (T4), alignment Pq/Po (T5) and character spacing plus PC bold (T6). Every field is whole-token `exact` in the TPCL engine, round-trips through parse -> emit -> parse and leaves other commands untouched; TSPL conversion warns or informs once per feature. Open points: the default margin of attributes in PV (character size in mm x 8 dots) is a reading of the manual not verified on a printer; center / right alignment are drawn relative to the item origin (an approximation, the manual gives an area width only to P4); the bold overprint is drawn as shifted copies (an approximation); G6 (barcode type selector) and G7 (check digit / increment / zero-suppress) were left out by agreement. Pending browser check by the user: edit content, font, attribute, alignment, spacing and bold from the panel in TPCL and TSPL labels.
