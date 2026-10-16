# Local print agent HTTP API

The only API the system exposes is the local print agent in `agent/printbridge-agent.js`: a Node HTTP server bound to `127.0.0.1` (`agent/printbridge-agent.js:34`), default port `9631` (`agent/printbridge-agent.js:41`, configurable through `agent/config.json`). It has no database and no authentication token: access is limited by the Host/Origin gate (section 5). Protocol summary: `agent/printbridge-agent.js:12-21`.

Feature ids follow `docs/.work/catalog.json`: `GET /health` is the diagnostic process `-`; `GET /printers` is F5; `POST /print` is F3; and `POST /print-image` is F4. F1 (browser label editing) and F2 (format conversion) do not expose agent HTTP routes. F6 is a sample client of the API, not an endpoint. The Host/Origin gate is shared transport behavior, not a catalog feature.

| # | Route | Feature | Auth |
|---|---|---|---|
| 1 | `GET /health` | `-` (diagnostic) | No token; Host/Origin gate |
| 2 | `GET /printers` | F5 | No token; Host/Origin gate |
| 3 | `POST /print` | F3 | No token; Host/Origin gate |
| 4 | `POST /print-image` | F4 | No token; Host/Origin gate |
| 5 | Access gate and CORS preflight (`OPTIONS *`) | Cross-cutting | n/a |

Request dispatch order (`agent/printbridge-agent.js:459-506`): Host check, Origin check, `OPTIONS` preflight, then routing by `url.pathname`. A wrong verb on a known path returns 405; an unknown path returns 404.

## 1. GET /health

1. **Route**: `GET /health` (`agent/printbridge-agent.js:481`). No token authentication; Host/Origin gate only. Feature `-` (diagnostic).
2. **Request**: no body, no query, no required headers. Any verb other than `GET` returns 405 (`agent/printbridge-agent.js:482`).
3. **Responses**: `200 application/json; charset=utf-8` for an allowed caller; `403 origin_refused` from the gate; `405 method_not_allowed`. Every JSON response carries `Cache-Control: no-store` (`agent/printbridge-agent.js:449`).
4. **Success body**: `{ ok, version, platform }`. `version` is the constant `VERSION` (`agent/printbridge-agent.js:33`, `1.0.0`); `platform` is `process.platform` (`agent/printbridge-agent.js:483`).

```json
{ "ok": true, "version": "1.0.0", "platform": "<process.platform>" }
```

`version` is the current `VERSION` constant and `platform` is the runtime value (`agent/printbridge-agent.js:33`, `agent/printbridge-agent.js:483`).

5. **Example**:

```bash
curl http://127.0.0.1:9631/health
```

## 2. GET /printers

1. **Route**: `GET /printers` (`agent/printbridge-agent.js:486`). No token authentication; Host/Origin gate only. Feature F5.
2. **Request**: no body, no query. Other verbs return 405 (`agent/printbridge-agent.js:487`).
3. **Responses**: `200` with the list; `502 spooler_error` when the spooler call fails, with the error text in `detail` (`agent/printbridge-agent.js:491`). On a non-Windows host the Windows spooler rejects with `The Windows spooler is only available on Windows` (`agent/printbridge-agent.js:370`), so the response is that 502.
4. **Success body**: `{ printers: [{ name, isDefault, status }] }`. `status` is one of `ready`, `printing`, `warming-up`, `stopped`, `offline`, `unknown`: `offline` when `WorkOffline` is true, otherwise the Win32 `PrinterStatus` code 3..7 mapped by `STATUS_NAMES` (`agent/printbridge-agent.js:326`, `agent/printbridge-agent.js:339`). Empty spooler output gives `[]` (`agent/printbridge-agent.js:331`). This body has no `ok` field, unlike the other endpoints.

```json
{ "printers": [ { "name": "TEC B-EV4", "isDefault": true, "status": "ready" } ] }
```

The printer object is the fixture used by the agent protocol tests (`tests/print-agent.test.js:8-11`); real printers depend on the machine.

5. **Example**:

```bash
curl http://127.0.0.1:9631/printers
```

## 3. POST /print

1. **Route**: `POST /print` (`agent/printbridge-agent.js:495`, handler `agent/printbridge-agent.js:508`). No token authentication; Host/Origin gate only. Feature F3; uses printer selection F5.
2. **Request**:
   - Query `printer` (required, string): missing or empty gives 400 `Missing "printer"` (`agent/printbridge-agent.js:509-510`). Matched exactly first, then case-insensitively, against the spooler list (`agent/printbridge-agent.js:530-531`).
   - Query `copies` (optional, default `1`): must match `^\d{1,3}$` and be 1..99 (`MAX_COPIES`, `agent/printbridge-agent.js:35`); otherwise 400 `"copies" must be an integer between 1 and 99` (`agent/printbridge-agent.js:511-513`).
   - Body: the raw label bytes. The header comment says `application/octet-stream` (`agent/printbridge-agent.js:15`); the code does not check `Content-Type` (see fragment). An empty body gives 400 `Empty body` (`agent/printbridge-agent.js:521`).
   - Size limits: `maxBytes` (default 5 MiB, `agent/printbridge-agent.js:44`) checked against `Content-Length` and then while streaming (`agent/printbridge-agent.js:515-519`); and `body.length * copies` must not exceed 100 MiB (`MAX_JOB_BYTES`, `agent/printbridge-agent.js:37`, check at `agent/printbridge-agent.js:522`).
3. **Responses** (content type always `application/json; charset=utf-8`):

| Status | `error` | When |
|---|---|---|
| 200 | none | Job spooled (`agent/printbridge-agent.js:542`) |
| 400 | `bad_request` | Missing `printer`, invalid `copies`, empty body |
| 403 | `origin_refused` | Gate (section 5) |
| 404 | `printer_not_found` | Name not in the spooler list (`agent/printbridge-agent.js:532`) |
| 405 | `method_not_allowed` | Verb other than POST |
| 413 | `too_large` | Body over `maxBytes`, or body x copies over 100 MiB; the first two cases send `Connection: close` (`agent/printbridge-agent.js:516-519`) |
| 502 | `spooler_error` | `listPrinters` or `printRaw` rejected (`agent/printbridge-agent.js:528`, `agent/printbridge-agent.js:539`) |

4. **Success body**: `{ ok: true, bytes, copies }`. `bytes` is the length of ONE copy; the copies are the same data repeated inside ONE spooler job (`agent/printbridge-agent.js:534`, `agent/printbridge-agent.js:542`). Label data is never logged, only printer, byte count and copies (`agent/printbridge-agent.js:541`).

```json
{ "ok": true, "bytes": body.length, "copies": 2 }
```

`body.length` is the byte length of one copy; the tested fixture printer is `TEC B-EV4` (`agent/printbridge-agent.js:542`; `tests/print-agent.test.js:8-11`).

5. **Example**:

```bash
curl -X POST "http://127.0.0.1:9631/print?printer=My%20Printer&copies=2" \
     -H "Content-Type: application/octet-stream" --data-binary @label.tspl
```

## 4. POST /print-image

1. **Route**: `POST /print-image` (`agent/printbridge-agent.js:500`, handler `agent/printbridge-agent.js:546`). No token authentication; Host/Origin gate only. Feature F4; uses printer selection F5.
2. **Request**: query validated first by `parseImageQuery` (`agent/printbridge-agent.js:277-308`), then the body.

| Query | Required | Rule | Source |
|---|---|---|---|
| `printer` | yes | non-empty string | `agent/printbridge-agent.js:278-279` |
| `widthMm` | yes | number > 0 and <= 1000 | `agent/printbridge-agent.js:291` |
| `heightMm` | yes | number > 0 and <= 1000 | `agent/printbridge-agent.js:292` |
| `dpi` | yes | number 72..1200 | `agent/printbridge-agent.js:293` |
| `offsetXmm` | no (default 0) | number -100..100 | `agent/printbridge-agent.js:294` |
| `offsetYmm` | no (default 0) | number -100..100 | `agent/printbridge-agent.js:295` |
| `copies` | no (default 1) | integer 1..99, `^\d{1,3}$` | `agent/printbridge-agent.js:296` |
| `paper` | no (default `default`) | `label` or `default` | `agent/printbridge-agent.js:304-305` |

   Numbers must match `^-?\d{1,6}(\.\d{1,6})?$` (dot decimal, no exponent, no comma) (`agent/printbridge-agent.js:283`). Body: a PNG. An empty body gives 400, a body not starting with the 8-byte PNG signature gives 415 (`agent/printbridge-agent.js:557-558`, `agent/printbridge-agent.js:264`). Size limit `maxImageBytes` (default 20 MiB, `agent/printbridge-agent.js:45`) checked on `Content-Length` and while streaming (`agent/printbridge-agent.js:551-555`). Only the signature is checked, not that the PNG decodes.
3. **Responses**:

| Status | `error` | When |
|---|---|---|
| 200 | none | Page printed through the driver (`agent/printbridge-agent.js:579`) |
| 400 | `bad_request` | Any query rule above, or empty body; `detail` names the field (`agent/printbridge-agent.js:548`) |
| 403 | `origin_refused` | Gate |
| 404 | `printer_not_found` | Unknown printer (`agent/printbridge-agent.js:568`) |
| 405 | `method_not_allowed` | Verb other than POST |
| 413 | `too_large` | Body over `maxImageBytes` (with `Connection: close`) |
| 415 | `not_png` | Missing PNG signature |
| 502 | `spooler_error` | Listing or printing failed, or the spooler has no `printImage` (`agent/printbridge-agent.js:572-576`) |

4. **Success body**: `{ ok: true, bytes, copies }` (`agent/printbridge-agent.js:579`).

```json
{ "ok": true, "bytes": body.length, "copies": 1 }
```

`body.length` is the request PNG's byte length (`agent/printbridge-agent.js:579`); the tested request uses `printer=TEC%20B-EV4&widthMm=100&heightMm=50&dpi=300` (`tests/print-image.test.js:11-17`).

5. **Example**:

```bash
curl -X POST "http://127.0.0.1:9631/print-image?printer=My%20Printer&widthMm=100&heightMm=50&dpi=203&paper=label" \
     -H "Content-Type: image/png" --data-binary @label.png
```

## 5. Access gate and CORS preflight (cross-cutting)

Applies before routing, to every path and verb (`agent/printbridge-agent.js:459-479`).

1. **Host check**: `isHostAllowed` (`agent/printbridge-agent.js:129`) strips the optional port and accepts only `127.0.0.1` or `localhost` (`LOCAL_HOSTS`, `agent/printbridge-agent.js:108`). Anything else, including a missing Host, gives `403 origin_refused` with `Connection: close` (`agent/printbridge-agent.js:461`). This blocks DNS-rebinding pages (comment at `agent/printbridge-agent.js:128`).
2. **Origin check**: when the request has an `Origin` header, `isOriginAllowed` (`agent/printbridge-agent.js:114`) must accept it, else 403 `origin_refused`. Rules: the literal `null` (file:// pages) passes only with `allowFileOrigin: true`; the origin must be a canonical `scheme://host[:port]` (no path); an `allowedOrigins` entry of `http://localhost` or `http://127.0.0.1` without port accepts any port; every other entry must match exactly. Default list: `https://danielvl1982.github.io`, `http://localhost`, `http://127.0.0.1` (`agent/printbridge-agent.js:42`). Requests without an `Origin` (curl, native tools) skip this check (`agent/printbridge-agent.js:463`).
3. **CORS on allowed browser requests**: `Access-Control-Allow-Origin` echoing the origin and `Vary: Origin` (`agent/printbridge-agent.js:465`) on every response after the gate, errors included.
4. **Preflight**: `OPTIONS` on any path returns `204` with no body (`agent/printbridge-agent.js:469-478`). With an `Origin` it adds `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Allow-Private-Network: true` and `Access-Control-Max-Age: 600`; without an `Origin` it returns a bare 204.

Example (preflight as sent by a browser from the allowed GitHub Pages origin):

```bash
curl -i -X OPTIONS http://127.0.0.1:9631/print \
     -H "Origin: https://danielvl1982.github.io" \
     -H "Access-Control-Request-Method: POST"
```

Refused origin:

```bash
curl -i http://127.0.0.1:9631/health -H "Origin: https://example.com"
```

## 6. Errors

Every error is JSON (`agent/printbridge-agent.js:447-457`):

```json
{ "ok": false, "error": "bad_request", "message": "Petición no válida", "detail": "\"copies\" must be an integer between 1 and 99" }
```

- `error`: stable code, one of `origin_refused` (403), `bad_request` (400), `printer_not_found` (404), `too_large` (413), `not_png` (415), `spooler_error` (502), `not_found` (404), `method_not_allowed` (405).
- `message`: fixed Spanish text per code (`MESSAGES`, `agent/printbridge-agent.js:406-415`); the UI is Spanish by project decision.
- `detail`: optional, English, truncated to 300 characters (`agent/printbridge-agent.js:455`); present on `bad_request` and on `spooler_error` (the underlying error text).
- Any unexpected exception in a handler is answered as `502 spooler_error` (`agent/printbridge-agent.js:582-586`); if headers were already sent the socket is destroyed.

## 7. Interactive documentation

No aplica (the agent exposes no Swagger/OpenAPI/Scalar routes; the contract is the header comment at `agent/printbridge-agent.js:12-21` and `agent/README.md`).

## 8. Data contracts

- Spooler interface injected into `createServer`: `listPrinters(): Promise<[{ name, isDefault, status }]>`, `printRaw(printerName, Buffer)`, optional `printImage(printerName, pngBuffer, { widthMm, heightMm, dpi, offsetXmm, offsetYmm, copies, paper })` (`agent/printbridge-agent.js:7-10`, validated at `agent/printbridge-agent.js:443`).
- Printer object: `{ name: string, isDefault: boolean, status: string }`.
- Success envelope of the print routes: `{ ok: true, bytes: number, copies: number }`.
- F6, the interactive .NET sample client, consumes `GET /printers` and the two print routes; it does not add server endpoints (`docs/.work/catalog.json`, F6 entry points and exits; `dotnet/PrintBridge.Sample/Program.cs:9-29`).
- No OpenAPI declaration exists, so there are no declared-vs-real differences to list. Differences between the header comment and real behavior are fragments in `docs/.work/questions/api.md`.
- Printing to a real label printer is unverified (see `docs/.work/questions/bootstrap.md`).
