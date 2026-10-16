# select-printer Specification

## Purpose

Baseline spec (current behavior, derived from code on 2026-10-16). The print panel retrieves installed printers from the local agent and lets the user select and remember a printer. Documentation: `docs/features/select-printer.md`. Ticket: none (internal development).

## Requirements

### Requirement: List installed printers through the local agent

The agent SHALL serve the printer list at `GET /printers` as JSON containing a `printers` array, and MUST reject other methods with HTTP 405 and `method_not_allowed` (`agent/printbridge-agent.js:486-492`).

#### Scenario: Printer list succeeds
- GIVEN the agent accepts a GET request to `/printers`
- WHEN the spooler returns its printer list
- THEN the agent SHALL respond with HTTP 200 and `{ printers: [...] }`

#### Scenario: Printer list method is not GET
- GIVEN a request targets `/printers` with a method other than GET
- WHEN the agent handles the request
- THEN the agent SHALL respond with HTTP 405 and `method_not_allowed`

#### Scenario: Spooler fails to list printers
- GIVEN a GET request to `/printers`
- WHEN the spooler throws while listing printers
- THEN the agent SHALL respond with HTTP 502 and `spooler_error`

### Requirement: Map Windows spooler records to printer entries

The Windows spooler SHALL map non-empty `Name` values to printer entries with `name`, `isDefault`, and `status`; an empty output SHALL produce an empty list (`agent/printbridge-agent.js:325-340, 368-375`).

#### Scenario: Spooler output contains printer records
- GIVEN Windows spooler JSON contains printer records
- WHEN the agent parses the output
- THEN each record with a non-empty string `Name` SHALL become an entry with its name, a default flag, and a status
- AND `WorkOffline: true` SHALL map to `offline`
- AND known `PrinterStatus` values SHALL map to their short status names, with unrecognized values mapped to `unknown`

#### Scenario: Spooler output is empty or contains invalid names
- GIVEN the spooler output is empty or a record has no non-empty string `Name`
- WHEN the agent parses the output
- THEN empty output SHALL produce an empty list and invalid-name records SHALL be omitted

### Requirement: Check agent health and retrieve the printer list

The print panel SHALL check `/health` before requesting `/printers`, and MUST ignore a health or printer-list response belonging to an outdated check (`js/print-panel.js:264-277`).

#### Scenario: Health succeeds and printer response is valid
- GIVEN the panel starts a connection check
- WHEN health succeeds and `/printers` returns an array
- THEN the panel SHALL mark the agent connected and populate the printer selector

#### Scenario: Health check or printer response fails
- GIVEN a connection check is in progress
- WHEN health is unsuccessful, the printer response is not a valid array, or a fetch operation throws
- THEN the panel SHALL mark the agent unavailable and keep the printer selector disabled (`js/print-panel.js:242-249, 268-292`)

#### Scenario: An earlier check completes after a newer check
- GIVEN two connection checks are in progress
- WHEN the earlier check's health or printer response arrives after the newer check began
- THEN the panel SHALL ignore the earlier response (`js/print-panel.js:264-277, 289-291`)

### Requirement: Present printers and choose the initial selection

The panel SHALL display each printer's name, append a default marker when `isDefault` is true and an offline marker when `status` is `offline`, and select the remembered printer if present, otherwise the default printer, otherwise the first printer (`js/print-panel.js:251-260`).

#### Scenario: Remembered, default, and fallback selection precedence
- GIVEN the returned printer list contains a remembered printer
- WHEN the panel populates the selector
- THEN it SHALL select the remembered printer
- WHEN no remembered printer is present but a default printer exists
- THEN it SHALL select the default printer
- WHEN neither a remembered nor default printer exists
- THEN it SHALL select the first printer

#### Scenario: No printers are installed
- GIVEN the agent returns an empty printer list
- WHEN the panel populates the selector
- THEN the selector SHALL be disabled, the selected value SHALL be empty, and the panel SHALL report that no printers are installed (`js/print-panel.js:257-260, 283-288`)

### Requirement: Remember a changed printer selection

The panel SHALL persist a selected non-empty printer name and use it when that name appears in a later printer list; storage read and write failures MUST be tolerated without interrupting panel operation (`js/print-panel.js:138-139, 252, 259-260, 413`).

#### Scenario: User changes the printer
- GIVEN the printer selector has a non-empty selected value
- WHEN the user changes the selection
- THEN the panel SHALL store the selected printer name

#### Scenario: Browser storage is unavailable
- GIVEN reading from or writing to browser storage throws
- WHEN the panel loads or the user changes the printer selection
- THEN the panel SHALL continue without using or remembering that preference
