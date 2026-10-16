# F5 - List and select an installed printer

Ticket: sin ticket (internal development).

## Purpose

The print panel retrieves the installed printers from the local agent and lets the user choose one for printing. It restores a valid remembered choice when possible and otherwise selects the Windows default printer or the first available printer (`js/print-panel.js:251-260, 275-286`).

## Trigger / Entry point

- Opening the print panel or retrying its connection check triggers a health check followed by `GET /printers` (`js/print-panel.js:263-276, 420-424`).
- Choosing a printer changes the panel selection and remembers the choice (`js/print-panel.js:413`).
- The local agent serves `GET /printers` (`agent/printbridge-agent.js:486-492`).

## Inputs (payload/config)

- Agent URL: the configured or remembered HTTP(S) base URL used by the panel to request `/health` and `/printers` (`js/print-panel.js:198-199, 396-410`).
- `GET /printers`: no request payload; the response is expected to contain a `printers` array (`agent/printbridge-agent.js:486-492`; `js/print-panel.js:275-280`).
- Each printer item supplies `name`, `isDefault`, and `status`; the panel uses those fields to label and select options (`js/print-panel.js:251-260`).

## Steps

1. The panel checks agent health, then requests the printer list; a monotonically increasing check id prevents an outdated response from replacing a newer check (`js/print-panel.js:263-277`).
2. The agent accepts only GET for `/printers`, calls `spooler.listPrinters()`, and returns `{ printers }`; a spooler exception becomes HTTP 502 with `spooler_error` (`agent/printbridge-agent.js:486-492`).
3. The Windows spooler runs the printer-list script and maps its output into printer names, default flags, and statuses (`agent/printbridge-agent.js:328-340, 374-375`).
4. The panel builds the select options, enables it only when printers exist, and chooses the remembered printer, otherwise the default, otherwise the first printer (`js/print-panel.js:251-260`).
5. Changing the selection stores a non-empty printer name in browser storage; retry invokes the same health-and-list check (`js/print-panel.js:413, 420`).

## Exit points

| Output | Detail |
|---|---|
| Local agent response | HTTP 200 with JSON `{ printers: [...] }`; spooler failures return HTTP 502 and `spooler_error` (`agent/printbridge-agent.js:486-492`). |
| Browser printer selection | Options display printer name, a default marker, and an offline marker; the select is disabled for an empty list (`js/print-panel.js:251-260`). |
| Remembered printer preference | A selected non-empty printer name is written to browser storage and reused when that name appears in a later list (`js/print-panel.js:252, 259-260, 413`). |

## Business rules

- Selection precedence is remembered printer if still present, then the printer marked default, then the first returned printer (`js/print-panel.js:252-260`).
- The printer selector remains disabled when the list is empty, and the panel reports that no printers are installed (`js/print-panel.js:257-260, 283-288`).
- A stale check response is ignored rather than overwriting a newer check's state (`js/print-panel.js:264-277, 289-291`).

## Errors and edge cases

- A non-GET request to `/printers` returns HTTP 405 with `method_not_allowed` (`agent/printbridge-agent.js:486-488`).
- A spooler failure returns HTTP 502 with `spooler_error`; the panel displays the agent message and keeps printing unavailable (`agent/printbridge-agent.js:489-492`; `js/print-panel.js:278-281`).
- A failed health check, malformed printer response, or fetch exception marks the agent unavailable and leaves printing disabled (`js/print-panel.js:271-292`).
- An empty printer list is a connected state, but the selector and print action remain unavailable and a no-printers message is shown (`js/print-panel.js:257-260, 283-288`).
- Browser storage read/write failures are swallowed, so the panel continues without a remembered choice (`js/print-panel.js:138-139`).

## Where to act

| If changing... | Start at |
|---|---|
| Request/response validation | `agent/printbridge-agent.js` → `handle` (`agent/printbridge-agent.js:486-492`); `js/print-panel.js` → `check` (`js/print-panel.js:275-281`) |
| Printer query and display | `agent/printbridge-agent.js` → `createWindowsSpooler` / `parsePrinterList` (`agent/printbridge-agent.js:328-340, 374-375`); `js/print-panel.js` → `fillPrinters` (`js/print-panel.js:251-260`) |
| Selection precedence and empty-list behavior | `js/print-panel.js` → `fillPrinters` / `check` (`js/print-panel.js:251-260, 283-288`) |
| Response and remembered preference | `agent/printbridge-agent.js` → `handle` (`agent/printbridge-agent.js:486-492`); `js/print-panel.js` → printer change handler (`js/print-panel.js:413`) |
| Scheduling/configuration | Not applicable (this feature has no scheduled work or separate printer-list configuration). |

## Existing tests

- `tests/print-panel.test.js`: verifies default and remembered printer precedence, ignores an unknown remembered choice, persists a changed selection, falls back to the first printer, empty-list behavior, list failures, and retry (`tests/print-panel.test.js:94-169, 264-279`).
- `tests/print-agent.test.js`: verifies `GET /printers` returns the fake spooler's list and maps a failing spooler to HTTP 502 `spooler_error` (`tests/print-agent.test.js:61-74`).

## Coverage / Gaps

- The Windows-specific `LIST_SCRIPT` output and `parsePrinterList` mapping have no covering tests; the endpoint tests use a fake spooler (`agent/printbridge-agent.js:328-340, 374-375`; `tests/print-agent.test.js:13-18, 61-74`).
