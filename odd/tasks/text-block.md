# Text block (TSPL BLOCK, ZPL ^FB) and the "Tipo" selector in Propiedades

Branch: `feat/text-block`. Strategy: single PR if it fits, else `ask-on-risk`.

## Objective
Texts can be a line (today) or a block: text wrapped in a given width, with a maximum number of lines and an alignment. The Propiedades
form of a text gets a **Tipo** select whose valid values depend on the language of the label; choosing a block shows the block fields.

## Decisions (user, 2026-10-09)
- Where: the Propiedades section, one **Tipo** select at the start of the text form.
- Values by language: TPCL -> only "Línea de texto" (TPCL has no text block in any of the four manuals; a note says so); TSPL -> "Línea de texto"
  (`TEXT`) / "Bloque de texto" (`BLOCK`); ZPL -> "Línea de texto" / "Bloque de texto" (`^FB` before `^FD`).
- Block fields: width, maximum lines, alignment (left / center / right / justified) and, where the language has it, the line spacing.
  Changing the Tipo rewrites the command (TEXT <-> BLOCK in TSPL; `^FB` added / removed in ZPL).
- Palette keeps one "Texto" entry (inserts a line); the block comes from the Tipo select.
- Drawing: the viewer wraps the text with an approximate character measure; line breaks may differ a little from the printer (README note).
- Conversion: a block carries its width, lines and alignment between TSPL and ZPL; towards TPCL it is written as a one-line text with a warning.
- Out of scope: `^SF` (mask) stays for its own task.

## Tasks
- [x] B1 Model + rendering: neutral `text.block?` (width, lines, align, spacing...), wrapping in the SVG renderer, TSPL `BLOCK` and ZPL `^FB` read
      into it (and `\&` line breaks of ZPL / `\["]`-style escapes of TSPL), documented in js/core/model.js.
- [x] B2 Emit + conversion: TSPL BLOCK / ZPL ^FB written from a block; TPCL warns and writes one line; conversion matrix + cross-conversion
      cases for blocks; ZPL's "not implemented ^FB" diagnostics go away.
- [x] B3 Properties: the **Tipo** select (values per language), block fields, rewriting through the language edit engines (undo works).
- [x] B4 Tests, README (text block, limits, the wrap approximation), CONTRIBUTING, a template / palette check, Chrome probe.

## Acceptance
`node --test` green; in the app: a TSPL / ZPL text switched to "Bloque de texto" wraps in the preview, the width / lines / alignment edit the
command, back to "Línea" removes the block; a TPCL text offers only "Línea de texto"; conversions TSPL <-> ZPL keep the block.

## Progress
- B1 done (7202586): item.block in the neutral model (js/core/model.js), wrapBlock + tspans in the SVG renderer, TSPL BLOCK and ZPL ^FB readers.
- B2 done (fbea11a): TSPL BLOCK / ZPL ^FB emit, TPCL one-line text with one warning, matrix + cross-conversion cases.
- B3 done (2ecde68): Tipo select per language (TSPL TEXT <-> BLOCK through the shape `reemit` hook, ZPL ^FB added / removed through a custom field, TPCL a disabled one-option select with a note), block fields (width, lines, alignment, ZPL line space), one rewritten text per change (Ctrl+Z checked in Chrome).
- B4 done (this commit): README (Tipo, Text blocks section, conversion row, ZPL limits), odd/tasks/zpl-support.md note, Chrome probe run outside the repo (TSPL and ZPL templates: Tipo -> block, width / lines / alignment edit the code and the preview wraps, back to line restores the text, Ctrl+Z; TPCL: Tipo offers only the line; no page errors).
- Decisions taken without the user (open for review): default block width = 20 characters of the font (not the remaining label width: the edit engines do not know the label size); default lines = what the wrapped text needs; ZPL ^FB keeps the guide default of 1 line only when written without the argument; the "extra line pitch" = character height + space (the manuals give no line height); TSPL has no justification (written left with an info); ^FT blocks: lines / line space edits move the first line (the guide: ^FT is the baseline of the last line), only the Tipo change keeps it.
- Correction (feat/tpcl-text-types): the statement "TPCL has no text block" above is wrong. The PC alignment option `P5aaaabbbcc` (automatic line feed) is a text block; see odd/tasks/tpcl-text-types.md. The TPCL Tipo select now offers the block for PC texts, and a TSPL / ZPL block becomes `PC ...,P5` when its font maps to a bitmap PC font.
