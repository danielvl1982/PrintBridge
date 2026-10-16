# F2 - Convert labels between TPCL, TSPL, and ZPL

Ticket: sin ticket (internal development)

## Purpose

Convert the current label text from its detected printer language into a selected supported target language. The conversion produces label text and target-emitter fidelity diagnostics; users can copy or download the last successful result. (`js/convert-panel.js:84-90`, `js/core/convert.js:43-64`)

## Trigger / Entry point

- Browser: select a target language and activate Convert in the conversion panel. (`js/convert-panel.js:27-38`, `js/convert-panel.js:123-127`)
- Browser: activate Copy or Download after a successful conversion. (`js/convert-panel.js:123-127`)

## Inputs (payload/config)

- Current label text — supplied by the application through `getText`; conversion rejects non-string or whitespace-only text. (`js/convert-panel.js:24`, `js/convert-panel.js:84-90`, `js/core/convert.js:43-44`)
- Target language — selected target ID populated from registered languages with an `emit` function; supported built-in targets are TPCL, TSPL, and ZPL. (`js/convert-panel.js:38`, `js/core/convert.js:31-32`, `tests/convert.test.js:105-110`, `tests/convert.test.js:217-223`)
- Resolution — supplied by the application as `dpi` for parsing and emitting. (`js/convert-panel.js:84-88`, `js/core/convert.js:43-56`, `tests/convert-panel.test.js:135-145`)
- Source filename — optional; used only to derive the downloaded filename. (`js/convert-panel.js:24`, `js/convert-panel.js:111-120`, `js/core/convert.js:85-91`)

## Steps

1. The panel populates its target selector from the registered emit-capable languages. (`js/convert-panel.js:27-38`)
2. When Convert is activated, the panel reads the current text, selected target, and resolution, then calls the conversion API; it does not pass a source ID, so the API detects the source language. (`js/convert-panel.js:84-90`, `js/core/convert.js:43-55`)
3. The conversion API parses the source into the neutral model and asks the target language to emit it; it returns output text, target-emitter diagnostics, source and target IDs, and source-parser diagnostics separately. (`js/core/convert.js:48-64`)
4. On success, the panel displays the converted text, language summary, and sorted target-emitter diagnostics, and enables Copy and Download. (`js/convert-panel.js:58-71`)
5. Copy writes the last successful output to the Clipboard API, falling back to selecting the output textarea and invoking `execCommand('copy')`; it reports success or failure in the panel. (`js/convert-panel.js:93-108`)
6. Download encodes the last successful output for its target language, derives a filename from the optional source name, and initiates a browser download. (`js/convert-panel.js:111-120`, `js/core/convert.js:69-91`)

## Exit points

| Output | Detail |
|---|---|
| Conversion panel | Displays converted label text, source-to-target summary, and sorted target-emitter diagnostics; source parse diagnostics are returned separately by the API and are not included in this panel list. (`js/convert-panel.js:58-71`, `js/core/convert.js:58-64`) |
| System clipboard | Copies the last successful converted text through the Clipboard API or the textarea-selection fallback. (`js/convert-panel.js:101-108`) |
| Downloaded label file | Writes bytes according to target encoding and uses the target extension; TPCL defaults to UTF-8 `.txt`, TSPL to byte-preserving latin1 `.prn`, and ZPL to UTF-8 `.zpl`. (`js/core/convert.js:69-82`, `js/core/convert.js:85-91`, `tests/convert.test.js:112-117`, `tests/convert.test.js:129-149`, `tests/convert.test.js:225-231`) |

## Business rules

- A conversion requires non-empty text, a registered target that can emit, and a detectable source language; the target is validated before the source. (`js/core/convert.js:43-53`, `tests/convert.test.js:69-98`)
- Source detection can be overridden by `sourceId` through the core API, but the conversion panel uses automatic detection. (`js/core/convert.js:48-53`, `js/convert-panel.js:84-88`, `tests/convert.test.js:59-67`)
- Target fidelity diagnostics come from the target emitter; source parser diagnostics are returned separately. For a latin1 target, characters outside latin1 add a warning and are written as `?` in downloaded bytes. (`js/core/convert.js:34-41`, `js/core/convert.js:57-64`, `js/core/convert.js:73-81`, `tests/convert.test.js:173-184`)
- Copy and Download operate on the most recent successful conversion, not on a newly selected target until Convert runs again. (`js/convert-panel.js:53-54`, `js/convert-panel.js:101-115`, `tests/convert-panel.test.js:252-264`)

## Errors and edge cases

- Empty or non-string source text raises `empty-text`; the panel shows the message, clears output and diagnostics, and disables Copy and Download. (`js/core/convert.js:43-44`, `js/convert-panel.js:73-90`, `tests/convert-panel.test.js:147-170`)
- Unknown or non-emitting target raises `no-target-emit`; the panel displays the error and clears the prior result. (`js/core/convert.js:45-47`, `js/convert-panel.js:73-90`, `tests/convert.test.js:87-98`)
- Undetectable or unknown source raises `no-source-language`; the panel displays the error and clears the prior result. (`js/core/convert.js:48-53`, `js/convert-panel.js:73-90`, `tests/convert-panel.test.js:160-164`)
- If clipboard access is absent or fails, the panel attempts selection-based copying; if that also fails, it instructs the user to select the text and use Ctrl+C. (`js/convert-panel.js:93-108`, `tests/convert-panel.test.js:186-207`)
- A conversion containing binary image data displays a note recommending Download because copying may alter the data. (`js/convert-panel.js:66-68`, `tests/convert-panel.test.js:209-226`)
- A TSPL download maps characters above byte value 255 to `?`; conversion diagnostics warn about such characters before download. (`js/core/convert.js:35-41`, `js/core/convert.js:73-81`, `tests/convert.test.js:146-149`, `tests/convert.test.js:173-184`)

## Where to act

| If changing... | Start at |
|---|---|
| Input validation and conversion errors | `js/core/convert.js` → `run` (`js/core/convert.js:43-56`); panel failure rendering is `js/convert-panel.js` → `showFailure` (`js/convert-panel.js:73-82`). |
| Source detection or target selection | `js/core/convert.js` → `run` and `emitters` (`js/core/convert.js:31-32`, `js/core/convert.js:43-56`); selector population is `js/convert-panel.js` → `createConvertPanel` (`js/convert-panel.js:24-38`). |
| Conversion rules and fidelity diagnostics | `js/core/convert.js` → `run` and `encodingWarning` (`js/core/convert.js:34-64`), then the affected language parser/emitter. |
| Panel output, clipboard, or file download | `js/convert-panel.js` → `showResult`, `copy`, or `download` (`js/convert-panel.js:58-71`, `js/convert-panel.js:101-120`); byte encoding and filename rules are `js/core/convert.js` → `toBytes` and `fileName` (`js/core/convert.js:69-91`). |
| Scheduling or feature configuration | Not applicable: this process is activated through browser panel controls; resolution is passed into conversion by the application. (`js/convert-panel.js:84-88`) |

## Existing tests

- `tests/convert.test.js`: core API, source detection, target support, validation errors, diagnostics separation, encoding, and filename rules. (`tests/convert.test.js:17-19`, `tests/convert.test.js:31-109`, `tests/convert.test.js:112-184`, `tests/convert.test.js:217-245`)
- `tests/convert-panel.test.js`: panel selection and conversion, error handling, clipboard fallback, binary-output note, download behavior, target/source combinations, and DPI propagation. (`tests/convert-panel.test.js:98-207`, `tests/convert-panel.test.js:209-320`, `tests/convert-panel.test.js:322-330`)
- `tests/datamatrix-slice.test.js`: representative TPCL ↔ TSPL conversion behavior and fidelity diagnostics for Data Matrix symbols. (`tests/datamatrix-slice.test.js:387-426`)
- `tests/text-block.test.js`: block-text conversion across TSPL and ZPL, including a lossy TPCL representation warning. (`tests/text-block.test.js:346-367`)

## Coverage / Gaps

- The cited conversion tests cover core errors, the panel's visible conversion/copy/download behavior, all three source/target languages, and representative conversion fidelity cases. (`tests/convert.test.js:31-109`, `tests/convert-panel.test.js:119-207`, `tests/convert-panel.test.js:266-320`, `tests/datamatrix-slice.test.js:392-426`, `tests/text-block.test.js:346-367`)
- No additional feature-specific open question was identified from the inspected implementation and tests.
