/**
 * QR slice, TPCL language: the XB command of type T plus the RB data command's palette template.
 *   QR: XBnn;x,y,T,<correction L|M|Q|H>,<module size in dots>,…
 * The hooks are built by a factory because they need the shared helpers of js/languages/tpcl.js, which loads after
 * this file: factory(helpers) -> { handlers, build, coordinates, editable, rules } (see js/components/registry.js).
 * The RB data handler is shared with the other kinds and stays in js/languages/tpcl.js. The generic 1D barcode handler
 * (js/components/barcode/tpcl.js) deliberately skips well-formed QR commands, so handler order never decides between them.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.qr = PB.slices.qr || {};

  const { diagnostics: diag } = PB;

  /** QR error correction level: TPCL letter -> neutral level. */
  const ECC_LEVELS = Object.freeze({ L: 'L', M: 'M', Q: 'Q', H: 'H' });
  const DEFAULT_ECC = 'M';
  const ECC_OPTIONS = Object.freeze([['L', 'L - Baja'], ['M', 'M - Media'], ['Q', 'Q - Alta'], ['H', 'H - Máxima']]
    .map(([value, label]) => ({ value, label })));

  /** Largest 1-cell width of a QR code: 00..52 dots (B-SV4 6.3.9, B-452-R 6.3.10, B-452-TS12 6.12); 00 draws nothing. */
  const MAX_CELL_DOTS = 52;

  /** Format options of a freshly inserted QR. */
  const VARIABLE = Object.freeze({ format: 'XB', data: 'RB', name: 'QR', tail: 'T,H,04,A,0,M2' });

  function tpcl(helpers) {
    const {
      sourceOf, insertCommand, pad4, clampCoord, numberField, nextId, freePlaceholder, wrap, safeData, coordText, allocId,
      fitBarcodeData, barcodeNumberWarning, rangeWarning, MATRIX_DATA_MAX,
    } = helpers;

    /** The parameters of a command up to its "=data" (inline data, null when there is none) or ";links". */
    function splitInline(raw) {
      const at = raw.search(/[=;]/);
      if (at < 0) return [raw, null];
      return [raw.slice(0, at), raw[at] === '=' ? raw.slice(at + 1) : null];
    }

    /**
     * Problems of what follows the cell width: mode g (M manual / A automatic), rotation h (0..3), then the optional Mi (model 1 / 2),
     * Kj (mask 0..8) and Jkkllmm (connection: kk 01..16, ll 01..16, mm 00..FF) (B-SV4 6.3.9, B-452-R 6.3.10).
     */
    function tailProblems(ref, head) {
      const [, mode, rotation, ...optional] = head.split(',');
      const out = [];
      if (mode === undefined || rotation === undefined) out.push(diag.warning(`${ref}: faltan parámetros (modo y rotación): la impresora puede no aceptarlo`));
      if (mode !== undefined && !/^[MA]$/.test(mode)) out.push(diag.warning(`${ref}: modo "${mode}" fuera de A, M: la impresora puede no aceptarlo`));
      if (rotation !== undefined) out.push(rangeWarning(ref, 'rotación', rotation, 0, 3));
      for (const token of optional) {
        const connection = /^J(\d{2})(\d{2})([0-9A-Fa-f]{2})$/.exec(token);
        if (/^M[12]$/.test(token) || /^K[0-8]$/.test(token)) continue;
        if (connection) {
          if (+connection[1] < 1 || +connection[1] > 16 || +connection[2] < 1 || +connection[2] > 16) {
            out.push(diag.warning(`${ref}: conexión "${token}" fuera de rango (kk 01..16, ll 01..16): la impresora puede no aceptarlo`));
          }
        } else if (/^M/.test(token)) out.push(diag.warning(`${ref}: modelo "${token}" fuera de M1, M2: la impresora puede no aceptarlo`));
        else if (/^K/.test(token)) out.push(diag.warning(`${ref}: máscara "${token}" fuera de K0..K8: la impresora puede no aceptarlo`));
        else if (/^J/.test(token)) out.push(diag.warning(`${ref}: conexión "${token}" no válida (Jkkllmm: kk 01..16, ll 01..16, mm 00..FF): la impresora puede no aceptarlo`));
        else out.push(diag.warning(`${ref}: parámetro "${token}" desconocido`));
      }
      return out;
    }

    /** Adds a QR XB format command plus its RB data command with a unique <#QR{k}#> variable (rotation does not apply). */
    function build(text, point) {
      const { format, data, name, tail } = VARIABLE;
      const id = nextId(text, format, data);
      const placeholder = freePlaceholder(text, name);
      const withFormat = insertCommand(text, `{${format}${id};${pad4(clampCoord(point.x))},${pad4(clampCoord(point.y))},${tail}|}`);
      return insertCommand(withFormat, `{${data}${id};${placeholder}|}`);
    }

    /**
     * XB command of type T (QR: ecc letter, cell in dots as 2 digits, fixed tail A,0,M2) + its RB data command. The cell
     * is converted from 0.1 mm at the resolution and clamped to 1..99 (warning once); an ecc outside L/M/Q/H becomes M.
     */
    function emit(item, ctx) {
      const [x, y] = [coordText(ctx, item.x), coordText(ctx, item.y)];
      if (!(item.ecc in ECC_LEVELS)) ctx.once('tpcl-qr-ecc', () => diag.warning(`Hay QR con una corrección de errores desconocida ("${item.ecc}"): se escribe ${DEFAULT_ECC}`));
      const ecc = item.ecc in ECC_LEVELS ? item.ecc : DEFAULT_ECC;
      const raw = Number.isFinite(item.cell) ? ctx.dot(item.cell) : 0;
      const cell = Math.min(MAX_CELL_DOTS, Math.max(1, raw));
      if (cell !== raw) ctx.once('tpcl-qr-cell', () => diag.warning(`Hay QR con un módulo fuera de 1..${MAX_CELL_DOTS} puntos: se ajusta al límite de TPCL`));
      const id = allocId(ctx, 'XB');
      const data = safeData(ctx, item.data);
      if (data.length > MATRIX_DATA_MAX && !PB.variables.namesIn(data).length) {
        ctx.once('tpcl-matrix-data', () => diag.warning(`Hay QR con datos de más de ${MATRIX_DATA_MAX} caracteres: la impresora descarta el resto, se escriben los ${MATRIX_DATA_MAX} primeros`));
      }
      return [wrap(`XB${id};${x},${y},T,${ecc},${String(cell).padStart(2, '0')},A,0,M2`), wrap(`RB${id};${PB.variables.namesIn(data).length ? data : data.slice(0, MATRIX_DATA_MAX)}`)];
    }

    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [
        {
          // QR code: XBnn;x,y,T,<correction>,<module size>,…
          pattern: /^XB(\d+);(\d+),(\d+),T,(\w),(\d+)([\s\S]*)$/,
          handle(m, cmd, ctx) {
            const ref = 'XB' + m[1];
            const [head, inline] = splitInline(m[6]);
            if (!(m[4] in ECC_LEVELS)) ctx.report(diag.warning(`${ref}: corrección de errores "${m[4]}" desconocida, se dibuja con ${DEFAULT_ECC}`));
            // The cell is drawn as the nearest valid width (at most 52), native keeps the digits as written; 00 draws nothing on the printer
            const tooBig = +m[5] > MAX_CELL_DOTS ? diag.warning(`${ref}: módulo "${m[5]}" fuera de 00..${MAX_CELL_DOTS} (2 dígitos): la impresora puede no aceptarlo`) : null;
            [barcodeNumberWarning(ref, m[1]), tooBig, ...tailProblems(ref, head)].filter(Boolean).forEach(d => ctx.report(d));
            if (+m[5] === 0) ctx.report(diag.warning(`${ref}: módulo "${m[5]}": con módulo 0 la impresora no dibuja el QR`));
            ctx.addField(ref, {
              kind: 'qr', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3], cell: m[5] },
              ecc: ECC_LEVELS[m[4]] ?? DEFAULT_ECC, cell: Math.min(MAX_CELL_DOTS, +m[5]) * ctx.dot, symbology: 'qr', native: { type: 'T', cell: +m[5] },
              data: inline == null ? null : fitBarcodeData(ctx, ref, 'qr', inline),
            });
          },
        },
      ],
      // build(text, point, options) -> text with the new component
      build,
      // emit(item, ctx) -> the XB command and its RB data command
      emit,
      // Coordinate fields moved by moveItem (see COORDINATES in js/languages/tpcl.js)
      coordinates: [
        { pattern: /^\{XB\d+;(\d+),(\d+)/d, fields: [[1, null, 'x'], [2, null, 'y']] },
      ],
      // Editable shapes for describeItem / updateItem (see EDITABLE in js/languages/tpcl.js)
      editable: [
        { // QR: XBnn;x,y,T,<correction>,<module size>,… (the field after the module size is deliberately not exposed)
          applies: item => item.kind === 'qr',
          pattern: /^\{XB\d+;\d+,\d+,T,(\w),(\d+)/d,
          fields: [
            numberField('cell', 'Tamaño de módulo (puntos)', 2, 1, MAX_CELL_DOTS, item => item.native.cell),
            {
              key: 'ecc', label: 'Corrección de errores', type: 'select', group: 1, options: ECC_OPTIONS, model: item => item.ecc,
              read: raw => (raw in ECC_LEVELS ? raw : undefined),
              write: v => (typeof v === 'string' && v in ECC_LEVELS ? v : null),
            },
          ],
        },
      ],
      // Format rules: item -> diagnostics (TPCL rules that do not prevent drawing; see RULES in js/languages/tpcl.js)
      rules: [
        // QR module size with 2 digits
        item => (item.kind === 'qr' && item.raw.cell.length !== 2
          ? [diag.warning(`${item.ref}: tamaño de módulo "${item.raw.cell}" no tiene 2 dígitos`)]
          : []),
      ],
    };
  }

  PB.slices.qr.tpcl = tpcl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
