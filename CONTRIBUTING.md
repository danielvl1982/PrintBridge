# Contributing to PrintBridge

PrintBridge is a static HTML + vanilla JavaScript app (no build step, no dependencies to install) that draws labels written in three printer languages: TPCL (Toshiba TEC), TSPL (TSC TTP) and ZPL (Zebra). Live app:
<https://danielvl1982.github.io/PrintBridge/>.

## Get started

```bash
git clone https://github.com/danielvl1982/PrintBridge.git
cd PrintBridge
node --test        # Node 22 or newer; run it from the project root
```

Open `index.html` in a browser to try the app. There is nothing to install.

> Run plain `node --test`. On Node 22, `node --test tests/` fails because it treats the folder as a module.

## Where to look

- `README.md`: what the app does, what each file contains and, per language, what is drawn, edited and written.
- `odd/tasks/`: one plan per feature with its task list and the evidence for each step (`multi-printer-language-support.md` is the foundation, `zpl-support.md` the ZPL language and the three-way conversion). Check the one that applies before starting something new, and update it when you finish a task.
- `agent/`: the Windows print agent (`printbridge-agent.js`, Node, **no dependencies**, CommonJS) that the Impresión panel (`js/print-panel.js`) talks to. Its HTTP logic takes the spooler as an injected `{ listPrinters, printRaw }` object, so `tests/print-agent*.test.js` run it on any OS against a fake spooler on an ephemeral port; only the PowerShell/winspool code and the `install.ps1` (download, start, autostart and uninstall in one script) / `start.bat` scripts need Windows and a real printer. See `agent/README.md`.
- `js/core/`: the neutral label model (documented in `js/core/model.js`) and the language registry. A printer language (TPCL, TSPL and ZPL) lives in
  `js/languages/` and registers itself with the registry. The drawing code only knows the neutral model.
- `js/components/`: vertical slices, one folder per label component (`text`, `barcode`, `qr`, `datamatrix`, `line`, `box`, `ellipse`, `area`, `image`). Each slice owns its constants, drawing and validation and, per language,
  its parse, build, move, edit and emit pieces (`<name>/tpcl.js`, `<name>/tspl.js`, `<name>/zpl.js`), and registers in `PB.components` from `<name>/index.js`. See the contract at the top of
  `js/components/registry.js`. To add a component, create its folder, then list its files in `js/manifest.json` and `index.html`.
- **Script order.** `js/manifest.json` and the `<script>` tags of `index.html` list every script in the same order (the tests load from the manifest, the browser from the page): a slice's files before its `index.js`, the slice files before the language files that compose them
  (`js/languages/tspl-edit.js`, `tspl.js`, `zpl-edit.js`, `zpl.js`) and the languages before `js/ui.js`. `tests/components-registry.test.js` pins that the two lists are equal.
- **Adding a language to a component:** write `js/components/<name>/<lang>.js`, a factory called with the language's helpers that returns `{ handlers, ... }` (see `text/tspl.js`, `text/zpl.js` and `js/components/compose.js`), and
  register it in the component's `index.js` as `languages: { tpcl, tspl, zpl }`. A component a language does not have simply omits the key (the ellipse has no useful TPCL piece: its `tpcl` factory only reports the skipped item).
  A slice gets its palette entry by returning `build(text, point, options)` from its factory.
- **Registering a language** (`js/languages/<lang>.js`): `PB.languages.register({ id, name, detect, parse, ... })`; the file builds its handler table with `PB.composeSlices('<lang>', helpers, { handlers })`, which collects the slices registered for it.
  The required hooks are `detect` and `parse`. The optional ones switch app features on, and the app disables moving, the properties panel, the palette, the image entry and size writing for a language that lacks them (TPCL, TSPL and ZPL have them all):
  `emit` (the language becomes a conversion target, see below), `sizeCommands` / `applySize` (the Formato row), `insertCommand`, `moveItem`, `describeItem` / `updateItem` (Propiedades), `componentTemplates` / `buildComponent` (palette) and `insertImage: true` with `imageCommand`
  (the **Imagen** entry; TPCL, TSPL and ZPL set it, see `js/core/languages.js`). The newest and most complete reference is ZPL: `js/languages/zpl.js` (tokenizer, field grouping, setup commands, emit skeleton, registration) and `js/languages/zpl-edit.js` (the generic move / describe / update engines driven by field descriptors).
  TSPL's slices use the shared helpers `dropDots`, `itemRotation`, `freePlaceholder` and `insertCommand` of `js/languages/tspl.js`; ZPL's use `PB.zpl.SLICE_HELPERS`.
- **ZPL deferred dispatch:** in ZPL a drawing is a field (`^FO` / `^FT` ... `^FS`) whose command and data can come in either order, so nothing becomes an item when it is read: the driver accumulates the commands of the open field and calls the slice handler registered for its main command when the field closes.
  Setup commands (`^PW`, `^LL`, `^CF`, `^BY`...) run immediately, and the field modifiers (`^FD`, `^FR`, `^FN`, `^SN`...) are stored in the field instead of dispatched (see the header of `js/languages/zpl.js`).
- Label sizes: `config.sizes` is a language-agnostic catalog of standard sizes (`{ id, name, w, h, p }` in mm, pitch = height + 3), with no
  printer data. The drawing always follows the size the label declares (`PB.sizes.view`); the Formato row shows it and writes edits back through the
  language's `applySize`, which must only write what declares the size (TPCL: `{D…|}`, never `{AX…|}`; TSPL: `SIZE` / `GAP`; ZPL: `^PW` / `^LL`).
  Pitch and gap are one value (pitch = height + gap): the TPCL and TSPL parsers derive each from the other when reading (`size.pitch` and `size.gap`), the
  emitters write their language's form from either, and the pitch field of the Formato row follows the language (`createSizePanel().setLanguage`: TPCL pitch,
  TSPL gap, hidden for ZPL).
- Emitters (neutral model to printer text, used by "Convertir a…"): a language becomes a conversion target by adding the optional hook
  `emit(model, { dpi }) -> { text, diagnostics }` (contract in `js/core/languages.js`). It owns the header, trailer, id numbering and order of
  the output; each item is written by its slice, which returns `emit` next to `handlers` from its `languages.<id>` factory:
  `emit(item, ctx)` returns the line(s) for that item and reports fidelity losses with `ctx.report(PB.diagnostics.warning(...))` (see
  `text/tspl.js`, `text/zpl.js` and `js/core/emit.js` for the shared helpers). `PB.composeSlices` collects them in `emitters`. Optional `fileEncoding`
  (`'latin1'` for binary-safe files, as TSPL) and `fileExtension` tell `PB.convert` how to save the output. `js/convert-panel.js` lists the targets
  from the registry, so no UI change is needed for a new language.

## Tests

`node --test` also runs the print agent tests (`tests/print-agent.test.js` for the protocol, limits, origins and preflight; `tests/print-agent-config.test.js` for `config.json` and the embedded PowerShell) and the panel tests (`tests/print-panel.test.js`, on a fake DOM and a fake `fetch`). The agent needs no `npm install`; to try it by hand run `node agent/printbridge-agent.js --config <file>` with a spare port and use `curl` (do not post a job to a real printer by accident).

`node --test` runs everything under `tests/` (about 80 files, a few seconds). A file is named after what it covers: `tests/<area>.test.js` (`zpl-text.test.js`, `tspl-emit-barcode-qr-image.test.js`...). The tests load the browser scripts in Node through `tests/helpers/load.js`,
so parsers, encoders, emitters, editors and the SVG renderer are all testable without a browser. Write the test first and see it fail.

- **Round trip of an emitter:** `parse(emit(parse(x)))` must equal `parse(x)` on the neutral items (ignore `source`, `raw` and `native`; allow at most 1 dot of rounding across languages), at 203 and 300 dpi, on every example of that language; see
  `tests/tspl-emit-barcode-qr-image.test.js` and `tests/cross-conversion.test.js`. Whatever cannot be written must produce a diagnostic, never silent loss.
- **Conversion matrix:** `tests/conversion-matrix.test.js` converts every component, one feature per case, in the six directions between TPCL, TSPL and ZPL at both resolutions, reads the output back and compares it item by item with a table of expected results
  (exact, degraded with its diagnostic, or skipped with its diagnostic). **Every new component or feature must add its rows there** (a case, and a rule when it is not exact in some direction), and a change to what a conversion loses must also update the loss table of the README (*Convertir a…*).
- **Examples:** a new example goes in `js/config.js` (`PB.examples`) with a `group` (`blank` or `template`, the section of the Ejemplo combo; the picker lists `blank` first). The app starts with the first `template`. Only blank templates and templates ship: complete sample labels used as test data live in `tests/helpers/legacy-examples.js`, which `tests/helpers/load.js` appends to `PB.examples` for the tests only. `tests/example-templates.test.js` checks every example (detected language, no warnings), and the conversion matrix runs each one through `RULES`: add a rule there if converting it loses something.
- Tests that pin documentation text (for example that the README names the ZPL barcode commands) fail if a section is renamed: keep the headings and the key terms they look for.

## Line endings

The repository stores LF and `core.autocrlf=true` checks files out as CRLF on Windows, so most working-tree files are CRLF. Files that are legitimately LF in the working tree (they are never converted) include `js/lib/qrcode-generator.min.js`, `.gitignore` and
`odd/tasks/multi-printer-language-support.md`. Editors and tools may rewrite a file as LF: before committing, `git ls-files --eol` shows the index and working-tree endings, and a file that shows as modified with an empty diff only needs its endings restored (`git checkout -- <file>`).

## Printer manuals

`docs/` holds the vendor manuals the code follows, but they are copyrighted: they are **git-ignored** (every `*.pdf` under `docs/`) and never committed. Only `docs/README.md`, which says which manual goes in which folder (`tpcl/`, `tspl/`, `zpl/`), is versioned. Keep your copies local and cite them in code comments.

## Workflow

1. Create a branch from `main` (`feat/…`, `fix/…`, `docs/…`, `refactor/…`).
2. Write the tests first when the behavior can be tested without a browser. The tests load the browser modules in Node, so the
   parser, the encoders and the SVG renderer can all be tested.
3. Make sure `node --test` passes.
4. Open a pull request against `main`. Keep it focused; small pull requests are reviewed faster.

`main` is published as the live app, so avoid pushing broken code to it.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`), with the tests and docs of a change in the same commit.
- **Language:** code, comments, tests and technical docs in English. Text shown on screen (labels, buttons, messages) stays in
  Spanish for now.
- **Style:** match the surrounding code. Modules are IIFEs that attach to the global `PrintBridge` namespace.
- **No invented printer behavior.** If a printer rule is not confirmed by a manual or a real printout, show a warning in the
  viewer and say so in a comment instead of guessing.

## Data and privacy

The repository is public. **Never commit real customer, product, part, lot or production data**, not even in examples, tests
or screenshots. Use obviously fictional values (for example `SAMPLE-001`). Also avoid committing local paths, tokens or
personal email addresses; use your GitHub `noreply` address for commits if you prefer to keep your email private.
