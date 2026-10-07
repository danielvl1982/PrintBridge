/**
 * Conversion between printer languages (PB.convert): the pure, language-agnostic part of "Convertir a...".
 * It only talks to the registry (js/core/languages.js): the source is detected (or given), parsed to the neutral model
 * and written by the target language's `emit` hook. Nothing here knows a language id; how a file is written comes from
 * the optional language properties `fileEncoding` ('utf-8' default | 'latin1') and `fileExtension` (default 'txt').
 *
 *   run(text, targetId, { dpi, sourceId }) -> { text, diagnostics, source, target, parseDiagnostics }
 *       diagnostics: the fidelity warnings of the target's emit (plus one warning if a latin1 file would lose characters);
 *       parseDiagnostics: what the source parser reported. Throws Error with `code` and a Spanish message:
 *       'empty-text' (no text), 'no-target-emit' (unknown target or a language that cannot emit),
 *       'no-source-language' (undetectable text, or an unknown sourceId).
 *   targets() -> [{ id, name }]       the registered languages that can emit
 *   toBytes(text, targetId) -> Uint8Array   file bytes: UTF-8, or byte-preserving latin1 (char code = byte, '?' above 255)
 *   fileName(targetId, sourceName?) -> suggested download name: the source name's base (path and extension dropped) or
 *       "etiqueta", plus the target's extension (TSPL .prn, TPCL .txt)
 * Depends on PB.languages and PB.diagnostics.
 */
(function (PB) {
  'use strict';

  const { diagnostics: diag } = PB;

  const DEFAULT_BASE = 'etiqueta';
  const DEFAULT_EXTENSION = 'txt';
  const QUESTION_MARK = 0x3F;
  const OUTSIDE_LATIN1 = /[^\u0000-ÿ]/gu;
  const ILLEGAL_IN_FILE_NAMES = /[<>:"|?*\u0000-\u001F]/g;

  const fail = (code, message) => Object.assign(new Error(message), { code });

  /** Registered languages that can write a label. */
  const emitters = () => PB.languages.all().filter(l => typeof l.emit === 'function');

  /** Text of a latin1 file with characters that do not fit one byte: a Spanish warning counting them, or null. */
  function encodingWarning(language, text) {
    if (language.fileEncoding !== 'latin1') return null;
    const lost = text.match(OUTSIDE_LATIN1);
    if (!lost) return null;
    const count = lost.length === 1 ? '1 carácter' : `${lost.length} caracteres`;
    return diag.warning(`El texto tiene ${count} fuera de latin1 (por ejemplo "${lost[0]}"): ${language.name} se guarda como bytes y se escribirán como "?"`);
  }

  function run(text, targetId, { dpi, sourceId } = {}) {
    if (typeof text !== 'string' || text.trim() === '') throw fail('empty-text', 'No hay texto que convertir: la etiqueta está vacía');
    const target = PB.languages.get(targetId);
    if (!target) throw fail('no-target-emit', `Lenguaje de destino desconocido: "${targetId}"`);
    if (typeof target.emit !== 'function') throw fail('no-target-emit', `El lenguaje "${target.name}" no permite exportar etiquetas`);
    const source = sourceId == null ? PB.languages.detect(text) : PB.languages.get(sourceId);
    if (!source) {
      throw fail('no-source-language', sourceId == null
        ? 'No se reconoce el lenguaje de impresión del texto de origen'
        : `Lenguaje de origen desconocido: "${sourceId}"`);
    }
    const options = dpi === undefined ? {} : { dpi };
    const model = source.parse(text, options);
    const out = PB.languages.emit(target.id, model, options);
    const warning = encodingWarning(target, out.text);
    return {
      text: out.text,
      diagnostics: warning ? [...out.diagnostics, warning] : out.diagnostics,
      source: source.id,
      target: target.id,
      parseDiagnostics: model.diagnostics || [],
    };
  }

  const targets = () => emitters().map(({ id, name }) => ({ id, name }));

  function toBytes(text, targetId) {
    const language = PB.languages.get(targetId);
    if (!language) throw fail('no-target-emit', `Lenguaje de destino desconocido: "${targetId}"`);
    const value = String(text);
    if (language.fileEncoding !== 'latin1') return new TextEncoder().encode(value);
    const chars = Array.from(value);
    const bytes = new Uint8Array(chars.length);
    chars.forEach((ch, i) => { const code = ch.codePointAt(0); bytes[i] = code > 0xFF ? QUESTION_MARK : code; });
    return bytes;
  }

  function fileName(targetId, sourceName) {
    const language = PB.languages.get(targetId);
    const extension = (language && language.fileExtension) || DEFAULT_EXTENSION;
    const leaf = String(sourceName == null ? '' : sourceName).split(/[\\/]/).pop();
    const dot = leaf.lastIndexOf('.');
    const base = (dot < 0 ? leaf : leaf.slice(0, dot)).replace(ILLEGAL_IN_FILE_NAMES, '_').trim();
    return `${base || DEFAULT_BASE}.${extension}`;
  }

  PB.convert = Object.freeze({ run, targets, toBytes, fileName });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
