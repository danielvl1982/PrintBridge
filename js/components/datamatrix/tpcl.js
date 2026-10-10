/**
 * Data Matrix slice, TPCL language: the XB command of type Q (B-SV4 specification 6.3.9) plus the RB data command's palette template.
 *   XBaa;bbbb,cccc,Q,<ee ECC type>,<ff 1-cell width in dots>,<gg format ID>,<h rotation 0..3>(,Ciiijjj)(,Jkkllmmmnnn)(=data)
 *   - ECC type: 20 = ECC200; 00..14 (ECC 000..140) are "ignored" by the printer, the viewer reports them and draws a hatched placeholder.
 *     The neutral item keeps the ECC level (ee x 10: 200 or 0..140) in `ecc`.
 *   - 1-cell width: 00..99 dots; 00 = the code is not drawn (cell 0).
 *   - format ID: no function (the manual says to ignore it): kept in native, written back as 00.
 *   - Ciiijjj: number of cells in X and Y, even numbers, 000 = automatic (the whole token is optional). Only the square sizes of the
 *     encoder are kept as `size`; the manual's rectangular codes (18x8, 32x8, 26x12, 36x12, 36x16, 48x16) are reported (the drawing then
 *     chooses the smallest square that fits); any other value is automatic, as the manual says.
 *   - Jkkllmmmnnn: connection setting (structured append of up to 16 symbols): reported and kept in native.connection, never drawn or written.
 *   - the data may follow inline (=data) or come in the RB command, which wins.
 * Emit writes ECC200 only (ecc 20), format ID 00 and the number of cells only when the item has a forced size. Rotation uses the same
 * quarter turns as the 1D barcodes (the symbol turns around its origin).
 * The hooks are built by a factory because they need the shared helpers of js/languages/tpcl.js, which loads after this file:
 * factory(helpers) -> { handlers, build, emit, coordinates, editable, rules } (see js/components/registry.js). The RB data handler stays in
 * js/languages/tpcl.js; the generic barcode handler skips well-formed Q commands (negative lookahead), so handler order never decides.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.datamatrix = PB.slices.datamatrix || {};

  const { diagnostics: diag, datamatrix: dm } = PB;
  const { cellOf, sideOf } = PB.slices.datamatrix;

  const SIDES = Object.freeze(dm.SIZES.map(s => s.side));
  /** The rectangular codes of the manual, as X x Y cells (iiijjj), which the viewer does not generate. */
  const RECTANGLES = Object.freeze(['018008', '032008', '026012', '036012', '036016', '048016']);

  /** 1-cell width 00..99 dots (00 draws nothing). */
  const MAX_CELL_DOTS = 99;
  const pad3 = n => String(n).padStart(3, '0');

  /** Format options of a freshly inserted Data Matrix; {rot1} is the 1-digit rotation code. */
  const VARIABLE = Object.freeze({ format: 'XB', data: 'RB', name: 'DATAMATRIX', tail: 'Q,20,04,00,{rot1}' });

  /** Options of the symbol size select: automatic, then every square size. */
  const SIZE_OPTIONS = Object.freeze([{ value: 0, label: 'Automático' }, ...SIDES.map(side => ({ value: side, label: `${side} × ${side}` }))]);

  /** Size from the raw ",Ciiijjj" slot: 0 = omitted (automatic), the side of a square size of the table, undefined = anything else. */
  function readSize(raw) {
    if (raw === '') return 0;
    const m = /^,C(\d{3})(\d{3})$/.exec(raw);
    if (!m) return undefined;
    if (m[1] === '000' && m[2] === '000') return 0;
    return m[1] === m[2] && SIDES.includes(+m[1]) ? +m[1] : undefined;
  }

  function tpcl(helpers) {
    const {
      sourceOf, insertCommand, pad4, clampCoord, numberField, rotationField, nextId, freePlaceholder, ROTATION_STEPS, ROTATIONS,
      wrap, safeData, coordText, allocId, fitBarcodeData, barcodeNumberWarning, MATRIX_DATA_MAX,
    } = helpers;

    /**
     * Problems of the parameters of an XB type Q command as written (B-SV4 6.3.9, B-452-R 6.3.10, B-452-TS12 6.12): ECC type 00..14 or 20,
     * cell 00..99 (a larger one is drawn as 99), format ID 00..06 or 11..16, number of cells, connection setting.
     */
    function problems(ref, { ecc, cell, formatId, cells, connection }) {
      const out = [];
      if (!(+ecc <= 14 || +ecc === 20)) out.push(diag.warning(`${ref}: tipo de ECC "${ecc}" fuera de 00..14 o 20: la impresora puede no aceptarlo`));
      if (+cell > MAX_CELL_DOTS) out.push(diag.warning(`${ref}: módulo "${cell}" fuera de 00..${MAX_CELL_DOTS}: la impresora puede no aceptarlo, se dibuja con ${MAX_CELL_DOTS}`));
      if (!(+formatId <= 6 || (+formatId >= 11 && +formatId <= 16))) out.push(diag.warning(`${ref}: formato ID "${formatId}" fuera de 00..06 o 11..16: la impresora puede no aceptarlo`));
      if (cells && !(cells.x === '000' && cells.y === '000') && !RECTANGLES.includes(cells.x + cells.y)) {
        const [x, y] = [+cells.x, +cells.y];
        const valid = +ecc === 20 ? x === y && x % 2 === 0 && x >= 10 && x <= 144 : x === y && x % 2 === 1 && x >= 9 && x <= 49;
        if (!valid) out.push(diag.warning(`${ref}: número de celdas ${x}×${y} no válido (${+ecc === 20 ? 'ECC200: pares de 10..144, cuadrado o uno de los rectangulares del manual' : 'ECC0 a ECC140: impares de 9..49, cuadrado'}): la impresora lo pone en automático`));
      }
      if (connection) {
        const [, kk, ll, id1, id2] = /^J(\d{2})(\d{2})(\d{3})(\d{3})$/.exec(connection);
        if (+kk < 1 || +kk > 16 || +ll < 2 || +ll > 16 || +id1 < 1 || +id1 > 254 || +id2 < 1 || +id2 > 254) {
          out.push(diag.warning(`${ref}: conexión "${connection}" fuera de rango (kk 01..16, ll 02..16, ID 1 y 2 001..254): la impresora puede no aceptarlo`));
        }
      }
      return out;
    }

    /** Adds an XB type Q command plus its RB data command with a unique <#DATAMATRIX{k}#> variable, rotated to look upright in the view. */
    function build(text, point, options) {
      const { format, data, name } = VARIABLE;
      const view = options && ROTATION_STEPS.includes(options.viewRotation) ? options.viewRotation : 0;
      const tail = VARIABLE.tail.replace('{rot1}', String(ROTATION_STEPS.indexOf((360 - view) % 360)));
      const id = nextId(text, format, data);
      const placeholder = freePlaceholder(text, name);
      const withFormat = insertCommand(text, `{${format}${id};${pad4(clampCoord(point.x))},${pad4(clampCoord(point.y))},${tail}|}`);
      return insertCommand(withFormat, `{${data}${id};${placeholder}|}`);
    }

    /** Rotation digit 0..3: the nearest quarter turn, with one warning if the item was not on one. */
    function rotationDigit(ctx, rotation) {
      const turns = Number.isFinite(rotation) ? Math.round(rotation / 90) : 0;
      const degrees = (((turns * 90) % 360) + 360) % 360;
      if (degrees !== rotation && !(rotation == null && degrees === 0)) {
        ctx.once('tpcl-dm-rotation', () => diag.warning('Hay Data Matrix con una rotación que no es múltiplo de 90°: se ajustan al giro más cercano'));
      }
      return String(ROTATION_STEPS.indexOf(degrees));
    }

    /** XB type Q + its RB data command. The cell (dots, 1..99; 0 stays 0) comes from the item's module or, without one, from its area. */
    function emit(item, ctx) {
      const [x, y] = [coordText(ctx, item.x), coordText(ctx, item.y)];
      if (item.ecc !== undefined && item.ecc !== 200) {
        ctx.once('tpcl-dm-ecc', () => diag.warning('Hay Data Matrix con un ECC distinto de ECC200: el visor y el emisor solo manejan ECC200, se escribe ECC200 (20)'));
      }
      let cell = 0;
      if (item.cell !== 0) {
        const raw = ctx.dot(cellOf(item, sideOf(item, item.data)));
        cell = Math.min(MAX_CELL_DOTS, Math.max(1, raw));
        if (cell !== raw) ctx.once('tpcl-dm-cell', () => diag.warning(`Hay Data Matrix con un módulo fuera de 1..${MAX_CELL_DOTS} puntos: se ajusta al límite de TPCL`));
      }
      const cells = SIDES.includes(item.size) ? `,C${pad3(item.size)}${pad3(item.size)}` : '';
      const id = allocId(ctx, 'XB');
      const data = safeData(ctx, item.data);
      const named = PB.variables.namesIn(data).length > 0;
      if (data.length > MATRIX_DATA_MAX && !named) {
        ctx.once('tpcl-matrix-data', () => diag.warning(`Hay Data Matrix con datos de más de ${MATRIX_DATA_MAX} caracteres: la impresora descarta el resto, se escriben los ${MATRIX_DATA_MAX} primeros`));
      }
      return [
        wrap(`XB${id};${x},${y},Q,20,${String(cell).padStart(2, '0')},00,${rotationDigit(ctx, item.rotation)}${cells}`),
        wrap(`RB${id};${named ? data : data.slice(0, MATRIX_DATA_MAX)}`),
      ];
    }

    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [
        {
          // XBnn;x,y,Q,<ECC>,<cell>,<format ID>,<rotation>[,Ciiijjj][,Jkkllmmmnnn][=data]
          pattern: /^XB(\d+);(\d+),(\d+),Q,(\d+),(\d+),(\d+),([0-3])(?=[,=;]|$)([\s\S]*)$/,
          handle(m, cmd, ctx) {
            const ref = 'XB' + m[1];
            // What follows the parameters: "=data" (inline data) or ";links" (link field numbers, not used here)
            const cut = m[8].search(/[=;]/);
            const head = cut < 0 ? m[8] : m[8].slice(0, cut);
            const inline = cut >= 0 && m[8][cut] === '=' ? m[8].slice(cut + 1) : null;
            const extras = /^(?:,C(\d{3})(\d{3}))?(?:,(J\d{10}))?$/.exec(head);
            if (!extras) ctx.report(diag.warning(`${ref}: parámetros adicionales no reconocidos (${head.slice(0, 20)}), se ignoran`));
            const [cx, cy, connection] = extras ? [extras[1], extras[2], extras[3]] : [];
            const native = { type: 'Q', ecc: +m[4], cell: +m[5], formatId: m[6], rotation: m[7] };
            let size;
            if (cx !== undefined && !(cx === '000' && cy === '000')) {
              native.cells = { x: cx, y: cy };
              if (cx === cy && SIDES.includes(+cx)) size = +cx;
              else if (RECTANGLES.includes(cx + cy)) ctx.report(diag.warning(`${ref}: Data Matrix rectangular ${+cx}×${+cy} no soportado por el visor, se dibuja el cuadrado más pequeño que cabe`));
            }
            if (connection) {
              native.connection = connection;
              ctx.report(diag.warning(`${ref}: enlace de símbolos (${connection}) no soportado por el visor, se dibuja como un símbolo único`));
            }
            [barcodeNumberWarning(ref, m[1]), ...problems(ref, { ecc: m[4], cell: m[5], formatId: m[6], cells: native.cells, connection })].filter(Boolean).forEach(d => ctx.report(d));
            ctx.addField(ref, {
              kind: 'datamatrix', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3], cell: m[5] },
              rotation: ROTATIONS[m[7]], cell: Math.min(MAX_CELL_DOTS, +m[5]) * ctx.dot, ...(size && { size }), ecc: +m[4] * 10, symbology: 'datamatrix', native, data: inline == null ? null : fitBarcodeData(ctx, ref, 'datamatrix', inline),
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
        { pattern: /^\{XB\d+;(\d+),(\d+),Q,/d, fields: [[1, null, 'x'], [2, null, 'y']] },
      ],
      // Editable shapes for describeItem / updateItem (see EDITABLE in js/languages/tpcl.js). The ECC type, the format ID and the
      // connection setting are deliberately not exposed; the ",Ciiijjj" slot (group 5) is empty when the number of cells is omitted.
      editable: [
        {
          applies: item => item.kind === 'datamatrix',
          pattern: /^\{XB\d+;\d+,\d+,Q,(\d+),(\d+),(\d+),(\d)((?:,C\d{6})?)/d,
          fields: [
            numberField('cell', 'Tamaño de módulo (puntos)', 2, 1, MAX_CELL_DOTS, item => item.native.cell),
            rotationField(4),
            {
              key: 'size', label: 'Tamaño del símbolo', type: 'select', group: 5, exact: true, options: SIZE_OPTIONS, model: item => item.size || 0,
              read: readSize,
              // Whole token: "" removes it, ",Ciiijjj" sets it; a rectangular or unknown size already there is never rewritten
              write: (v, width, raw) => {
                if (readSize(raw) === undefined) return null;
                if (v === 0) return raw === '' ? null : '';
                return SIDES.includes(v) ? `,C${pad3(v)}${pad3(v)}` : null;
              },
            },
          ],
        },
      ],
      // Format rules: item -> diagnostics (TPCL rules that do not prevent drawing; see RULES in js/languages/tpcl.js)
      rules: [
        // Module size with 2 digits
        item => (item.kind === 'datamatrix' && item.raw && item.raw.cell.length !== 2
          ? [diag.warning(`${item.ref}: tamaño de módulo "${item.raw.cell}" no tiene 2 dígitos`)]
          : []),
      ],
    };
  }

  PB.slices.datamatrix.tpcl = tpcl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
