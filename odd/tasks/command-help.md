# Command help in Propiedades (cursor in the code -> command and parameters)
Objective: like labelary.com/viewer.html, when the caret is inside a command of the code editor, show its name, a short description and its parameters (the current one highlighted, with its value) as a sub-section of the Propiedades panel.
Branch: `feat/command-help`. Delivery: ask-on-risk (one PR per language step). Test runner: `node --test`. Language order: ZPL first (C1), then TPCL (C2), then TSPL (C3); the user tests each step before the next.

## Specs
- S1: "podemos poner dicha informacion sección de propiedades, como una sub sección del panel" (user, 2026-10-14). The info is the one Labelary shows when the cursor is in a field: the parameters of the object.
- S2: "Lo vamos a realizar para todos, pero empecemos la pr para ZPL, probamos y seguimos" (user). ZPL first as its own PR; TPCL and TSPL follow with the same mechanism.
- S3 (assumption): the sub-section shows independently of the selected object (it follows the caret, not the preview selection), is hidden for a language without help yet and when the caret is not inside a command.
- S4 (assumption): UI texts in Spanish (the UI stays Spanish until the i18n, see memory), code and docs in English.
- S5 (assumption): descriptions are short summaries written from the ZPL II guides (Volume One 2003 / Two 2005, local PDFs, not committed); a command without an entry shows its name and "no help yet".

## Tasks
- [x] C1 (S1-S5) ZPL: `js/languages/zpl-help.js` (data + `at(text, offset)`), caret listener in `createEditor`, `showCommandHelp` in the panel, `#propsHelp` in index.html, css, tests/zpl-help.test.js (15 tests), README. Route: inline. Tests: 4669 (4667 pass, 0 fail, 2 skipped). Browser check by the user: pending. Commit: see git log.
- [x] C2 (S2) TPCL: `js/languages/tpcl-help.js` (`PB.tpclHelp.at/range/TABLE`, a layout function per command because TPCL parameters are not a fixed list), `helpAt` / `helpRange` in the language registry (zpl and tpcl), `updateCommandHelp` language-agnostic, tests/tpcl-help.test.js (14 tests), README. Route: inline. Tests: 4686 (4684 pass, 0 fail, 2 skipped). Browser check by the user: pending. Commit: see git log.
- [ ] C3 TSPL help data.

## Log
- L1 (2026-10-14, user): "https://labelary.com/viewer.html cuando nos ponemos en un campo nos da información de los parámetros del objeto, podemos poner dicha informacion sección de propiedades, como una sub sección del panel"
- L2 (2026-10-14, user): "Lo vamos a realizar para todos, pero empecemos la pr para ZPL, probamos y seguimos"
- Exploration (2026-10-14): editor is a plain textarea `#src` wrapped by `createEditor` (js/ui.js), no caret listener exists; `PB.zpl.commands(src)` yields commands with absolute offsets; no central ZPL parameter registry (only barcode `COMMANDS`), so a new data module is needed; new scripts go in index.html and js/manifest.json.
- L3 (2026-10-14, user, after testing C1 on main): "Hay que poner la información en un panel a la izquierda, por encima del codigo de etiqueta, una vez lo tengamos commit y push a main". Done: the help moved out of Propiedades into its own collapsible panel `#cmdHelp` (data-collapsible="help", hidden until there is help) at the top of the left column; S1 now reads as a panel above the code, not a sub-section of Propiedades.
- L4 (2026-10-14, user, testing on main): selecting an object in the preview only showed its position (the caret lands on the first command, ^FO); moving the caret in the code did refresh the panel. Fix: a selected span (an object, or text selected by hand) lists every command in it (`PB.zplHelp.range`, ^FS left out), a collapsed caret still shows the single command under it.
- L5 (2026-10-14, user): "Funciona, vamos con el siguiente". C1 confirmed in the browser, C2 (TPCL) started. Descriptions are my summaries of the layouts the parser quotes from the TEC guides (PDFs not searchable here); `XQ` has no description beyond "control command" because the code does not say what it does.
