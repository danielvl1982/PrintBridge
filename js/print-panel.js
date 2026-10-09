/**
 * "Impresión" panel (PB.ui.createPrintPanel): sends the label bytes to a printer through the local PrintBridge agent
 * (agent/printbridge-agent.js, HTTP on 127.0.0.1). It shows the agent status (comprobando / conectado vX / no disponible), a printer
 * select loaded from `GET /printers` (the last chosen printer is remembered, else the Windows default one), the copies, an
 * Imprimir button, and a settings row with the agent URL and Reintentar. When the agent does not answer it says so in Spanish and
 * points to the install instructions; Descargar (panel Convertir) stays as the fallback.
 * It builds its own controls inside `root` and reads the bytes through a callback, so it knows nothing about the editor.
 *   createPrintPanel({ root, getBytes, fetch?, storage?, onMessage? })
 *     getBytes():       the bytes to print (Uint8Array, exactly what Descargar writes); may throw an Error with a Spanish message
 *     fetch:            fetch-compatible function (default globalThis.fetch); the tests pass a fake
 *     storage:          localStorage-like { getItem, setItem } (default globalThis.localStorage, guarded); the tests pass a fake
 *     onMessage(text):  optional, notified of every status line the panel shows
 * Returns { els, check, print, setUrl, url }; `els` are the controls (the tests drive them).
 */
(function (PB) {
  'use strict';

  const DEFAULT_URL = 'http://127.0.0.1:9631';
  const URL_KEY = 'printbridge.agentUrl';
  const PRINTER_KEY = 'printbridge.printer';
  const MAX_COPIES = 99;
  const HELP_URL = 'https://github.com/danielvl1982/PrintBridge/blob/main/agent/README.md';

  const TEXT = {
    checking: 'Comprobando el agente…',
    connected: version => `Agente conectado${version ? ` v${version}` : ''}`,
    down: 'Agente no disponible',
    noPrinters: 'El agente no encuentra ninguna impresora instalada en este equipo',
    downHelp: 'No se puede hablar con el agente de impresión. Compruebe que está en marcha (agent/start.bat o la instalación) y que Chrome permite el acceso a la red local; mientras tanto use Descargar en el panel Convertir.',
    refused: 'El agente no permite esta página (origen no autorizado): revise "allowedOrigins" en agent/config.json. Mientras tanto use Descargar.',
    helpLink: 'Cómo instalar el agente',
    badCopies: `Copias: escriba un número entero entre 1 y ${MAX_COPIES}`,
    badUrl: 'La dirección del agente no es válida (por ejemplo http://127.0.0.1:9631)',
    noPrinter: 'Elija una impresora',
    sending: 'Enviando a la impresora…',
    sent: (printer, bytes, copies) => `Enviado a "${printer}": ${bytes} bytes${copies > 1 ? `, ${copies} copias` : ''}`,
    failed: 'El agente no pudo imprimir',
  };

  function defaultStorage() {
    try { return globalThis.localStorage || null; } catch (e) { return null; }
  }

  function createPrintPanel({ root, getBytes, fetch: fetchFn = globalThis.fetch && globalThis.fetch.bind(globalThis), storage = defaultStorage(), onMessage = () => {} }) {
    const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
    const read = key => { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } };
    const write = (key, value) => { try { if (storage) storage.setItem(key, value); } catch (e) { /* storage unavailable: just not remembered */ } };

    const els = {
      status: make('span', { className: 'print-status is-checking', textContent: TEXT.checking }),
      printer: make('select', { disabled: true }),
      copies: make('input', { type: 'number', min: '1', max: String(MAX_COPIES), step: '1', value: '1' }),
      print: make('button', { textContent: 'Imprimir', type: 'button', disabled: true }),
      message: make('p', { className: 'print-message' }),
      help: make('p', { className: 'print-help', hidden: true }),
      helpLink: make('a', { href: HELP_URL, target: '_blank', rel: 'noopener', textContent: TEXT.helpLink }),
      url: make('input', { type: 'text', value: '', spellcheck: false, title: 'Dirección del agente de impresión' }),
      retry: make('button', { textContent: 'Reintentar', type: 'button' }),
    };

    const field = (text, control) => {
      const el = make('label');
      el.append(`${text} `, control);
      return el;
    };
    const row = (...children) => {
      const el = make('div', { className: 'convert-bar' });
      el.replaceChildren(...children);
      return el;
    };
    root.replaceChildren(
      make('h2', { textContent: 'Impresión' }),
      row(els.status),
      row(field('Impresora', els.printer), field('Copias', els.copies), els.print),
      els.message,
      els.help,
      row(field('Agente', els.url), els.retry),
    );

    let agentUrl = read(URL_KEY) || DEFAULT_URL;
    els.url.value = agentUrl;
    let connected = false;
    let checkId = 0;
    let sending = false;

    const say = text => { els.message.textContent = text; if (text) onMessage(text); };
    const refreshButton = () => { els.print.disabled = !connected || sending || !els.printer.value; };

    function setStatus(kind, text) {
      els.status.className = `print-status is-${kind}`;
      els.status.textContent = text;
    }

    function showHelp(text) {
      els.help.hidden = text === null;
      els.help.replaceChildren(...(text === null ? [] : [text + ' ', els.helpLink]));
    }

    function showDown(text) {
      connected = false;
      setStatus('down', TEXT.down);
      els.printer.replaceChildren();
      els.printer.disabled = true;
      showHelp(text);
      refreshButton();
    }

    function fillPrinters(printers) {
      const remembered = read(PRINTER_KEY);
      const options = printers.map(p => make('option', {
        value: p.name,
        textContent: `${p.name}${p.isDefault ? ' (predeterminada)' : ''}${p.status === 'offline' ? ' (sin conexión)' : ''}`,
      }));
      els.printer.replaceChildren(...options);
      els.printer.disabled = options.length === 0;
      const pick = printers.find(p => p.name === remembered) || printers.find(p => p.isDefault) || printers[0];
      els.printer.value = pick ? pick.name : '';
    }

    /** Asks the agent for its health and printers; updates the status line, the select and the Imprimir button. */
    async function check() {
      const id = ++checkId;
      setStatus('checking', TEXT.checking);
      say('');
      try {
        const health = await fetchFn(`${agentUrl}/health`);
        const info = await health.json();
        if (id !== checkId) return;
        if (!health.ok || !info || info.ok !== true) {
          return showDown(info && info.error === 'origin_refused' ? TEXT.refused : TEXT.downHelp);
        }
        const list = await fetchFn(`${agentUrl}/printers`);
        const body = await list.json();
        if (id !== checkId) return;
        if (!list.ok || !body || !Array.isArray(body.printers)) {
          showDown(null);
          say((body && body.message) || TEXT.downHelp);
          return;
        }
        connected = true;
        setStatus('ok', TEXT.connected(info.version));
        showHelp(null);
        fillPrinters(body.printers);
        if (body.printers.length === 0) say(TEXT.noPrinters);
        refreshButton();
      } catch (error) {
        if (id !== checkId) return;
        showDown(TEXT.downHelp);
      }
    }

    /** Sends the label bytes to the chosen printer. */
    async function print() {
      if (sending) return;
      const printer = els.printer.value;
      if (!printer) { say(TEXT.noPrinter); return; }
      const copiesText = String(els.copies.value).trim();
      const copies = /^\d{1,3}$/.test(copiesText) ? Number(copiesText) : 0;
      if (copies < 1 || copies > MAX_COPIES) { say(TEXT.badCopies); return; }
      let bytes;
      try {
        bytes = getBytes();
      } catch (error) {
        say((error && error.message) || 'No se pudo preparar la etiqueta');
        return;
      }
      sending = true;
      refreshButton();
      say(TEXT.sending);
      try {
        const response = await fetchFn(`${agentUrl}/print?printer=${encodeURIComponent(printer)}&copies=${copies}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
        });
        let body = null;
        try { body = await response.json(); } catch (error) { body = null; }
        if (response.ok && body && body.ok === true) {
          write(PRINTER_KEY, printer);
          say(TEXT.sent(printer, body.bytes, body.copies || copies));
        } else {
          say(`${(body && body.message) || TEXT.failed}${body && body.error ? ` (${body.error})` : ''}`);
        }
      } catch (error) {
        showDown(TEXT.downHelp);
        say('No se pudo enviar: el agente no responde. Use Descargar como alternativa.');
      } finally {
        sending = false;
        refreshButton();
      }
    }

    /** Changes the agent address (remembered in the browser) and checks it again. Returns false when it is not an http(s) URL. */
    function setUrl(value) {
      const text = String(value).trim().replace(/\/+$/, '');
      let parsed = null;
      try { parsed = new URL(text); } catch (error) { parsed = null; }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        say(TEXT.badUrl);
        els.url.value = agentUrl;
        return false;
      }
      agentUrl = text;
      els.url.value = text;
      write(URL_KEY, text);
      check();
      return true;
    }

    els.printer.addEventListener('change', () => { if (els.printer.value) write(PRINTER_KEY, els.printer.value); refreshButton(); });
    els.print.addEventListener('click', print);
    els.retry.addEventListener('click', check);
    els.url.addEventListener('change', () => setUrl(els.url.value));

    check();
    return Object.freeze({ els, check, print, setUrl, url: () => agentUrl });
  }

  PB.ui = PB.ui || {};
  PB.ui.createPrintPanel = createPrintPanel;
  PB.ui.PRINT_DEFAULT_URL = DEFAULT_URL;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
