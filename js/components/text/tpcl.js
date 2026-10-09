/**
 * Text slice, TPCL language: everything the PC (bitmap font) and PV (outline font) commands need, plus the RV data
 * command's palette template.
 *   PCnn;x,y,<h magnification>,<v magnification>,<font>,[±adj,]<rotation>,<attribute>[=text]
 *   PVnn;x,y,<width>,<height>,<font>,[±adj,]<rotation>,<attribute>[=text]
 * A PC text may hold the automatic line feed P5aaaabbbcc (a text block, neutral item.block); the properties panel switches a text between the two
 * commands (radio "Tipo de fuente") and between a line and a block (Tipo select), both by rewriting the command (reemit).
 * The hooks are built by a factory because they need the shared helpers of js/languages/tpcl.js, which loads after
 * this file: factory(helpers) -> { handlers, build, coordinates, editable } (see js/components/registry.js).
 * The RC/RV data handler is shared with the barcode and QR kinds and stays in js/languages/tpcl.js.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.text = PB.slices.text || {};

  const { units, diagnostics: diag } = PB;

  /**
   * PC magnification (d, e) as the manuals define it (B-SV4 2004, B-452-R 2012, B-452-TS12 ES 2001): one digit 1..9 (whole), or two digits
   * 05..09 (0.5..0.9, steps of 0.1) and from 1 up in steps of 0.5 (10, 15, 20 ... 95: second digit 0 or 5). Any other token (01..04, 11..14,
   * 16..19, 21 ...) is not valid and the printer prints nothing for the field. Values are handled in tenths (5..95).
   */
  const MAGNIFICATIONS = Object.freeze([5, 6, 7, 8, 9, ...Array.from({ length: 18 }, (_, i) => 10 + i * 5)]);
  const MAGNIFICATION_TOKEN = /^(?:[1-9]|0[5-9]|[1-9][05])$/;
  const isValidMagnification = token => typeof token === 'string' && MAGNIFICATION_TOKEN.test(token);

  /** Tenths of a token as written, valid or not: "08" -> 8 ; "14" -> 14 ; "1" -> 10. */
  const tenthsOf = s => (s.length >= 2 ? Number(s) : Number(s) * 10);

  /** Nearest valid magnification (tenths) to a value in tenths; on a tie the one closer to 1.0. A non-number is 1.0. */
  function snapMagnification(tenths) {
    if (!Number.isFinite(tenths)) return 10;
    let best = MAGNIFICATIONS[0];
    for (const candidate of MAGNIFICATIONS) {
      const [d, bd] = [Math.abs(candidate - tenths), Math.abs(best - tenths)];
      if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && Math.abs(candidate - 10) < Math.abs(best - 10))) best = candidate;
    }
    return best;
  }

  /** The only way a magnification is written: the token of the valid magnification nearest to `tenths` (whole numbers in one digit, the rest in two). */
  function magnificationToken(tenths) {
    const n = snapMagnification(tenths);
    return n % 10 === 0 ? String(n / 10) : String(n).padStart(2, '0');
  }

  /** Magnification drawn for a token as written: the nearest valid one ("08" -> 0.8 ; "14" -> 1.5 ; "1" -> 1). */
  const magnification = s => snapMagnification(tenthsOf(s)) / 10;

  const VALID_MAGNIFICATIONS_TEXT = 'de 1 a 9 (una cifra), de 0,5 a 0,9 (05..09) y de 1 a 9,5 de 0,5 en 0,5 (10, 15, 20 ... 95)';

  /**
   * TEC bitmap fonts of the PC command: size in points, family, weight and style they are simulated with.
   * The family (serif/sans/mono) is the "font-…" class of css/label.css.
   */
  const BITMAP_FONTS = Object.freeze({
    A: [8, 'serif', 400], B: [10, 'serif', 400], C: [10, 'serif', 700], D: [12, 'serif', 700], E: [14, 'serif', 700],
    F: [12, 'serif', 400, 'italic'], G: [6, 'sans', 400], H: [10, 'sans', 400], I: [12, 'sans', 400], J: [12, 'sans', 700],
    K: [14, 'sans', 700], L: [12, 'sans', 400, 'italic'], M: [18, 'sans', 700], N: [9.5, 'mono', 400], O: [7, 'mono', 400],
    P: [10, 'mono', 700], Q: [10, 'mono', 400], R: [12, 'mono', 700], S: [12, 'mono', 400], T: [12, 'mono', 400],
  });
  const DEFAULT_BITMAP_FONT = 'J';

  /** The attribute letter of PC/PV (j) -> neutral kind of item.attribute. */
  const ATTRIBUTE_KINDS = Object.freeze({ B: 'black', W: 'reverse', F: 'box', C: 'strike' });
  const KIND_LETTERS = Object.freeze(Object.fromEntries(Object.entries(ATTRIBUTE_KINDS).map(([letter, kind]) => [kind, letter])));

  /** Manual default of the offsets when omitted: PC = larger magnification x 6 dots; PV = larger character size (mm) x 8 dots. */
  const PC_DEFAULT_DOTS = 6;
  const PV_DEFAULT_DOTS_PER_MM = 8;

  const isKind = k => typeof k === 'string' && Object.hasOwn(KIND_LETTERS, k);

  const clampInt =(n, min, max) => Math.min(max, Math.max(min, Math.round(n)));

  /** Offsets written after the letter, in dots: W/F "aabb" -> { h, v }, C "aa" -> { h }; null when omitted or malformed. */
  function parseAttributeDigits(letter, digits) {
    if (letter === 'C') return digits.length === 2 ? { h: +digits } : null;
    if (letter === 'B' || digits.length !== 4) return null;
    return { h: +digits.slice(0, 2), v: +digits.slice(2) };
  }

  /** Attribute token of PC/PV from its kind and offsets (dots): no offsets = the bare letter; strike writes only h. */
  function attributeToken(kind, h, v) {
    const letter = KIND_LETTERS[kind];
    const two = n => String(clampInt(n, 1, 99)).padStart(2, '0');
    if (letter === 'B' || h == null) return letter;
    return letter === 'C' ? letter + two(h) : letter + two(h) + two(v ?? h);
  }

  /** Outline font (PV command): always simulated with this family and weight. */
  const OUTLINE_FONT = Object.freeze({ family: 'sans', weight: 700 });

  // Options common to PC and PV after the font type: [spacing adjustment,]rotation,attribute[,J][,M][,n][,Z][,Pq][=text].
  // Group 7 holds the signed spacing, 10 the optional parameters between the attribute and the data (only the bold and the
  // alignment are interpreted), 11 the data.
  const TEXT_TAIL = String.raw`([A-Za-z0-9]),(?:([+-]\d+),)?(\d{2}),([BWFC])(\d{0,4})([^=]*)(?:=([\s\S]*))?$`;

  /**
   * Character spacing "ghh" (PC, 00..99 dots) / "ghhh" (PV, 000..512 dots): a sign and a number of printer dots added to the
   * character-to-character space. Digits written as is, tokens are the signed dots; the item keeps the dots as written (native)
   * and the same distance in 0.1 mm (value, signed). 0 is the same as omitting it, so it is not stored.
   */
  const SPACING_MAX = Object.freeze({ PC: 99, PV: 512 });
  const SPACING_WIDTH = Object.freeze({ PC: 2, PV: 3 });

  /** { spacing: { value, native } } of a signed token ("+05", "-120"), nothing when omitted or 0. */
  function parseSpacing(token, dotSize) {
    const dots = token ? Number(token) : 0;
    return dots ? { spacing: { value: dots * dotSize, native: dots } } : {};
  }

  /** Spacing token ("+05", "-120", digits padded to `width`) from signed dots clamped to the command's range; null for 0. */
  function spacingToken(dots, command, width = SPACING_WIDTH[command]) {
    const n = clampInt(dots, -SPACING_MAX[command], SPACING_MAX[command]);
    if (n === 0) return null;
    return (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(width, '0');
  }

  /**
   * Bold "Jkkll" (PC only, after the attribute): the glyphs are overprinted shifted by kk dots horizontally and ll dots
   * vertically (00..16 each). The item keeps h, v in 0.1 mm and the dots as written (native), also for J0000.
   */
  const BOLD_MAX = 16;
  const BOLD_PARAM = /^,J(\d{2})(\d{2})(?=,|;|$)/;

  /** { bold: { h, v, native } } of the J parameter in the optional parameters, nothing when there is none or it is malformed. */
  function parseBold(params, dotSize) {
    const m = BOLD_PARAM.exec(params || '');
    if (!m) return {};
    const drawn = n => Math.min(+n, BOLD_MAX) * dotSize;
    return { bold: { h: drawn(m[1]), v: drawn(m[2]), native: { h: +m[1], v: +m[2] } } };
  }

  /** Bold token (",J0102") from the shifts in dots, each clamped to 0..16. */
  const boldToken = (h, v) => `,J${String(clampInt(h, 0, BOLD_MAX)).padStart(2, '0')}${String(clampInt(v, 0, BOLD_MAX)).padStart(2, '0')}`;

  /** Shifts (dots) of a bold token as found in the command ("" = none = 0, 0). */
  function readBoldToken(raw) {
    const m = /^,J(\d{2})(\d{2})$/.exec(raw);
    return m ? { h: +m[1], v: +m[2] } : { h: 0, v: 0 };
  }

  /** Alignment kinds of the Pq / Po option: 1 left (default), 2 center, 3 right, 4aaaa equal space over an area aaaa wide (0.1 mm). */
  const ALIGN_CODES = Object.freeze({ left: '1', center: '2', right: '3', equal: '4' });
  const ALIGN_KINDS = Object.freeze(Object.fromEntries(Object.entries(ALIGN_CODES).map(([kind, code]) => [code, kind])));
  const ALIGN_MIN_WIDTH = 50;
  const ALIGN_MAX_WIDTH = 1040;
  /** Area width written when an item switches to equal space without one (0.1 mm). */
  const ALIGN_DEFAULT_WIDTH = 500;

  /** The "P" parameter as its own comma-separated token among the skipped optional parameters; P4 needs its 4 digits. */
  const ALIGN_PARAM = /(?:^|,)P(?:([123])|4(\d{4}))(?=,|;|$)/;

  /** { kind, width? } of the alignment in the optional parameters, nothing for P1, an absent or a malformed option (left). */
  function parseAlign(params) {
    const m = ALIGN_PARAM.exec(params || '');
    if (!m || m[1] === '1') return {};
    return { align: m[1] ? { kind: ALIGN_KINDS[m[1]] } : { kind: 'equal', width: +m[2] } };
  }

  const isAlignKind = k => typeof k === 'string' && Object.hasOwn(ALIGN_CODES, k);

  /** Alignment token (",P2", ",P40300") from a kind and the area width; the width is clamped, a missing one defaults. */
  function alignToken(kind, width) {
    if (kind !== 'equal') return `,P${ALIGN_CODES[kind]}`;
    const w = clampInt(Number.isFinite(width) ? width : ALIGN_DEFAULT_WIDTH, ALIGN_MIN_WIDTH, ALIGN_MAX_WIDTH);
    return `,P4${String(w).padStart(4, '0')}`;
  }

  /** Kind and width of an alignment token as found in the command ("" = none = left). */
  function readAlignToken(raw) {
    const m = /^,P(?:([123])|4(\d{4}))$/.exec(raw);
    if (!m) return { kind: 'left', width: null };
    return m[1] ? { kind: ALIGN_KINDS[m[1]], width: null } : { kind: 'equal', width: +m[2] };
  }

  /**
   * Automatic line feed "P5aaaabbbcc" (PC only; PV has no such alignment): a text block. aaaa = width of the string area (0050..1040, 0.1 mm),
   * bbb = line feed spacing (010..500), cc = number of lines (01..99). It takes the place of the other alignment, so a block never has one.
   * The manual's figure draws "line feed spacing" as the gap between two lines, so it is the model's block.lineSpace (extra distance added to the
   * character height). UNVERIFIED unit: the 2001 Spanish edition (B-452-TS12) says 0.1 mm, the 2004 / 2012 English editions (B-SV4, B-452-R)
   * say "1 mm units" (010..500 mm would be an absurd line feed, so 0.1 mm is used). The manuals do not say where a line breaks: the viewer wraps at
   * spaces and cuts a word longer than the area at the edge (see wrapBlock). With the character / string rotations 01, 12, 23, 30 (which this
   * viewer does not support) the printer ignores the block; the app's rotations 00, 11, 22, 33 keep it.
   */
  const BLOCK_RANGES = Object.freeze({ width: [ALIGN_MIN_WIDTH, ALIGN_MAX_WIDTH], space: [10, 500], lines: [1, 99] });
  const BLOCK_PARAM = /(?:^|,)P5(\d{4})(\d{3})(\d{2})(?=,|;|$)/;
  /** Width of a block made from a line: this many characters of the font, and the line feed spacing it starts with (0.1 mm). */
  const DEFAULT_BLOCK_CHARS = 20;
  const DEFAULT_BLOCK_SPACE = BLOCK_RANGES.space[0];

  /** Block token (",P50400010003") from width, spacing and lines, each clamped to its range of the manual. */
  function blockToken(width, space, lines) {
    const part = (key, n, digits) => String(clampInt(Number.isFinite(n) ? n : BLOCK_RANGES[key][0], ...BLOCK_RANGES[key])).padStart(digits, '0');
    return `,P5${part('width', width, 4)}${part('space', space, 3)}${part('lines', lines, 2)}`;
  }

  /** { width, space, lines } of a block token as found in the command (numbers as written), null when it is not one. */
  function readBlockToken(raw) {
    const m = /^,P5(\d{4})(\d{3})(\d{2})$/.exec(raw || '');
    return m ? { width: +m[1], space: +m[2], lines: +m[3] } : null;
  }

  /** True when any of the three values of a block is outside the manual's range (the printer may reject it). */
  const blockOutOfRange = b => Object.entries(BLOCK_RANGES).some(([key, [min, max]]) => !(b[key] >= min && b[key] <= max));

  /**
   * Font select of the properties panel: the letter is written as is, and a letter outside `letters` that the item
   * already has is listed as an extra last option so the select shows the real value (it is never offered otherwise).
   */
  function fontField(group, letters) {
    const list = letters.map(([value, label]) => ({ value, label }));
    return {
      key: 'font', label: 'Fuente', type: 'select', group, options: list,
      optionsFor: value => (list.some(o => o.value === value) ? list : [...list, { value, label: value }]),
      read: raw => (list.some(o => o.value === raw.toUpperCase()) ? raw.toUpperCase() : raw),
      write: v => (list.some(o => o.value === v) ? v : null),
    };
  }

  /**
   * Magnification field of a PC text (tenths): the token is written whole (`exact`) and only ever as a valid one (the nearest valid
   * magnification to the value). The value read is the token's, in tenths ("1" = 10, "09" = 9, "14" = 14).
   */
  function magnificationField(key, label, group) {
    return {
      key, label, type: 'number', min: MAGNIFICATIONS[0], max: MAGNIFICATIONS[MAGNIFICATIONS.length - 1], step: 1, group, exact: true,
      read: raw => (/^\d+$/.test(raw) ? tenthsOf(raw) : undefined),
      write: v => (typeof v === 'number' && Number.isFinite(v) ? magnificationToken(v) : null),
    };
  }

  const FAMILY_NAMES =Object.freeze({ serif: 'Serif', sans: 'Sans', mono: 'Mono' });

  /**
   * [letter, label] of each PC font for the panel, derived from BITMAP_FONTS: family, size in points and weight/style.
   * BITMAP_FONTS is the viewer's simulation of the fonts and has NOT been verified against a printer, so the labels
   * only repeat what the table says (serif/sans/mono, size, bold, italic) and invent no font names.
   */
  const BITMAP_FONT_OPTIONS = Object.entries(BITMAP_FONTS).map(([letter, [points, family, weight, style = 'normal']]) => [
    letter,
    `${letter} · ${FAMILY_NAMES[family]} ${String(points).replace('.', ',')} pt${weight >= 700 ? ' negrita' : ''}${style === 'italic' ? ' cursiva' : ''}`,
  ]);

  /** The two outline fonts of the PV command in the manual (both are drawn the same by OUTLINE_FONT). */
  const OUTLINE_FONT_OPTIONS = Object.freeze([
    ['A', 'A · Helvetica negrita (TEC FONT1)'],
    ['B', 'B · Helvetica negrita proporcional (TEC FONT1)'],
  ]);

  /** Format options of a freshly inserted PV command; {rot2} is the 2-digit rotation code. */
  const VARIABLE = Object.freeze({ format: 'PV', data: 'RV', name: 'TEXTO', tail: '0060,0080,B,{rot2},B' });

  /** How far (in tenths of a magnification) a model font may be from an exact PC font + valid magnifications to still be a PC. */
  const MAGNIFICATION_TOLERANCE = 0.05;

  /** Fallback outline size (0.1 mm) for a text whose font has no usable size. */
  const DEFAULT_OUTLINE_SIZE = 80;

  /**
   * PC font that draws a model font exactly: the entry of BITMAP_FONTS with the same family, weight and style whose
   * valid magnifications (MAGNIFICATIONS: 0.5..0.9, then 1..9.5 in steps of 0.5) reproduce its size and scaleX within MAGNIFICATION_TOLERANCE.
   * Several fit: the one with the vertical magnification closest to 1. { letter, h, v } with h, v in tenths. Null when none (the text becomes
   * an outline PV).
   */
  function bitmapChoice(font) {
    let best = null;
    for (const [letter, [points, family, weight, style = 'normal']] of Object.entries(BITMAP_FONTS)) {
      if (family !== font.family || weight !== font.weight || style !== (font.style || 'normal')) continue;
      const v = (font.size / (points * units.UNITS_PER_POINT)) * 10;
      const h = v * font.scaleX;
      const [vi, hi] = [snapMagnification(v), snapMagnification(h)];
      if (Math.abs(v - vi) > MAGNIFICATION_TOLERANCE || Math.abs(h - hi) > MAGNIFICATION_TOLERANCE) continue;
      const distance = Math.abs(vi - 10);
      if (!best || distance < best.distance) best = { letter, h: hi, v: vi, distance };
    }
    return best;
  }

  /**
   * PC font that stands for an outline (PV) font when the radio "Tipo de fuente" switches to the bitmap font: the PV font is always drawn sans bold
   * (OUTLINE_FONT), so only the sans bold PC fonts compete; each is tried with the valid magnifications closest to the size and the width of
   * the item, and the one with the smallest relative error wins (the one nearest to 1.0 on a tie). { letter, h, v } with h, v the magnifications in tenths.
   */
  function nearestBitmap(font) {
    const size = Number.isFinite(font.size) && font.size > 0 ? font.size : DEFAULT_OUTLINE_SIZE;
    const scaleX = Number.isFinite(font.scaleX) && font.scaleX > 0 ? font.scaleX : 1;
    let best = null;
    for (const [letter, [points, family, weight, style = 'normal']] of Object.entries(BITMAP_FONTS)) {
      if (family !== OUTLINE_FONT.family || weight !== OUTLINE_FONT.weight || style !== 'normal') continue;
      const v = (size / (points * units.UNITS_PER_POINT)) * 10;
      const h = v * scaleX;
      const [vi, hi] = [snapMagnification(v), snapMagnification(h)];
      const error = Math.abs(v - vi) / v + Math.abs(h - hi) / h;
      const distance = Math.abs(vi - 10);
      if (!best || error < best.error - 1e-9 || (Math.abs(error - best.error) <= 1e-9 && distance < best.distance)) best = { letter, h: hi, v: vi, error, distance };
    }
    return best;
  }

  const ATTRIBUTE_OPTIONS = Object.freeze([
    { value: 'black', label: 'Negro' }, { value: 'reverse', label: 'Invertido' }, { value: 'box', label: 'Con marco' }, { value: 'strike', label: 'Tachado' },
  ]);

  /** Kind and offsets (dots, null when omitted) of an attribute token ("W0507"). */
  function readToken(raw) {
    const given = parseAttributeDigits(raw[0], raw.slice(1));
    return { kind: ATTRIBUTE_KINDS[raw[0]], h: given ? given.h : null, v: given && given.v != null ? given.v : null };
  }

  const isOffset = v => typeof v === 'number' && Number.isFinite(v);

  /**
   * The three panel fields over the one attribute token (letter + offsets, written whole: `exact`): the kind select and the
   * offsets in dots, shown only for the kinds that use them (reverse/box: h and v; strike: h). Changing the kind keeps the
   * offsets. The token is composed by the first of the fields present in the change set; the others write nothing.
   * A bare letter shows the item's default offset (the manual default, computed by the parser).
   */
  function attributeFields(group) {
    const kindOf = item => (item.attribute && item.attribute.kind) || 'black';
    const offset = (key, label, uses) => {
      const part = key === 'attrH' ? 'h' : 'v';
      return {
        key, label, type: 'number', min: 1, max: 99, step: 1, group, exact: true,
        read: (raw, item) => (uses.includes(readToken(raw).kind) ? readToken(raw)[part] ?? (item && item.attribute ? item.attribute.defaultDots : undefined) : undefined),
        model: item => (uses.includes(kindOf(item)) ? (item.attribute.native ? item.attribute.native[part] : item.attribute.defaultDots) : undefined),
        write: (v, width, raw, changes) => {
          const t = readToken(raw);
          if (!isOffset(v) || !uses.includes(t.kind) || isKind(changes.attribute)) return null;
          if (part === 'v') return isOffset(changes.attrH) ? null : attributeToken(t.kind, t.h ?? v, v);
          return attributeToken(t.kind, v, isOffset(changes.attrV) ? changes.attrV : t.v);
        },
      };
    };
    return [
      {
        key: 'attribute', label: 'Atributo', type: 'select', group, exact: true, options: ATTRIBUTE_OPTIONS,
        read: raw => readToken(raw).kind,
        model: kindOf,
        write: (v, width, raw, changes) => {
          if (!isKind(v)) return null;
          const t = readToken(raw);
          return attributeToken(v, isOffset(changes.attrH) ? changes.attrH : t.h, isOffset(changes.attrV) ? changes.attrV : t.v);
        },
      },
      offset('attrH', 'Margen horizontal', ['reverse', 'box', 'strike']),
      offset('attrV', 'Margen vertical', ['reverse', 'box']),
    ];
  }

  /**
   * Spacing field over the optional signed token right after the font letter (written whole with its comma: `exact`; empty
   * when omitted, so a change inserts it). The range and the digits follow the command: PC -99..99 with 2 digits, PV -512..512
   * with 3; an existing token keeps its width. 0 on an omitted token writes nothing; 0 on an existing one writes +00.
   */
  function spacingField(group, command) {
    const max = SPACING_MAX[command];
    const dotsOf = raw => (raw ? Number(raw.slice(0, -1)) || 0 : 0);
    return {
      key: 'spacing', label: 'Espaciado entre caracteres', type: 'number', min: -max, max, step: 1, group, exact: true,
      read: dotsOf,
      model: item => (item.spacing && Number.isFinite(item.spacing.native) ? item.spacing.native : 0),
      write: (v, width, raw) => {
        if (!isOffset(v)) return null;
        const n = clampInt(v, -max, max);
        if (n === 0 && raw === '') return null;
        const digits = raw ? raw.length - 2 : SPACING_WIDTH[command]; // sign and comma are not digits
        return (spacingToken(n, command, digits) ?? `+${'0'.repeat(digits)}`) + ',';
      },
    };
  }

  /**
   * The two bold fields (PC only) over the one "Jkkll" token (written whole: `exact`, with its leading comma, empty when
   * omitted). Both are composed by the first of the two present in the change set. Both shifts at 0 keep an existing token
   * (as J0000) and write nothing for an omitted one.
   */
  function boldFields(group) {
    const field = (key, label, part) => ({
      key, label, type: 'number', min: 0, max: BOLD_MAX, step: 1, group, exact: true,
      read: raw => readBoldToken(raw)[part],
      model: item => (item.bold && item.bold.native ? item.bold.native[part] : 0),
      write: (v, width, raw, changes) => {
        if (!isOffset(v)) return null;
        const other = part === 'h' ? 'boldV' : 'boldH';
        if (part === 'v' && isOffset(changes.boldH)) return null; // composed by boldH
        const had = readBoldToken(raw);
        const h = part === 'h' ? v : had.h;
        const w = part === 'v' ? v : (isOffset(changes[other]) ? changes[other] : had.v);
        if (clampInt(h, 0, BOLD_MAX) === 0 && clampInt(w, 0, BOLD_MAX) === 0 && raw === '') return null;
        return boldToken(h, w);
      },
    });
    return [field('boldH', 'Negrita horizontal', 'h'), field('boldV', 'Negrita vertical', 'v')];
  }

  const LINE_OPTION = Object.freeze({ value: 'line', label: 'Línea de texto' });
  const KIND_OPTIONS = Object.freeze([LINE_OPTION, Object.freeze({ value: 'block', label: 'Bloque de texto' })]);

  /**
   * The Tipo select of an outline (PV) text: the block (P5) only exists for the bitmap font, so the only value is the line. It is listed (the
   * panel shows it disabled, with the note) so that the form is the same in the three languages, and it never writes anything.
   */
  const VECTOR_KIND_FIELD = Object.freeze({
    key: 'kind', label: 'Tipo', type: 'select', group: 1, options: Object.freeze([LINE_OPTION]),
    note: 'Bloque de texto solo con fuente de mapa de bits (PC)',
    read: () => 'line', model: () => 'line', write: () => null,
  });

  /** The two kinds of font of a TPCL text: the radio "Tipo de fuente" switches the command between PC and PV (see reemit in tpcl()). */
  const FONT_TYPE_OPTIONS = Object.freeze([{ value: 'bitmap', label: 'Mapa de bits (PC)' }, { value: 'vector', label: 'Vectorial (PV)' }]);

  /** Why the block is not offered: the rotations 01 / 12 / 23 / 30 make the printer ignore it. */
  const ROTATED_BLOCK_NOTE = 'Con el giro 01 / 12 / 23 / 30 la impresora ignora el salto de línea automático: el bloque no está disponible';

  const ALIGN_OPTIONS = Object.freeze([
    { value: 'left', label: 'Izquierda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Derecha' }, { value: 'equal', label: 'Espaciado igual' },
  ]);

  /**
   * The two panel fields over the one alignment token (",Pq", written whole: `exact`; empty in the command when omitted, so
   * a change inserts it after the other optional parameters). The kind select composes the token, including the width of an
   * equal space (alignWidth of the change set, else the one it had, else a default); the width field writes only when the
   * kind is not being changed and the item already has an equal space. Left keeps an explicit P1 and never writes an omitted one.
   */
  function alignFields(group) {
    return [
      {
        key: 'align', label: 'Alineación', type: 'select', group, exact: true, options: ALIGN_OPTIONS,
        // A block (P5) has no alignment: the select is left out and never overwrites its token
        read: raw => (readBlockToken(raw) ? undefined : readAlignToken(raw).kind),
        model: item => (item.block ? undefined : (item.align && item.align.kind) || 'left'),
        write: (v, width, raw, changes) => {
          if (!isAlignKind(v) || readBlockToken(raw)) return null;
          if (v === 'left') return raw === '' ? null : ',P1';
          const had = readAlignToken(raw);
          return alignToken(v, isOffset(changes.alignWidth) ? changes.alignWidth : had.width);
        },
      },
      {
        key: 'alignWidth', label: 'Ancho del área', type: 'number', min: ALIGN_MIN_WIDTH, max: ALIGN_MAX_WIDTH, step: 1, group, exact: true,
        read: raw => readAlignToken(raw).width ?? undefined,
        model: item => (item.align && item.align.kind === 'equal' ? item.align.width : undefined),
        write: (v, width, raw, changes) => {
          if (!isOffset(v) || isAlignKind(changes.align) || readAlignToken(raw).kind !== 'equal') return null;
          return alignToken('equal', v);
        },
      },
    ];
  }

  /**
   * The three block fields (PC only) over the one P5 token (",P5aaaabbbcc", written whole: `exact`): width of the area, number of lines and line
   * feed spacing. They exist only for an item with a block. The token is composed by the first of the three present in the change set (width, then
   * spacing, then lines: the order of the token), each value clamped to the manual's range.
   */
  function blockFields(group) {
    const ORDER = ['blockWidth', 'blockLines', 'blockSpace'];
    const field = (key, label, part) => ({
      key, label, type: 'number', min: BLOCK_RANGES[part][0], max: BLOCK_RANGES[part][1], step: 1, group, exact: true,
      read: (raw, item) => (item && item.block && readBlockToken(raw) ? readBlockToken(raw)[part] : undefined),
      model: item => (item.block ? item.native && item.native.block ? item.native.block[part] : undefined : undefined),
      write: (v, width, raw, changes) => {
        const had = readBlockToken(raw);
        if (!isOffset(v) || !had || ORDER.slice(0, ORDER.indexOf(key)).some(k => isOffset(changes[k]))) return null;
        const pick = (k, p) => (isOffset(changes[k]) ? changes[k] : had[p]);
        return blockToken(pick('blockWidth', 'width'), pick('blockSpace', 'space'), pick('blockLines', 'lines'));
      },
    });
    return [
      field('blockWidth', 'Ancho del área (0,1 mm)', 'width'),
      field('blockLines', 'Líneas', 'lines'),
      field('blockSpace', 'Interlineado (0,1 mm)', 'space'),
    ];
  }

  /** Optional spacing token right after the font letter ("+05," with its comma, possibly empty): group of the rotation minus 1. */
  const SPACING_SLOT = String.raw`((?:[+-]\d+,)?)`;
  /** PC only: the bold token (",Jkkll", possibly empty) that follows the attribute before the other optional parameters. */
  const BOLD_SLOT = String.raw`((?:,J\d{4})?)`;
  /**
   * Increment (",noooooooooo") and zero suppression (",Zpp") tokens, in the manual's order: ...(,Jkkll)(,Mm)(,n)(,Z)(,Pq). They are
   * not followed by another token character (so a longer token never matches). MISC skips what lies between the bold and the
   * increment (M, or a J of the outline font), then each slot is possibly empty (an insertion point).
   */
  const COUNTER_TOKEN_RE = String.raw`[+-]\d{10}(?![^,=;|])`;
  const ZERO_TOKEN_RE = String.raw`Z\d{2}(?![^,=;|])`;
  const MISC_SLOT = String.raw`(?:,(?!${COUNTER_TOKEN_RE}|${ZERO_TOKEN_RE}|P)[^,=;|]*)*`;
  const COUNTER_SLOT = String.raw`((?:,${COUNTER_TOKEN_RE})?)`;
  const ZERO_SLOT = String.raw`((?:,${ZERO_TOKEN_RE})?)`;
  /** Optional parameters between the attribute and the data (J, M, n, Z, never P), then the alignment token, possibly empty. */
  const alignSlot = alternatives => String.raw`(?:,(?!P)[^,=;|]*)*((?:,P(?:${alternatives}))?)`;
  /** The increment, the zero suppression and the alignment slots (capture groups, in this order); only the bitmap PC has the P5 block. */
  const TAIL_SLOTS = MISC_SLOT + COUNTER_SLOT + ZERO_SLOT + alignSlot(String.raw`[123]|4\d{4}`);
  const PC_TAIL_SLOTS = MISC_SLOT + COUNTER_SLOT + ZERO_SLOT + alignSlot(String.raw`[123]|4\d{4}|5\d{9}`);

  /** The increment token as its own comma-separated token among the optional parameters (spacing is before the rotation, never here). */
  const COUNTER_PARAM = /(?:^|,)([+-]\d{10})(?=,|;|$)/;
  const ZERO_PARAM = /(?:^|,)Z(\d{2})(?=,|;|$)/;

  function tpcl(helpers) {
    const {
      sourceOf, insertCommand, pad4, clampCoord, numberField, rotationField, nextId, freePlaceholder,
      ROTATIONS, ROTATION_STEPS, ROTATION_CODES, MAX_COORD, wrap, safeData, coordText, allocId,
      COUNTER_MAX, ZERO_MAX, counterToken, emitCounterToken, zeroDigits, readCounterStep, counterFields,
    } = helpers;

    /** { counter?, zeroSuppress? } of the optional parameters between the attribute and the data (see counterFields). */
    function parseCounter(ctx, params) {
      const inc = COUNTER_PARAM.exec(params || '');
      const zero = ZERO_PARAM.exec(params || '');
      return counterFields(ctx, inc && inc[1], zero && zero[1]);
    }

    /** Increment and zero suppression tokens of an item (with their commas), empty without them. */
    const counterText = (item, ctx) => (item.counter && Number.isFinite(item.counter.step) && Math.trunc(item.counter.step) !== 0 ? `,${emitCounterToken(ctx, item.counter.step)}` : '');
    const zeroText = item => (item.zeroSuppress > 0 ? `,Z${zeroDigits(item.zeroSuppress)}` : '');

    /**
     * The two panel fields over the optional increment and zero suppression tokens (written whole with their comma: `exact`,
     * empty when omitted so a change inserts them in the manual's order). 0 on an omitted token writes nothing; 0 on an existing
     * one keeps it as +0000000000 / Z00 (the printer then does not increment / suppress). The zero field takes the next group.
     */
    function counterFieldsOf(group) {
      return [
        {
          key: 'counter', label: 'Incremento', type: 'number', min: -COUNTER_MAX, max: COUNTER_MAX, step: 1, group, exact: true,
          read: raw => readCounterStep(raw.replace(/^,/, '')),
          model: item => (item.counter && Number.isFinite(item.counter.step) ? item.counter.step : 0),
          write: (v, width, raw) => {
            if (!isOffset(v)) return null;
            const n = clampInt(v, -COUNTER_MAX, COUNTER_MAX);
            if (n === 0 && raw === '') return null;
            return `,${counterToken(n)}`;
          },
        },
        {
          key: 'zeroSuppress', label: 'Ceros suprimidos', type: 'number', min: 0, max: ZERO_MAX, step: 1, group: group + 1, exact: true,
          read: raw => (raw === '' ? 0 : Number(raw.slice(2))),
          model: item => item.zeroSuppress || 0,
          write: (v, width, raw) => {
            if (!isOffset(v)) return null;
            const n = clampInt(v, 0, ZERO_MAX);
            if (n === 0 && raw === '') return null;
            return `,Z${zeroDigits(n)}`;
          },
        },
      ];
    }

    /** Text rotation code (00/11/22/33): the nearest quarter turn, with a warning once if the item was not on one. */
    function rotationCode(ctx, rotation) {
      const turns = Number.isFinite(rotation) ? Math.round(rotation / 90) : 0;
      const degrees = (((turns * 90) % 360) + 360) % 360;
      if (degrees !== rotation && !(rotation == null && degrees === 0)) {
        ctx.once('tpcl-rotation', () => diag.warning('Hay textos con una rotación que no es múltiplo de 90°: se ajustan al giro más cercano'));
      }
      return ROTATION_CODES[degrees];
    }

    /** Attribute token of an item: B, or W/F/C with the offsets in dots when the item has them (else the bare letter). */
    function attributeText(attribute, ctx) {
      if (!attribute || !isKind(attribute.kind)) return 'B';
      const dots = n => (Number.isFinite(n) ? ctx.dot(n) : null);
      return attributeToken(attribute.kind, attribute.native ? dots(attribute.h) : null, dots(attribute.v));
    }

    /** Spacing token with its comma ("+05,"), empty without spacing: the dots as written, else the distance in 0.1 mm converted. */
    function spacingText(spacing, command, ctx) {
      if (!spacing) return '';
      const dots = Number.isFinite(spacing.native) ? spacing.native : Number.isFinite(spacing.value) ? ctx.dot(spacing.value) : 0;
      const token = spacingToken(dots, command);
      return token ? `${token},` : '';
    }

    /** Bold token (",J0102") from the dots as written, else the shifts in 0.1 mm converted; empty without bold. */
    function boldText(bold, ctx) {
      if (!bold) return '';
      const dots = key => (bold.native && Number.isFinite(bold.native[key]) ? bold.native[key] : Number.isFinite(bold[key]) ? ctx.dot(bold[key]) : 0);
      return boldToken(dots('h'), dots('v'));
    }

    /**
     * The P5 token (",P5aaaabbbcc") of an item with a block: width and spacing in 0.1 mm, lines = the block's or what the wrapped text needs (at
     * least 1), each clamped to the manual's range with one warning per label. The block has no alignment (P5 replaces it), so a centred, right
     * or justified one is written left with one info; the spacing unit is unverified (see BLOCK_RANGES), said once.
     */
    function blockText(item, ctx) {
      const b = item.block;
      const lines = Number.isInteger(b.lines) && b.lines > 0 ? b.lines : Math.max(1, PB.slices.text.wrapBlock(item.data, b, item.font).lines.length);
      const wanted = { width: Math.round(b.width), space: Math.round(b.lineSpace || 0), lines };
      if (blockOutOfRange(wanted)) ctx.once('tpcl-block-range', () => diag.warning('Hay bloques de texto fuera de los rangos de TPCL (ancho 0050..1040, interlineado 010..500, líneas 01..99): se ajustan al límite'));
      if (b.align && b.align !== 'left') ctx.once('tpcl-block-align', () => diag.info('Hay bloques de texto centrados, a la derecha o justificados: el salto de línea automático de TPCL (P5) no tiene alineación, se escriben a la izquierda'));
      ctx.once('tpcl-block-unit', () => diag.info('Hay bloques de texto (P5): el interlineado se escribe en unidades de 0,1 mm (manual en español); los manuales en inglés dicen 1 mm: compruébelo en su impresora'));
      return blockToken(wanted.width, wanted.space, wanted.lines);
    }

    /**
     * PC (bitmap font) when the model font matches BITMAP_FONTS, else PV (outline font: width = size * scaleX, height =
     * size, font letter B like the palette template), each followed by its RC / RV data command (empty without data).
     */
    function emit(item, ctx) {
      const font = item.font || {};
      const size = Number.isFinite(font.size) && font.size > 0 ? font.size : DEFAULT_OUTLINE_SIZE;
      const scaleX = Number.isFinite(font.scaleX) && font.scaleX > 0 ? font.scaleX : 1;
      const [x, y] = [coordText(ctx, item.x), coordText(ctx, item.y)];
      const rot = rotationCode(ctx, item.rotation);
      // A text block is the PC automatic line feed (P5): the breaks of the data become spaces (the data has no line breaks in TPCL)
      const data = safeData(ctx, item.block ? String(item.data == null ? '' : item.data).replace(/\r\n|\r|\n/g, ' ') : item.data);
      const choice = bitmapChoice({ ...font, size, scaleX });
      // The outline font (PV) has no automatic line feed: its text is one line
      if (item.block && !choice) ctx.once('tpcl-text-block', () => diag.warning('Hay bloques de texto (BLOCK de TSPL, ^FB de ZPL) cuya fuente solo se escribe vectorial (PV): el salto de línea automático (P5) necesita una fuente de mapa de bits (PC), se escriben como una línea de texto sin ajuste de línea'));
      const attribute = attributeText(item.attribute, ctx);
      if (item.reverse) ctx.once('tpcl-text-reverse', () => diag.warning('Hay textos con impresión inversa (^FR de ZPL): TPCL no la tiene en el texto (su atributo de fondo negro es otra cosa), se escriben normales'));
      const block = item.block && choice ? blockText(item, ctx) : '';
      const align = block || (item.align && isAlignKind(item.align.kind) && item.align.kind !== 'left' ? alignToken(item.align.kind, item.align.width) : '');
      if (choice) {
        const id = allocId(ctx, 'PC');
        return [wrap(`PC${id};${x},${y},${magnificationToken(choice.h)},${magnificationToken(choice.v)},${choice.letter},${spacingText(item.spacing, 'PC', ctx)}${rot},${attribute}${boldText(item.bold, ctx)}${counterText(item, ctx)}${zeroText(item)}${align}`), wrap(`RC${id};${data}`)];
      }
      if (item.bold) ctx.once('tpcl-bold-pv', () => diag.info('Hay textos en negrita (J) que se escriben con la fuente vectorial (PV), que no tiene ese parámetro: se escriben sin negrita'));
      // The outline font is always drawn sans bold: any other family, weight or style is lost
      if ((font.family || OUTLINE_FONT.family) !== OUTLINE_FONT.family || (font.weight == null ? OUTLINE_FONT.weight : font.weight) !== OUTLINE_FONT.weight || (font.style || 'normal') !== 'normal') {
        ctx.once('tpcl-fonts', () => diag.info('Las fuentes TPCL no coinciden con las de origen (familia, peso o cursiva): los textos sin fuente de mapa de bits equivalente se escriben con la fuente vectorial (PV)'));
      }
      const id = allocId(ctx, 'PV');
      const dim = n => pad4(Math.max(1, clampCoord(n)));
      return [wrap(`PV${id};${x},${y},${dim(size * scaleX)},${dim(size)},B,${spacingText(item.spacing, 'PV', ctx)}${rot},${attribute}${counterText(item, ctx)}${zeroText(item)}${align}`), wrap(`RV${id};${data}`)];
    }

    /**
     * { block, native } of the automatic line feed P5aaaabbbcc among the optional parameters of a PC command (see BLOCK_RANGES): width and
     * line space in 0.1 mm, lines (cc; 00 = no limit), the dots / digits as written in native.block. Nothing without P5, nor with a rotation
     * code the printer ignores it for (01, 12, 23, 30: one info, the text is drawn as a line). A value out of range reads as written, with a warning.
     */
    function parseBlock(ctx, ref, params, rotationCode) {
      const m = BLOCK_PARAM.exec(params || '');
      if (!m) return {};
      if (!(rotationCode in ROTATIONS)) {
        ctx.report(diag.info(`${ref}: con el giro ${rotationCode} la impresora ignora el salto de línea automático (P5), se dibuja como una línea de texto`));
        return {};
      }
      const [width, space, lines] = [+m[1], +m[2], +m[3]];
      if (blockOutOfRange({ width, space, lines })) ctx.report(diag.warning(`${ref}: P5 fuera de rango (ancho 0050..1040, interlineado 010..500, líneas 01..99): la impresora puede no aceptarlo`));
      return { block: { width, ...(lines > 0 && { lines }), align: 'left', lineSpace: space }, native: { block: { width, space, lines } } };
    }

    /** The block part of a PC item plus native.hMag / native.vMag: the magnification tokens as written (an invalid one is drawn as the nearest valid one, never rewritten). */
    function withMagnifications(block, hMag, vMag) {
      return { ...block, native: { ...block.native, hMag, vMag } };
    }

    function textRotation(ctx, ref, rotationCode) {
      if (!(rotationCode in ROTATIONS)) ctx.report(diag.warning(`${ref}: rotación "${rotationCode}" desconocida, se dibuja sin rotar`));
      return ROTATIONS[rotationCode] ?? 0;
    }

    /**
     * { attribute } for the item (nothing for the black default): the offsets in 0.1 mm (h, v; strike has only h) and, when the
     * command wrote them, the dots as they are in the file (native). Omitted offsets use the manual's default (defaultDots).
     */
    function textAttribute(ctx, letter, digits, defaultMargin) {
      const kind = ATTRIBUTE_KINDS[letter];
      if (kind === 'black') return {};
      const defaultDots = clampInt(defaultMargin, 1, 99);
      const given = parseAttributeDigits(letter, digits);
      const [h, v] = [given ? given.h : defaultDots, given && given.v != null ? given.v : defaultDots];
      return { attribute: { kind, h: h * ctx.dot, ...(kind !== 'strike' && { v: v * ctx.dot }), ...(given && { native: given }), defaultDots } };
    }

    function bitmapFont(ctx, ref, code, hMag, vMag) {
      let spec = BITMAP_FONTS[code];
      if (!spec) {
        ctx.report(diag.warning(`${ref}: fuente "${code}" desconocida, se dibuja como ${DEFAULT_BITMAP_FONT}`));
        spec = BITMAP_FONTS[DEFAULT_BITMAP_FONT];
      }
      const [points, family, weight, style = 'normal'] = spec;
      const invalid = [['horizontal', hMag], ['vertical', vMag]].filter(([, token]) => !isValidMagnification(token));
      if (invalid.length) {
        const written = invalid.map(([name, token]) => `${name} "${token}"`).join(' y ');
        ctx.report(diag.warning(`${ref}: ampliación ${written} no válida: la impresora no imprime el campo (valores válidos: ${VALID_MAGNIFICATIONS_TEXT}); se dibuja con ${String(magnification(hMag)).replace('.', ',')}× horizontal y ${String(magnification(vMag)).replace('.', ',')}× vertical`));
      }
      const v = magnification(vMag);
      return { size: points * units.UNITS_PER_POINT * v, scaleX: magnification(hMag) / v, family, weight, style };
    }

    /**
     * Adds a PV format command plus its RV data command with a unique <#TEXTO{k}#> variable, rotated
     * (360 - options.viewRotation) % 360 to look upright in the view (missing/invalid = 0).
     */
    function build(text, point, options) {
      const { format, data, name } = VARIABLE;
      // Rotated items extend from the anchor in the rotated direction, so near the label edges they can leave the label:
      // only the coordinate clamp applies, the item is not shifted to fit.
      const view = options && ROTATION_STEPS.includes(options.viewRotation) ? options.viewRotation : 0;
      const itemRotation = (360 - view) % 360; // clockwise, so that item + view = 0 (upright)
      const tail = VARIABLE.tail.replace('{rot2}', ROTATION_CODES[itemRotation]);
      const id = nextId(text, format, data);
      const placeholder = freePlaceholder(text, name);
      const withFormat = insertCommand(text, `{${format}${id};${pad4(clampCoord(point.x))},${pad4(clampCoord(point.y))},${tail}|}`);
      return insertCommand(withFormat, `{${data}${id};${placeholder}|}`);
    }

    // ---- Properties: the radio "Tipo de fuente" (PC <-> PV) and the Tipo select (line <-> block), both rewrite the command (reemit)

    /** The block is available for the rotation codes this viewer supports (00, 11, 22, 33); 01 / 12 / 23 / 30 make the printer ignore it. */
    const blockAvailable = raw => raw === undefined || Object.hasOwn(ROTATIONS, raw);

    /** Tipo select of a PC text: line or block, written by reemit (the P5 token replaces / removes the alignment token). */
    const bitmapKindField = {
      key: 'kind', label: 'Tipo', type: 'select', group: 5, reemit: true, options: KIND_OPTIONS,
      optionsFor: (value, item, raw) => (blockAvailable(raw) ? KIND_OPTIONS : [LINE_OPTION]),
      noteFor: (value, item, raw) => (blockAvailable(raw) ? undefined : ROTATED_BLOCK_NOTE),
      read: (raw, item) => (item && item.block ? 'block' : 'line'),
      model: item => (item.block ? 'block' : 'line'),
      write: () => null,
    };

    /**
     * The radio "Tipo de fuente": the command is a PC (bitmap font) or a PV (outline font). Written by reemit. The note says what the other
     * type cannot hold (it is shown before the change, since the change drops it).
     */
    const fontTypeField = {
      key: 'fontType', label: 'Tipo de fuente', type: 'radio', group: 0, reemit: true, options: FONT_TYPE_OPTIONS,
      read: (raw, item) => (item && /^PV/.test(item.ref) ? 'vector' : 'bitmap'),
      model: item => (/^PV/.test(item.ref) ? 'vector' : 'bitmap'),
      noteFor: (value, item) => {
        if (value === 'vector') {
          const long = item && item.spacing && Math.abs(item.spacing.native) > SPACING_MAX.PC ? '; el espaciado se limita a ±99 puntos' : '';
          return `La fuente de mapa de bits (PC) es la única con negrita (J) y bloque de texto (P5)${long}`;
        }
        const lost = [item && item.bold && 'la negrita (J)', item && item.block && 'el bloque de texto (P5: vuelve a una línea)'].filter(Boolean);
        return lost.length ? `Al cambiar a vectorial (PV) se pierde ${lost.join(' y ')}` : undefined;
      },
      write: () => null,
    };

    /** The P5 token of a block made from a line: DEFAULT_BLOCK_CHARS characters wide, the minimum spacing and the lines the text needs. */
    function defaultBlockToken(item) {
      const { advanceOf, wrapBlock } = PB.slices.text;
      const f = item.font;
      const width = clampInt(DEFAULT_BLOCK_CHARS * f.size * advanceOf(f) * f.scaleX, ...BLOCK_RANGES.width);
      const lines = Math.max(1, wrapBlock(item.data, { width, align: 'left', lineSpace: DEFAULT_BLOCK_SPACE }, f).lines.length);
      return blockToken(width, DEFAULT_BLOCK_SPACE, lines);
    }

    /** Number of the converted command: the one it has when the other namespace (PV / PC and its RV / RC data) leaves it free, else the next free one. */
    function convertedId(text, ref, format, data) {
      const digits = /^P[CV](\d+)$/.exec(ref)[1];
      return new RegExp(String.raw`\{(?:${format}|${data})${digits};`).test(text) ? nextId(text, format, data) : digits;
    }

    /**
     * PC -> PV: the outline font B with width = size * scaleX and height = size (0.1 mm); the spacing keeps its dots with 3 digits; the position,
     * rotation, attribute, the other optional parameters, the counter, zero suppression, the alignment (1..4: PV has the same Po) and the inline
     * data stay as written. The bold (J) and the block (P5) have no PV equivalent and are dropped (the text is a line again).
     */
    function bitmapToVector({ stripped, match: m }, item, id) {
      const at = i => m.indices[i];
      const font = item.font;
      const size = Number.isFinite(font.size) && font.size > 0 ? font.size : DEFAULT_OUTLINE_SIZE;
      const scaleX = Number.isFinite(font.scaleX) && font.scaleX > 0 ? font.scaleX : 1;
      const dim = n => pad4(Math.max(1, clampCoord(n)));
      const coords = /^\{PC\d+;(\d+,\d+),/.exec(stripped)[1];
      const spacing = m[4] ? `${spacingToken(Number(m[4].slice(0, -1)), 'PV') ?? '+000'},` : '';
      const between = stripped.slice(at(6)[1], at(8)[0]).replace(/,J\d{4}(?=,|$)/, '');
      const tail = stripped.slice(at(8)[0], at(10)[0]) + (readBlockToken(m[10]) ? '' : m[10]) + stripped.slice(at(10)[1]);
      return `{PV${id};${coords},${dim(size * scaleX)},${dim(size)},B,${spacing}${stripped.slice(at(5)[0], at(6)[1])}${between}${tail}`;
    }

    /** PV -> PC: the nearest bitmap font (nearestBitmap) with its magnifications; the rest stays as written (the spacing is clamped to 2 digits). */
    function vectorToBitmap({ stripped, match: m }, item, id) {
      const at = i => m.indices[i];
      const choice = nearestBitmap(item.font);
      const coords = /^\{PV\d+;(\d+,\d+),/.exec(stripped)[1];
      const spacing = m[4] ? `${spacingToken(Number(m[4].slice(0, -1)), 'PC') ?? '+00'},` : '';
      return `{PC${id};${coords},${magnificationToken(choice.h)},${magnificationToken(choice.v)},${choice.letter},${spacing}${stripped.slice(at(5)[0], at(6)[1])}${stripped.slice(at(6)[1])}`;
    }

    /**
     * Hook of the shape for the fields flagged `reemit` (see updateItem in js/languages/tpcl.js): the command written again, or null to refuse.
     *   fontType: PC <-> PV (the number of the command is kept when free; its RC / RV data command is renamed to match, which is why the answer
     *     carries `edits` over the rest of the text and the new `ref`).
     *   kind (PC only): block = the alignment token becomes a default P5 block (only for the rotations that keep it); line = the P5 token goes.
     */
    function reemit(found, item, changes, { text }) {
      const { stripped, match: m, span } = found;
      const vector = /^PV/.test(item.ref);
      if (Object.hasOwn(changes, 'fontType')) {
        const to = changes.fontType;
        if (!FONT_TYPE_OPTIONS.some(o => o.value === to) || (to === 'vector') === vector || typeof text !== 'string') return null;
        const [format, dataLetter] = to === 'vector' ? ['PV', 'V'] : ['PC', 'C'];
        const id = convertedId(text, item.ref, format, `R${dataLetter}`);
        const command = vector ? vectorToBitmap(found, item, id) : bitmapToVector(found, item, id);
        const [fromLetter, digits] = [vector ? 'V' : 'C', /^P[CV](\d+)$/.exec(item.ref)[1]];
        const edits = [...text.slice(span.end).matchAll(new RegExp(String.raw`\{R${fromLetter}${digits};`, 'g'))]
          .map(hit => ({ start: span.end + hit.index + 1, end: span.end + hit.index + 3 + digits.length, value: `R${dataLetter}${id}` }));
        return { command, edits, ref: `${format}${id}` };
      }
      if (Object.hasOwn(changes, 'kind') && !vector) {
        const [s, e] = m.indices[10];
        if (changes.kind === 'block' && !item.block && blockAvailable(m[5])) return stripped.slice(0, s) + defaultBlockToken(item) + stripped.slice(e);
        if (changes.kind === 'line' && item.block) return stripped.slice(0, s) + stripped.slice(e);
      }
      return null;
    }

    return {
      // Parse handlers: { pattern, handle(match, cmd, ctx) }
      handlers: [
        {
          // Text with a bitmap font
          pattern: new RegExp(String.raw`^PC(\d+);(\d+),(\d+),(\d+),(\d+),` + TEXT_TAIL),
          handle(m, cmd, ctx) {
            const ref = 'PC' + m[1];
            ctx.addField(ref, {
              kind: 'text', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
              font: bitmapFont(ctx, ref, m[6].toUpperCase(), m[4], m[5]),
              rotation: textRotation(ctx, ref, m[8]),
              ...parseSpacing(m[7], ctx.dot),
              ...textAttribute(ctx, m[9], m[10], Math.max(magnification(m[4]), magnification(m[5])) * PC_DEFAULT_DOTS),
              ...parseBold(m[11], ctx.dot),
              ...parseCounter(ctx, m[11]),
              ...parseAlign(m[11]),
              ...withMagnifications(parseBlock(ctx, ref, m[11], m[8]), m[4], m[5]),
              data: m[12] ?? null,
            });
          },
        },
        {
          // Text with an outline font: character width and height in 0.1 mm
          pattern: new RegExp(String.raw`^PV(\d+);(\d+),(\d+),(\d+),(\d+),` + TEXT_TAIL),
          handle(m, cmd, ctx) {
            const ref = 'PV' + m[1];
            const { family, weight } = OUTLINE_FONT;
            ctx.addField(ref, {
              kind: 'text', ref, source: sourceOf(cmd), x: +m[2], y: +m[3], raw: { x: m[2], y: m[3] },
              font: { size: +m[5], scaleX: +m[4] / +m[5], family, weight, style: 'normal' },
              rotation: textRotation(ctx, ref, m[8]),
              ...parseSpacing(m[7], ctx.dot),
              ...textAttribute(ctx, m[9], m[10], (Math.max(+m[4], +m[5]) / 10) * PV_DEFAULT_DOTS_PER_MM),
              ...parseCounter(ctx, m[11]),
              ...parseAlign(m[11]),
              data: m[12] ?? null,
            });
          },
        },
      ],
      // build(text, point, options) -> text with the new component
      build,
      // emit(item, ctx) -> the PC/PV command and its RC/RV data command
      emit,
      // Coordinate fields moved by moveItem (see COORDINATES in js/languages/tpcl.js)
      coordinates: [
        { pattern: /^\{(?:PC|PV)\d+;(\d+),(\d+)/d, fields: [[1, null, 'x'], [2, null, 'y']] },
      ],
      // Editable shapes for describeItem / updateItem (see EDITABLE in js/languages/tpcl.js)
      editable: [
        { // Outline text: PVnn;x,y,<width>,<height>,<font>,[±adj,]<rotation>,<attribute>
          applies: item => item.kind === 'text' && /^PV/.test(item.ref),
          pattern: new RegExp(String.raw`^\{PV\d+;\d+,\d+,(\d+),(\d+),([A-Za-z0-9]),` + SPACING_SLOT + String.raw`(\d{2}),([BWFC]\d{0,4})` + TAIL_SLOTS, 'd'),
          reemit,
          fields: [
            fontTypeField,
            VECTOR_KIND_FIELD,
            numberField('width', 'Ancho (0,1 mm)', 1, 1, MAX_COORD, item => Math.round(item.font.size * item.font.scaleX)),
            numberField('height', 'Alto (0,1 mm)', 2, 1, MAX_COORD, item => item.font.size),
            rotationField(5),
            fontField(3, OUTLINE_FONT_OPTIONS),
            spacingField(4, 'PV'),
            ...attributeFields(6),
            ...counterFieldsOf(7),
            ...alignFields(9),
          ],
        },
        { // Bitmap text: PCnn;x,y,<h magnification>,<v magnification>,<font>,[±adj,]<rotation>,<attribute> (steps of 0.1)
          applies: item => item.kind === 'text' && /^PC/.test(item.ref),
          pattern: new RegExp(String.raw`^\{PC\d+;\d+,\d+,(\d+),(\d+),([A-Za-z0-9]),` + SPACING_SLOT + String.raw`(\d{2}),([BWFC]\d{0,4})` + BOLD_SLOT + PC_TAIL_SLOTS, 'd'),
          reemit,
          fields: [
            fontTypeField,
            bitmapKindField,
            ...blockFields(10),
            magnificationField('hMag', 'Ampliación horizontal (×0,1)', 1),
            magnificationField('vMag', 'Ampliación vertical (×0,1)', 2),
            rotationField(5),
            fontField(3, BITMAP_FONT_OPTIONS),
            spacingField(4, 'PC'),
            ...attributeFields(6),
            ...boldFields(7),
            ...counterFieldsOf(8),
            ...alignFields(10),
          ],
        },
      ],
    };
  }

  // The magnification rule, for the tests and the other TPCL code
  PB.slices.text.tpcl = Object.assign(tpcl, { isValidMagnification, magnificationToken, MAGNIFICATIONS });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
