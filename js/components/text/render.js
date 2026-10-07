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

  /** ctx comes from drawing.js: { n } rounds to 2 decimals, { esc } escapes markup, { value } substitutes variables, { textScale }. */
  function render(item, ctx) {
    const { n, esc } = ctx;
    const f = item.font;
    return {
      // .hit is sized after measuring the real text (PB.layout, in drawing.js)
      markup: `<rect class="hit"/><text class="${fontClasses(f)}" transform="translate(${item.x} ${item.y}) rotate(${item.rotation}) scale(${n(f.scaleX)} 1)" ` +
        `font-size="${n(f.size * ctx.textScale)}" xml:space="preserve">${esc(ctx.value(item.data))}</text>`,
      anchor: [item.x, item.y],
    };
  }

  PB.slices.text.render = render;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
