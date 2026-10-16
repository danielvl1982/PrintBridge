# print-raw-label Specification

## Purpose

Baseline spec (current behavior, derived from code on 2026-10-16). The browser sends label-language bytes unchanged to the local agent, which submits them as a RAW job to the selected Windows printer. Documentation: `docs/features/print-raw-label.md`. Ticket: none.

## Requirements

### Requirement: Submit label bytes from the RAW panel

The panel SHALL use the RAW mode to obtain the selected printer, validate the copy count as an integer from 1 through 99, obtain the current label bytes, and POST them unchanged as `application/octet-stream` to `/print` with the printer and copies in the query (`js/print-panel.js:324-345`).

#### Scenario: Valid RAW print request
- GIVEN a selected printer, a copy count from 1 through 99, and current label bytes
- WHEN the user prints in RAW mode
- THEN the panel SHALL send those bytes unchanged to the local agent with the selected printer and copy count

#### Scenario: Missing printer or invalid copies
- GIVEN no selected printer or a copy count outside the supported integer range
- WHEN the user prints in RAW mode
- THEN the panel SHALL show its validation message and SHALL NOT submit the print request (`js/print-panel.js:324-328`)

### Requirement: Restrict access to the local print agent

The agent SHALL reject requests with a disallowed Host or, when an Origin is present, a disallowed Origin with HTTP 403 and `origin_refused`; it SHALL route only `POST /print` to RAW printing and return HTTP 405 for another method on that route (`agent/printbridge-agent.js:459-465`, `agent/printbridge-agent.js:495-498`).

#### Scenario: Request has a disallowed Host or Origin
- GIVEN a request to the agent with a Host or present Origin that is not allowed
- WHEN the agent handles the request
- THEN the agent SHALL respond with HTTP 403 and the `origin_refused` error without processing the print route

#### Scenario: Print route uses a non-POST method
- GIVEN a request whose path is `/print`
- WHEN its method is not POST
- THEN the agent SHALL respond with HTTP 405 and `method_not_allowed`

### Requirement: Validate RAW request and size limits

The agent SHALL require a printer parameter, accept copies only as an integer from 1 through 99 (defaulting an omitted copies parameter to 1), reject an empty body, enforce configured `maxBytes` on declared and streamed request bodies, and reject a repeated job larger than 100 MiB (`agent/printbridge-agent.js:508-522`, `agent/printbridge-agent.js:35-37`).

#### Scenario: Missing or invalid required print data
- GIVEN a RAW print request with no printer, invalid copies, or an empty body
- WHEN the agent validates the request
- THEN it SHALL return HTTP 400 with `bad_request` and SHALL NOT submit a job

#### Scenario: Request or repeated job exceeds a limit
- GIVEN the declared or streamed body exceeds configured `maxBytes`, or body length multiplied by copies exceeds 100 MiB
- WHEN the agent validates the RAW request
- THEN it SHALL return HTTP 413 with `too_large` and SHALL NOT submit a job (`agent/printbridge-agent.js:515-522`)

### Requirement: Resolve the requested printer and repeat bytes for copies

The agent SHALL list installed printers, prefer an exact name match and otherwise match case-insensitively, return HTTP 404 `printer_not_found` when no printer matches, and submit the request body repeated once per copy to the matching printer (`agent/printbridge-agent.js:524-536`).

#### Scenario: Printer is found and multiple copies are requested
- GIVEN the requested printer matches an installed printer and copies is greater than one
- WHEN the agent submits the RAW job
- THEN it SHALL pass the matched installed printer name and the original body repeated for the requested copies to the spooler

#### Scenario: Printer is not installed
- GIVEN no installed printer matches the requested printer name
- WHEN the agent resolves the printer
- THEN it SHALL return HTTP 404 with `printer_not_found` without submitting a job

### Requirement: Submit RAW bytes through the Windows spooler

The default Windows spooler SHALL write the received bytes to a temporary `.bin` file, invoke the RAW-print PowerShell script for the selected printer, and attempt to remove the temporary file in a `finally` block (`agent/printbridge-agent.js:367-387`).

#### Scenario: Windows spooler prints a RAW job
- GIVEN a valid RAW job is submitted through the default Windows spooler
- WHEN the spooler invokes the RAW-print script
- THEN it SHALL write the job bytes to a temporary binary file, pass the file and printer to the script, and attempt temporary-file cleanup whether printing succeeds or fails

### Requirement: Report RAW print results

The agent SHALL return HTTP 200 with `{ ok: true, bytes, copies }` after successful spooler submission, and SHALL return structured failures for printer-list or print-spooler errors; the panel SHALL remember the selected printer and show success only after an `ok: true` response, show the agent's failure message for a structured unsuccessful response, and mark the agent unavailable when it cannot be reached (`agent/printbridge-agent.js:453-456`, `agent/printbridge-agent.js:524-542`, `js/print-panel.js:308-320`, `js/print-panel.js:337-345`).

#### Scenario: Spooler accepts the job
- GIVEN the spooler successfully submits the RAW job
- WHEN the agent and panel process the successful response
- THEN the agent SHALL return the original body byte count and copies, and the panel SHALL remember the printer and display the print result

#### Scenario: Spooler fails or agent is unreachable
- GIVEN printer listing or RAW submission fails, or the agent cannot be reached
- WHEN the panel processes the outcome
- THEN the agent SHALL report a structured spooler failure when it can respond, and the panel SHALL show the failure or mark the agent unavailable when the request cannot be reached
