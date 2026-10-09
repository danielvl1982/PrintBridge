/**
 * Data Matrix slice, ZPL language (Zebra): the Data Matrix command.
 *   ^FOx,y ^BXo,h,s,c,r,f,g ^FDdata ^FS        (^FT instead of ^FO: the bottom-left corner of the symbol)
 * Parameter layout of the 2003 guide (Volume One): o = orientation N R I B (default: ^FW); h = the height of the individual symbol elements, the MODULE
 * in dots (1 to the label width; 0 or omitted: the height of ^BY divided by the rows / columns of the symbol, rounded, at least 1); s = quality
 * (ECC) 0, 50, 80, 100, 140 or 200, DEFAULT 0 ("for new applications ECC 200 is recommended"); c, r = columns and rows to encode (the guide lists 9 to 49
 * for both and also "10 to 144" for ECC 200: inconsistent, the viewer reads the ECC 200 values as the symbol side in modules, 10..144 even);
 * f = format ID 1..6 (not used with quality 200); g = the escape character of the field data (quality 200 only, default _).
 * ^BY has no effect except its height (above); the 2003 guide does not document the encodation (it describes the escape sequences of quality 200:
 * _X control characters, _1.._3 FNC, _5NNN code page, _dNNN code word, __ an underscore).
 * It becomes the neutral `datamatrix` item (see js/core/model.js), so the renderer and the validator of this slice need no change:
 *   - ecc = the quality (0, 50, 80, 100, 140: the viewer reports that it only draws ECC 200 and shows the hatched placeholder, like TPCL's ECC types);
 *   - cell = h x the dot (derived from ^BY as above when h is 0); rotation from o; size = c when c and r are the same square size of the table (ECC
 *     200 only); a rectangle of ISO 16022 (18x8, 32x8, 26x12, 36x12, 36x16, 48x16) is reported ("rectangular") and drawn as the smallest square that
 *     fits, as the other languages do; one of the two only, or any other value, is reported and automatic;
 *   - data: for quality 200 the `__` of the escape character is read as one (the other escape sequences are NOT interpreted: reported once and
 *     encoded as written, because the viewer's encoder is the ASCII encodation of ISO 16022);
 *   - native = { type: 'BX', h (as written, 0 = none), module (dots, derived when h is 0), quality, cols, rows, formatId, escape, origin: 'FO' | 'FT' |
 *     'default', orientationArg, zplData (the field data as written, ^FH decoded: emit writes it back while it still stands for the item) }.
 * Position: the symbol turns around its top-left corner (the renderer's anchor) and is square, with S = the side in 0.1 mm. ^FO is the top-left corner of
 * the box of the rotated symbol (guide: independent of the rotation), so the anchor is FO + (0,0) for N, (S,0) for R, (S,S) for I and (0,S) for B;
 * ^FT is the bottom-left corner of the symbol "fixed with respect to the contents" (the guide: boxes and images at the bottom-left, the origin does not
 * change with the rotation), so the anchor is FT + (0,-S) for N, (S,0) for R, (0,S) for I and (-S,0) for B. NOT VERIFIED ON A PRINTER: the 2003 guide
 * defines ^FT for text, bar codes, boxes and images and says nothing about the 2D symbols. S is measured on the data as written (a <#NAME#> variable
 * counts as its text).
 * Emit (the inverse): ^FO (^FT when the field came from ^FT) ^BX<o>,<h>,<s>[,<c>,<r>][,<f>[,<g>]] ^FD..^FS: the module always explicit (never from ^BY); the
 * quality as it is when it exists in ZPL (the viewer then reports that it does not draw it), else 200 with a warning; columns and rows only for a forced
 * size of an ECC 200 item (for the other qualities the ones read from a ZPL file are kept); the escape character doubled in the data of quality 200.
 * A module of 0 (TPCL: not drawn) is skipped with a warning; a module outside 1..9999 is clamped.
 * Editing: module, symbol size (automatic or a square one of the table; quality 200 only), rotation, content and move (the origin).
 * factory(helpers) -> { handlers, emit, build, coordinates, editable }; registered by js/components/datamatrix/index.js as `languages: { tpcl, tspl, zpl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.datamatrix = PB.slices.datamatrix || {};

  const { diagnostics: diag, datamatrix: dm } = PB;
  const { cellOf, sideDrawn } = PB.slices.datamatrix;

  const SIDES = Object.freeze(dm.SIZES.map(s => s.side));
  /** The rectangular symbols of ISO 16022 as [columns, rows], which the viewer does not generate. */
  const RECTANGLES = Object.freeze([[18, 8], [32, 8], [26, 12], [36, 12], [36, 16], [48, 16]]);
  /** Qualities (ECC) of the guide. */
  const QUALITIES = Object.freeze([0, 50, 80, 100, 140, 200]);
  const MODULE_RANGE = Object.freeze([1, 9999]);
  /** Module (dots) of a freshly inserted Data Matrix. */
  const TEMPLATE_MODULE = 4;
  const DEFAULT_ESCAPE = '_';

  const SIZE_OPTIONS = Object.freeze([{ value: 0, label: 'Automático' }, ...SIDES.map(side => ({ value: side, label: `${side} × ${side}` }))]);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /** Anchor - origin in 0.1 mm for the box of the rotated symbol (^FO) and for its bottom-left corner (^FT); S = the side of the symbol. */
  const FO_OFFSET = (rotation, s) => ({ 0: { x: 0, y: 0 }, 90: { x: s, y: 0 }, 180: { x: s, y: s }, 270: { x: 0, y: s } })[rotation];
  const FT_OFFSET = (rotation, s) => ({ 0: { x: 0, y: -s }, 90: { x: s, y: 0 }, 180: { x: 0, y: s }, 270: { x: -s, y: 0 } })[rotation];

  /** Field data of quality 200 -> { data (the doubled escape character read as one), sequences (some other escape sequence is present) }. */
  function readEscapes(value, escape) {
    let data = '';
    let sequences = false;
    for (let i = 0; i < value.length; i++) {
      if (value[i] !== escape) { data += value[i]; continue; }
      if (value[i + 1] === escape) { data += escape; i++; } else { data += escape; sequences = true; }
    }
    return { data, sequences };
  }

  function zpl(helpers) {
    const {
      sourceOf, int, ROTATIONS, rotationOf, orientationOf, toDots, fieldData, fo, ft, insertCommand, freePlaceholder, itemRotation, dropDots,
      paramField, contentField, rangeText,
    } = helpers;

    // -------------------------------------------------------------------------------------------------------------
    // Palette

    /** Adds ^FOx,y ^BXo,4,200 ^FD<#DATAMATRIXn#> ^FS before ^XZ at the drop point, rotated to look upright in the rotated view. */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      return insertCommand(text, `^FO${x},${y}^BX${orientationOf(itemRotation(options))},${TEMPLATE_MODULE},200^FD${freePlaceholder(text, 'DATAMATRIX')}^FS`);
    }

    // -------------------------------------------------------------------------------------------------------------
    // Parse

    function dmItem(ctx, field, cmd) {
      const ref = '^BX';
      const arg = i => (cmd.args[i] ? cmd.args[i].raw : '');
      const whole = (i, label) => {
        if (arg(i) === '') return 0;
        const v = int(arg(i));
        if (v !== null && v >= 0) return v;
        ctx.report(diag.warning(`${ref}: ${label} "${arg(i)}" no válido, se ignora`));
        return 0;
      };
      let rotation = rotationOf(ctx.orientation);
      let orientationArg = null;
      if (arg(0) !== '') {
        const given = rotationOf(arg(0)[0]);
        if (given === null) ctx.report(diag.warning(`${ref}: orientación "${arg(0)}" no válida, se usa ${ctx.orientation}`));
        else { rotation = given; orientationArg = arg(0)[0].toUpperCase(); }
      }
      // Module (guide: 1 to the width of the label; 0 or omitted: from ^BY): a value that is not usable falls back to the ^BY height
      let h = 0;
      if (arg(1) !== '') {
        const v = int(arg(1));
        if (v === null || v < 0 || v > MODULE_RANGE[1]) ctx.report(diag.warning(`${ref}: módulo "${arg(1).slice(0, 20)}" no válido (número entero de ${rangeText(MODULE_RANGE)} puntos), se usa el alto de ^BY`));
        else h = v;
      }
      let quality = 0;
      if (arg(2) !== '') {
        const q = int(arg(2));
        if (QUALITIES.includes(q)) quality = q;
        else ctx.report(diag.warning(`${ref}: calidad "${arg(2)}" no válida (0, 50, 80, 100, 140 o 200), se usa 0`));
      }
      const [cols, rows] = [whole(3, 'columnas'), whole(4, 'filas')];
      const escape = arg(6) !== '' ? arg(6)[0] : DEFAULT_ESCAPE;
      if (arg(6).length > 1) ctx.report(diag.warning(`${ref}: carácter de escape "${arg(6).slice(0, 20)}" tiene más de un carácter, se usa "${escape}"`));
      // Qualities 0..140 (guide, V1 4114+): columns and rows 9..49, odd; above 49 the printer sets them to 0 (automatic), even gives INVALID-P, below 9 no symbol prints
      if (quality !== 200) {
        [['columnas', 3, cols], ['filas', 4, rows]].forEach(([label, i, v]) => {
          if (arg(i) === '' || v === 0) return;
          if (v < 9) ctx.report(diag.warning(`${ref}: ${label} ${v} menor de 9 (9..49, impares para calidad 0 a 140): la impresora no dibuja el símbolo`));
          else if (v > 49) ctx.report(diag.warning(`${ref}: ${label} ${v} fuera de 9..49 (impares para calidad 0 a 140): la impresora lo pone a 0 y el tamaño es automático`));
          else if (v % 2 === 0) ctx.report(diag.warning(`${ref}: ${label} ${v} no es impar (9..49 impares para calidad 0 a 140): la impresora da INVALID-P`));
        });
        // Format ID 1..6, only used by the qualities below 200
        if (arg(5) !== '' && !(int(arg(5)) >= 1 && int(arg(5)) <= 6)) ctx.report(diag.warning(`${ref}: formato "${arg(5).slice(0, 20)}" no válido (1..6)`));
      }

      let size;
      if (quality === 200 && (cols || rows)) {
        if (cols && cols === rows && SIDES.includes(cols)) size = cols;
        else if (RECTANGLES.some(([c, r]) => c === cols && r === rows)) {
          ctx.report(diag.warning(`${ref}: Data Matrix rectangular ${cols}×${rows} no soportado por el visor, se dibuja el cuadrado más pequeño que cabe`));
        } else {
          ctx.report(diag.warning(`${ref}: columnas y filas (${cols}×${rows}) no son un símbolo cuadrado de ${SIDES[0]}×${SIDES[0]} a ${SIDES.at(-1)}×${SIDES.at(-1)}, se elige el menor que cabe`));
        }
      }

      const value = field.data.value;
      let data = value;
      if (quality === 200) {
        const read = readEscapes(value, escape);
        data = read.data;
        if (read.sequences) ctx.once('zpl-dm-escape', () => diag.warning(`${ref}: los datos de calidad 200 tienen secuencias de escape (${escape}1, ${escape}d..., ${escape}5...) que el visor no interpreta: se codifican como texto`));
      }

      const o = ctx.origin(field);
      const item = {
        kind: 'datamatrix', ref: 'BX', source: sourceOf(field), x: o.x, y: o.y, rotation, cell: h > 0 ? h * ctx.dot : null, ...(size && { size }), ecc: quality,
        symbology: 'datamatrix', native: {}, data,
      };
      // The module: h, else the ^BY height divided by the rows / columns of the symbol (guide: rounded, at least 1)
      const side = sideDrawn(item, data);
      const module = h > 0 ? h : Math.max(1, Math.round(ctx.by.height / side));
      item.cell = module * ctx.dot;
      item.native = {
        type: 'BX', h, module, quality, cols, rows, formatId: arg(5) || null, escape, origin: o.kind, orientationArg, zplData: value,
      };
      const length = side * item.cell;
      const off = o.kind === 'FT' ? FT_OFFSET(rotation, length) : FO_OFFSET(rotation, length);
      item.x = o.x + off.x;
      item.y = o.y + off.y;
      return item;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Emit

    /** Rotation in degrees: the nearest quarter turn, with a warning once if the item was not on one. */
    function rotationDegrees(ctx, rotation) {
      const turns = Number.isFinite(rotation) ? Math.round(rotation / 90) : 0;
      const degrees = (((turns * 90) % 360) + 360) % 360;
      if (degrees !== rotation && !(rotation == null && degrees === 0)) {
        ctx.once('zpl-dm-rotation', () => diag.warning('Hay Data Matrix con una rotación que no es múltiplo de 90°: se ajustan al giro más cercano'));
      }
      return degrees;
    }

    /** The field data of an item: written back as read while it still stands for the item, else encoded (the escape character doubled for quality 200). */
    function dataOf(item, quality, escape) {
      const native = item.native || {};
      const data = item.data == null ? '' : String(item.data);
      if (native.type === 'BX' && typeof native.zplData === 'string' && quality === 200 && native.escape === escape && readEscapes(native.zplData, escape).data === data) return native.zplData;
      if (native.type === 'BX' && typeof native.zplData === 'string' && quality !== 200 && native.zplData === data) return native.zplData;
      return quality === 200 ? data.replaceAll(escape, escape + escape) : data;
    }

    /** ^FOx,y ^BXo,h,s[,c,r][,f[,g]] ^FD..^FS of a datamatrix item (see the header). */
    function emit(item, ctx) {
      if (item.cell === 0) {
        ctx.once('zpl-dm-cell', () => diag.warning('Hay Data Matrix con módulo 0 (TPCL no los dibuja): no se escriben en ZPL'));
        return [];
      }
      const native = item.native || {};
      let quality = item.ecc === undefined ? 200 : item.ecc;
      if (!QUALITIES.includes(quality)) {
        ctx.once('zpl-dm-ecc', () => diag.warning(`Hay Data Matrix con un ECC (${quality}) que ZPL no tiene (calidad 0, 50, 80, 100, 140 o 200): se escribe 200`));
        quality = 200;
      }
      const degrees = rotationDegrees(ctx, item.rotation);
      const data = item.data == null ? '' : String(item.data);
      const side = sideDrawn(item, data);
      const raw = toDots(ctx, cellOf(item, side));
      const module = clamp(raw, ...MODULE_RANGE);
      if (module !== raw) ctx.once('zpl-dm-module', () => diag.warning(`Hay Data Matrix con un módulo fuera de ${MODULE_RANGE[0]}..${MODULE_RANGE[1]} puntos: se ajusta al límite de ZPL (^BX)`));
      const escape = native.type === 'BX' && typeof native.escape === 'string' && native.escape.length === 1 ? native.escape : DEFAULT_ESCAPE;
      const forced = quality === 200 && SIDES.includes(item.size);
      const [cols, rows] = forced ? [item.size, item.size] : native.type === 'BX' && quality !== 200 && native.cols > 0 && native.rows > 0 ? [native.cols, native.rows] : [0, 0];
      const values = [orientationOf(degrees), String(module), String(quality), cols ? String(cols) : '', rows ? String(rows) : '', native.type === 'BX' && native.formatId ? native.formatId : '',
        quality === 200 && escape !== DEFAULT_ESCAPE ? escape : ''];
      while (values.length && values[values.length - 1] === '') values.pop();
      // The origin: ^FO for fields from ^FO (the length of the symbol is known), ^FT for those that came from ^FT
      const length = side * module * PB.units.dotSize(ctx.dpi);
      const off = native.origin === 'FT' ? FT_OFFSET(degrees, length) : FO_OFFSET(degrees, length);
      const origin = [(item.x || 0) - off.x, (item.y || 0) - off.y];
      if (origin.some(v => v < -PB.units.dotSize(ctx.dpi) / 2)) ctx.once('zpl-dm-origin', () => diag.info('Hay Data Matrix girados cuyo origen queda fuera de la etiqueta (por la izquierda o por arriba): el origen se ajusta a 0'));
      const at = native.origin === 'FT' ? ft(ctx, ...origin) : fo(ctx, ...origin);
      return `${at}^BX${values.join(',')}${fieldData(ctx, dataOf(item, quality, escape))}^FS`;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Edit

    const moduleField = paramField({
      key: 'cell', label: 'Módulo (puntos)', type: 'number', cmd: 'BX', arg: 1, min: MODULE_RANGE[0], max: MODULE_RANGE[1], step: 1,
      model: item => item.native && item.native.module,
      // Omitted or 0: the module the viewer derived from ^BY (it is written as an explicit value when edited)
      read: (raw, cmd, item) => (/^\d+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : item && item.native && item.native.module > 0 ? item.native.module : undefined),
      write: v => (typeof v === 'number' && Number.isFinite(v) ? String(clamp(Math.round(v), ...MODULE_RANGE)) : null),
    });
    const rotationField = paramField({
      key: 'rotation', label: 'Rotación', type: 'select', cmd: 'BX', arg: 0, options: ROTATIONS.map(value => ({ value, label: `${value}°` })), model: item => item.rotation,
      read: (raw, cmd, item) => (raw === '' ? item && item.rotation : rotationOf(raw[0]) ?? undefined),
      write: v => (ROTATIONS.includes(v) ? orientationOf(v) : null),
    });

    /** The symbol size the command holds: 0 automatic (no columns and rows), a square size of the table, undefined for anything else (or another quality than 200). */
    function sizeOfCommand(cmd) {
      const at = i => (cmd.args[i] && cmd.args[i].raw !== '' ? int(cmd.args[i]) : 0);
      if (!cmd.args[2] || cmd.args[2].raw !== '200') return undefined;
      const [c, r] = [at(3), at(4)];
      if (c === null || r === null) return undefined;
      if (c === 0 && r === 0) return 0;
      return c === r && SIDES.includes(c) ? c : undefined;
    }
    /** Size select: columns and rows (arguments 3 and 4) are written together by `reemit`, so the field itself never writes. */
    const sizeField = {
      key: 'size', label: 'Tamaño del símbolo', type: 'select', custom: true, reemit: true, options: SIZE_OPTIONS,
      model: item => (item.ecc === 200 ? item.size || 0 : undefined),
      read: (text, found) => { const cmd = found.field.find('BX'); return cmd ? sizeOfCommand(cmd) : undefined; },
      edits: () => null,
    };

    /** Writes columns and rows for the new size; refuses when the current ones are not an automatic or table size or the value is not one. */
    function reemit(field, item, changes) {
      const cmd = field.find('BX');
      const side = changes.size;
      if (!cmd || (side !== 0 && !SIDES.includes(side))) return null;
      const current = sizeOfCommand(cmd);
      if (current === undefined || current === side) return null;
      const value = String(side);
      const edits = [3, 4].filter(i => cmd.args[i]).map(i => ({ start: cmd.args[i].start, end: cmd.args[i].end, value }));
      const missing = [3, 4].filter(i => !cmd.args[i]).length;
      if (missing) {
        const n = cmd.args.length;
        const at = n ? cmd.args[n - 1].end : cmd.start + 1 + cmd.name.length;
        const tail = [...Array(Math.max(0, 3 - n)).fill(''), ...Array(missing).fill(value)];
        edits.push({ start: at, end: at, value: (n ? ',' : '') + tail.join(',') });
      }
      return edits;
    }

    return {
      // emit(item, ctx) -> the field of a datamatrix item
      emit,
      // build(text, point, options) -> text with a new Data Matrix field (palette)
      build,
      // Move: the field origin (^FO / ^FT), which is what the default coordinates are
      coordinates: [{ applies: item => item.kind === 'datamatrix' }],
      editable: [{
        applies: (item, field) => item.kind === 'datamatrix' && (field ? field.has('BX') : item.ref === 'BX'),
        fields: [moduleField, sizeField, rotationField, contentField('content', 'Contenido', item => item.data)],
        reemit,
      }],
      handlers: [
        {
          // ^BXo,h,s,c,r,f,g ... ^FD data ^FS: a Data Matrix field (no data: nothing to draw)
          pattern: /^\^BX$/,
          handle(m, cmd, ctx, field) {
            if (field.data) ctx.addItem(dmItem(ctx, field, cmd));
          },
        },
      ],
    };
  }

  PB.slices.datamatrix.zpl = zpl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
