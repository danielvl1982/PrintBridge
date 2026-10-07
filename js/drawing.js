/**
 * Drawing of the label as SVG and checks for overlaps and items outside the label.
 */

/**
 * Draws the model as SVG (text). It does not touch the DOM: it returns the markup and the information of each item.
 *
 * To draw a new item type: register a slice with a `render` (js/components/registry.js; the text, barcode, qr, line, box and image
 * slices are the pattern).
 * Each renderer receives (item, ctx) and returns { markup, info?, warnings?, anchor? }. The model measures are already in 0.1 mm.
 * An item of a type without a renderer is not drawn and a warning is reported.
 */
(function (PB) {
  'use strict';

  const { variables, sources, viewRotation, diagnostics: diag } = PB;

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = v => Number(v.toFixed(2));

  /** Rectangles [x, y, width, height] -> a single path (much lighter than one <rect> per module). */
  const rectsPath = rects => rects.map(([x, y, w, h]) => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`).join('');

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
      rectsPath,
      value: data => variables.substitute(data, opts.values),
    };
    const { width, height } = area;
    const pad = 30;
    const info = [];
    const anchors = [];
    let body = '';
    model.items.forEach((item, index) => {
      const slice = PB.components.forItem(item);
      const renderer = slice && slice.render;
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
 * Checks that need the SVG already painted in the browser (real measures, taken by each slice's `layout` hook):
 * items that go outside the label and items that overlap.
 * The view rotation does not affect them: every measure is relative to the item's group (getBBox, or the
 * group->element matrix, where the transform of the "view-rotation" ancestor cancels out), that is, in label coordinates.
 */
(function (PB) {
  'use strict';

  const { diagnostics: diag } = PB;

  /** Margin (0.1 mm) to avoid warning about mere contact between boxes. */
  const OVERLAP_TOLERANCE = 2;

  function intersection(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    return x2 - x1 > OVERLAP_TOLERANCE && y2 - y1 > OVERLAP_TOLERANCE ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
  }

  /**
   * Analyzes the painted SVG, generic over the item kinds: each painted item is measured by its slice's `layout` hook
   * (the text one also adjusts its click area) and, if markOverlaps, the overlaps are marked.
   * Returns the list of diagnostics.
   */
  function analyze(svgEl, model, area, { markOverlaps }) {
    const out = [];
    const boxes = [];
    svgEl.querySelectorAll('.item').forEach(group => {
      const item = model.items[Number(group.dataset.index)];
      const slice = PB.components.forItem(item);
      // Slice hook: { full, ink } boxes, or null to leave the item out of the checks. Without a hook: the group box.
      const measured = slice && slice.layout ? slice.layout(group, item) : { full: group.getBBox(), ink: group.getBBox() };
      if (!measured) return;
      const { full, ink } = measured;
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
