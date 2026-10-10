# Print the drawing through the printer driver (PrintDocument)

Status: DONE, PENDING USER TEST ON A REAL PRINTER (started 2026-10-10 on branch `feat/print-image`). Requested by the user: besides sending the label language RAW to a thermal
printer (the print agent, odd/tasks/print-agent.md), print **what the viewer draws** through the Windows driver (laser or any normal printer), like a
C# `PrintDocument` would. Reviews are skipped for this feature (user decision 2026-10-10).

## Design (agreed with the user)
- The browser renders the viewer's SVG of the label to a PNG at the printer resolution (300 / 600 dpi) with the real size in mm.
- The local agent gets a new endpoint (`POST /print-image`) that receives the PNG and prints it with `System.Drawing.Printing.PrintDocument` from
  PowerShell (no C#, no new dependency), at the exact position and 100 % scale (the page is not fitted or stretched).
- The panel offers a second mode "Driver (imagen)" next to the RAW one, with dpi and offset in mm; same printer list, same security as /print.
- It prints the drawing, not the label code: it does not prove that a TEC / TSC / Zebra accepts the code. Laser printers have non printable margins:
  the offset lets the user compensate.
- Vector drawing (Graphics) was discarded: it would reimplement text, barcodes and shapes in PowerShell.

## Rules
- Reuse the agent's existing patterns (origin check, size limit, PowerShell with the data passed outside the command text, config file, error codes
  and Spanish messages). No new dependencies. UI strings in Spanish; code, comments, docs and commits in English; no AI attribution.
- Test first where a deterministic runner exists (`node --test`); the PowerShell printing itself is verified by a Chrome / fake-agent probe and,
  at the end, by the user on a real printer. No job may be sent to a real printer from a test.
- One writer at a time, one commit per task, no push, no review ceremony (skipped by the user).

## Tasks
- [x] P1 Agent: `POST /print-image` (PNG body, query: printer, widthMm, heightMm, dpi, offsetXmm, offsetYmm, copies), validation, PowerShell PrintDocument, tests
- [x] P2 Browser: export the viewer SVG to a PNG at a dpi with the exact mm size (pure helpers tested), fonts / images embedded
- [x] P3 UI: print panel second mode "Driver (imagen)" (dpi, offsets, preview of the page size), messages, agent client call
- [x] P4 Close: README + print-agent doc, PowerShell dry run against Microsoft Print to PDF, full `node --test`, this document finished

## Findings
- P1: the spooler interface gained an optional `printImage(printerName, png, options)`; the HTTP flow is tested with a fake, the real one runs `IMAGE_SCRIPT`
  (PowerShell + `PrintDocument`) with the values in environment variables (`PB_*`) and the PNG in a temp file. Image limit: new config key `maxImageBytes`
  (default 20 MB), independent of `maxBytes`. New code: `not_png` 415; PrintDocument / PowerShell failures reuse `spooler_error` 502 with `detail`.
- Interpolation: NearestNeighbor when the PNG dpi is at least the printer's dpi (the browser renders at the printer resolution, so pixels map 1:1 and barcode bars
  stay sharp), HighQualityBicubic only when the PNG has fewer dots than the printer (a non integer upscale with nearest neighbour gives uneven bars).
  `PixelOffsetMode.Half` avoids a half pixel shift. The image is drawn into the rectangle widthMm x heightMm, so the PNG metadata dpi is irrelevant.
- P2: `js/render-export.js` (`PB.renderExport`, loaded after the print panel; js/manifest.json and index.html list it). `toPng({ svg, widthMm, heightMm, dpi })` takes the viewer's
  <svg> element or its markup and returns a PNG Blob of exactly `pixelSize` pixels on white. Pure and tested under node: `pixelSize` (round(mm / 25.4 * dpi),
  dpi 72..1200, max 16384 px a side and 100 megapixels, Spanish errors naming the limit), `imageQuery` (same ranges as the agent's parseImageQuery, a test reads the
  agent constants), `isEditorChrome` / `CHROME_SELECTOR`, `labelViewBox`, and `LABEL_CSS` (a test keeps it identical to css/label.css).
- P2 stripped: `.hit` (hover / selection areas), `.grid-line`, `.grid-text`, `.origin`, `.overlaps` / `.overlap`, `.drop-target` and every `<title>` (tooltips). The label border
  (stroke of `.label-background`) is a screen aid and is not printed: the page is plain white. The view rotation (`g.view-rotation`) is unwrapped and the viewBox is
  `0 0 width height` (0.1 mm, no pad), so the PNG is always the label as defined, whatever rotation or grid the viewer shows. Callers need no special render: the
  element on screen (or the markup of `svgRenderer.render`) works.
- P2 fonts: the SVG in an `<img>` does not see page CSS, so the font stacks of css/label.css (Times New Roman / Arial / Courier New families, bold, italic, human readable,
  TPCL text attributes, strokes) are inlined in a `<style>`. They are system fonts, no web font is involved: the PNG uses what the browser resolves, as the viewer does.
  Overlay pictures are data URLs already; any other href would be fetched and embedded.
- P2 limits: 16384 px a side, 100 megapixels (about 450 x 450 mm at 600 dpi is refused); the agent accepts up to 1000 mm and 20 MB of PNG (a large 1200 dpi PNG can exceed that).
- P3 UI: the panel gained a `Modo` select (`Etiquetera (código)` = RAW unchanged, `Driver (imagen)`). Driver mode shows Resolución (203 / 300 / 600, default 300), Papel (default / label),
  Desplazamiento X / Y (mm, -100..100, step 0.1, comma or dot accepted), the shared copies control and a line "Página W × H mm, imagen w × h px" (or the pixelSize Spanish error, which disables Imprimir).
  The pure parts live in `PB.ui.printImage` (js/print-panel.js): `request` (panel values -> { path, query, url, headers, pixels } or { ok: false, error }), `pageInfo`, `errorMessage` (one Spanish message per agent code,
  ending with the code like RAW does; spooler_error shows the agent `detail`), `parseOffset`. They call PB.renderExport lazily, so the panel keeps loading before render-export.js.
- P3 wiring: `createPrintPanel` takes `getLabel()` (app.js `printLabel`: the live <svg> in #svgwrap and the size from its `.label-background` in 0.1 mm / 10) and an injectable `renderPng` (default
  PB.renderExport.toPng). app.js calls `printPanel.refreshInfo()` after each refresh so the size line follows the label. The RAW path is the same behaviour (shared `post` / `send` helpers; its tests pass untouched).
- P3 persistence: localStorage like the printer / agent URL (keys `printbridge.printMode`, `imageDpi`, `imagePaper`, `imageOffsetX`, `imageOffsetY`; an invalid stored value falls back to the default). Copies are not persisted (as before).
- P3 CSS: only `.print-info` / `.print-tip` in css/viewer.css; the new rows reuse `.convert-bar` and the `[hidden]` rule.

## Open
- P3 decided: the live preview <svg> is the source; the size line shows the pixel size and the limit errors.
- The size line is computed from the label as drawn; a label whose code declares no size uses the viewer default size (the viewer warns about it).
- The PNG is not checked against the agent's `maxImageBytes` (20 MB default) in the browser; a very large page is rejected by the agent with 413 `too_large`.
- The `mix-blend-mode: difference` of ZPL / TSPL "reverse" areas is not covered by the probe (the shipped templates have none); it should render as in the viewer because the white background is part of the SVG.
- Only a real printer can verify: the position of the origin (printable area or physical page corner) and the offsets to compensate it, `paper=label` accepted by
  the driver of a label printer, copies, and that nothing is scaled by the driver ("fit to page" options).
- The `PrintPage` error path (exception captured, job cancelled) did not run in the dry run; the success path did.
- A real label printer driver: does it take the custom paper (`paper=label`) and keep 100 % scale? The PDF driver ignored the custom size (A4 page).

## Progress
- P1 done: `POST /print-image` in the agent, 19 new tests in tests/print-image.test.js (full suite 4288 tests, 4286 pass, 0 fail, 2 skipped, no printer or PowerShell print involved).
- P2 done: 13 tests in tests/render-export.test.js (pure parts); full suite 4301 tests, 4299 pass, 0 fail, 2 skipped. The unit tests were written after the module draft (no RED run recorded: toPng needs a browser).
  Chrome probe (headless, 300 dpi, shipped templates of TPCL, TSPL and ZPL): PASS PNG signature, PASS pixel size equals the maths (1181x709 for 100x60 mm; 1182x710 for the 100.1x60.1 mm ZPL one),
  PASS not blank (about 100k ink pixels), PASS no border on the edge row, PASS grid and hit nodes stripped (26-28 chrome nodes in the viewer), PASS identical PNG bytes with the viewer rotated 0 / 90 / 270,
  PASS an embedded data URL picture lands upright at its place. Looked at the PNG: text, barcode with human readable line, QR and boxes as in the viewer, no grid or selection. Only console error: a refused
  connection (the print panel looking for the agent on 127.0.0.1:9631).
- P3 done: tests/print-panel-image.test.js (13 tests: pure request / messages / size line, panel on a fake DOM and fake fetch, persistence, wiring); full suite 4314 tests, 4312 pass, 0 fail, 2 skipped. tests/print-panel.test.js only changed its app.js wiring regex.
  Chrome probe (headless Chrome, FAKE agent on a free port with the real agent's CORS headers, nothing sent to a real printer), 25/25 PASS: connected status; default mode Etiquetera and driver options hidden; RAW still POSTs
  the label code to /print as application/octet-stream; driver options shown and printer kept on the mode switch; size line 100 x 60 mm -> 1181 x 709 px at 300 dpi, 2362 x 1417 px at 600 dpi; with 600 dpi, offsets 2 / 3,
  paper label and 2 copies the agent received POST /print-image image/png with query printer, widthMm=100, heightMm=60, dpi=600, offsetXmm=2, offsetYmm=3, copies=2, paper=label and a valid PNG of exactly 2362 x 1417;
  success message in Spanish; each of bad_request / not_png / too_large / printer_not_found / spooler_error (with detail) / origin_refused shows its Spanish message; mode, dpi, paper and offsets survive a reload;
  offset 150 is refused before any request; all controls sit in a label; Imprimir reachable with Tab; no horizontal overflow at 400 px. Looked at the screenshots (desktop and 400 px, both modes): no layout problems
  (the Driver rows wrap at narrow widths). Only console errors: the browser logging the fake agent's 4xx / 5xx answers.
- P4 done: PowerShell dry run of the exact IMAGE_SCRIPT (harness outside the repo, C:/Users/danielvl/AppData/Local/Temp/ui/dryrun-image.js: runs `runPowerShell` of the agent with the script copy plus
  `PrintToFile = $true` and `PrintFileName` after the printer name) against the virtual printer `Microsoft Print to PDF` only (verified with Get-CimInstance Win32_Printer), PNG 1366x1100 drawn into
  100 x 60 mm, dpi 300, offset 2 / 3 mm: paper=label copies=1, paper=default copies=1, paper=label copies=2 all ended "OK" with no PowerShell error, no process left; the PDFs start with %PDF-1.7
  (264943, 264943 and 265438 bytes); pdfinfo: 1, 1 and 2 pages (copies work), page size 595.32 x 841.92 pt (A4) for every run: the virtual driver ignores the custom paper size. Rendering the page at 254 dpi
  (pdftoppm) and looking at it: the drawing starts at about 2 mm / 3 mm and measures about 100 x 60 mm. No bug found in IMAGE_SCRIPT, no change to the agent code.
  Docs: README print section (what the mode is for, caveats), agent/README note, pointer in odd/tasks/print-agent.md.

## Summary
- The app can now print what the viewer draws through the Windows printer driver, besides sending the label code RAW.
- Agent: `POST /print-image` (PNG body, query printer, widthMm, heightMm, dpi, offsets, copies, paper) with validation, `not_png` and 20 MB `maxImageBytes`.
- Printing uses System.Drawing.Printing.PrintDocument from PowerShell, 100 % scale, millimetre units, no new dependency.
- Browser: `PB.renderExport.toPng` renders the viewer SVG (no grid, selection or border) to an exact pixel size at 203 / 300 / 600 dpi.
- UI: the print panel has a Modo select; Driver (imagen) adds dpi, paper, X / Y offsets, a page / pixel size line and Spanish error messages.
- It prints the drawing, not the code: it does not prove that a TEC / TSC / Zebra accepts the label language.
- Tests: full suite 4314 tests, 4312 pass, 0 fail, 2 skipped; Chrome probes with a fake agent, and a PowerShell dry run on Microsoft Print to PDF.
- Not covered by any test: a physical printer (origin, margins, custom paper, driver scaling).
- Nothing was pushed or merged; reviews were skipped by the user's decision.
- Pending: the user's test on a real printer (below).

## Commits
`git log --oneline d6c181e..HEAD` (before the closing commit):
- 2eb3411 feat: add the driver image mode to the print panel
- 55a7a76 feat: export the viewer drawing to a PNG at a given dpi
- f560c3b feat: print an image through the printer driver from the agent
- 4c5b9ce docs: plan printing the drawing through the printer driver
- the closing commit: docs: document the driver image print mode and close the feature

## How to test on your printer
1. Start the agent (`agentstart.bat`, or the installed background one) and check `http://127.0.0.1:9631/health` answers.
2. Open the app, load a shipped 100 x 60 mm example and open the **Impresión** panel: it must say "Agente conectado" and list your printers.
3. Pick the laser printer, set **Modo** to **Driver (imagen)**, **Resolución** 300, **Papel** Predeterminado del driver, offsets 0 / 0, copies 1.
4. Click **Imprimir** and wait for the page.
5. Check on the paper: size 1:1 (measure the 100 mm width and the 60 mm height with a ruler), position (is the top left corner clipped or shifted?) and that the barcode and QR scan.
   To adjust: if the edges are clipped or the drawing sits too far from the corner, add the missing millimetres in **Desplazamiento X** (right) and **Y** (down), negative values move left / up; reprint and repeat until it sits where you want.
   If the size is not 1:1, turn off "fit to page" / scaling in the driver preferences.

## Open items that only a real printer can answer
- Is the origin the printable area or the physical corner, and which offsets compensate it?
- Does a label printer driver accept `paper=label` (custom page) and keep 100 % scale?
- Do the copies come out as one job with the right number of pages?
- Are the barcodes readable at 300 dpi and at 600 dpi?
- The `PrintPage` failure path (cancelled job) was not exercised.
