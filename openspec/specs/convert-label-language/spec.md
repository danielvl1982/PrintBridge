# convert-label-language Specification

## Purpose

Baseline spec (current behavior, derived from code on 2026-10-16). Convert label text between the registered printer languages and expose the latest successful result for copying or downloading. Documentation: `docs/features/convert-label-language.md`. Ticket: none (internal development).

## Requirements

### Requirement: Offer registered conversion targets

The conversion panel SHALL populate its target selector from registered languages that provide an emitter; the current built-in targets are TPCL, TSPL, and ZPL (`js/core/convert.js:31-32`, `js/core/convert.js:67`, `js/convert-panel.js:38`, `tests/convert.test.js:105-109`).

#### Scenario: Show built-in emitting languages
- GIVEN the conversion panel is created with the built-in language registry
- WHEN the target selector is populated
- THEN the selector SHALL list TPCL, TSPL, and ZPL in registration order (`tests/convert-panel.test.js:272-275`)

### Requirement: Convert detected source text to the selected target

The conversion API SHALL detect the source language unless an explicit `sourceId` is supplied, parse the source with the provided resolution when present, and emit the neutral model through the selected target; the panel SHALL pass its current text, selected target, and resolution without supplying a source ID (`js/core/convert.js:43-56`, `js/convert-panel.js:84-89`).

#### Scenario: Convert between supported languages
- GIVEN non-empty text whose source language is detectable and a registered emitting target
- WHEN conversion runs with a resolution
- THEN the result SHALL contain emitted label text, source and target IDs, target-emitter diagnostics, and source-parser diagnostics separately (`js/core/convert.js:54-64`, `tests/convert.test.js:31-38`, `tests/convert.test.js:53-57`)

#### Scenario: Override automatic source detection through the core API
- GIVEN text and a valid registered source ID
- WHEN the core conversion API receives that `sourceId`
- THEN it SHALL parse using the specified source instead of the detected source (`js/core/convert.js:48-55`, `tests/convert.test.js:59-67`)

### Requirement: Reject invalid conversions in validation order

The conversion API SHALL reject non-string or whitespace-only text with `empty-text`, reject an unknown or non-emitting target with `no-target-emit`, and reject an undetectable or unknown source with `no-source-language`; target validation SHALL occur before source detection (`js/core/convert.js:43-53`, `tests/convert.test.js:69-98`).

#### Scenario: Invalid text is rejected
- GIVEN text is not a non-whitespace string
- WHEN conversion runs
- THEN it SHALL throw an error with code `empty-text` (`js/core/convert.js:43-44`, `tests/convert.test.js:69-76`)

#### Scenario: Invalid target takes precedence over invalid source
- GIVEN the target is unknown and the text has no detectable source language
- WHEN conversion runs
- THEN it SHALL throw `no-target-emit` before source detection (`js/core/convert.js:45-53`, `tests/convert.test.js:87-98`)

#### Scenario: Undetectable or unknown source is rejected
- GIVEN non-empty text has no detectable language, or the supplied `sourceId` is unknown
- WHEN conversion runs with a valid target
- THEN it SHALL throw an error with code `no-source-language` (`js/core/convert.js:48-53`, `tests/convert.test.js:78-85`)

### Requirement: Present successful conversion results and clear failed results

After conversion succeeds, the panel SHALL display the converted text, a source-to-target language summary, and sorted target-emitter diagnostics (or an informational no-diagnostics entry), and enable Copy and Download; after conversion fails, it SHALL clear the current result, output, diagnostics, and note, disable both actions, and show the error message (`js/convert-panel.js:58-82`, `js/convert-panel.js:84-90`).

#### Scenario: Show a successful result
- GIVEN a conversion succeeds
- WHEN the panel renders the result
- THEN it SHALL show the converted text, language summary, sorted diagnostics, and enabled Copy and Download controls (`js/convert-panel.js:58-70`, `tests/convert-panel.test.js:119-132`)

#### Scenario: Clear a prior result after failure
- GIVEN the panel previously displayed a successful result
- WHEN a subsequent conversion fails
- THEN it SHALL show the error and clear the output and diagnostics while disabling Copy and Download (`js/convert-panel.js:73-82`, `tests/convert-panel.test.js:147-170`)

### Requirement: Report lossy latin1 output

When emitted text for a latin1 target contains characters outside latin1, conversion SHALL add a target-emitter diagnostic warning that counts those characters, and downloaded bytes SHALL encode each such character as `?` (`js/core/convert.js:34-41`, `js/core/convert.js:57-64`, `js/core/convert.js:73-81`, `tests/convert.test.js:146-149`, `tests/convert.test.js:173-184`).

#### Scenario: Warn and replace characters outside latin1
- GIVEN conversion output for a latin1 target contains characters above code point 255
- WHEN conversion diagnostics and download bytes are produced
- THEN diagnostics SHALL report the number of such characters and each corresponding byte SHALL be `?` (`tests/convert.test.js:173-179`, `tests/convert.test.js:146-149`)

### Requirement: Copy the latest successful output

The Copy action SHALL copy the output and target from the most recent successful conversion, regardless of a later target-selector change; it SHALL use the Clipboard API when available, fall back to selecting the output and invoking `execCommand('copy')` when unavailable or rejected, and report success or failure (`js/convert-panel.js:53-54`, `js/convert-panel.js:101-109`, `tests/convert-panel.test.js:173-207`).

#### Scenario: Copy through the available clipboard API
- GIVEN a successful conversion and a working Clipboard API
- WHEN Copy is activated
- THEN the panel SHALL write the exact converted output and report success (`js/convert-panel.js:101-109`, `tests/convert-panel.test.js:173-184`)

#### Scenario: Fall back when clipboard access is unavailable or fails
- GIVEN a successful conversion and an unavailable or rejecting Clipboard API
- WHEN Copy is activated
- THEN the panel SHALL attempt selection-based copying and report success, or instruct the user to select the text and use Ctrl+C if that attempt fails (`js/convert-panel.js:93-109`, `tests/convert-panel.test.js:186-207`)

### Requirement: Download the latest successful output with target-specific bytes and filename

The Download action SHALL use the text and target from the most recent successful conversion, encode TPCL and ZPL as UTF-8, encode TSPL as byte-preserving latin1 with out-of-range characters replaced by `?`, and derive the filename from the optional source name's base plus the target extension (defaulting to `etiqueta` when no usable base exists) (`js/convert-panel.js:111-120`, `js/core/convert.js:69-91`, `tests/convert.test.js:112-149`, `tests/convert.test.js:225-231`, `tests/convert-panel.test.js:252-264`).

#### Scenario: Download uses the last conversion after target selection changes
- GIVEN a successful conversion and a subsequent change to the target selector without converting again
- WHEN Download is activated
- THEN the downloaded bytes and extension SHALL correspond to the last successful conversion's target (`js/convert-panel.js:53-54`, `js/convert-panel.js:111-120`, `tests/convert-panel.test.js:252-264`)

#### Scenario: Derive a safe target-specific filename
- GIVEN a source filename with a path and extension
- WHEN the successful output is downloaded
- THEN the download filename SHALL use the source base name and the target language's extension (`js/core/convert.js:85-91`, `tests/convert.test.js:225-228`)

### Requirement: Warn when copied output contains binary image data

The conversion panel SHALL show its binary-output note when successful converted text contains binary image data and hide the note otherwise (`js/convert-panel.js:66-68`, `tests/convert-panel.test.js:209-226`).

#### Scenario: Recommend downloading binary output
- GIVEN a successful conversion contains binary image data
- WHEN the panel displays the result
- THEN it SHALL show the note recommending Download because copying may alter the data (`js/convert-panel.js:66-68`, `tests/convert-panel.test.js:209-226`)
