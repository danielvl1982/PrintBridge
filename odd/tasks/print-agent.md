# Print agent (printing from the app)

Status: IMPLEMENTED, NOT VERIFIED ON A REAL PRINTER (started 2026-10-09 on branch `feat/print-agent`; design agreed with the user the same day). Create the Engram mirror
`odd/print-agent/tasks` before the first write. Until now the optional backlog only mentioned a "local print agent" without a document.

## Objective
Print the label code from the app, without leaving it: an **Imprimir** button that sends exactly the bytes of the current file to a printer.
The browser cannot talk to a USB printer in RAW mode by itself, so a small local agent does it.

## Agreed design (2026-10-09)
- The user's printers (TEC, TSC, Zebra) are connected by USB and are always shared in Windows.
- A single-file Node agent, `agent/printbridge-agent.js`: no dependencies, Windows only, no install. It listens on `127.0.0.1`, lists the
  Windows printers and sends raw bytes to one of them through the spooler as RAW data (PowerShell with winspool calls embedded in the script).
  It is started from a `.bat` or at login.
- In the app: an **Imprimir** button with a printer selector and a number of copies. It sends exactly the bytes of the file, including the
  TSPL `BITMAP` bytes (the same bytes as Descargar), and falls back to the download when the agent does not answer.
- Security: bind to `127.0.0.1` only; accept requests only from the deployed site origin and from localhost; a size limit on the body.
  Chrome may ask for a local network access permission the first time (Private Network Access).
- The real test is on the user's printers (TEC, TSC, Zebra).

## Decisions taken when starting (2026-10-09; the user delegated them, open for review)
- Deployed site: https://danielvl1982.github.io/PrintBridge/ (GitHub Pages, main branch, HTTPS): its origin `https://danielvl1982.github.io` is allowed by default, plus `http://localhost` / `http://127.0.0.1` (any port). `file://` (origin `null`) is refused by default and enabled by a config flag (`allowFileOrigin`), documented with its risk.
- Agent stays Node (no dependencies; Node LTS is a documented prerequisite), default port 9631, configurable in `agent/config.json` (copy of `config.example.json`).
- Copies: the agent sends the data N times inside ONE spooler job (labels with counters increment per label, as when the printer prints them one after another); the app does not touch the label quantity commands.
- Autostart: `agent/install.ps1` registers a Scheduled Task at logon for the current user (hidden window, no admin); `agent/uninstall.ps1` removes it; `agent/start.bat` runs it by hand.
- The agent URL is stored in the browser (localStorage, default `http://127.0.0.1:9631`) and can be changed in the Impresión panel.

## Tasks
- [x] A1 Agent: `agent/printbridge-agent.js` (Node, no dependencies): HTTP server on 127.0.0.1 (port to choose), `GET` printers (the Windows
      printers, through PowerShell), `POST` print (printer name, raw bytes, copies) that writes RAW to the spooler through winspool
      (`OpenPrinter`, `StartDocPrinter` with the `RAW` data type, `WritePrinter`) from PowerShell inside the script; the printer list and the
      spooler call behind a small interface so the tests can replace them.
- [x] A2 Protocol and CORS / private network access: request and response shapes (binary body, JSON for the list and the errors), the allowed
      origins (deployed site and localhost), the `Access-Control-Allow-*` and `Access-Control-Allow-Private-Network` headers and the preflight,
      the size limit, error codes (printer missing, spooler error, too large, origin refused).
- [x] A3 UI: the **Imprimir** button, the printer selector (loaded from the agent) and the copies field in the app; sends the exact bytes of the
      file (TSPL BITMAP bytes included, as the download writes them); when the agent does not answer, say so and offer the download instead;
      remember the last printer; the texts stay Spanish.
- [x] A4 Tests with a fake spooler: the agent against the replaceable printer interface (list, print, copies, size limit, origin check, preflight,
      byte-exact payload including bytes 0x0D / 0x00); the UI client against a fake fetch (agent down, refused, success).
- [x] A5 README and how to run: the `.bat` launcher, autostart at login, the port, the allowed origin, the permission prompt of Chrome, the
      security notes (127.0.0.1, origin check) and that it only runs on Windows; a printer check on the user's TEC, TSC and Zebra.

## Acceptance
With the agent running, **Imprimir** lists the Windows printers, sends the file byte-exact to the chosen one and the label prints; with the
agent stopped, the button reports it and the download still works; requests from another origin are refused; `node --test` stays green.

## Open questions for the user (ask when starting)
- The URL of the deployed site, for the allowed origin (and whether to allow `file://`, since the app also runs by double-clicking `index.html`).
- Copies: send the data N times (N spooler jobs or one job with the data repeated) or use the label counters (`PQ`, `PRINT n`, `^PQ`)? What
  happens with labels that have serial counters.
- Autostart: a shortcut in the Windows Startup folder, a scheduled task at login, or only the `.bat` started by hand.

## Progress (2026-10-09)
Route: one writer, direct (the work was one coherent feature in new files plus small wiring edits). Tests were written together with the code; the
agent and panel tests passed on their first run, so no RED was observed (new files, no earlier behaviour to break).
- A1 + A2 + the agent half of A4: `7b582c4` feat(agent): `agent/printbridge-agent.js` (HTTP on 127.0.0.1:9631, spooler interface, PowerShell/winspool spooler, config, CORS / origin / Host checks, preflight with Private-Network, error codes, size limit, copies in one job), `agent/config.example.json`, `tests/print-agent.test.js` (26 tests) and `tests/print-agent-config.test.js` (12 tests; one is skipped on Windows and one on other OSes).
- A5 scripts: `40de769` `agent/install.ps1`, `agent/uninstall.ps1`, `agent/start.bat` (both .ps1 files were checked to parse with the PowerShell parser; they were never run).
- A3 + the panel half of A4: `a445afb` `js/print-panel.js`, `index.html` (section `#print`, collapsible, under Convertir), `js/manifest.json`, `js/app.js` (`labelBytes`), `css/viewer.css`, `tests/print-panel.test.js` (24 tests, fake DOM + fake fetch + fake storage; includes the index.html / manifest sync).
- A5 docs: `b0b99c9` and the commit that holds this section: `agent/README.md`, `README.md` ("Printing from the app", files table), `CONTRIBUTING.md`.
- `node --test`: 3957 tests, 3956 pass, 0 fail, 1 skipped (the "other OS" spooler test, skipped on Windows).

### Verified for real on this Windows machine
- `node agent/printbridge-agent.js --config <file>` on a spare port: `/health` answers, `/printers` lists the real PowerShell result (10 printers, the default one flagged), an `Origin: https://evil.example` request gets 403, `POST /print?printer=NoExiste` gets `printer_not_found`. No job was sent to any real printer.
- Chrome (puppeteer-core, outside the repo) on the app opened from `file://` with the agent started in-process with a fake spooler: refused origin shows "Agente no disponible" with the help text; with `allowFileOrigin` the panel shows "Agente conectado v1.0.0", the printers with the default preselected, a print of 2 copies reaches the spooler as 982 bytes (2 x the 491-byte editor text), the chosen printer is remembered after a reload, and Reintentar after stopping the agent shows it down again. No page errors (only the expected failed-fetch console lines).

### Could not be verified
- Any real RAW job on the TEC, TSC and Zebra printers (winspool `OpenPrinter` .. `WritePrinter` path, TSPL BITMAP bytes on paper, copies with counters). The PowerShell print script only has a parse check.
- The Scheduled Task created by `install.ps1`, `uninstall.ps1` and `start.bat`.
- The Chrome local network access prompt on the deployed HTTPS page (the preflight headers are tested, the prompt itself is browser behaviour).

### Decisions taken without the user
- **What Imprimir sends:** the editor text in its own detected language through `PB.convert.toBytes` (the same encoding Descargar uses: UTF-8, or latin1 with the TSPL CR placeholder written back as 0x0D). It does NOT run the Convertir step first, so `#NAME#` variables and the text are sent as written, not normalised by the language emitter. An empty or unrecognised label is reported in the panel and nothing is sent.
- **Extra error codes** `not_found` (404) and `method_not_allowed` (405) for unknown routes; a `detail` field on spooler errors; a wrong or missing `Host` header answers `origin_refused` 403.
- **`bytes` in the print answer** is the size of one copy, not of the repeated job. A job is also capped at 100 MB after repeating the copies.
- **Printer matching:** exact name, else case-insensitive (Windows names are case-insensitive); the real name is what is passed to the spooler.
- **PowerShell** runs with `-EncodedCommand` (no quoting problems); the printer name and the temp file travel in environment variables. The listing uses `Get-CimInstance Win32_Printer` and wraps it in an array so one or zero printers still give a JSON array.
- **Panel** is expanded by default (not collapsed like Variables) and sits under Convertir; it checks the agent when the page loads. The help link points to the agent README on GitHub (`danielvl1982/PrintBridge`, main).
- `agent/config.json` is git-ignored (a local copy of the example); `--config <file>` was added to the agent to run it on another port without touching it.
- The browser cannot tell a stopped agent from a refused origin (the CORS failure looks like a network error), so the panel's down message names both and the Chrome permission.
