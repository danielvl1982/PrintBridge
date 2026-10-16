# Print Label Image Specification

## Purpose

Baseline spec (current behavior, derived from code on 2026-10-16). The browser renders the current label drawing as a PNG and submits it to the local agent for printing through an installed Windows printer driver. Documentation: `docs/features/print-label-image.md`. Ticket: none (internal development).

## Requirements

### Requirement: Prepare a driver-image print request

The system SHALL let the user submit the current label drawing in Driver image mode using the selected printer, label dimensions, resolution, paper mode, offsets, and copy count (`js/print-panel.js:349-362`). Before sending, the browser SHALL validate the printer, paper mode, pixel dimensions, offsets, and copy count and construct a `POST /print-image` request with `Content-Type: image/png` (`js/print-panel.js:103-121`; `js/render-export.js:31-43`).

#### Scenario: Valid label is rendered and submitted
- GIVEN a current label and valid printer and print settings
- WHEN the user prints in Driver image mode
- THEN the browser SHALL render the label SVG to PNG at the selected DPI and POST it to `/print-image` with the validated query and `image/png` content type (`js/print-panel.js:367-380`).

#### Scenario: Browser-side validation or rendering fails
- GIVEN missing or invalid print inputs, or an SVG that cannot be rendered
- WHEN the user starts a Driver image print
- THEN the browser SHALL report the error and SHALL NOT submit the image request (`js/print-panel.js:103-118`, `js/print-panel.js:363-374`).

### Requirement: Validate image-print parameters

The agent SHALL require a printer name, width and height greater than 0 and no greater than 1000 mm, and a DPI from 72 through 1200; offsets default to 0 and are limited to plus or minus 100 mm, copies default to 1 and are limited to the configured copy maximum, and paper defaults to `default` with only `default` and `label` accepted (`agent/printbridge-agent.js:277-307`).

#### Scenario: Required and optional values are parsed
- GIVEN a `POST /print-image` request with valid required parameters and omitted optional offsets, copies, or paper
- WHEN the agent parses the query
- THEN it SHALL use offsets of 0 mm, one copy, and `default` paper for omitted values (`agent/printbridge-agent.js:280-307`).

#### Scenario: A required value or supported range is invalid
- GIVEN a request with a missing printer, missing required dimension or DPI, out-of-range value, or unsupported paper mode
- WHEN the agent parses the query
- THEN it SHALL return HTTP 400 with error code `bad_request` and the validation detail (`agent/printbridge-agent.js:277-307`, `agent/printbridge-agent.js:453-456`, `agent/printbridge-agent.js:547-549`).

### Requirement: Accept only bounded PNG request bodies

The system SHALL accept only `POST` for `/print-image`; it SHALL reject an empty body, a declared or streamed body exceeding configured `maxImageBytes`, and a body without the eight-byte PNG signature (`agent/printbridge-agent.js:500-503`, `agent/printbridge-agent.js:551-558`, `agent/printbridge-agent.js:264-271`). The signature check SHALL NOT be treated as full PNG decoding or image-integrity validation (`agent/printbridge-agent.js:264-271`).

#### Scenario: Request method, size, and PNG signature are checked
- GIVEN a request to `/print-image`
- WHEN its method is not POST, its body is empty or too large, or its body lacks the PNG signature
- THEN the agent SHALL return respectively `405 method_not_allowed`, `400 bad_request`, `413 too_large`, or `415 not_png`, without submitting the body to the image spooler (`agent/printbridge-agent.js:500-503`, `agent/printbridge-agent.js:551-558`).

### Requirement: Resolve the requested printer and print through its driver

After request validation, the agent SHALL list installed printers and resolve the requested printer by exact name first and case-insensitive name second; an unknown printer SHALL return `404 printer_not_found` (`agent/printbridge-agent.js:560-568`). On Windows, the default spooler SHALL use `System.Drawing.Printing.PrintDocument`, apply copies and the requested image dimensions and offsets, set a custom paper size only for `label`, and dispose resources and remove its temporary PNG file (`agent/printbridge-agent.js:207-262`, `agent/printbridge-agent.js:388-399`).

#### Scenario: Printer is found and the driver completes printing
- GIVEN a valid PNG request and a matching installed printer
- WHEN the image spooler completes the print job
- THEN the agent SHALL return HTTP 200 with `{ ok: true, bytes, copies }` (`agent/printbridge-agent.js:570-579`).

#### Scenario: Printer lookup or printing fails
- GIVEN a valid PNG request
- WHEN printer listing fails, no requested printer matches, or the image spooler fails
- THEN the agent SHALL return `502 spooler_error` for listing or spooler failures and `404 printer_not_found` when no printer matches (`agent/printbridge-agent.js:560-576`).

### Requirement: Report print progress and retain the selected printer

The browser SHALL show preparation and sending status, display the agent's success or error result, and remember the selected printer after a successful image print when storage is available (`js/print-panel.js:367-385`). Storage failures SHALL not prevent printing (`js/print-panel.js:132-139`).

#### Scenario: Successful print updates status and remembered printer
- GIVEN a successful `/print-image` response
- WHEN the browser completes the print flow
- THEN it SHALL remember the selected printer when possible and show the image-print success status (`js/print-panel.js:378-385`).

#### Scenario: Agent returns an error or storage is unavailable
- GIVEN an unsuccessful agent response or unavailable browser storage
- WHEN the browser completes the print flow
- THEN it SHALL show the error result, and unavailable storage SHALL not prevent the print flow (`js/print-panel.js:124-139`, `js/print-panel.js:378-385`).
