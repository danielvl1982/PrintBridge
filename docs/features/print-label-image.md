# F4 - Print the label drawing through the printer driver

Ticket: sin ticket (internal development)

## Purpose

The browser sends a raster image of the current label drawing to the local PrintBridge agent, which submits it to an installed Windows printer through its driver. This mode is separate from sending printer-language bytes directly (`js/print-panel.js:348-380`, `agent/printbridge-agent.js:545-579`).

## Trigger / Entry point

- In the browser print panel, choose `Driver (imagen)` and click the print button (`js/print-panel.js:160-183`, `js/print-panel.js:389-419`).
- The agent accepts the image job at `POST /print-image` (`agent/printbridge-agent.js:500-503`).

## Inputs (payload/config)

- Current label drawing as SVG, with its width and height in millimeters (`js/print-panel.js:348-362`).
- Selected installed printer; printer discovery and selection belong to [F5 - Select an installed printer](select-printer.md) (`js/print-panel.js:251-261`, `js/print-panel.js:359-362`).
- Resolution in DPI, paper mode (`default` or `label`), X/Y offsets in millimeters, and copy count (`js/print-panel.js:145-176`, `js/print-panel.js:358-362`).
- The agent's `maxImageBytes` configuration limits the request body (`agent/printbridge-agent.js:53`, `agent/printbridge-agent.js:551-558`).
- The browser remembers mode, resolution, paper, offsets, and the selected printer when storage is available (`js/print-panel.js:138-139`, `js/print-panel.js:190-198`, `js/print-panel.js:413-418`).

## Steps

1. The user selects the Driver image mode, printer, resolution, paper, offsets, and copies; the panel uses the current label dimensions and SVG (`js/print-panel.js:160-183`, `js/print-panel.js:348-362`).
2. The panel checks that a printer and supported paper are selected, computes the pixel dimensions, validates offsets and copies, and builds the `/print-image` query (`js/print-panel.js:89-121`).
3. The browser renders the label SVG to PNG at the chosen DPI, then posts it as `image/png` with the query parameters (`js/print-panel.js:367-380`).
4. The agent validates query values and the request size, reads the body, checks its PNG signature, lists printers, and resolves the requested printer by exact or case-insensitive name (`agent/printbridge-agent.js:277-307`, `agent/printbridge-agent.js:545-568`).
5. On Windows, the spooler writes the PNG to a temporary file and invokes the driver through `System.Drawing.Printing.PrintDocument`; it applies copies, optional custom label paper size, dimensions, and offsets, then removes the temporary file (`agent/printbridge-agent.js:207-262`, `agent/printbridge-agent.js:367-399`).
6. The agent returns `{ ok: true, bytes, copies }` after the spooler succeeds, or a structured error; the panel updates its print status (`agent/printbridge-agent.js:570-579`, `js/print-panel.js:378-385`).

## Exit points

| Output | Detail |
|---|---|
| Browser-rendered PNG request | The current label SVG is rasterized at the selected DPI and sent to the agent (`js/print-panel.js:367-380`). |
| Windows printer spooler through the installed driver | `PrintDocument` draws the image at the requested physical size and offsets, with the requested paper mode and copies (`agent/printbridge-agent.js:225-255`). |
| Agent HTTP response and browser status | Success returns `{ ok: true, bytes, copies }`; failures return an error code/message and the browser displays the resulting status (`agent/printbridge-agent.js:447-456`, `agent/printbridge-agent.js:570-579`, `js/print-panel.js:378-385`). |

## Business rules

- Label width and height must be greater than 0 and at most 1000 mm; DPI must be from 72 through 1200 (`agent/printbridge-agent.js:290-307`).
- X/Y offsets default to zero and are limited to ±100 mm; copies default to one and must be an integer within the configured copy limit (`agent/printbridge-agent.js:290-307`).
- Paper defaults to `default`; only `default` and `label` are accepted. `label` creates a custom paper size from the requested dimensions; `default` leaves the printer's default paper size in place (`agent/printbridge-agent.js:304-307`, `agent/printbridge-agent.js:232-236`).
- The PNG check verifies the eight-byte PNG signature before printer lookup; it does not establish that the entire image can be decoded (`agent/printbridge-agent.js:264-271`, `agent/printbridge-agent.js:556-568`).
- When the rendered image resolution is at least the printer graphics resolution, the driver uses nearest-neighbor interpolation; otherwise it uses high-quality bicubic interpolation (`agent/printbridge-agent.js:237-248`).

## Errors and edge cases

- Missing or out-of-range query values return `400 bad_request`; an empty body also returns `400 bad_request` (`agent/printbridge-agent.js:277-307`, `agent/printbridge-agent.js:545-558`).
- A declared or streamed body over `maxImageBytes` returns `413 too_large`; a body without the PNG signature returns `415 not_png` (`agent/printbridge-agent.js:551-558`).
- An unknown printer returns `404 printer_not_found`; printer-list or print failures return `502 spooler_error` (`agent/printbridge-agent.js:560-579`).
- A non-POST request to `/print-image` returns `405 method_not_allowed` (`agent/printbridge-agent.js:500-503`, `agent/printbridge-agent.js:406-415`).
- If the browser cannot render the PNG, it reports the rendering error without posting; if the agent cannot be reached, the panel marks it unavailable (`js/print-panel.js:367-385`, `js/print-panel.js:308-320`).

## Where to act

| If changing... | Start at |
|---|---|
| Input validation | `agent/printbridge-agent.js` → `parseImageQuery` (`agent/printbridge-agent.js:273-307`) and `isPng` (`agent/printbridge-agent.js:264-271`). |
| Selection / query construction | `js/print-panel.js` → `imageRequest` (`js/print-panel.js:103-121`) and `js/render-export.js` → `imageQuery` (`js/render-export.js:50`). |
| Business rules / driver behavior | `agent/printbridge-agent.js` → `printImage` (`agent/printbridge-agent.js:545-579`) and `IMAGE_SCRIPT` (`agent/printbridge-agent.js:207-262`). |
| Output / persistence | `js/print-panel.js` → `printImage` (`js/print-panel.js:348-387`) and `agent/printbridge-agent.js` → `createWindowsSpooler().printImage` (`agent/printbridge-agent.js:367-399`). |
| Scheduling / configuration | No scheduled job is part of this browser-driven flow; begin configuration changes at `normalizeConfig` (`agent/printbridge-agent.js:53`) and its `maxImageBytes` validation test (`tests/print-image.test.js:261-264`). |

## Existing tests

- `tests/print-image.test.js`: exercises the `/print-image` endpoint with a fake spooler, including request validation, printing flow, and configuration validation (`tests/print-image.test.js:7`, `tests/print-image.test.js:261-264`).

## Coverage / Gaps

- No covering tests were found for the browser `printImage` flow: SVG-to-PNG rendering, query construction, and UI status handling remain untested (`js/print-panel.js:348-385`; endpoint coverage is in `tests/print-image.test.js:7`).
- No open question fragments were identified for this feature.
