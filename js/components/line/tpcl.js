/**
 * Line slice, TPCL language: everything the LC command (line or rectangle) needs.
 *   LC;x1,y1,x2,y2,<0 line | 1 rectangle>,<thickness in dots>
 * The hooks are built by a factory because they need the shared helpers of js/languages/tpcl.js, which loads after
 * this file: factory(helpers) -> { handlers, build, coordinates, editable } (see js/components/registry.js).
 * The box slice reuses the LC parser, mover and editor of this file (same command) and only adds its own build.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.line = PB.slices.line || {};

  /** Line size in 0.1 mm: [width, height]. */
  const SIZE = Object.freeze([400, 0]);

  /** Thickness, in dots, of a freshly inserted LC command. */
  const DEFAULT_THICKNESS = '03';

  /**
   * Inserts an LC command of size [w, h] with its top-left corner at the point (clamped so that it stays in 0..9999).
   * rect: true for a box, false for a line. Shared with the box slice.
   */
  function buildLC(helpers, text, point, [w, h], rect) {
    const { insertCommand, pad4, clampCoord, MAX_COORD } = helpers;
    const x = Math.min(clampCoord(point.x), MAX_COORD - w);
    const y = Math.min(clampCoord(point.y), MAX_COORD - h);
    return insertCommand(text, `{LC;${pad4(x)},${pad4(y)},${pad4(x + w)},${pad4(y + h)},${rect ? 1 : 0},${DEFAULT_THICKNESS}|}`);
  }

  function tpcl(helpers) {
    const { sourceOf, numberField, MAX_COORD } = helpers;
    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [{
        // Line or rectangle: LC;x1,y1,x2,y2,<0 line | 1 rectangle>,<thickness in dots>
        pattern: /^LC;(\d+),(\d+),(\d+),(\d+),(\d),(\d+)/,
        handle(m, cmd, ctx) {
          ctx.model.items.push({
            kind: 'line', ref: 'LC', source: sourceOf(cmd), x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], rect: m[5] !== '0', width: +m[6] * ctx.dot, native: { width: +m[6] },
          });
        },
      }],
      // build(text, point, options) -> text with the new component
      build: (text, point) => buildLC(helpers, text, point, SIZE, false),
      // Coordinate fields moved by moveItem (see COORDINATES in js/languages/tpcl.js)
      coordinates: [
        { pattern: /^\{LC;(\d+),(\d+),(\d+),(\d+)/d, fields: [[1, null, 'x'], [2, null, 'y'], [3, null, 'x'], [4, null, 'y']] },
      ],
      // Editable shapes for describeItem / updateItem (see EDITABLE in js/languages/tpcl.js)
      editable: [
        { // Line / box: LC;x1,y1,<x2>,<y2>,<0 line | 1 box>,<thickness in dots>
          applies: item => item.kind === 'line',
          pattern: /^\{LC;\d+,\d+,(\d+),(\d+),(\d),(\d+)/d,
          fields: [
            numberField('x2', 'Final X (0,1 mm)', 1, 0, MAX_COORD, item => item.x2),
            numberField('y2', 'Final Y (0,1 mm)', 2, 0, MAX_COORD, item => item.y2),
            numberField('width', 'Grosor (puntos)', 4, 1, 99, item => item.native.width),
            {
              key: 'rect', label: 'Tipo', type: 'select', group: 3, model: item => (item.rect ? 'box' : 'line'),
              options: [{ value: 'line', label: 'Línea' }, { value: 'box', label: 'Caja' }],
              read: raw => (raw === '0' ? 'line' : 'box'),
              write: v => (v === 'line' ? '0' : v === 'box' ? '1' : null),
            },
          ],
        },
      ],
    };
  }

  PB.slices.line.tpcl = tpcl;
  PB.slices.line.buildLC = buildLC;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
