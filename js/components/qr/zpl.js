/**
 * QR slice, ZPL language (Zebra): the QR Code command.
 *   ^FOx,y ^BQa,b,c ^FD<ECC><A|M>,<data> ^FS        (^FT instead of ^FO: the bottom-left corner of the symbol)
 * Parameter layout of the 2003 guide (Volume One): a = orientation, a FIXED value (normal; ^FW has no effect), b = model 1 (original) or 2 (enhanced,
 * recommended, default 2), c = magnification factor 1..10 (the dots per module; default 1 at 150 dpi, 2 at 200, 3 at 300, 6 at 600).
 * The field data carries what other languages put in parameters: `<error correction level><input mode>,<data>` with the level H (ultra-high),
 * Q (high), M (standard, the guide's default) or L (high density) and the input mode A (automatic: the data follows) or M (manual: the data
 * starts with the character mode N numeric, A alphanumeric, B + 4 digits (the byte count) + that many bytes, K kanji; segments are separated by
 * commas). The mixed mode puts a header `D<code no. 2 digits><divisions 2 digits><parity 2 hex digits>,` in front (the guide's examples
 * `D03048F,LM,N0123456789,A12AABB,B0006qrcode` and `D03048F,LA,012345678912AABBqrcode`).
 * It becomes the neutral `qr` item (see js/core/model.js) so the renderer of this slice needs no change:
 *   - ecc = the level (a missing prefix: M, reported once), cell = the magnification x the dot (native.cell keeps the dots), data = the payload (the
 *     prefixes of the manual mode are stripped; the mixed mode is reported and drawn as the joined segments: the code number and divisions
 *     (structured append) are not modelled), native = { type: 'BQ', model, cell, mode: 'A' | 'M' | null (no prefix), mixed, origin: 'FO' | 'FT'
 *     | 'default', orientationArg, zplData (the field data as written, ^FH decoded: emit writes it back while it still stands for the item) };
 *   - the neutral item has no rotation: the orientation is fixed, another letter is reported once and ignored; model 1 is drawn as model 2 (the
 *     viewer's generator makes model 2 only; reported once).
 * Position: ^FO is the top-left corner of the symbol and ^FT its bottom-left corner. NOT VERIFIED ON A PRINTER: the 2003 guide defines ^FT for text,
 * bar codes, boxes (bottom-left) and images (bottom-left) and says nothing about the 2D symbols, and it does not say whether ^FO leaves a quiet
 * zone around the symbol (later guides mention an offset for QR Code); the symbol is placed without one, as TPCL and TSPL do. The side of the
 * symbol for ^FT is measured on the data as written (a <#NAME#> variable counts as its text).
 * Emit (the inverse): ^FOx,y^BQN,<model>,<magnification>^FD<ECC>A,<data>^FS (automatic input, ^FH escapes for ^ and ~; the manual and mixed forms read
 * from a ZPL file are written back as read while the data and the level are unchanged), ^FT when the field came from ^FT. A magnification outside
 * 1..10 is clamped (warning once), an unknown level is written as M (warning).
 * Editing: magnification (cell), error correction level (the first letter of the field data, also in the mixed mode), model, and the content (the data
 * after the prefix: not offered in manual or mixed mode) and move (the origin).
 * factory(helpers) -> { handlers, emit, build, coordinates, editable }; registered by js/components/qr/index.js as `languages: { tpcl, tspl, zpl }`.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.qr = PB.slices.qr || {};

  const { diagnostics: diag } = PB;

  const ECC_LEVELS = Object.freeze(['L', 'M', 'Q', 'H']);
  const DEFAULT_ECC = 'M';
  const ECC_OPTIONS = Object.freeze([['L', 'L - Baja'], ['M', 'M - Media'], ['Q', 'Q - Alta'], ['H', 'H - Máxima']].map(([value, label]) => ({ value, label })));
  const MODEL_OPTIONS = Object.freeze([{ value: 1, label: '1 (original)' }, { value: 2, label: '2 (mejorado)' }]);
  const MAG_RANGE = Object.freeze([1, 10]);
  /** Magnification of a freshly inserted QR (dots per module). */
  const TEMPLATE_MAG = 4;
  /** Side in modules when the matrix cannot be generated (the renderer's fallback). */
  const FALLBACK_SIDE = 21;

  /** The guide's default magnification by resolution; the nearest listed resolution for the others. */
  const MAG_BY_DPI = Object.freeze([[150, 1], [200, 2], [300, 3], [600, 6]]);
  const defaultMag = dpi => MAG_BY_DPI.reduce((best, e) => (Math.abs(e[0] - dpi) < Math.abs(best[0] - dpi) ? e : best))[1];

  /** `D<code><divisions><parity>,` of the mixed mode, then `<ECC><A|M>,`. */
  const MIXED_HEADER = /^D\d{4}[0-9A-Fa-f]{2},/;
  const PREFIX = /^([HQML])([AM]),/i;
  /** The prefix, with the optional mixed header kept apart: groups 1 (header), 2 (level), 3 (mode and comma). */
  const PREFIX_PARTS = /^((?:D\d{4}[0-9A-Fa-f]{2},)?)([HQML])([AM],)/i;

  /**
   * Manual-mode payload (segments `N...`, `A...`, `K...` up to a comma, `B` + 4 digit count + that many characters) -> the segments joined, or
   * null when the prefixes are malformed (the caller then keeps the text as written).
   */
  function manualData(content) {
    let i = 0;
    let out = '';
    while (i < content.length) {
      const letter = content[i].toUpperCase();
      if (!'NAKB'.includes(letter)) return null;
      i++;
      if (letter === 'B') {
        const count = /^\d{4}/.exec(content.slice(i));
        if (!count) return null;
        i += 4;
        out += content.substr(i, +count[0]);
        i += +count[0];
      } else {
        const next = content.indexOf(',', i);
        const end = next < 0 ? content.length : next;
        out += content.slice(i, end);
        i = end;
      }
      if (content[i] === ',') i++;
      else if (i < content.length) return null;
    }
    return out;
  }

  /**
   * Field data -> { ecc (null: no prefix), mode: 'A' | 'M' | null, mixed, data, malformed }. Without a prefix the whole text is the data.
   * `malformed`: the manual prefixes could not be read (the data is then the text after the mode, as written).
   */
  function parseData(value) {
    let rest = value;
    const mixed = MIXED_HEADER.test(rest);
    if (mixed) rest = rest.slice(rest.indexOf(',') + 1);
    const m = PREFIX.exec(rest);
    if (!m) return { ecc: null, mode: null, mixed: false, data: value, malformed: false };
    rest = rest.slice(m[0].length);
    const mode = m[2].toUpperCase();
    if (mode === 'A') return { ecc: m[1].toUpperCase(), mode, mixed, data: rest, malformed: false };
    const stripped = manualData(rest);
    return { ecc: m[1].toUpperCase(), mode, mixed, data: stripped === null ? rest : stripped, malformed: stripped === null };
  }

  function zpl(helpers) {
    const {
      sourceOf, int, fieldData, fo, ft, exactDots, roundDots, insertCommand, freePlaceholder, dropDots, numberField, paramField, encodeData,
    } = helpers;

    // -------------------------------------------------------------------------------------------------------------
    // Palette

    /** Adds ^FOx,y ^BQN,2,4 ^FDMA,<#QRn#> ^FS before ^XZ at the drop point (the orientation is fixed: no rotation for the view). */
    function build(text, point, options) {
      const { x, y } = dropDots(text, point, options);
      return insertCommand(text, `^FO${x},${y}^BQN,2,${TEMPLATE_MAG}^FDMA,${freePlaceholder(text, 'QR')}^FS`);
    }

    // -------------------------------------------------------------------------------------------------------------
    // Parse

    /** Side in 0.1 mm of the symbol of the data (modules x cell), for the ^FT origin. */
    const sideOf = (data, ecc, cell) => {
      const m = PB.qr.matrix(String(data), ecc);
      return (m ? m.size : FALLBACK_SIDE) * cell;
    };

    function qrItem(ctx, field, cmd) {
      const ref = '^BQ';
      const arg = i => (cmd.args[i] ? cmd.args[i].raw : '');
      const orientation = arg(0).toUpperCase();
      if (orientation !== '' && orientation !== 'N') {
        ctx.once('zpl-qr-orientation', () => diag.info('^BQ: la orientación del QR es fija (N, ^FW no la cambia): se ignora la orientación indicada'));
      }
      let model = 2;
      if (arg(1) !== '') {
        const v = int(arg(1));
        if (v === 1 || v === 2) model = v;
        else ctx.report(diag.warning(`${ref}: modelo "${arg(1)}" no válido (1 o 2), se usa 2`));
      }
      if (model === 1) ctx.once('zpl-qr-model1', () => diag.info('QR modelo 1: el visor solo genera el modelo 2, se dibuja como modelo 2'));
      let mag = defaultMag(ctx.dpi);
      if (arg(2) !== '') {
        const v = int(arg(2));
        if (v !== null && v >= MAG_RANGE[0] && v <= MAG_RANGE[1]) mag = v;
        else ctx.report(diag.warning(`${ref}: factor de magnificación "${arg(2)}" no válido (1..10), se usa ${mag}`));
      }

      const value = field.data.value;
      const parsed = parseData(value);
      if (parsed.mode === null) {
        ctx.once('zpl-qr-prefix', () => diag.warning(`${ref}: los datos no llevan el prefijo del nivel de corrección y el modo de entrada (p. ej. "QA,"): se dibujan tal cual con el nivel ${DEFAULT_ECC}`));
      }
      if (parsed.mixed) ctx.once('zpl-qr-mixed', () => diag.info('QR en modo mixto (D): el visor dibuja los datos de los segmentos unidos y no modela el número de código ni las divisiones (no verificado en impresora)'));
      if (parsed.malformed) ctx.report(diag.info(`${ref}: los prefijos del modo manual no son válidos, se usa el contenido tal cual`));

      const ecc = parsed.ecc || DEFAULT_ECC;
      const o = ctx.origin(field);
      const cell = mag * ctx.dot;
      const item = {
        kind: 'qr', ref: 'BQ', source: sourceOf(field), x: o.x, y: o.y, ecc, cell, symbology: 'qr',
        native: { type: 'BQ', model, cell: mag, mode: parsed.mode, mixed: parsed.mixed, origin: o.kind, orientationArg: orientation || null, zplData: value },
        data: parsed.data,
      };
      if (o.kind === 'FT') item.y = o.y - sideOf(item.data, ecc, cell);
      return item;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Emit

    /** The field data: written back as read while it still stands for the item (the manual / mixed forms), else `<ECC>A,<data>`. */
    function dataOf(item, ecc) {
      const native = item.native || {};
      if (native.type === 'BQ' && typeof native.zplData === 'string') {
        const again = parseData(native.zplData);
        if (again.mode !== null && again.data === item.data && again.ecc === ecc) return native.zplData;
      }
      return `${ecc}A,${item.data == null ? '' : String(item.data)}`;
    }

    /** ^FOx,y ^BQN,model,mag ^FD..^FS of a qr item (see the header). */
    function emit(item, ctx) {
      const key = String(item.ecc ?? '').toUpperCase();
      if (!ECC_LEVELS.includes(key)) ctx.once('zpl-qr-ecc', () => diag.warning(`Hay códigos QR con corrección de errores "${item.ecc ?? ''}" desconocida: se escriben con ${DEFAULT_ECC}`));
      const ecc = ECC_LEVELS.includes(key) ? key : DEFAULT_ECC;
      let mag = Number.isFinite(item.cell) && item.cell > 0 ? roundDots(exactDots(ctx, item.cell)) : defaultMag(ctx.dpi);
      if (mag < MAG_RANGE[0] || mag > MAG_RANGE[1]) {
        ctx.once('zpl-qr-mag', () => diag.warning(`Hay códigos QR con un módulo fuera de ${MAG_RANGE[0]}..${MAG_RANGE[1]} puntos: se ajusta al límite de ZPL (^BQ)`));
        mag = Math.min(MAG_RANGE[1], Math.max(MAG_RANGE[0], mag));
      }
      const native = item.native || {};
      const model = native.model === 1 || native.model === 2 ? native.model : 2;
      const [x, y] = [item.x || 0, item.y || 0];
      const at = native.origin === 'FT'
        ? ft(ctx, x, y + sideOf(item.data, ecc, mag * PB.units.dotSize(ctx.dpi)))
        : fo(ctx, x, y);
      return `${at}^BQN,${model},${mag}${fieldData(ctx, dataOf(item, ecc))}^FS`;
    }

    // -------------------------------------------------------------------------------------------------------------
    // Edit

    const maxData = PB.zplEdit.MAX_DATA;
    const modelField = paramField({
      key: 'model', label: 'Modelo', type: 'select', cmd: 'BQ', arg: 1, options: MODEL_OPTIONS, model: item => item.native && item.native.model,
      read: raw => (raw === '' ? 2 : raw === '1' ? 1 : raw === '2' ? 2 : undefined),
      write: v => (v === 1 || v === 2 ? String(v) : null),
    });
    /** The level is the first letter of the field data (after the mixed header, if any): the whole argument is rewritten around it. */
    const eccField = {
      key: 'ecc', label: 'Corrección de errores', type: 'select', cmd: ['FD', 'FV'], arg: 0, options: ECC_OPTIONS, model: item => item.ecc,
      read: a => { const m = PREFIX_PARTS.exec(a.value); return m ? m[2].toUpperCase() : undefined; },
      write: (v, a) => (ECC_LEVELS.includes(v) && PREFIX_PARTS.test(a.raw) ? a.raw.replace(PREFIX_PARTS, `$1${v}$3`) : null),
    };
    /** The data after the `<ECC>A,` prefix, which the write keeps; not offered in manual or mixed mode (the prefixes are not part of the item's data). */
    const contentField = {
      key: 'content', label: 'Contenido', type: 'text', cmd: ['FD', 'FV'], arg: 0, maxLength: maxData, model: item => item.data,
      read: a => { const p = parseData(a.value); return p.mode === 'M' || p.mixed ? undefined : p.data; },
      write(v, a, cmd) {
        if (typeof v !== 'string' || v.length > maxData) return null;
        const prefix = /^[HQML]A,/i.exec(a.raw);
        const encoded = encodeData(v.replace(/\r\n|\r|\n/g, ' '), { indicator: cmd.hex || '_', hex: !!cmd.hex });
        const text = (prefix ? prefix[0] : '') + encoded.text;
        return encoded.hex && !cmd.hex ? { value: text, edits: [{ start: cmd.start, end: cmd.start, value: '^FH' }] } : text;
      },
    };

    return {
      // emit(item, ctx) -> the field of a qr item
      emit,
      // build(text, point, options) -> text with a new QR field (palette)
      build,
      // Move: the field origin (^FO / ^FT), which is what the default coordinates are
      coordinates: [{ applies: item => item.kind === 'qr' }],
      editable: [{
        applies: (item, field) => item.kind === 'qr' && (field ? field.has('BQ') : item.ref === 'BQ'),
        fields: [
          numberField('cell', 'Magnificación (puntos por módulo)', 'BQ', 2, MAG_RANGE[0], MAG_RANGE[1], item => item.native && item.native.cell),
          eccField,
          modelField,
          contentField,
        ],
      }],
      handlers: [
        {
          // ^BQa,b,c ... ^FD data ^FS: a QR field (no data: nothing to draw)
          pattern: /^\^BQ$/,
          handle(m, cmd, ctx, field) {
            if (field.data) ctx.addItem(qrItem(ctx, field, cmd));
          },
        },
      ],
    };
  }

  PB.slices.qr.zpl = zpl;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
