# PrintBridge print agent

A small program that runs on the Windows PC the label printers are connected to. It lets the PrintBridge web app send a label to a
printer with one click (the **Print** button of the print panel). A web page cannot write RAW data to a USB label printer
by itself, so the page talks to this agent, and the agent hands the bytes to the Windows print spooler.

It is one file (`printbridge-agent.js`), has **no npm dependencies**, listens only on `127.0.0.1` and sends the bytes exactly as they
arrive (TPCL, TSPL and ZPL, including the binary `BITMAP` data of TSPL images). It can also print a PNG of the drawing through the Windows printer driver
(`POST /print-image`, see [Print an image](#print-an-image-through-the-driver)).

> Status: the HTTP protocol, the origin checks and the app panel are covered by automated tests with a fake spooler, and the printer
> listing and `install.ps1` (download, start, Scheduled Task, uninstall) were run on a real Windows machine. **Sending a job to a real
> label printer has not been verified yet**: test with one label on each of your printers (TEC, TSC, Zebra) before relying on it.

The app itself is in Spanish, so this guide names its controls as they appear on screen: the print panel is **Impresión**, its button **Imprimir**,
the address field **Agente** and the retry button **Reintentar**.

## Requirements

- Windows 10 or 11 (the spooler is reached through Windows PowerShell, which ships with Windows).
- [Node.js](https://nodejs.org) LTS (version 18 or newer) on the `PATH`.
- The printers installed in Windows (USB printers are fine), see [Printers](#printers).

## Install

One command downloads the agent into `%LOCALAPPDATA%\PrintBridge` and starts it in the background. Open a PowerShell window (no administrator rights needed) and run:

```powershell
irm https://raw.githubusercontent.com/danielvl1982/PrintBridge/main/agent/install.ps1 | iex
```

The script checks that Node.js 18 or newer is on the `PATH`, downloads `printbridge-agent.js` and `config.example.json`, starts the agent hidden and
checks that it answers at `http://127.0.0.1:9631/health`. Run it again at any time to update: it stops the running agent, downloads the latest files and starts it again.
Your `config.json` is never touched. It only talks to `raw.githubusercontent.com`, over HTTPS. Read the script first if you prefer: [`install.ps1`](install.ps1).

This starts the agent **for the current session**: after a restart or a new logon you have to run the command again, or enable the autostart below.

### Start it at every logon (background service)

A piped script cannot take parameters, so wrap it in a script block and add `-Autostart`:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/danielvl1982/PrintBridge/main/agent/install.ps1))) -Autostart
```

This also registers a Scheduled Task called **PrintBridge Agent** for the current user: it runs at every logon, hidden, and is restarted (up to 3 times, one minute apart) if it stops.
It is a per-user task, so it needs no administrator rights and it does not run before anybody logs on. A true Windows service that starts at boot would need
administrator rights and a service wrapper (the agent would also have to run as a user that can see the printers); it is not provided.

### Options

Options go after the script block, as `-Autostart` does above.

| Option | Effect |
|---|---|
| `-Autostart` | Also register the Scheduled Task, so the agent starts at every logon. |
| `-Foreground` | Run the agent in the current window instead of the background (Ctrl+C stops it). Use it to see the log lines when something fails. |
| `-Uninstall` | Stop the agent, remove the Scheduled Task and delete the downloaded files. `config.json` is kept. |
| `-InstallDir <path>` | Where the agent is downloaded (default `%LOCALAPPDATA%\PrintBridge`). |
| `-BaseUrl <url>` | Where the files are downloaded from (default: the `agent` folder of the `main` branch on GitHub). Use it for a fork or to pin a tag. |
| `-TaskName <name>` | Name of the Scheduled Task (default `PrintBridge Agent`). |

To remove everything:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/danielvl1982/PrintBridge/main/agent/install.ps1))) -Uninstall
```

### From a checkout of the repository

When `install.ps1` runs from a copy of the repository, it uses the files next to it (nothing is downloaded, `-InstallDir` is ignored) and accepts the same options:

```powershell
powershell -ExecutionPolicy Bypass -File agent\install.ps1 -Autostart
```

## Manual start

Double-click `agent\start.bat` (or run `node agent\printbridge-agent.js`). The agent runs in that console window and prints one line per
print job; close the window or press Ctrl+C to stop it. `start.bat` takes no arguments: to read another configuration file run `node agent\printbridge-agent.js --config <file>`.

## Configuration

Optional. Copy `config.example.json` to `config.json` (same folder; it is git-ignored) and change what you need. The file is read when
the agent starts, so restart it after editing. A missing key keeps its default; an invalid file stops the agent with a message that names the problem.

| Key | Default | Meaning |
|---|---|---|
| `port` | `9631` | TCP port on `127.0.0.1`. If you change it, change the **Agente** field of the print panel too. |
| `allowedOrigins` | `["https://danielvl1982.github.io", "http://localhost", "http://127.0.0.1"]` | Web origins (scheme + host + port) allowed to call the agent. `http://localhost` and `http://127.0.0.1` without a port accept any port; every other entry must match exactly. |
| `allowFileOrigin` | `false` | Also accept pages opened from a file (`file://`, whose origin is `null`). See the risk below. |
| `maxBytes` | `5242880` (5 MB) | Largest request body accepted by `/print`; bigger ones get `too_large`. |
| `maxImageBytes` | `20971520` (20 MB) | Largest PNG accepted by `/print-image` (a 600 dpi A4 is several MB); bigger ones get `too_large`. |

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
If you chose Block by mistake, open the padlock next to the address, **Site settings**, and allow **Local network access**, then press **Reintentar** (retry) in the panel.

## Printers

The agent prints on the printers Windows knows: **Settings, Bluetooth & devices, Printers & scanners** (or `printmanagement.msc`). Connect
the printer by USB, install it (the manufacturer driver, or the Windows generic one) and check that it appears in the list. If the printer is
shared from another PC, add it as a network printer on this one first.

Because the data is sent **RAW** (the bytes go straight to the printer without any driver processing), the driver does not need to
understand TPCL, TSPL or ZPL. A **Generic / Text Only** driver on the printer's port works fine and is a good choice if the manufacturer
driver misbehaves (for example one that adds page breaks, or tries to render the data as a page). Printers that are offline show
"(sin conexión)", that is "(offline)", in the panel.

## API

All answers are JSON, except the 204 of the preflight. Errors look like `{ "ok": false, "error": "<code>", "message": "<text>" }`. The message is a short text in Spanish, ready to show in the app; branch on `error`, not on the text.

| Request | Answer |
|---|---|
| `GET /health` | `{ "ok": true, "version": "1.0.0", "platform": "win32" }` |
| `GET /printers` | `{ "printers": [{ "name": "...", "isDefault": true, "status": "ready" }] }` (`status`: `ready`, `printing`, `warming-up`, `stopped`, `offline`, `unknown`) |
| `POST /print?printer=<name>&copies=<n>` | The raw bytes as the body (`Content-Type: application/octet-stream`). `{ "ok": true, "bytes": <size of one copy>, "copies": <n> }` |
| `POST /print-image?printer=<name>&widthMm=<mm>&heightMm=<mm>&dpi=<dpi>` (+ optional `offsetXmm`, `offsetYmm`, `copies`, `paper`) | A PNG as the body (`Content-Type: image/png`). `{ "ok": true, "bytes": <PNG size>, "copies": <n> }`. See [Print an image](#print-an-image-through-the-driver) |
| `OPTIONS` (any path) | The CORS preflight: `Access-Control-Allow-Origin` with the exact origin (never `*`), `-Methods`, `-Headers`, `Access-Control-Allow-Private-Network: true`, `Vary: Origin` |

`copies` is 1 to 99 (default 1): the agent repeats the data that many times inside **one** spooler job, so labels with counters increment
per label as if the printer printed them one after another.

| Code | HTTP | When |
|---|---|---|
| `origin_refused` | 403 | The `Origin` is not allowed, or the `Host` header is not `127.0.0.1` / `localhost` |
| `printer_not_found` | 404 | The printer name is not in the Windows list (checked before printing) |
| `too_large` | 413 | The body is over `maxBytes` (`maxImageBytes` for `/print-image`) |
| `bad_request` | 400 | Missing printer, empty body, `copies` not an integer from 1 to 99, or (`/print-image`) a missing or out of range `widthMm`, `heightMm`, `dpi`, `offsetXmm`, `offsetYmm` or `paper` |
| `not_png` | 415 | `/print-image` only: the body does not start with the PNG signature |
| `spooler_error` | 502 | PowerShell or Windows could not list the printers, write the job or print the image (the `detail` field carries the reason) |

## Print an image through the driver

`POST /print-image` prints a PNG with the normal Windows printer driver (`System.Drawing.Printing.PrintDocument`, driven from PowerShell), so it works on
laser and inkjet printers. It prints **what the PNG shows**, not the label code: it does not prove that a TEC / TSC / Zebra accepts the label language.

| Query parameter | Meaning |
|---|---|
| `printer` | Required. An installed printer, resolved like in `/print` (exact name, else case-insensitive). |
| `widthMm`, `heightMm` | Required. Size of the drawing in millimetres, greater than 0 and up to 1000. The image is drawn at exactly this size (100 %), never fitted to the page. |
| `dpi` | Required. The resolution the PNG was rendered at, 72 to 1200. |
| `offsetXmm`, `offsetYmm` | Position of the drawing on the page, -100 to 100 (default 0). Use them to compensate the non printable margins of laser printers. |
| `copies` | 1 to 99 (default 1), the copies of the print job. |
| `paper` | `default` (default): the driver's default paper. `label`: a custom page of `widthMm` x `heightMm`. |

The margins are set to 0 and the origin is the printable area, so a laser printer may clip the edges of the drawing: shift it with the offsets.
Interpolation: when the PNG has at least the printer's resolution (`dpi` >= the printer's dpi) the pixels are copied as they are (nearest neighbour), which keeps
barcode bars sharp; only a PNG with fewer dots than the printer is resampled (high quality bicubic), because nearest neighbour would make uneven bars.
Every value is validated before PowerShell starts; the PNG goes through a temporary file and the other values through environment variables, never inside the command text.
Like `/print`, it has the origin and Host checks, and the log line has the printer, size, dpi and copies but never the image.
The script was dry run against the virtual `Microsoft Print to PDF` printer (printing to a file): it runs without errors and one copy gives one page, two copies two pages. That virtual driver always makes an A4 page, so `paper=label` is only honoured by drivers that accept a custom size.

```bat
curl -X POST --data-binary @label.png -H "Content-Type: image/png" "http://127.0.0.1:9631/print-image?printer=HP%20LaserJet&widthMm=100&heightMm=50&dpi=300&paper=label"
```

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

- **The panel says "Agente no disponible" (agent not available)**: the agent is not running (run the install command again, start it with `start.bat`, or check the task with `Get-ScheduledTask "PrintBridge Agent"`),
  the port or the address in **Agente** is wrong (default `http://127.0.0.1:9631`), or the browser blocked the access: look for the Chrome local network prompt above.
  Open `http://127.0.0.1:9631/health` in the browser: if it answers `{"ok":true,...}` the agent is fine and the problem is the origin or the permission.
  The browser shows a refused origin and a stopped agent in the same way, so check the agent console too.
- **origin_refused / "El agente no permite esta página" (the agent does not allow this page)**: the page's origin is not in `allowedOrigins` (for example the app is served from another address, or opened as a file). Add the origin
  to `config.json` (or `allowFileOrigin`) and restart the agent.
- **printer_not_found**: the name must be exactly as Windows lists it (`GET /printers`). Reload the list with **Reintentar** after installing a printer.
- **"port ... is already in use"**: another copy of the agent (or another program) holds the port. Stop it, or change `port`.
- **The job is accepted but nothing prints**: open the Windows print queue of that printer (the job may be stuck or the printer paused or offline). Make sure the printer is not set to
  "Use printer offline". Try the **Generic / Text Only** driver on the same port. Check that the label language matches the printer (TPCL on a TEC, TSPL on a TSC, ZPL on a Zebra), the label size and the media.
- **Garbage printed instead of the label**: the driver is processing the data instead of sending it RAW; switch to the Generic / Text Only driver.
- **Node not found**: install the LTS version from nodejs.org and open a new terminal so the `PATH` is refreshed.
- **The install command fails to download**: check the network and the proxy of the PC; the script needs HTTPS access to `raw.githubusercontent.com`. Run it with `-Foreground` to see the agent's own messages.
- **"running scripts is disabled"**: this happens only when running a `.ps1` file from a checkout; use `powershell -ExecutionPolicy Bypass -File agent\install.ps1` as shown above. The `irm ... | iex` command is not affected.

## Security notes

- The agent binds to `127.0.0.1` only: it is not reachable from other computers on the network.
- Every request is checked: the `Origin` must be allowed (or absent), and the `Host` header must be `127.0.0.1` or `localhost`, which stops DNS-rebinding attacks (a page on `evil.example` made to resolve to `127.0.0.1`).
- The label data is never logged: the log has one line per job with the time, the printer, the byte count and the copies.
- The printer name and the data never go inside a PowerShell command line: the name travels in an environment variable and the bytes in a temporary file (deleted afterwards). `/print-image` does the same with its numbers.
- There is **no authentication token**. The origin and Host checks already keep other web pages out, and a token stored in a page served from GitHub Pages would be readable by anyone, so it would add no protection. Anything running on this PC as
  you can already print without the agent. If the PC is shared with untrusted users, do not run the agent there.
- The size limit (`maxBytes`, 5 MB by default) bounds memory use; a job is also limited to 100 MB after repeating the copies.
