# PrintBridge documentation

Documentation derived from the current source at commit `0c84339704848a7231d697279b4805f6cc3d04ee`. Code citations use repository-relative paths and line numbers from that commit. Claims not established by the inspected code are identified in [open questions](preguntas-abiertas.md); the machine-readable state is in [.manifest.json](.manifest.json).

## How to use these docs

1. Find the affected entry point or output in the [feature catalog](features/README.md).
2. Open the feature document and its **Where to act** section.
3. Check its current-behavior specification under `openspec/specs/<slug>/spec.md`.
4. Check [open questions](preguntas-abiertas.md) before changing behavior.

## Index

| Document | Scope |
|---|---|
| [Architecture](arquitectura.md) | Browser modules, language and component registries, local agent, flows, security boundaries. |
| [Configuration](configuracion.md) | Agent settings, browser preferences, defaults, and test overrides. |
| [Data](datos.md) | Browser state, temporary print files, spooler interactions, and data contracts. |
| [Local agent API](api.md) | Routes, validation, response bodies, and access checks. |
| [Operations](operaciones.md) | Requirements, run and test commands, deployment and operational risks. |
| [Open questions](preguntas-abiertas.md) | Unresolved inferences and inconsistencies. |
| [Features](features/README.md) | Feature list and entry/output matrices. |
| [TPCL references](referencia-tpcl/README.md) | Local vendor manuals; source material, not implementation authority. |
| [TSPL references](referencia-tspl/README.md) | Local vendor manual; source material, not implementation authority. |
| [ZPL references](referencia-zpl/README.md) | Local vendor manuals; source material, not implementation authority. |

## Features

| ID | Feature | Ticket | Document | Current-behavior spec |
|---|---|---|---|---|
| F1 | Edit and preview printer labels | None (internal development) | [Feature](features/edit-and-preview-label.md) | [Spec](../openspec/specs/edit-and-preview-label/spec.md) |
| F2 | Convert TPCL, TSPL, and ZPL labels | None (internal development) | [Feature](features/convert-label-language.md) | [Spec](../openspec/specs/convert-label-language/spec.md) |
| F3 | Print label-language bytes through the local agent | None (internal development) | [Feature](features/print-raw-label.md) | [Spec](../openspec/specs/print-raw-label/spec.md) |
| F4 | Print the label drawing through the printer driver | None (internal development) | [Feature](features/print-label-image.md) | [Spec](../openspec/specs/print-label-image/spec.md) |
| F5 | List and select an installed printer | None (internal development) | [Feature](features/select-printer.md) | [Spec](../openspec/specs/select-printer/spec.md) |
| F6 | Run the interactive .NET sample printing client | None (internal development) | [Feature](features/dotnet-sample-print-client.md) | [Spec](../openspec/specs/dotnet-sample-print-client/spec.md) |

The F6 sample source is currently git-ignored and exists only in this local workspace; it is not part of a fresh clone (`.gitignore:30-31`). The `GET /health` endpoint is diagnostic and has no feature ID (`agent/printbridge-agent.js:481-484`).

Vendor PDFs remain local-only and are ignored by Git. See the reference indexes for their scopes; do not infer their contents from filenames alone.
