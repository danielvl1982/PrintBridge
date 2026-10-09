const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUpTo, manifest } = require('./helpers/load');

// The "Impresión" panel (js/print-panel.js) on a minimal fake DOM, a fake fetch and a fake storage.
const PB = loadUpTo('js/print-panel.js');

const ROOT = path.join(__dirname, '..');
const PRINTERS = [
  { name: 'TEC B-EV4', isDefault: false, status: 'ready' },
  { name: 'Zebra ZD420', isDefault: true, status: 'ready' },
  { name: 'TSC TE200', isDefault: false, status: 'offline' },
];

function fakeElement(tagName) {
  const listeners = {};
  const el = {
    tagName: String(tagName).toUpperCase(), children: [], value: '', textContent: '', className: '', disabled: false, hidden: false,
    append(...nodes) { el.children.push(...nodes); },
    appendChild(node) { el.children.push(node); return node; },
    replaceChildren(...nodes) { el.children = [...nodes]; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { return Promise.all((listeners[type] || []).map(fn => fn())); },
  };
  return el;
}

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake fetch: `handlers` maps "METHOD path" to a function(url, init) -> response (or throws); records every call. */
function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.pathname}`;
    calls.push({ url, key, init, query: u.searchParams });
    if (!handlers[key]) throw new TypeError('Failed to fetch');
    return handlers[key](url, init);
  };
  fn.calls = calls;
  return fn;
}

const healthy = (extra = {}) => ({
  'GET /health': () => response(200, { ok: true, version: '1.0.0', platform: 'win32' }),
  'GET /printers': () => response(200, { printers: PRINTERS }),
  'POST /print': (url, init) => response(200, { ok: true, bytes: init.body.length, copies: Number(new URL(url).searchParams.get('copies')) }),
  ...extra,
});

/** Builds a panel on a fake document; resolves once its first check has finished. */
async function withPanel(options, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => fakeElement(tag) } });
  try {
    const root = fakeElement('section');
    const storage = options.storage || fakeStorage();
    const panel = PB.ui.createPrintPanel({
      root, getBytes: options.getBytes || (() => Uint8Array.from([1, 2, 3])), fetch: options.fetch, storage, onMessage: options.onMessage,
    });
    await new Promise(resolve => setImmediate(resolve));
    await fn({ panel, els: panel.els, root, storage });
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
}

test('the panel starts "Comprobando" and has the Impresión title', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetch = async () => { await gate; return response(200, { ok: true, version: '1.0.0' }); };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => fakeElement(tag) } });
  try {
    const root = fakeElement('section');
    const panel = PB.ui.createPrintPanel({ root, getBytes: () => new Uint8Array(1), fetch, storage: fakeStorage() });
    assert.equal(root.children[0].tagName, 'H2');
    assert.equal(root.children[0].textContent, 'Impresión');
    assert.match(panel.els.status.textContent, /Comprobando/);
    assert.ok(panel.els.print.disabled);
    release();
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
});

test('agent up: shows "conectado vX", lists the printers and preselects the default one', async () => {
  const fetch = fakeFetch(healthy());
  await withPanel({ fetch }, ({ els }) => {
    assert.equal(els.status.textContent, 'Agente conectado v1.0.0');
    assert.match(els.status.className, /is-ok/);
    assert.deepEqual(els.printer.children.map(o => o.value), ['TEC B-EV4', 'Zebra ZD420', 'TSC TE200']);
    assert.match(els.printer.children[1].textContent, /predeterminada/);
    assert.match(els.printer.children[2].textContent, /sin conexión/);
    assert.equal(els.printer.value, 'Zebra ZD420');
    assert.equal(els.print.disabled, false);
    assert.equal(els.help.hidden, true);
    assert.equal(fetch.calls[0].url, 'http://127.0.0.1:9631/health');
  });
});

test('the remembered printer wins over the default one; an unknown remembered one is ignored', async () => {
  await withPanel({ fetch: fakeFetch(healthy()), storage: fakeStorage({ 'printbridge.printer': 'TEC B-EV4' }) }, ({ els }) => {
    assert.equal(els.printer.value, 'TEC B-EV4');
  });
  await withPanel({ fetch: fakeFetch(healthy()), storage: fakeStorage({ 'printbridge.printer': 'Gone' }) }, ({ els }) => {
    assert.equal(els.printer.value, 'Zebra ZD420');
  });
});

test('choosing a printer remembers it', async () => {
  await withPanel({ fetch: fakeFetch(healthy()) }, async ({ els, storage }) => {
    els.printer.value = 'TSC TE200';
    await els.printer.fire('change');
    assert.equal(storage.data['printbridge.printer'], 'TSC TE200');
  });
});

test('without a default printer the first one is selected', async () => {
  const list = PRINTERS.map(p => ({ ...p, isDefault: false }));
  await withPanel({ fetch: fakeFetch(healthy({ 'GET /printers': () => response(200, { printers: list }) })) }, ({ els }) => {
    assert.equal(els.printer.value, 'TEC B-EV4');
  });
});

test('agent down (fetch fails): says "no disponible", explains in Spanish, links the instructions and keeps Imprimir off', async () => {
  await withPanel({ fetch: fakeFetch({}) }, ({ els }) => {
    assert.match(els.status.textContent, /no disponible/);
    assert.match(els.status.className, /is-down/);
    assert.equal(els.help.hidden, false);
    assert.match(els.help.children[0], /Descargar/);
    assert.match(els.help.children[1].href, /agent\/README\.md$/);
    assert.equal(els.print.disabled, true);
    assert.equal(els.printer.disabled, true);
  });
});

test('agent answering origin_refused: says which setting to review', async () => {
  const fetch = fakeFetch({ 'GET /health': () => response(403, { ok: false, error: 'origin_refused', message: 'x' }) });
  await withPanel({ fetch }, ({ els }) => {
    assert.match(els.status.textContent, /no disponible/);
    assert.match(els.help.children[0], /allowedOrigins/);
    assert.equal(els.print.disabled, true);
  });
});

test('no printers installed: connected, but Imprimir stays off and a message says so', async () => {
  await withPanel({ fetch: fakeFetch(healthy({ 'GET /printers': () => response(200, { printers: [] }) })) }, ({ els }) => {
    assert.match(els.status.textContent, /conectado/);
    assert.equal(els.print.disabled, true);
    assert.match(els.message.textContent, /ninguna impresora/);
  });
});

test('a failing /printers shows the agent message and keeps Imprimir off', async () => {
  const fetch = fakeFetch(healthy({ 'GET /printers': () => response(502, { ok: false, error: 'spooler_error', message: 'El sistema de impresión falló' }) }));
  await withPanel({ fetch }, ({ els }) => {
    assert.equal(els.print.disabled, true);
    assert.equal(els.message.textContent, 'El sistema de impresión falló');
  });
});

test('Imprimir sends exactly the bytes (0x00, 0x0D, 0xFF) as an octet-stream POST with printer and copies', async () => {
  const bytes = Uint8Array.from([0x53, 0x00, 0x0D, 0x0A, 0xFF, 0x80]);
  const fetch = fakeFetch(healthy());
  const messages = [];
  await withPanel({ fetch, getBytes: () => bytes, onMessage: m => messages.push(m) }, async ({ els }) => {
    els.copies.value = '3';
    await els.print.fire('click');
    const post = fetch.calls.find(c => c.key === 'POST /print');
    assert.equal(post.init.headers['Content-Type'], 'application/octet-stream');
    assert.equal(post.query.get('printer'), 'Zebra ZD420');
    assert.equal(post.query.get('copies'), '3');
    assert.strictEqual(post.init.body, bytes);
    assert.equal(els.message.textContent, 'Enviado a "Zebra ZD420": 6 bytes, 3 copias');
    assert.ok(messages.includes(els.message.textContent));
    assert.equal(els.print.disabled, false);
  });
});

test('Imprimir encodes a printer name with quotes and spaces, and remembers the printer that worked', async () => {
  const list = [{ name: 'Zebra "ZD" 420 & co', isDefault: true, status: 'ready' }];
  const fetch = fakeFetch(healthy({ 'GET /printers': () => response(200, { printers: list }) }));
  await withPanel({ fetch }, async ({ els, storage }) => {
    await els.print.fire('click');
    const post = fetch.calls.find(c => c.key === 'POST /print');
    assert.match(post.url, /printer=Zebra%20%22ZD%22%20420%20%26%20co&copies=1$/);
    assert.equal(storage.data['printbridge.printer'], 'Zebra "ZD" 420 & co');
  });
});

test('bad copies (0, 100, 1.5, empty, text) are refused before any request', async () => {
  const fetch = fakeFetch(healthy());
  await withPanel({ fetch }, async ({ els }) => {
    for (const value of ['0', '100', '1.5', '', 'abc', '-2']) {
      els.copies.value = value;
      await els.print.fire('click');
      assert.match(els.message.textContent, /entre 1 y 99/, `copies=${value}`);
    }
    assert.equal(fetch.calls.filter(c => c.key === 'POST /print').length, 0);
  });
});

test('a label that cannot be prepared (getBytes throws) says why and sends nothing', async () => {
  const fetch = fakeFetch(healthy());
  await withPanel({ fetch, getBytes: () => { throw new Error('No hay etiqueta que imprimir: el editor está vacío'); } }, async ({ els }) => {
    await els.print.fire('click');
    assert.equal(els.message.textContent, 'No hay etiqueta que imprimir: el editor está vacío');
    assert.equal(fetch.calls.filter(c => c.key === 'POST /print').length, 0);
  });
});

test('agent errors (printer_not_found, too_large, spooler_error, origin_refused) show the agent message and the code', async () => {
  const cases = [
    [404, 'printer_not_found', 'La impresora no existe en este equipo'],
    [413, 'too_large', 'Los datos son demasiado grandes'],
    [502, 'spooler_error', 'El sistema de impresión no pudo completar la operación'],
    [403, 'origin_refused', 'Origen no permitido'],
  ];
  for (const [status, error, message] of cases) {
    const fetch = fakeFetch(healthy({ 'POST /print': () => response(status, { ok: false, error, message }) }));
    await withPanel({ fetch }, async ({ els }) => {
      await els.print.fire('click');
      assert.equal(els.message.textContent, `${message} (${error})`);
      assert.equal(els.print.disabled, false);
      assert.match(els.status.textContent, /conectado/);
    });
  }
});

test('a network failure while printing marks the agent as down and points to Descargar', async () => {
  const fetch = fakeFetch(healthy({ 'POST /print': () => { throw new TypeError('Failed to fetch'); } }));
  await withPanel({ fetch }, async ({ els }) => {
    await els.print.fire('click');
    assert.match(els.status.textContent, /no disponible/);
    assert.match(els.message.textContent, /Descargar/);
    assert.equal(els.print.disabled, true);
  });
});

test('Imprimir is disabled while a job is in flight and a second click does not send twice', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetch = fakeFetch(healthy({ 'POST /print': async () => { await gate; return response(200, { ok: true, bytes: 3, copies: 1 }); } }));
  await withPanel({ fetch }, async ({ els }) => {
    const first = els.print.fire('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(els.print.disabled, true);
    await els.print.fire('click');
    release();
    await first;
    assert.equal(fetch.calls.filter(c => c.key === 'POST /print').length, 1);
    assert.equal(els.print.disabled, false);
  });
});

test('Reintentar checks the agent again: down, then up', async () => {
  let up = false;
  const fetch = fakeFetch({
    'GET /health': () => { if (!up) throw new TypeError('Failed to fetch'); return response(200, { ok: true, version: '2.0.0' }); },
    'GET /printers': () => response(200, { printers: PRINTERS }),
  });
  await withPanel({ fetch }, async ({ els }) => {
    assert.match(els.status.textContent, /no disponible/);
    up = true;
    await els.retry.fire('click');
    assert.equal(els.status.textContent, 'Agente conectado v2.0.0');
    assert.equal(els.print.disabled, false);
    assert.equal(els.help.hidden, true);
  });
});

test('the agent URL defaults to http://127.0.0.1:9631, can be changed, is remembered and checked again', async () => {
  const fetch = fakeFetch(healthy());
  await withPanel({ fetch }, async ({ panel, els, storage }) => {
    assert.equal(panel.url(), 'http://127.0.0.1:9631');
    assert.equal(els.url.value, 'http://127.0.0.1:9631');
    els.url.value = ' http://localhost:9700/ ';
    await els.url.fire('change');
    assert.equal(panel.url(), 'http://localhost:9700');
    assert.equal(els.url.value, 'http://localhost:9700');
    assert.equal(storage.data['printbridge.agentUrl'], 'http://localhost:9700');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fetch.calls.at(-2).url, 'http://localhost:9700/health');
  });
});

test('a stored agent URL is used from the start', async () => {
  const fetch = fakeFetch(healthy());
  await withPanel({ fetch, storage: fakeStorage({ 'printbridge.agentUrl': 'http://127.0.0.1:9800' }) }, ({ els }) => {
    assert.equal(fetch.calls[0].url, 'http://127.0.0.1:9800/health');
    assert.equal(els.url.value, 'http://127.0.0.1:9800');
  });
});

test('an invalid agent URL is refused: the old one stays and a message says so', async () => {
  const fetch = fakeFetch(healthy());
  await withPanel({ fetch }, async ({ panel, els, storage }) => {
    for (const bad of ['nonsense', 'ftp://127.0.0.1', '']) {
      els.url.value = bad;
      await els.url.fire('change');
      assert.equal(panel.url(), 'http://127.0.0.1:9631', bad);
      assert.equal(els.url.value, 'http://127.0.0.1:9631');
      assert.match(els.message.textContent, /no es válida/);
    }
    assert.equal(storage.data['printbridge.agentUrl'], undefined);
  });
});

test('a storage that throws never breaks the panel', async () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  await withPanel({ fetch: fakeFetch(healthy()), storage }, async ({ els }) => {
    assert.equal(els.printer.value, 'Zebra ZD420');
    els.printer.value = 'TEC B-EV4';
    await els.printer.fire('change');
    await els.print.fire('click');
    assert.match(els.message.textContent, /^Enviado a "TEC B-EV4"/);
  });
});

// ---- Wiring: index.html, manifest and app.js ----------------------------------------------------------------------------

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('index.html has the collapsible Impresión section under Convertir, and loads js/print-panel.js between convert-panel and collapse', () => {
  assert.match(html, /<section class="panel convert" id="convert" data-collapsible="convert"><\/section>\s*<section class="panel convert" id="print" data-collapsible="print"><\/section>/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(scripts.indexOf('js/print-panel.js') === scripts.indexOf('js/convert-panel.js') + 1);
  assert.ok(scripts.indexOf('js/print-panel.js') < scripts.indexOf('js/collapse.js'));
});

test('the manifest and index.html list the same scripts in the same order, print panel included', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.deepEqual(scripts, manifest());
  assert.ok(manifest().includes('js/print-panel.js'));
});

test('js/app.js sends the editor text in its own language through PB.convert.toBytes (the bytes Descargar writes)', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(app, /createPrintPanel\(\{ root: \$\('print'\), getBytes: labelBytes \}\)/);
  assert.match(app, /PB\.convert\.toBytes\(text, language\.id\)/);
});
