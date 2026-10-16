# Operations

This section covers the static browser app, the local Windows print agent, and the repository's test workflow. The process identifiers are those in `docs/.work/catalog.json`: F1 (edit and preview, lines 4-30), F2 (convert labels, lines 32-49), F3 (RAW print, lines 51-67), F4 (driver-based image print, lines 68-85), F5 (select a printer, lines 86-103), F6 (the .NET sample client, lines 104-119), and `-` (the health diagnostic, lines 120-128). Each catalog entry has an empty ticket list and `ticket_source: none` (for example, `docs/.work/catalog.json:8-9,108-109`).

## 1. Requirements

| Activity | Requirements | Evidence |
|---|---|---|
| Use the browser app (F1-F2) | A modern browser; the app is static HTML, CSS, and JavaScript, with no build or dependency-install step. | `CONTRIBUTING.md:3-4,14` |
| Run automated tests | Node.js 22 or newer and a shell at the repository root. | `openspec/config.yaml:28-35`; `CONTRIBUTING.md:8-16` |
| Print through the agent (F3-F5) | Windows 10/11, Node.js 18 or newer on `PATH`, and printers installed in Windows. The agent uses Windows PowerShell and the Windows spooler. | `agent/README.md:18-22`; `agent/printbridge-agent.js:367-375` |
| Install the agent remotely | HTTPS access to `raw.githubusercontent.com`; the installer downloads the agent and example configuration. | `agent/README.md:26-34`; `agent/install.ps1:87-105` |
| Run the .NET sample (F6) | The sample targets .NET 10, but is local-only and git-ignored; a fresh clone does not include it. | `openspec/config.yaml:16-20`; `.gitignore:30-31` (question 6 concerns whether it should be versioned) |
| Database, Docker, internal package feeds | Not applicable: the project has no database, container manifest, or package-install step. | `CONTRIBUTING.md:3,22`; `openspec/config.yaml:16-20` |

The agent has no npm dependencies. Its default spooler is Windows-only; the HTTP layer can be exercised on other operating systems with a fake spooler. (`agent/printbridge-agent.js:367-399`; `CONTRIBUTING.md:22`.)

## 2. Build

No build command is required for the browser app or Node agent: open `index.html` with its sibling `css/` and `js/` directories, or run the agent script directly. The repository defines no compile/build step. (`CONTRIBUTING.md:3,14`; `agent/README.md:7-9,79-80`.) The .NET sample is not part of the versioned checkout (question 6).

## 3. Run

### Browser app (F1-F2)

Open `index.html` directly or use the live app at <https://danielvl1982.github.io/PrintBridge/>. A directly opened file has the `null` origin; the agent rejects it by default, so use a local HTTP server or explicitly set `allowFileOrigin` to `true` if printing from a file is required. (`CONTRIBUTING.md:14`; `agent/README.md:95-103`; `agent/printbridge-agent.js:114-125`.) The repository does not prescribe a local server or port.

### Print agent (F3-F5; diagnostic `-`)

Manual foreground start from the repository root:

```powershell
node agent\printbridge-agent.js [--config <file>]
```

On Windows, `agent\start.bat` also starts it in a console but accepts no arguments. The agent binds to `127.0.0.1:9631` by default; use a JSON config file or `--config` to select another port. A configured port must also be entered in the print panel's **Agente** field. (`agent/README.md:77-80,87-90`; `agent/printbridge-agent.js:33-46,596-616`.)

For a background install of the current `main` branch, PowerShell can run:

```powershell
irm https://raw.githubusercontent.com/danielvl1982/PrintBridge/main/agent/install.ps1 | iex
```

Add `-Autostart` by wrapping the downloaded script in a script block as documented in `agent/README.md:38-48`. This registers a hidden per-user Scheduled Task at logon; it does not start before a user logs in. Without `-Autostart`, the installer starts the agent hidden for the current session. Use `-Foreground` to keep it in the current window. (`agent/README.md:24-48,54-61`; `agent/install.ps1:111-145`.)

The default config is `agent/config.json` (git-ignored); copy `agent/config.example.json` to create it. A missing config uses defaults; it is read only at startup, so restart the agent after changes. Alternatively pass `--config <file>`. Invalid JSON or values stop startup with an error. (`agent/README.md:82-93`; `agent/printbridge-agent.js:52-102,596-605`; `agent/config.example.json:1-11`.)

The agent's `GET /health` endpoint returns its version and platform; `GET /printers` returns installed printers. `POST /print` sends RAW label bytes, and `POST /print-image` sends a PNG through the Windows driver. (`agent/printbridge-agent.js:481-503,508-542,545-579`; catalog F3-F5.)

## 4. Test

Run the full test suite from the project root:

```bash
node --test
```

Node.js 22 or newer is required. Do not substitute `node --test tests/`: the repository documents that form as failing on Node 22. (`openspec/config.yaml:28-43`; `CONTRIBUTING.md:8-16`.)

The `node:test` suite includes unit and agent HTTP integration tests. Agent tests use hand-written fake spoolers and do not print to a real printer or require the Windows spooler; the repository has no end-to-end browser/real-printer test layer. (`openspec/config.yaml:28-43`; `CONTRIBUTING.md:22,54-59`.) The current checkout contains 122 `tests/*.test.js` files; treat that as a dated inventory, not a fixed suite contract.

No coverage tool or measured coverage value is available. (`openspec/config.yaml:36-43`.) Real hardware printing remains a manual check; the agent guide says sending a job to a real TEC, TSC, or Zebra printer has not yet been verified (question 2). (`agent/README.md:11-13`.)

## 5. Coverage

Not available: the repository declares no coverage tool, command, or measured value. (`openspec/config.yaml:36-39`.)

## 6. Logs and troubleshooting

The agent writes operational messages to its console (`stdout`/`stderr`); it does not persist log files. A foreground start (`node agent\printbridge-agent.js`, `agent\start.bat`, or installer `-Foreground`) exposes the messages. A hidden background or Scheduled Task instance has no visible console history. (`agent/README.md:54-58,77-80`; `agent/printbridge-agent.js:538-541,570-579,603-616`.)

Successful and failed print jobs log the printer, byte count, copy count, and—for image jobs—dimensions and DPI; the label body/PNG is not logged. Startup errors such as invalid configuration or a port conflict go to stderr. (`agent/printbridge-agent.js:538-541,570-579,603-616`; `agent/README.md:211-215`.) Rejected-origin requests are returned as errors but are not logged by the print-job logging paths (question 5). (`agent/printbridge-agent.js:459-465,538-541,570-579`.)

For a connection problem, first open `http://127.0.0.1:9631/health`; confirm the configured port and print-panel **Agente** address match. For `origin_refused`, check `allowedOrigins` and whether the page was opened from disk. For `printer_not_found`, refresh the printer list and check the Windows printer name. For a port conflict, stop the other agent/process or configure a different port. (`agent/README.md:190-205`; `agent/printbridge-agent.js:481-503,596-616`.)

## 7. Switches, parameters, and limits

The agent configuration is optional; omitted keys use these defaults. Values are defined in code and in the example JSON. (`agent/printbridge-agent.js:40-46,52-79`; `agent/config.example.json:1-11`.)

| Key | Default | Operational effect |
|---|---|---|
| `port` | `9631` | HTTP port on loopback (`127.0.0.1`). Update the print panel's **Agente** address if changed. |
| `allowedOrigins` | `https://danielvl1982.github.io`, `http://localhost`, `http://127.0.0.1` | Browser origins allowed to call the agent; localhost entries without a port allow any port. |
| `allowFileOrigin` | `false` | Allows `null`/`file://` origin when true; this broadens which local pages can request printing. |
| `maxBytes` | 5 MiB | Maximum `/print` request-body size. |
| `maxImageBytes` | 20 MiB | Maximum `/print-image` PNG body size. |

Installer parameters are `-Autostart`, `-Foreground`, `-Uninstall`, `-InstallDir`, `-BaseUrl`, and `-TaskName`; their defaults and effects are in `agent/README.md:50-61` and `agent/install.ps1:20-25`. There are no other feature/job switches or recurring jobs; autostart is the per-user logon task described above. (`agent/install.ps1:117-130`.)

Fixed limits: copies are 1-99; repeated RAW request data is capped at 100 MiB per spooler job; PowerShell calls time out after 60 seconds. Image width/height must be greater than 0 and at most 1000 mm; offsets are -100 to 100 mm; DPI is 72-1200. (`agent/printbridge-agent.js:35-38,265-266,356,511-522`; `agent/README.md:134-135,153-160`.)

## 8. Deployment

The live browser app is associated with `main`, but the repository does not document the exact GitHub Pages publication mechanism or a pre-publication test gate (question 1). (`CONTRIBUTING.md:77-85`.) No CI workflow is listed in the repository's tracked operational files.

The agent installer downloads files from the `main` branch by default; `-BaseUrl` can select a fork or tag. Re-running the installer updates the downloaded agent while preserving the local `config.json`. A deployment/version-pinning policy is not specified (question 3). (`agent/README.md:26-34,54-61`; `agent/install.ps1:18-25,87-105`.)

## 9. Known risks and open questions

| Risk | Operational impact | Open question |
|---|---|---|
| GitHub Pages publication path and gate are undocumented. | The repository does not establish how `main` becomes live or whether tests gate publication. | Q1 |
| Real label-printer sending is unverified. | Validate a sample job on each target printer before relying on production output. | Q2 |
| Installer defaults to executing the script and agent files from `main` without documented version pinning. | A change on `main` affects a later install/update; the user can inspect the script or select a tag/fork with `-BaseUrl`. | Q3 |
| The agent has no authentication token. | The agent checks loopback `Host` and browser `Origin`; this is not a same-user process authentication boundary. Avoid shared PCs with untrusted users. | Q4 |
| Logs are console-only and rejected requests do not appear in print-job logs. | Hidden runs leave no persistent troubleshooting history. | Q5 |
| F6 is listed in the catalog, but the .NET sample is git-ignored. | A clean clone does not contain the sample; its local-only status and SDK requirements need confirmation. | Q6 |
| README says the app stores nothing, while print preferences are persisted in browser storage. | The stated data behavior is inconsistent with the implementation. | Q7 |
| Agent supports Node 18+, while automated tests require Node 22+. | The agent's minimum supported runtime is not the documented test runtime. | Q8 |

Question identifiers refer to the corresponding fragments in `docs/.work/questions/operaciones.md`; the consolidated open-question numbers are assigned during fan-in.
