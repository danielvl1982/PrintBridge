/**
 * Barcode slice: GS1 element strings for GS1-128, published as PB.gs1. Loads after js/core/barcode-data.js and js/core/diagnostics.js.
 * The model data of a 'gs1-128' barcode is the standard notation with parentheses, e.g. `(01)09501101530003(17)250101(10)ABC123`;
 * toCode128Data turns it into the Code 128 data the encoder draws (leading FNC1, AIs without parentheses, FNC1 after a variable-length
 * AI that is not the last element) and fromCode128Data is the inverse. Only the logistic subset of the Application Identifiers is
 * known (see odd/tasks/gs1-128.md, "Verified AI table"); any other AI is a diagnostic, never silently accepted.
 * Rules marked UNVERIFIED there (48 data characters, day 00 in a date) are warnings; the structural rules are errors.
 */
(function (PB) {
  'use strict';

  const { barcodeData, diagnostics: diag } = PB;
  const FNC1 = barcodeData.FNC1;

  const fixed = (length, charset = 'numeric', mod10 = false) => Object.freeze({ kind: 'fixed', length, charset, mod10 });
  const variable = (length, charset) => Object.freeze({ kind: 'variable', length, charset, mod10: false });
  const DATE = fixed(6);

  /**
   * AI -> { kind: 'fixed' | 'variable', length (exact, or the maximum), charset: 'numeric' | 'set82', mod10 }.
   * Source: the GS1 AI table (https://ref.gs1.org/ai/GS1_Application_Identifiers.jsonld).
   */
  const AIS = Object.freeze({
    '00': fixed(18, 'numeric', true), '01': fixed(14, 'numeric', true), '02': fixed(14, 'numeric', true),
    '10': variable(20, 'set82'), '11': DATE, '13': DATE, '15': DATE, '17': DATE, '20': fixed(2),
    '21': variable(20, 'set82'), '30': variable(8, 'numeric'), '37': variable(8, 'numeric'),
    '240': variable(30, 'set82'), '241': variable(30, 'set82'), '400': variable(30, 'set82'),
    '410': fixed(13, 'numeric', true), '411': fixed(13, 'numeric', true), '412': fixed(13, 'numeric', true),
    '413': fixed(13, 'numeric', true), '414': fixed(13, 'numeric', true), '415': fixed(13, 'numeric', true),
  });
  const DATE_AIS = Object.freeze(['11', '13', '15', '17']);

  /** Most data characters a GS1-128 symbol carries (UNVERIFIED whether AIs count: they do here, with the FNC1 separators). */
  const MAX_DATA_CHARACTERS = 48;

  /** GS1 character set 82: ! " % & ' ( ) * + , - . / digits : ; < = > ? A-Z _ a-z. */
  const SET82 = /^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]*$/;
  const INVALID_SET82 = /[^!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]/;

  /** Mod 10 check digit of a digit payload: weights 3, 1, 3, 1... from the rightmost digit; (10 - sum mod 10) mod 10. */
  function mod10(payload) {
    const digits = String(payload);
    let sum = 0;
    for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
    return (10 - (sum % 10)) % 10;
  }

  /** The AI at the start of a Code 128 data position (2 digits first, then 3), or null when it is outside the subset. */
  function aiAt(data, at) {
    for (const length of [2, 3]) {
      const ai = data.substr(at, length);
      if (ai.length === length && Object.hasOwn(AIS, ai)) return ai;
    }
    return null;
  }

  /** Diagnostics of one element whose AI is known. */
  function checkElement({ ai, value }, out) {
    const spec = AIS[ai];
    const tag = `(${ai})`;
    if (!value) { out.push(diag.error(`${tag}: el valor está vacío`)); return; }
    const exact = spec.kind === 'fixed';
    if (exact ? value.length !== spec.length : value.length > spec.length) {
      out.push(diag.error(`${tag}: ${exact ? `debe tener ${spec.length}` : `admite como máximo ${spec.length}`} caracteres y tiene ${value.length}`));
      return;
    }
    if (spec.charset === 'numeric' ? !/^\d+$/.test(value) : !SET82.test(value)) {
      const bad = spec.charset === 'numeric' ? value.replace(/\d/g, '') : value.match(new RegExp(INVALID_SET82, 'g')).join('');
      out.push(diag.error(spec.charset === 'numeric' ? `${tag}: solo admite dígitos` : `${tag}: carácter no permitido por GS1 (${[...new Set(bad)].join(' ')})`));
      return;
    }
    if (spec.mod10 && Number(value.slice(-1)) !== mod10(value.slice(0, -1))) {
      out.push(diag.error(`${tag}: dígito de control incorrecto (módulo 10): debería ser ${mod10(value.slice(0, -1))}`));
    }
    if (DATE_AIS.includes(ai)) {
      const month = Number(value.slice(2, 4)), day = Number(value.slice(4, 6));
      if (month < 1 || month > 12) out.push(diag.error(`${tag}: el mes ${value.slice(2, 4)} no está entre 01 y 12`));
      else if (day > 31) out.push(diag.error(`${tag}: el día ${value.slice(4, 6)} no está entre 00 y 31`));
      else if (day === 0) out.push(diag.warning(`${tag}: el día 00 solo es válido si GS1 lo admite para esta fecha (sin verificar)`));
    }
  }

  /**
   * parse(text) -> { elements: [{ ai, value }], diagnostics, structural } for the notation `(AI)value(AI)value`.
   * `structural` is true when the text cannot be turned into elements (empty, text outside the parentheses, an unknown AI), which is
   * when toCode128Data gives null. A value runs up to the next `(digits)`.
   */
  function parse(text) {
    const source = String(text ?? '');
    const out = [];
    const elements = [];
    let structural = false;
    if (!source) {
      out.push(diag.error('GS1-128: los datos están vacíos'));
      return { elements, diagnostics: out, structural: true };
    }
    const pattern = /\((\d*)\)/g;
    const marks = [...source.matchAll(pattern)];
    if (!marks.length || marks[0].index !== 0) {
      out.push(diag.error('GS1-128: los datos deben empezar por un identificador entre paréntesis, p. ej. (01)09501101530003'));
      return { elements, diagnostics: out, structural: true };
    }
    marks.forEach((mark, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].index : source.length;
      const ai = mark[1];
      const value = source.slice(mark.index + mark[0].length, end);
      if (!Object.hasOwn(AIS, ai)) {
        structural = true;
        out.push(diag.error(`GS1-128: el identificador (${ai}) no está en el subconjunto logístico soportado`));
        return;
      }
      elements.push({ ai, value });
      checkElement({ ai, value }, out);
    });
    if (!structural && elements.length) {
      const length = dataLength(elements);
      if (length > MAX_DATA_CHARACTERS) out.push(diag.warning(`GS1-128: ${length} caracteres de datos, más de los ${MAX_DATA_CHARACTERS} que admite el símbolo (sin verificar)`));
    }
    return { elements, diagnostics: out, structural };
  }

  /** Whether an element is followed by an FNC1 separator: variable length and not the last one. */
  const needsSeparator = (elements, i) => AIS[elements[i].ai].kind === 'variable' && i < elements.length - 1;

  /** Data characters of the symbol: AIs, values and FNC1 separators (the leading FNC1, check and stop do not count). */
  const dataLength = elements => elements.reduce((sum, e, i) => sum + e.ai.length + e.value.length + (needsSeparator(elements, i) ? 1 : 0), 0);

  /** Code 128 data of a GS1 element string: leading FNC1, AIs without parentheses, FNC1 after a non-last variable AI; null when it cannot be encoded. */
  function toCode128Data(text) {
    const { elements, structural } = parse(text);
    if (structural || !elements.length) return null;
    return FNC1 + elements.map((e, i) => e.ai + e.value + (needsSeparator(elements, i) ? FNC1 : '')).join('');
  }

  /** Inverse of toCode128Data: the parenthesized string, or null when the data has no leading FNC1 or an AI is outside the subset / ambiguous. */
  function fromCode128Data(data) {
    const source = String(data ?? '');
    if (!source.startsWith(FNC1) || source.length === 1) return null;
    let at = 1;
    let text = '';
    while (at < source.length) {
      const ai = aiAt(source, at);
      if (!ai) return null;
      const spec = AIS[ai];
      at += ai.length;
      let value;
      if (spec.kind === 'fixed') {
        value = source.substr(at, spec.length);
        if (value.length < spec.length || value.includes(FNC1)) return null;
        at += spec.length;
      } else {
        const stop = source.indexOf(FNC1, at);
        const end = stop < 0 ? source.length : stop;
        value = source.slice(at, end);
        at = stop < 0 ? end : end + 1;
        if (stop >= 0 && at >= source.length) return null;
      }
      if (!value) return null;
      text += `(${ai})${value}`;
    }
    return text;
  }

  /** Human readable line: the element string with its parentheses (never encoded); the text as written when it is not a GS1 string. */
  function readable(text) {
    const { elements, structural } = parse(text);
    return structural || !elements.length ? String(text ?? '') : elements.map(e => `(${e.ai})${e.value}`).join('');
  }

  /** What a language parser makes of Code 128 data: { symbology: 'gs1-128', data: the parenthesized string } when it starts with FNC1 and is an element string, else the data as it is. */
  function readCode128(data) {
    const text = fromCode128Data(data);
    return text === null ? { symbology: 'code128', data } : { symbology: 'gs1-128', data: text };
  }

  /** The Code 128 item a language writes for a gs1-128 item (the printers never take the parentheses), or null when its data cannot be encoded. */
  function toCode128Item(item) {
    const data = toCode128Data(item.data);
    return data === null ? null : { ...item, symbology: 'code128', data };
  }

  /** Hint shown under the Contenido field of a gs1-128 barcode in the properties panel (all three languages). */
  const NOTATION_HINT = 'Notación GS1 con paréntesis, p. ej. (01)09501101530003(17)250101(10)ABC123. Solo identificadores logísticos (00, 01, 02, 10, 11, 13, 15, 17, 20, 21, 30, 37, 240, 241, 400, 410-415); la impresora recibe los datos sin paréntesis y con FNC1';

  /** Warning text of an emitter for a gs1-128 item whose data cannot be encoded (toCode128Data gives null): names the real cause. */
  function unwritableMessage(text) {
    const first = parse(text).diagnostics.find(d => d.level === 'error');
    const cause = first ? first.text.replace(/^GS1-128: /, '') : 'no es una cadena de elementos GS1';
    return `Código de barras GS1-128 con datos no válidos (${cause}): no se exporta`;
  }

  /** Notice (js/app.js) for a Contenido edit of a gs1-128 barcode that the language refused: the cause, and that the previous content stays. */
  function rejectedEditMessage(text) {
    const { structural, diagnostics } = parse(text);
    const first = structural ? diagnostics.find(d => d.level === 'error') : null;
    const cause = first ? first.text.replace(/^GS1-128: /, '') : 'el contenido no se puede escribir en este lenguaje';
    return `Contenido GS1-128 rechazado (${cause}): se mantiene el contenido anterior`;
  }

  PB.gs1 = Object.freeze({ AIS, MAX_DATA_CHARACTERS, NOTATION_HINT, mod10, parse, toCode128Data, fromCode128Data, readable, readCode128, toCode128Item, unwritableMessage, rejectedEditMessage });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
