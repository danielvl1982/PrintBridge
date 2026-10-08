/**
 * Image slice, ZPL language (Zebra): the graphic field ^GF.
 *   ^FOx,y ^GFa,b,c,d,data ^FS     a = A | B | C, b = bytes sent, c = total bytes of the image, d = bytes per row, data
 * Source: ZPL II Programming Guide, Volume One (2003), local copy in docs/zpl (never committed). What it documents: the parameter layout above (a default A;
 * b, c and d from 1 to 99999, "out-of-range values are set to the nearest limit", the command is ignored when c or d is missing; "for ASCII download b should
 * match c"; c / d = the rows); the ASCII data is two hex digits per image byte (1 = black, the leftmost dot is the highest bit; the guide's ~DG: four white dots
 * then four black = 0F), CR and LF may be inserted, "any numbers sent after count is satisfied are ignored" and "a comma in the data pads the current line with 00
 * (white space)"; B is binary and C is compressed binary (host side, Zebra's algorithm); the origin of an image is its bottom-left corner with ^FT.
 * NOT in the 2003 guide (it is in the later guides): the run-length COMPRESSION of the ASCII data. The viewer reads and writes the scheme of the later guides
 * (NOT VERIFIED ON A PRINTER): a repeat count before a hex digit (G..Y = 1..19, g..z = 20..400 in steps of 20, the letters add up: gG = 21, at most 419 per
 * token), `,` fills the rest of the row with 0, `!` fills it with 1 and `:` repeats the previous row. The encoder only uses it when it makes the data shorter.
 * Out of scope (one warning each, nothing drawn): ^GFB / ^GFC binary data (it cannot live in a text box), Z64 / B64 data (":Z64:...") and the images stored in
 * the printer (~DG, ~DY, ^IM, ^IL, ^XG: the data is not in the stream).
 *
 * The neutral image item has a bitmap { w, h, data } (flat 0/1, 1 = black): w = bytes per row * 8, h = total / bytes per row (a total that is not a multiple of
 * the row size gets a last partial row padded with white). native: { format: 'A', total, bytesPerRow, compressed, origin: 'FO' | 'FT' | 'default' }. Data that is
 * short is padded with white and reported, data beyond the total is ignored and reported. Emit: ^FOx,y^GFA,<total>,<total>,<bytes per row>,<data>^FS (^FT with the
 * bottom-left corner when the item came from an ^FT field), rows of whole bytes (a width that is not a multiple of 8 gains white columns, like TSPL BITMAP).
 * Moving an image only rewrites ^FO / ^FT (the generic engine of js/languages/zpl-edit.js): the ^GF data is never touched. Images have no editable fields.
 * factory(helpers) -> { handlers, emit, coordinates }; registered by js/components/image/index.js as `languages: { tpcl, tspl, zpl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.image = PB.slices.image || {};

  const { diagnostics: diag } = PB;

  /** Limits of the guide: b, c and d from 1 to 99999. */
  const MIN_COUNT = 1;
  const MAX_COUNT = 99999;
  /** Longest run one repeat count can say: z (400) + Y (19). */
  const MAX_RUN = 419;

  const HEX = '0123456789ABCDEF';
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  // ---------------------------------------------------------------------------------------------------------------
  // Data -> dots

  /** Value of a repeat count letter: G..Y = 1..19, g..z = 20..400 in steps of 20; 0 for any other character. */
  function countOf(ch) {
    if (ch >= 'G' && ch <= 'Y') return ch.charCodeAt(0) - 0x47 + 1;
    if (ch >= 'g' && ch <= 'z') return (ch.charCodeAt(0) - 0x67 + 1) * 20;
    return 0;
  }

  /**
   * Decodes the ASCII data of a ^GFA field into nibbles (4 dots each). `rowNibbles` = 2 * bytes per row, `limit` = nibbles the image holds (2 * total),
   * `size` = nibbles of the buffer (whole rows). Returns { nibbles (Uint8Array of `size`, white where the data did not reach), produced (nibbles written
   * up to the limit), extra (true when data went beyond the limit), invalid (count of characters or codes that are not valid) }.
   */
  function decodeData(text, rowNibbles, limit, size = limit) {
    const nibbles = new Uint8Array(size);
    let pos = 0;
    let count = 0;
    let extra = false;
    let invalid = 0;
    const put = (value, n) => {
      for (let i = 0; i < n; i++) {
        if (pos >= limit) { extra = true; return; }
        nibbles[pos++] = value;
      }
    };
    const rest = () => rowNibbles - (pos % rowNibbles);
    for (const ch of text) {
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') continue;
      const letter = countOf(ch);
      if (letter) { count = Math.min(count + letter, 1e6); continue; }
      if (/^[0-9A-Fa-f]$/.test(ch)) { put(parseInt(ch, 16), count || 1); count = 0; continue; }
      if (ch === ',' || ch === '!') {
        if (count) invalid++;
        put(ch === ',' ? 0 : 15, rest());
      } else if (ch === ':') {
        if (count) invalid++;
        if (pos === 0 || pos % rowNibbles !== 0) invalid++;
        else for (let i = 0; i < rowNibbles; i++) put(nibbles[pos - rowNibbles], 1);
      } else invalid++;
      count = 0;
    }
    if (count) invalid++;
    return { nibbles, produced: pos, extra, invalid };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Dots -> data

  /** The repeat count letters of a run of 2..419 digits (none for 1). */
  function prefixOf(n) {
    if (n === 1) return '';
    const hi = n >= 400 ? 400 : Math.floor(n / 20) * 20;
    const lo = n - hi;
    return (hi ? String.fromCharCode(0x67 + hi / 20 - 1) : '') + (lo ? String.fromCharCode(0x47 + lo - 1) : '');
  }

  /** Runs of equal digits of a string as count letters + digit, a run longer than 419 split in tokens. */
  function runLength(text) {
    let out = '';
    for (let i = 0; i < text.length;) {
      let j = i;
      while (j < text.length && text[j] === text[i]) j++;
      for (let left = j - i; left > 0;) {
        const chunk = Math.min(left, MAX_RUN);
        out += prefixOf(chunk) + text[i];
        left -= chunk;
      }
      i = j;
    }
    return out;
  }

  /**
   * Rows of hex digits (equal length) -> compressed data: a row equal to the previous one is `:`, a row of 0 / F is `,` / `!`, a trailing run of 0 / F is
   * `,` / `!` and the rest of the row is run-length coded. Deterministic.
   */
  function compressRows(rows) {
    let out = '';
    rows.forEach((row, n) => {
      if (n > 0 && row === rows[n - 1]) { out += ':'; return; }
      const fill = /0+$/.test(row) ? ['0', ','] : /F+$/.test(row) ? ['F', '!'] : null;
      if (!fill) { out += runLength(row); return; }
      out += runLength(row.replace(fill[0] === '0' ? /0+$/ : /F+$/, '')) + fill[1];
    });
    return out;
  }

  /** Rows of hex digits (two per byte, whole bytes per row, white padding) of a neutral bitmap. */
  function hexRows({ w, h, data }) {
    const rowBytes = Math.ceil(w / 8);
    const rows = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let b = 0; b < rowBytes; b++) {
        let byte = 0;
        for (let k = 0; k < 8; k++) {
          const x = b * 8 + k;
          byte = (byte << 1) | (x < w && data[y * w + x] ? 1 : 0);
        }
        row += HEX[byte >> 4] + HEX[byte & 15];
      }
      rows.push(row);
    }
    return rows;
  }

  /** Total bytes of a bitmap (whole bytes per row). */
  const totalBytes = bm => Math.ceil(bm.w / 8) * bm.h;

  /** ^GFA command (no origin) of a bitmap: the compressed data when it is shorter than the plain hex. */
  function graphicCommand(bm) {
    const rows = hexRows(bm);
    const plain = rows.join('');
    const packed = compressRows(rows);
    const total = totalBytes(bm);
    return `^GFA,${total},${total},${Math.ceil(bm.w / 8)},${packed.length < plain.length ? packed : plain}`;
  }

  /** The whole field of a bitmap with its top-left corner at x, y (dots): ^FOx,y^GFA,...^FS. */
  const graphicField = (x, y, bm) => `^FO${x},${y}${graphicCommand(bm)}^FS`;

  /** A bitmap the emitter can write: positive whole size and w * h dots of data. */
  const validBitmap = bm => Boolean(bm) && Number.isInteger(bm.w) && Number.isInteger(bm.h) && bm.w > 0 && bm.h > 0 && Boolean(bm.data) && bm.data.length === bm.w * bm.h;

  // ---------------------------------------------------------------------------------------------------------------
  // The slice

  const STORED = Object.freeze({ DG: 'descarga de gráfico', DY: 'descarga de objeto', IM: 'mover imagen', IL: 'cargar imagen', XG: 'recuperar imagen' });

  function zpl(helpers) {
    const { int, toDots } = helpers;

    /** One count of ^GF: a whole number from 1 to 99999 (out of range: the nearest limit, reported); null when it is missing or not a number. */
    function readCount(ctx, cmd, index, label) {
      const a = cmd.args[index];
      if (!a || a.raw === '') return null;
      const v = int(a);
      if (v === null) return null;
      if (v < MIN_COUNT || v > MAX_COUNT) {
        const fixed = clamp(v, MIN_COUNT, MAX_COUNT);
        ctx.report(diag.warning(`^GF: ${label} ${v} fuera de rango (${MIN_COUNT}..${MAX_COUNT}), se usa ${fixed}`));
        return fixed;
      }
      return v;
    }

    /** ^GFa,b,c,d,data: the field with its bitmap, or nothing when it cannot be read (reported). */
    function graphicItem(ctx, field, cmd) {
      const format = cmd.args[0] && cmd.args[0].raw !== '' ? cmd.args[0].raw.toUpperCase() : 'A';
      if (format === 'B' || format === 'C') {
        ctx.once('zpl-gf-binary', () => diag.warning('^GF con datos binarios no soportados (^GFB / ^GFC): solo se admiten los datos ASCII hexadecimales (^GFA), no se dibujan'));
        return;
      }
      if (format !== 'A') { ctx.report(diag.warning(`^GF: formato "${format.slice(0, 10)}" no válido (A, B o C), no se dibuja`)); return; }
      const [sent, total, bytesPerRow] = [readCount(ctx, cmd, 1, 'bytes enviados'), readCount(ctx, cmd, 2, 'total de bytes'), readCount(ctx, cmd, 3, 'bytes por fila')];
      if (sent === null || total === null || bytesPerRow === null) {
        ctx.report(diag.warning(`^GF: falta alguno de los bytes enviados, el total o los bytes por fila (o no son números), el comando se ignora: ${cmd.raw.slice(0, 40)}`));
        return;
      }
      const dataArg = cmd.args[4];
      const text = dataArg ? dataArg.value : '';
      if (/^:(Z64|B64):/i.test(text.trim())) {
        ctx.once('zpl-gf-z64', () => diag.warning('^GF con datos Z64 / B64 (guías posteriores) no soportados: solo se admiten los datos ASCII hexadecimales, no se dibujan'));
        return;
      }
      if (sent !== total) ctx.report(diag.warning(`^GF: los bytes enviados (${sent}) y el total (${total}) deben coincidir en ASCII, se usa el total`));
      const rows = Math.ceil(total / bytesPerRow);
      if (total % bytesPerRow !== 0) ctx.report(diag.warning(`^GF: el total (${total}) no es múltiplo de los bytes por fila (${bytesPerRow}), la última fila se rellena con blanco`));
      const rowNibbles = bytesPerRow * 2;
      const decoded = decodeData(text, rowNibbles, total * 2, rows * rowNibbles);
      if (decoded.invalid) ctx.report(diag.warning(`^GF: ${decoded.invalid} caracteres o códigos de los datos no válidos, se ignoran`));
      if (decoded.produced < total * 2) {
        ctx.report(diag.warning(`^GF: datos incompletos (${Math.floor(decoded.produced / 2)} de ${total} bytes), se rellena con blanco`));
      }
      if (decoded.extra) ctx.report(diag.warning(`^GF: sobran datos después de los ${total} bytes indicados, se ignoran`));
      const [w, h] = [bytesPerRow * 8, rows];
      const bits = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) bits[y * w + x] = (decoded.nibbles[y * rowNibbles + (x >> 2)] >> (3 - (x & 3))) & 1;
      }
      const o = ctx.origin(field);
      const [width, height] = [Math.round(ctx.len(w)), Math.round(ctx.len(h))];
      const source = ctx.sourceOf(field);
      // The field holds the whole data: the label is only a short summary
      const summary = field.raw.replace(/\s+/g, ' ').trim();
      source.label = summary.length > 60 ? `${summary.slice(0, 60)}…` : summary;
      ctx.addItem({
        kind: 'image', ref: 'GF', source,
        x: o.x, y: o.kind === 'FT' ? o.y - height : o.y, width, height,
        bitmap: { w, h, data: bits },
        native: { format, total, bytesPerRow, compressed: /[G-Zg-z!:]/.test(text), origin: o.kind },
        data: null,
      });
    }

    /** ^FOx,y^GFA,...^FS of an image with a bitmap; overlay images (no bitmap), invalid bitmaps and bitmaps over the 99999 bytes of the guide are skipped with a warning. */
    function emit(item, ctx) {
      const bm = item.bitmap;
      if (!bm) {
        ctx.once('zpl-image-overlay', () => diag.warning('Hay imágenes solo de vista previa (sin bitmap): no se pueden exportar a ZPL'));
        return [];
      }
      if (!validBitmap(bm)) {
        ctx.once('zpl-image-invalid', () => diag.warning('Hay imágenes con un bitmap no válido (tamaño positivo y datos de w×h): no se exportan'));
        return [];
      }
      if (totalBytes(bm) > MAX_COUNT) {
        ctx.once('zpl-image-size', () => diag.warning(`Hay imágenes que superan el máximo de ^GF (${MAX_COUNT} bytes de imagen): no se exportan`));
        return [];
      }
      const [x, y] = [toDots(ctx, item.x || 0), toDots(ctx, item.y || 0)];
      const origin = item.native && item.native.origin === 'FT' ? `^FT${x},${y + bm.h}` : `^FO${x},${y}`;
      return [`${origin}${graphicCommand(bm)}^FS`];
    }

    return {
      // emit(item, ctx) -> the ^GF field of an image item
      emit,
      // Move: the field origin (^FO / ^FT); the ^GF data is never rewritten
      coordinates: [{ applies: item => item.kind === 'image' }],
      handlers: [
        {
          // ^GFa,b,c,d,data: the graphic field
          pattern: /^\^GF$/,
          handle(m, cmd, ctx, field) { graphicItem(ctx, field, cmd); },
        },
        {
          // Images stored in the printer's memory: nothing in the stream to draw (immediate: they are not part of a field)
          pattern: /^[\^~](DG|DY|IM|IL|XG)$/,
          immediate: true,
          handle(m, cmd, ctx) {
            const name = m[1];
            ctx.once(`zpl-stored-${name}`, () => diag.warning(`${cmd.id} (${STORED[name]}): imagen almacenada en la impresora, no soportada: no se puede dibujar`));
          },
        },
      ],
    };
  }

  // The codec is exposed for the language hook and the tests
  zpl.decodeData = decodeData;
  zpl.compressRows = compressRows;
  zpl.hexRows = hexRows;
  zpl.graphicCommand = graphicCommand;
  zpl.graphicField = graphicField;
  zpl.totalBytes = totalBytes;
  zpl.MAX_BYTES = MAX_COUNT;
  PB.slices.image.zpl = zpl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
