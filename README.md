# PrintBridge

Tool to see how a label (TPCL for TEC/Toshiba printers, TSPL for TSC TTP printers, ZPL for Zebra printers) looks **without printing it**, while it is being created or
modified. It warns about overlapping texts, items that go outside the label and wrong measures.

**Live app: <https://danielvl1982.github.io/PrintBridge/>**

(Formerly "Visor etiquetas bobinas TEC".) The code and technical docs are in English; the on-screen text is in Spanish, so the
UI labels below are quoted exactly as they appear.

Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md). The development plan and its progress live in
[`odd/tasks/multi-printer-language-support.md`](odd/tasks/multi-printer-language-support.md); the later features have their own plans in
`odd/tasks/` (`editable-gaps.md`, `component-candidates.md`, `image-rotation.md`, `zpl-support.md` for the ZPL language and the three-way conversion).

## How to open it

Use the [live app](https://danielvl1982.github.io/PrintBridge/), or double-click **`index.html`** to run it locally. It opens in
the browser, nothing needs to be installed and it works without internet. It stores nothing: every time it is opened it starts
from scratch with the TPCL template label.

**Always copy the whole folder**: `index.html` needs the `css` and `js` folders next to it.

| File | Contains |
|---|---|
| `index.html` | The page structure |
| `css/viewer.css` | Look of the page: toolbars, panels and messages |
| `css/label.css` | Look of the label drawing: colors, grid and typefaces |
| `js/config.js` | Known label sizes and the example labels (a blank template and a ready-made template per language) |
| `js/manifest.json` | Ordered list of every script (same order as `index.html`; the tests load from it) |
| `js/core/` | Part common to all languages, one file per module: diagnostics, units, sources, variables, language registry, validation and sizes |
| `js/core/emit.js` | Shared helpers of the emitters (dots, escaping, id numbering, diagnostics) and the driver that calls each item's slice `emit` |
| `js/core/convert.js` | `PB.convert`: the pure part of "Convertir a…" (`run`, `targets`, `toBytes`, `fileName`) on top of the language registry |
| `js/components/registry.js` | `PB.components`: the registry where each label component registers itself |
| `js/components/<name>/` | One folder per component (`text`, `barcode`, `qr`, `datamatrix`, `line`, `box`, `ellipse`, `area`, `image`) with its encoders and constants, drawing, parsing, building, moving, editing and validation |
| `js/components/<name>/tpcl.js`, `tspl.js`, `zpl.js` | The pieces of that component for one language: read, build (palette), move, edit and write (emit). `ellipse/tpcl.js` only reports the skipped item when converting to TPCL (TPCL has no ellipse); `area/` is TPCL `XR`, TSPL `REVERSE` / `ERASE` and ZPL `^GB` with `^FR` or colour `W`; `line/` is TPCL `LC`, TSPL `BAR` and ZPL `^GB` / `^GD`; `box/` is TPCL `LC`, TSPL `BOX` and ZPL `^GB` |
| `js/components/compose.js` | `PB.composeSlices`: builds a language's handler table from the slices that registered for it |
| `js/languages/tpcl.js` | TPCL reading and writing (fonts and commands of the TEC/Toshiba printers; the language `emit` hook writes header, items and trailer) |
| `js/languages/tspl.js` | TSPL reading and writing (tokenizer, label setup commands, language registration and the `emit` hook; the drawing commands come from the component slices) |
| `js/languages/zpl.js`, `js/languages/zpl-edit.js` | ZPL (Zebra) reading and writing: tokenizer, field grouping and deferred dispatch, label setup commands, language registration, `emit` skeleton, and the generic move / describe / update engines (the drawing commands come from the component slices) |
| `js/view.js` | Preview rotation (pure coordinate mapping) |
| `js/drawing.js` | Label drawing and overlap detection |
| `js/ui.js` | Screen panels |
| `js/convert-panel.js` | The "Convertir a…" panel (target, output, fidelity warnings, Copiar, Descargar) |
| `js/print-panel.js` | The "Impresión" panel (agent status, printer, copies, Imprimir, agent address) that talks to the local print agent |
| `agent/` | The Windows print agent (`printbridge-agent.js`, no dependencies), its `config.example.json`, the `install.ps1` / `uninstall.ps1` / `start.bat` scripts and its own [README](agent/README.md) |
| `js/app.js` | Startup: connects the panels with the logic |
| `js/lib/` | External QR library (qrcode-generator, MIT license) |
| `tests/` | Automated tests (`node --test` from the project root), including the TPCL / TSPL / ZPL conversion matrix (`tests/conversion-matrix.test.js`) |
| `odd/tasks/` | Feature plans and progress of the development |
| `docs/` | Local printer manuals: **git-ignored** (copyrighted), only `docs/README.md` is versioned; see it for which manual goes where |

All modules share the global namespace `PrintBridge`. To add a fixed size or a new example, only `js/config.js` needs to be touched.

## Loading a label

Any of these ways:

- Paste the label content into the **Código de etiqueta** box.
- Drag the file (`.ter`, `.txt`, `.zpl`, `.prn`, `.tspl` or `.tpcl`) onto that box.
- **Abrir archivo…** button.
- **Ejemplo** combo: choosing an entry loads a label, grouped in two sections.
  - **En blanco:** one empty 100×60 mm template per language (TPCL, TSPL and ZPL), header only. It sets the language and the label size, so the **Componentes** palette inserts commands of that language.
  - **Plantillas:** the same 100×60 mm label in TPCL, TSPL and ZPL (a frame, a title, three lines with variables, a line, a Code128 bar code and a QR), with sample data for its variables. It is also a handy way to compare the three languages.

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

The row is a view of the label: **Ancho**, **Alto** and the pitch / gap field (mm) always show the size the label declares, and the drawing always
follows it. If the label declares no size, the fields show 99×55 mm and a warning says so.

| Control | What it does |
|---|---|
| **Tamaño etiqueta** | Standard sizes (mm, pitch = height + 3, so TSPL gets `GAP 3 mm`): 100×150, 100×100, 100×60, 80×50, 60×40, 50×30 and 40×30. Picking one writes it to the label. It marks the standard equal to the declared size, or **Personalizado…** if there is none. |
| **Ancho / Alto** | Edit one and leave the field to write the size to the label (in TPCL, the `{D…|}` command, and an existing `{AX…|}` is left untouched; in TSPL, `SIZE`; in ZPL, `^PW` and `^LL` in dots). Editing the width or the height keeps the gap between labels, so the pitch follows the height. A zero, negative or invalid value goes back to the label's value. |
| **Paso** (TPCL) / **Separación (GAP)** (TSPL) | One field that follows the language of the label; ZPL and a label with no recognized language hide it, because ZPL has no command for it. Pitch = height + gap, and the viewer derives each from the other when it reads the label: TPCL `D<pitch>,…` gives the gap = pitch − height, TSPL `GAP g` gives the pitch = height + g. In TPCL the field is the pitch and an empty one means the height; in TSPL it is the gap in mm (empty or 0: no `GAP`, an existing one is left alone). Leaving the field rewrites `{D…|}` or `GAP` like the width and the height, and Ctrl+Z undoes it. |

- **Paso:** distance between the start of one label and the next (height + gap between labels). **Separación (GAP):** the gap between labels, in the same units (pitch − height).

### Imagen

Overlays a picture on the preview to check where it would go. Until you insert it, it is visual only: it is not written into the label code. Only one preview image exists at a time (adding another replaces it). Its controls live in the **Propiedades** panel (shown when the image is selected, or when nothing is selected and an image exists).

- **Imagen (paleta):** the component palette has an **Imagen** entry (when the label language can insert images); the chosen file replaces the previous image and is drawn at its natural pixel size for the selected **Resolución**. Click it (or press Enter) to pick a file and place it at the default point; dragging it onto the label only works if the browser allows opening the file picker from a drop, otherwise click the entry.
- **Posición X / Posición Y:** top left corner of the image, in mm from the label origin.
- **Ancho:** optional width in mm (empty = natural size); the height keeps the proportion. It is the width of the picture before rotating.
- **Rotación:** 0°, 90°, 180° or 270° clockwise on the label, the same convention as text. TPCL `SG`, TSPL `BITMAP` and ZPL `^GF` have no rotation parameter, so the converted dots are rotated before they are previewed and written. For a new image, and every time **Giro** changes until you pick a value for that image, it is `(360 − Giro) % 360`, so the picture looks upright in the current view; choosing a value keeps it for that image. **Posición X / Y** is the top left corner of the rotated picture. Images already in the code (`SG` / `BITMAP` / `^GF`) have no rotation control.
- **Umbral:** slider 0-100 % (default 50 %), enabled with the image. A dot is black when its luminance is below the
  threshold: raise it to thicken thin lines, lower it to drop light gray background. While an image is loaded, the
  preview shows the converted black and white result (the same dots that get inserted), so you see the effect of the
  threshold, the width and the resolution before inserting. If the conversion fails, the plain picture is shown with an error.
- **Insertar en el código:** converts the picture to black and white and writes it into the label code as a TPCL
  `{SG;xxxx,yyyy,wwww,hhhh,0,<data>|}` command, placed before `{XS;…|}` (or at the end if there is none), or as a TSPL
  `BITMAP x,y,widthBytes,height,0,<data>` command placed before `PRINT` (bit 0 = black, the payload is raw bytes), or as a ZPL
  `^FOx,y^GFA,<total>,<total>,<bytes per row>,<data>^FS` field placed before `^XZ` (ASCII hexadecimal, 1 = black, only the comma that `^GF` documents as shortening: see *Images* in the ZPL section). Then the
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

- **Collapsible sections:** click the title of Código, Convertir, Variables, Formato, Vista, Componentes or Propiedades
  to fold it (the state is remembered in the browser). Variables starts collapsed until you open it.
- **Sticky drawing area:** on wide windows the right-hand side (rows, drawing and Avisos) stays in view while the page
  scrolls through the left column, so the label is visible while editing code or variables. If it is taller than the
  window (many warnings) it scrolls inside itself. On narrow windows (one column) it scrolls with the page.
- **Variables:** below Convertir and collapsed by default. Each `#NAME#` or `<#NAME#>` of the label has an input to
  type a test value. This shows how it looks with long or short data. The values can also be typed in Propiedades
  for the selected object ("Valores de prueba (solo vista previa)", with a note when the variable is used by more
  than one object); both places share the same values and neither changes the label code.
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
    (TPCL, TSPL and ZPL) allow dragging.
  - **Propiedades panel:** selecting an item shows its editable fields. Changing a field (on leaving it or pressing
    Intro) rewrites only that field in the code, and **Ctrl+Z** in the code box undoes it. With nothing selected it shows
    "Selecciona un objeto". Clicking empty space deselects. What can be edited, in TPCL, TSPL and ZPL (the fields below are mostly TPCL / TSPL; the ZPL fields are listed in *ZPL support*, under each component, and have the same shape: numbers and options, content, font, counters, barcode type, reverse print):
    - **Tipo (texts):** the first field of a text. **Línea de texto** (the default) or **Bloque de texto** (the text wrapped in a width). Which values exist depends on the language of the label:
      TSPL (`TEXT` / `BLOCK`) and ZPL (a field without / with `^FB`) offer both; TPCL offers both for a text with a bitmap font (`PC`: the automatic line feed `P5aaaabbbcc`) and only **Línea de texto** (disabled, with the note "Bloque de texto solo con fuente de mapa de bits (PC)") for a `PV` text. Changing it rewrites the
      command in one edit (**Ctrl+Z** undoes it): a line becomes a block 20 characters wide with as many lines as the text needs, left aligned; a block becomes a line again (the width, lines and alignment are lost
      and the line breaks become spaces). A counter text (TSPL `@n`, ZPL `^SN`) stays a line: a block does not print it. In TPCL a line becomes `P5` (20 characters wide, line feed spacing 010, the lines the text needs) in the place of any alignment (`P2`...`P4`: a block has none) and the block fields are **Ancho del área (0,1 mm)**, **Líneas** and **Interlineado (0,1 mm)**; a `PC` text with a rotation code `01` / `12` / `23` / `30` (which the viewer does not support) only offers the line, because the printer ignores the block with them. In TSPL and ZPL a block adds **Ancho del bloque (puntos)**, **Líneas máx.**, **Alineación**
      (Izquierda, Centro, Derecha; ZPL also Justificado) and, in ZPL only, **Interlineado (puntos)** (extra space between lines, may be negative). In its **Contenido** a line break is `\&` in ZPL and `\[R]` in TSPL.
      An `^FT` field keeps its first line where it was when it becomes a block. TSPL has no line count: **Líneas máx.** writes `height = lines * line pitch` (character height of the font + space).
    - **Tipo de fuente (TPCL texts):** a radio **Mapa de bits (PC)** / **Vectorial (PV)**. Choosing the other one rewrites the command in one edit (**Ctrl+Z** undoes it) and renames its `RC` / `RV` data command to match: a `PC` becomes a `PV` with the outline font `B`, width = size x horizontal stretch and height = size (0.1 mm), a `PV` becomes the nearest sans bold `PC` font (`J`, `K`, `M`) with whole magnifications. Position, rotation, attribute, character spacing, counter, zero suppression, alignment, the other optional parameters and the inline `=data` stay; the number of the command stays unless it is taken by the other type (then the next free one is used). What only `PC` has, the bold (`J`) and the block (`P5`), is dropped going to `PV` (the text becomes a line); the note under the radio says so before the change. The spacing is clamped to the 2 digits of `PC` (+-99) coming back. The **Fuente** select then lists the fonts of the chosen type. The palette text is a `PV` (+ `RV`).
    - **Numbers and options:** size or magnification, rotation, module width, human-readable text, error-correction level,
      end point and thickness (the fields each command has).
    - **Radio (esquinas redondeadas):** rectangles only (TPCL `LC` type 1, TSPL `BOX`): the corner radius, 0..999 in 0.1 mm for TPCL and in dots for TSPL, drawn clamped to half of the shorter side. A value above 0 adds the optional token at the end of the command; 0 keeps an existing token and writes nothing for an absent one. The TSPL radius argument comes from the TSPL2 manual and is not verified on a printer.
    - **Data Matrix** (TPCL `XB` type `Q`, TSPL `DMATRIX`): TPCL **Tamaño de módulo** (dots, 1..99), **Rotación** and **Tamaño del símbolo** (automatic or one of the 24 square sizes, 10 x 10 to 144 x 144: the optional `,Ciiijjj` token is added, changed or removed; a rectangular size or a connection setting `J...` is never touched);
      TSPL **Ancho** and **Alto** (the area), **Módulo** and **Tamaño del símbolo** (rows and columns together; only in the form with `xm,row,col`).
    - **Contenido:** the data of text, barcodes, QR and Data Matrix. TSPL: `TEXT`, `BARCODE`, `QRCODE` and `DMATRIX` (not a counter `@n` (edit its start value in the `@n="..."` line),
      `128M`/`EAN128` or QR manual mode). ZPL: text, barcodes, QR and Data Matrix (`^` and `~` go through `^FH`). TPCL: `PC`/`PV` text, barcodes, QR and Data Matrix, inline (`=data`) or in the `RC`/`RV`/`RB`
      command; values with `| { }` or line breaks are rejected because TPCL has no escape for them.
    - **Fuente:** the PC font letter (A-T) or PV font (`A`, `B`) in TPCL, the font id of `TEXT` in TSPL and the `^A` font in ZPL (A..H, `0`). A value not in the
      list is kept and shown. The PC font table is the viewer's simulation, not verified against the printer.
    - **TPCL text options** (PC and PV only; TSPL has none of them, so converting writes such a text plain and warns once):
      - **Atributo:** `B` black, `W` reverse, `F` boxed, `C` stroked out, with **Margen horizontal/vertical** in dots.
        Omitted margins use the manual default (PC: larger magnification x 6 dots; PV: larger size in mm x 8 dots, a reading
        of the manual that is not verified).
      - **Alineación:** `P1` left, `P2` center, `P3` right, `P4aaaa` equal space over an area `aaaa` wide (**Ancho del área**).
        The manual gives an area width only to equal space, so center and right are drawn relative to the item origin
        (an approximation).
      - **Espaciado entre caracteres** (`ghh` / `ghhh`, signed dots; ignored with equal space, as in the manual) and
        **Negrita horizontal/vertical** (PC `Jkkll`, shift dots 0-16): the bold overprint is an approximation (the string
        is drawn again shifted by those dots).
    - **Incremento** and **Ceros suprimidos** (counters): TPCL `PC`/`PV` text and the 1D barcodes `XB` (not QR) take the optional increment
      `noooooooooo` (a signed integer, + increments and - decrements the data on every label issued, up to 9999999999; 0 means no counter: it
      writes nothing on an absent token and keeps an existing one as `+0000000000`) and the zero suppression `Zpp` (`qq` in `XB`, 0..20).
      They are written in the manual's order (`...,J,M,n,Z,P`) without touching the other tokens. The preview shows the **start value** (the
      data) because the printer is the one that increments per label (one information message says so); with zero suppression the text is drawn as
      the manual's table shows (the leading zeros become spaces so that `pp` characters stay: `0000` with 2 draws `  00`), but only in the
      preview, the data written to the code never changes, and the barcode bars always draw the full data. TSPL: a TEXT or BARCODE whose
      content is exactly `@n` with a start value assigned (`@n="0001"`) shows that value, and **Incremento** edits the step of its
      `SET COUNTER @n step` line (-999999999..999999999).
    - **Tipo de código**, **Dígito de control** and **Complemento** (1D barcodes, TPCL `XB` and TSPL `BARCODE`; not QR): the symbology among the ones the viewer draws exactly
      and the emitters write (Code 128, Code 39, ITF, Code 93, NW7 / Codabar, MSI, 2 de 5 industrial, EAN-13, EAN-8, UPC-A, UPC-E; TSPL has no MSI or 2 de 5 industrial type, so it does not offer them), and its check digit option (Code 39: none / modulo 43 = TPCL check 3, TSPL `39C`; ITF and Code 128: none,
      so ITF lists a single option and Code 128 no field; NW7: none only; EAN / UPC, Code 93 and 2 de 5 industrial in TPCL: none / check / automatic = options 1 / 2 / 3, MSI also 4 = IBM modulus 10 + 10 and 5 = IBM modulus 11 + 10;
      in TSPL Code 93 and EAN / UPC only automatic, NW7 none, the types have no option),
      and for the EAN / UPC types the add-on (none, +2, +5: part of the TPCL type character and of the TSPL type string, `EAN13+2`). The command is written again for the new type: TPCL replaces the whole `XB` command (the
      Code 128 form and the Code 39 / ITF form have different parameters; position, rotation, height, readable flag, module or widths, counters and any
      `=data` are kept, the widths-form inter-character space follows the manual, 00 for ITF and MSI, and the wide space 00 for 2 de 5 industrial; the `RB` data command is never touched); TSPL replaces the type
      string and the wide bar argument only (the other arguments, REFERENCE-relative coordinates and a counter content stay as written). A check option the new
      type lacks goes back to none (automatic for Code 93 and the EAN / UPC types); the add-on and the TPCL guard bar length are carried between EAN / UPC types; a TPCL start/stop option (`T`/`P`/`N`) is carried between the widths-form types
      (Code 39, ITF, MSI, NW7, 2 de 5 industrial). TSPL writes the wide argument of the new type (1:2 for Code 93, 3:1 for Code 39 / NW7 / ITF, equal to the narrow one for the rest). The change is refused (nothing changes) when something would be lost without any warning: a TPCL start/stop option
      or a guard bar that the other form cannot hold (a start/stop option towards Code 128, Code 93 or EAN / UPC), TSPL `128M`/`EAN128` content, an add-on that the new type cannot carry (Code 128, Code 39, ITF), a TPCL price check digit (options 4 / 5) that is not replaced, and symbologies without a row (Postnet...). Content the new type cannot encode
      (letters in ITF, an odd digit count, lower case in Code 39) is still written and the viewer warns as usual on the next refresh. The options come from the language's tables, so a
      new symbology only adds rows.
  - **Components panel:** drag a component (**Texto**, **Código de barras** (Code 128), **QR**, **Data Matrix**, **Línea**, **Caja**, **Área invertida**, for TSPL and ZPL **Elipse** and **Círculo**, and, for the three languages, **Imagen**) onto the label to insert it into the
    code with its top-left corner at the drop point (text and barcodes are inserted as `<#NAME#>` variables). Clicking
    one, or pressing Enter on it, inserts it at 10 mm / 10 mm. **Ctrl+Z** in the code box undoes the insertion.

### Convertir a…

Converts the label in the **Código de etiqueta** box to another printer language: **TPCL** (Toshiba TEC), **TSPL** (TSC TTP) or **ZPL** (Zebra), in any of the six directions
(for example to move a label from a TEC SV4T to a TSC TTP or to a Zebra). The source language is detected from the text, the **Resolución** selector is used to convert
between dots and mm (set it to the printer's before converting), and the target can also be the language of the label (it is read and written again by that language).
**Nothing the conversion writes has been verified on a printer**, ZPL included: it is a starting point to check with a test print, not a guaranteed copy.

- **Convertir:** writes the label in the chosen language in the output box. A line above it says what was converted
  ("Convertido de … a …"); with an empty or unrecognized label it shows the reason instead.
- **Avisos de conversión:** a list of everything the conversion could not carry over exactly (orange = warning, gray = information). Read it before printing.
- **Copiar:** copies the output to the clipboard. A TSPL label with images holds raw binary data that the clipboard can alter, so in that case the panel says so and
  **Descargar** is the reliable way. TPCL and ZPL are plain text (a ZPL image is ASCII hexadecimal `^GF` data), so Copiar is safe and the note never appears for them.
- **Descargar:** saves the output as a file: ZPL as **`.zpl`** and TPCL as `.txt`, both UTF-8 (no byte order mark); TSPL as **`.prn`, one byte per character (latin1)**, because the
  `BITMAP` data is raw binary and UTF-8 would corrupt it. The file name is the name of the opened (or dropped) file, or the example id, without its extension, plus the target
  extension; for pasted text with no file it is `etiqueta`.

What is exact, approximated (**~**, reported in the warnings list) or left out (**x**, reported) in each direction; **=** is exact within one dot (and the 0.1 mm rounding) and **–** does not apply.
The positions of the items are carried through the neutral model, so they are exact; see the "Text origin" note below for how each language places a text.

| Component / feature | TPCL→TSPL | TPCL→ZPL | TSPL→TPCL | TSPL→ZPL | ZPL→TPCL | ZPL→TSPL |
|---|---|---|---|---|---|---|
| Text: position, rotation, size, data | = | = | = | = | = | = |
| Text: font family / weight / style | ~ nearest built-in font | ~ | ~ | ~ | ~ | ~ |
| Text: TPCL attribute (reverse, box, strike) | ~ written without | ~ written without | – | – | – | – |
| Text: TPCL alignment, spacing, bold | ~ written without | ~ written without | – | – | – | – |
| Text: ZPL reverse print `^FR` | – | – | – | – | ~ written normal | ~ written normal |
| Text block (`BLOCK`, `^FB`, `PC ...,P5`): width, lines, alignment, line space, line breaks | = (`P5`: left, no breaks) | = (`P5`: left, no breaks) | ~ `PC ...,P5` for a bitmap font (line space at least 010, left, breaks as spaces), else one line of text | = (justified: `BLOCK` writes left) | ~ the same as from TSPL | = (justified: written left) |
| Counters (increment / step) and their start value | = | = | = | = | = | = |
| Zero suppression (TPCL characters kept, ZPL `z`) | ~ dropped | ~ becomes "all leading zeros" | – | – | = | ~ dropped |
| `#NAME#` variables | ~ literal text | ~ literal text | = | ~ literal text | = (`<#FNn#>`) | ~ literal text |
| Code 128, Code 39, ITF, Code 93, NW7 / Codabar (data, height, module, rotation, text line, wide / narrow) | = | = | = | = | = | = |
| Check digit options with no counterpart (Code 93 none / check, ITF check digit, EAN / UPC none / check, TSPL `25C`) | ~ automatic or none | ~ | ~ | ~ | ~ | ~ |
| EAN / UPC add-on (+2 / +5) | = | ~ dropped from the data | = | ~ dropped | – | – |
| EAN / UPC guard bar length (TPCL) | ~ dropped | ~ dropped | – | – | – | – |
| MSI, Industrial 2 of 5 | x | = | – | – | = | x |
| TSPL barcode types without a neutral symbology (`POST`, `MSI`...) | – | – | x | x | – | – |
| QR (position, level, module, data) | = (module above 10 dots clamped) | = (same) | = | = | = | = |
| Data Matrix (position, module, forced size, data) | = | = | = | = | = | = |
| Data Matrix rotation | ~ written unrotated | = | – | – | = | ~ written unrotated |
| Lines, bars, boxes, thickness | = | = | = | = | = | = |
| Box corner radius | = | ~ quantised to the 9 ZPL degrees | = | ~ quantised | = | = |
| Diagonal lines | x | = | – | – | = | x |
| Lines of length 0 | x | x | – | – | – | – |
| White / reversed (ZPL `W`, `^FR`) lines, boxes and ellipses | – | – | – | – | ~ written plain | ~ written plain |
| Ellipses and circles | – | – | x | = | x | = |
| Reverse / clear areas (TPCL `XR`, TSPL `REVERSE` / `ERASE`, ZPL `^GB`) | = | = | = | = | = | = |
| Images (bitmap) | = | = | = | = | = | = |
| Label size (width, height) | = | = (whole dots: 100×60 mm reads back 100.0×60.1) | = | = | = | = |
| Pitch (TPCL) / gap (TSPL) (pitch = height + gap) | = `GAP` = pitch − height (none when pitch = height) | ~ one information message: ZPL has only `^PW` / `^LL` | = pitch = height + `GAP` (height when there is no `GAP`, with an information message) | ~ same message | ~ pitch = height | ~ no `GAP` |
| Label printed rotated 180° (TSPL `DIRECTION 0`, ZPL `^POI`) | – | – | ~ not written | ~ not written | ~ not written | ~ not written |

Notes: a TPCL field has 4 digits and 2-digit ids, and coordinates are rounded between 0.1 mm and dots (values beyond the field are clamped with a warning); a TPCL
increment beyond 10 digits (ZPL `^SN` allows 12) is clamped with one warning; the TPCL `{XS;…|}` trailer is a default taken from the reference spool; a TSPL `BITMAP`
(or a ZPL `^GF`) whose width is not a multiple of 8 dots gains white padding columns; a preview image that is not yet inserted in the code is not part of the conversion;
the TPCL format ID and connection setting of a Data Matrix are not converted. The detail of each ZPL feature is in *ZPL support*.

**Text origin:** TPCL, TSPL and ZPL do not place a text the same way (TPCL gives the origin of the text, ZPL `^FO` the top-left of the field and `^FT` the baseline, TSPL `TEXT` the top-left
of the character cell). The viewer draws every text from its baseline, so it reads a TSPL `TEXT` y as the top edge plus the ascent (75% of the height for the scalable fonts, as the ZPL font 0 in Volume Two; 80% for the bitmap fonts; whole dots) and writes it back
without it: a ZPL `^FO30,25` becomes `TEXT 30,25`. The 75% / 80% shares are approximations that have not been checked on a TSC printer: check it with a test print.

## Printing from the app

The browser cannot write RAW data to a USB label printer, so the **Imprimir** button talks to a small local program, the **print agent** (`agent/printbridge-agent.js`).
It needs Windows and [Node.js](https://nodejs.org) LTS, has no dependencies and only listens on `127.0.0.1`.

1. Install the printers in Windows as usual (the driver can be a generic one: the data is sent RAW, exactly as in the editor).
2. Run `agentstart.bat` to try it, or `powershell -ExecutionPolicy Bypass -File agentinstall.ps1` so it starts by itself at every logon (`uninstall.ps1` removes it).
3. In the app, open the **Impresión** panel: it shows "Agente conectado", the printers of the PC (the Windows default one is preselected, and the last one you chose is remembered), the **Copias** and **Imprimir**.
   **Agente** is the address of the agent (default `http://127.0.0.1:9631`) and **Reintentar** checks it again.

**Imprimir** sends the label in the **Código de etiqueta** box in its own language, with the bytes that saving it as a file would write (TSPL `BITMAP` data included).
Several copies are sent as one print job. If the agent is not running the panel says so and **Descargar** (panel **Convertir a…**) stays as the alternative.
Chrome asks once for permission to access the local network: allow it. **Nothing has been verified on a real printer yet**: try one label first.
Requirements, configuration, allowed origins, security notes and troubleshooting: [agent/README.md](agent/README.md).

## TPCL support (Toshiba TEC)

The language is detected from the text (`{…|}` commands). What the viewer draws:

| Command | What it is |
|---|---|
| `PC` / `RC` | Texts (printer fonts A–T, with magnification, rotation, attribute, alignment or automatic line feed block `P5aaaabbbcc`, spacing and bold) |
| `PV` / `RV` | Texts with an outline font (height and width in 0.1 mm; same attribute, alignment and spacing options) |
| `XB` / `RB` type `T` | QR code (generated for real) |
| `XB` / `RB` type `Q` | Data Matrix (generated for real: ECC200 with ASCII encodation and square symbols only; `XBnn;x,y,Q,<ECC>,<cell width in dots>,<format ID>,<rotation 0..3>[,Ciiijjj][,Jkkllmmmnnn]`). ECC type `20` is drawn; `00`-`14` (ECC 000-140, which the manual says the printer ignores) are reported and drawn as a hatched box. Cell width `00` draws nothing (as the printer). The format ID is ignored (kept as written, `00` when exported). `Ciiijjj` (number of cells, even, `000` = automatic) forces one of the 24 square sizes; the manual's rectangular codes (18 x 8 ... 48 x 16) are reported and drawn as the smallest square that fits. The connection setting `J...` is reported and not drawn. Rotation turns the symbol around its origin. See limitations |
| `XB` / `RB` types `9` and `A` | Code128 (generated for real, with the text below if the label asks for it) |
| `XB` / `RB` type `3` | Code39 (generated for real, with the wide/narrow widths of the command and the text below if the label asks for it) |
| `XB` / `RB` type `2` | Interleaved 2 of 5 / ITF (generated for real, same widths and text options) |
| `XB` / `RB` type `B` | Code39 full ASCII: only the characters of standard Code39 are drawn (see limitations) |
| `XB` / `RB` types `5` `7` `8` (EAN-13, +2, +5), `0` `I` `J` (EAN-8), `K` `L` `M` (UPC-A), `6` `G` `H` (UPC-E) | EAN / UPC (generated for real: guard bars, check digit option, digits printed under the bars when the label asks for it, add-on digits above the add-on bars; see limitations) |
| `XB` / `RB` type `C` | Code 93 (generic form: module, rotation, height; check option 1 none / 2 check / 3 attach C and K, modulo 47; generated for real) |
| `XB` / `RB` type `4` | NW7 / Codabar (widths form; start/stop letters A-D in the data; generated for real) |
| `XB` / `RB` type `1` | MSI (widths form; check options 1 none, 2 check, 3 IBM modulus 10, 4 IBM modulus 10 + 10, 5 IBM modulus 11 + 10; generated for real) |
| `XB` / `RB` type `O` | Industrial 2 of 5 (widths form, wide space 00; check options 1 / 2 / 3; generated for real) |
| `XB` other types | Other barcodes: drawn approximately (PDF417 `P`, MicroPDF417 `X` and MaxiCode `Z` are out of scope and are not generated) |
| `LC` | Lines and rectangles (a rectangle may carry the optional corner radius `ggg`, 0.1 mm, drawn rounded) |
| `XR` | Clear area: type `B` inverts white/black and type `A` clears to white, in the rectangle between the start and end corners (0.1 mm; the corners may come in any order). It acts on what is drawn **before** it in command order; what comes after is not affected. Drawn, moved, edited (**Final X**, **Final Y**, **Tipo**: Invertir / Borrar) and inserted from the palette (**Área invertida**, 30 x 10 mm, type `B`; clearing areas have no palette entry). **Browser check pending:** the inversion is drawn with the SVG blend mode `difference` |
| `SG` | Graphic (nibble data, modes 0 and 4); not verified on a printer |
| `D`, `AX`, `C`, `XS`, `XQ` | Configuration: not drawn |

## TSPL support (TSC TTP)

The language is detected from the text (no selector): a label with `SIZE`, `CLS` or `TEXT`/`BARCODE`/`QRCODE`/`DMATRIX`/`BITMAP`/`BAR`/`BOX`
followed by a number is read as TSPL. Based on the TSC TSPL/TSPL2 Programming Manual v3.0. The label is drawn, clicking an item selects its line, and, as with TPCL, you can
**drag items** to move them, edit their properties (numbers, font and content) in the **Propiedades** panel, **add components from the palette** (text, barcode, QR, Data Matrix, line, box, ellipse, circle, inverted area and image,
written before `PRINT`) and change the size (the **Formato** row). Only the field being edited is rewritten (`BITMAP` data is never touched, and a counter `@n` keeps its text: only its step in the `SET COUNTER` line is editable).
`REFERENCE` and `SHIFT` are taken into account (the item lands under the cursor), positions never go below 0 and `DIRECTION 0` is edited as `DIRECTION 1`.
It can be converted to TPCL or ZPL with **Convertir a…**.

| Command | What it is |
|---|---|
| `SIZE`, `GAP`, `DIRECTION`, `REFERENCE`, `SHIFT` | Label setup (size in inches, mm or dots; coordinates in dots). The **Formato** row writes `SIZE` and `GAP` in mm (the field **Separación (GAP)**; pitch = height + gap) |
| `TEXT`, `BLOCK` | Texts (fonts `1`-`8`, scalable `0`/`ROMAN.TTF`, multipliers, rotation). `BLOCK x,y,width,height,"font",rotation,x-mul,y-mul,[space,][align,][fit,]"content"` is a **text block**: the text is wrapped in `width` dots (see *Text blocks* at the end of this section) |
| `BARCODE` | Code128 (also `128M` and `EAN128`), Code39, ITF / `25`, Code 93 (`93`), Codabar (`CODA`) and EAN13 / EAN8 / UPCA / UPCE (each also with `+2` and `+5`) are generated for real; the other types are drawn approximately and reported |
| `QRCODE` | QR code (generated for real; ECC level, cell size, manual-mode data) |
| `DMATRIX` | Data Matrix: `DMATRIX x,y,width,height,[xm,row,col,]"content"` (dots). Generated for real (ECC200, ASCII encodation, square symbols only). Without `xm,row,col` the code fits the width and height (whole dots of the smaller side / symbol side); with them it is drawn with that module, and `row` = `col` forces one of the 24 square sizes (`0,0` = automatic; a rectangle is reported). There is no rotation. Moved, edited (**Ancho**, **Alto**, **Módulo**, **Tamaño del símbolo**, **Contenido**) and inserted from the palette (**Data Matrix**). The command comes from the B-442/443 manual (syntax and one example only) and is **not verified on a printer** |
| `BAR`, `BOX` | Filled bar and rectangle outline (with thickness and optional corner radius, in dots; the radius argument is from the TSPL2 manual and **not verified on a printer**) |
| `ELLIPSE`, `CIRCLE` | Ellipse and circle outlines (`x,y` is the top-left corner of the bounding box; size and thickness in dots; stroke centered on the box edge). Drawn, moved, edited (**Ancho/Alto** or **Diámetro**, **Grosor**) and inserted from the palette (**Elipse**, **Círculo**). Both commands are from the TSPL2 manual v3.0 (not available locally) and are **not verified on a printer**. TPCL has no equivalent: converting to TPCL skips them with a warning |
| `REVERSE`, `ERASE` | Inverts (`REVERSE`) or blots out (`ERASE`) a region of the image: `x,y,width,height` in dots. Like TPCL `XR` they act on what is drawn **before** them in command order, not on what follows. Drawn, moved, edited (**Ancho**, **Alto**) and inserted from the palette (**Área invertida**, a 30 x 10 mm `REVERSE`; `ERASE` has no palette entry). Both come from the B-442/443 manual (syntax only) and are **not verified on a printer**; the inversion is drawn with the SVG blend mode `difference` (**browser check pending**). Converting to TPCL writes `XR` type `B` / `A` (and the other way round) |
| `BITMAP` | Raw binary graphic (mode 0 overwrite; bit 0 = black, MSB first) |
| `CLS`, `PRINT`, `DENSITY`, `SPEED`, `SET`, `CODEPAGE`, `FEED`... | Configuration: not drawn |

Not supported (a warning is shown): `PDF417`, `MAXICODE` and `PUTBMP`/`PUTPCX`/`PUTPNG`
(images stored in the printer). Also:

- **Images in the code:** the **Imagen** palette entry and **Insertar en el código** write the picture as a TPCL `SG`, a TSPL `BITMAP` or a ZPL `^GF` command, depending on the label's language (none of the formats is verified on a real printer yet). A preview image can still be overlaid to check positions.
- **Palette details:** new items use font `"3"` (text), Code 128 with readable text (barcode), QR with level `M` and cell 4 (always unrotated), Data Matrix with a module of 4 dots (TPCL, rotated like the barcodes; TSPL, with `xm,row,col` of the symbol its placeholder needs), a 40 mm `BAR`, a 30 x 20 mm `BOX`, a 30 x 20 mm `ELLIPSE`, a 20 mm `CIRCLE` (3 dots thick) and a 30 x 10 mm inverted area (`REVERSE`, TPCL `XR` type `B`; inserted after the items already drawn, right before the print command, so it inverts them); texts and barcodes are written rotated so they look upright in the current view. Text and barcode data are `<#NOMBRE#>` placeholders, written literally (TSPL has no substitution).
- `BLOCK` is drawn wrapped (see *Text blocks*); `DIRECTION 0` is drawn as `DIRECTION 1` (no 180° flip) with an
  information message; the QR rotation, the `BITMAP` modes 1 and 2 (drawn as overwrite), and the
  text alignment parameters are read but not drawn; a TSPL counter `@n` without an assigned start value, a mix such as `"x"+@1` and the counters of `BLOCK` and `QRCODE` are shown literally.
- Counters: TPCL increment `n`, TSPL `SET COUNTER @n step` / `@n="start"` and ZPL `^SN` are converted both ways (the start value is the data; TSPL has 50 counters, `@0`-`@49`, with steps up to 999999999). The TPCL zero suppression has no TSPL equivalent and is dropped with one information message; QR codes have no counter in either language.
- **Resolución:** the dots-per-mm of a TSPL label are not in the file, so the **Resolución** selector (203 or 300 dpi) must match
  the printer: coordinates are in dots, so the same label is drawn smaller at 300 dpi.
- **Files with a `BITMAP`:** files opened or dragged (`.prn`, `.tspl`...) are read as bytes, so the graphic data survives, including `0x0D`
  bytes (the code box shows them as a private-use placeholder, U+E00D, because a text box would turn them into line breaks; conversion and
  download write them back as `0x0D`). Pasted text cannot carry arbitrary bytes, so for exact graphics open the file.
- The viewer imitates the printer fonts (as with TPCL): text widths are approximate.

### Text blocks (TSPL, ZPL and TPCL)

The three block languages share one model (`item.block`: width, maximum lines, alignment, extra line space). **Not verified on a printer**; the local TSPL manual (B-442/443) does not describe `BLOCK`, its syntax is the one of the TSC TSPL2 manual as this viewer reads it.

- **TSPL `BLOCK`:** `width` and `height` in dots; the optional arguments are positional (`space` = extra space between lines in dots, `align` = 0 or 1 left, 2 center, 3 right, `fit`). The height holds `floor(height / (character height + space))` lines, which is the block's maximum lines; text past them is not drawn. There is no justification. `\[R]` / `\[L]` (CR / LF) are line breaks, `\["]` a quote. A `BLOCK` with no width is read as a line, with an information message.
- **ZPL `^FBw,l,s,j,h`** before `^FD` (a field modifier like `^FR`): `w` width in dots (0: the printer prints nothing, the viewer draws a line and says so), `l` maximum lines (default **1**; the guide says extra text overwrites the last line, the viewer clips it), `s` extra line space in dots (negative removes space), `j` L C R J (default L; the last line of a justified text stays left), `h` hanging indent (kept, not drawn). `\&` is a line break. With `^FO` the first line starts at the origin; with `^FT` the origin is the baseline of the **last possible line** (the guide), so the first line is `lines - 1` pitches above it. `^SN` does not print inside `^FB` (guide).
- **TPCL `PC ...,P5aaaabbbcc`** (the alignment option `Pq` of the bitmap-font text, automatic line feed): `aaaa` width of the string area 0050..1040 in 0.1 mm, `bbb` line feed spacing 010..500, `cc` number of lines 01..99 (`00` is read as no limit). The manual's figure draws the spacing as the gap between two lines, so it is read as the extra line space of the model (line pitch = character height + `bbb`). **Tested on a TEC printer:** a `PC ...,P5aaaabbbcc` text breaks into lines in the printer (2026-10-09). **The unit of `bbb` is still not verified:** the 2001 Spanish manual (B-452-TS12) says 0.1 mm, the 2004 and 2012 English ones (B-SV4, B-452-R) say "1 mm units", and 010..500 mm would be an absurd line feed, so 0.1 mm is used (the conversion adds an information message). The manuals do not say where a line breaks, so the viewer wraps at spaces and cuts a longer word at the edge, as for the other languages. A block has no alignment (the `P5` token replaces `P1`...`P4`). `PV` (outline font) has no automatic line feed, and with the rotation codes `01`, `12`, `23`, `30` the printer ignores it (the viewer reads those as a line, with an information message; the codes `00`, `11`, `22`, `33` keep the block). Values outside the manual's ranges are read as written, with a warning, and clamped when written.
- **Wrapping in the preview is approximate:** the browser draws the letters with Arial / Times / Courier, so the viewer wraps with one advance per character (mono 0.6 em, sans 0.55 em, bold sans 0.59, serif 0.5, times the horizontal stretch of the font), greedily, cutting a word longer than a line at the edge (the ZPL printer hyphenates it). The line breaks of the drawing can differ a little from the printed ones; the pitch of the lines is the character height plus the extra space (the manuals do not give the line height). Justified text spreads its words (`word-spacing`) except in the last line of each paragraph; centre and right place each line on the block width. A rotated block turns with the text: the lines advance towards the left of the text direction, as with any text.
- **Conversion:** a block keeps its width, lines, alignment, extra line space and line breaks between TSPL and ZPL (`BLOCK` writes `height = lines * pitch`, `^FB` the lines directly; justified goes to TSPL as left with an information message). TPCL (`PC ...,P5`) writes the width, lines and line space (clamped to its ranges, with one warning: the minimum spacing is 010, so a TSPL / ZPL block with no extra space gets 010) but has no alignment (centre, right and justified go left, with an information message) and its data has no line breaks (they become spaces). A block whose font only the `PV` command can write (no bitmap font matches it) is written as **one line of text** with one warning (a `PV` has no block).

## ZPL support (Zebra)

Based on the ZPL II Programming Guide, Volume One (2003) and Volume Two (2005: font matrices, the compression of graphic data, serialized fields and stored formats, check digits). Everything is read, drawn, moved, edited, inserted from the palette and written (**Convertir a…**), like TPCL and TSPL. **Nothing here has been verified on a printer**: what the manuals do not document is marked in the code and collected in *Not verified on a printer* at the end of this section.

### Detection, size and setup

The language is detected from the text (no selector): a label with a `^XA` format, or at least two ZPL commands (`^FO`, `^FD`, `^PW`...), is read as ZPL (TPCL and TSPL are tried first). Files with the `.zpl` extension are accepted by **Abrir archivo…** and by dragging; **Descargar** writes `.zpl` (UTF-8).

- **Size:** `^PW` (width) and `^LL` (length) in dots, shown in the **Formato** row rounded to 0.1 mm. ZPL has no **Paso**. Writing the size from the **Formato** row rewrites or adds `^PW` / `^LL` right after the first `^XA`, keeping the line ending of the file. Sizes are whole dots, so a catalogue size such as 100×60 mm may come back as 100.0×60.1 mm: the **Tamaño etiqueta** combo still marks the standard size, because a ZPL size matches it within one dot (TPCL and TSPL keep the exact match).
- **Resolution:** coordinates are dots, so the **Resolución** selector (203 or 300 dpi) must match the printer: the same label is drawn smaller at 300 dpi. Zebra printers also exist at other resolutions (the guide mentions 600 dpi heads), which the selector does not offer on purpose: there is no 600 dpi printer to test with.
- **Setup read:** `^LH`, `^LS` and `^LT` move every later field, `^FW` (default orientation), `^CF` (default font), `^BY` and `^CI` are kept for the components. `^POI` (label printed rotated 180°) is reported and not applied. Printer configuration commands (`^MM`, `^MN`, `^MT`, `^PR`, `~SD`, `^MD`, `^PQ`...) are recognised and not drawn (one information message per label); a command the viewer does not know is one warning each.
- **Several formats** (`^XA` ... `^XZ`) in one file: the viewer shows the first one and says how many there are.
- **Fields:** a field is `^FO` / `^FT` ... `^FS`; `^FD` data may carry `^` and `~` through the `^FH` hex escapes (`_5E`, `_7E`). `^CC` / `^CT` / `^CD` prefix and delimiter changes are read. `^FO` is the top-left corner and `^FT` the origin of the baseline (text), the base of the bars (barcodes) or the bottom-left corner (shapes, images, 2D symbols); the orientation `N R I B` is 0 / 90 / 180 / 270° clockwise and `^FW` is the default.
- **Components panel:** *Texto*, *Código de barras*, *QR*, *Data Matrix*, *Línea*, *Caja*, *Elipse*, *Círculo*, *Área invertida* and *Imagen* (what each writes is listed under its heading below). The **Plantilla — ZPL** of **Ejemplo** is a ready-made ZPL label to start from.

### Text

A field `^FO x,y ^A f o,h,w ^FD data ^FS` is drawn; a field with only `^FD` / `^FV` is text in the default font `^CF` (A 9×5 at power-up). `^FR` (reverse print) draws the text white blended with `difference`, so it reads inverted over black (and black over white). `^FH` escapes are decoded; `^FP` other than horizontal is reported and drawn left to right; `^FB` makes the field a text block, drawn wrapped (see *Text blocks (TSPL and ZPL)* at the end of the TSPL support section; the ZPL reading of `^FB` is listed there too).

**Fonts** (the matrices are the ones of Volume Two, printed pages 61 and 64-65, by printhead; the drawing is the viewer's simulation, as for TPCL / TSPL: every bitmapped font is drawn with one mono face). The **Resolución** picks the table: 203 dpi is the 8 dots/mm one, 300 dpi the 12 dots/mm one (E and H differ), any other resolution uses the 203 dpi one. Cell height × width in dots at 1×, with the inter-character gap and the baseline of Table 10 (page 61):

| Font | 203 dpi | 300 dpi | Gap | Baseline (from the top of the cell) |
|---|---|---|---|---|
| `A` | 9×5 | 9×5 | 1 | 7 |
| `B` | 11×7 | 11×7 | 2 | 11 |
| `C`, `D` | 18×10 | 18×10 | 2 | 14 |
| `E` (OCR-B) | 28×15 | **42×20** | 5 | 23 |
| `F` | 26×13 | 26×13 | 3 | 21 |
| `G` | 60×40 | 60×40 | 8 | 48 |
| `H` (OCR-A) | 21×13 | **34×22** | 6 (7 at 300 dpi) | 21 |
| `P` | 20×18 | 20×18 | 0 (assumed) | 3/4 of the height (assumed) |
| `Q` | 28×24 | 28×24 | 0 (assumed) | 3/4 (assumed) |
| `R` | 35×31 | 35×31 | 0 (assumed) | 3/4 (assumed) |
| `S` | 40×35 | 40×35 | 0 (assumed) | 3/4 (assumed) |
| `T` | 48×42 | 48×42 | 0 (assumed) | 3/4 (assumed) |
| `U` | 59×53 | 59×53 | 0 (assumed) | 3/4 (assumed) |
| `V` | 80×71 | 80×71 | 0 (assumed) | 3/4 (assumed) |
| `0` (scalable) | 15×12 default | 15×12 default | proportional | 3/4 of the height |

The manual prints font B as "11 x 17" in the matrix column; Table 10 and the inch columns say 11 × 7, which is what is used. The gaps are Table 10's (confirmed at 203 dpi by the chars/inch column: pitch = dpi / chars per inch); at 300 dpi the chars/inch of E is unusable (23.4 is smaller than the cell), so E keeps gap 5 (0.085 in ≈ 25 dots), and H uses 29 dots of pitch (10.20 chars/inch). Fonts P..V are letter fonts (U-L-D) of the matrix column; the manual gives them no chars/inch and no baseline, so gap 0 and the scalable baseline are assumed. **GS** (24×24, SYMBOL) is not offered: it is a symbol font and the manual shows two of its glyphs only (page 60), so nothing honest can be drawn. The baseline is what `^FO` uses to place the text (a bitmapped baseline scales with the magnification and, at 300 dpi, with the height of E and H: assumed). Bitmapped fonts take height and width as multiples of the matrix (1 to 10 times, rounded: `^AD,52` is 3×, like `^AD,54`; a missing one follows the other) and are drawn mono; an `^A` with no sizes uses the sizes of an earlier `^CF` that gave them, whatever its font (page 63), else the standard matrix. `0` is the scalable font (height and width 10 to 32000 dots, a missing one follows the other, 15 × 12 without any), drawn sans bold. Other fonts (GS, 1..9, downloaded) are drawn as a sans font of the asked height, with one information message. The **Fuente** select of Propiedades lists A..H, P..V and 0, with the 203 dpi cell and, where it differs, the 300 dpi one.

**Editing:** a `^A` text has **Fuente**, height, width (0 = standard / proportional), **Rotación**, **Contenido** (`^` and `~` go through `^FH`), **Impresión inversa (^FR)** and the counter fields below; a field with only data has content and reverse. **Palette:** *Texto* inserts `^FO x,y^A0N,h,w^FD<#TEXTOn#>^FS` (4 mm) at the drop point, rotated against the view.

### Linear barcodes

`^BY w,r,h` (module width 1..10 dots, wide / narrow ratio 2.0..3.0, default height; it persists until changed, also across fields) and `^FO x,y ^BC… ^FD data ^FS`. Every command below is generated for real by the same encoders and renderer as TPCL / TSPL (bars, human readable line below, EAN / UPC guard bars, rotation). Parameters not written take the guide's default: orientation = `^FW`, height = `^BY`, interpretation line `Y`, line above `N`.

| Command | Barcode | Parameters (guide, Volume One) | Notes |
|---|---|---|---|
| `^BC` | Code 128 | `o,h,f,g,e,m` | `e` UCC check digit and `m` mode `N` / `U` / `A` (`D` of later guides) are read, kept and **not applied** (one information message). Data with the invocation codes: `>8` FNC1, `>0` `><` `>=` the characters `>` `^` `~`; the start codes and subset changes (`>9` `>:` `>;` `>5` `>6` `>7`) are dropped because the viewer chooses the subsets itself (mode N uses subset B unless a start code is given, so the drawn length can differ: reported); `>1` `>2` `>3` `>4` are reported and dropped. Emit writes the data as it was read, else `>8` and `>0` |
| `^B3` | Code 39 | `o,e,h,f,g` | `e` = Mod 43 check digit. Wide / narrow with the `^BY` ratio |
| `^B2` | Interleaved 2 of 5 | `o,h,f,g,e` | `e` = Mod 10 check digit (an odd number of digits gets a leading 0) |
| `^BE` / `^B8` | EAN-13 / EAN-8 | `o,h,f,g` | The check digit is always calculated. The printer pads / truncates the data on the left (12 / 7 characters); the viewer takes the digits as written and reports a wrong length |
| `^BU` | UPC-A | `o,h,f,g,e` | `e` = print the check digit (default `Y`, kept, not applied); data 11 characters |
| `^B9` | UPC-E | `o,h,f,g,e` | Data = the 10 characters (manufacturer and product code) of the guide: the viewer applies the four zero-suppression rules to draw the 6 digits (data that no rule can shorten is reported and drawn as written). Only number system 0 |
| `^BA` | Code 93 | `o,h,f,g,e` | The two check characters are always in the bars; `e` = print them (default `N`, kept) |
| `^BK` | Codabar (NW7) | `o,e,h,f,g,k,l` | `e` fixed `N`; `k` / `l` = start / stop character `A`..`D` (default `A`); the data has neither, the viewer data carries them like TPCL / TSPL |
| `^BM` | MSI | `o,e,h,f,g,e2` | `e` = `A` none, `B` 1 Mod 10 (default), `C` 2 Mod 10, `D` Mod 11 + Mod 10 (the check options of TPCL: none / auto / IBM 10+10 / IBM 11+10); `e2` is kept |
| `^BI` / `^BJ` | Industrial / Standard 2 of 5 | `o,h,f,g` | `^BJ` is drawn as Industrial 2 of 5 (one information message) and written back as `^BJ` |

The rotated bars are placed from the height and, for 180° / 270°, the length of the bars (measured on the data as written: variables `<#NAME#>` are not substituted), because the viewer rotates a barcode around the top-left of the unrotated bars, which is what TPCL / TSPL give.

**Editing:** **Tipo de código** (all the symbologies above, by writing the whole command again: the layouts differ; `^FO` / `^FT`, the data and the other commands stay), **Dígito de control** (Code 39: none / Mod 43; ITF: none / Mod 10; MSI: the four options; the others have one), height, rotation, human readable line, line above, **Módulo (puntos, ^BY)**, **Relación ancho / estrecho (^BY)** (the wide / narrow symbologies), the command's own options (print check digit, UCC check and mode, Codabar start / stop) and the content. A change of type is refused when it would lose a Code 128 invocation code, a UCC check or mode, a Codabar start / stop character or an MSI `e2`. The module and ratio are `^BY` values that persist: when the `^BY` that governs the barcode belongs to it alone it is rewritten in place; when it also governs other barcodes, a `^BY` with the new value is written right before the field and one with the previous value right after its `^FS`, so the others do not change (a barcode with no `^BY` and no neighbours gets a plain `^BY` before it).
**Writing:** every barcode field is preceded by its own `^BY` (module, and the ratio for the wide / narrow symbologies). **Palette:** *Código de barras* inserts `^BY2,3,h ^FO x,y ^BCN,h,Y,N,N ^FD<#CODIGOn#> ^FS` (Code 128, 8 mm), rotated against the view.

### QR and Data Matrix

Generated for real by the same generators and renderers as TPCL / TSPL. `^BY` has no effect on them except the height for a Data Matrix without module.

| Command | Symbol | Parameters (guide, Volume One) | Notes |
|---|---|---|---|
| `^BQ` | QR Code | `a,b,c` | `a` orientation: **fixed** (normal, `^FW` has no effect; another letter is reported once and ignored, so the QR is never rotated); `b` model 1 / 2 (default 2; the viewer draws model 1 as model 2, one information message); `c` magnification 1..10 = dots per module (default by resolution: 150 dpi 1, 200 dpi 2, 300 dpi 3, 600 dpi 6; the nearest one for 203 / 254 dpi). The **field data** carries the level and the input mode: `^FD` `<H\|Q\|M\|L>` `<A\|M>` `,` data (`QA,0123 2D code`). Automatic input `A`: the data follows. Manual input `M`: the data starts with the character mode `N` numeric, `A` alphanumeric, `B` + 4 digits (byte count) + bytes, `K` kanji (segments separated by commas); the viewer strips the prefixes. The mixed mode (`D<code><divisions><parity>,` before the level) is reported and drawn as the joined data (code number and divisions are not modelled). Data without the prefix is drawn as written with level `M` (one warning). Emit writes `^BQN,2,<mag>^FD<ECC>A,<data>` (the manual and mixed forms read from a ZPL file are written back as read while the data and the level are unchanged) |
| `^BX` | Data Matrix | `o,h,s,c,r,f,g` | `o` orientation `N R I B` (default `^FW`); `h` module in dots (1..9999; **0 or omitted: the `^BY` height divided by the symbol side**, rounded, at least 1; emit always writes it explicitly); `s` quality, **default 0**: only **200** (ECC 200) is drawn, 0 / 50 / 80 / 100 / 140 are kept and reported ("ECC n no soportado", hatched box, like TPCL's ECC types); `c`, `r` columns and rows: both equal and one of the 24 square sizes force the size (quality 200); a rectangle (18×8, 32×8, 26×12, 36×12, 36×16, 48×16) is reported and drawn as the smallest square that fits; any other combination, or only one of the two, is reported and automatic; `f` format ID and `g` escape character (default `_`) are kept. In quality 200 data `__` is one underscore; the other escape sequences (`_1`, `_d123`, `_5009`...) are **not interpreted** (one warning, encoded as written). The encoder is ASCII encodation only (see the limitations) |

`^FO` is the top-left corner of the symbol (for a Data Matrix, of the box of the rotated symbol: the symbol turns around its origin, so the anchor is moved by the side of the symbol for `R`, `I` and `B`) and `^FT` its bottom-left corner; the symbol is drawn from the origin without a quiet zone, as for TPCL and TSPL. The side used for `^FT` and the rotated Data Matrix is measured on the data as written.

**Editing:** QR: **Magnificación**, **Corrección de errores** (the level letter of the field data, also in the mixed mode), **Modelo** and **Contenido** (the data after the prefix, which stays; not offered in manual or mixed mode); Data Matrix: **Módulo (puntos)** (an omitted or 0 module shows the one derived from `^BY`), **Tamaño del símbolo** (automatic or one of the 24 square sizes; quality 200 only: it writes `c` and `r` together), **Rotación** and **Contenido** (in quality 200 the field data as written: type `__` for an underscore). `^` and `~` go through `^FH`. **Palette:** *QR* inserts `^FO x,y^BQN,2,4^FDMA,<#QRn#>^FS` (always unrotated); *Data Matrix* inserts `^FO x,y^BXN,4,200^FD<#DATAMATRIXn#>^FS`, rotated against the view.

### Shapes and reverse print

Lines, boxes, circles, ellipses, diagonals and the inverted / cleared areas, drawn in command order (a reverse area only inverts what came before it).

| Command | Item | Parameters (guide, Volume One) | Notes |
|---|---|---|---|
| `^GB` | Box (outline) | `w,h,t,c,r` | `w`, `h` outer size in dots (from `t` to 32000; a smaller value is raised to `t`, so `^GB0,100,20` is a vertical line 20 wide; default `t` or 1), `t` thickness 1..32000 (default 1, grows **inward**), `c` colour `B` / `W` (default `B`), `r` rounding degree 0..8 (default 0). **Radius = (r / 8) × (shorter side / 2)** (guide's formula). An outline is a box with the neutral line stroked on its centre line: the rectangle inset by `t / 2` and the radius reduced by `t / 2` (a thick border can swallow a small radius: the degree is kept) |
| `^GB` | Bar (line) | `w,h,t` | A box whose border meets in the middle (**2t >= the shorter side**, assumed) and is black is a bar (the neutral line along the longer side, like TSPL `BAR`); a solid black box with rounded corners is drawn as a thick rounded rectangle |
| `^GB` + `^FR` / `^LRY` | Inverted area | `w,h,t,,r` | A solid box with `^FR`: the **area that inverts** what is already drawn (white rectangle blended with `difference`, like TPCL `XR;B` and TSPL `REVERSE`). An outline with `^FR` is a reversed box (white stroke with the blend). Rounded corners on an area are drawn square (one information message) |
| `^GB` colour `W` | Cleared area / white box | `w,h,t,W,r` | A solid white box clears (white over what is drawn: TPCL `XR;A`, TSPL `ERASE`); a white outline is a box drawn in white. `^FR` on a white shape is ignored and drawn white (one information message) |
| `^GD` | Diagonal line | `w,h,t,c,o` | `w`, `h` 3..32000 the box it crosses, `o` = `R` (or `/`, default): from the bottom-left to the top-right, `L` (or `\`): from the top-left to the bottom-right; the line runs along the centre of its thickness from corner to corner |
| `^GC` | Circle | `d,t,c` | `d` diameter 3..4095 (larger values are replaced by 4095), `t` 2..4095 per the guide's table (its default is 1), the thickness grows **inward** (the neutral ellipse is inset by `t / 2`); a thickness over half the diameter is a solid disc |
| `^GE` | Ellipse | `w,h,t,c` | The same for `w` x `h` (default `t` or 1) |

`^FO` is the top-left corner of the shape and `^FT` the **bottom-left** corner. **`^FR`** reverses one field (the output colour is the opposite of its background); **`^LRY`** does it for every field opened after it until **`^LRN`** (the guide: "identical to placing an `^FR` in all current and subsequent fields"). In the viewer `^FR` / `^LR` reverse text, boxes, ellipses, diagonals and areas; over bar codes, QR, Data Matrix and images the field is drawn normally with one information message per label. The emit **never writes `^LR`**: each reversed item gets its own `^FR`.

**Writing:** the corners plus `t / 2` become the outer box `^FOx,y ^GBw,h,t[,B[,r]]`; the radius becomes the **nearest rounding degree** (0..8, one information message when it cannot reproduce the radius); a thickness over 32000 (`^GB` / `^GD`), under 2 or over 4095 (`^GC` / `^GE`), a size over 4095 and a diagonal under 3 dots are limited with a warning; a horizontal / vertical line is a bar `^GB`, a slanted one `^GD` (`R` when it goes up to the right); a circle item is `^GC` (equal axes), everything else `^GE`; an area is `^GB w,h,min(w,h)^FR` (inverted) or `^GB w,h,min(w,h),W` (cleared).
**Editing:** a **box** has width, height, thickness, **rounding degree** (the nine degrees, each labelled with its shape), colour and **Impresión inversa (^FR)**; a **bar** has length, thickness and orientation; a **diagonal** has width, height, thickness, orientation (`R` / `L`), colour and reverse; a **circle** has diameter, thickness, colour and reverse; an **ellipse** width, height, thickness, colour and reverse; an **area** has width, height (the thickness follows the shorter side so it stays solid) and the **mode** (Invertir = `^FR`, Borrar = colour `W`). Under `^LRY` the reverse checkbox reads checked (the field is reversed) and checking it adds nothing; to turn it off edit the `^LR` commands. All shapes move with `^FO` / `^FT`.
**Palette:** *Línea* inserts `^FO x,y^GB<40 mm>,3,3^FS`, *Caja* `^GB<30 mm>,<20 mm>,3,B,0`, *Elipse* `^GE<30 mm>,<20 mm>,3`, *Círculo* `^GC<20 mm>,3` and *Área invertida* `^GB<30 mm>,<10 mm>,<10 mm>^FR`, all at the drop point (sizes in dots at the label's resolution).

### Images (`^GF`)

`^FO x,y ^GFa,b,c,d,data ^FS` is drawn as an image (`a` format, `b` bytes sent, `c` total bytes of the image, `d` bytes per row; the bitmap is `d * 8` dots wide and `c / d` rows high, 1 = black, the leftmost dot is the highest bit). `^FO` is the top-left corner and `^FT` the **bottom-left** corner.

- **Read:** format **A** (ASCII hexadecimal, two digits per byte; line breaks may be inserted; a comma pads the row with 0), plain or with the **run-length compression** of Volume Two (page 52: `G`..`Y` = repeat 1..19, `g`..`z` = 20..400 in steps of 20, added together, so `MvB` is 327 `B`; `,` fills the rest of the line with 0, `!` with 1, `:` repeats the previous line), or format **A** with **B64** data (`:B64:<Base64>:<crc>`, page 112: the image bytes in MIME Base64, line breaks allowed; the CRC is not checked because the manual gives no algorithm, one information message says so). Counts out of 1..99999 are set to the nearest limit with a warning; a missing `b`, `c` or `d` ignores the command (warning); `b` and `c` that differ, a total that is not a multiple of the row size, characters that are not hex, data that is too short (padded with white) or too long (ignored after `c` bytes) are warnings.
- **Compression policy:** Volume Two documents the compression for `~DG` and `~DB` (page 52; page 53 repeats the comma, `!` and `:` for the `~DG` download time) and the B64 / Z64 encodings "in place of the ASCII hexadecimal encoding in any download command", `^GF` included (page 112), but it has no `^GF` reference and Volume One's `^GF` text only has the comma. So by default an image is written with ASCII hexadecimal data where the trailing `00` bytes of a row become one comma (a zero row is just `,`), the only shortening documented for `^GF`. The run-length compression is read, and written back (when shorter) only for an image that was read compressed: inserted, converted and moved-without-native images never get it. Rows are whole bytes, so a width that is not a multiple of 8 gains white columns; a bitmap over **99999 bytes** (the guide's limit) is skipped with a warning when writing a file, and refused with an error when inserting.
- **Insertion:** the **Imagen** palette entry and **Insertar en el código** (with the **Rotación** and **Umbral** controls) write the picture as a `^FO x,y^GFA…^FS` field before `^XZ`; the rotated dots are what is written. An image in the code only moves (`^FO` / `^FT`): its `^GF` data is never rewritten and it has no properties.
- **Not supported (one warning each, nothing is drawn):** the binary forms `^GFB` / `^GFC` (binary data does not fit in a text box), Z64 data (`:Z64:`, LZ77 + Base64: it needs a synchronous inflate (the manual's example starts with `H4sI`, a gzip header, and does not say zlib or gzip) and the CRC algorithm, which the manual does not give), and the images stored in the printer (`~DG`, `~DY`, `^IM`, `^IL`, `^XG`: the data is not in the label).

### Counters (`^SN`)

`^SN v,n,z` replaces `^FD` in a text or bar code field: `v` is the start value (default 1; the data may carry letters, and Volume Two page 41 says the first digit found scanning from the right starts the indexed part, 12 digits at most: the manual's `^SNSERIAL NUMBER 00000000111,1,Y` is read and written back as it is), `n` the increment (default 1, a minus sign decrements, 12 digits at most) and `z` = `Y` prints the leading zeros, `N` (the default) replaces them by spaces. The field is drawn like a `^FD` one with the **start value** (the printer increments it on every label of `^PQ`; one information message says so); `z` = `N` is the zero suppression that keeps the last digit (`001` is drawn `  1`, `000` `  0`; exact for numeric values, a mixed text such as `00A12` is not modelled), only in the preview. An increment of 0 is a plain field.

- **Editing:** **Incremento** (signed) and **Ceros iniciales** (checkbox, only on a `^SN`) in Propiedades; **Contenido** of a counter is its start value (`^SN` first argument, which cannot carry commas, `^`, `~`, blanks at the ends or variables, and needs a digit). Setting **Incremento** to 0 turns the `^SN` back into a `^FD` with the start value (the zero suppression is gone with it); a value other than 0 on a plain `^FD` that `^SN` can carry writes `^SN data,step,Y`.
- **Writing:** a counter is written as `^SN start,step,Y` (`N` with zero suppression); what `^SN` cannot carry (no digit, a comma, `^` or `~`) is written as a plain `^FD` with one warning; a step beyond ±999999999999 is clamped (warning); TPCL's "characters kept" of the zero suppression becomes `N` (ZPL has no count: one information message) and a zero suppression without a counter is dropped (information).
- QR and Data Matrix with `^SN` read the start value as data (one information message: the counter is not modelled for 2D codes). **`^SF`** (the mask form: `%`, `D`, `A`, `N`, `O`, `H`) is **not modelled**: the field is drawn with its `^FD` text, without counter, with one warning.

### Field variables (`^FN`) and stored formats

`^FN n` (0..9999, `^FN` alone is 0; `^FN n"prompt"` is of later guides and is only read) is the app's variable `<#FNn#>`: the field is drawn with the `^FD` data it has as the **default test value** (shown in **Variables** and in the **Valores de prueba** of Propiedades, and replaced by what you type there; one information message says so). The same `^FN` in several fields is one variable and the `^FD` of any of them is the default (guide). The default is the only value the label itself suggests: it fills a test value that has none yet and never overwrites one you typed. A ZPL file round-trips: the fields are written back as `^FNn["prompt"][^FDdefault]`. A QR / Data Matrix with `^FN` keeps its `^FD` data (one information message). `^FV` reads like `^FD`.

- **`^DF`** (store the format as a template) is ignored with one information message and its fields are drawn as a normal label.
- **`^XF`** (recall a template stored on the printer) is one warning, "plantilla almacenada no disponible": the `^FN` fields of a recall format that have no position are data for that template, so they are not drawn. Volume Two (exercise 6, pages 35-37, and page 43) shows what a recall does (the `^FN` data is merged into the positions of the stored format) but the viewer does not store formats, so only the first format of the file is drawn, with its `^FN` fields as variables.
- **`^FA`** (field allocate, used with `^FN` in a stored format, Volume Two page 43) is recognised and has no effect on the drawing (it is listed in the information message of the setup commands without effect).
- In the other languages the placeholders are plain text: converting an `^FN` field to TPCL / TSPL writes `<#FNn#>` as data, and `#NAME#` placeholders converted to ZPL are written as literal text in `^FD` (one information message).

### Not supported

Reported and not drawn (a warning each; `^DF`, `^POI` and the extra formats of a file are information messages): PDF417 and MicroPDF417 (`^B7`, `^BF`), MaxiCode (`^BD`), the other `^B*` symbologies (Postnet, Planet, Code 11, LOGMARS, Plessey, Code 49, Codablock...), the images stored in the printer (`~DG`, `~DY`, `^IM`, `^IL`, `^XG`), binary `^GFB` / `^GFC` and Z64 data (B64 is read), `^DF` / `^XF` stored formats, the `^SF` mask serialization, `^POI` and the second and later formats of a file.

### Conversion

**Convertir a…** lists **ZPL (Zebra)** as a target and reads ZPL as a source; see that section for the exact / approximated / lost table. Specific to ZPL: the fonts are mapped to the nearest one (mono multiples of a matrix become a bitmapped font, the rest the scalable `0`); ZPL has no EAN / UPC add-ons and no TPCL price check digits (written with one warning); TSPL has no MSI and no Industrial 2 of 5; a ZPL box is the outer box of the neutral rectangle, so its border grows outward by `t / 2` from the TPCL / TSPL corners; the corner radius is quantised to the nine ZPL rounding degrees; images convert with TPCL `SG` and TSPL `BITMAP` (ZPL 1 = black, TPCL nibble data, TSPL inverted bits).

### Not verified on a printer

Nothing in the ZPL support or in the conversions has been tried on a printer. Beyond that, neither Volume One (2003) nor Volume Two (2005) documents (so the viewer assumes it, and the code says so); what Volume Two settled is listed first:

- **Settled by Volume Two:** the font matrices by printhead and fonts P..V, the inter-character gap and the baseline of `^FO` text (font 0: 3/4 of the height), B being 11 × 7, the `^A` without sizes after a `^CF` with sizes, the compression scheme of the graphic data (for `~DG` / `~DB`) and the B64 format, the examples of serialized fields, stored formats (what a recall looks like), the Mod 10 (for an odd number of digits) and Mod 43 check digits, and that the default character set is Code Page 850.

- **Text:** the gap and the baseline of the fonts P..V (gap 0 and 3/4 assumed), whether the baseline scales with the magnification and with the 300 dpi matrices of E and H (assumed), the look of the glyphs (one mono face for every bitmapped font), the width of the scalable font 0 (proportional in the manual; the advance is an approximation), the length of a `^FO` text rotated 180° / 270°, GS (symbol font, not offered), `^LS` / `^LT` as applied, whether the settings of one format carry to the next, `^FO`'s third parameter (accepted and ignored). Volume One's missing-size rule (the standard matrix) and Volume Two's (the `^CF` sizes) only agree when there is no `^CF` with sizes: the later manual is followed.
- **Barcodes:** the default `^BY` ratio (the guides give the initial module 2 and height 10; Volume Two only lists the ratio ranges 2.0 - 3.0 or fixed per symbology, so 3.0 is assumed), the quiet zone of the linear codes (Volume Two says only "usually 10 times the narrow bar" in general), the Mod 10 check digit of an Interleaved 2 of 5 with an even number of digits (Volume Two page 96 counts every other digit from the first position, the viewer weighs from the last digit: the same for an odd number of digits), the `^FO` box of rotated bars (bars only), whether it holds the interpretation line, the line above the code (drawn below) and the rounding of the wide bar (Table J of the guide, rounded down).
- **QR and Data Matrix:** the origin of 2D symbols with `^FT` (the guide defines it for text, bar codes, boxes and images), the quiet zone, the ECC 200 range of columns and rows (the guide says 9 to 49 and also 10 to 144), the default for a missing ECC prefix of the QR data, the divisions of the mixed mode (the joined data is drawn), the Data Matrix encodation and its escape sequences (reported, not interpreted).
- **Shapes:** the geometry (the thickness grows inward from the outer box), when a border is solid (2t >= the shorter side), the `^FT` origin of `^GD` / `^GC` / `^GE`, where a `^GD` line with thickness lies in its box, and what `^FR` does to a white shape.
- **Images:** whether a printer accepts the compressed form in a `^GFA` field (Volume Two documents it for `~DG` / `~DB`, not for `^GF`, so the emitter writes it only for an image read compressed), the behaviour of `:` or a repeat count in odd places, the CRC of B64 (no algorithm, not checked), what a B64 `^GF` counts in its `b` parameter (not checked) and Z64 (not read).
- **Counters and variables:** what `n` = 0 does, the zero suppression of mixed text (the indexed digits are settled, the replacement by spaces of the suppressed zeros is only drawn for numeric values), `^SN` on 2D codes and with `^FN`, the quoted prompt `^FN n"prompt"`, `^FN` with 2D codes. Volume Two says a stored format is recalled with `^FN` data merged in, but that is not simulated.
- **Files:** UTF-8 (the guides tie characters above ASCII to `^CI` and the printer font and do not mention UTF-8; Volume Two says the standard Zebra character set is Code Page 850 above 20 hex, so UTF-8 bytes above ASCII are not what a printer expects by default).
- **Not in either manual:** the origin (`^FT`) and the quiet zone of QR and Data Matrix, the geometry of the shapes (the thickness grows inward, when a border is solid, the `^FT` origin of `^GD` / `^GC` / `^GE`, `^FR` on a white shape; Volume Two only says that `^GB` draws boxes and lines), the `^FO` box of rotated bars, the ECC 200 range, the QR mixed mode and the Data Matrix encodation: Volume Two has no command reference and adds nothing.

## Limitations

- **ZPL:** the unsupported commands (PDF417 / MicroPDF417, MaxiCode, the other `^B*` symbologies, stored images, binary `^GF`) and everything the manuals do not document are listed in *ZPL support*; nothing of ZPL has been verified on a printer. Only 203 and 300 dpi can be selected.
- **Conversion:** nothing a conversion writes has been verified on a printer (see **Convertir a…** for what is lost in each direction).
- The printer letters are imitated with Arial / Times / Courier: the **width of the texts is approximate**. To
  adjust fine margins, always make a test print.
- The overlap warnings are based on that approximate width: if two texts are very tight, check it on paper.
- Code39 and ITF follow the `XB` layout of the legacy `[ESC]XB` form of the Toshiba B-SX4T manual. The `{XB…|}`
  form is the same command, but it has **not been verified** for the B-EX4 / B-FV4 / B-EP4 models.
- Code39: check digit options `1` (none) and `3` (modulo 43) are drawn; any other option is drawn without check
  character and reported. Full ASCII (type `B`) is not supported: characters outside standard Code39 (for example
  lowercase letters) are reported and the barcode is not drawn. The start/stop option (`T`, `P`, `N`) has not been
  verified: the viewer always draws the automatic `*`.
- EAN-13, EAN-8, UPC-A and UPC-E (TPCL types `5 7 8 0 I J K L M 6 G H`, TSPL `EAN13 EAN13+2 EAN13+5 EAN8... UPCA... UPCE...`): the bars, guard bars and digit layout follow the usual symbology
  (95, 67, 95 and 51 modules; the add-on starts 9 modules after the symbol; EAN-13 / UPC / UPC-E digits outside the bars are drawn in the quiet zone, the add-on digits above its bars).
  The data is the digits (12 or 13 for EAN-13, 7 or 8 for EAN-8, 11 or 12 for UPC-A, 6, 7 or 8 for UPC-E: number system 0 or 1, six digits, check digit), followed by the 2 or 5 add-on digits;
  a missing check digit is computed (modulus 10) and a wrong one is reported (the digits are drawn as given); UPC-E gets its check digit through the equivalent UPC-A. TPCL check options
  `1` (none), `2` (check) and `3` (auto attach) are drawn; the price check digit options `4` / `5` are drawn as automatic and reported. **Not documented by the manuals, so
  not verified on a printer:** how the data of an add-on type is given (the viewer takes base digits + add-on digits), the number of digits the printer accepts for each type, what `2` / `1` do
  when the data does not match, whether the printer prints the digits under the bars (TPCL `p` flag, TSPL human readable) with its own layout, the exact meaning of the TPCL WPC
  guard bar length (the viewer extends the start, centre and end guard bars by that length in 0.1 mm; without the field, as in TSPL, by the height of the digits when they are printed) and the TSPL wide
  argument (written equal to the narrow one). Check the placement of the digits, guard bars and add-on in a browser and on a printer.
- Data Matrix (TPCL `XB` type `Q`, TSPL `DMATRIX`): the encoder is our own (no library) and covers **ECC200 with ASCII encodation and square symbols only** (the 24 sizes from 10 x 10 to 144 x 144;
  the smallest one that holds the data unless a size is forced). Digit pairs take one codeword, other characters 0-255 one (128-255 with the upper shift), up to 1558 codewords. Not supported, reported and drawn as a hatched box: ECC 000-140,
  characters above 255, more data than 144 x 144 holds, the connection setting (structured append), FNC1 / GS1 mode and the rectangular sizes (a forced rectangle falls back to the smallest square). C40, Text, X12, EDIFACT and Base 256
  are not used: **the printer chooses its own encodation and symbol size, so for long or mixed data the printed symbol can differ in size from the drawing** (the drawing is always a valid symbol that decodes to the same data).
  The ISO/IEC 16022 standard was not available: the size table (capacity, error correction codewords, Reed-Solomon blocks, regions) and the module placement were typed from memory and are validated by properties (see tests/datamatrix-encoder.test.js:
  capacity against the manual's numeric capacity table, codewords = modules / 8, Reed-Solomon syndromes of every block, every codeword bit placed exactly once, an independent decoder round trip, and the worked example of 123456 remembered from the standard).
  **Checked with an independent decoder:** the symbols of all 24 sizes (including every multi-region size and the four corner patterns), forced and
  smallest-fit, decode with the ZXing DataMatrix reader to the same text (a check done outside the repository, which has no dependencies); that check found and fixed
  the 144 x 144 quirk (its error-correction interleave starts at the first shorter block).
  **Not verified on a printer or with a phone scanner:** scan the drawn symbol with a phone and compare it with a printed label before relying on it. Not documented by the manuals: how TSPL `DMATRIX` places the symbol in `width` x `height`, whether `xm,row,col` can be partly omitted, the module limits of TSPL,
  and the printer's choice of encodation. The viewer draws no quiet zone (like QR).
- Code 93, NW7 / Codabar, MSI and Industrial 2 of 5 (TPCL types `C 4 1 O`; TSPL `93` and `CODA`, which are the only ones the B-442/443 manual lists): drawn for real with their usual symbol tables, the module / wide / narrow
  widths of the command and the text under the bars when the label asks for it. What the manuals say: Code 93 is in the generic TPCL form (check option 1 none, 2 check, 3 attach modulus 47); MSI, NW7 and Industrial 2 of 5
  are in the widths form with the check options 1 to 3 (MSI also 4 and 5, see the table above), MSI with the character-to-character space fixed to 00 and Industrial 2 of 5 with the wide space fixed to 00 (the narrow space is
  its element-to-element space), and the start/stop option `T` / `P` / `N` (start only, stop only, none; omitted = attached automatically). **Not documented, so assumed and not verified on a printer:**
  - Start/stop option `T` / `P` / `N`: kept in the file and carried between the widths-form types, but the viewer always draws the automatic start and stop (it reports it).
  - Code 93: the viewer draws only the 43 standard characters (full ASCII needs shift characters: other characters are reported and the barcode is not drawn); check "automatic" attaches C and K
    (weights 1..20 and 1..15 from the right, modulo 47); "check" draws the data as given and reports wrong characters; the human-readable text is the data without start, stop or check characters. TSPL `93` has no check option: the viewer
    assumes the check characters are attached. TSPL wide argument for Code 93: written as 2 x narrow (the manual's table lists the type with 1:2, 1:3 and 2:5 only).
  - NW7: the data may carry its own start / stop letters (A-D); when one is missing the viewer adds an A (the manual only says the printer attaches the start / stop code automatically). The text under the bars is the data as written. The manuals document no check option for NW7.
  - MSI: bit 1 = wide bar + narrow space, bit 0 = narrow bar + wide space, start = wide bar + narrow space, stop = narrow bar + wide space + narrow bar. "IBM modulus 10" is read as the usual MSI modulus 10 (double every second digit from the right,
    sum the digits of the products); "IBM modulus 11" as weights 2..7 from the right (a result of 10 is written as 0 and reported). Option 2 (check) verifies the last digit as IBM modulus 10.
  - Industrial 2 of 5: the manual does not give the start / stop patterns (the viewer uses wide-wide-narrow bars and wide-narrow-wide bars, all spaces narrow) nor the "modulus check character" (the viewer uses modulus 10, weights 3 and 1 from the right).
  - Without explicit widths the wide elements are 3 x the module; TSPL `CODA` follows the manual's ratios (1:2, 1:3, 2:5).
- ITF: only check digit option `1` (none) is drawn; options 2 to 5 are drawn without check digit and reported. The
  printer's behavior with an **odd number of digits is not verified**: the viewer draws a leading `0` and reports it.
  Non-digit characters are reported and not drawn.
