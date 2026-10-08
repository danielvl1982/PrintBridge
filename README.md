# PrintBridge

Tool to see how a label (TPCL for TEC/Toshiba printers, TSPL for TSC TTP printers) looks **without printing it**, while it is being created or
modified. It warns about overlapping texts, items that go outside the label and wrong measures.

**Live app: <https://danielvl1982.github.io/PrintBridge/>**

(Formerly "Visor etiquetas bobinas TEC".) The code and technical docs are in English; the on-screen text is in Spanish, so the
UI labels below are quoted exactly as they appear.

Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md). The development plan and its progress live in
[`odd/tasks/multi-printer-language-support.md`](odd/tasks/multi-printer-language-support.md).

## How to open it

Use the [live app](https://danielvl1982.github.io/PrintBridge/), or double-click **`index.html`** to run it locally. It opens in
the browser, nothing needs to be installed and it works without internet. It stores nothing: every time it is opened it starts
from scratch with the example label.

**Always copy the whole folder**: `index.html` needs the `css` and `js` folders next to it.

| File | Contains |
|---|---|
| `index.html` | The page structure |
| `css/viewer.css` | Look of the page: toolbars, panels and messages |
| `css/label.css` | Look of the label drawing: colors, grid and typefaces |
| `js/config.js` | Known label sizes and the example label |
| `js/manifest.json` | Ordered list of every script (same order as `index.html`; the tests load from it) |
| `js/core/` | Part common to all languages, one file per module: diagnostics, units, sources, variables, language registry, validation and sizes |
| `js/core/emit.js` | Shared helpers of the emitters (dots, escaping, id numbering, diagnostics) and the driver that calls each item's slice `emit` |
| `js/core/convert.js` | `PB.convert`: the pure part of "Convertir a…" (`run`, `targets`, `toBytes`, `fileName`) on top of the language registry |
| `js/components/registry.js` | `PB.components`: the registry where each label component registers itself |
| `js/components/<name>/` | One folder per component (`text`, `barcode`, `qr`, `line`, `box`, `image`) with its encoders and constants, drawing, parsing, building, moving, editing and validation |
| `js/components/<name>/tpcl.js`, `js/components/<name>/tspl.js` | The pieces of that component for one language: TPCL and TSPL both read, build (palette), move and edit (`line/tspl.js` is `BAR`, `box/tspl.js` is `BOX`) |
| `js/components/compose.js` | `PB.composeSlices`: builds a language's handler table from the slices that registered for it |
| `js/languages/tpcl.js` | TPCL reading and writing (fonts and commands of the TEC/Toshiba printers; the language `emit` hook writes header, items and trailer) |
| `js/languages/tspl.js` | TSPL reading and writing (tokenizer, label setup commands, language registration and the `emit` hook; the drawing commands come from the component slices) |
| `js/view.js` | Preview rotation (pure coordinate mapping) |
| `js/drawing.js` | Label drawing and overlap detection |
| `js/ui.js` | Screen panels |
| `js/convert-panel.js` | The "Convertir a…" panel (target, output, fidelity warnings, Copiar, Descargar) |
| `js/app.js` | Startup: connects the panels with the logic |
| `js/lib/` | External QR library (qrcode-generator, MIT license) |
| `tests/` | Automated tests (`node --test` from the project root) |

All modules share the global namespace `PrintBridge`. To add a fixed size or a new example, only `js/config.js` needs to be touched.

## Loading a label

Any of these ways:

- Paste the label content into the **Código de etiqueta** box.
- Drag the file (`.ter`, `.txt`, `.zpl`, `.prn`, `.tspl` or `.tpcl`) onto that box.
- **Abrir archivo…** button.
- **Ejemplo** combo: choosing an entry loads the reference 99×55 spool label with sample data, a barcode example (TPCL) or a 100×60 TSPL label.

The drawing updates immediately while typing in the code, so coordinates and sizes can be tried directly.

## Screen

### Top bar

| Option | What it is for |
|---|---|
| **Resolución** | 203 or 300 dpi, depending on the printer. It changes the real size of the QR, of the barcode and the line thickness. |
| **Escala texto** | If in the real print the letters come out larger or smaller than in the viewer, adjust this % until they match. |
| **Giro** | Rotates the preview 0°, 90°, 180° or 270° clockwise (useful for long labels). Visual only: it does not change the label and the cursor coordinates remain those of the label. |
| **Rejilla** | Lines every 10 mm with their coordinate. |
| **Puntos origen** | Blue dot at the x,y coordinate of each item (for texts it is the bottom left corner). |
| **Marcar solapas** | Paints in red the areas where two items overlap. |

### Formato

The row is a view of the label: **Ancho**, **Alto** and **Paso** (mm) always show the size the label declares, and the drawing always
follows it. If the label declares no size, the fields show 99×55 mm and a warning says so.

| Control | What it does |
|---|---|
| **Tamaño etiqueta** | Standard sizes (mm, **Paso** = height + 3): 100×150, 100×100, 100×60, 80×50, 60×40, 50×30 and 40×30. Picking one writes it to the label. It marks the standard equal to the declared size, or **Personalizado…** if there is none. |
| **Ancho / Alto / Paso** | Edit one and leave the field to write the size to the label (in TPCL, the `{D…|}` command and an existing `{AX…|}` is left untouched; in TSPL, `SIZE` and, when **Paso** is larger than **Alto**, `GAP` = Paso − Alto, an existing `GAP` is kept if Paso equals Alto). An empty **Paso** means the height. A zero, negative or invalid value goes back to the label's value. |

- **Paso:** distance between the start of one label and the next (height + gap between labels).

### Imagen

Overlays a picture on the preview to check where it would go. Until you insert it, it is visual only: it is not written into the label code. Only one preview image exists at a time (adding another replaces it). Its controls live in the **Propiedades** panel (shown when the image is selected, or when nothing is selected and an image exists).

- **Imagen (paleta):** the component palette has an **Imagen** entry (when the label language can insert images); the chosen file replaces the previous image and is drawn at its natural pixel size for the selected **Resolución**. Click it (or press Enter) to pick a file and place it at the default point; dragging it onto the label only works if the browser allows opening the file picker from a drop, otherwise click the entry.
- **Posición X / Posición Y:** top left corner of the image, in mm from the label origin.
- **Ancho:** optional width in mm (empty = natural size); the height keeps the proportion.
- **Umbral:** slider 0-100 % (default 50 %), enabled with the image. A dot is black when its luminance is below the
  threshold: raise it to thicken thin lines, lower it to drop light gray background. While an image is loaded, the
  preview shows the converted black and white result (the same dots that get inserted), so you see the effect of the
  threshold, the width and the resolution before inserting. If the conversion fails, the plain picture is shown with an error.
- **Insertar en el código:** converts the picture to black and white and writes it into the label code as a TPCL
  `{SG;xxxx,yyyy,wwww,hhhh,0,<data>|}` command, placed before `{XS;…|}` (or at the end if there is none). Then the
  preview image is removed and the picture is drawn from the code, so it survives editing and reloading.
  - Conversion: the picture is resampled to the width in dots (width in mm at the selected **Resolución**; empty = natural
    pixels), shrinking in successive halves (each step at most 2:1, high-quality smoothing) so thin lines survive;
    transparency is composited over white and the **Umbral** luminance threshold decides black. No dithering: it is meant
    for logos and line art, not photographs.
  - Tips: prefer PNG over JPG (JPG artifacts turn into stray dots); use a source with at least as many pixels as the
    target dots (e.g. about 400 px wide for 50 mm at 203 dpi), because enlarging blurs the edges before the threshold.
  - Format: x/y in 0.1 mm, width/height in printer dots, mode `0` (overwrite), data in **nibble** form (4 dots per
    character `0`..`?`, rows padded to a multiple of 8 dots). The viewer also reads mode `4` (OR) and `x`/`y` in dots
    (`D` suffix); other SG data modes (hex, BMP, PCX, TOPIX) are reported and not drawn. Width and height are limited to 9999 dots.
  - **Not verified on a printer:** the SG layout comes from the Toshiba B-SX4T manual, not from a B-EX4 or a real
    printer, and the `{SG…|}` framing is inferred. Test the first print before relying on it.
- **Quitar imagen:** removes the preview image. The image takes part in the overlap and outside-the-label warnings.

### Panels

- **Collapsible sections:** click the title of Código, Variables, Convertir, Formato, Vista, Componentes or Propiedades
  to fold it (the state is remembered in the browser).
- **Sticky drawing area:** on wide windows the right-hand side (rows, drawing and Avisos) stays in view while the page
  scrolls through the left column, so the label is visible while editing code or variables. If it is taller than the
  window (many warnings) it scrolls inside itself. On narrow windows (one column) it scrolls with the page.
- **Variables:** each `#NAME#` or `<#NAME#>` of the label has an input to type a test value. This shows
  how it looks with long or short data.
- **Avisos:**
  - <span style="color:#c4320a">Red</span>: errors (overlaps, items outside the label, wrong required size).
  - <span style="color:#b54708">Orange</span>: warnings (coordinates without 4 digits, commands the viewer does not know...).
  - Gray: information (real QR size, barcode width).
- **Drawing:**
  - Hovering shows the **x / y** coordinates at the top right, in the same units as the label coordinates
    (0.1 mm). Useful to decide where to place an item.
  - **Click on an item** selects its line in the code.
  - **Drag an item** to move it: when dropped, only its coordinates change in the code (it works with the rotated
    view too, and **Ctrl+Z** in the code box undoes the move). Pressing **Esc** while dragging cancels it. For the
    preview image, dropping it updates **Posición X / Posición Y**. Only languages that can rewrite positions
    (currently TPCL) allow dragging.
  - **Propiedades panel:** selecting an item shows its editable fields (size, magnification, rotation, module width,
    human-readable text, error-correction level, end point, thickness...; only the values TPCL accepts). Changing a field
    (on leaving it or pressing Intro) rewrites only that field in the code, and **Ctrl+Z** in the code box undoes it. With
    nothing selected it shows "Selecciona un objeto". Clicking empty space deselects. In TSPL the content of TEXT, BARCODE
    and QRCODE is editable too (not for counters `@n`, BLOCK, 128M/EAN128 or QR manual mode); in TPCL so is the data of
    PC/PV text, barcodes and QR, inline (`=data`) or in its `RC`/`RV`/`RB` command (values with `| { }` or line breaks are rejected). The font of text is selectable too: the PC/PV font letter in TPCL (the PC table is the viewer's
    simulation, not verified against the printer) and the TEXT font id in TSPL; a value not in the list is kept and shown.
  - **Components panel:** drag a component (text, Code128 barcode, QR, line, box) onto the label to insert it into the
    code with its top-left corner at the drop point (text and barcodes are inserted as `<#NAME#>` variables). Clicking
    one, or pressing Enter on it, inserts it at 10 mm / 10 mm. **Ctrl+Z** in the code box undoes the insertion.

### Convertir a…

Converts the label in the **Código de etiqueta** box to another printer language (TPCL to TSPL and TSPL to TPCL, for example
to move a label from a TEC SV4T to a TSC TTP). The source language is detected from the text and the **Resolución** selector
is used to convert between dots and mm, so set it to the printer's before converting.

- **Convertir:** writes the label in the chosen language in the output box. A line above it says what was converted
  ("Convertido de … a …"); with an empty or unrecognized label it shows the reason instead.
- **Avisos de conversión:** a list of everything the conversion could not carry over exactly (orange = warning, gray = information).
  Read it before printing: the converted label is a starting point, not a guaranteed copy.
- **Copiar:** copies the output to the clipboard. A TSPL label with images holds raw binary data that the clipboard can
  alter, so in that case the panel says so and **Descargar** is the reliable way.
- **Descargar:** saves the output as a file. TSPL is saved as **`.prn`, one byte per character (latin1)**, because the
  `BITMAP` data is raw binary and UTF-8 would corrupt it; TPCL is saved as `.txt` (UTF-8). The file name is the name of the opened (or dropped) file, or the example id, without its extension, plus the target extension; for pasted text with no file it is `etiqueta`.

What is lost or approximated (each case is reported in the warnings list):

- Text: the TPCL PC bitmap fonts (letter, serif, italic) have no TSPL equivalent; TPCL magnifications in steps of 0.1 become
  TSPL integer multipliers or a scalable font in whole points.
- Barcodes: types without a counterpart are skipped with a warning (for example EAN13 in TPCL, UPC-E, or TSPL `128M` control codes).
- QR: the rotation is not converted.
- Variables: TPCL `#NAME#` is written literally in TSPL, which has no substitution.
- Label size: the TPCL pitch and the TSPL gap are **not converted** (TSPL to TPCL writes the height as the pitch; TPCL to TSPL omits `GAP`).
- TPCL output: the `{XS;…|}` trailer is a default taken from the reference spool and **has not been verified on a printer**.
- Images: a TSPL `BITMAP` whose width is not a multiple of 8 dots gains white padding columns; a preview image that is not yet
  inserted in the code is not part of the conversion.
- TPCL fields have 4 digits and 2-digit ids, and coordinates are rounded between 0.1 mm and dots.

## What it draws

| Command | What it is |
|---|---|
| `PC` / `RC` | Texts (printer fonts A–T, with magnification and rotation) |
| `PV` / `RV` | Texts with an outline font (height and width in 0.1 mm) |
| `XB` / `RB` type `T` | QR code (generated for real) |
| `XB` / `RB` types `9` and `A` | Code128 (generated for real, with the text below if the label asks for it) |
| `XB` / `RB` type `3` | Code39 (generated for real, with the wide/narrow widths of the command and the text below if the label asks for it) |
| `XB` / `RB` type `2` | Interleaved 2 of 5 / ITF (generated for real, same widths and text options) |
| `XB` / `RB` type `B` | Code39 full ASCII: only the characters of standard Code39 are drawn (see limitations) |
| `XB` other types | Other barcodes: drawn approximately |
| `LC` | Lines and rectangles |
| `SG` | Graphic (nibble data, modes 0 and 4); not verified on a printer |
| `D`, `AX`, `C`, `XS`, `XQ` | Configuration: not drawn |

## TSPL support (TSC TTP)

The language is detected from the text (no selector): a label with `SIZE`, `CLS` or `TEXT`/`BARCODE`/`QRCODE`/`BITMAP`/`BAR`/`BOX`
followed by a number is read as TSPL. Based on the TSC TSPL/TSPL2 Programming Manual v3.0. The label is drawn, clicking an item selects its line, and, as with TPCL, you can
**drag items** to move them, edit their numeric properties in the **Propiedades** panel, **add components from the palette** (text, barcode, QR, line and box,
written before `PRINT`) and change the size (the **Formato** row). Only the numbers of a command are rewritten (the text, counters and `BITMAP` data are never touched).
`REFERENCE` and `SHIFT` are taken into account (the item lands under the cursor), positions never go below 0 and `DIRECTION 0` is edited as `DIRECTION 1`.
It can be exported to TPCL with **Convertir a…**.

| Command | What it is |
|---|---|
| `SIZE`, `GAP`, `DIRECTION`, `REFERENCE`, `SHIFT` | Label setup (size in inches, mm or dots; coordinates in dots). The **Formato** row writes `SIZE` and `GAP` in mm |
| `TEXT`, `BLOCK` | Texts (fonts `1`-`8`, scalable `0`/`ROMAN.TTF`, multipliers, rotation) |
| `BARCODE` | Code128 (also `128M` and `EAN128`), Code39 and ITF / `25` are generated for real; EAN13 and the other types are drawn approximately and reported |
| `QRCODE` | QR code (generated for real; ECC level, cell size, manual-mode data) |
| `BAR`, `BOX` | Filled bar and rectangle outline (with thickness) |
| `BITMAP` | Raw binary graphic (mode 0 overwrite; bit 0 = black, MSB first) |
| `CLS`, `PRINT`, `DENSITY`, `SPEED`, `SET`, `CODEPAGE`, `FEED`... | Configuration: not drawn |

Not supported (a warning is shown): `ELLIPSE`, `CIRCLE`, `ERASE`, `REVERSE`, `DMATRIX`, `PDF417` and `PUTBMP`/`PUTPCX`/`PUTPNG`
(images stored in the printer). Also not supported:

- **Images in the code:** the **Imagen** palette entry and **Insertar en el código** write the picture as a TPCL `SG` or a TSPL `BITMAP` command, depending on the label's language (neither format is verified on a real printer yet). A preview image can still be overlaid to check positions.
- **Palette details:** new items use font `"3"` (text), Code 128 with readable text (barcode), QR with level `M` and cell 4 (always unrotated), a 40 mm `BAR` and a 30 x 20 mm `BOX`; texts and barcodes are written rotated so they look upright in the current view. Text and barcode data are `<#NOMBRE#>` placeholders, written literally (TSPL has no substitution).
- `BLOCK` is drawn as one line of text at its origin (no word wrapping); `DIRECTION 0` is drawn as `DIRECTION 1` (no 180° flip) with an
  information message; the QR rotation, the `BITMAP` modes 1 and 2 (drawn as overwrite), the `BOX` radius and the
  text alignment parameters are read but not drawn; add-on barcodes (`EAN13+2`...) are drawn without the add-on; counters (`@1`) are shown literally.
- **Resolución:** the dots-per-mm of a TSPL label are not in the file, so the **Resolución** selector (203 or 300 dpi) must match
  the printer: coordinates are in dots, so the same label is drawn smaller at 300 dpi.
- **Files with a `BITMAP`:** files opened or dragged (`.prn`, `.tspl`...) are read as bytes, so the graphic data survives, including `0x0D`
  bytes (the code box shows them as a private-use placeholder, U+E00D, because a text box would turn them into line breaks; conversion and
  download write them back as `0x0D`). Pasted text cannot carry arbitrary bytes, so for exact graphics open the file.
- The viewer imitates the printer fonts (as with TPCL): text widths are approximate.

## Limitations

- The printer letters are imitated with Arial / Times / Courier: the **width of the texts is approximate**. To
  adjust fine margins, always make a test print.
- The overlap warnings are based on that approximate width: if two texts are very tight, check it on paper.
- Code39 and ITF follow the `XB` layout of the legacy `[ESC]XB` form of the Toshiba B-SX4T manual. The `{XB…|}`
  form is the same command, but it has **not been verified** for the B-EX4 / B-FV4 / B-EP4 models.
- Code39: check digit options `1` (none) and `3` (modulo 43) are drawn; any other option is drawn without check
  character and reported. Full ASCII (type `B`) is not supported: characters outside standard Code39 (for example
  lowercase letters) are reported and the barcode is not drawn. The start/stop option (`T`, `P`, `N`) has not been
  verified: the viewer always draws the automatic `*`.
- ITF: only check digit option `1` (none) is drawn; options 2 to 5 are drawn without check digit and reported. The
  printer's behavior with an **odd number of digits is not verified**: the viewer draws a leading `0` and reports it.
  Non-digit characters are reported and not drawn.
