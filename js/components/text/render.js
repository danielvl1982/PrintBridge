/**
 * Text slice: SVG drawing. The model item is { kind: 'text', x, y, rotation, font: { size, scaleX, family, weight, style },
 * data }; the text is drawn from its top-left anchor, rotated clockwise, with the printer font simulated by CSS classes.
 * Published on PB.slices.text.render and registered by js/components/text/index.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.text = PB.slices.text || {};

  /** CSS classes (css/label.css) that imitate the printer font. */
  const fontClasses = f => [`font-${f.family}`, f.weight >= 700 && 'bold', f.style === 'italic' && 'italic'].filter(Boolean).join(' ');

  /**
   * Shapes of the text attribute (reverse, box, strike) around the string, pure geometry. `attribute` is item.attribute
   * ({ kind, h, v } in 0.1 mm: the distance from the string to the end of the background / box / stroke), `box` the
   * measured string { x, y, width, height } in the text's own frame (after its horizontal scale; the browser measures it).
   * Returns shapes in that frame: { type: 'rect', role: 'fill' | 'outline', x, y, width, height } or { type: 'line', x1, y1, x2, y2 }.
   * Black (or no attribute) has none.
   */
  function attributeShapes(attribute, box) {
    if (!attribute) return [];
    const [h, v] = [attribute.h || 0, attribute.v || 0];
    const rect = role => [{ type: 'rect', role, x: box.x - h, y: box.y - v, width: box.width + 2 * h, height: box.height + 2 * v }];
    if (attribute.kind === 'reverse') return rect('fill');
    if (attribute.kind === 'box') return rect('outline');
    if (attribute.kind === 'strike') {
      const y = box.y + box.height / 2;
      return [{ type: 'line', x1: box.x - h, y1: y, x2: box.x + box.width + h, y2: y }];
    }
    return [];
  }

  /** SVG markup of attributeShapes (n rounds numbers); the classes (css/label.css) give the fill and the stroke. */
  function attributeMarkup(shapes, n) {
    return shapes.map(s => (s.type === 'line'
      ? `<line class="attr-line" x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}"/>`
      : `<rect class="${s.role === 'fill' ? 'attr-fill' : 'attr-outline'}" x="${n(s.x)}" y="${n(s.y)}" width="${n(s.width)}" height="${n(s.height)}"/>`)).join('');
  }

  const ANCHORS = Object.freeze({ center: 'middle', right: 'end' });

  /**
   * How the text is placed relative to the item's x for its alignment, pure geometry: { anchor: 'start' | 'middle' | 'end',
   * textLength? } in the text's own frame (before its horizontal scale, hence the width divided by scaleX).
   * Reading of the manual (B-SV4, Pq / Po): left starts at the designated origin, center is centred on it and right ends at it,
   * equal space spreads the characters over the area width aaaa starting at the origin. For center and right the manual's figure
   * draws them inside a string area, but only P4 carries the area width, so the area is taken as zero wide: an approximation.
   * Equal space is drawn by stretching the character spacing; when the string is wider than the area the printer reduces the
   * spacing and then the magnification (never drawn when it still does not fit), here the spacing just shrinks.
   */
  function alignAttributes(align, scaleX) {
    if (!align) return { anchor: 'start' };
    if (align.kind === 'equal') {
      const length = scaleX > 0 ? align.width / scaleX : NaN;
      return length > 0 && Number.isFinite(length) ? { anchor: 'start', textLength: length } : { anchor: 'start' };
    }
    return { anchor: ANCHORS[align.kind] || 'start' };
  }

  /** ctx comes from drawing.js: { n } rounds to 2 decimals, { esc } escapes markup, { value } substitutes variables, { textScale }. */
  function render(item, ctx) {
    const { n, esc } = ctx;
    const f = item.font;
    const attribute = item.attribute && item.attribute.kind !== 'black' ? item.attribute : null;
    // The attribute shapes are sized from the measured text (layout.js) and go behind it, in the text's rotated frame
    const behind = attribute ? `<g class="text-attr" data-kind="${esc(attribute.kind)}" transform="translate(${item.x} ${item.y}) rotate(${item.rotation})"></g>` : '';
    const classes = fontClasses(f) + (attribute && attribute.kind === 'reverse' ? ' attr-reverse' : '');
    const place = alignAttributes(item.align, f.scaleX);
    const placed = (place.anchor === 'start' ? '' : ` text-anchor="${place.anchor}"`) + (place.textLength ? ` textLength="${n(place.textLength)}" lengthAdjust="spacing"` : '');
    return {
      // .hit is sized after measuring the real text (PB.layout, in drawing.js)
      markup: `${behind}<rect class="hit"/><text class="${classes}"${placed} transform="translate(${item.x} ${item.y}) rotate(${item.rotation}) scale(${n(f.scaleX)} 1)" ` +
        `font-size="${n(f.size * ctx.textScale)}" xml:space="preserve">${esc(ctx.value(item.data))}</text>`,
      anchor: [item.x, item.y],
    };
  }

  PB.slices.text.render = render;
  PB.slices.text.attributeShapes = attributeShapes;
  PB.slices.text.alignAttributes = alignAttributes;
  PB.slices.text.attributeMarkup = attributeMarkup;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
