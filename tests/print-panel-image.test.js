const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUpTo } = require('./helpers/load');

// The "Driver (imagen)" mode of the Impresión panel (js/print-panel.js): pure request / message helpers and the panel on a fake DOM.
const PB = loadUpTo('js/render-export.js');
const ROOT = path.join(__dirname, '..');
const PRINTERS = [
  { name: 'Laser HP', isDefault: false, status: 'ready' },
  { name: 'Zebra ZD420', isDefault: true, status: 'ready' },
];
const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: 'image/png' });

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
  'GET /health': () => response(200, { ok: true, version: '1.1.0' }),
  'GET /printers': () => response(200, { printers: PRINTERS }),
  'POST /print': (url, init) => response(200, { ok: true, bytes: init.body.length, copies: 1 }),
  'POST /print-image': url => response(200, { ok: true, bytes: PNG.size, copies: Number(new URL(url).searchParams.get('copies')) }),
  ...extra,
});

async function withPanel(options, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => fakeElement(tag) } });
  try {
    const root = fakeElement('section');
    const storage = options.storage || fakeStorage();
    const renders = [];
    const panel = PB.ui.createPrintPanel({
      root, getBytes: options.getBytes || (() => Uint8Array.from([1, 2, 3])), fetch: options.fetch, storage,
      getLabel: options.getLabel || (() => ({ svg: '<svg/>', widthMm: 100, heightMm: 60 })),
      renderPng: options.renderPng || (async args => { renders.push(args); return PNG; }),
    });
    await new Promise(resolve => setImmediate(resolve));
    await fn({ panel, els: panel.els, storage, renders });
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
}

const BASE = { printer: 'Laser HP', widthMm: 100, heightMm: 60, dpi: 300, paper: 'default', offsetX: '0', offsetY: '0', copies: 1 };

// ---- pure helpers ----

test('request: builds the path, the query and the PNG header from the panel values', () => {
  const r = PB.ui.printImage.request({ ...BASE, dpi: 600, offsetX: '2', offsetY: '3,5', copies: 2, paper: 'label' });
  assert.equal(r.ok, true);
  assert.equal(r.path, '/print-image');
  const q = new URLSearchParams(r.query);
  assert.deepEqual(Object.fromEntries(q), { printer: 'Laser HP', widthMm: '100', heightMm: '60', dpi: '600', offsetXmm: '2', offsetYmm: '3.5', copies: '2', paper: 'label' });
  assert.equal(r.url, `/print-image?${r.query}`);
  assert.deepEqual(r.headers, { 'Content-Type': 'image/png' });
  assert.deepEqual(r.pixels, { width: 2362, height: 1417 });
});

test('request: Spanish validation errors, no request', () => {
  const bad = patch => PB.ui.printImage.request({ ...BASE, ...patch });
  assert.match(bad({ printer: '' }).error, /impresora/i);
  assert.match(bad({ offsetX: 'abc' }).error, /Desplazamiento X.*-100.*100/);
  assert.match(bad({ offsetY: '101' }).error, /Desplazamiento Y/);
  assert.match(bad({ offsetY: '' }).error, /Desplazamiento Y/);
  assert.match(bad({ copies: 0 }).error, /Copias/);
  assert.match(bad({ copies: 100 }).error, /Copias/);
  assert.match(bad({ dpi: 50 }).error, /resoluci/i);
  assert.match(bad({ paper: 'x' }).error, /papel/i);
  assert.match(bad({ widthMm: 0 }).error, /tamaño/);
  assert.match(bad({ widthMm: 500, heightMm: 500, dpi: 600 }).error, /supera/);
  assert.equal(bad({ printer: '' }).ok, false);
});

test('pageInfo: page size in mm and PNG size, or the pixelSize error', () => {
  assert.equal(PB.ui.printImage.pageInfo(100, 60, 300).text, 'Página 100 × 60 mm, imagen 1181 × 709 px');
  assert.equal(PB.ui.printImage.pageInfo(100.1, 60, 300).text, 'Página 100,1 × 60 mm, imagen 1182 × 709 px');
  const tooBig = PB.ui.printImage.pageInfo(500, 500, 600);
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.text, /supera/);
  assert.equal(PB.ui.printImage.pageInfo(null, null, 300).ok, false);
});

test('errorMessage: every agent code has its Spanish message', () => {
  const m = (error, extra = {}) => PB.ui.printImage.errorMessage({ ok: false, error, message: 'agent text', ...extra });
  assert.equal(m('not_png'), 'El agente no recibió una imagen PNG válida (not_png)');
  assert.equal(m('too_large'), 'La imagen es demasiado grande para el agente (límite de imagen) (too_large)');
  assert.equal(m('spooler_error', { detail: 'Printer offline' }), 'El sistema de impresión no pudo imprimir la imagen: Printer offline (spooler_error)');
  assert.equal(m('spooler_error'), 'El sistema de impresión no pudo imprimir la imagen (spooler_error)');
  assert.match(m('origin_refused'), /origen no autorizado.*\(origin_refused\)/);
  assert.equal(m('printer_not_found'), 'La impresora no existe en este equipo (printer_not_found)');
  assert.match(m('bad_request', { detail: 'copies' }), /Petición no válida: copies \(bad_request\)/);
  assert.equal(m('weird'), 'agent text (weird)');
  assert.equal(PB.ui.printImage.errorMessage(null), 'El agente no pudo imprimir');
});

// ---- the panel ----

test('the mode select offers Etiquetera (código) and Driver (imagen); the image controls are hidden until the driver mode', async () => {
  await withPanel({ fetch: fakeFetch(healthy()) }, ({ els }) => {
    assert.deepEqual(els.mode.children.map(o => [o.value, o.textContent]), [['raw', 'Etiquetera (código)'], ['image', 'Driver (imagen)']]);
    assert.equal(els.mode.value, 'raw');
    assert.equal(els.imageOptions.hidden, true);
    assert.deepEqual(els.dpi.children.map(o => o.value), ['203', '300', '600']);
    assert.equal(els.dpi.value, '300');
    assert.deepEqual(els.paper.children.map(o => [o.value, o.textContent]), [['default', 'Predeterminado del driver'], ['label', 'Tamaño de la etiqueta']]);
    assert.equal(els.offsetX.value, '0');
    assert.equal(els.offsetX.min, '-100');
    assert.equal(els.offsetX.max, '100');
    assert.equal(els.offsetX.step, '0.1');
  });
});

test('switching to Driver (imagen) shows the options and the size line, and keeps the chosen printer', async () => {
  await withPanel({ fetch: fakeFetch(healthy()) }, async ({ els }) => {
    els.printer.value = 'Laser HP';
    els.mode.value = 'image';
    await els.mode.fire('change');
    assert.equal(els.imageOptions.hidden, false);
    assert.equal(els.printer.value, 'Laser HP');
    assert.equal(els.pageInfo.textContent, 'Página 100 × 60 mm, imagen 1181 × 709 px');
    els.dpi.value = '600';
    await els.dpi.fire('change');
    assert.equal(els.pageInfo.textContent, 'Página 100 × 60 mm, imagen 2362 × 1417 px');
    els.mode.value = 'raw';
    await els.mode.fire('change');
    assert.equal(els.imageOptions.hidden, true);
    assert.equal(els.printer.value, 'Laser HP');
  });
});

test('a label too big for the dpi shows the limit error and disables Imprimir; refreshInfo follows the label size', async () => {
  let size = { svg: '<svg/>', widthMm: 500, heightMm: 500 };
  await withPanel({ fetch: fakeFetch(healthy()), getLabel: () => size }, async ({ els, panel }) => {
    els.mode.value = 'image';
    els.dpi.value = '600';
    await els.mode.fire('change');
    assert.match(els.pageInfo.textContent, /supera/);
    assert.equal(els.print.disabled, true);
    size = { svg: '<svg/>', widthMm: 100, heightMm: 60 };
    panel.refreshInfo();
    assert.equal(els.print.disabled, false);
    assert.match(els.pageInfo.textContent, /2362 × 1417/);
  });
});

test('Imprimir in driver mode POSTs the PNG to /print-image with the query and image/png', async () => {
  const fetch = fakeFetch(healthy());
  await withPanel({ fetch }, async ({ els, renders, storage }) => {
    els.mode.value = 'image';
    await els.mode.fire('change');
    els.printer.value = 'Laser HP';
    els.dpi.value = '600';
    els.offsetX.value = '2';
    els.offsetY.value = '3';
    els.paper.value = 'label';
    els.copies.value = '2';
    await els.print.fire('click');
    const post = fetch.calls.find(c => c.key === 'POST /print-image');
    assert.ok(post);
    assert.equal(fetch.calls.some(c => c.key === 'POST /print'), false);
    assert.equal(post.init.headers['Content-Type'], 'image/png');
    assert.strictEqual(post.init.body, PNG);
    assert.deepEqual(Object.fromEntries(post.query), { printer: 'Laser HP', widthMm: '100', heightMm: '60', dpi: '600', offsetXmm: '2', offsetYmm: '3', copies: '2', paper: 'label' });
    assert.deepEqual(renders, [{ svg: '<svg/>', widthMm: 100, heightMm: 60, dpi: 600 }]);
    assert.equal(els.message.textContent, `Imagen enviada a "Laser HP": ${PNG.size} bytes, 2362 × 1417 px a 600 ppp, 2 copias`);
    assert.equal(storage.data['printbridge.printer'], 'Laser HP');
  });
});

test('every agent error code shows its Spanish message in driver mode', async () => {
  const cases = [
    [415, { ok: false, error: 'not_png', message: 'x' }, /El agente no recibió una imagen PNG válida/],
    [413, { ok: false, error: 'too_large', message: 'x' }, /límite de imagen/],
    [502, { ok: false, error: 'spooler_error', message: 'x', detail: 'No default printer' }, /imprimir la imagen: No default printer/],
    [404, { ok: false, error: 'printer_not_found', message: 'La impresora no existe en este equipo' }, /La impresora no existe/],
    [403, { ok: false, error: 'origin_refused', message: 'x' }, /origen no autorizado/],
    [400, { ok: false, error: 'bad_request', message: 'x', detail: 'dpi' }, /Petición no válida: dpi/],
  ];
  for (const [status, body, expected] of cases) {
    await withPanel({ fetch: fakeFetch(healthy({ 'POST /print-image': () => response(status, body) })) }, async ({ els }) => {
      els.mode.value = 'image';
      await els.mode.fire('change');
      await els.print.fire('click');
      assert.match(els.message.textContent, expected);
      assert.equal(els.print.disabled, false);
    });
  }
});

test('driver mode: a network failure, a render failure and invalid offsets send nothing or say so', async () => {
  await withPanel({ fetch: fakeFetch(healthy({ 'POST /print-image': () => { throw new TypeError('Failed to fetch'); } })) }, async ({ els }) => {
    els.mode.value = 'image';
    await els.mode.fire('change');
    await els.print.fire('click');
    assert.match(els.message.textContent, /el agente no responde/);
  });
  const fetch = fakeFetch(healthy());
  await withPanel({ fetch, renderPng: async () => { throw new Error('El navegador no pudo dibujar la etiqueta'); } }, async ({ els }) => {
    els.mode.value = 'image';
    await els.mode.fire('change');
    await els.print.fire('click');
    assert.equal(els.message.textContent, 'El navegador no pudo dibujar la etiqueta');
    assert.equal(fetch.calls.some(c => c.key === 'POST /print-image'), false);
  });
  await withPanel({ fetch }, async ({ els, renders }) => {
    els.mode.value = 'image';
    await els.mode.fire('change');
    els.offsetX.value = '150';
    await els.print.fire('click');
    assert.match(els.message.textContent, /Desplazamiento X/);
    assert.equal(renders.length, 0);
    assert.equal(fetch.calls.some(c => c.key === 'POST /print-image'), false);
  });
});

test('RAW mode is unchanged: it still sends the label code to /print', async () => {
  const fetch = fakeFetch(healthy());
  await withPanel({ fetch, getBytes: () => Uint8Array.from([0x53, 0x00]) }, async ({ els, renders }) => {
    await els.print.fire('click');
    const post = fetch.calls.find(c => c.key === 'POST /print');
    assert.equal(post.init.headers['Content-Type'], 'application/octet-stream');
    assert.equal(fetch.calls.some(c => c.key === 'POST /print-image'), false);
    assert.equal(renders.length, 0);
  });
});

test('mode, dpi, paper and offsets persist and are restored; unknown stored values fall back to the defaults', async () => {
  const storage = fakeStorage();
  await withPanel({ fetch: fakeFetch(healthy()), storage }, async ({ els }) => {
    els.mode.value = 'image'; await els.mode.fire('change');
    els.dpi.value = '600'; await els.dpi.fire('change');
    els.paper.value = 'label'; await els.paper.fire('change');
    els.offsetX.value = '2.5'; await els.offsetX.fire('change');
    els.offsetY.value = '-1'; await els.offsetY.fire('change');
  });
  await withPanel({ fetch: fakeFetch(healthy()), storage }, ({ els }) => {
    assert.equal(els.mode.value, 'image');
    assert.equal(els.imageOptions.hidden, false);
    assert.equal(els.dpi.value, '600');
    assert.equal(els.paper.value, 'label');
    assert.equal(els.offsetX.value, '2.5');
    assert.equal(els.offsetY.value, '-1');
  });
  const junk = fakeStorage({ 'printbridge.printMode': 'x', 'printbridge.imageDpi': '5', 'printbridge.imagePaper': 'x', 'printbridge.imageOffsetX': 'zz' });
  await withPanel({ fetch: fakeFetch(healthy()), storage: junk }, ({ els }) => {
    assert.equal(els.mode.value, 'raw');
    assert.equal(els.dpi.value, '300');
    assert.equal(els.paper.value, 'default');
    assert.equal(els.offsetX.value, '0');
  });
});

test('app.js feeds the panel the live label SVG and size', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(app, /createPrintPanel\(\{[^}]*getLabel:/);
  assert.match(app, /printPanel\.refreshInfo\(\)/);
});
