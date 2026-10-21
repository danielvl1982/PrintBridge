# F3 - Print label-language bytes through the local printer agent

Ticket: sin ticket (internal development)

## Purpose

The browser sends the current label-language bytes to the local PrintBridge agent, which submits them as a RAW job to the selected Windows printer. This path preserves the byte payload rather than rendering the label through the printer driver (`js/print-panel.js:324-345`, `agent/printbridge-agent.js:534-542`).

## Trigger / Entry point

- Choose `Etiquetera (código)` mode and click the print button in the browser panel (`js/print-panel.js:160`, `js/print-panel.js:419`).
- The local agent accepts `POST /print?printer=&copies=` (`agent/printbridge-agent.js:495-498`).

## Inputs (payload/config)

- Current label bytes returned by the editor's `getBytes` callback; the panel sends these bytes unchanged as the request body with `Content-Type: application/octet-stream` (`js/print-panel.js:329-338`). For TSPL source ending in `PRINT`, the callback adds `END` to the sent bytes when absent without changing the editor (`js/app.js`, `js/languages/tspl.js`).
- Selected printer name and copy count; the panel requires a printer and an integer count from 1 through 99 (`js/print-panel.js:324-328`, `js/print-panel.js:36`). Printer selection is feature [F5](select-printer.md).
- Agent `maxBytes` configuration bounds the request body; the repeated job is also capped at 100 MiB (`agent/printbridge-agent.js:36-37`, `agent/printbridge-agent.js:71-74`, `agent/printbridge-agent.js:515-522`).

## Steps

1. The panel uses the chosen printer supplied by [F5](select-printer.md); the user selects RAW mode and starts printing (`js/print-panel.js:160`, `js/print-panel.js:413-419`).
2. The panel rejects a missing printer or an invalid copy count, obtains the current label bytes, and posts them without transforming the body (`js/print-panel.js:324-345`).
3. The agent checks the local Host and allowed Origin, routes only `POST /print`, then validates the printer parameter, copy count, body size, and non-empty body (`agent/printbridge-agent.js:459-479`, `agent/printbridge-agent.js:495-498`, `agent/printbridge-agent.js:508-522`).
4. The agent lists installed printers, matches the requested name exactly or case-insensitively, repeats the body for the requested copies, and submits the result to the spooler (`agent/printbridge-agent.js:524-536`).
5. On Windows, the default spooler writes the bytes to a temporary `.bin` file, invokes the RAW-print PowerShell script, and removes the file in a `finally` block (`agent/printbridge-agent.js:367-387`).
6. The agent returns the byte count and copy count on success; the panel updates its status and remembers the selected printer. Structured failures are shown in the panel, while an unreachable agent marks the connection unavailable (`agent/printbridge-agent.js:534-542`, `js/print-panel.js:337-345`, `js/print-panel.js:308-320`).

## Exit points

| Output | Detail |
|---|---|
| Windows printer spooler via RAW | Receives the label-language byte sequence repeated for the requested copies (`agent/printbridge-agent.js:534-536`; default Windows spooler implementation: `agent/printbridge-agent.js:377-386`). |
| Agent HTTP response | Success is `{ ok: true, bytes, copies }`; failures return `{ ok: false, error, message }` and may include `detail` (`agent/printbridge-agent.js:453-456`, `agent/printbridge-agent.js:542`). |
| Browser print status and remembered printer | The panel shows the result and stores the printer preference after success (`js/print-panel.js:339-344`, `js/print-panel.js:138-139`). |

## Business rules

- RAW mode does not render a PNG or convert printer languages. The browser adds a final `END` only for TSPL labels whose last command is `PRINT`; existing `END` and BASIC programs ending in `EOP` are preserved (`js/app.js`, `js/languages/tspl.js`). The panel and agent then pass the prepared bytes through unchanged (`js/print-panel.js:324-345`).
- Copies must be an integer from 1 through 99, and the repeated job may not exceed 100 MiB (`js/print-panel.js:303-306`, `js/print-panel.js:327-328`, `agent/printbridge-agent.js:35-37`, `agent/printbridge-agent.js:511-522`).
- A printer match is exact first, then case-insensitive; no match returns `printer_not_found` (`agent/printbridge-agent.js:530-532`).
- The agent accepts printing only from a local Host and an allowed Origin when Origin is present (`agent/printbridge-agent.js:459-465`, `agent/printbridge-agent.js:128-133`).

## Errors and edge cases

- Missing selected printer or an invalid browser copy count prevents the request and displays the panel's validation message (`js/print-panel.js:324-328`).
- Missing printer parameter, invalid agent copy count, or an empty request body returns `400 bad_request` (`agent/printbridge-agent.js:508-513`, `agent/printbridge-agent.js:520-522`).
- A declared or streamed body beyond `maxBytes`, or a repeated job above 100 MiB, returns `413 too_large` (`agent/printbridge-agent.js:515-522`).
- A printer absent from the spooler list returns `404 printer_not_found`; printer-list or RAW-spooler failures return `502 spooler_error` (`agent/printbridge-agent.js:524-539`).
- A refused Host or Origin returns `403 origin_refused`; a non-POST request to `/print` returns `405 method_not_allowed` (`agent/printbridge-agent.js:459-465`, `agent/printbridge-agent.js:495-498`).
- If the agent cannot be reached, the panel marks it unavailable and shows its send-failure message (`js/print-panel.js:308-320`).

## Where to act

| If changing... | Start at |
|---|---|
| Input validation | `js/print-panel.js` → `printRaw` (`js/print-panel.js:324-335`) and `agent/printbridge-agent.js` → `print` (`agent/printbridge-agent.js:508-522`). |
| Printer selection / query | `agent/printbridge-agent.js` → `print` (`agent/printbridge-agent.js:524-532`); printer selection belongs to [F5](select-printer.md). |
| Business rules / copies and payload | `agent/printbridge-agent.js` → `print` (`agent/printbridge-agent.js:511-536`). |
| Output / persistence | `agent/printbridge-agent.js` → `createWindowsSpooler` (`agent/printbridge-agent.js:367-387`) and `js/print-panel.js` → `printRaw` (`js/print-panel.js:337-344`). |
| Scheduling / configuration | No scheduled job is part of this feature; RAW request limits are normalized by `agent/printbridge-agent.js` → `normalizeConfig` (`agent/printbridge-agent.js:53-79`) and applied by `print` (`agent/printbridge-agent.js:515-522`). |

## Existing tests

- `tests/print-agent.test.js`: the `POST /print sends the bytes untouched (0x00, 0x0D, 0x0A, 0xFF) as one job` case checks binary byte preservation (`tests/print-agent.test.js:79-80`).

## Coverage / Gaps

- The agent's RAW endpoint has a binary-preservation test, but CodeGraph found no direct test covering the browser `printRaw` caller and its request/status wiring (`js/print-panel.js:324-345`). See [the open question](../preguntas-abiertas.md).
