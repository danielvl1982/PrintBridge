/**
 * Data Matrix slice, TSPL language (TSC TTP): the DMATRIX command (B-442/443 manual).
 *   DMATRIX x, y, width, height, [xm, row, col], expression
 *   x, y = start position, width, height = the area of the code, xm = module size, row / col = rows and columns of the symbol; all in dots.
 * The manual gives the syntax and one example only (DMATRIX 10,10,400,400,"DMATRIX"); it does not say how the symbol is placed in the
 * area, which encodation is used, nor whether the optional group is all or nothing. NOT VERIFIED ON A PRINTER. The viewer reads:
 *   - the optional group as all three values (any other count of values between the height and the content is reported and ignored);
 *   - without a module the code fits the area: module = whole dots of min(width, height) / side of the symbol (see cellOf in render.js);
 *   - rows and columns 0 = automatic; equal and in the table of square sizes = a forced `size`; anything else (a rectangle...) is reported
 *     and left automatic;
 *   - the code is drawn from x, y with the module (it is not clipped to the area), unrotated: DMATRIX has no rotation.
 * It becomes the neutral `datamatrix` item (see js/core/model.js): cell = xm x dot or null, area = { width, height } in 0.1 mm, size,
 * native = { width, height, xm, rows, cols } (dots; null when absent), ecc 200.
 * Emit (the inverse): the full form `DMATRIX x,y,w,h,xm,side,side,"data"` (rows and columns = the symbol drawn, so the printer cannot pick a
 * different size; w = h = side x xm) when the item has a module or a forced size, else the area form `DMATRIX x,y,w,h,"data"`. A rotation, an
 * ECC type other than 200 and a module of 0 (TPCL: not drawn; skipped here) are reported once.
 * Editing: width, height, module and the symbol size (rows and columns together, full form only) and the content.
 * factory(helpers) -> { handlers, emit, build, coordinates, editable }; registered by js/components/datamatrix/index.js as `languages: { tpcl, tspl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.datamatrix = PB.slices.datamatrix || {};

  const { diagnostics: diag, datamatrix: dm } = PB;
  const { cellOf, sideOf } = PB.slices.datamatrix;

  const SIDES = Object.freeze(dm.SIZES.map(s => s.side));
  const MAX_DOTS = 9999;
  const MAX_MODULE = 99;
  /** Module (dots) of a freshly inserted Data Matrix. */
  const DEFAULT_MODULE = 4;

  /** Counter/variable content: "x"+@1. */
  const COUNTER = /(?:^|\+)\s*@\d+/;

  const SIZE_OPTIONS = Object.freeze(SIDES.map(side => ({ value: side, label: `${side} × ${side}` })));

  function tspl(helpers) {
    const {
      sourceOf, num, quoted, counterRefsWarning, exactDots, roundDots, safeData, numberField, textField, insertCommand, freePlaceholder, dropDots,
    } = helpers;

    /** Adds DMATRIX x,y,w,h,4,s,s,"<#DATAMATRIX{k}#>" at the drop point: the size of the symbol the placeholder needs (never rotated). */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      const placeholder = freePlaceholder(text, 'DATAMATRIX');
      const side = sideOf({}, placeholder);
      return insertCommand(text, `DMATRIX ${x},${y},${side * DEFAULT_MODULE},${side * DEFAULT_MODULE},${DEFAULT_MODULE},${side},${side},${quoted(placeholder)}`);
    }

    /** DMATRIX of a datamatrix item (see the header for the two forms). */
    function emit(item, ctx) {
      if (item.cell === 0) {
        ctx.once('tspl-dm-cell', () => diag.warning('Hay Data Matrix con módulo 0 (TPCL no los dibuja): no se escriben en TSPL'));
        return [];
      }
      if (Number.isFinite(item.rotation) && item.rotation % 360 !== 0) {
        ctx.once('tspl-dm-rotation', () => diag.warning('Hay Data Matrix con rotación: DMATRIX no tiene rotación, se escriben sin rotar'));
      }
      if (item.ecc !== undefined && item.ecc !== 200) {
        ctx.once('tspl-dm-ecc', () => diag.warning('Hay Data Matrix con un ECC distinto de ECC200: DMATRIX no lo indica, la impresora elige (se dibuja ECC200)'));
      }
      const data = String(item.data ?? '');
      const encodable = PB.slices.datamatrix.encodable(item, data);
      if (!encodable) ctx.once('tspl-dm-data', () => diag.warning('Hay Data Matrix con datos que el visor no sabe codificar: se escribe con el tamaño más grande (144×144) o el que tenga fijado'));
      const side = encodable ? sideOf(item, data) : (SIDES.includes(item.size) ? item.size : SIDES.at(-1));
      const dots = v => roundDots(exactDots(ctx, Number.isFinite(v) ? v : 0));
      const [x, y] = [Math.max(0, dots(item.x)), Math.max(0, dots(item.y))];
      const forced = SIDES.includes(item.size);
      const hasArea = !!item.area && item.area.width > 0 && item.area.height > 0;
      const content = quoted(safeData(ctx, data));
      if (!(item.cell > 0) && !forced && hasArea) return `DMATRIX ${x},${y},${Math.max(1, dots(item.area.width))},${Math.max(1, dots(item.area.height))},${content}`;
      const module = Math.max(1, dots(cellOf(item, side)));
      const [w, h] = hasArea ? [Math.max(1, dots(item.area.width)), Math.max(1, dots(item.area.height))] : [side * module, side * module];
      return `DMATRIX ${x},${y},${w},${h},${module},${side},${side},${content}`;
    }

    const isDmatrix = (item, cmd) => (cmd ? cmd.name === 'DMATRIX' : item.ref === 'DMATRIX');

    /** Symbol size: rows and columns (arguments 5 and 6) together; only when both are the same square size of the table. */
    const sizeField = {
      key: 'size', label: 'Tamaño del símbolo', type: 'select', arg: 5, reemit: true, options: SIZE_OPTIONS, model: item => item.size,
      read: (a, cmd) => {
        const [rows, cols] = [num(a), num(cmd.args[6])];
        return rows !== null && rows === cols && SIDES.includes(rows) ? rows : undefined;
      },
      write: () => null,
    };

    return {
      // emit(item, ctx) -> the DMATRIX command of a datamatrix item
      emit,
      // build(text, point, options) -> text with a new DMATRIX command (palette)
      build,
      // Move: x,y are arguments 0 and 1 (dots)
      coordinates: [{ applies: isDmatrix, fields: [{ arg: 0, axis: 'x' }, { arg: 1, axis: 'y' }] }],
      // Properties: area width and height, module and symbol size (only in the full form) and content
      editable: [{
        applies: isDmatrix,
        fields: [
          numberField('width', 'Ancho (puntos)', 2, 1, MAX_DOTS, item => item.native && item.native.width),
          numberField('height', 'Alto (puntos)', 3, 1, MAX_DOTS, item => item.native && item.native.height),
          numberField('cell', 'Módulo (puntos)', cmd => (cmd.args.length >= 8 ? 4 : -1), 1, MAX_MODULE, item => (item.native && item.native.xm) || undefined),
          sizeField,
          textField('content', 'Contenido', cmd => cmd.args.length - 1, item => (!COUNTER.test(String(item.data)) ? item.data : undefined)),
        ],
        // The size writes rows and columns together (arguments 5 and 6 of the full form)
        reemit(cmd, item, changes) {
          const side = changes.size;
          if (!SIDES.includes(side) || cmd.args.length < 8 || num(cmd.args[5]) === null || num(cmd.args[6]) === null) return null;
          return [5, 6].map(i => ({ start: cmd.args[i].start, end: cmd.args[i].end, value: String(side) }));
        },
      }],
      handlers: [
        {
          // DMATRIX x,y,width,height,[xm,row,col,]"content"
          pattern: /^DMATRIX\b/i,
          handle(m, cmd, ctx) {
            const ref = 'DMATRIX';
            if (cmd.args.length < 5) { ctx.report(diag.warning(`DMATRIX incompleto: ${cmd.raw.slice(0, 40)}`)); return; }
            const [px, py, w, h] = cmd.args.slice(0, 4).map(num);
            if ([px, py, w, h].includes(null) || w <= 0 || h <= 0) { ctx.report(diag.warning(`DMATRIX con valores no válidos: ${cmd.raw.slice(0, 40)}`)); return; }
            const native = { width: w, height: h, xm: null, rows: null, cols: null };
            let size;
            const extras = cmd.args.slice(4, -1);
            if (extras.length === 3) {
              const [xm, rows, cols] = extras.map(num);
              if ([xm, rows, cols].includes(null)) {
                ctx.report(diag.warning(`${ref}: módulo, filas y columnas no válidos (${extras.map(a => a.raw).join(',')}), se ignoran`));
              } else {
                native.xm = xm;
                if (!(xm > 0)) ctx.report(diag.warning(`${ref}: módulo "${xm}" no válido, el código se ajusta al ancho y alto`));
                else if (!Number.isInteger(xm)) ctx.report(diag.warning(`${ref}: módulo "${xm}" no es un número entero de puntos, se dibuja con ${Math.max(1, Math.round(xm))}`));
                [native.rows, native.cols] = [rows, cols];
                if (rows === 0 && cols === 0) { /* automatic */ } else if (rows === cols && SIDES.includes(rows)) size = rows;
                else ctx.report(diag.warning(`${ref}: tamaño ${rows}×${cols} no soportado (solo símbolos cuadrados de ${SIDES[0]}×${SIDES[0]} a ${SIDES.at(-1)}×${SIDES.at(-1)}), se elige el menor que cabe`));
              }
            } else if (extras.length) {
              ctx.report(diag.warning(`${ref}: parámetros opcionales no reconocidos (${extras.map(a => a.raw).join(',')}), se ignoran`));
            }

            const last = cmd.args[cmd.args.length - 1];
            counterRefsWarning(ctx, ref, last);
            let data = last.value;
            if (COUNTER.test(last.raw)) {
              data = last.raw;
              if (!ctx.tsplCounterNoted) {
                ctx.tsplCounterNoted = true;
                ctx.report(diag.info('DMATRIX: contador o variable (@n) sin evaluar, se dibuja como texto literal'));
              }
            }

            const { x, y } = ctx.pos(px, py);
            ctx.addItem({
              kind: 'datamatrix', ref, source: sourceOf(cmd), x, y, area: { width: ctx.len(w), height: ctx.len(h) },
              cell: native.xm > 0 ? Math.max(1, Math.round(native.xm)) * ctx.dot : null, rotation: 0, ...(size && { size }), ecc: 200, symbology: 'datamatrix', native, data,
            });
          },
        },
      ],
    };
  }

  PB.slices.datamatrix.tspl = tspl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
