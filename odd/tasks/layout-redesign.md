# Layout redesign (less vertical scroll, actions next to the label)

## Objective
Rearrange the UI by frequency of use so the page needs little or no vertical scroll and the controls that act on the label sit next to it. Pure UI change: no logic change.

## Why
The left column stacks six panels (Componentes, Propiedades, Código 340 px, Convertir, Variables, Avisos), there are two toolbars and the preview scrolls away. The user finds side panels uncomfortable and prefers the controls above the label.

## Agreed design (user-approved)
1. Action strip above the label: palette as a horizontal row of buttons (icon + name) and the properties as a single-row inline bar (reserve its height so the drawing does not jump on select/deselect).
2. Left column with tabs (Código, Variables, Avisos with a count badge), viewport height, one panel visible at a time.
3. "Convertir…" button in the top bar opening a dialog (the panel content moves into it).
4. Top bar: merge the two toolbars; group the view options (grid, origin points, overlaps, text scale, rotation); keep the label size controls visible.
5. Preview fills the rest and stays sticky.
Trade-off accepted: the strip uses vertical space (compact, ~48 px); alternative rejected: right-side inspector.

## Constraints
- UI only: keep every element id and the contracts used by js/app.js, js/ui.js, js/properties.js, js/palette.js, js/convert-panel.js and the image panel (move DOM, do not rename); existing tests untouched except where they assert DOM structure.
- The browser cannot be run by the agent: small phases, `node --check`, structural tests on index.html (ids present, order), user smoke test after each phase.
- Responsive: usable down to narrow widths (wrapping), `prefers` nothing fancy; no new libraries; English code/comments, Spanish UI text. Baseline `node --test` 574/574.

## Tasks
- [x] P1 (structure verified by tests/layout-structure.test.js; visual check pending in the browser) Action strip above the preview: palette horizontal + properties inline bar (CSS + HTML move, minimal JS only if panel visibility toggling needs it). User checks in the browser before P2.
- [x] P1b (structure verified by tests; visual check pending in the browser) Header with logo + "Print Bridge" name, and the view options row (dpi, text scale, rotation, grid, origins, overlaps) above the component strip.
- [x] P1c (structure verified by tests; visual check pending in the browser) Label-size row (Tamaño etiqueta, Ancho, Alto, Paso, Aplicar a la etiqueta) moved into the stage above the view row; the header is now the only top bar.
- [x] P1d (structure verified by tests; visual check pending in the browser) File actions (Abrir archivo, Ejemplo, Cargar ejemplo) moved from the header into the size row as a leading group; the header keeps only logo and title.
- [x] P1g (structure verified by tests; visual check pending in the browser) File actions moved into the Código de etiqueta panel header (title left; Abrir archivo… and the joined Ejemplo [select][Cargar ejemplo] group right); the separate file row is removed.
- [ ] P2 Left column tabs: Código / Variables / Avisos (+ badge count), viewport-height column.
- [ ] P3 "Convertir…" dialog from the top bar (reuse js/convert-panel.js unchanged where possible).
- [ ] P4 Top bar merge and grouping, sticky preview, final polish and README screenshots/notes.

## Acceptance
- No vertical scroll of the page in a normal desktop window with the TPCL and TSPL examples; palette, properties, code, variables, warnings and convert are all reachable in <= 1 click; all existing behaviors (select, drag, edit, image overlay, convert, open/drop file) still work; all tests pass.

## Routing
- Sequential delegated writers; native review per commit group (UI files are not covered by Node tests: the review matters).

## Progress
- Design agreed.
- P1 written (not committed): node --test 579/579 (574 baseline + 5 in tests/layout-structure.test.js); RED observed first (3 of 5 failed). No JS change was needed: js/palette.js:43 hides `container.parentElement`, which is now the `.strip` wrapper.
  - index.html:41-89: new `<div class="stage">` right of the column; inside, in order: `.strip` wrapper (starts `hidden`, holds `.strip-title` "Componentes" + `ul#palette`), `section#propsPanel.props-bar` (same ids, titles and inputs, moved unchanged), the existing `.preview` section. Componentes and Propiedades panels removed from the left column (it keeps Código, Convertir, Variables, Avisos).
  - css/viewer.css:17-18: global `[hidden] { display: none !important; }` (needed because class rules with `display: flex/grid` defeat the attribute; the old `.props { display: grid }` already did, so the empty form/overlay were not truly hidden before).
  - css/viewer.css:43: `.stage` flex column, gap 12px.
  - css/viewer.css:74-77: `.strip`, `.strip-title`, compact `.strip .palette-item` (label.css still provides the item look).
  - css/viewer.css:85: preview SVG `max-height: calc(100vh - 300px)` (was 140px; +48 strip +48 bar +24 gaps +~40 caption/padding), calculation in the comment above it.
  - css/viewer.css:87-101: properties bar as one flex row (`.props-bar`, `min-height: 48px` reserved), `.props` grid -> wrapping flex, `label` text and control side by side, compact number inputs (72px); removed the grid-only `checkbox justify-self` rule.
  - tests/layout-structure.test.js: ids exactly once, DOM order palette < propsPanel < preview inside the stage, left column free of palette/props, palette hidden-wrapper contract matches js/palette.js and js/app.js.
  - Browser checklist: palette buttons visible and clickable (TPCL); palette strip hidden for TSPL; drag from palette onto the label still works; select an item -> bar fills and edits; deselect -> empty state "Selecciona un objeto" without the preview moving; image overlay controls appear in the bar (X, Y, Ancho, Umbral, buttons) and only for an image; narrow window wraps without breakage; no unexpected page scroll with the TPCL spool example; the 300px SVG max-height fits at your usual window height (tell me if too small/large).
- P1b written (not committed): node --test 583/583 (579 + 4 new tests in tests/layout-structure.test.js); RED observed first (4 of 9 failed). No JS change. No existing assertion changed (the P1 order test still holds).
  - Logo concept: blue rounded tile with a white label card crossed by a dark bridge arch (deck + two pillars) over barcode bars.
  - img/logo.svg (new): flat SVG, viewBox 0 0 64 64, no fonts, no external references.
  - index.html:6-7: title "Print Bridge" and `rel="icon"` link; index.html:13-14: logo `img` (alt="") and h1 "Print Bridge"; header keeps only Abrir archivo, Ejemplo select and Cargar ejemplo.
  - index.html:51-: new `div.view-row` as first child of `.stage` (before `.strip`) holding the six moved controls unchanged.
  - css/viewer.css:26-29: `.toolbar .logo` and the toolbar label/select/input rules extended with `.view-row` selectors (toolbar look unchanged); :46 `.view-row` panel row (min-height 38px, wrapping); :89 SVG max-height `calc(100vh - 350px)` (was 300px; +38 row +12 gap), arithmetic in the comment above it.
  - Tests: six controls once and inside `.stage` before `.strip`; header and secondary toolbar free of them; title and h1 "Print Bridge"; logo img and favicon point to `img/logo.svg`, which exists and is a safe SVG (`<svg`, viewBox, no script, no href, no remote url()).
  - Browser checklist: logo readable at 28px in the header; favicon shows in the tab; the view row appears above the component strip; Resolución changes the render; Escala texto changes fonts; Giro rotates; Rejilla, Puntos origen and Marcar solapas toggle; narrow window wraps the row without breakage; no unexpected page scroll (tell me if the 350px max-height is too small or large).
- P1c written (not committed): node --test 586/586 (583 + 3 new tests in tests/layout-structure.test.js); RED observed first (3 of 12 failed). No JS change (ids unchanged).
  - Changed assertion (premise changed): "the toolbars no longer hold the view controls" no longer slices the secondary toolbar, which no longer exists; it checks the header only.
  - index.html:41-49: new `div.size-row` as first child of `.stage` holding the five size controls unchanged (ids, titles, options, "Tamaño etiqueta"); the `.toolbar--secondary` element is removed (header is the only bar).
  - css/viewer.css:26-31: toolbar label/select/input/number/disabled rules extended with `.size-row` selectors; :45 `.size-row, .view-row` share the panel row rule; removed the dead `.toolbar--secondary` rule (nothing else used it); :85-89 SVG max-height `calc(100vh - 360px)` (was 350px), arithmetic in the comment: 49 header + 32 main padding + 16 preview header + 172 rows (38+38+48+48) + 48 gaps (4x12) + ~40 caption/padding = 357, rounded to 360.
  - Tests (tests/layout-structure.test.js): five size controls once, inside `.size-row`, before `.view-row`; DOM order size row -> view row -> strip -> props bar -> preview; no `toolbar--secondary` and exactly one `.toolbar` (header) with none of the size controls.
  - Browser checklist: header is a single bar (logo, title, Abrir archivo, Ejemplo, Cargar ejemplo); size row is the first row of the stage, above the view row; Tamaño etiqueta select fills Ancho/Alto/Paso and edits work; Aplicar a la etiqueta writes the size into the code; narrow window wraps the row without breakage; no unexpected page scroll (tell me if the 360px max-height is too small or large).
- P1d written (not committed): node --test 590/590 (586 + 4 new tests in tests/layout-structure.test.js); RED observed first (2 of 16 failed, the rest of the new checks passed only after the move). No JS change (ids unchanged; js/app.js wiring of #btnOpen, #file, #example, #btnExample untouched).
  - Changed assertion (premise changed): "the toolbars no longer hold the view controls" no longer requires the file controls to be in the header; the opposite is now asserted by the new header test.
  - index.html:12-15: header is only logo + h1; index.html:36-43: size row now holds `div.row-group.row-group--file` (btnOpen, hidden file input, Ejemplo label + select, btnExample, all unchanged) followed by `div.row-group.row-group--size` (the five size controls); `#imageFile` stays after the header.
  - css/viewer.css:46-49: `.row-group` inline flex container with its own wrapping, `.row-group--file` has a right padding and a 1px divider; no display: contents. The row/label/input rules are descendant selectors, so the look is unchanged. :92-95 comment re-derives the SVG max-height: header height (logo 28 -> 49) and row count unchanged, so it stays calc(100vh - 360px).
  - Tests: four file controls once, inside the file group, inside .size-row and before #size; header has no button/select/input/label and only logo + title; #imageFile once between header and main; file input attributes and control texts unchanged.
  - Browser checklist: Abrir archivo opens the dialog and loads the file; dropping a file on the code area still works; Ejemplo select + Cargar ejemplo load the example; header is just logo and title; the divider separates file actions from the size controls; narrow window wraps the groups sensibly; no unexpected page scroll (the 360px max-height is unchanged).
- P1e done (user request): the Convertir panel moves below Variables in the left column (order Código, Variables, Convertir, Avisos); it replaces the dialog idea of P3 for now. index.html block move + structural test; node --test 591/591 (the test was written together with the move, no separate RED). Review of P1-P1d was offered and skipped by the user (declined for that candidate). Browser checklist: Convertir sits under Variables and still converts/copies/downloads.
- P1f written (not committed; user request): node --test 593/593 (591 + 2 new tests; the P1d file-controls test was replaced in place); RED observed first (5 of 17 layout tests failed). No JS change: js/app.js:25 finds `#msgs` by id and js/ui.js does not use its parent; ids unchanged.
  - Changed assertions (premise changed): "left column no longer holds the palette or the properties" no longer expects `msgs` in the column (it asserts the opposite); the P1d "file controls in the size row" test is replaced by "file controls in the left column before #src and not in the size row"; the P1e order test is now file row -> Código -> Variables -> Convertir (Avisos left the column).
  - index.html:21-26: new `section.file-row` first in the left column (btnOpen, hidden file input, Ejemplo label + select, btnExample, unchanged); index.html:40-: `.size-row` holds only the five size controls (the `row-group` wrappers are removed); last block of the stage: `section.panel.msgs-panel` with "Avisos" and `ul#msgs.msgs`, after the preview section.
  - css/viewer.css:26-29: toolbar control rules extended with `.file-row`; `.file-row select/label` shrink (`min-width: 0`) and wrap; the shared row rule includes `.file-row`; removed the unused `.row-group*` rules; `.msgs-panel` (padding 6px 12px, list `max-height: 96px; overflow: auto`, level colors unchanged); SVG max-height `calc(100vh - 500px)` (was 360px; +130 Avisos panel at maximum +12 gap = 502, rounded to 500, arithmetic in the comment).
  - Tests: `#msgs` once, last in the stage right after the preview section and not in the column; file controls once, in the left column before `#src`, not in `.size-row`, no `row-group` left; `.size-row` ids exactly `size, szW, szH, szP, btnApply` in order; column order file row, src, vars, convert.
  - Browser checklist: Avisos shows messages below the drawing and scrolls when long (try an invalid label); file row sits above the code box: Abrir archivo opens the dialog, dropping a file on the code box loads it, Ejemplo + Cargar ejemplo load; size row only has the size controls; at ~340px column and narrow window the file row wraps without overflow; no unexpected page scroll (tell me if the 500px SVG max-height is too small or large).
- P1g written (not committed; user request after browser review): node --test 594/594 (593 + 1 new test; the P1f file-controls test was rewritten in place); RED observed first (2 of 18 layout tests failed). No JS change: ids, attributes, titles and texts of #btnOpen, #file, #example, #btnExample are unchanged, so the js/app.js wiring and the drag-and-drop on #src are untouched; the button still triggers the load (no auto-load on change).
  - Changed assertions (premise changed): the P1f "file controls before #src in the left column" test now looks inside the Código de etiqueta panel; the column order test is now Código -> Variables -> Convertir (no file row). The .size-row test (five size controls) is unchanged.
  - index.html:21-32: the section.file-row is gone; the Código panel opens with div.panel-head = h2 + div.panel-actions (btnOpen, hidden #file, div.btn-group with the Ejemplo label + #example and #btnExample).
  - css/viewer.css:26-27: toolbar control rules use .panel-actions instead of .file-row; :48 shared row rule is now .size-row, .view-row; :49-55 new .panel-head (flex, space-between, wrap, gap, margin-bottom 8px moved from the h2; the selector .panel .panel-head h2 resets the h2 margin so it wins over .panel h2), .panel-actions (flex, wrap, gap), .btn-group (select right corners square, button left corners square, margin-left -1px, min-width 0 so it shrinks inside the 340px column). Removed the unused .file-row rules (no other reference remained).
  - SVG max-height calc(100vh - 500px) is not affected: the left column is not part of its arithmetic and its comment only mentions the file row as having left the size row; untouched.
  - Browser checklist: the code panel header shows the title plus Abrir archivo… plus Ejemplo [select][Cargar ejemplo] visually joined, wrapping inside the narrow column without overflow; Abrir archivo opens the dialog and loads the file; Cargar ejemplo loads the chosen example; dropping a file on the textarea still works; the spacing between header and textarea looks the same as before.

## Open ideas
- Optional: load the example on select and drop the button.
