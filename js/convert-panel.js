/**
 * "Convertir a..." panel (PB.ui.createConvertPanel): converts the label in the editor to another printer language with
 * PB.convert and shows the result, the fidelity diagnostics of the target, and Copiar / Descargar for the output. The targets are the registered languages that can emit
 * (TPCL, TSPL and ZPL); the output of a language with binary data (TSPL images) carries the note about Copiar, ZPL text never does.
 * It builds its own controls inside `root` and reads the label through callbacks, so it knows nothing about the editor.
 *   createConvertPanel({ root, getText, getDpi, getSourceName?, onMessage? })
 *     getText():        label text to convert
 *     getDpi():         resolution (dpi) the label is parsed and written at
 *     getSourceName():  name of the loaded file (suggests the download name), or undefined
 *     onMessage(text):  optional, notified of every status line the panel shows
 * Returns { els, convert, copy, download }; `els` are the controls (the tests drive them).
 * Depends on PB.convert, PB.languages and PB.diagnostics.
 */
(function (PB) {
  'use strict';

  /** Control characters other than TAB, LF and CR: what raw binary data (TSPL BITMAP payloads) is made of. */
  const BINARY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
  const BINARY_NOTE = 'La salida contiene datos binarios (imágenes): use Descargar, copiar puede alterarlos';
  const COPIED = 'Copiado al portapapeles';
  const COPY_FAILED = 'No se pudo copiar: seleccione el texto y use Ctrl+C';
  const NO_DIAGNOSTICS = 'Sin avisos de conversión';

  function createConvertPanel({ root, getText, getDpi, getSourceName = () => undefined, onMessage = () => {} }) {
    const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);

    const els = {
      select: make('select'),
      convert: make('button', { textContent: 'Convertir', type: 'button' }),
      summary: make('p', { className: 'convert-summary' }),
      output: make('textarea', { readOnly: true, spellcheck: false }),
      note: make('p', { className: 'convert-note', hidden: true }),
      copy: make('button', { textContent: 'Copiar', type: 'button', disabled: true }),
      download: make('button', { textContent: 'Descargar', type: 'button', disabled: true }),
      status: make('span', { className: 'convert-status' }),
      diagnostics: make('ul', { className: 'msgs' }),
    };
    els.select.replaceChildren(...PB.convert.targets().map(t => make('option', { value: t.id, textContent: t.name })));

    const row = (...children) => {
      const el = make('div', { className: 'convert-bar' });
      el.replaceChildren(...children);
      return el;
    };
    root.replaceChildren(
      make('h2', { textContent: 'Convertir a…' }),
      row(els.select, els.convert),
      els.summary, els.output, els.note,
      row(els.copy, els.download, els.status),
      els.diagnostics,
    );

    // What was converted last: the text and the language it was written for (Copiar / Descargar work on this)
    let current = null;

    const say = text => { els.status.textContent = text; if (text) onMessage(text); };

    function showResult(result) {
      current = { text: result.text, target: result.target };
      const name = id => (PB.languages.get(id) || { name: id }).name;
      els.summary.textContent = `Convertido de ${name(result.source)} a ${name(result.target)}`;
      els.output.value = result.text;
      const all = result.diagnostics;
      const shown = all.length ? PB.diagnostics.sort(all) : [PB.diagnostics.info(NO_DIAGNOSTICS)];
      els.diagnostics.replaceChildren(...shown.map(d => make('li', { className: d.level, textContent: d.text })));
      const binary = BINARY.test(result.text);
      els.note.hidden = !binary;
      els.note.textContent = binary ? BINARY_NOTE : '';
      els.copy.disabled = false;
      els.download.disabled = false;
    }

    function showFailure(message) {
      current = null;
      els.summary.textContent = message;
      els.output.value = '';
      els.diagnostics.replaceChildren();
      els.note.hidden = true;
      els.note.textContent = '';
      els.copy.disabled = true;
      els.download.disabled = true;
    }

    function convert() {
      say('');
      try {
        showResult(PB.convert.run(getText(), els.select.value, { dpi: getDpi() }));
      } catch (error) {
        showFailure(error && error.code ? error.message : `Error al convertir: ${error && error.message}`);
      }
    }

    /** Last resort when the Clipboard API is missing or refuses: select the output and ask the browser to copy it. */
    function copyBySelection() {
      els.output.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch (error) { done = false; }
      return done;
    }

    async function copy() {
      if (!current) return;
      let done = false;
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try { await navigator.clipboard.writeText(current.text); done = true; } catch (error) { done = false; }
      }
      if (!done) done = copyBySelection();
      say(done ? COPIED : COPY_FAILED);
    }

    function download() {
      if (!current) return;
      const blob = new Blob([PB.convert.toBytes(current.text, current.target)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = make('a', { href: url, download: PB.convert.fileName(current.target, getSourceName()) });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Revoked after the browser has taken the click: some browsers cancel a download whose URL is revoked at once
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    els.convert.addEventListener('click', convert);
    els.copy.addEventListener('click', copy);
    els.download.addEventListener('click', download);

    return Object.freeze({ els, convert, copy, download });
  }

  PB.ui = PB.ui || {};
  PB.ui.createConvertPanel = createConvertPanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
