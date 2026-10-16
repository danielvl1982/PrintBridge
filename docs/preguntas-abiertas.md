# Open questions

Questions that cannot be confirmed from the inspected code and documented inconsistencies. Keep inferred statements marked as inferred until answered. Numbering is global and stable; resolved items remain in place.

## Business and data

2. **Ownership and configurability of print limits** (`agent/printbridge-agent.js:35-38`; `js/print-panel.js:36`). Who owns the limits of 99 copies, 100 MiB per repeated job, and a 60-second PowerShell timeout, and should any be configurable? Impact: These bounds cannot be changed through agent configuration, unlike `maxBytes` and `maxImageBytes`.

3. **Confirm the absence of an application-owned database** (`docs/datos.md:14-18`; `agent/printbridge-agent.js:40-46`; `agent/printbridge-agent.js:82-100`; `js/print-panel.js:132-139`). Can the project owner confirm that there is no separately provisioned application database or schema outside this repository? Impact: The data section infers the absence of an application-owned database from the inspected implementation; an external schema would change the store inventory, read/write matrix, and schema comparison.

## Technical

4. **Browser-level coverage for layout and pointer interactions** (`tests/drawing.test.js:5-6`; `js/ui.js:391-403`). Should browser-level tests be added for DOM-dependent layout and preview selection interactions? Impact: The Node drawing tests do not establish these browser-only behaviors, so regressions in them may not be detected by the current suite.

5. **Focused tests for the local .NET sample client** (`dotnet/PrintBridge.Sample/Program.cs:7-43`; `dotnet/PrintBridge.Sample/PrintBridgeClient.cs:21-52`; `dotnet/PrintBridge.Sample/PrintBridge.Sample.csproj:1-10`). Should this local-only sample receive focused tests for its console choices, request construction, and error/exit-code handling? Impact: The current checkout contains no .NET test project for the ignored sample, so its user interaction and HTTP-client behavior are not directly pinned by automated tests.

6. **Vendored qrcode-generator version and licence** (`js/lib/qrcode-generator.min.js:1`). Which upstream version and licence does this file use? Impact: The library version and licence cannot be documented or audited.

7. **Node.js runtime and test minimums** (`agent/README.md:18-22`; `agent/install.ps1:72-80`; `openspec/config.yaml:28-35`). Is it intentional that the agent supports Node.js 18 while the test suite requires Node.js 22, or should the supported test/runtime matrix be clarified? Impact: The minimum agent runtime is not the runtime on which the repository requires its automated tests to run.

8. **CI and test execution outside the repository** (`CONTRIBUTING.md:77-85`). Is there an external CI or coverage process beyond the documented local `node --test` workflow, and who owns it? Impact: The repository documentation describes the local test command and publication workflow but does not establish any external CI or coverage process.

9. **Verification on physical label printers** (`agent/README.md:11-13`; `agent/printbridge-agent.js:367-399`). Has a job been sent successfully through the agent to each supported TEC, TSC, and Zebra printer, and which printer/driver combinations were checked? Impact: Automated tests use a fake spooler and do not establish that hardware output is correct.

10. **Agent diagnostics retention** (`agent/printbridge-agent.js:459-465`; `agent/printbridge-agent.js:538-541`; `agent/printbridge-agent.js:570-579`; `agent/install.ps1:123`). Is console-only logging sufficient, or should logs persist or include refused-origin and other rejected-request details? Impact: Hidden Scheduled Task runs have no retained history, and rejected requests do not enter the print-job logging paths, making failures difficult to diagnose.

11. **Browser preference format versioning** (`js/print-panel.js:190-196`; `js/collapse.js:18-27`). Should browser preferences gain a version or migration policy if a stored key changes meaning? Impact: A future format change cannot distinguish stale values from malformed values; current print settings silently fall back to defaults.

12. **Concurrent updates to collapsible-panel state** (`js/collapse.js:18-27`). Is last-writer-wins behavior acceptable when multiple tabs change panel state concurrently? Impact: Concurrent toggles may overwrite another tab's updates because each toggle rewrites the full object.

13. **Cleanup of temporary print files after abrupt termination** (`agent/printbridge-agent.js:380-396`). Should agent startup clean up stale `printbridge-*.bin` and `printbridge-*.png` files? Impact: Process termination before the `finally` cleanup may leave label data in the system temporary directory.

14. **PNG validation beyond the signature** (`agent/printbridge-agent.js:269-271`; `agent/printbridge-agent.js:558`). Is a truncated or corrupt PNG expected to fail later in PowerShell as 502 `spooler_error`? Impact: The 415 `not_png` code does not cover undecodable images (inferred from code).


15. **Script-order synchronization** (`index.html:106`; `tests/helpers/load.js:3`). Is the sync test the only guard against `index.html` and `js/manifest.json` diverging? Impact: A missed edit breaks the page at load time (`PB` may be undefined) without a build error.

## Security

16. **Authentication for local-agent requests** (`agent/printbridge-agent.js:114-133`; `agent/printbridge-agent.js:459-465`; `agent/README.md:207-214`). Are loopback `Host` and browser `Origin` checks sufficient for the intended workstation threat model, particularly on shared PCs or when `allowFileOrigin` is enabled, or is a shared token required? Impact: The agent has no authentication token, and requests without an `Origin` header are not rejected by the origin check; any local process may list printers and submit jobs.

17. **Installer source pinning and integrity verification** (`agent/install.ps1:8-26`; `agent/install.ps1:87-105`). Is downloading and updating the agent from mutable `main` without a documented checksum or version pin the intended deployment policy? Impact: A compromised or unintended change on the configured source could be executed on user machines with the user's rights.

18. **Audit of `innerHTML` inputs** (`js/drawing.js:135`; `js/ui.js:81`; `js/ui.js:497`). Are all `innerHTML` inputs generated by the app and never raw label text? Impact: Label text pasted from outside could inject markup if it reaches `innerHTML` unescaped.

19. **Permissions on temporary print files** (`agent/printbridge-agent.js:380-396`). Are the platform-default permissions on temporary print files acceptable for this deployment? Impact: A local process with access to the same temporary directory may read label bytes while a job is being processed.

## Inconsistencies

20. **Default port duplicated across the agent, page, and installer** (`agent/printbridge-agent.js:41`; `js/print-panel.js:28`; `agent/install.ps1:37`). Is a single source for port `9631` desired, or is the duplication accepted because the browser and installer cannot read the agent config? Impact: Changing the default port requires editing three files; a custom port needs the Agent field changed by hand in each browser.

21. **Agent configuration silently ignores unknown keys** (`agent/printbridge-agent.js:53-80`). Should the agent warn or fail on unknown keys, such as a typo like `allowedOrigin`? Impact: A misspelled key has no effect and the user gets no feedback; the default stays in force.

22. **Version and allowed-origin defaults are duplicated** (`agent/printbridge-agent.js:33`; `agent/printbridge-agent.js:42`; `agent/config.example.json:3-7`; `tests/print-agent-config.test.js:45`). Who updates `VERSION`, and should `DEFAULT_CONFIG` remain duplicated in `config.example.json` with the test as its drift guard? Impact: The default copies can drift, and the version shown in the panel may not match the installed files.

23. **Copy limit duplicated between the agent and print panel** (`agent/printbridge-agent.js:35`; `js/print-panel.js:36`; `js/print-panel.js:113`). Should the agent be the single source of the 99-copy limit, expose it to the page (for example in `/health`), or make it configurable? Impact: Changing one side only can make valid requests fail or be refused.

24. **Job-size cap and PowerShell timeout are not configurable** (`agent/printbridge-agent.js:37-38`). Are 100 MiB per job and 60 seconds per PowerShell call adequate for the target printers and spooler load? Impact: Slow printers or large multi-copy jobs fail with `spooler_error` or `too_large` and cannot be tuned without editing code.

25. **Launcher and installer handling of a custom `--config` path** (`agent/start.bat:11`; `agent/install.ps1:38-42`; `agent/printbridge-agent.js:597-598`). Is running with `--config` intended only for manual `node` use? Impact: A custom config file is ignored by the launcher and installer health URL, which read only the default `config.json` port.

26. **Port zero is accepted but not usable by the installer or app** (`agent/printbridge-agent.js:58`; `agent/install.ps1:40`). Is port `0` (ephemeral port) supported, or should validation require `1-65535`? Impact: With port `0`, the agent listens on a random port that neither the installer health check nor the stored agent URL knows.

27. **Image DPI values and offset limits outside `PB.config`** (`js/print-panel.js:37-38`; `js/config.js:29`). Should image print resolutions (`203`, `300`, `600`) live in `PB.config` next to the label resolutions (`203`, `300`)? Impact: Two lists of resolutions with different contents exist in different places.

28. **Application storage statement conflicts with browser persistence** (`README.md:17-19`; `js/print-panel.js:28-35`; `js/collapse.js:14-27`). Should the README disclose that print-panel preferences and collapsed sections are remembered in browser `localStorage`? Impact: The current statement that the app stores nothing conflicts with persistent browser preferences and may mislead users assessing data retention.

29. **The .NET sample is cataloged but git-ignored** ? Resolved (October 2026): The .NET sample is intentionally local-only and is not to be versioned. (user) Evidence: `docs/.manifest.json:145-154`; `openspec/config.yaml:16-20`; `.gitignore:30-31`; `dotnet/PrintBridge.Sample/PrintBridge.Sample.csproj:1-10`.

30. **GitHub Pages publication process and ownership** (`CONTRIBUTING.md:77-85`). Is the live app published directly from `main`, and is any test run or approval required before publication? Who owns that process? Impact: Operations cannot identify the publication trigger or a release gate from repository documentation.

31. **Agent `Content-Type` validation for `/print`** (`agent/printbridge-agent.js:15`; `agent/printbridge-agent.js:508-521`). Should the agent reject content types other than `application/octet-stream`, or is the header comment only a recommendation? Impact: Documentation and clients may assume a validation that does not exist.

32. **Optional `detail` field in agent error responses** (`agent/printbridge-agent.js:18`; `agent/printbridge-agent.js:455`). Should `detail` be part of the documented contract, alongside the Spanish `message` field? Impact: Clients may ignore or misparse the extra field, and the error object mixes two languages.

33. **Unexpected handler exceptions use `spooler_error`** (`agent/printbridge-agent.js:582-586`). Is a generic internal-error code wanted instead of reusing `spooler_error`? Impact: Non-printing bugs are mislabeled as spooler failures.

34. **`GET /printers` success response omits `ok`** (`agent/printbridge-agent.js:483-489`). Is the missing `ok` field intentional, as the header comment documents? Impact: Clients that test `body.ok` uniformly will treat a valid `/printers` response as a failure.

35. **TPCL P5 field-width limits differ between legacy references** (`docs/referencia-tpcl/README.md:9-12`; `docs/referencia-tpcl/README.md:3`). Confirm which TPCL P5 field-width maximum applies to each supported printer/model and identify the authoritative manual section/page. Impact: The reported comparison gives a 1040 maximum in English references and 1057 in a Spanish reference; applying the wrong model-specific limit can reject valid fields or emit unsupported commands. Exact PDF page locators remain unverified because local PDF extraction could not run.

## Resolved during documentation

1. ~~**API endpoint feature IDs did not match the catalog**~~ Resolved (October 2026): aligned the API section with catalog IDs `-`, F3, F4, and F5 (`docs/api.md:5`).
