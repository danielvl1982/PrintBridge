/**
 * PrintBridge core, independent of the printer language: diagnostics, units, variables,
 * language registry, neutral validation and label sizes.
 * Each language (TPCL, ...) lives in js/languages/ and registers itself in PB.languages.
 *
 * Neutral model: what parse(text, { dpi }) of any language returns and what the drawing and the emitters consume.
 * Every measure in the model is real, in 0.1 mm; the language converts with dpi the ones it gives in printer dots
 * and keeps the original value in item.native for its emitter.
 *   model { language, size, items, diagnostics }
 *   - language: id of the language that parsed it (key of PB.languages).
 *   - size: { width, height, pitch, gap, native }. Measures in 0.1 mm (null if the label does not declare them);
 *     pitch = distance between labels, gap = separation between labels; native = language-specific data
 *     (TPCL: dRaw, axRaw), which only that language interprets.
 *   - items (every measure in 0.1 mm, rotation in degrees clockwise):
 *       text    { ref, x, y, rotation, font:{ size, scaleX, family, weight, style }, data }
 *               font.size = height of the letter square (em) in 0.1 mm; scaleX = horizontal stretch;
 *               family = serif | sans | mono; weight = 400 | 700; style = normal | italic
 *               attribute? = { kind: 'reverse' | 'box' | 'strike', h, v?, native?: { h, v? }, defaultDots } (TPCL PC/PV attribute,
 *               absent = black); h/v = distance from the string to the end of the background / box / stroke in 0.1 mm (strike: h
 *               only), native = the dots written in the file (absent when omitted), defaultDots = the manual default in dots
 *               align? = { kind: 'center' | 'right' | 'equal', width? } (TPCL Pq / Po alignment relative to x; absent = left;
 *               width = the string area of an equal space in 0.1 mm, 50..1040)
 *               spacing? = { value, native } (TPCL ghh / ghhh character spacing: native = the signed printer DOTS as written, PC
 *               -99..99, PV -512..512; value = the same distance in 0.1 mm, signed; absent = none or 0)
 *               bold? = { h, v, native: { h, v } } (TPCL PC Jkkll bold overprint: native = the shift in printer DOTS as written,
 *               0..16 each; h, v = the same shifts in 0.1 mm; absent = none)
 *       qr      { ref, x, y, ecc, cell, symbology:'qr', native:{ type, cell }, data }
 *               cell = side of each module in 0.1 mm (native.cell = the language's value, in dots)
 *               neutral ecc: 'L' | 'M' | 'Q' | 'H'; each language translates it to its own letter (TPCL: inside tpcl.js)
 *       barcode { ref, x, y, rotation, module, height, humanReadable, symbology, native:{ type, module }, data,
 *                 widths?, interCharGap?, check? }
 *               module = width of the narrowest module and height = height of the bars, both in 0.1 mm
 *               neutral symbology: code128 | code39 | itf | ean13 | qr | unknown; native.type = the language's code.
 *               Exact (generated for real): code128, code39, itf; the others are drawn approximately.
 *               Code 39 and ITF only (wide/narrow symbologies), all optional:
 *                 widths = { narrowBar, narrowSpace, wideBar, wideSpace } in 0.1 mm. Without them the renderer uses
 *                 module for the narrow elements and 3 x module for the wide ones (ratio 3:1).
 *                 interCharGap = space between Code 39 characters in 0.1 mm (default: module; ITF has none).
 *                 check = 'none' | 'mod43' (Code 39 only) | 'unsupported' (the language's check digit option has no
 *                 neutral equivalent: drawn without check character and reported). Default: 'none'.
 *       line    { ref, x1, y1, x2, y2, rect, width, radius?, native:{ width, radius? } }
 *               width = thickness in 0.1 mm (native.width = the language's value, in dots)
 *               radius = corner radius of a rectangle (rect true) in 0.1 mm, absent when the command has none; the renderer clamps
 *               it to half of the shorter side. native.radius = the language's value (TPCL LC ggg: 0.1 mm; TSPL BOX: dots, not
 *               verified on a printer). A radius on a line (rect false) is ignored.
 *       ellipse { ref, x, y, width, height, thickness, native:{ ... } }
 *               TSPL only (TPCL has no equivalent: a conversion skips it with one warning). x, y = top-left corner of the bounding
 *               box, width/height = its size and thickness = the stroke width, all in 0.1 mm; the stroke is centered on the box edge.
 *               A circle is an ellipse with equal axes that keeps ref 'CIRCLE' (emit writes CIRCLE back; ref 'ELLIPSE' otherwise).
 *               native = the dots of the command: { width, height, thickness, kind: 'ELLIPSE' } or { diameter, thickness, kind: 'CIRCLE' }.
 *               NOT VERIFIED ON A PRINTER: ELLIPSE / CIRCLE come from the TSC TSPL2 manual v3.0, which is not available locally.
 *       image   { ref, x, y, width, height, href?, bitmap?, data:null }
 *               width/height = size in 0.1 mm. It has no data. Two origins:
 *               - preview overlay added by the viewer (PB.images.makeItem): href = data URL (or URL) of the picture.
 *               - graphic command of the code (TPCL SG): bitmap = { w, h, data } in printer dots, data = flat
 *                 Uint8Array of 0/1 (1 = black), row by row, length w * h.
 *   - data: text of the field with #NAME# variables (null if it has no data). In barcodes, function 1
 *     (FNC1) is the character PB.barcodeData.FNC1: a language with another notation (TPCL: ">8") translates it
 *     when parsing, so neither the drawing nor the encoder know any language notation.
 *   - source { spans: [{ start, end }], label }: where the item is in the source text (several spans if the
 *     language spreads it over several commands) and a short text to display. Optional: without source the item
 *     cannot be selected in the editor and has no tooltip (see PB.sources).
 */
