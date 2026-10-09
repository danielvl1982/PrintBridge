/**
 * Text slice: SVG drawing. The model item is { kind: 'text', x, y, rotation, font: { size, scaleX, family, weight, style },
 * data, block? }; the text is drawn from its baseline origin, rotated clockwise, with the printer font simulated by CSS classes.
 * A text with `block` (TSPL BLOCK, ZPL ^FB) is word wrapped in the block width (wrapBlock) and drawn as one <tspan> per line.
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

  /**
   * Letter spacing of the character spacing option (ghh / ghhh), pure geometry: the signed distance (0.1 mm, item.spacing.value)
   * in the text's own frame (before its horizontal scale, hence divided by scaleX), or null when there is none. Faithful to the
   * manual (the dots are added to each character's own advance, as SVG letter-spacing does); with equal space the spacing is
   * invalid in the manual, so it is not drawn (the stretch of the alignment decides).
   */
  function spacingAttributes(spacing, align, scaleX) {
    if (!spacing || !Number.isFinite(spacing.value) || spacing.value === 0) return null;
    if (align && align.kind === 'equal') return null;
    return scaleX > 0 ? spacing.value / scaleX : null;
  }

  /**
   * Overprint shifts of the bold option (Jkkll), pure geometry: the string is printed again shifted by the horizontal shift
   * (h), the vertical one (v) and both, in 0.1 mm, in the text's own rotated frame. Approximation: the printer's exact overprint
   * pattern is not in the manual (only its figure), the copies thicken the strokes by those distances. Nothing for 0 / 0.
   */
  function boldShifts(bold) {
    if (!bold) return [];
    const [h, v] = [bold.h > 0 ? bold.h : 0, bold.v > 0 ? bold.v : 0];
    return [h && { dx: h, dy: 0 }, v && { dx: 0, dy: v }, h && v && { dx: h, dy: v }].filter(Boolean);
  }

  /**
   * Zero suppression of the preview (B-SV4 manual 6.3.7 (11), item.zeroSuppress = Zpp): the leading zeros of the data row are replaced
   * by spaces so that `count` characters stay, never past the first non-zero character; with a count greater than the row (or 0)
   * the row is drawn as is. Table of the manual: 0000/1 -> "   0", 0000/2 -> "  00", 0A12/2 -> " A12", 0123/3 -> " 123", 0123/4 and 0123/5 -> "0123".
   * The data written to the code is never changed: this is only what the preview draws.
   */
  function suppressZeros(data, count) {
    const text = String(data == null ? '' : data);
    if (!(count > 0) || count > text.length) return text;
    let leading = 0;
    while (leading < text.length && text[leading] === '0') leading++;
    const blanks = Math.min(leading, text.length - count);
    return ' '.repeat(blanks) + text.slice(blanks);
  }

  /**
   * Average glyph advance in em, per family, used to wrap a text block (item.block). The browser measures the real text only in the DOM
   * (js/components/text/layout.js), and the wrapping has to run in node too, so the block is wrapped with one advance per character:
   * mono is exact for the CSS mono face (0.6), sans (0.55, 0.59 bold) and serif (0.5) are averages of the faces the viewer uses. The
   * printer wraps with its own font metrics, so the breaks of the drawing may differ a little from the printed ones.
   */
  const ADVANCE = Object.freeze({ mono: 0.6, sans: 0.55, serif: 0.5 });
  const BOLD_EXTRA = 0.04;

  /** Advance of an average glyph of a neutral font, in em (before the horizontal stretch font.scaleX). */
  function advanceOf(font) {
    const f = font || {};
    const base = ADVANCE[f.family] || ADVANCE.sans;
    return f.family !== 'mono' && f.weight >= 700 ? base + BOLD_EXTRA : base;
  }

  /** Characters of a string, by code point (a surrogate pair is one). */
  const glyphs = text => Array.from(text);

  /** Pitch of the lines of a block in 0.1 mm: the character height plus the extra line space (the latter may be negative; never below 1). */
  const blockPitch = (font, block) => Math.max(1, ((font && font.size) || 0) + ((block && block.lineSpace) || 0));

  /**
   * Word wrap of a text block, pure geometry: { lines: [{ text, justify, width }], pitch, perLine }. `data` is the text (a line break is
   * "\n"), `block` = item.block { width, lines?, align, lineSpace } and `font` the neutral font; widths are 0.1 mm. Every character takes
   * the same advance (advanceOf * size * scaleX), so a line holds floor(width / advance) characters. Greedy: a word that does not fit
   * starts the next line, a word longer than a line is cut at the edge of the block, the spaces at a break are dropped and an
   * explicit break starts a new line (an empty paragraph is an empty line). `lines` limits how many are kept (the rest is clipped).
   * justify = the line is stretched to the full width (align 'justify' and neither the last line of a paragraph nor a single word);
   * width = the width of the text of the line, 0.1 mm. No width (or one narrower than a character) wraps nothing: no lines.
   */
  function wrapBlock(data, block, font) {
    const f = font || {};
    const b = block || {};
    const scaleX = f.scaleX > 0 ? f.scaleX : 1;
    const advance = (f.size > 0 ? f.size : 0) * advanceOf(f) * scaleX;
    const perLine = advance > 0 && b.width > 0 ? Math.floor(b.width / advance + 1e-6) : 0;
    const pitch = blockPitch(f, b);
    if (perLine < 1) return { lines: [], pitch, perLine: 0 };
    const limit = Number.isInteger(b.lines) && b.lines > 0 ? b.lines : Infinity;
    const lines = [];
    const push = (text, last) => {
      const length = glyphs(text).length;
      const spaces = (text.match(/ /g) || []).length;
      lines.push({ text, justify: b.align === 'justify' && !last && spaces > 0 && length < perLine, width: length * advance });
    };
    for (const paragraph of String(data == null ? '' : data).replace(/\r\n|\r/g, '\n').split('\n')) {
      if (lines.length >= limit) break;
      let line = '';
      let used = 0;
      const words = paragraph.split(' ').filter(Boolean);
      if (!words.length) { push('', true); continue; }
      const flush = last => { push(line, last); line = ''; used = 0; };
      for (const word of words) {
        let chars = glyphs(word);
        // A word longer than a line is cut at the edge of the block
        while (chars.length > perLine) {
          if (used) flush(false);
          line = chars.slice(0, perLine).join('');
          used = perLine;
          flush(false);
          chars = chars.slice(perLine);
        }
        if (used && used + 1 + chars.length > perLine) flush(false);
        line += (used ? ' ' : '') + chars.join('');
        used += (used ? 1 : 0) + chars.length;
      }
      flush(true);
    }
    return { lines: lines.slice(0, limit), pitch, perLine };
  }

  const BLOCK_ANCHORS = Object.freeze({ center: 'middle', right: 'end' });

  /**
   * SVG of the lines of a block as <tspan>s of one <text>, in the text's own frame (before the horizontal stretch, hence the width
   * divided by scaleX): left lines start at x = 0, center ones are centred on the block and right ones end at its edge; a justified
   * line spreads its words with word-spacing (the extra width over the gaps). Rotation is the one of the text element.
   */
  function blockMarkup(item, ctx, text) {
    const { n, esc } = ctx;
    const f = item.font;
    const b = item.block;
    const wrap = wrapBlock(text, b, f);
    const scaleX = f.scaleX > 0 ? f.scaleX : 1;
    const frame = b.width / scaleX;
    const x = b.align === 'center' ? frame / 2 : b.align === 'right' ? frame : 0;
    const anchor = BLOCK_ANCHORS[b.align];
    const advance = f.size * advanceOf(f);
    return wrap.lines.map((line, i) => {
      const gaps = (line.text.match(/ /g) || []).length;
      const spread = line.justify && gaps ? ` word-spacing="${n((frame - glyphs(line.text).length * advance) / gaps)}"` : '';
      return `<tspan x="${n(x)}" dy="${i ? n(wrap.pitch) : 0}"${anchor ? ` text-anchor="${anchor}"` : ''}${spread}>${esc(line.text)}</tspan>`;
    }).join('');
  }

  /** ctx comes from drawing.js: { n } rounds to 2 decimals, { esc } escapes markup, { value } substitutes variables, { textScale }. */
  function render(item, ctx) {
    const { n, esc } = ctx;
    const f = item.font;
    const attribute = item.attribute && item.attribute.kind !== 'black' ? item.attribute : null;
    // The attribute shapes are sized from the measured text (layout.js) and go behind it, in the text's rotated frame
    const behind = attribute ? `<g class="text-attr" data-kind="${esc(attribute.kind)}" transform="translate(${item.x} ${item.y}) rotate(${item.rotation})"></g>` : '';
    const classes = fontClasses(f) + (attribute && attribute.kind === 'reverse' ? ' attr-reverse' : '');
    // A block (item.block) places each of its lines itself (blockMarkup); the TPCL alignment and the character spacing do not apply
    const block = Boolean(item.block);
    const place = alignAttributes(block ? null : item.align, f.scaleX);
    const letter = block ? null : spacingAttributes(item.spacing, item.align, f.scaleX);
    const placed = (place.anchor === 'start' ? '' : ` text-anchor="${place.anchor}"`) + (place.textLength ? ` textLength="${n(place.textLength)}" lengthAdjust="spacing"` : '') +
      (letter == null ? '' : ` letter-spacing="${n(letter)}"`);
    // One string element per overprint (the first is the text itself and stays first: layout.js measures it); `shift` moves a copy in the rotated frame
    // ZPL ^FR (item.reverse): white text blended with `difference`, like the inverted area (js/components/area/render.js): over black it reads white, over white black
    const inverted = item.reverse === true ? ' style="fill:#fff;mix-blend-mode:difference"' : '';
    const string = (cls, shift) => `<text class="${cls}"${placed}${inverted} transform="translate(${item.x} ${item.y}) rotate(${item.rotation})${shift ? ` translate(${n(shift.dx)} ${n(shift.dy)})` : ''} scale(${n(f.scaleX)} 1)" ` +
      `font-size="${n(f.size * ctx.textScale)}" xml:space="preserve">${block ? blockMarkup(item, ctx, ctx.value(item.data)) : esc(suppressZeros(ctx.value(item.data), item.zeroSuppress))}</text>`;
    const copies = boldShifts(item.bold).map(shift => string(`${classes} text-bold`, shift)).join('');
    return {
      // .hit is sized after measuring the real text (PB.layout, in drawing.js)
      markup: `${behind}<rect class="hit"/>${string(classes)}${copies}`,
      anchor: [item.x, item.y],
    };
  }

  PB.slices.text.render = render;
  PB.slices.text.advanceOf = advanceOf;
  PB.slices.text.blockPitch = blockPitch;
  PB.slices.text.wrapBlock = wrapBlock;
  PB.slices.text.attributeShapes = attributeShapes;
  PB.slices.text.alignAttributes = alignAttributes;
  PB.slices.text.spacingAttributes = spacingAttributes;
  PB.slices.text.boldShifts = boldShifts;
  PB.slices.text.suppressZeros = suppressZeros;
  PB.slices.text.attributeMarkup = attributeMarkup;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
