# Features

Each feature document describes its purpose, entry points, inputs, steps, outputs, rules, errors, change locations, tests, and gaps. IDs are stable and never reused. This internal project has no associated tickets.

| ID | Feature | Ticket | Document |
|---|---|---|---|
| F1 | Edit and preview printer labels in the browser | None (internal development) | [edit-and-preview-label.md](edit-and-preview-label.md) |
| F2 | Convert labels between TPCL, TSPL, and ZPL | None (internal development) | [convert-label-language.md](convert-label-language.md) |
| F3 | Print label-language bytes through the local printer agent | None (internal development) | [print-raw-label.md](print-raw-label.md) |
| F4 | Print the label drawing through the printer driver | None (internal development) | [print-label-image.md](print-label-image.md) |
| F5 | List and select an installed printer | None (internal development) | [select-printer.md](select-printer.md) |
| F6 | Run the interactive .NET sample printing client | None (internal development) | [dotnet-sample-print-client.md](dotnet-sample-print-client.md) |

## Entry points -> features

| Entry point | Kind | Code | Feature |
|---|---|---|---|
| Open the browser app | Browser | index.html:1 | F1 |
| Edit or paste label code | Browser | js/ui.js:293 | F1 |
| Drop a label file on the editor | Browser | js/ui.js:302 | F1 |
| Open a label file | Browser | js/ui.js:310 | F1 |
| Load an example label | Browser | js/ui.js:54 | F1 |
| Edit format and label dimensions | Browser | js/ui.js:207 | F1 |
| Insert a palette component by click or drag | Browser | js/palette.js:42 | F1 |
| Select or move a preview item | Browser | js/ui.js:391 | F1 |
| Edit item properties or GS1-128 elements | Browser | js/properties.js:108 | F1 |
| Enter test values for label variables | Browser | js/ui.js:88 | F1 |
| Load, adjust, remove, or insert an image | Browser | js/components/image/panel.js:23 | F1 |
| Change preview resolution, calibration, rotation, grid, or anchors | Browser | js/app.js:592 | F1 |
| Inspect command help at the editor caret or selection | Browser | js/ui.js:298 | F1 |
| Convert label to a selected printer language | Browser | js/convert-panel.js:123 | F2 |
| Copy converted label | Browser | js/convert-panel.js:124 | F2 |
| Download converted label | Browser | js/convert-panel.js:125 | F2 |
| Print in Etiquetera (cÃ³digo) mode | Browser | js/print-panel.js:419 | F3 |
| POST /print?printer=&copies= | HTTP | agent/printbridge-agent.js:495 | F3 |
| Print in Driver (imagen) mode | Browser | js/print-panel.js:419 | F4 |
| POST /print-image?printer=&widthMm=&heightMm=&dpi=&offsetXmm=&offsetYmm=&copies=&paper= | HTTP | agent/printbridge-agent.js:500 | F4 |
| Load or retry the printer list in the print panel | Browser | js/print-panel.js:264 | F5 |
| Choose a printer | Browser | js/print-panel.js:413 | F5 |
| GET /printers | HTTP | agent/printbridge-agent.js:486 | F5 |
| dotnet run [-- <agent-url>] in the sample client | CLI | dotnet/PrintBridge.Sample/Program.cs:4 | F6 |
| GET /health | HTTP | agent/printbridge-agent.js:481 | - |

## Features -> outputs

| Feature | Output/store | Operation |
|---|---|---|
| F1 | In-memory label editor and model | W label text and current model; no project persistence (js/app.js:574, 580) |
| F1 | Browser SVG preview and Avisos panel | W rendered drawing and validation/layout messages (js/app.js:136, js/drawing.js:38, 112; js/ui.js:13, 496) |
| F2 | Conversion output and fidelity diagnostics | W converted label text and target-language diagnostics (js/convert-panel.js:58; js/core/convert.js:43) |
| F2 | System clipboard | W copied converted label (js/convert-panel.js:101) |
| F2 | Downloaded label file | W target-language extension and encoding (js/convert-panel.js:111; js/core/convert.js:69, 85) |
| F3 | Windows printer spooler via RAW | W label-language bytes repeated for copies (agent/printbridge-agent.js:147, 377, 508, 536) |
| F3 | Agent HTTP response and browser print status | W { ok, bytes, copies } or a structured print error (agent/printbridge-agent.js:508, 542; js/print-panel.js:338) |
| F4 | Windows printer spooler through the installed driver | W rendered PNG page with size, resolution, offsets, paper, and copies (agent/printbridge-agent.js:207, 311, 388, 546, 573) |
| F4 | Agent HTTP response and browser print status | W { ok, bytes, copies } or structured validation/spooler errors (agent/printbridge-agent.js:546, 579; js/print-panel.js:379) |
| F4 | PNG rendered from the browser label drawing | W image request body (js/render-export.js:172; js/print-panel.js:379) |
| F5 | Installed Windows printer list and statuses | R printer list from spooler; W JSON { printers[] } (agent/printbridge-agent.js:140, 374, 489) |
| F5 | Browser printer selection | W selected printer and remembered printer preference (js/print-panel.js:413) |
| F6 | Local printer agent HTTP API | R GET /printers; W POST /print or POST /print-image depending on interactive mode (dotnet/PrintBridge.Sample/Program.cs:9, 13-29; dotnet/PrintBridge.Sample/PrintBridgeClient.cs:21, 29, 35-36) |
| F6 | Console and process exit | W success, agent error, or connection guidance; return codes 0, 1, 2, or 3 (dotnet/PrintBridge.Sample/Program.cs:10, 24, 31-43) |
| - | Agent diagnostic HTTP response | W { ok, version, platform } (agent/printbridge-agent.js:483) |

See [data](../datos.md) for store semantics and [operations](../operaciones.md) for runtime and printer requirements.

## Feature relationships

F3 and F4 use [F5 printer selection](select-printer.md). F6 is a local-only sample that consumes F3, F4, and F5 through the agent API; its source is git-ignored.

The diagnostic GET /health endpoint uses ID -, not a business feature.
