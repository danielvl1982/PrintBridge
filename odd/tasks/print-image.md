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
- [ ] P2 Browser: export the viewer SVG to a PNG at a dpi with the exact mm size (pure helpers tested), fonts / images embedded
- [ ] P3 UI: print panel second mode "Driver (imagen)" (dpi, offsets, preview of the page size), messages, agent client call
- [ ] P4 Close: README + print-agent doc, Chrome probe with a fake agent, full `node --test`, this document finished, Engram mirror

## Findings
- P1: the spooler interface gained an optional `printImage(printerName, png, options)`; the HTTP flow is tested with a fake, the real one runs `IMAGE_SCRIPT`
  (PowerShell + `PrintDocument`) with the values in environment variables (`PB_*`) and the PNG in a temp file. Image limit: new config key `maxImageBytes`
  (default 20 MB), independent of `maxBytes`. New code: `not_png` 415; PrintDocument / PowerShell failures reuse `spooler_error` 502 with `detail`.
- Interpolation: NearestNeighbor when the PNG dpi is at least the printer's dpi (the browser renders at the printer resolution, so pixels map 1:1 and barcode bars
  stay sharp), HighQualityBicubic only when the PNG has fewer dots than the printer (a non integer upscale with nearest neighbour gives uneven bars).
  `PixelOffsetMode.Half` avoids a half pixel shift. The image is drawn into the rectangle widthMm x heightMm, so the PNG metadata dpi is irrelevant.

## Open
- Only a real printer can verify: the position of the origin (printable area or physical page corner) and the offsets to compensate it, `paper=label` accepted by
  the driver of a label printer, copies, and that nothing is scaled by the driver ("fit to page" options).
- The PowerShell `PrintPage` handler captures exceptions into a variable and cancels the job; unverified on a machine with a printer.

## Progress
- P1 done: `POST /print-image` in the agent, 19 new tests in tests/print-image.test.js (full suite 4288 tests, 4286 pass, 0 fail, 2 skipped, no printer or PowerShell print involved).
