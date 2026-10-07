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

  /** Format options of a freshly inserted QR. */
  const VARIABLE = Object.freeze({ format: 'XB', data: 'RB', name: 'QR', tail: 'T,H,04,A,0,M2' });

  function tpcl(helpers) {
    const {
      sourceOf, insertCommand, pad4, clampCoord, numberField, nextId, freePlaceholder,
    } = helpers;

    /** Adds a QR XB format command plus its RB data command with a unique <#QR{k}#> variable (rotation does not apply). */
    function build(text, point) {
      const { format, data, name, tail } = VARIABLE;
      const id = nextId(text, format, data);
      const placeholder = freePlaceholder(text, name);
      const withFormat = insertCommand(text, `{${format}${id};${pad4(clampCoord(point.x))},${pad4(clampCoord(point.y))},${tail}|}`);
      return insertCommand(withFormat, `{${data}${id};${placeholder}|}`);
    }

    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [
        {
          // QR code: XBnn;x,y,T,<correction>,<module size>,…
          pattern: /^XB(\d+);(\d+),(\d+),T,(\w),(\d+)/,
          handle(m, cmd, ctx) {
            const ref = 'XB' + m[1];
            if (!(m[4] in ECC_LEVELS)) ctx.report(diag.warning(`${ref}: corrección de errores "${m[4]}" desconocida, se dibuja con ${DEFAULT_ECC}`));
            ctx.addField(ref, {
              kind: 'qr', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3], cell: m[5] },
              ecc: ECC_LEVELS[m[4]] ?? DEFAULT_ECC, cell: +m[5] * ctx.dot, symbology: 'qr', native: { type: 'T', cell: +m[5] }, data: null,
            });
          },
        },
      ],
      // build(text, point, options) -> text with the new component
      build,
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
            numberField('cell', 'Tamaño de módulo (puntos)', 2, 1, 99, item => item.native.cell),
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
