/**
 * Line slice, TPCL language: everything the LC command (line or rectangle) needs.
 *   LC;x1,y1,x2,y2,<0 line | 1 rectangle>,<thickness in dots>[,<radius ggg>]
 * The optional radius (3 digits, 0.1 mm; B-SV4 manual 6.3.6) rounds the corners of a rectangle: it is kept as item.radius
 * (0.1 mm) and native.radius; on a line (type 0) it is ignored and no field is kept.
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

  /** Thickness of an LC command in dots: at least 1, at most the 2 digits the editor allows. */
  const MAX_THICKNESS = 99;

  /** Largest radius the 3-digit token holds, in 0.1 mm. */
  const MAX_RADIUS = 999;

  /** Emits an LC command for a line or a box item (shared with the box slice): thickness from item.width (0.1 mm). */
  function emitLC(helpers) {
    const { wrap, coordText } = helpers;
    return (item, ctx) => {
      if (item.white === true) ctx.once('tpcl-shape-white', () => PB.diagnostics.warning('Hay líneas o cajas en blanco (color W de ZPL): TPCL no tiene color de trazo, se escriben en negro'));
      else if (item.reverse === true) ctx.once('tpcl-shape-reverse', () => PB.diagnostics.warning('Hay líneas o cajas con impresión inversa (^FR o ^LR de ZPL): TPCL no la tiene en estas formas, se escriben normales'));
      const dots = Number.isFinite(item.width) ? Math.max(1, ctx.dot(item.width)) : 1;
      if (dots > MAX_THICKNESS) {
        ctx.once('tpcl-thickness', () => PB.diagnostics.warning(`Hay grosores de línea de más de ${MAX_THICKNESS} puntos: se ajustan al máximo de TPCL`));
      }
      const thickness = String(Math.min(dots, MAX_THICKNESS)).padStart(2, '0');
      const [x1, y1, x2, y2] = [item.x1, item.y1, item.x2, item.y2].map(n => coordText(ctx, n));
      // Rounded corners: only a rectangle with radius > 0 writes the optional ",ggg" (0.1 mm, 3 digits)
      const radius = item.rect && Number.isFinite(item.radius) ? Math.round(item.radius) : 0;
      if (radius > MAX_RADIUS) {
        ctx.once('tpcl-radius', () => PB.diagnostics.warning(`Hay radios de esquina de más de ${MAX_RADIUS} (0,1 mm): se ajustan al máximo de TPCL`));
      }
      const corner = radius > 0 ? `,${String(Math.min(radius, MAX_RADIUS)).padStart(3, '0')}` : '';
      return wrap(`LC;${x1},${y1},${x2},${y2},${item.rect ? 1 : 0},${thickness}${corner}`);
    };
  }

  /** LC command over the stripped text: x2, y2, type, thickness and the optional radius token (",ggg", possibly empty). */
  const LC_PATTERN = /^\{LC;\d+,\d+,(\d+),(\d+),(\d),(\d+)((?:,\d+)?)/d;

  /**
   * Radius field over the optional token (written whole with its comma: `exact`; empty when omitted, so a non-zero value
   * inserts it at the end of the command). 0 on an omitted token writes nothing; 0 on an existing one keeps it as ",000".
   */
  const radiusField = group => ({
    key: 'radius', label: 'Radio de esquina (0,1 mm)', type: 'number', min: 0, max: MAX_RADIUS, step: 1, group, exact: true,
    model: item => (item.native && item.native.radius) || 0,
    read: raw => (raw ? Number(raw.slice(1)) : 0),
    write: (v, width, raw) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      const n = Math.min(MAX_RADIUS, Math.max(0, Math.round(v)));
      if (n === 0 && raw === '') return null;
      return `,${String(n).padStart(3, '0')}`;
    },
  });

  function tpcl(helpers) {
    const { sourceOf, numberField, MAX_COORD } = helpers;
    const baseFields = [
      numberField('x2', 'Final X (0,1 mm)', 1, 0, MAX_COORD, item => item.x2),
      numberField('y2', 'Final Y (0,1 mm)', 2, 0, MAX_COORD, item => item.y2),
      numberField('width', 'Grosor (puntos)', 4, 1, 99, item => item.native.width),
      {
        key: 'rect', label: 'Tipo', type: 'select', group: 3, model: item => (item.rect ? 'box' : 'line'),
        options: [{ value: 'line', label: 'Línea' }, { value: 'box', label: 'Caja' }],
        read: raw => (raw === '0' ? 'line' : 'box'),
        write: v => (v === 'line' ? '0' : v === 'box' ? '1' : null),
      },
    ];
    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [{
        // Line or rectangle: LC;x1,y1,x2,y2,<0 line | 1 rectangle>,<thickness in dots>
        pattern: /^LC;(\d+),(\d+),(\d+),(\d+),(\d),(\d+)(?:,(\d+))?/,
        handle(m, cmd, ctx) {
          const rect = m[5] !== '0';
          const item = {
            kind: 'line', ref: 'LC', source: sourceOf(cmd), x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], rect, width: +m[6] * ctx.dot, native: { width: +m[6] },
          };
          // Rounded corners: rectangles only (0.1 mm already); a radius on a line is ignored
          if (rect && m[7] !== undefined) { item.radius = +m[7]; item.native.radius = +m[7]; }
          ctx.model.items.push(item);
        },
      }],
      // build(text, point, options) -> text with the new component
      build: (text, point) => buildLC(helpers, text, point, SIZE, false),
      // emit(item, ctx) -> the LC command of a line item
      emit: emitLC(helpers),
      // Coordinate fields moved by moveItem (see COORDINATES in js/languages/tpcl.js)
      coordinates: [
        { pattern: /^\{LC;(\d+),(\d+),(\d+),(\d+)/d, fields: [[1, null, 'x'], [2, null, 'y'], [3, null, 'x'], [4, null, 'y']] },
      ],
      // Editable shapes for describeItem / updateItem (see EDITABLE in js/languages/tpcl.js)
      editable: [
        { // Line: LC;x1,y1,<x2>,<y2>,0,<thickness in dots> (a radius token, if any, is ignored)
          applies: item => item.kind === 'line' && !item.rect,
          pattern: LC_PATTERN,
          fields: baseFields,
        },
        { // Box: the same plus the optional corner radius token (",ggg", written whole, empty when omitted)
          applies: item => item.kind === 'line' && item.rect,
          pattern: LC_PATTERN,
          fields: [...baseFields, radiusField(5)],
        },
      ],
    };
  }

  PB.slices.line.tpcl = tpcl;
  PB.slices.line.buildLC = buildLC;
  PB.slices.line.emitLC = emitLC;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
