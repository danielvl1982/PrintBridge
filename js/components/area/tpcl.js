/**
 * Area slice, TPCL language: the XR (clear area) command, B-SV4 manual 6.3.5.
 *   XR;aaaa,bbbb,cccc,dddd,e   aaaa/cccc = start/end X (4 digits), bbbb/dddd = start/end Y (4 or 5 digits), all 0.1 mm;
 *                              e = A (clears the area to zeros) or B (reverses the white/black dots of the area)
 * The start and end points may be given in any order (manual notes 1 and 2), so the neutral item takes the normalised rectangle:
 * { kind: 'area', ref: 'XR', mode: 'clear' | 'reverse', x, y, width, height } (0.1 mm). native keeps the command as written:
 * { x1, y1, x2, y2, type: 'A' | 'B' }; emit writes those back while they still describe the rectangle (a lossless round trip,
 * reversed corners included; a 5-digit Y is written with 4 digits, the width the editor and the move use) and builds the command from x, y, width, height otherwise (converted items).
 * Edit: the end point (`x2`, `y2`, like the TPCL line) and a `mode` select that rewrites the type letter only.
 * The command acts on what is drawn BEFORE it, so the item keeps its position in command order (the parser adds it as it reads it).
 * Palette: ONE entry (Área invertida = type B), 30 x 10 mm at the drop point, written before the print command.
 * factory(helpers) -> { handlers, build, emit, coordinates, editable }; registered by js/components/area/index.js as `languages: { tpcl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.area = PB.slices.area || {};

  const { diagnostics: diag } = PB;

  /** A freshly inserted area: 30 x 10 mm in 0.1 mm. */
  const TEMPLATE = Object.freeze([300, 100]);

  const TYPE_MODE = Object.freeze({ A: 'clear', B: 'reverse' });
  const MODE_TYPE = Object.freeze({ clear: 'A', reverse: 'B' });

  /** XR over the stripped text: the end point (groups 3 and 4) and the type letter (group 5). */
  const XR_PATTERN = /^\{XR;(\d+),(\d+),(\d+),(\d+),([AB])/d;

  function tpcl(helpers) {
    const { sourceOf, numberField, insertCommand, pad4, clampCoord, coordText, coordDigitsWarning, wrap, MAX_COORD } = helpers;

    /** Normalised [min, max] of two coordinates. */
    const span = (a, b) => [Math.min(a, b), Math.max(a, b)];

    /** XR from an item: the native corners while they still describe the item's rectangle, else the rectangle itself. */
    function emit(item, ctx) {
      const [x1, y1] = [item.x, item.y].map(v => Math.round(Number.isFinite(v) ? v : 0));
      const [x2, y2] = [x1 + Math.round(Number.isFinite(item.width) ? item.width : 0), y1 + Math.round(Number.isFinite(item.height) ? item.height : 0)];
      const n = item.native;
      const kept = n && [n.x1, n.y1, n.x2, n.y2].every(Number.isFinite)
        && span(n.x1, n.x2).join() === [x1, x2].join() && span(n.y1, n.y2).join() === [y1, y2].join();
      const corners = (kept ? [n.x1, n.y1, n.x2, n.y2] : [x1, y1, x2, y2]).map(v => coordText(ctx, v));
      return wrap(`XR;${corners.join(',')},${MODE_TYPE[item.mode] || 'B'}`);
    }

    /** Adds {XR;x1,y1,x2,y2,B|}: a TEMPLATE-sized reverse area with its top-left corner at the drop point (kept inside 0..9999). */
    function build(text, point) {
      const [w, h] = TEMPLATE;
      const x = Math.min(clampCoord(point.x), MAX_COORD - w);
      const y = Math.min(clampCoord(point.y), MAX_COORD - h);
      return insertCommand(text, wrap(`XR;${pad4(x)},${pad4(y)},${pad4(x + w)},${pad4(y + h)},B`));
    }

    return {
      handlers: [{
        // XR;aaaa,bbbb,cccc,dddd,e
        pattern: /^XR;/,
        handle(m, cmd, ctx) {
          const parts = /^XR;(\d+),(\d+),(\d+),(\d+),(.*)$/.exec(cmd.raw);
          if (!parts) { ctx.report(diag.warning(`XR no válido: {${cmd.raw.slice(0, 40)}|}`)); return; }
          const type = parts[5].trim();
          if (!Object.hasOwn(TYPE_MODE, type)) {
            ctx.report(diag.warning(`XR con tipo desconocido "${type.slice(0, 10)}" (se esperaba A o B): {${cmd.raw.slice(0, 40)}|}`));
            return;
          }
          // X fixed to 4 digits, Y 4 or 5 (the values are read as written)
          const coords = coordDigitsWarning('XR', [['x1', parts[1]], ['y1', parts[2]], ['x2', parts[3]], ['y2', parts[4]]]);
          if (coords) ctx.report(coords);
          const [x1, y1, x2, y2] = parts.slice(1, 5).map(Number);
          const [x, right] = span(x1, x2);
          const [y, bottom] = span(y1, y2);
          ctx.model.items.push({
            kind: 'area', ref: 'XR', mode: TYPE_MODE[type], source: sourceOf(cmd), x, y, width: right - x, height: bottom - y,
            native: { x1, y1, x2, y2, type },
          });
        },
      }],
      build,
      emit,
      // Move: both corners (the same as the LC line)
      coordinates: [{ pattern: /^\{XR;(\d+),(\d+),(\d+),(\d+)/d, fields: [[1, null, 'x'], [2, null, 'y'], [3, null, 'x'], [4, null, 'y']] }],
      editable: [{
        applies: item => item.kind === 'area',
        pattern: XR_PATTERN,
        fields: [
          numberField('x2', 'Final X (0,1 mm)', 3, 0, MAX_COORD, item => (item.native ? item.native.x2 : item.x + item.width)),
          numberField('y2', 'Final Y (0,1 mm)', 4, 0, MAX_COORD, item => (item.native ? item.native.y2 : item.y + item.height)),
          {
            key: 'mode', label: 'Tipo', type: 'select', group: 5, model: item => item.mode,
            options: [{ value: 'reverse', label: 'Invertir' }, { value: 'clear', label: 'Borrar' }],
            read: raw => TYPE_MODE[raw],
            write: v => MODE_TYPE[v] || null,
          },
        ],
      }],
    };
  }

  PB.slices.area.tpcl = tpcl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
