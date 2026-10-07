# Contributing to PrintBridge

PrintBridge is a static HTML + vanilla JavaScript app (no build step, no dependencies to install). Live app:
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

- `README.md`: what the app does and what each file contains.
- `odd/tasks/multi-printer-language-support.md`: the development plan, the task list and what is done, with the evidence for
  each step. Check it before starting something new, and update it when you finish a task.
- `js/core/`: the neutral label model (documented in `js/core/model.js`) and the language registry. A printer language (TPCL, and soon ZPL and TSPL) lives in
  `js/languages/` and registers itself with the registry. The drawing code only knows the neutral model.
- `js/components/`: vertical slices, one folder per label component. Each slice owns its constants, drawing, validation and, per language,
  its parse, build, move and edit pieces (`<name>/tpcl.js`), and registers in `PB.components` from `<name>/index.js`. See the contract at the top of
  `js/components/registry.js`. To add a component, create its folder, then list its files in `js/manifest.json` and `index.html` (same order).

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
