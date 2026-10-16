# Data

## 1. Stores

| Store | Connection / access | Owner | Persistence and purpose |
|---|---|---|---|
| Browser editor state | None | PrintBridge | Label text, test values and image are held in application memory while editing (`js/app.js:237-241`; `js/app.js:391-404`). |
| Browser `localStorage` | Browser origin storage | PrintBridge | Remembers seven print preferences and the collapsible-panel state (`js/print-panel.js:28-35`; `js/collapse.js:14-16`). If unavailable, values are not remembered (`js/print-panel.js:132-139`; `js/collapse.js:29-31`). |
| Agent configuration file | Optional JSON file selected by `--config`; default path is `agent/config.json` | PrintBridge agent | Holds service settings such as port, allowed origins and request-size limits (`agent/printbridge-agent.js:40-46`; `agent/printbridge-agent.js:52-79`; `agent/printbridge-agent.js:596-606`). |
| Agent temporary print file | `os.tmpdir()/printbridge-<16 hexadecimal characters>.bin` or `.png` | PrintBridge agent | Holds one job's raw bytes or PNG while the Windows spooler consumes it; removed in `finally` (`agent/printbridge-agent.js:377-397`). |
| Installed Windows printers and spooler | Local agent spooler interface | Windows / installed printer drivers | Printer inventory is read from the spooler; print jobs are submitted to it (`agent/printbridge-agent.js:7-10`; `agent/printbridge-agent.js:486-492`; `agent/printbridge-agent.js:534-542`; `agent/printbridge-agent.js:570-579`). |
| Downloaded label file, clipboard, generated PNG | Browser APIs | Output consumers | Operation outputs, not application-managed persistent stores (`js/print-panel.js:348-380`; `js/convert-panel.js:101,111`). |

No database connection key applies to these stores. **Inferred from code:** the inspected implementation has no application-owned relational database, ORM mapping or database repository. The fragment records this inference for owner confirmation.

## 2. Tables and collections

**Not applicable:** no application-owned database tables, collections, DDL or ORM entities were identified in the inspected implementation. Browser preferences are key/value entries in `localStorage` (`js/print-panel.js:132-139`; `js/print-panel.js:190-199`). Printer records are supplied by the spooler; the interface exposes `name`, `isDefault` and `status` (`agent/printbridge-agent.js:7-10`; `js/print-panel.js:251-260`).

### 2.1 Browser preference keys

| Key | Value / default | Read and write evidence |
|---|---|---|
| `printbridge.agentUrl` | HTTP(S) URL; default `http://127.0.0.1:9631` | Read `js/print-panel.js:198`; validated and written `js/print-panel.js:396-409`. |
| `printbridge.printer` | Printer name from current list | Read `js/print-panel.js:251-260`; written on selection or successful print `js/print-panel.js:340-341`, `js/print-panel.js:381-382`, `js/print-panel.js:413`. |
| `printbridge.printMode` | `raw` or `image`; default `raw` | Read/fallback `js/print-panel.js:190-192`; write `js/print-panel.js:414`. |
| `printbridge.imageDpi` | `203`, `300`, or `600`; default `300` | Read/fallback `js/print-panel.js:193`; write `js/print-panel.js:415`. |
| `printbridge.imagePaper` | `default` or `label`; default `default` | Read/fallback `js/print-panel.js:194`; write `js/print-panel.js:416`. |
| `printbridge.imageOffsetX`, `printbridge.imageOffsetY` | Millimetres, within ±100; default `0` | Validation `js/print-panel.js:81-86`; read/fallback `js/print-panel.js:195-196`; write `js/print-panel.js:417-418`. |
| `printbridge.collapsed` | JSON object mapping panel IDs to booleans | Read and fallback `js/collapse.js:18-23`, `js/collapse.js:44-50`; whole-object merge/write `js/collapse.js:25-27`, `js/collapse.js:53-56`. |

Invalid remembered print choices fall back to defaults (`js/print-panel.js:190-196`). Copies are not persisted (`js/print-panel.js:146`; `js/print-panel.js:303-305`).

## 3. Read/write matrix

R/W describe interactions with the named store; `-` means no interaction. The local spooler is external to PrintBridge.

| Catalog operation | Editor memory | Browser `localStorage` | Agent configuration | Agent temporary file | Windows spooler | Browser / console outputs |
|---|---|---|---|---|---|---|
| F1 Edit and preview label | R/W label state and test values (`js/app.js:237-241`; `js/app.js:391-404`) | R/W print-panel and collapsed-panel preferences (`js/print-panel.js:190-199`; `js/print-panel.js:413-421`; `js/collapse.js:18-27`) | - | - | - | - |
| F2 Convert label language | R source label; W conversion result (`js/convert-panel.js:58`) | - | - | - | - | W copied/downloaded conversion (`js/convert-panel.js:101,111`) |
| F3 Print raw label | R bytes prepared from current label (`js/print-panel.js:323-338`) | R/W selected-printer preference (`js/print-panel.js:252-260`; `js/print-panel.js:340-341`) | R settings at agent startup (`agent/printbridge-agent.js:596-606`) | W `.bin`, then delete (`agent/printbridge-agent.js:377-386`) | R printer list; W one RAW job with label bytes repeated for copies (`agent/printbridge-agent.js:524-542`) | W status/response (`agent/printbridge-agent.js:538-542`) |
| F4 Print label image | R SVG and print options; W rendered PNG request (`js/print-panel.js:348-380`) | R/W selected printer and preferences (`js/print-panel.js:190-199`; `js/print-panel.js:381-382`; `js/print-panel.js:413-418`) | R settings at agent startup (`agent/printbridge-agent.js:596-606`) | W `.png`, then delete (`agent/printbridge-agent.js:388-397`) | R printer list; W PNG job through selected driver (`agent/printbridge-agent.js:560-579`) | PNG sent in request body (`js/print-panel.js:369-380`); W status/response (`agent/printbridge-agent.js:570-579`) |
| F5 Select printer | - | R remembered choice; W selection (`js/print-panel.js:252-260`; `js/print-panel.js:413`) | R settings at agent startup (`agent/printbridge-agent.js:596-606`) | - | R inventory and status (`agent/printbridge-agent.js:486-492`) | - |
| F6 .NET sample print client | - | - | - | - | Indirectly via agent for F3/F4 (`dotnet/PrintBridge.Sample/Program.cs:9-29`; `dotnet/PrintBridge.Sample/PrintBridgeClient.cs:21,29,35-36`) | W console result and process exit (`dotnet/PrintBridge.Sample/Program.cs:10,24,31-43`) |
| Diagnostic `-` health check | - | - | R agent version/platform (`agent/printbridge-agent.js:481-484`) | - | - | W HTTP health response (`agent/printbridge-agent.js:481-484`) |

## 4. State semantics

**Not applicable:** there are no persisted status or flag columns and no database-backed state transitions. The external spooler supplies printer `status` and `isDefault`; the panel annotates offline/default printers and chooses the remembered printer, then default, then first available (`agent/printbridge-agent.js:7-10`; `js/print-panel.js:251-260`). The spooler owns the meaning and transitions of status values.

## 5. Formulas and calculations

- Image dimensions are rounded independently to whole pixels: `widthPx = max(1, round(widthMm / 25.4 * dpi))`, likewise for height (`js/render-export.js:32-43`). Example: 100 x 50 mm at 203 dpi produces 799 x 400 px (`js/render-export.js:35-36`).
- The image-print query carries printer, millimetre dimensions, DPI, offsets, copies and paper. Numeric values are range-checked and serialized with at most six decimals, without exponent notation (`js/render-export.js:50-70`).
- Raw job bytes equal the label body repeated `copies` times, combined into one spooler job (`agent/printbridge-agent.js:534-536`; `agent/printbridge-agent.js:21`).
- A repeated raw job must not exceed 100 MiB and copies are limited to 1–99 (`agent/printbridge-agent.js:35-38`; `agent/printbridge-agent.js:515-522`). Example: a 2 KiB label sent for 10 copies yields 20 KiB of repeated bytes.
- Temporary job filenames combine `printbridge-`, 8 random bytes rendered as 16 hexadecimal characters, and `.bin` or `.png` (`agent/printbridge-agent.js:380-396`).

## 6. Generated data contracts

| Contract | Fields / representation | Source |
|---|---|---|
| `GET /health` response | `{ ok, version, platform }` | Agent runtime (`agent/printbridge-agent.js:481-484`). |
| `GET /printers` response | `{ printers: [{ name, isDefault, status }] }` | Windows spooler (`agent/printbridge-agent.js:7-10`; `agent/printbridge-agent.js:486-490`). |
| `POST /print` | `application/octet-stream` label bytes; query `printer`, `copies`; success `{ ok: true, bytes, copies }` | Current label and print settings (`agent/printbridge-agent.js:15`; `agent/printbridge-agent.js:508-542`; `js/print-panel.js:323-342`). |
| `POST /print-image` | `image/png`; query `printer`, `widthMm`, `heightMm`, `dpi`, `offsetXmm`, `offsetYmm`, `copies`, `paper`; success `{ ok: true, bytes, copies }` | Browser-rendered label and controls (`agent/printbridge-agent.js:16-17`; `js/print-panel.js:348-382`). |
| Agent error | `{ ok: false, error, message }`, optionally `detail` | Agent validation or service failure (`agent/printbridge-agent.js:453-456`; `agent/printbridge-agent.js:18-20`). |

## 7. Schema differences

**Not applicable:** no production database DDL, migrations or test database schema were identified for comparison. The spooler is injected, allowing tests to use a fake (`agent/printbridge-agent.js:7-10`). The inferred absence of an application database is tracked in `docs/.work/questions/datos.md`.
