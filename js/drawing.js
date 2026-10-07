/**
 * Drawing of the label as SVG and checks for overlaps and items outside the label.
 */

/**
 * Draws the model as SVG (text). It does not touch the DOM: it returns the markup and the information of each item.
 *
 * To draw a new item type: register a slice with a `render` (js/components/registry.js; the text, line and box slices are the
 * pattern) or, for the kinds not migrated yet, add a function to RENDERERS with its "kind".
 * Each renderer receives (item, ctx) and returns { markup, info?, warnings?, anchor? }. The model measures are already in 0.1 mm.
 * An item of a type without a renderer is not drawn and a warning is reported.
 */
(function (PB) {
  'use strict';

  const { units, variables, code128, code39, itf, qr, sources, barcodeData, viewRotation, diagnostics: diag } = PB;

  /** Displayed name of each neutral symbology (those not listed are displayed as a generic code). */
  const SYMBOLOGY_NAMES = Object.freeze({ code128: 'Code128', code39: 'Code39', itf: 'ITF', ean13: 'EAN-13' });

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = v => Number(v.toFixed(2));

  /** Rectangles [x, y, width, height] -> a single path (much lighter than one <rect> per module). */
  const rectsPath = rects => rects.map(([x, y, w, h]) => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`).join('');

  const RENDERERS = {
    qr(item, ctx) {
      const m = qr.matrix(ctx.value(item.data), item.ecc);
      const cell = item.cell;
      const size = m ? m.size : 21;
      const rects = [];
      if (m) for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m.isDark(r, c)) rects.push([item.x + c * cell, item.y + r * cell, cell + 0.3, cell + 0.3]);
      const side = size * cell;
      return {
        markup: `<rect class="hit" x="${item.x}" y="${item.y}" width="${n(side)}" height="${n(side)}"/>` +
          (m ? `<path d="${rectsPath(rects)}"/>` : `<rect class="not-generated" x="${item.x}" y="${item.y}" width="${n(side)}" height="${n(side)}"/>`),
        info: m ? `QR ${size}×${size} módulos = ${units.formatMm(side)} mm` : 'no se ha podido generar el QR con estos datos',
        anchor: [item.x, item.y],
      };
    },

    barcode(item, ctx) {
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
    },

    image(item) {
      return {
        // .hit goes after the picture so the hover/selection highlight is painted over it
        markup: (item.bitmap ? bitmapMarkup(item) : `<image href="${esc(item.href)}" x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" preserveAspectRatio="none"/>`) +
          `<rect class="hit" x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}"/>`,
        info: `imagen ${units.formatMm(item.width)} × ${units.formatMm(item.height)} mm`,
        anchor: [item.x, item.y],
      };
    },
  };

  /**
   * Bitmap of an image item (flat 0/1 array, 1 = black) as a single path of black row runs, in bitmap dots, inside a group
   * that places it at item.x/y and scales a dot to item.width / bitmap.w by item.height / bitmap.h (0.1 mm).
   */
  function bitmapMarkup({ x, y, width, height, bitmap: { w, h, data } }) {
    let d = '';
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (!data[row * w + col]) continue;
        const start = col;
        while (col + 1 < w && data[row * w + col + 1]) col++;
        const run = col - start + 1;
        d += `M${start} ${row}h${run}v1h${-run}z`;
      }
    }
    const scale = v => Number(v.toFixed(4));
    return `<g transform="translate(${x} ${y}) scale(${scale(width / w)} ${scale(height / h)})">` +
      (d ? `<path d="${d}" shape-rendering="crispEdges"/>` : '') + `</g>`;
  }

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

  function grid(width, height) {
    // The size of the numbers adapts to the label size so they read the same on a small label as on a large one
    const fontSize = Math.max(14, Math.round(Math.max(width, height) / 150));
    const label = (x, y, text) => `<text class="grid-text" x="${x}" y="${y}" font-size="${fontSize}">${text}</text>`;
    let out = '';
    for (let x = 100; x < width; x += 100) out += `<line class="grid-line" x1="${x}" y1="0" x2="${x}" y2="${height}"/>${label(x + 3, fontSize + 2, x)}`;
    for (let y = 100; y < height; y += 100) out += `<line class="grid-line" x1="0" y1="${y}" x2="${width}" y2="${y}"/>${label(3, y - 3, y)}`;
    return out;
  }

  /**
   * opts: { textScale, showGrid, showAnchors, values, rotation (0|90|180|270 clockwise, view only; default 0) }
   * Returns { svg, diagnostics } (diagnostics = information about each item: QR size, barcode width...).
   */
  function render(model, area, opts) {
    const ctx = {
      textScale: opts.textScale,
      n,
      esc,
      value: data => variables.substitute(data, opts.values),
    };
    const { width, height } = area;
    const pad = 30;
    const info = [];
    const anchors = [];
    let body = '';
    model.items.forEach((item, index) => {
      const slice = PB.components.forItem(item);
      const renderer = (slice && slice.render) || RENDERERS[item.kind];
      if (!renderer) {
        info.push(diag.warning(`${item.ref || 'Elemento'}: tipo "${item.kind}" desconocido, no se dibuja`));
        return;
      }
      const out = renderer(item, ctx);
      const label = sources.labelOf(item);
      body += `<g class="item" data-index="${index}">${label ? `<title>${esc(label)}</title>` : ''}${out.markup}</g>`;
      if (out.info) info.push(diag.info(`${item.ref}: ${out.info}`));
      (out.warnings || []).forEach(text => info.push(diag.warning(`${item.ref}: ${text}`)));
      if (out.anchor) anchors.push(out.anchor);
    });
    const anchorRadius = Math.max(5, Math.round(Math.max(width, height) / 450));
    // With rotation the whole drawing goes in a rotated group: inside it, label coordinates are still used
    const rotation = opts.rotation || 0;
    const box = viewRotation.viewBoxFor(width, height, rotation, pad);
    const transform = viewRotation.transformFor(width, height, rotation);
    const drawing =
      `<rect class="label-background" x="0" y="0" width="${width}" height="${height}"/>` +
      (opts.showGrid ? grid(width, height) : '') +
      body +
      `<g class="overlaps"></g>` +
      (opts.showAnchors ? anchors.map(([x, y]) => `<circle class="origin" cx="${x}" cy="${y}" r="${anchorRadius}"/>`).join('') : '');
    const svg =
      `<svg viewBox="${box.x} ${box.y} ${box.width} ${box.height}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><pattern id="not-generated" width="12" height="12" patternUnits="userSpaceOnUse"><path class="hatch" d="M0 12L12 0"/></pattern></defs>` +
      (transform ? `<g class="view-rotation" transform="${transform}">${drawing}</g>` : drawing) +
      `</svg>`;
    return { svg, diagnostics: info };
  }

  PB.svgRenderer = Object.freeze({ render });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Checks that need the SVG already painted in the browser (real text measures):
 * items that go outside the label and items that overlap.
 * The view rotation does not affect them: every measure is relative to the item's group (getBBox, or the
 * group->element matrix, where the transform of the "view-rotation" ancestor cancels out), that is, in label coordinates.
 */
(function (PB) {
  'use strict';

  const { config, diagnostics: diag } = PB;

  /** Margin (0.1 mm) to avoid warning about mere contact between boxes. */
  const OVERLAP_TOLERANCE = 2;

  /** Rectangle in element coordinates -> box in its group's coordinates (applies rotation and scale). */
  function boxInGroup(el, rect) {
    const matrix = el.parentNode.getCTM().inverse().multiply(el.getCTM());
    const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
      .map(([x, y]) => { const p = el.ownerSVGElement.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(matrix); });
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  /**
   * Boxes of a text: "full" (font box, for label overflow and for the click area)
   * and "ink" (only capital letter height and without spaces at the ends, for overlaps).
   */
  function textBoxes(textEl) {
    const content = textEl.textContent;
    if (!content.trim()) return null;
    const full = boxInGroup(textEl, textEl.getBBox());
    const lead = content.length - content.trimStart().length;
    const end = content.trimEnd().length;
    const size = Number(textEl.getAttribute('font-size'));
    const x = lead ? textEl.getSubStringLength(0, lead) : 0;
    const width = textEl.getSubStringLength(lead, end - lead);
    const ink = boxInGroup(textEl, { x, y: -size * config.capHeightRatio, width, height: size * config.capHeightRatio });
    return { full, ink };
  }

  function intersection(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    return x2 - x1 > OVERLAP_TOLERANCE && y2 - y1 > OVERLAP_TOLERANCE ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
  }

  /**
   * Analyzes the painted SVG. Adjusts the click areas of the texts and, if markOverlaps, marks the overlaps.
   * Returns the list of diagnostics.
   */
  function analyze(svgEl, model, area, { markOverlaps }) {
    const out = [];
    const boxes = [];
    svgEl.querySelectorAll('.item').forEach(group => {
      const item = model.items[Number(group.dataset.index)];
      if (item.kind === 'line') return;
      let full, ink;
      if (item.kind === 'text') {
        const measured = textBoxes(group.querySelector('text'));
        if (!measured) return;
        ({ full, ink } = measured);
        const hit = group.querySelector('.hit');
        for (const k of ['x', 'y', 'width', 'height']) hit.setAttribute(k, full[k]);
      } else {
        full = ink = group.getBBox();
      }
      boxes.push({ item, box: ink });
      if (full.x < -0.5 || full.y < -0.5 || full.x + full.width > area.width + 0.5 || full.y + full.height > area.height + 0.5) {
        out.push(diag.error(`${item.ref} se sale de la etiqueta (${Math.round(full.x)},${Math.round(full.y)} → ${Math.round(full.x + full.width)},${Math.round(full.y + full.height)})`));
      }
    });

    let marks = '';
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => {
      const hit = intersection(a.box, b.box);
      if (!hit) return;
      out.push(diag.error(`${a.item.ref} se solapa con ${b.item.ref}`));
      if (markOverlaps) marks += `<rect class="overlap" x="${hit.x}" y="${hit.y}" width="${hit.width}" height="${hit.height}"/>`;
    }));
    svgEl.querySelector('.overlaps').innerHTML = marks;
    return out;
  }

  PB.layout = Object.freeze({ analyze });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
