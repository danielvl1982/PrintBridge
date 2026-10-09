# Example templates per printer language

Branch: `feat/example-templates`. Strategy: single PR (small), `ask-on-risk`.

## Objective
The Ejemplo combo offers, for each printer language (TPCL, TSPL, ZPL): (1) a **basic example**, the same label in the three languages,
simple, showing the potential of the app (labels, a bar code, a QR, fields with variables, a frame and a line); (2) a **blank template**
(header only, no items) that sets the language and the label size, so that the palette inserts commands of that language.
The four existing examples stay as complete examples.

## Decisions (from the user's answers)
- "muestreo" = a sample label with labels (texts), a bar code, variable fields, etc., to show the potential of the app.
- One basic example and one blank template per language; the basic labels carry the same content (100x60 mm at 203 dpi).
- The blank template is what makes the palette insert for that language (with an empty editor the palette used TPCL by default).

## Tasks
- [x] E1 Content: three basic examples (same label: frame, title, product / lot variables, Code128 with variable, QR, line) and three
      blank templates in `js/config.js`, each with its `values`. Written in TSPL first and converted with PB.convert to TPCL / ZPL, then
      reviewed by hand (they must parse with no warning and read as the same label).
- [x] E2 Picker: groups ("En blanco", "Básicos", "Ejemplos completos") in the Ejemplo combo (`js/ui.js` createExamplePicker, optgroups);
      loading a blank template sets language, size and palette (the palette inserts commands of that language).
- [x] E3 Tests: every example parses without errors / warnings and is detected as its language; the three basic ones have the same
      kinds of items; the blank templates have zero items, are detected, and an inserted component is written in their language;
      picker groups; conversion matrix and cross-conversion tests still green with the new examples.
- [x] E4 Docs: README (Ejemplo combo paragraph, config.js row), CONTRIBUTING if it lists examples.

## Acceptance
- Picking each blank template: empty preview with the right label size, palette of that language, dragging a Texto / Código / QR writes a
  command of that language. Picking each basic example: same label look in the three languages (within the language differences).
- `node --test` green; Chrome probe: all examples selectable without JS errors.

## Progress
- Branch created. Route: E1-E4 delegated to one writer (3+ non-trivial files: config, ui, tests, docs).
- E1 3cb055c: six examples in js/config.js (group field; conversion-matrix rules and tpcl round trip adjusted for them).
- E2 125caff: createExamplePicker builds optgroups (En blanco, Básicos, Ejemplos completos). app.js needed no change: loadExample passes the language, so the palette follows it (verified in Chrome).
- E3 bef1295: tests/example-templates.test.js (12 tests) + picker tests. Chrome probe: all 10 examples selectable, no JS errors; blank templates insert Texto / Código de barras / QR in their language. Screenshots: C:/Users/danielvl/AppData/Local/Temp/ui/tpl-<id>.png.
- E4 (docs commit): README Ejemplo combo and config.js row, CONTRIBUTING Examples bullet. node --test: 3523 pass, 0 fail.
