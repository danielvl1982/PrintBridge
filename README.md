# PrintBridge

Tool to see how a label (for now, TPCL for TEC/Toshiba printers) looks **without printing it**, while it is being created or
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
| `js/core.js` | Part common to all languages: diagnostics, units, variables, language registry, validation and sizes |
| `js/languages/tpcl.js` | TPCL reading (fonts and commands of the TEC/Toshiba printers) |
| `js/barcodes.js` | Code128, Code39, ITF and QR generation |
| `js/view.js` | Preview rotation (pure coordinate mapping) |
| `js/drawing.js` | Label drawing and overlap detection |
| `js/ui.js` | Screen panels |
| `js/app.js` | Startup: connects the panels with the logic |
| `js/lib/` | External QR library (qrcode-generator, MIT license) |
| `tests/` | Automated tests (`node --test` from the project root) |

All modules share the global namespace `PrintBridge`. To add a fixed size or a new example, only `js/config.js` needs to be touched.

## Loading a label

Any of these ways:

- Paste the label content into the **Código de etiqueta** box.
- Drag the file (`.ter`, `.txt`, `.zpl`, `.prn`, `.tspl` or `.tpcl`) onto that box.
- **Abrir archivo…** button.
- **Cargar ejemplo** button: loads the reference 99×55 spool label with sample data.

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

### Tamaño etiqueta

| Option | What it does |
|---|---|
| **Según la etiqueta** | Draws with the size the label declares (in TPCL, the `{D…|}` command). |
| **Bobina 99×55 (TEC) — obligatorio** | Draws at 99×55 mm. If the label does not carry exactly `{D0610,0990,0550|}` and `{AX;+010,+000,+00|}`, it shows an **error**. |
| **Personalizado…** | Type **Ancho**, **Alto** and **Paso** in mm to try the size of another printer. |

- **Paso:** distance between the start of one label and the next (height + gap between labels).
- **Aplicar a la etiqueta:** writes the chosen size in the `{D…|}` command of the code (in TPCL) (and the `{AX…|}` in the reference 99×55 spool case).
- When loading a label that carries `{D0610,0990,0550|}` the 99×55 spool size is chosen automatically. With any other,
  "Según la etiqueta" is chosen.

### Imagen

Overlays a picture on the preview to check where it would go. Until you insert it, it is visual only: it is not written into the label code. Only one preview image exists at a time (adding another replaces it).

- **Añadir imagen:** choose an image file (replaces the previous one). By default it is drawn at its natural pixel size for the selected **Resolución**.
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
