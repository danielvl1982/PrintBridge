# Print agent (printing from the app)

Status: IN PROGRESS (started 2026-10-09 on branch `feat/print-agent`; design agreed with the user the same day). Create the Engram mirror
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
- [ ] A1 Agent: `agent/printbridge-agent.js` (Node, no dependencies): HTTP server on 127.0.0.1 (port to choose), `GET` printers (the Windows
      printers, through PowerShell), `POST` print (printer name, raw bytes, copies) that writes RAW to the spooler through winspool
      (`OpenPrinter`, `StartDocPrinter` with the `RAW` data type, `WritePrinter`) from PowerShell inside the script; the printer list and the
      spooler call behind a small interface so the tests can replace them.
- [ ] A2 Protocol and CORS / private network access: request and response shapes (binary body, JSON for the list and the errors), the allowed
      origins (deployed site and localhost), the `Access-Control-Allow-*` and `Access-Control-Allow-Private-Network` headers and the preflight,
      the size limit, error codes (printer missing, spooler error, too large, origin refused).
- [ ] A3 UI: the **Imprimir** button, the printer selector (loaded from the agent) and the copies field in the app; sends the exact bytes of the
      file (TSPL BITMAP bytes included, as the download writes them); when the agent does not answer, say so and offer the download instead;
      remember the last printer; the texts stay Spanish.
- [ ] A4 Tests with a fake spooler: the agent against the replaceable printer interface (list, print, copies, size limit, origin check, preflight,
      byte-exact payload including bytes 0x0D / 0x00); the UI client against a fake fetch (agent down, refused, success).
- [ ] A5 README and how to run: the `.bat` launcher, autostart at login, the port, the allowed origin, the permission prompt of Chrome, the
      security notes (127.0.0.1, origin check) and that it only runs on Windows; a printer check on the user's TEC, TSC and Zebra.

## Acceptance
With the agent running, **Imprimir** lists the Windows printers, sends the file byte-exact to the chosen one and the label prints; with the
agent stopped, the button reports it and the download still works; requests from another origin are refused; `node --test` stays green.

## Open questions for the user (ask when starting)
- The URL of the deployed site, for the allowed origin (and whether to allow `file://`, since the app also runs by double-clicking `index.html`).
- Copies: send the data N times (N spooler jobs or one job with the data repeated) or use the label counters (`PQ`, `PRINT n`, `^PQ`)? What
  happens with labels that have serial counters.
- Autostart: a shortcut in the Windows Startup folder, a scheduled task at login, or only the `.bat` started by hand.
