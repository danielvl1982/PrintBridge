# PrintBridge print agent

A small program that runs on the Windows PC the label printers are connected to. It lets the PrintBridge web app send a label to a
printer with one click (the **Imprimir** button of the **Impresión** panel). A web page cannot write RAW data to a USB label printer
by itself, so the page talks to this agent, and the agent hands the bytes to the Windows print spooler.

It is one file (`printbridge-agent.js`), has **no npm dependencies**, listens only on `127.0.0.1` and sends the bytes exactly as they
arrive (TPCL, TSPL and ZPL, including the binary `BITMAP` data of TSPL images).

> Status: the HTTP protocol, the origin checks and the app panel are covered by automated tests with a fake spooler, and the printer
> listing was run on a real Windows machine. **Sending a job to a real label printer, and the Scheduled Task installer, have not been
> verified yet**: test with one label on each of your printers (TEC, TSC, Zebra) before relying on it.

## Requirements

- Windows 10 or 11 (the spooler is reached through Windows PowerShell, which ships with Windows).
- [Node.js](https://nodejs.org) LTS (version 18 or newer) on the `PATH`.
- The printers installed in Windows (USB printers are fine), see [Printers](#printers).

## Install (starts by itself at every logon)

From a PowerShell window, in the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File agent\install.ps1
```

`install.ps1` checks that Node is on the `PATH`, registers a Scheduled Task called **PrintBridge Agent** for the current user (no administrator
rights needed; it runs at logon, hidden, and is restarted if it stops), starts it now and prints the address. Running it again replaces
the previous registration. Remove everything with:

```powershell
powershell -ExecutionPolicy Bypass -File agent\uninstall.ps1
```

`uninstall.ps1` stops the agent and removes the task.

## Manual start

Double-click `agent\start.bat` (or run `node agent\printbridge-agent.js`). The agent runs in that console window and prints one line per
print job; close the window or press Ctrl+C to stop it. Optionally `--config <file>` reads another configuration file.

## Configuration

Optional. Copy `config.example.json` to `config.json` (same folder; it is git-ignored) and change what you need. The file is read when
the agent starts, so restart it after editing. A missing key keeps its default; an invalid file stops the agent with a message that names the problem.

| Key | Default | Meaning |
|---|---|---|
| `port` | `9631` | TCP port on `127.0.0.1`. If you change it, change **Agente** in the Impresión panel too. |
| `allowedOrigins` | `["https://danielvl1982.github.io", "http://localhost", "http://127.0.0.1"]` | Web origins (scheme + host + port) allowed to call the agent. `http://localhost` and `http://127.0.0.1` without a port accept any port; every other entry must match exactly. |
| `allowFileOrigin` | `false` | Also accept pages opened from a file (`file://`, whose origin is `null`). See the risk below. |
| `maxBytes` | `5242880` (5 MB) | Largest request body accepted; bigger ones get `too_large`. |

### Allowed origins, and why

A browser lets any web page you visit send requests to `127.0.0.1`. Without a check, a malicious page could make your printer print.
So the agent answers only requests whose `Origin` is in the list: the deployed app (`https://danielvl1982.github.io`) and the local
servers you may run it from (`localhost` / `127.0.0.1`, any port). A request with a different `Origin` gets `403 origin_refused`. A request
without an `Origin` header (for example `curl` on the same PC) is allowed: it can only come from this machine.

If you use the app by double-clicking `index.html`, the page's origin is `null`. Set `"allowFileOrigin": true` to accept it. The risk: other
local files and some sandboxed pages also have the `null` origin, so with the flag on they can print too. Prefer the live app or a local web server.

### Chrome "local network access" prompt

Chrome asks, the first time a public page (the deployed app) talks to a program on your own PC, whether to allow access to local network
devices. Choose **Allow**. The agent answers the preflight request with `Access-Control-Allow-Private-Network: true`, which Chrome needs.
If you chose Block by mistake, open the padlock next to the address, **Site settings**, and allow **Local network access**, then press **Reintentar** in the panel.

## Printers

The agent prints on the printers Windows knows: **Settings, Bluetooth & devices, Printers & scanners** (or `printmanagement.msc`). Connect
the printer by USB, install it (the manufacturer driver, or the Windows generic one) and check that it appears in the list. If the printer is
shared from another PC, add it as a network printer on this one first.

Because the data is sent **RAW** (the bytes go straight to the printer without any driver processing), the driver does not need to
understand TPCL, TSPL or ZPL. A **Generic / Text Only** driver on the printer's port works fine and is a good choice if the manufacturer
driver misbehaves (for example one that adds page breaks, or tries to render the data as a page). Printers that are offline show
"(sin conexión)" in the panel.

## API

All answers are JSON, except the 204 of the preflight. Errors look like `{ "ok": false, "error": "<code>", "message": "<Spanish text>" }`.

| Request | Answer |
|---|---|
| `GET /health` | `{ "ok": true, "version": "1.0.0", "platform": "win32" }` |
| `GET /printers` | `{ "printers": [{ "name": "...", "isDefault": true, "status": "ready" }] }` (`status`: `ready`, `printing`, `warming-up`, `stopped`, `offline`, `unknown`) |
| `POST /print?printer=<name>&copies=<n>` | The raw bytes as the body (`Content-Type: application/octet-stream`). `{ "ok": true, "bytes": <size of one copy>, "copies": <n> }` |
| `OPTIONS` (any path) | The CORS preflight: `Access-Control-Allow-Origin` with the exact origin (never `*`), `-Methods`, `-Headers`, `Access-Control-Allow-Private-Network: true`, `Vary: Origin` |

`copies` is 1 to 99 (default 1): the agent repeats the data that many times inside **one** spooler job, so labels with counters increment
per label as if the printer printed them one after another.

| Code | HTTP | When |
|---|---|---|
| `origin_refused` | 403 | The `Origin` is not allowed, or the `Host` header is not `127.0.0.1` / `localhost` |
| `printer_not_found` | 404 | The printer name is not in the Windows list (checked before printing) |
| `too_large` | 413 | The body is over `maxBytes` |
| `bad_request` | 400 | Missing printer, empty body, or `copies` not an integer from 1 to 99 |
| `spooler_error` | 502 | PowerShell or Windows could not list the printers or write the job (the `detail` field carries the reason) |

## Test it with curl

```bat
curl http://127.0.0.1:9631/health
curl http://127.0.0.1:9631/printers
```

Printing a tiny TSPL label (this really prints, use a printer with labels loaded):

```bat
echo SIZE 40 mm,30 mm> test.prn
echo CLS>> test.prn
echo TEXT 20,20,"3",0,1,1,"PrintBridge">> test.prn
echo PRINT 1>> test.prn
curl -X POST --data-binary @test.prn -H "Content-Type: application/octet-stream" "http://127.0.0.1:9631/print?printer=TSC%20TTP-244%20Plus&copies=1"
```

Use `%20` for spaces in the printer name. `--data-binary` keeps the bytes untouched (plain `-d` would strip line breaks).

## Troubleshooting

- **The panel says "Agente no disponible"**: the agent is not running (start it with `start.bat`, or check the task with `Get-ScheduledTask "PrintBridge Agent"`),
  the port or the address in **Agente** is wrong (default `http://127.0.0.1:9631`), or the browser blocked the access: look for the Chrome local network prompt above.
  Open `http://127.0.0.1:9631/health` in the browser: if it answers `{"ok":true,...}` the agent is fine and the problem is the origin or the permission.
  The browser shows a refused origin and a stopped agent in the same way, so check the agent console too.
- **origin_refused / "no permite esta página"**: the page's origin is not in `allowedOrigins` (for example the app is served from another address, or opened as a file). Add the origin
  to `config.json` (or `allowFileOrigin`) and restart the agent.
- **printer_not_found**: the name must be exactly as Windows lists it (`GET /printers`). Reload the list with **Reintentar** after installing a printer.
- **"port ... is already in use"**: another copy of the agent (or another program) holds the port. Stop it, or change `port`.
- **The job is accepted but nothing prints**: open the Windows print queue of that printer (the job may be stuck or the printer paused or offline). Make sure the printer is not set to
  "Use printer offline". Try the **Generic / Text Only** driver on the same port. Check that the label language matches the printer (TPCL on a TEC, TSPL on a TSC, ZPL on a Zebra), the label size and the media.
- **Garbage printed instead of the label**: the driver is processing the data instead of sending it RAW; switch to the Generic / Text Only driver.
- **Node not found**: install the LTS version from nodejs.org and open a new terminal so the `PATH` is refreshed.

## Security notes

- The agent binds to `127.0.0.1` only: it is not reachable from other computers on the network.
- Every request is checked: the `Origin` must be allowed (or absent), and the `Host` header must be `127.0.0.1` or `localhost`, which stops DNS-rebinding attacks (a page on `evil.example` made to resolve to `127.0.0.1`).
- The label data is never logged: the log has one line per job with the time, the printer, the byte count and the copies.
- The printer name and the data never go inside a PowerShell command line: the name travels in an environment variable and the bytes in a temporary file (deleted afterwards).
- There is **no authentication token**. The origin and Host checks already keep other web pages out, and a token stored in a page served from GitHub Pages would be readable by anyone, so it would add no protection. Anything running on this PC as
  you can already print without the agent. If the PC is shared with untrusted users, do not run the agent there.
- The size limit (`maxBytes`, 5 MB by default) bounds memory use; a job is also limited to 100 MB after repeating the copies.
