const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo, manifest } = require('./helpers/load');

// T7: the "Convertir a..." panel (js/convert-panel.js) on a minimal fake DOM.
const PB = loadUpTo('js/convert-panel.js');

const SPOOL = PB.examples.find(e => e.id === 'spool-99x55');
const TSPL_EXAMPLE = PB.examples.find(e => e.id === 'tspl-label-100x60');
const BINARY_NOTE = 'La salida contiene datos binarios (imágenes): use Descargar, copiar puede alterarlos';

/** Fake element: enough of the DOM for the panel (children, properties, listeners, manual dispatch). */
function fakeElement(tagName) {
  const listeners = {};
  const el = {
    tagName: String(tagName).toUpperCase(), children: [], value: '', textContent: '', className: '', disabled: false, hidden: false,
    selected: 0, clicked: 0,
    append(...nodes) { el.children.push(...nodes); },
    appendChild(node) { el.children.push(node); return node; },
    removeChild(node) { el.children.splice(el.children.indexOf(node), 1); return node; },
    replaceChildren(...nodes) { el.children = [...nodes]; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { return Promise.all((listeners[type] || []).map(fn => fn())); },
    select() { el.selected++; },
    click() { el.clicked++; },
  };
  return el;
}

/** Installs a fake document (and URL object-URL stubs, execCommand); returns what the panel did to it. */
function installDom({ execCommand = () => true } = {}) {
  const saved = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  const dom = { blobs: [], revoked: [], anchors: [], appended: [], commands: [] };
  const body = fakeElement('body');
  const original = body.appendChild;
  body.appendChild = node => { dom.appended.push(node); return original(node); };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body,
      createElement(tag) {
        const el = fakeElement(tag);
        if (el.tagName === 'A') dom.anchors.push(el);
        return el;
      },
      execCommand(command) { dom.commands.push(command); return execCommand(command); },
    },
  });
  URL.createObjectURL = blob => { dom.blobs.push(blob); return `blob:fake-${dom.blobs.length}`; };
  URL.revokeObjectURL = url => { dom.revoked.push(url); };
  dom.restore = () => {
    if (saved.document) Object.defineProperty(globalThis, 'document', saved.document); else delete globalThis.document;
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else delete globalThis.navigator;
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
  };
  dom.setClipboard = writeText => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: writeText ? { clipboard: { writeText } } : {} });
  };
  dom.body = body;
  return dom;
}

/** Runs fn with a fresh fake DOM and a panel built on it. */
async function withPanel(options, fn) {
  const dom = installDom(options.dom);
  try {
    const state = { text: options.text === undefined ? SPOOL.source : options.text, dpi: 203, name: options.name };
    const messages = [];
    const root = fakeElement('div');
    const panel = PB.ui.createConvertPanel({
      root, getText: () => state.text, getDpi: () => state.dpi, getSourceName: () => state.name, onMessage: m => messages.push(m),
    });
    await fn({ panel, els: panel.els, root, state, dom, messages });
  } finally {
    dom.restore();
  }
}

const texts = list => list.children.map(c => c.textContent);
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

/** A TPCL label holding a 16x6 bitmap, so converting it to TSPL carries a BITMAP payload (first byte 0x01: a control character). */
function tpclWithImage() {
  const data = new Uint8Array(16 * 6).map((_, i) => (i < 7 || ((i % 16) + 2 * Math.floor(i / 16)) % 5 === 0) ? 1 : 0);
  const model = {
    language: 'tpcl', size: { width: 990, height: 550, pitch: 610, gap: null, native: {} }, diagnostics: [],
    items: [{ kind: 'image', x: 40, y: 30, width: 0, height: 0, bitmap: { w: 16, h: 6, data }, data: null }],
  };
  return PB.languages.emit('tpcl', model, { dpi: 203 }).text;
}

test('js/convert-panel.js is in the manifest after js/ui.js and before js/app.js', () => {
  const files = manifest();
  assert.ok(files.indexOf('js/convert-panel.js') > files.indexOf('js/ui.js'));
  assert.ok(files.indexOf('js/convert-panel.js') < files.indexOf('js/app.js'));
  assert.equal(typeof PB.ui.createConvertPanel, 'function');
  assert.equal(typeof PB.ui.createImagePanel, 'function', 'PB.ui is extended, not replaced');
});

test('the target select is filled from PB.convert.targets() and the buttons start disabled', async () => {
  await withPanel({}, ({ els, root }) => {
    const targets = PB.convert.targets();
    assert.ok(targets.length >= 2);
    assert.deepEqual(els.select.children.map(o => [o.value, o.textContent]), targets.map(t => [t.id, t.name]));
    assert.ok(root.children.length > 0, 'it builds into root');
    assert.ok(JSON.stringify(root, (k, v) => (typeof v === 'function' ? undefined : v)).includes('Convertir a…'));
    assert.equal(els.copy.disabled, true);
    assert.equal(els.download.disabled, true);
    assert.equal(els.output.readOnly, true);
  });
});

test('TPCL example -> TSPL fills the output, the summary and the diagnostics list and enables the buttons', async () => {
  await withPanel({}, async ({ els }) => {
    els.select.value = 'tspl';
    await els.convert.fire('click');
    assert.match(els.output.value, /SIZE/);
    assert.match(els.output.value, /PRINT 1,1/);
    assert.equal(els.summary.textContent, 'Convertido de TPCL (Toshiba TEC) a TSPL (TSC TTP)');
    assert.ok(els.diagnostics.children.length > 0);
    const expected = PB.diagnostics.sort(PB.convert.run(SPOOL.source, 'tspl', { dpi: 203 }).diagnostics);
    assert.deepEqual(texts(els.diagnostics), expected.map(d => d.text));
    assert.deepEqual(els.diagnostics.children.map(c => c.className), expected.map(d => d.level));
    assert.equal(els.copy.disabled, false);
    assert.equal(els.download.disabled, false);
  });
});

test('TSPL example -> TPCL fills the output and uses the dpi given by the app', async () => {
  await withPanel({ text: TSPL_EXAMPLE.source }, async ({ els, state }) => {
    state.dpi = 300;
    els.select.value = 'tpcl';
    await els.convert.fire('click');
    assert.equal(els.output.value, PB.convert.run(TSPL_EXAMPLE.source, 'tpcl', { dpi: 300 }).text.replace(/\r\n?/g, '\n'));
    assert.match(els.output.value, /\{D\d+,\d+,\d+\|\}/);
    assert.equal(els.summary.textContent, 'Convertido de TSPL (TSC TTP) a TPCL (Toshiba TEC)');
    assert.ok(els.diagnostics.children.length > 0);
  });
});

test('errors with a code show their Spanish message in the panel and clear the output', async () => {
  await withPanel({}, async ({ els, state }) => {
    els.select.value = 'tspl';
    await els.convert.fire('click');
    assert.ok(els.output.value.length > 0);
    state.text = '   ';
    await els.convert.fire('click');
    assert.equal(els.output.value, '');
    assert.equal(els.summary.textContent, 'No hay texto que convertir: la etiqueta está vacía');
    assert.equal(els.diagnostics.children.length, 0);
    assert.equal(els.copy.disabled, true);
    assert.equal(els.download.disabled, true);

    state.text = 'esto no es una etiqueta';
    await els.convert.fire('click');
    assert.equal(els.summary.textContent, 'No se reconoce el lenguaje de impresión del texto de origen');
    assert.equal(els.output.value, '');

    els.select.value = 'nope';
    state.text = SPOOL.source;
    await els.convert.fire('click');
    assert.equal(els.summary.textContent, 'Lenguaje de destino desconocido: "nope"');
    assert.equal(els.output.value, '');
  });
});

test('Copiar uses navigator.clipboard.writeText with the exact output (CRLF kept) and confirms', async () => {
  await withPanel({ text: TSPL_EXAMPLE.source }, async ({ els, dom }) => {
    const written = [];
    dom.setClipboard(async text => { written.push(text); });
    els.select.value = 'tspl';
    await els.convert.fire('click');
    await els.copy.fire('click');
    assert.deepEqual(written, [PB.convert.run(TSPL_EXAMPLE.source, 'tspl', { dpi: 203 }).text]);
    assert.deepEqual(dom.commands, []);
    assert.equal(els.status.textContent, 'Copiado al portapapeles');
  });
});

test('Copiar falls back to a selected textarea and execCommand when there is no clipboard API or it rejects', async () => {
  await withPanel({}, async ({ els, dom }) => {
    dom.setClipboard(null);
    els.select.value = 'tspl';
    await els.convert.fire('click');
    await els.copy.fire('click');
    assert.deepEqual(dom.commands, ['copy']);
    assert.equal(els.status.textContent, 'Copiado al portapapeles');

    dom.setClipboard(async () => { throw new Error('denied'); });
    await els.copy.fire('click');
    assert.deepEqual(dom.commands, ['copy', 'copy']);
    assert.equal(els.status.textContent, 'Copiado al portapapeles');
  });
  await withPanel({ dom: { execCommand: () => false } }, async ({ els, dom }) => {
    dom.setClipboard(null);
    els.select.value = 'tspl';
    await els.convert.fire('click');
    await els.copy.fire('click');
    assert.equal(els.status.textContent, 'No se pudo copiar: seleccione el texto y use Ctrl+C');
  });
});

test('the binary note appears for a conversion with an image and not for plain text', async () => {
  await withPanel({ text: tpclWithImage() }, async ({ els, state }) => {
    els.select.value = 'tspl';
    await els.convert.fire('click');
    assert.equal(els.note.hidden, false);
    assert.equal(els.note.textContent, BINARY_NOTE);
    state.text = TSPL_EXAMPLE.source;
    els.select.value = 'tpcl';
    await els.convert.fire('click');
    assert.equal(els.note.hidden, true);
    assert.equal(els.note.textContent, '');
  });
  await withPanel({ text: SPOOL.source }, async ({ els }) => {
    els.select.value = 'tspl';
    await els.convert.fire('click');
    assert.equal(els.note.hidden, true, 'CR, LF and TAB are not binary');
  });
});

test('Descargar builds the Blob from toBytes, names it with fileName and revokes the object URL', async () => {
  await withPanel({ text: tpclWithImage(), name: 'etiquetas/bobina 99.ter' }, async ({ els, dom }) => {
    els.select.value = 'tspl';
    await els.convert.fire('click');
    const output = PB.convert.run(tpclWithImage(), 'tspl', { dpi: 203 }).text;
    assert.ok(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(output), 'the example carries binary payload bytes');
    await els.download.fire('click');
    assert.equal(dom.blobs.length, 1);
    const bytes = new Uint8Array(await dom.blobs[0].arrayBuffer());
    assert.deepEqual(Array.from(bytes), Array.from(output, ch => ch.charCodeAt(0)), 'byte-preserving latin1');
    assert.deepEqual(Array.from(bytes), Array.from(PB.convert.toBytes(output, 'tspl')));
    assert.equal(dom.anchors.length, 1);
    const [anchor] = dom.anchors;
    assert.equal(anchor.download, PB.convert.fileName('tspl', 'etiquetas/bobina 99.ter'));
    assert.equal(anchor.download, 'bobina 99.prn');
    assert.equal(anchor.href, 'blob:fake-1');
    assert.equal(anchor.clicked, 1);
    assert.deepEqual(dom.appended, [anchor]);
    assert.deepEqual(dom.body.children, [], 'the temporary link is removed');
    await tick();
    assert.deepEqual(dom.revoked, ['blob:fake-1']);
  });
});

test('Descargar uses the default name without a source name and the target of the last conversion', async () => {
  await withPanel({ text: TSPL_EXAMPLE.source }, async ({ els, dom }) => {
    els.select.value = 'tpcl';
    await els.convert.fire('click');
    els.select.value = 'tspl'; // changing the select clears nothing and does not change what is downloaded
    assert.equal(els.output.value.length > 0, true);
    await els.download.fire('click');
    assert.equal(dom.anchors[0].download, 'etiqueta.txt');
    const bytes = new Uint8Array(await dom.blobs[0].arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes), PB.convert.run(TSPL_EXAMPLE.source, 'tpcl', { dpi: 203 }).text);
    await tick();
  });
});
