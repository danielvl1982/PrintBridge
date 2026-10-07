/**
 * Barcode slice: SVG drawing of 1D barcodes. The model item is { kind: 'barcode', x, y, rotation, symbology, module, height,
 * widths?, interCharGap?, check?, humanReadable, data }. Code128 (module based) and the wide/narrow symbologies (Code39, ITF)
 * are drawn exactly; any other symbology is drawn as approximate filler bars.
 * Published on PB.slices.barcode.render and registered by js/components/barcode/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  const { units, barcodeData, code128, code39, itf } = PB;

  /** Displayed name of each neutral symbology (those not listed are displayed as a generic code). */
  const SYMBOLOGY_NAMES = Object.freeze({ code128: 'Code128', code39: 'Code39', itf: 'ITF', ean13: 'EAN-13' });

  /** Encoders of the wide/narrow symbologies (bars with real wide and narrow widths). */
  const WIDE_NARROW_ENCODERS = { code39, itf };

  /** Ratio of the wide to the narrow elements when the model does not give the widths (item.widths). */
  const DEFAULT_WIDE_RATIO = 3;

  /** Bars of a module-based symbology (Code128, or an approximation of the rest): widths are multiples of item.module. */
  function moduleBars(item, data) {
    const exact = item.symbology === 'code128';
    const widths = exact ? code128.encode(data) : approximateWidths(data);
    const rects = [];
    let pos = 0;
    widths.forEach((w, i) => { if (i % 2 === 0) rects.push([item.x + pos * item.module, item.y, w * item.module, item.height]); pos += w; });
    return {
      rects, total: pos * item.module, exact, readable: data.replaceAll(barcodeData.FNC1, ''),
      detail: `${pos} módulos × ${units.formatMm(item.module)} mm`, warnings: [],
    };
  }

  /**
   * Bars of a wide/narrow symbology: each encoder element gets the neutral width of its kind
   * (item.widths; without it, module and DEFAULT_WIDE_RATIO x module). Separators use item.interCharGap (default module).
   */
  function wideNarrowBars(item, encoded) {
    const w = item.widths || { narrowBar: item.module, narrowSpace: item.module, wideBar: item.module * DEFAULT_WIDE_RATIO, wideSpace: item.module * DEFAULT_WIDE_RATIO };
    const gap = item.interCharGap ?? item.module;
    const rects = [];
    let x = 0;
    encoded.elements.forEach(e => {
      const width = e.gap ? gap : e.bar ? (e.wide ? w.wideBar : w.narrowBar) : (e.wide ? w.wideSpace : w.narrowSpace);
      if (e.bar) rects.push([item.x + x, item.y, width, item.height]);
      x += width;
    });
    return {
      rects, total: x, exact: true, readable: encoded.text,
      detail: `${encoded.characters} caracteres, módulo ${units.formatMm(item.module)} mm`, warnings: encoded.warnings,
    };
  }

  /** Filler bars for barcode types the viewer does not generate exactly. */
  function approximateWidths(data) {
    const widths = [];
    let seed = 7;
    for (let i = 0; i < 16 * data.length + 20; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; widths.push(1 + (seed >> 8) % 3); }
    return widths;
  }

  /** ctx comes from drawing.js: { n } rounds to 2 decimals, { esc } escapes markup, { rectsPath } joins rectangles, { value } substitutes variables. */
  function render(item, ctx) {
    const { n, esc, rectsPath } = ctx;
    const data = ctx.value(item.data);
    const encoder = WIDE_NARROW_ENCODERS[item.symbology];
    const bars = encoder ? wideNarrowBars(item, encoder.encode(data, { check: item.check })) : moduleBars(item, data);
    const { rects, total, exact } = bars;
    let text = '';
    if (item.humanReadable && rects.length) {
      const size = Math.max(20, Math.min(40, item.height * 0.3));
      text = `<text class="human-readable" x="${n(item.x + total / 2)}" y="${n(item.y + item.height + size)}" font-size="${n(size)}">${esc(bars.readable)}</text>`;
    }
    // Content that cannot be encoded: hatched box instead of bars
    const body = rects.length
      ? `<rect class="hit" x="${item.x}" y="${item.y}" width="${n(total)}" height="${item.height}"/><path d="${rectsPath(rects)}"/>${text}`
      : `<rect class="not-generated" x="${item.x}" y="${item.y}" width="${item.height}" height="${item.height}"/>`;
    return {
      // TEC rotates the barcode around its origin (top left corner)
      markup: `<g transform="rotate(${item.rotation} ${item.x} ${item.y})">${body}</g>`,
      info: rects.length
        ? `${SYMBOLOGY_NAMES[item.symbology] || 'Código de barras'}${exact ? '' : ' (aprox.)'}: ${bars.detail} = ${units.formatMm(total)} mm de ancho`
        : 'no se ha podido generar el código de barras con estos datos',
      warnings: bars.warnings,
      anchor: [item.x, item.y],
    };
  }

  PB.slices.barcode.render = render;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
