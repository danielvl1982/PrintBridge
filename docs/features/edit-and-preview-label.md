# F1 - Edit and preview printer labels in the browser

Ticket: sin ticket (internal development)

## Purpose

The browser editor lets a user load or edit printer-language label text, inspect its rendered SVG preview and diagnostics, and adjust supported label and item properties. The current label model, editor text, and preview are held in the running browser app; this feature does not persist a project (`js/app.js:573-578`, `js/app.js:159-188`).

## Trigger / Entry point

- Open the browser app (`index.html:1`).
- Type or paste label code in the editor; typing refreshes after a short delay and paste opens the pasted text as a new label (`js/ui.js:293-295`).
- Drop a label file onto the editor or open one through its button (`js/ui.js:302-315`). Files are decoded from bytes, with TSPL bitmap payload handling (`js/ui.js:225-233`, `js/ui.js:264-270`).
- Choose an example; the picker reports the selected example and the app loads its source (`js/ui.js:54-58`, `js/app.js:580-585`).
- Edit the declared label format or dimensions (`js/ui.js:207-215`).
- Insert a component from the palette by click, Enter, or drag (`js/palette.js:28-50`, `js/ui.js:417-425`).
- Select a preview item to expose its properties (`js/ui.js:391-403`, `js/app.js:202-219`).
- Edit item properties or GS1-128 elements in the properties panel (`js/properties.js:93-116`, `js/properties.js:120-135`).
- Load or adjust the image overlay from its controls (`js/components/image/panel.js:14-33`).
- Change preview options such as resolution, calibration, rotation, grid, and anchors (`js/app.js:595-597`; the app refresh reads its current options at `js/app.js:159-174`).
- Inspect command help at the editor caret or selection (`js/ui.js:297-298`).

## Inputs (payload/config)

- Label text entered, pasted, or read from a file; the app detects the printer language when one is not supplied (`js/ui.js:288-315`, `js/app.js:136-150`).
- Example source and its language (`js/app.js:580-585`).
- User-entered test values for label variables; each input updates the shared values and requests a refresh (`js/ui.js:72-89`, `js/app.js:159-174`).
- Label size and format selections; accepted edits are passed to the app as a resolved size (`js/ui.js:189-215`).
- Palette component selection/drop coordinates and current DPI (`js/palette.js:28-50`, `js/app.js:333-360`).
- Selected item property values; invalid values are not forwarded as changes (`js/properties.js:13-25`, `js/properties.js:108-116`).
- Image file and placement, threshold, rotation, and insert/remove actions (`js/components/image/panel.js:14-33`, `js/components/image/panel.js:35-59`).
- Preview settings and test values are read from the current app state when refreshing (`js/app.js:120-128`, `js/app.js:159-174`).

## Steps

1. The user opens or edits label text, loads a file/example, or changes an editor control; file opening and dropping pass decoded text to the app (`js/ui.js:288-315`, `js/app.js:574-585`).
2. The app detects the language, parses the label, builds the model, validates it, and prepares diagnostics; an unrecognized non-empty label yields a diagnostic (`js/app.js:136-150`).
3. The app renders the model as SVG, refreshes variable and format controls, paints the preview, updates properties/help, and displays diagnostics and layout findings (`js/app.js:159-188`, `js/drawing.js:38-60`).
4. The user can select and move preview items, change supported properties or size, insert palette components, and provide test values; handlers update the editor/model and refresh the preview (`js/ui.js:391-403`, `js/app.js:333-360`, `js/app.js:363-370`, `js/ui.js:72-89`).
5. Image controls can maintain an image as a preview overlay or insert its image command into label text when the language supports it (`js/components/image/panel.js:23-33`, `js/app.js:548-570`).

## Exit points

| Output | Detail |
|---|---|
| In-memory label editor and model | The app replaces editor text and refreshes the current model; no project persistence is performed by this flow (`js/app.js:573-578`, `js/app.js:159-174`). |
| Browser SVG preview | The drawing renderer creates SVG markup from model items; the preview installs the markup and updates displayed dimensions/selection (`js/drawing.js:38-60`, `js/ui.js:493-501`). |
| Avisos panel | The app combines notices, parser/validator diagnostics, layout findings, and renderer diagnostics for display (`js/app.js:176-184`). |

## Business rules

- Typing triggers an edit refresh after a 150 ms delay; paste is handled as opening a new label (`js/ui.js:285-295`).
- If the label language is not recognized, the app reports it and does not parse it as a supported language (`js/app.js:136-150`).
- Only the selected item's editable fields are shown; a selection that no longer maps to a model item is cleared (`js/app.js:202-219`).
- Palette image insertion is offered only when the active language provides both image-writing hooks (`js/palette.js:17-25`).
- Image rotation accepts quarter turns; any other value reads as zero degrees (`js/components/image/panel.js:17`, `js/components/image/panel.js:43-47`).

## Errors and edge cases

- Empty or unrecognized label text has no detected language; non-empty unrecognized text produces a diagnostic (`js/app.js:136-150`).
- A processing exception is caught and shown in Avisos; the current refresh does not replace the preview in that catch path (`js/app.js:159-188`).
- A file drop without a file is ignored (`js/ui.js:302-307`).
- The Node drawing test explicitly excludes DOM-dependent layout analysis, so this suite does not establish browser layout behavior (`tests/drawing.test.js:5-6`).

## Where to act

| If changing... | Start at |
|---|---|
| Input validation / label parsing | `js/app.js` → `analyze` (`js/app.js:136-150`) and the active language parser/validator. |
| Selection / item lookup | `js/ui.js` → preview click handler (`js/ui.js:391-403`); app selection-to-properties mapping is `updateProperties` (`js/app.js:202-219`). |
| Business rules / refresh behavior | `js/app.js` → `refresh` (`js/app.js:159-188`); size edits flow through `applySize` (`js/app.js:363-370`). |
| Output / persistence | `js/drawing.js` → `render` (`js/drawing.js:38-60`) and `js/app.js` → `open` (`js/app.js:573-578`); F1 output remains in browser memory. |
| Scheduling / configuration | No scheduled job is part of this browser-driven feature; preview settings are consumed in `refresh` (`js/app.js:159-174`) and size controls are wired by `createSizePanel` (`js/ui.js:207-215`). |

## Existing tests

- `tests/drawing.test.js`: SVG rendering can run without a DOM (`tests/drawing.test.js:5-6`, `tests/drawing.test.js:17-19`).
- `tests/component-palette.test.js`: component templates and language component construction (`tests/component-palette.test.js:13-20`).
- `tests/properties-panel.test.js`: property value coercion, including invalid numeric values (`tests/properties-panel.test.js:5-16`).
- `tests/editor-file-name.test.js`: editor file-name behavior using a fake element (`tests/editor-file-name.test.js:2-10`).
- `tests/example-picker.test.js`: example picker behavior with a minimal fake DOM (`tests/example-picker.test.js:5-9`).
- `tests/image-ui-slice.test.js`: image UI slice wiring and behavior (`tests/image-ui-slice.test.js:1-5`).

## Coverage / Gaps

- Browser-only layout and pointer interactions are not established by the Node drawing test (`tests/drawing.test.js:5-6`). See question 4 in [the open questions document](../preguntas-abiertas.md#technical).
