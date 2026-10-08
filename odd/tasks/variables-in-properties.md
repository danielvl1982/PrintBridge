# variables-in-properties

Branch: `feat/variables-in-properties`. Delivery strategy: ask-on-risk (default). Planning forecast: ~300 authored lines in 2 tasks.

## Objective
The test value of a variable (`#NAME#` / `<#NAME#>`) is edited where the object is: the Propiedades panel of the selected object shows one
"valor de prueba" field per variable it uses. The Variables panel stays (global view, objects that cannot be selected) but moves below
Convertir and starts collapsed.

## Findings
- Variables are global by name (`state.values`, js/app.js:23, 27, 478) and preview-only: values are never written to the code (js/core/variables.js).
- An object can use several variables (`#ROLLNUM# / #TOTALROLLS#`) and one variable can be used by several objects: editing it changes all of them.
- The properties form re-renders after each edit and restores focus by `data-key` (js/properties.js); `describeItem`/`updateItem` are language-level and
  write code, so the test values must NOT go through them: they are an app-level group appended by the panel, fed by `PB.variables.namesIn(item.data)`.
- Left column order today: Código, Variables, Convertir (index.html:20-39); collapse state per `data-collapsible` key in localStorage (js/collapse.js).

## Decisions (user)
- Add the per-object test values to Propiedades and keep the Variables panel, collapsed by default and placed below Convertir.

## Tasks
- [x] T1 Test values in Propiedades: group "Valores de prueba (solo vista previa)" with one text field per variable of the selected object
      (`Valor de NAME`), a note "usada en N objetos" when the variable appears in more than one, both panels editing the same `state.values` and
      staying in sync, no change to the code text, tests.
- [ ] T2 Variables panel below Convertir and collapsed by default (an explicit user choice stored in localStorage still wins), structure tests, README.

## Route declaration
Delegated direct, one writer for both tasks (same files), two commits.

## Acceptance
Typing a value in Propiedades updates the preview and the Variables panel; typing in the Variables panel updates the Propiedades fields of the selected
object; the code text never changes; the panel order is Código, Convertir, Variables; Variables starts collapsed on a clean browser; `node --test` green.

## Verification
`node --test`; Chrome check by the assistant (puppeteer-core outside the repo): select a text with variables, edit its values, check the preview, the
shared note and the panel order/collapse.

## Progress
Plan created. Next: T1.
