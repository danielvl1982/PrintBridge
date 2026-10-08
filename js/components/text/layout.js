/**
 * Text slice: layout measures taken from the painted SVG (real text widths, only available in the browser).
 * Published on PB.slices.text.layout and registered by js/components/text/index.js as the slice's `layout` hook, which
 * PB.layout.analyze (js/drawing.js) calls for every painted item of this kind.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.text = PB.slices.text || {};

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
    const ink = boxInGroup(textEl, { x, y: -size * PB.config.capHeightRatio, width, height: size * PB.config.capHeightRatio });
    return { full, ink };
  }

  /**
   * Fills the .text-attr group of a text with an attribute (reverse, box, strike) from the measured string and widens the
   * click/overflow box to include it. The geometry is attributeShapes (render.js); this only measures and inserts.
   */
  function paintAttribute(group, item, textEl, measured) {
    const target = group.querySelector('.text-attr');
    if (!target || !item || !item.attribute) return;
    const b = textEl.getBBox();
    const scaleX = item.font.scaleX;
    const shapes = PB.slices.text.attributeShapes(item.attribute, { x: b.x * scaleX, y: b.y, width: b.width * scaleX, height: b.height });
    target.innerHTML = PB.slices.text.attributeMarkup(shapes, v => Number(v.toFixed(2)));
    if (!shapes.length) return;
    const extra = boxInGroup(target, target.getBBox());
    const x = Math.min(measured.full.x, extra.x), y = Math.min(measured.full.y, extra.y);
    measured.full = { x, y, width: Math.max(measured.full.x + measured.full.width, extra.x + extra.width) - x, height: Math.max(measured.full.y + measured.full.height, extra.y + extra.height) - y };
  }

  /**
   * layout(group, item) hook: { full, ink } boxes of the painted item, or null to leave it out of the checks (blank text).
   * Also fits the click area (.hit) to the measured text.
   */
  function layout(group, item) {
    const textEl = group.querySelector('text');
    const measured = textBoxes(textEl);
    if (!measured) return null;
    paintAttribute(group, item, textEl, measured);
    const hit = group.querySelector('.hit');
    for (const k of ['x', 'y', 'width', 'height']) hit.setAttribute(k, measured.full[k]);
    return measured;
  }

  PB.slices.text.layout = layout;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
