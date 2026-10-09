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
- [ ] B2 Emit + conversion: TSPL BLOCK / ZPL ^FB written from a block; TPCL warns and writes one line; conversion matrix + cross-conversion
      cases for blocks; ZPL's "not implemented ^FB" diagnostics go away.
- [ ] B3 Properties: the **Tipo** select (values per language), block fields, rewriting through the language edit engines (undo works).
- [ ] B4 Tests, README (text block, limits, the wrap approximation), CONTRIBUTING, a template / palette check, Chrome probe.

## Acceptance
`node --test` green; in the app: a TSPL / ZPL text switched to "Bloque de texto" wraps in the preview, the width / lines / alignment edit the
command, back to "Línea" removes the block; a TPCL text offers only "Línea de texto"; conversions TSPL <-> ZPL keep the block.

## Progress
