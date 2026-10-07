# example-on-select

Branch: `feat/example-on-select`. Delivery strategy: ask-on-risk (default).

## Objective
Loading an example no longer needs a button: choosing it in the "Ejemplo" combo loads it, and the "Cargar ejemplo" button goes away.

## Design
- The combo gets a first, disabled placeholder option ("Elegir ejemplo…") that is the shown value. Picking any example fires `change`
  and loads it (so picking the same example twice, or the first one, also works); afterwards the combo goes back to the placeholder.
- At startup the app still loads `examples[0]` as before (the combo shows the placeholder).
- `#btnExample` is removed from index.html, app.js, tests (layout-structure REQUIRED_IDS/FILE_IDS/example-group tests), CSS leftovers
  of the joined select+button group (`.btn-group`), README/CONTRIBUTING mentions.

## Tasks
- [x] T1 Example combo loads on change with a placeholder; remove the button, its CSS and docs; update structure tests; add behavior tests.

## Route declaration
Delegated direct: one writer (index.html, app.js, css, several test files, docs).

## Verification
`node --test` all green. Browser (user): picking an example loads it; the combo returns to "Elegir ejemplo…"; picking the same one again reloads it.

## Progress
- T1 done (uncommitted, parent commits): PB.ui.createExamplePicker in js/ui.js (placeholder "Elegir ejemplo…", change loads then resets); #btnExample, .btn-group CSS and README mention removed; layout-structure tests updated; tests/example-picker.test.js added. `node --test`: 645 pass, 0 fail.
