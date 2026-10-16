# Configuration

PrintBridge has two independent configuration surfaces: the local print agent (`agent/config.json`, one CLI flag) and the browser app (static `PB.config`, the script manifest and a handful of `localStorage` keys). There are no environment variables, no `appsettings`, no `.env` files and no launch settings. Features that depend on these keys: F5 (startup and config loading), F4 (origin checks), F2 and F3 (size limits), F6 (interactive .NET sample client), F20 (print panel storage), F25 (collapsed panels), F11 and F12 (sizes and examples).

## 1. Keys

### 1.1 Agent: `agent/config.json`

Optional file, git-ignored (`.gitignore:28`), created by copying `agent/config.example.json`. It is read and validated by `loadConfig` / `normalizeConfig` (`agent/printbridge-agent.js:83`, `agent/printbridge-agent.js:53`); the defaults live in `DEFAULT_CONFIG` (`agent/printbridge-agent.js:40`). A missing file gives the defaults; an unreadable file, invalid JSON or a wrong type/value makes the agent print `PrintBridge agent: <message>` and exit with code 1 (`agent/printbridge-agent.js:600-605`).

| Key | Type | Default | Where read | Effect |
|---|---|---|---|---|
| `port` | integer 0-65535 | `9631` | `agent/printbridge-agent.js:57`, used at `agent/printbridge-agent.js:613`; also `agent/install.ps1:39` | TCP port of the listener on `127.0.0.1`. `0` is accepted (OS-chosen port; the log prints the real one, `agent/printbridge-agent.js:614`). `EADDRINUSE` exits with code 1 (`agent/printbridge-agent.js:608`). |
| `allowedOrigins` | array of non-empty strings | `["https://danielvl1982.github.io", "http://localhost", "http://127.0.0.1"]` | `agent/printbridge-agent.js:61`, used at `agent/printbridge-agent.js:119` | Origins allowed to call the agent. The Agent Host/Origin gate runs before route dispatch and applies to every agent route, including F3-F5 and diagnostics (`agent/printbridge-agent.js:459-468`). Entries are trimmed and trailing `/` removed. `http://localhost` / `http://127.0.0.1` without a port match any port; every other entry must match exactly (`agent/printbridge-agent.js:122-124`). A refused origin gets `403 origin_refused` (`agent/printbridge-agent.js:464`). |
| `allowFileOrigin` | boolean | `false` | `agent/printbridge-agent.js:67`, used at `agent/printbridge-agent.js:115` | Accepts the `null` origin (pages opened from `file://`). Strictly boolean; a string fails validation. |
| `maxBytes` | integer >= 1 | `5242880` (5 MiB) | `agent/printbridge-agent.js:71`, used at `agent/printbridge-agent.js:517-518` | Largest `POST /print` body; larger gets `413 too_large`. |
| `maxImageBytes` | integer >= 1 | `20971520` (20 MiB) | `agent/printbridge-agent.js:75`, used at `agent/printbridge-agent.js:553-554` | Largest `POST /print-image` PNG body; larger gets `413 too_large`. |

`agent/config.example.json` lists exactly these five keys with the default values; a test pins it equal to `DEFAULT_CONFIG` (`tests/print-agent-config.test.js:45`). The validated config is also exposed as `server.printbridgeConfig` (`agent/printbridge-agent.js:588`).

Related constants that are not configurable (see section 6): `HOST = '127.0.0.1'` (`agent/printbridge-agent.js:34`), `MAX_COPIES = 99` (`:35`), `MAX_JOB_BYTES = 100 MiB` (`:37`, caps body x copies whatever `maxBytes` says), `POWERSHELL_TIMEOUT_MS = 60000` (`:38`), `VERSION = '1.0.0'` (`:33`).

### 1.2 Agent: command line

| Flag / script | Where read | Effect |
|---|---|---|
| `--config <file>` | `agent/printbridge-agent.js:597-598` | Path of the config file, resolved against the current directory (`path.resolve`). Default: `config.json` next to the agent script (`__dirname`). If `--config` is last (no value) the default is used silently. No other flags exist; unknown arguments are ignored. |
| `agent/start.bat` | `agent/start.bat:11` | Runs `node "%~dp0printbridge-agent.js"` with no arguments, so it always uses the default `config.json`. |
| `agent/install.ps1` parameters | `agent/install.ps1:20-26` (header `:13-18`) | `-Autostart`, `-Foreground`, `-Uninstall`, `-InstallDir` (default `%LOCALAPPDATA%\PrintBridge`, ignored when run from a checkout, `:32-33`), `-TaskName` (default `PrintBridge Agent`), `-BaseUrl` (default the `main` branch raw URL of the GitHub repository). They configure the installer, not the agent. The installer reads only `port` from `config.json` to build the health URL (`agent/install.ps1:37-42`) and never overwrites or deletes `config.json` (`agent/install.ps1:67`). It downloads `printbridge-agent.js` and `config.example.json` (`agent/install.ps1:29`). |

### 1.3 Browser app: `PB.config` (`js/config.js`)

Static, frozen object created at load (`js/config.js:14`); nothing is read from the user. Per its header it is the place to add a standard label size.

| Key | Type | Value | Effect |
|---|---|---|---|
| `sizes` | array of `{ id, name, w, h, p }` | `100x150, 100x100, 100x60, 80x50, 60x40, 50x30, 40x30` mm; `id` = `<w>x<h>`, `p` = `h + 3` mm pitch (`js/config.js:19-21`) | Presets of the Formato select; consumed by `PB.sizes.createCatalog(PB.config.sizes)` (F11). Other sizes are typed as "Personalizado". |
| `fallbackSize` | `{ w: 990, h: 550 }` (0.1 mm) | `js/config.js:24` | Drawing size when the label declares none (`js/core/sizes.js:55`). |
| `capHeightRatio` | number | `0.72` (`js/config.js:27`) | Capital-letter height / font size, used for ink-overlap detection (`js/components/text/layout.js:38`). |
| `resolutions` | `[203, 300]` | `js/config.js:29` | Options of the Resolucion select (`js/app.js:588`) and the default dpi (`resolutions[0]` = 203) of every language parse/emit (e.g. `js/languages/tpcl.js:234`, `js/languages/tspl.js:522`, `js/languages/zpl.js:935`). |

`PB.examples` (`js/config.js:46`) is the second frozen table of the file: nine entries (`blank-tpcl|tspl|zpl`, `template-tpcl|tspl|zpl`, `template-gs1-tpcl|tspl|zpl`) with `id`, `group` (`blank` | `template`), `name`, `language`, `values` and `source`. It feeds the Ejemplo select (F12, `js/ui.js:54`, `js/app.js:580`). The shared test values are `TEMPLATE_VALUES` (`js/config.js:44`).

### 1.4 Browser app: `js/manifest.json`

A JSON array of 99 script paths in load order (`js/manifest.json:1-100`), the single list shared by `index.html` and the test loader: `tests/components-registry.test.js:50` asserts that the `index.html` script order equals it and that every file exists, and `tests/helpers/load.js:16` loads files in this order for the test sandbox. The browser does not fetch the manifest at runtime (inferred from code: no `fetch` of it in `js/`; `index.html` lists the scripts statically). Adding a module means adding it to both `index.html` and this file.

### 1.5 Browser app: `localStorage` keys

All reads and writes are wrapped in `try/catch`; an unavailable or invalid storage only means nothing is remembered. The `storage` object is injectable for tests.

| Key | Values | Default | Where | Effect |
|---|---|---|---|---|
| `printbridge.agentUrl` | http(s) URL, trailing `/` stripped | `http://127.0.0.1:9631` (`DEFAULT_URL`, `js/print-panel.js:28`) | key `:29`, read `:198`, written by `setUrl` `:408` | Agent address of the print panel (F20). Must match the agent `port`. |
| `printbridge.printer` | printer name | none | key `:30`, read `:252`, written `:340`, `:381`, `:413` | Last chosen printer; used only if it is still in the agent's list. |
| `printbridge.printMode` | `raw` \| `image` | `raw` | key `:31`, read `:192`, written `:414` | Etiquetera (RAW) or Driver (image) mode. |
| `printbridge.imageDpi` | `203` \| `300` \| `600` | `300` (`DEFAULT_DPI`, `:39`) | key `:32`, read `:193`, written `:415` | Resolution of the PNG sent to `/print-image`. |
| `printbridge.imagePaper` | `default` \| `label` | `default` | key `:33`, read `:194`, written `:416` | `paper` query of `/print-image`. |
| `printbridge.imageOffsetX`, `printbridge.imageOffsetY` | number as string (valid offset, limit `MAX_OFFSET_MM = 100`, `:37`) | `0` | keys `:34-35`, read `:195-196`, written `:417-418` | `offsetXmm` / `offsetYmm` of `/print-image`. |
| `printbridge.collapsed` | JSON object `{ "<data-collapsible id>": boolean }` | `{}` | `js/collapse.js:16`, read `:18-23`, written `:25-27` | Collapsed state of panels. Ids in `index.html`: `help`, `code`, `convert`, `print`, `variables`, `format`, `view`, `components`, `properties` (F25). |

Invalid stored values fall back to the default through `storedChoice` (`js/print-panel.js:192-196`; fixed by `tests/print-panel-image.test.js:272`). Copies are deliberately not remembered (`js/print-panel.js:12`). The label code itself is not persisted anywhere.

## 2. Hot reload

None. The agent reads `config.json` once in `main` (`agent/printbridge-agent.js:601`) and `normalizeConfig` freezes the result into the server closure (`agent/printbridge-agent.js:442`); there is no file watcher or signal handler. Restart the agent after any edit (also stated in `agent/README.md:84-85`). The installer re-reads `port` on each run (`agent/install.ps1:39`), which is why it stops a running agent before replacing files (`agent/install.ps1:84`). In the browser, `PB.config` is frozen and the print panel reads `localStorage` once when it is created (`js/print-panel.js:192-198`); a page reload is needed to pick up changed storage, while changes made in the UI are written immediately.

## 3. Additional configuration files

- `agent/config.example.json`: the template described in 1.1; copied manually by the user to `agent/config.json`. In an installed copy it sits in `%LOCALAPPDATA%\PrintBridge` next to the agent (`agent/install.ps1:29`, `:33`).
- `js/manifest.json`: see 1.4.
- Precedence for the agent: file given by `--config` > `agent/config.json` next to the script > built-in `DEFAULT_CONFIG`; within a file, a missing key keeps its default (`agent/printbridge-agent.js:56`). There is no merge between several files and no environment override.
- No routing tables, per-printer settings or other config files exist (the printer list comes from the Windows spooler, F1).

## 4. Environments

Not applicable (no environment-specific files or variables): there is a single `config.json` per installation. What changes between deployments is the content of `allowedOrigins` (the deployed site `https://danielvl1982.github.io` versus a local server on `localhost`/`127.0.0.1`) and `allowFileOrigin` for `file://` use (`agent/README.md:95-103`). The only environment variable the agent touches is passed through to PowerShell (`env: { ...process.env, ...env }`, `agent/printbridge-agent.js:348`), not read as configuration.

## 5. Test configuration

- `tests/print-agent-config.test.js` creates temporary `config.json` files (`:11-16`) to test the defaults (`:18`), partial files (`:29`), a full file with BOM and trailing slashes (`:39`), the example file equal to the defaults (`:45`) and invalid files (`:50`).
- Agent server tests inject the config directly through `createServer({ spooler, config })` with a fake spooler (`agent/printbridge-agent.js:7-10`, `:441`), so no file or Windows is needed.
- Print panel tests inject a fake `storage` and `fetch` (`tests/print-panel.test.js`, `tests/print-panel-image.test.js`).
- `tests/helpers/load.js:16` and `tests/components-registry.test.js:50` use `js/manifest.json` as the file order.

## 6. Inconsistencies

Recorded as fragments in `docs/.work/questions/configuracion.md`:

1. Unknown keys in `config.json` are silently ignored (`normalizeConfig` only checks the five known keys, `agent/printbridge-agent.js:53-80`), so a misspelled key (for example `allowedOrigin`) has no effect and no warning.
2. The default agent address is hardcoded in two places that must stay in step with `port`: `DEFAULT_URL` (`js/print-panel.js:28`, also repeated in the `badUrl` text `:55`) and `DEFAULT_CONFIG.port` (`agent/printbridge-agent.js:41`); `agent/install.ps1:37` repeats `9631` a third time.
3. The default `allowedOrigins` list is duplicated in `DEFAULT_CONFIG` and `agent/config.example.json`; only a test keeps them equal (`tests/print-agent-config.test.js:45`).
4. The agent hardcodes `MAX_COPIES = 99` (`agent/printbridge-agent.js:35`) and the print panel hardcodes its own `MAX_COPIES = 99` (`js/print-panel.js:36`); neither is configurable and they are not shared.
5. `MAX_JOB_BYTES` (100 MiB) and `POWERSHELL_TIMEOUT_MS` (60 s) are fixed constants (`agent/printbridge-agent.js:37-38`) with no config key, so a slow printer or a large job cannot be tuned.
6. `start.bat` cannot pass `--config` (it takes no arguments, `agent/start.bat:11`; `agent/README.md:80`), and `install.ps1` reads only `port` from the default `config.json`, ignoring a custom `--config` path used elsewhere.
7. `"port": 0` passes validation (`agent/printbridge-agent.js:58`) but then the installer health URL (`agent/install.ps1:39-42`, where `0` is falsy) and the browser default address would not match the real port.
8. Two display values are hardcoded in the app rather than in `PB.config`: image dpis `[203, 300, 600]` and `MAX_OFFSET_MM = 100` (`js/print-panel.js:37-38`), whereas `PB.config.resolutions` is `[203, 300]` for the preview.
9. `agent/printbridge-agent.js:33` hardcodes `VERSION = '1.0.0'`; no `package.json` or other source of the version was found to keep it in step (inferred from code).

Checklist items marked not applicable: Environments (section 4).
