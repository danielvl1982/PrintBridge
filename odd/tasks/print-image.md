# Print the drawing through the printer driver (PrintDocument)

Status: IN PROGRESS (started 2026-10-10 on branch `feat/print-image`). Requested by the user: besides sending the label language RAW to a thermal
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
- [ ] P3 UI: print panel second mode "Driver (imagen)" (dpi, offsets, preview of the page size), messages, agent client call
- [ ] P4 Close: README + print-agent doc, Chrome probe with a fake agent, full `node --test`, this document finished, Engram mirror

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

## Open
- P3 must decide where the SVG comes from (the live preview element is enough) and show the pixel size / limit errors in the panel.
- The PNG is not checked against the agent's `maxImageBytes` (20 MB default) in the browser; a very large page is rejected by the agent with 413 `too_large`.
- The `mix-blend-mode: difference` of ZPL / TSPL "reverse" areas is not covered by the probe (the shipped templates have none); it should render as in the viewer because the white background is part of the SVG.- Only a real printer can verify: the position of the origin (printable area or physical page corner) and the offsets to compensate it, `paper=label` accepted by
  the driver of a label printer, copies, and that nothing is scaled by the driver ("fit to page" options).
- The PowerShell `PrintPage` handler captures exceptions into a variable and cancels the job; unverified on a machine with a printer.

## Progress
- P1 done: `POST /print-image` in the agent, 19 new tests in tests/print-image.test.js (full suite 4288 tests, 4286 pass, 0 fail, 2 skipped, no printer or PowerShell print involved).
- P2 done: 13 tests in tests/render-export.test.js (pure parts); full suite 4301 tests, 4299 pass, 0 fail, 2 skipped. The unit tests were written after the module draft (no RED run recorded: toPng needs a browser).
  Chrome probe (headless, 300 dpi, shipped templates of TPCL, TSPL and ZPL): PASS PNG signature, PASS pixel size equals the maths (1181x709 for 100x60 mm; 1182x710 for the 100.1x60.1 mm ZPL one),
  PASS not blank (about 100k ink pixels), PASS no border on the edge row, PASS grid and hit nodes stripped (26-28 chrome nodes in the viewer), PASS identical PNG bytes with the viewer rotated 0 / 90 / 270,
  PASS an embedded data URL picture lands upright at its place. Looked at the PNG: text, barcode with human readable line, QR and boxes as in the viewer, no grid or selection. Only console error: a refused
  connection (the print panel looking for the agent on 127.0.0.1:9631).
