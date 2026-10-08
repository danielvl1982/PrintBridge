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
 *     (TPCL: dRaw, axRaw; TSPL: sizeRaw, gapRaw...; ZPL: pw, ll (dots), pwRaw, llRaw, invert), which only that language interprets. ZPL sizes are
 *     whole dots rounded to 0.1 mm, pitch and gap are null (ZPL has neither).
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
 *               counter? = { step, native } (a counter field: the printer increments / decrements the data on every label issued; the
 *               model keeps the START value in data. step = signed integer, + increments and - decrements, never 0 (0 = no counter,
 *               absent); TPCL PC/PV/XB "noooooooooo" skip value 0000000000..9999999999, native = the token as written ("+0000000010");
 *               TSPL "SET COUNTER @n step" -999999999..999999999 with the content "@n", native = { n, start, end } (the counter number
 *               and where its step sits in the text, for the panel). Barcodes carry it too; QR does not.)
 *               reverse? = true (ZPL ^FR field reverse print: the viewer draws the text white blended with `difference`, so it reads inverted over
 *               black; absent = normal). ZPL specific: it is NOT the TPCL attribute 'reverse' (a black box behind the text), the two never convert.
 *               ZPL: x, y is the baseline origin (^FT as written; ^FO converted, see js/components/text/zpl.js); font.size = character height in dots.
 *               zeroSuppress? = 1..20 (TPCL PC/PV "Zpp", XB "qq": the number of characters kept after replacing the leading zeros by
 *               spaces; absent = none or 00). The preview applies it to the drawn text only (PB.slices.text.suppressZeros), never to data.
 *       qr      { ref, x, y, ecc, cell, symbology:'qr', native:{ type, cell }, data }
 *               cell = side of each module in 0.1 mm (native.cell = the language's value, in dots)
 *               neutral ecc: 'L' | 'M' | 'Q' | 'H'; each language translates it to its own letter (TPCL: inside tpcl.js)
 *               ZPL ^BQ: ref 'BQ', no rotation (the orientation is fixed); the level is the first letter of the ^FD data, native = { type, model, cell
 *               (the magnification), mode, mixed, origin, orientationArg, zplData } (see js/components/qr/zpl.js)
 *       datamatrix { ref, x, y, rotation, cell, size?, ecc, area?, symbology:'datamatrix', native, data }
 *               Data Matrix (TPCL XB type Q, TSPL DMATRIX, ZPL ^BX; ecc = the ZPL quality 0..200, ZPL ref 'BX', see js/components/datamatrix/zpl.js). The viewer draws ECC200 with ASCII encodation and square symbols only.
 *               cell = side of each module in 0.1 mm; 0 = the printer draws nothing (TPCL cell width 00); null = no module (TSPL DMATRIX
 *               without the optional xm, row, col group): the symbol fits `area` = { width, height } in 0.1 mm (TSPL only; whole dots of
 *               min(width, height) / symbol side).
 *               size? = side in modules of a forced square symbol (10, 12, ... 144; TPCL "Ciiijjj" cells, TSPL row = col); absent = automatic
 *               (the smallest that holds the data). rotation = 0 | 90 | 180 | 270 clockwise around the origin (TPCL only: TSPL has none).
 *               ecc = the ECC level: 200 = ECC200 (drawn); 0..140 (TPCL types 00..14, which the printer ignores) are reported, not drawn.
 *               native = TPCL { type:'Q', ecc, cell, formatId, rotation, cells?, connection? } (as written) or TSPL { width, height, xm, rows, cols }
 *               (dots, null when absent). The TPCL connection setting (Jkkllmmmnnn) is kept in native only. TSPL DMATRIX is NOT VERIFIED
 *               ON A PRINTER: the manual only gives the syntax and an example.
 *       barcode { ref, x, y, rotation, module, height, humanReadable, symbology, native:{ type, module }, data,
 *                 widths?, interCharGap?, check?, addon?, guard? }
 *               module = width of the narrowest module and height = height of the bars, both in 0.1 mm
 *               neutral symbology: code128 | code39 | itf | code93 | codabar | msi | industrial25 | ean13 | ean8 | upca | upce | qr | unknown;
 *               native.type = the language's code.
 *               Exact (generated for real): code128, code39, itf, code93, codabar, msi, industrial25, ean13, ean8, upca, upce; the others are drawn approximately.
 *               code93: module based like code128 (widths of 1..4 modules); check = 'none' | 'check' | 'auto' (TPCL option e = 1 | 2 | 3; the two check
 *                 characters C and K, modulo 47; TSPL "93" = 'auto'). Only the 43 standard characters are drawn (no full ASCII).
 *               codabar (NW7; TPCL type 4, TSPL "CODA"), msi (TPCL 1), industrial25 (TPCL O): wide / narrow like code39 / itf (widths, interCharGap);
 *                 codabar data may carry its start / stop letters A-D; msi digits, check = 'none' | 'check' | 'auto' (IBM modulus 10) | 'mod1010' |
 *                 'mod1110' (TPCL options 1..5); industrial25 digits, check = 'none' | 'check' | 'auto' (modulus 10); codabar check = 'none'.
 *                 native.startStop = the TPCL start/stop option T | P | N as written (widths form; not drawn). TSPL has no msi / industrial25 type.
 *               EAN / UPC only (ean13, ean8, upca, upce; module based like Code 128):
 *                 addon = 0 | 2 | 5 (the digits of the EAN-2 / EAN-5 add-on; TPCL types 7 8 I J L M G H, TSPL "EAN13+2"...). The data
 *                 is the base digits followed by the add-on digits.
 *                 check = 'none' | 'check' | 'auto' | 'unsupported' (TPCL option e = 1 | 2 | 3 | the price check digits 4, 5; the
 *                 TSPL types have no option and read as 'auto'): auto attaches the check digit to data without it and validates data
 *                 with it, check only validates, none draws the data as it is; unsupported is drawn as auto and reported. Default: auto.
 *                 guard? = TPCL "WPC guard bar" length in 0.1 mm (000 = none; the digits are printed under the bars when humanReadable);
 *                 absent (TSPL) = the standard guard bars when the digits are printed.
 *               Code 39 and ITF only (wide/narrow symbologies), all optional:
 *                 widths = { narrowBar, narrowSpace, wideBar, wideSpace } in 0.1 mm. Without them the renderer uses
 *                 module for the narrow elements and 3 x module for the wide ones (ratio 3:1).
 *                 interCharGap = space between Code 39 characters in 0.1 mm (default: module; ITF has none).
 *                 check = 'none' | 'mod43' (Code 39 only) | 'unsupported' (the language's check digit option has no
 *                 neutral equivalent: drawn without check character and reported). Default: 'none'.
 *                 ITF also has check = 'auto' (modulus 10 attached; ZPL ^B2 e = Y); TPCL and TSPL have no such option (reported).
 *               ZPL (^BC ^B3 ^B2 ^BE ^B8 ^BU ^B9 ^BA ^BK ^BM ^BI ^BJ, js/components/barcode/zpl.js): native = { type: the command name, module (dots),
 *                 ratio (^BY), height (dots or null), origin: 'FO' | 'FT' | 'default', above, zplData, ... }; x, y is the anchor (top-left of the
 *                 unrotated bars) like the other languages, derived from the origin of the field and the orientation. The wide / narrow
 *                 symbologies carry widths from the ^BY module and ratio; the Codabar data carries its start / stop letters; UPC-E data is the 6 digits.
 *               counter?, zeroSuppress? as in text (the bars always draw the start value; the zero suppression is kept but not drawn).
 *       line    { ref, x1, y1, x2, y2, rect, width, radius?, native:{ width, radius? } }
 *               width = thickness in 0.1 mm (native.width = the language's value, in dots)
 *               radius = corner radius of a rectangle (rect true) in 0.1 mm, absent when the command has none; the renderer clamps
 *               it to half of the shorter side. native.radius = the language's value (TPCL LC ggg: 0.1 mm; TSPL BOX: dots, not
 *               verified on a printer). A radius on a line (rect false) is ignored.
 *               ZPL (^GB, ^GD, js/components/{line,box}/zpl.js): the box is the rectangle inset by t / 2 (the ZPL border grows inward) and the radius is the
 *               guide's (rounding degree / 8) * (shorter side / 2) minus t / 2; native = { kind: 'GB' | 'GD', w, h, thickness, color, rounding, orientation,
 *               origin: 'FO' | 'FT' | 'default', labelReverse? } in dots. white? = true (ZPL colour W: drawn in white), reverse? = true (ZPL ^FR / ^LR: drawn white
 *               blended with `difference`, like the text); both are ZPL specific, the other languages write the shape plain with one warning.
 *       ellipse { ref, x, y, width, height, thickness, native:{ ... } }
 *               TSPL and ZPL (^GC, ^GE; TPCL has no equivalent: a conversion skips it with one warning). x, y = top-left corner of the bounding
 *               box, width/height = its size and thickness = the stroke width, all in 0.1 mm; the stroke is centered on the box edge.
 *               A circle is an ellipse with equal axes that keeps ref 'CIRCLE' (emit writes CIRCLE back; ref 'ELLIPSE' otherwise).
 *               native = the dots of the command: { width, height, thickness, kind: 'ELLIPSE' } or { diameter, thickness, kind: 'CIRCLE' }.
 *               NOT VERIFIED ON A PRINTER: ELLIPSE / CIRCLE come from the TSC TSPL2 manual v3.0, which is not available locally.
 *       area    { ref, mode, x, y, width, height, native:{ ... } }
              Inverted / cleared area (TPCL XR, TSPL REVERSE and ERASE). mode = 'reverse' (inverts the white/black dots already drawn:
              XR type B, REVERSE) or 'clear' (blots them out to white: XR type A, ERASE). x, y = top-left corner and width, height = size,
              all in 0.1 mm (TPCL corners in any order are normalised). The item only affects what comes BEFORE it in the items list,
              which is the command order: the parsers add the items as they read them and the renderer paints them in that order.
              native = TPCL { x1, y1, x2, y2, type: 'A' | 'B' } (0.1 mm, as written) or TSPL { width, height, kind: 'REVERSE' | 'ERASE' } (dots).
              The TSPL commands are from the B-442/443 manual and are not verified on a printer.
              ZPL: a solid ^GB with ^FR (or under ^LRY) is `reverse`, a solid white ^GB (colour W) is `clear`; native = { kind: 'GB', w, h, thickness, color,
              rounding, origin, labelReverse? } (dots). The ellipse carries `white` / `reverse` like the line (ZPL ^GC / ^GE: x, y = the centre-line box,
              inset by t / 2; native = { kind: 'GC', diameter, ... } or { kind: 'GE', w, h, ... }).
      image   { ref, x, y, width, height, href?, bitmap?, data:null }
 *               width/height = size in 0.1 mm. It has no data. Two origins:
 *               - preview overlay added by the viewer (PB.images.makeItem): href = data URL (or URL) of the picture.
 *               - graphic command of the code (TPCL SG, TSPL BITMAP, ZPL ^GF): bitmap = { w, h, data } in printer dots, data = flat
 *                 Uint8Array of 0/1 (1 = black), row by row, length w * h. ZPL: native = { format: 'A', total, bytesPerRow, compressed, origin }.
 *   - data: text of the field with #NAME# variables (null if it has no data). In barcodes, function 1
 *     (FNC1) is the character PB.barcodeData.FNC1: a language with another notation (TPCL: ">8") translates it
 *     when parsing, so neither the drawing nor the encoder know any language notation.
 *   - source { spans: [{ start, end }], label }: where the item is in the source text (several spans if the
 *     language spreads it over several commands) and a short text to display. Optional: without source the item
 *     cannot be selected in the editor and has no tooltip (see PB.sources).
 */
