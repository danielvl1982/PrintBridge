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
- [ ] P1 Action strip above the preview: palette horizontal + properties inline bar (CSS + HTML move, minimal JS only if panel visibility toggling needs it). User checks in the browser before P2.
- [ ] P2 Left column tabs: Código / Variables / Avisos (+ badge count), viewport-height column.
- [ ] P3 "Convertir…" dialog from the top bar (reuse js/convert-panel.js unchanged where possible).
- [ ] P4 Top bar merge and grouping, sticky preview, final polish and README screenshots/notes.

## Acceptance
- No vertical scroll of the page in a normal desktop window with the TPCL and TSPL examples; palette, properties, code, variables, warnings and convert are all reachable in <= 1 click; all existing behaviors (select, drag, edit, image overlay, convert, open/drop file) still work; all tests pass.

## Routing
- Sequential delegated writers; native review per commit group (UI files are not covered by Node tests: the review matters).

## Progress
- Design agreed. Next: P1.
