/**
 * Data Matrix slice: SVG drawing. The model item is { kind: 'datamatrix', x, y, rotation, cell, size?, ecc, area?, symbology, native, data }
 * (see js/core/model.js). `cell` is the module size in 0.1 mm (0 = the printer draws nothing; null = no module, fit the `area`, the
 * TSPL form without the optional module). Like the QR drawing there is no quiet zone; like the 1D barcodes the symbol turns around its
 * origin (top left corner) by item.rotation. Published on PB.slices.datamatrix.render (with cellOf and sideOf, which the language
 * hooks share) and registered by js/components/datamatrix/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.datamatrix = PB.slices.datamatrix || {};

  const { units, datamatrix: dm } = PB;

  /** Module (0.1 mm) when the item has neither a module nor an area (never produced by the parsers). */
  const DEFAULT_CELL = 5;
  /** Side in modules of the hatched placeholder when the symbol cannot be generated. */
  const PLACEHOLDER_SIDE = 18;

  /**
   * Module size in 0.1 mm of an item whose symbol has `side` modules: its own module; else the largest whole number of dots that fits
   * the area (min(width, height) / side, rounded down: the printer cannot draw fractions of a dot; the dot is area / native dots);
   * else the default. 0 stays 0 (not drawn).
   */
  function cellOf(item, side) {
    if (item.cell === 0) return 0;
    if (Number.isFinite(item.cell) && item.cell > 0) return item.cell;
    const a = item.area;
    if (a && a.width > 0 && a.height > 0) {
      const n = item.native;
      if (n && n.width > 0 && n.height > 0) return Math.max(1, Math.floor(Math.min(n.width, n.height) / side)) * (a.width / n.width);
      return Math.min(a.width, a.height) / side;
    }
    return DEFAULT_CELL;
  }

  /** Encodes the data with the item's forced size; a size that does not hold the data falls back to the smallest. Null if it cannot be encoded. */
  function encodeItem(item, data) {
    let out = dm.encode(data, { size: item.size });
    if (!out.ok && out.reason === 'size') out = dm.encode(data);
    return out.ok ? out : null;
  }

  /** Side in modules of the symbol an item draws (a forced or placeholder side when the data cannot be encoded). */
  function sideOf(item, data) {
    const out = encodeItem(item, String(data ?? ''));
    return out ? out.side : (item.size || PLACEHOLDER_SIDE);
  }

  /** True when the data can be drawn (ASCII encodation, fits 144x144; a forced size that is too small falls back to the smallest). */
  const encodable = (item, data) => encodeItem(item, String(data ?? '')) !== null;

  /**
   * Side in modules of what render() draws for the data: the symbol when the item is ECC200, has a module and its data can be encoded, else the
   * hatched placeholder (the forced size or a default). The ZPL hooks need it to place the symbol from the origin of its field.
   */
  function sideDrawn(item, data) {
    const supported = item.ecc === undefined || item.ecc === 200;
    const out = supported && item.cell !== 0 ? encodeItem(item, data) : null;
    return out ? out.side : (item.size || PLACEHOLDER_SIDE);
  }

  /** ctx comes from drawing.js: { n } rounds to 2 decimals, { rectsPath } joins rectangles, { value } substitutes variables. */
  function render(item, ctx) {
    const { n, rectsPath } = ctx;
    const supported = item.ecc === undefined || item.ecc === 200;
    const out = supported && item.cell !== 0 ? encodeItem(item, ctx.value(item.data)) : null;
    const side = out ? out.side : (item.size || PLACEHOLDER_SIDE);
    const cell = cellOf(item, side) || DEFAULT_CELL;
    const length = side * cell;
    const rects = [];
    if (out) {
      for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) if (out.isDark(r, c)) rects.push([item.x + c * cell, item.y + r * cell, cell + 0.3, cell + 0.3]);
    }
    const body = `<rect class="hit" x="${item.x}" y="${item.y}" width="${n(length)}" height="${n(length)}"/>` +
      (out ? `<path d="${rectsPath(rects)}"/>` : `<rect class="not-generated" x="${item.x}" y="${item.y}" width="${n(length)}" height="${n(length)}"/>`);
    const turn = Number.isFinite(item.rotation) ? ((item.rotation % 360) + 360) % 360 : 0;
    let info;
    if (out) info = `Data Matrix ${side}×${side} módulos = ${units.formatMm(length)} mm`;
    else if (item.cell === 0) info = 'módulo 0: la impresora no dibuja el Data Matrix';
    else if (!supported) info = `ECC ${item.ecc} no soportado (solo se genera ECC200): no se dibuja`;
    else info = 'no se ha podido generar el Data Matrix con estos datos';
    return {
      markup: turn ? `<g transform="rotate(${turn} ${item.x} ${item.y})">${body}</g>` : body,
      info,
      anchor: [item.x, item.y],
    };
  }

  PB.slices.datamatrix.render = render;
  PB.slices.datamatrix.cellOf = cellOf;
  PB.slices.datamatrix.sideOf = sideOf;
  PB.slices.datamatrix.sideDrawn = sideDrawn;
  PB.slices.datamatrix.encodable = encodable;
  PB.slices.datamatrix.DEFAULT_CELL = DEFAULT_CELL;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
