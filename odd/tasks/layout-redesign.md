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
