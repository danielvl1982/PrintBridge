# Vertical slice refactor

## Objective
Split the code by component (vertical slice): one folder per label component holding its encoder/model constants, parse, draw, build, move, update/describe and validation. Pure refactor: zero behavior change, all 201 tests stay green.

## Why
Before adding ZPL/TSPL (multi-printer-language-support T3+), each component must own its behavior so a new language adds one file per component instead of editing giant dispatch tables in `tpcl.js`, `drawing.js` and `core.js`.

## Scope
- Slices: `text`, `barcode` (code128/code39/itf), `qr`, `line`, `box` (own slice; shares the `line` kind with `rect`), `image` (codec, overlay, render, tpcl).
- `js/core.js` (diagnostics, units, sources, variables, languages registry, validator, sizes, images) split into `js/core/*`.
- `js/languages/tpcl.js` reduced to parse context, `insertCommand`, size commands and composition of the slices' hooks.
- Out of scope: new features, ZPL/TSPL, changing UI, bundler/ES modules (keep classic scripts + IIFE + `PB` namespace).

## Constraints
- Classic scripts, one IIFE per file, load order in `index.html` and in tests via a single shared manifest (no per-test file lists).
- Component registry `PB.components.register({kind, ...})`; slices register before `tpcl.js` and `drawing.js` load.
- Small steps, `node --test` (Node 22+, from repo root) green after every task. Code/comments English; no behavior or UI-string change.
- ~400 changed lines per task is a planning heuristic only.

## Tasks
- [x] T1 Foundation: `PB.components` registry + shared file manifest for `index.html` and `tests/helpers/load.js` (tests use it). No code moved yet.
- [ ] T2 `line` + `box` slices (render, parse LC, build, move, edit, validate).
- [ ] T3 `text` slice (PC/PV).
- [ ] T4 `barcode` slice (encoders from `barcodes.js`, render, parse, build, move, edit).
- [ ] T5 `qr` slice (matrix, render, parse, build, move, edit).
- [ ] T6 `image` slice (codec from `PB.images`, overlay, SG parse, render).
- [ ] T7 Split `core.js` into `js/core/*`; `tpcl.js`/`drawing.js` become composition only; validator and `PB.layout.analyze` per component.
- [ ] T8 Docs (README/CONTRIBUTING layout), final regression, browser smoke test (focus, drag, overlay, layout).

## Acceptance
- `node --test` passes with the same 201 tests (plus registry tests); app behaves identically in the browser; each component's behavior is found in its own folder.

## Routing
- Sequential delegated writers, one per task (each touches 2+ non-trivial files). Explorer map done (see Engram `odd/vertical-slice-refactor/tasks`).

## Delivery
- Branch `refactor/vertical-slice`; work-unit commit per task (Conventional Commits). Strategy `ask-on-risk`. Push/PR/merge are the user's call.

## Progress
- Baseline: 201/201 tests pass on `main` (a12e6e4).
- T1 done: RED observed (registry file missing), then GREEN; `node --test`: 206/206 pass (201 + 5 new). Added `js/components/registry.js`, `js/manifest.json`, `loadUpTo`/`loadApp`/`manifest` helpers; all tests migrated to `loadUpTo`; manifest-sync test covers index.html. Not yet committed.
- Next: T2.
