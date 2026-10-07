/**
 * QR slice, TSPL language (TSC TTP): the QRCODE command.
 *   QRCODE x,y,ECClevel,cellWidth,mode,rotation,[J#,][M#,][S#,][X#,][L#,]"content"
 * It becomes the neutral `qr` item (see js/core/model.js) so the renderer of this slice needs no change:
 *   - ECC level L/M/Q/H (an unknown one draws with M); cellWidth is in dots (kept in native.cell), cell = dots * dot;
 *   - mode A (auto): the content is the data; mode M (manual): the content starts with encoding prefixes (A alphanumeric,
 *     N numeric, K kanji, B + 4 digits = byte count + that many bytes, `!` switches the character set) that are stripped;
 *   - the optional parameters after the rotation are told apart by their PREFIX LETTER (J justification, M model, S mask,
 *     X area, L length), in any order and any subset; they are kept in native. Unknown extras are ignored;
 *   - the neutral item has no rotation: it is kept in native.rotation and the QR is drawn unrotated (one info per label).
 * Emit (the inverse): `emit(item, ctx)` writes QRCODE x,y,<ecc>,<cell dots>,A,0,"data": mode A, rotation 0 (the model has
 * none), unknown ecc -> M (warning), cell = round(cell / dot) clamped 1..10 (warning once when clamped).
 * The factory receives the helpers of js/languages/tspl.js (SLICE_HELPERS), which loads after this file:
 *   factory(helpers) -> { handlers, emit, build, coordinates, editable }. Registered by js/components/qr/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.qr = PB.slices.qr || {};

  const { diagnostics: diag } = PB;

  const ECC_LEVELS = Object.freeze({ L: 'L', M: 'M', Q: 'Q', H: 'H' });
  const DEFAULT_ECC = 'M';
  const DEFAULT_CELL = 4;
  const MAX_CELL = 10;

  /** Counter/variable content: "@1", "x"+@1+"y". */
  const COUNTER = /(?:^|\+)\s*@\d+/;

  /** Optional parameter: prefix letter + value. Native field and accepted range of each one. */
  const OPTION = /^([JMSXL])\s*(\d+)$/i;
  const OPTIONS = Object.freeze({
    J: { field: 'justification', ok: v => v >= 1 && v <= 9 },
    M: { field: 'model', ok: v => v === 1 || v === 2 },
    S: { field: 'mask', ok: v => v >= 0 && v <= 8 },
    X: { field: 'area', ok: () => true },
    L: { field: 'length', ok: () => true },
  });

  const SEGMENT_START = /!(?=[ANBK])/;

  /**
   * Manual-mode content -> printable payload (segments concatenated), or null when the prefixes are malformed.
   * "N123456!ATHE" -> "123456THE"; "B0012Product name" -> "Product name" (fewer bytes than counted are tolerated).
   */
  function manualData(content) {
    let i = 0;
    let out = '';
    while (i < content.length) {
      if (content[i] === '!') i++;
      const letter = content[i];
      if (!/^[ANBK]$/.test(letter || '')) return null;
      i++;
      if (letter === 'B') {
        const count = /^\d{4}/.exec(content.slice(i));
        if (!count) return null;
        i += 4;
        out += content.substr(i, +count[0]);
        i += +count[0];
      } else {
        const rest = content.slice(i);
        const next = rest.search(SEGMENT_START);
        out += next < 0 ? rest : rest.slice(0, next);
        i += next < 0 ? rest.length : next;
      }
    }
    return out;
  }

  function tspl(helpers) {
    const {
      sourceOf, num, ROTATIONS, quoted, exactDots, roundDots, safeData, numberField, selectField,
      insertCommand, freePlaceholder, dropDots,
    } = helpers;

    /**
     * Adds QRCODE x,y,M,4,A,0,"<#QR{k}#>" at the drop point. The rotation is always 0, like the TPCL template: the viewer
     * draws QR codes unrotated, so a rotated one would not look upright in a rotated view and would only add a diagnostic.
     */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      return insertCommand(text, `QRCODE ${x},${y},${DEFAULT_ECC},${DEFAULT_CELL},A,0,${quoted(freePlaceholder(text, 'QR'))}`);
    }

    /** QRCODE x,y,ecc,cell,A,0,"data" of a qr item. */
    function emit(item, ctx) {
      const eccKey = String(item.ecc ?? '').toUpperCase();
      if (!(eccKey in ECC_LEVELS)) {
        ctx.once('tspl-qr-ecc', () => diag.warning(`Hay códigos QR con corrección de errores "${item.ecc ?? ''}" desconocida: se escriben con ${DEFAULT_ECC}`));
      }
      let cell = Number.isFinite(item.cell) && item.cell > 0 ? roundDots(exactDots(ctx, item.cell)) : DEFAULT_CELL;
      if (cell < 1 || cell > MAX_CELL) {
        ctx.once('tspl-qr-cell', () => diag.warning(`Hay códigos QR con una celda fuera de 1..${MAX_CELL} puntos: se ajusta al límite de TSPL`));
        cell = Math.min(MAX_CELL, Math.max(1, cell));
      }
      const [x, y] = [roundDots(exactDots(ctx, item.x || 0)), roundDots(exactDots(ctx, item.y || 0))];
      return `QRCODE ${x},${y},${ECC_LEVELS[eccKey] ?? DEFAULT_ECC},${cell},A,0,${quoted(safeData(ctx, item.data))}`;
    }

    /** ECC level: an unquoted letter L/M/Q/H (argument 2); anything else is left alone. */
    const eccField = {
      key: 'ecc', label: 'Corrección de errores', type: 'select', arg: 2,
      options: Object.keys(ECC_LEVELS).map(value => ({ value, label: value })),
      model: item => item.ecc,
      read: a => { const v = a.raw.toUpperCase(); return v in ECC_LEVELS ? v : undefined; },
      write: v => (typeof v === 'string' && v.toUpperCase() in ECC_LEVELS ? v.toUpperCase() : null),
    };

    return {
      // emit(item, ctx) -> the QRCODE command of a qr item
      emit,
      // build(text, point, options) -> text with a new QRCODE command (palette)
      build,
      // Move: QRCODE x,y are arguments 0 and 1 (dots)
      coordinates: [{ applies: (item, cmd) => !cmd || cmd.name === 'QRCODE', fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] }],
      // Properties: ECC level, cell width and rotation (mode, extra options and content are never touched)
      editable: [{
        applies: (item, cmd) => (cmd ? cmd.name === 'QRCODE' : item.ref === 'QRCODE'),
        fields: [
          eccField,
          numberField('cell', 'Celda (puntos)', 3, 1, MAX_CELL, item => item.native && item.native.cell),
          selectField('rotation', 'Rotación', 5, [0, 90, 180, 270], item => item.native && item.native.rotation),
        ],
      }],
      handlers: [
        {
          // QRCODE x,y,ECClevel,cellWidth,mode,rotation,[J#,][M#,][S#,][X#,][L#,]"content"
          pattern: /^QRCODE\b/i,
          handle(m, cmd, ctx) {
            const ref = 'QRCODE';
            if (cmd.args.length < 7) { ctx.report(diag.warning(`QRCODE incompleto: ${cmd.raw.slice(0, 40)}`)); return; }
            const [px, py] = [num(cmd.args[0]), num(cmd.args[1])];
            if (px === null || py === null) { ctx.report(diag.warning(`QRCODE con coordenadas no válidas: ${cmd.raw.slice(0, 40)}`)); return; }

            const eccKey = cmd.args[2].value.toUpperCase();
            if (!(eccKey in ECC_LEVELS)) ctx.report(diag.info(`${ref}: corrección de errores "${cmd.args[2].value}" desconocida, se dibuja con ${DEFAULT_ECC}`));

            const cellValue = num(cmd.args[3]);
            const cellDots = cellValue !== null && cellValue > 0 ? cellValue : DEFAULT_CELL;
            if (cellDots !== cellValue) ctx.report(diag.warning(`${ref}: ancho de celda "${cmd.args[3].value}" no válido, se usa ${DEFAULT_CELL} puntos`));

            const modeKey = cmd.args[4].value.toUpperCase();
            const mode = modeKey === 'M' ? 'M' : 'A';
            if (modeKey !== 'A' && modeKey !== 'M') ctx.report(diag.warning(`${ref}: modo "${cmd.args[4].value}" no válido, se usa A (automático)`));

            const rotation = num(cmd.args[5]);
            const native = { cell: cellDots, mode, rotation: ROTATIONS.includes(rotation) ? rotation : 0 };
            if (rotation === null || !ROTATIONS.includes(rotation)) {
              ctx.report(diag.warning(`${ref}: rotación "${cmd.args[5].value}" no válida, se dibuja sin rotar`));
            } else if (rotation !== 0 && !ctx.tsplQrRotationNoted) {
              ctx.tsplQrRotationNoted = true;
              ctx.report(diag.info('QRCODE: rotación de QR no soportada, se dibuja sin rotar'));
            }

            // Optional parameters between the rotation and the content, by prefix letter; the rest are ignored
            for (const arg of cmd.args.slice(6, -1)) {
              const opt = OPTION.exec(arg.value);
              const spec = opt && OPTIONS[opt[1].toUpperCase()];
              if (spec && spec.ok(+opt[2])) native[spec.field] = +opt[2];
            }

            const last = cmd.args[cmd.args.length - 1];
            let data = last.value;
            if (COUNTER.test(last.raw)) {
              data = last.raw;
              if (!ctx.tsplCounterNoted) {
                ctx.tsplCounterNoted = true;
                ctx.report(diag.info('QRCODE: contador o variable (@n) sin evaluar, se dibuja como texto literal'));
              }
            } else if (mode === 'M' && data !== '') {
              const stripped = manualData(data);
              if (stripped === null) ctx.report(diag.info(`${ref}: prefijos del modo manual no válidos, se usa el contenido tal cual`));
              else data = stripped;
            }

            const { x, y } = ctx.pos(px, py);
            ctx.addItem({
              kind: 'qr', ref, source: sourceOf(cmd), x, y, raw: { x: String(px), y: String(py), cell: String(cellDots) },
              ecc: ECC_LEVELS[eccKey] ?? DEFAULT_ECC, cell: cellDots * ctx.dot, symbology: 'qr', native, data,
            });
          },
        },
      ],
    };
  }

  PB.slices.qr.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
