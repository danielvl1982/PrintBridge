/**
 * Barcode slice: SVG drawing of 1D barcodes. The model item is { kind: 'barcode', x, y, rotation, symbology, module, height,
 * widths?, interCharGap?, check?, addon?, guard?, humanReadable, data }. Code128 (module based), the wide/narrow symbologies (Code39, ITF)
 * and EAN-13 / EAN-8 / UPC-A / UPC-E with their add-ons (module based, with the digits laid out as for these symbologies) are drawn
 * exactly; any other symbology is drawn as approximate filler bars.
 * Published on PB.slices.barcode.render and registered by js/components/barcode/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.barcode = PB.slices.barcode || {};

  const { units, barcodeData, code128, code39, itf, ean } = PB;

  /** Displayed name of each neutral symbology (those not listed are displayed as a generic code). */
  const SYMBOLOGY_NAMES = Object.freeze({ code128: 'Code128', code39: 'Code39', itf: 'ITF', ean13: 'EAN-13', ean8: 'EAN-8', upca: 'UPC-A', upce: 'UPC-E' });

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

  /** Fraction of the text size the add-on digits sit above the add-on bars (their baseline is this close to the bars). */
  const ADDON_TEXT_GAP = 0.1;
  /** The digits of an EAN / UPC symbol are at most this many modules tall (they must fit in a cell of 7 modules). */
  const MAX_DIGIT_MODULES = 10;

  /** Size of the human-readable digits: the usual 20..40 units of the other symbologies, small enough for the modules of a cell. */
  const digitSize = item => Math.min(Math.max(20, Math.min(40, item.height * 0.3)), MAX_DIGIT_MODULES * item.module);

  /**
   * EAN-13 / EAN-8 / UPC-A / UPC-E (+ add-on): bars from the module pattern; the guard bars (start, centre, end) are longer when the
   * digits are printed (item.guard, 0.1 mm, replaces that length when given: the TPCL WPC guard bar field; 0 = not longer). The digits
   * go under the bars, one per module cell (the ones outside the bars in the quiet zone); the add-on digits are above the add-on bars,
   * which then start below them. Returns the bars and the digit texts (SVG x lists, one centred x per digit).
   */
  function eanBars(item, encoded) {
    const m = item.module;
    const readable = !!item.humanReadable && encoded.ok;
    const size = digitSize(item);
    const guard = item.guard !== undefined ? Math.max(0, item.guard) : (readable ? size : 0);
    const addonTop = readable && encoded.addonBars.length ? Math.min(size, item.height * 0.4) : 0;
    const rects = [
      ...encoded.bars.map(b => [item.x + b.x * m, item.y, b.w * m, item.height + (b.guard ? guard : 0)]),
      ...encoded.addonBars.map(b => [item.x + b.x * m, item.y + addonTop, b.w * m, item.height - addonTop]),
    ];
    const texts = [];
    if (readable) {
      const main = encoded.digits.filter(d => d.zone === 'main');
      const inside = main.filter(d => d.x >= 0 && d.x <= encoded.width);
      // Digits outside the bars (first digit, number system, check digit) are their own text; the inside ones are split at the centre guard
      const centre = encoded.symbology === 'upce' ? Infinity : encoded.width / 2;
      const groups = [
        ...main.filter(d => d.x < 0).map(d => [d]),
        inside.filter(d => d.x < centre), inside.filter(d => d.x >= centre),
        ...main.filter(d => d.x > encoded.width).map(d => [d]),
      ].filter(g => g.length);
      const baseline = item.y + item.height + size;
      groups.forEach(g => texts.push({ xs: g.map(d => item.x + d.x * m), y: baseline, size, text: g.map(d => d.char).join('') }));
      const addon = encoded.digits.filter(d => d.zone === 'addon');
      if (addon.length) texts.push({ xs: addon.map(d => item.x + d.x * m), y: item.y + addonTop - size * ADDON_TEXT_GAP, size, text: addon.map(d => d.char).join('') });
    }
    return {
      rects, total: encoded.totalWidth * m, exact: true, readable: encoded.text, texts,
      detail: `${encoded.totalWidth} módulos × ${units.formatMm(m)} mm`, warnings: encoded.warnings,
      name: `${SYMBOLOGY_NAMES[item.symbology]}${encoded.addonText ? ` +${encoded.addonText.length}` : ''}`,
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
    const bars = Object.hasOwn(ean.NAMES, item.symbology)
      ? eanBars(item, ean.encode(item.symbology, data, { check: item.check, addon: item.addon }))
      : encoder ? wideNarrowBars(item, encoder.encode(data, { check: item.check })) : moduleBars(item, data);
    const { rects, total, exact } = bars;
    let text = '';
    if (bars.texts) {
      text = bars.texts.map(t => `<text class="human-readable" x="${t.xs.map(n).join(' ')}" y="${n(t.y)}" font-size="${n(t.size)}">${esc(t.text)}</text>`).join('');
    } else if (item.humanReadable && rects.length) {
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
        ? `${bars.name || SYMBOLOGY_NAMES[item.symbology] || 'Código de barras'}${exact ? '' : ' (aprox.)'}: ${bars.detail} = ${units.formatMm(total)} mm de ancho`
        : 'no se ha podido generar el código de barras con estos datos',
      warnings: bars.warnings,
      anchor: [item.x, item.y],
    };
  }

  PB.slices.barcode.render = render;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
