/**
 * "Impresión" panel (PB.ui.createPrintPanel): sends the label to a printer through the local PrintBridge agent
 * (agent/printbridge-agent.js, HTTP on 127.0.0.1). It shows the agent status (comprobando / conectado vX / no disponible), a mode
 * select, a printer select loaded from `GET /printers` (the last chosen printer is remembered, else the Windows default one), the
 * copies, an Imprimir button, and a settings row with the agent URL and Reintentar. When the agent does not answer it says so in
 * Spanish and points to the install instructions; Descargar (panel Convertir) stays as the fallback.
 * Two modes ("Modo"):
 *  - "Etiquetera (código)": the label code is sent RAW (POST /print), the bytes Descargar writes.
 *  - "Driver (imagen)": the drawing the viewer shows is rendered to a PNG at a resolution (Resolución 203 / 300 / 600 ppp) with the
 *    real size in mm and posted to POST /print-image, so the Windows driver prints it (Papel, Desplazamiento X / Y in mm to
 *    compensate the printer's non printable margin). A line shows the page size in mm and the PNG size in pixels.
 * The mode, resolution, paper, offsets, printer and agent address are remembered in the browser (localStorage); copies are not.
 * It builds its own controls inside `root` and reads the label through callbacks, so it knows nothing about the editor.
 *   createPrintPanel({ root, getBytes, getLabel?, renderPng?, fetch?, storage?, onMessage? })
 *     getBytes():       the bytes to print RAW (Uint8Array, exactly what Descargar writes); may throw an Error with a Spanish message
 *     getLabel():       { svg, widthMm, heightMm } of the label the viewer draws (Driver mode); may throw an Error with a Spanish message
 *     renderPng(args):  PNG Blob for { svg, widthMm, heightMm, dpi } (default PB.renderExport.toPng); the tests pass a fake
 *     fetch:            fetch-compatible function (default globalThis.fetch); the tests pass a fake
 *     storage:          localStorage-like { getItem, setItem } (default globalThis.localStorage, guarded); the tests pass a fake
 *     onMessage(text):  optional, notified of every status line the panel shows
 * Returns { els, check, print, setUrl, url, refreshInfo }; `els` are the controls (the tests drive them). refreshInfo() recomputes the
 * size line after the label changed.
 * The pure parts of the Driver mode (request, messages, size line) are PB.ui.printImage and need PB.renderExport (js/render-export.js).
 */
(function (PB) {
  'use strict';

  const DEFAULT_URL = 'http://127.0.0.1:9631';
  const URL_KEY = 'printbridge.agentUrl';
  const PRINTER_KEY = 'printbridge.printer';
  const MODE_KEY = 'printbridge.printMode';
  const DPI_KEY = 'printbridge.imageDpi';
  const PAPER_KEY = 'printbridge.imagePaper';
  const OFFSET_X_KEY = 'printbridge.imageOffsetX';
  const OFFSET_Y_KEY = 'printbridge.imageOffsetY';
  const MAX_COPIES = 99;
  const MAX_OFFSET_MM = 100;
  const IMAGE_DPIS = Object.freeze([203, 300, 600]);
  const DEFAULT_DPI = 300;
  const PAPERS = Object.freeze([
    { value: 'default', text: 'Predeterminado del driver' },
    { value: 'label', text: 'Tamaño de la etiqueta' },
  ]);
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
    preparing: 'Preparando la imagen…',
    noLabel: 'No hay etiqueta que imprimir',
    badPaper: 'El papel no es válido',
    offsetTip: 'Compense el margen no imprimible de la impresora',
    badOffset: label => `${label}: escriba un número entre -${MAX_OFFSET_MM} y ${MAX_OFFSET_MM} (mm)`,
    imageSent: (printer, bytes, size, dpi, copies) => `Imagen enviada a "${printer}": ${bytes} bytes, ${size.width} × ${size.height} px a ${dpi} ppp${copies > 1 ? `, ${copies} copias` : ''}`,
    // One Spanish message per agent error code of POST /print-image; "detail" is the agent's own explanation
    imageErrors: {
      not_png: () => 'El agente no recibió una imagen PNG válida',
      too_large: () => 'La imagen es demasiado grande para el agente (límite de imagen)',
      spooler_error: detail => `El sistema de impresión no pudo imprimir la imagen${detail ? `: ${detail}` : ''}`,
      printer_not_found: () => 'La impresora no existe en este equipo',
      origin_refused: () => 'El agente no permite esta página (origen no autorizado): revise "allowedOrigins" en agent/config.json',
      bad_request: detail => `Petición no válida${detail ? `: ${detail}` : ''}`,
    },
  };

  // ---- Driver (imagen): pure helpers (no DOM), tested under node ----

  const formatMm = value => String(Number(value.toFixed(1))).replace('.', ',');

  /** A decimal typed in a field ("2", "-1.5", "3,5") as a number within +-MAX_OFFSET_MM, or null. */
  function parseOffset(text) {
    const clean = String(text).trim().replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;
    const value = Number(clean);
    return Math.abs(value) <= MAX_OFFSET_MM ? value : null;
  }

  /** "Página 100 × 60 mm, imagen 1181 × 709 px", or the Spanish error of PB.renderExport.pixelSize: { ok, text, pixels? }. */
  function pageInfo(widthMm, heightMm, dpi) {
    try {
      const pixels = PB.renderExport.pixelSize(widthMm, heightMm, dpi);
      return { ok: true, pixels, text: `Página ${formatMm(widthMm)} × ${formatMm(heightMm)} mm, imagen ${pixels.width} × ${pixels.height} px` };
    } catch (error) {
      return { ok: false, text: error.message };
    }
  }

  /**
   * What POST /print-image needs for these panel values (offsets are the typed text): { ok: true, path, query, url, headers, pixels },
   * or { ok: false, error } with a Spanish message. Nothing is sent when it is not ok.
   */
  function imageRequest({ printer, widthMm, heightMm, dpi, paper, offsetX, offsetY, copies }) {
    const fail = error => ({ ok: false, error });
    if (!printer) return fail(TEXT.noPrinter);
    if (!PAPERS.some(p => p.value === paper)) return fail(TEXT.badPaper);
    const info = pageInfo(widthMm, heightMm, dpi);
    if (!info.ok) return fail(info.text);
    const offsetXmm = parseOffset(offsetX);
    if (offsetXmm === null) return fail(TEXT.badOffset('Desplazamiento X'));
    const offsetYmm = parseOffset(offsetY);
    if (offsetYmm === null) return fail(TEXT.badOffset('Desplazamiento Y'));
    if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) return fail(TEXT.badCopies);
    let query;
    try {
      query = PB.renderExport.imageQuery({ printer, widthMm, heightMm, dpi, offsetXmm, offsetYmm, copies, paper });
    } catch (error) {
      return fail(error.message);
    }
    const path = '/print-image';
    return { ok: true, path, query, url: `${path}?${query}`, headers: { 'Content-Type': 'image/png' }, pixels: info.pixels };
  }

  /** The Spanish message for an agent error body ({ error, message, detail }), ending with the code like the RAW mode does. */
  function imageErrorMessage(body) {
    const code = body && body.error;
    const make = code && TEXT.imageErrors[code];
    const text = make ? make(body.detail) : (body && body.message) || TEXT.failed;
    return `${text}${code ? ` (${code})` : ''}`;
  }

  function defaultStorage() {
    try { return globalThis.localStorage || null; } catch (e) { return null; }
  }

  function createPrintPanel({ root, getBytes, getLabel = null, renderPng = args => PB.renderExport.toPng(args), fetch: fetchFn = globalThis.fetch && globalThis.fetch.bind(globalThis), storage = defaultStorage(), onMessage = () => {} }) {
    const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
    const read = key => { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } };
    const write = (key, value) => { try { if (storage) storage.setItem(key, value); } catch (e) { /* storage unavailable: just not remembered */ } };
    const option = (value, textContent) => make('option', { value, textContent });

    const els = {
      status: make('span', { className: 'print-status is-checking', textContent: TEXT.checking }),
      mode: make('select', { title: 'Etiquetera: se envía el código de la etiqueta tal cual. Driver: se imprime el dibujo por el driver de Windows.' }),
      printer: make('select', { disabled: true }),
      copies: make('input', { type: 'number', min: '1', max: String(MAX_COPIES), step: '1', value: '1' }),
      print: make('button', { textContent: 'Imprimir', type: 'button', disabled: true }),
      dpi: make('select'),
      paper: make('select'),
      offsetX: make('input', { type: 'number', min: String(-MAX_OFFSET_MM), max: String(MAX_OFFSET_MM), step: '0.1', value: '0' }),
      offsetY: make('input', { type: 'number', min: String(-MAX_OFFSET_MM), max: String(MAX_OFFSET_MM), step: '0.1', value: '0' }),
      pageInfo: make('p', { className: 'print-info' }),
      offsetTip: make('p', { className: 'print-info print-tip', textContent: TEXT.offsetTip }),
      message: make('p', { className: 'print-message' }),
      help: make('p', { className: 'print-help', hidden: true }),
      helpLink: make('a', { href: HELP_URL, target: '_blank', rel: 'noopener', textContent: TEXT.helpLink }),
      url: make('input', { type: 'text', value: '', spellcheck: false, title: 'Dirección del agente de impresión' }),
      retry: make('button', { textContent: 'Reintentar', type: 'button' }),
    };
    els.mode.replaceChildren(option('raw', 'Etiquetera (código)'), option('image', 'Driver (imagen)'));
    els.dpi.replaceChildren(...IMAGE_DPIS.map(dpi => option(String(dpi), `${dpi} ppp`)));
    els.paper.replaceChildren(...PAPERS.map(p => option(p.value, p.text)));

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
    els.imageOptions = row(
      field('Resolución', els.dpi), field('Papel', els.paper), field('Desplazamiento X (mm)', els.offsetX), field('Desplazamiento Y (mm)', els.offsetY),
    );
    els.imageInfo = make('div', { className: 'print-image-info' });
    els.imageInfo.replaceChildren(els.pageInfo, els.offsetTip);
    root.replaceChildren(
      make('h2', { textContent: 'Impresión' }),
      row(els.status),
      row(field('Modo', els.mode), field('Impresora', els.printer), field('Copias', els.copies), els.print),
      els.imageOptions,
      els.imageInfo,
      els.message,
      els.help,
      row(field('Agente', els.url), els.retry),
    );

    // Remembered preferences; a stored value that is not valid any more falls back to the default
    const storedChoice = (key, valid, fallback) => { const v = read(key); return valid(v) ? v : fallback; };
    els.mode.value = storedChoice(MODE_KEY, v => v === 'raw' || v === 'image', 'raw');
    els.dpi.value = storedChoice(DPI_KEY, v => IMAGE_DPIS.map(String).includes(v), String(DEFAULT_DPI));
    els.paper.value = storedChoice(PAPER_KEY, v => PAPERS.some(p => p.value === v), 'default');
    els.offsetX.value = storedChoice(OFFSET_X_KEY, v => v !== null && parseOffset(v) !== null, '0');
    els.offsetY.value = storedChoice(OFFSET_Y_KEY, v => v !== null && parseOffset(v) !== null, '0');

    let agentUrl = read(URL_KEY) || DEFAULT_URL;
    els.url.value = agentUrl;
    let connected = false;
    let checkId = 0;
    let sending = false;
    let infoOk = true;

    const isImage = () => els.mode.value === 'image';
    const say = text => { els.message.textContent = text; if (text) onMessage(text); };
    const refreshButton = () => { els.print.disabled = !connected || sending || !els.printer.value || (isImage() && !infoOk); };

    /** Shows or hides the Driver controls and recomputes the size line (page in mm, PNG in px, or the limit error). */
    function refreshInfo() {
      const image = isImage();
      els.imageOptions.hidden = !image;
      els.imageInfo.hidden = !image;
      infoOk = true;
      if (image) {
        let text;
        try {
          const label = getLabel ? getLabel() : null;
          if (!label) throw new Error(TEXT.noLabel);
          const info = pageInfo(label.widthMm, label.heightMm, Number(els.dpi.value));
          infoOk = info.ok;
          text = info.text;
        } catch (error) {
          infoOk = false;
          text = (error && error.message) || TEXT.noLabel;
        }
        els.pageInfo.textContent = text;
      }
      refreshButton();
    }

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

    /** POSTs `body` to the agent; resolves { done, body } (done: the agent answered ok:true). Rejects when the agent cannot be reached. */
    async function post(pathAndQuery, contentType, body) {
      const response = await fetchFn(`${agentUrl}${pathAndQuery}`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
      let json = null;
      try { json = await response.json(); } catch (error) { json = null; }
      return { done: Boolean(response.ok && json && json.ok === true), body: json };
    }

    const readCopies = () => {
      const copiesText = String(els.copies.value).trim();
      return /^\d{1,3}$/.test(copiesText) ? Number(copiesText) : 0;
    };

    /** Runs a send: the Imprimir button stays off while it works, and an unreachable agent turns the panel "no disponible". */
    async function send(work) {
      sending = true;
      refreshButton();
      try {
        await work();
      } catch (error) {
        showDown(TEXT.downHelp);
        say('No se pudo enviar: el agente no responde. Use Descargar como alternativa.');
      } finally {
        sending = false;
        refreshButton();
      }
    }

    /** Sends the label bytes RAW to the chosen printer. */
    async function printRaw() {
      const printer = els.printer.value;
      if (!printer) { say(TEXT.noPrinter); return; }
      const copies = readCopies();
      if (copies < 1 || copies > MAX_COPIES) { say(TEXT.badCopies); return; }
      let bytes;
      try {
        bytes = getBytes();
      } catch (error) {
        say((error && error.message) || 'No se pudo preparar la etiqueta');
        return;
      }
      say(TEXT.sending);
      await send(async () => {
        const { done, body } = await post(`/print?printer=${encodeURIComponent(printer)}&copies=${copies}`, 'application/octet-stream', bytes);
        if (done) {
          write(PRINTER_KEY, printer);
          say(TEXT.sent(printer, body.bytes, body.copies || copies));
        } else {
          say(`${(body && body.message) || TEXT.failed}${body && body.error ? ` (${body.error})` : ''}`);
        }
      });
    }

    /** Renders the label to a PNG at the chosen resolution and sends it to the chosen printer to be printed through its driver. */
    async function printImage() {
      let label;
      try {
        label = getLabel ? getLabel() : null;
      } catch (error) {
        say((error && error.message) || TEXT.noLabel);
        return;
      }
      if (!label) { say(TEXT.noLabel); return; }
      const dpi = Number(els.dpi.value);
      const request = imageRequest({
        printer: els.printer.value, widthMm: label.widthMm, heightMm: label.heightMm, dpi, paper: els.paper.value,
        offsetX: els.offsetX.value, offsetY: els.offsetY.value, copies: readCopies(),
      });
      if (!request.ok) { say(request.error); return; }
      sending = true;
      refreshButton();
      say(TEXT.preparing);
      let png;
      try {
        png = await renderPng({ svg: label.svg, widthMm: label.widthMm, heightMm: label.heightMm, dpi });
      } catch (error) {
        sending = false;
        refreshButton();
        say((error && error.message) || 'No se pudo preparar la imagen');
        return;
      }
      sending = false;
      say(TEXT.sending);
      await send(async () => {
        const { done, body } = await post(request.url, request.headers['Content-Type'], png);
        if (done) {
          write(PRINTER_KEY, els.printer.value);
          say(TEXT.imageSent(els.printer.value, body.bytes, request.pixels, dpi, body.copies || readCopies()));
        } else {
          say(imageErrorMessage(body));
        }
      });
    }

    /** Sends the label to the chosen printer in the chosen mode. */
    async function print() {
      if (sending) return;
      if (!els.printer.value) { say(TEXT.noPrinter); return; }
      return isImage() ? printImage() : printRaw();
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
    els.mode.addEventListener('change', () => { write(MODE_KEY, els.mode.value); say(''); refreshInfo(); });
    els.dpi.addEventListener('change', () => { write(DPI_KEY, els.dpi.value); refreshInfo(); });
    els.paper.addEventListener('change', () => write(PAPER_KEY, els.paper.value));
    els.offsetX.addEventListener('change', () => { if (parseOffset(els.offsetX.value) !== null) write(OFFSET_X_KEY, els.offsetX.value); });
    els.offsetY.addEventListener('change', () => { if (parseOffset(els.offsetY.value) !== null) write(OFFSET_Y_KEY, els.offsetY.value); });
    els.print.addEventListener('click', print);
    els.retry.addEventListener('click', check);
    els.url.addEventListener('change', () => setUrl(els.url.value));

    refreshInfo();
    check();
    return Object.freeze({ els, check, print, setUrl, url: () => agentUrl, refreshInfo });
  }

  PB.ui = PB.ui || {};
  PB.ui.createPrintPanel = createPrintPanel;
  PB.ui.printImage = Object.freeze({ request: imageRequest, pageInfo, errorMessage: imageErrorMessage, parseOffset });
  PB.ui.PRINT_DEFAULT_URL = DEFAULT_URL;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
