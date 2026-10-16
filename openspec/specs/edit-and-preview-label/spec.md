# edit-and-preview-label Specification

## Purpose

Baseline spec (current behavior, derived from code on 2026-10-16). The browser app loads, edits, analyzes, and previews printer-language labels in memory. Documentation: `docs/features/edit-and-preview-label.md`. Ticket: none.

## Requirements

### Requirement: Load and edit label source

The system SHALL load label text from the editor, pasted content, dropped or selected files, and examples; typing schedules an edit refresh after 150 ms, while pasted content is opened as a new label. File contents are decoded before being opened (`js/ui.js:288-315`, `js/app.js:574-585`).

#### Scenario: Typing in the editor
- GIVEN label text is present in the editor
- WHEN the user types
- THEN the system SHALL schedule the edit refresh after 150 ms

#### Scenario: Pasting or opening a file
- GIVEN the user pastes text or opens a file through the file control or drag-and-drop
- WHEN the paste or file read completes
- THEN the system SHALL open the resulting text as the current label (`js/ui.js:290-315`)

### Requirement: Detect and analyze the active label language

The system SHALL use a supplied language or detect one from non-empty label text, parse recognized languages, and validate the resulting model; non-empty unrecognized text SHALL produce a diagnostic, while empty or unrecognized text has no active language (`js/app.js:136-150`).

#### Scenario: Recognized label text
- GIVEN the active label is recognized or a language is supplied
- WHEN the app analyzes the text
- THEN the system SHALL parse it and return the model with parser and validator diagnostics (`js/app.js:147-150`)

#### Scenario: Unrecognized or empty label text
- GIVEN the active text is empty or its language is not recognized
- WHEN the app analyzes the text
- THEN the system SHALL use an empty model and report an unrecognized-language diagnostic only for non-empty text (`js/app.js:137-145`)

### Requirement: Refresh the SVG preview and diagnostics

The system SHALL refresh the model, SVG preview, editor-related controls, command help, and Avisos messages from current app state; displayed messages combine supplied notices, label diagnostics, area diagnostics, browser layout findings when a language is active, and drawing diagnostics (`js/app.js:159-184`, `js/drawing.js:38-60`, `js/ui.js:493-501`).

#### Scenario: Successful refresh
- GIVEN the current label can be analyzed and rendered
- WHEN the app refreshes
- THEN the system SHALL render and show its SVG preview and display the collected diagnostics and layout findings (`js/app.js:161-184`)

#### Scenario: Processing exception
- GIVEN analysis or rendering throws during refresh
- WHEN the exception is caught
- THEN the system SHALL show an error in Avisos and leave the preview unchanged by that catch path (`js/app.js:185-188`)

### Requirement: Edit label dimensions and preview settings

The system SHALL show declared or fallback label dimensions, offer language-appropriate size controls, and apply accepted size edits to the label; refresh SHALL consume the current preview options (`js/ui.js:152-180`, `js/ui.js:188-215`, `js/app.js:159-174`, `js/app.js:363-370`).

#### Scenario: Changing a size control
- GIVEN a supported size or valid custom dimensions are selected
- WHEN the user commits the size change
- THEN the system SHALL apply the resolved size and refresh the label (`js/ui.js:188-215`, `js/app.js:363-370`)

#### Scenario: Changing preview options
- GIVEN the user changes a preview option
- WHEN the app refreshes
- THEN the system SHALL render using the current options (`js/app.js:159-174`, `js/app.js:595-597`)

### Requirement: Select and modify preview items

The system SHALL expose properties for the selected model item, clear a selection that no longer maps to an item, and update the editor/model and preview when supported properties are changed (`js/ui.js:391-403`, `js/app.js:202-219`, `js/properties.js:93-116`, `js/properties.js:120-135`).

#### Scenario: Selecting an item
- GIVEN a rendered preview contains a selectable model item
- WHEN the user selects it
- THEN the system SHALL show the properties for the corresponding item (`js/ui.js:391-403`, `js/app.js:202-219`)

#### Scenario: Selection becomes stale
- GIVEN the selected item no longer exists in the current model
- WHEN properties are updated
- THEN the system SHALL clear the selection (`js/app.js:202-208`)

### Requirement: Insert palette components and provide variable test values

The system SHALL allow supported palette components to be inserted through the palette interactions and SHALL use current variable test values when refreshing the preview (`js/palette.js:28-50`, `js/ui.js:417-425`, `js/ui.js:72-89`, `js/app.js:159-164`, `js/app.js:333-360`).

#### Scenario: Inserting a palette component
- GIVEN a component is available for the active language
- WHEN the user activates or drops that component in the editor
- THEN the system SHALL insert it into the label and refresh the preview (`js/palette.js:28-50`, `js/ui.js:417-425`, `js/app.js:333-360`)

#### Scenario: Supplying a variable test value
- GIVEN the active label exposes a variable input
- WHEN the user changes its value
- THEN the system SHALL update the shared value and request a refresh (`js/ui.js:72-89`, `js/app.js:159-164`)

### Requirement: Preview and insert image content

The system SHALL support image controls that load or adjust a preview overlay and SHALL insert image commands into label text when the active language supports image output; image conversion failures SHALL retain the plain picture in the preview and show a diagnostic (`js/components/image/panel.js:14-59`, `js/app.js:521-541`, `js/app.js:548-570`).

#### Scenario: Adjusting the image overlay
- GIVEN an image is loaded in the image controls
- WHEN the user adjusts its placement or conversion settings
- THEN the system SHALL update the preview overlay (`js/components/image/panel.js:14-59`, `js/app.js:521-541`)

#### Scenario: Inserting image content into label code
- GIVEN the active language supports image-writing hooks
- WHEN the user chooses to insert the image into the code
- THEN the system SHALL write the corresponding image command into the label text (`js/app.js:548-570`)

#### Scenario: Image conversion fails
- GIVEN conversion for the preview overlay fails
- WHEN the conversion completes with an error
- THEN the system SHALL keep the plain picture and display a diagnostic (`js/app.js:518-541`)
