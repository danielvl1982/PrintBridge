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
- [ ] P1 Agent: `POST /print-image` (PNG body, query: printer, widthMm, heightMm, dpi, offsetXmm, offsetYmm, copies), validation, PowerShell PrintDocument, tests
- [ ] P2 Browser: export the viewer SVG to a PNG at a dpi with the exact mm size (pure helpers tested), fonts / images embedded
- [ ] P3 UI: print panel second mode "Driver (imagen)" (dpi, offsets, preview of the page size), messages, agent client call
- [ ] P4 Close: README + print-agent doc, Chrome probe with a fake agent, full `node --test`, this document finished, Engram mirror

## Findings

## Open

## Progress
