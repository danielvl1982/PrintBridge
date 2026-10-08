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

// ---- Z8: three targets (TPCL, TSPL, ZPL) and a source detected in each of them

const ZPL_EXAMPLE = PB.examples.find(e => e.id === 'zpl-label-100x60');
const NAMES = { tpcl: 'TPCL (Toshiba TEC)', tspl: 'TSPL (TSC TTP)', zpl: 'ZPL (Zebra)' };
const SOURCES = [['tpcl', SPOOL.source], ['tspl', TSPL_EXAMPLE.source], ['zpl', ZPL_EXAMPLE.source]];

test('the target select lists TPCL, TSPL and ZPL', async () => {
  await withPanel({}, ({ els }) => {
    assert.deepEqual(els.select.children.map(o => [o.value, o.textContent]), [['tpcl', NAMES.tpcl], ['tspl', NAMES.tspl], ['zpl', NAMES.zpl]]);
  });
});

test('every source language converts to every target, itself included, with the summary naming both', async () => {
  for (const [from, source] of SOURCES) {
    for (const target of Object.keys(NAMES)) {
      await withPanel({ text: source }, async ({ els }) => {
        els.select.value = target;
        await els.convert.fire('click');
        const expected = PB.convert.run(source, target, { dpi: 203 });
        assert.equal(expected.source, from);
        assert.equal(els.summary.textContent, `Convertido de ${NAMES[from]} a ${NAMES[target]}`);
        assert.equal(els.output.value, expected.text, `${from} -> ${target}`);
        assert.deepEqual(texts(els.diagnostics), PB.diagnostics.sort(expected.diagnostics.length ? expected.diagnostics : [PB.diagnostics.info('Sin avisos de conversión')]).map(d => d.text));
        assert.equal(els.copy.disabled, false);
        assert.equal(els.download.disabled, false);
      });
    }
  }
});

test('a label converted to its own language is written again by that language (nothing special, nothing lost)', async () => {
  await withPanel({ text: ZPL_EXAMPLE.source }, async ({ els }) => {
    els.select.value = 'zpl';
    await els.convert.fire('click');
    const model = PB.languages.get('zpl').parse(els.output.value, { dpi: 203 });
    const original = PB.languages.get('zpl').parse(ZPL_EXAMPLE.source, { dpi: 203 });
    assert.deepEqual(model.items.map(i => [i.kind, i.data]), original.items.map(i => [i.kind, i.data]));
  });
});

test('ZPL -> TPCL and TSPL -> ZPL use the dpi given by the app', async () => {
  await withPanel({ text: ZPL_EXAMPLE.source }, async ({ els, state }) => {
    state.dpi = 300;
    els.select.value = 'tpcl';
    await els.convert.fire('click');
    assert.equal(els.output.value, PB.convert.run(ZPL_EXAMPLE.source, 'tpcl', { dpi: 300 }).text);
    assert.notEqual(els.output.value, PB.convert.run(ZPL_EXAMPLE.source, 'tpcl', { dpi: 203 }).text);
  });
  await withPanel({ text: TSPL_EXAMPLE.source }, async ({ els, state }) => {
    state.dpi = 300;
    els.select.value = 'zpl';
    await els.convert.fire('click');
    assert.match(els.output.value, /\^PW1181\r\n\^LL709/);
  });
});

test('Descargar writes a .zpl file with the UTF-8 bytes of the text (no BOM, accents kept), named after the source', async () => {
  const text = '{D0610,0990,0550|}\n{PC001;0100,0100,05,05,J,00,B=Niño café|}\n{XS;I,0001,0002C4100|}';
  await withPanel({ text, name: 'etiquetas/bobina 99.ter' }, async ({ els, dom }) => {
    els.select.value = 'zpl';
    await els.convert.fire('click');
    assert.match(els.output.value, /Niño café/);
    await els.download.fire('click');
    const bytes = new Uint8Array(await dom.blobs[0].arrayBuffer());
    assert.deepEqual(Array.from(bytes), Array.from(new TextEncoder().encode(els.output.value)));
    assert.notDeepEqual(Array.from(bytes.subarray(0, 3)), [0xEF, 0xBB, 0xBF], 'no byte order mark');
    assert.ok(bytes.includes(0xC3), 'ñ is two UTF-8 bytes, not latin1');
    assert.equal(dom.anchors[0].download, 'bobina 99.zpl');
    await tick();
  });
  await withPanel({ text: TSPL_EXAMPLE.source }, async ({ els, dom }) => {
    els.select.value = 'zpl';
    await els.convert.fire('click');
    await els.download.fire('click');
    assert.equal(dom.anchors[0].download, 'etiqueta.zpl');
    await tick();
  });
});

test('the binary note never appears for ZPL: an image is ASCII hexadecimal (^GFA) and Copiar is safe', async () => {
  for (const source of [tpclWithImage(), PB.convert.run(tpclWithImage(), 'tspl', { dpi: 203 }).text]) {
    await withPanel({ text: source }, async ({ els, dom }) => {
      dom.setClipboard(async () => {});
      els.select.value = 'zpl';
      await els.convert.fire('click');
      assert.match(els.output.value, /\^GFA,/);
      assert.ok(/^[\t\r\n\u0020-\u007E]*$/.test(els.output.value), 'only printable ASCII, tabs and line breaks');
      assert.equal(els.note.hidden, true);
      assert.equal(els.note.textContent, '');
      await els.copy.fire('click');
      assert.equal(els.status.textContent, 'Copiado al portapapeles');
    });
  }
  // while a TSPL target of the same image still carries the note
  await withPanel({ text: tpclWithImage() }, async ({ els }) => {
    els.select.value = 'tspl';
    await els.convert.fire('click');
    assert.equal(els.note.hidden, false);
    els.select.value = 'zpl';
    await els.convert.fire('click');
    assert.equal(els.note.hidden, true, 'the note goes away with the next conversion');
  });
});

test('Copiar writes the exact ZPL output (CRLF kept)', async () => {
  await withPanel({ text: TSPL_EXAMPLE.source }, async ({ els, dom }) => {
    const written = [];
    dom.setClipboard(async text => { written.push(text); });
    els.select.value = 'zpl';
    await els.convert.fire('click');
    await els.copy.fire('click');
    assert.deepEqual(written, [PB.convert.run(TSPL_EXAMPLE.source, 'zpl', { dpi: 203 }).text]);
    assert.ok(written[0].includes('\r\n'));
  });
});

test('the label losses are listed: the pitch / gap that ZPL cannot hold, and what the source parser did not read', async () => {
  await withPanel({}, async ({ els }) => {
    els.select.value = 'zpl';
    await els.convert.fire('click');
    assert.ok(texts(els.diagnostics).some(t => /ZPL solo declara el ancho y el largo/.test(t)));
  });
  await withPanel({ text: '^XA\r\n^PW799\r\n^LL480\r\n^FO30,30^A0N,30,30^FDHola^FS\r\n^FB300,3^FDblock^FS\r\n^XZ\r\n' }, async ({ els }) => {
    els.select.value = 'tspl';
    await els.convert.fire('click');
    const unread = els.diagnostics.children.filter(c => c.textContent.startsWith('Origen: '));
    assert.equal(unread.length, 1);
    assert.match(unread[0].textContent, /Comando no soportado/);
    assert.equal(unread[0].className, 'warning');
  });
  await withPanel({ text: ZPL_EXAMPLE.source }, async ({ els }) => {
    els.select.value = 'tspl';
    await els.convert.fire('click');
    assert.ok(!texts(els.diagnostics).some(t => t.startsWith('Origen: ')), 'a label the parser read completely adds nothing');
  });
});
