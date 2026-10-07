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
