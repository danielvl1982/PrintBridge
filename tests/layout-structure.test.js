'use strict';
// Structural checks of index.html (the browser cannot be run in tests): required ids, DOM order and the palette visibility contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const REQUIRED_IDS = [
  'palette', 'propsPanel', 'propsKind', 'propsEmpty', 'propsForm', 'propsOverlay',
  'imgX', 'imgY', 'imgW', 'imgThreshold', 'imgThresholdValue', 'btnImageInsert', 'btnImageRemove', 'imageFile',
  'svgwrap', 'dims', 'cursor', 'src', 'vars', 'msgs', 'convert',
  'dpi', 'calib', 'rotation', 'optGrid', 'optAnchor', 'optOverlap', 'btnOpen', 'file', 'example', 'btnExample',
  'size', 'szW', 'szH', 'szP', 'btnApply',
];

const countId = id => (html.match(new RegExp('\\sid="' + id + '"', 'g')) || []).length;
const at = marker => {
  const i = html.indexOf(marker);
  assert.ok(i >= 0, marker + ' not found');
  return i;
};

test('every required id exists exactly once', () => {
  for (const id of REQUIRED_IDS) assert.equal(countId(id), 1, 'id ' + id);
});

test('palette, properties bar and preview are in the stage, in that order', () => {
  const stage = at('<div class="stage">');
  const palette = at('id="palette"');
  const props = at('id="propsPanel"');
  const preview = at('<section class="panel preview">');
  const stageEnd = html.indexOf('</main>');
  assert.ok(stage < palette && palette < props && props < preview && preview < stageEnd);
});

test('the left column no longer holds the palette or the properties', () => {
  const colStart = at('<div class="column">');
  const colEnd = at('<div class="stage">');
  const column = html.slice(colStart, colEnd);
  assert.ok(colStart < colEnd);
  for (const id of ['palette', 'propsPanel', 'propsKind', 'propsEmpty', 'propsForm', 'propsOverlay']) {
    assert.ok(!column.includes('id="' + id + '"'), id + ' still in the column');
  }
  // P1f changed the premise: Avisos (#msgs) moved to the stage, so the column keeps src, vars and convert only.
  for (const id of ['src', 'convert', 'vars']) assert.ok(column.includes('id="' + id + '"'), id + ' missing from the column');
  assert.ok(!column.includes('id="msgs"'), 'msgs must not be in the column');
});

test('the palette keeps its visibility contract: palette.js hides the parent, which starts hidden', () => {
  const paletteJs = fs.readFileSync(path.join(ROOT, 'js', 'palette.js'), 'utf8');
  assert.match(paletteJs, /container\.parentElement\.hidden\s*=\s*items\.length === 0/);
  const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(appJs, /createPalette\(\$\('palette'\)/);
  // The palette is the only child of a wrapper that starts hidden (the parent is what palette.js toggles).
  assert.match(html, /<div class="strip"[^>]*\shidden[^>]*>\s*(?:<span class="strip-title">[^<]*<\/span>\s*)?<ul id="palette" class="palette"><\/ul>\s*<\/div>/);
});

test('the properties elements are all inside the properties bar', () => {
  const start = at('id="propsPanel"');
  const end = at('<section class="panel preview">');
  const bar = html.slice(start, end);
  for (const id of ['propsKind', 'propsEmpty', 'propsForm', 'propsOverlay', 'imgX', 'imgY', 'imgW', 'imgThreshold', 'btnImageInsert', 'btnImageRemove']) {
    assert.ok(bar.includes('id="' + id + '"'), id);
  }
});

const VIEW_IDS = ['dpi', 'calib', 'rotation', 'optGrid', 'optAnchor', 'optOverlap'];

test('the six view controls sit in the stage, before the component strip', () => {
  const stage = at('<div class="stage">');
  const strip = at('<div class="strip"');
  for (const id of VIEW_IDS) {
    assert.equal(countId(id), 1, id);
    const i = at('id="' + id + '"');
    assert.ok(stage < i && i < strip, id + ' must be inside .stage before .strip');
  }
});

test('the toolbars no longer hold the view controls', () => {
  const header = html.slice(at('<header class="toolbar">'), at('</header>'));
  // P1c changed the premise: the secondary toolbar no longer exists, so only the header is checked here.
  for (const id of VIEW_IDS) {
    assert.ok(!header.includes('id="' + id + '"'), id + ' still in the header');
  }
});

const SIZE_IDS = ['size', 'szW', 'szH', 'szP', 'btnApply'];

test('the five label-size controls sit in the stage size row, before the view row', () => {
  const stage = at('<div class="stage">');
  const sizeRow = at('<div class="size-row">');
  const viewRow = at('<div class="view-row">');
  assert.ok(stage < sizeRow && sizeRow < viewRow, 'size row must be the first row of .stage');
  for (const id of SIZE_IDS) {
    assert.equal(countId(id), 1, id);
    const i = at('id="' + id + '"');
    assert.ok(sizeRow < i && i < viewRow, id + ' must be inside .size-row before .view-row');
  }
  assert.ok(html.includes('Tamaño etiqueta'));
});

test('stage DOM order: size row, view row, strip, properties bar, preview', () => {
  const marks = ['<div class="size-row">', '<div class="view-row">', '<div class="strip"', 'id="propsPanel"', '<section class="panel preview">'].map(at);
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i - 1] < marks[i], 'order broken at index ' + i);
});

test('no secondary toolbar remains and the header holds none of the size controls', () => {
  assert.ok(!html.includes('toolbar--secondary'));
  assert.equal((html.match(/class="toolbar/g) || []).length, 1, 'the header is the only toolbar');
  const header = html.slice(at('<header class="toolbar">'), at('</header>'));
  for (const id of SIZE_IDS) assert.ok(!header.includes('id="' + id + '"'), id + ' still in the header');
});

test('the app is called "Print Bridge" in the title and the header', () => {
  assert.match(html, /<title>Print Bridge<\/title>/);
  assert.match(html, /<h1>Print Bridge<\/h1>/);
});

test('the logo is used in the header and as favicon, and the file is a safe SVG', () => {
  const img = html.match(/<img class="logo" src="([^"]+)" alt="" width="28" height="28">/);
  assert.ok(img, 'header logo img');
  const link = html.match(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)">/);
  assert.ok(link, 'favicon link');
  assert.equal(img[1], 'img/logo.svg');
  assert.equal(link[1], 'img/logo.svg');
  assert.ok(at('class="logo"') > at('<header class="toolbar">') && at('class="logo"') < at('<h1>'));
  const file = path.join(ROOT, img[1]);
  assert.ok(fs.existsSync(file), 'logo file exists');
  const svg = fs.readFileSync(file, 'utf8');
  assert.match(svg, /^\s*<svg[\s>]/);
  assert.match(svg, /viewBox="/);
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /\b(?:xlink:)?href\s*=/i);
  assert.doesNotMatch(svg, /url\(\s*['"]?https?:/i);
});

const FILE_IDS = ['btnOpen', 'file', 'example', 'btnExample'];

// P1f replaced the P1d test (file controls in the size row) with the two tests below.
const columnHtml = () => html.slice(at('<div class="column">'), at('<div class="stage">'));
const sizeRowHtml = () => html.slice(at('<div class="size-row">'), at('<div class="view-row">'));

// P1g changed the premise: the file controls no longer lead the column in their own row; they live in the Código panel header.
const codePanelHtml = () => {
  const column = columnHtml();
  const start = column.indexOf('<section class="panel">');
  return column.slice(start, column.indexOf('</section>', start));
};

// P1h changed the premise: only #btnOpen and #file stay in the header (before #src); the example pair moved below the help text.
test('the file controls sit once in the Código de etiqueta panel: open/file before #src, example pair after it, none in the size row', () => {
  const panel = codePanelHtml();
  assert.ok(panel.includes('<h2>Código de etiqueta</h2>'), 'first column panel is Código de etiqueta');
  const src = panel.indexOf('id="src"');
  assert.ok(src > 0);
  for (const id of FILE_IDS) {
    assert.equal(countId(id), 1, id);
    const i = panel.indexOf('id="' + id + '"');
    assert.ok(i >= 0, id + ' must be in the Código panel');
    if (id === 'btnOpen' || id === 'file') assert.ok(i < src, id + ' must be before #src');
    else assert.ok(i > src, id + ' must be after #src');
    assert.ok(!sizeRowHtml().includes('id="' + id + '"'), id + ' still in the size row');
  }
  assert.ok(!html.includes('row-group'), 'the file/size group wrappers are gone');
});

test('Código panel order: header (title, Abrir archivo, hidden file), #src, help text, then the joined example group', () => {
  assert.ok(!html.includes('file-row'), 'file-row is gone');
  const panel = codePanelHtml();
  assert.match(panel, /<div class="panel-head">\s*<h2>Código de etiqueta<\/h2>\s*<div class="panel-actions">/);
  const head = panel.slice(0, panel.indexOf('id="src"'));
  assert.ok(head.indexOf('id="btnOpen"') > 0 && head.indexOf('id="file"') > head.indexOf('id="btnOpen"'), 'hidden input next to Abrir archivo');
  assert.ok(!head.includes('btn-group') && !head.includes('id="example"') && !head.includes('id="btnExample"'), 'example pair is not in the header');
  // #example / #btnExample are not inside .panel-actions.
  const actions = head.slice(head.indexOf('<div class="panel-actions">'));
  assert.ok(!actions.includes('id="example"') && !actions.includes('id="btnExample"'), 'example pair is outside .panel-actions');
  const src = panel.indexOf('id="src"');
  const small = panel.indexOf('<small>');
  const group = panel.indexOf('<div class="btn-group">');
  assert.ok(src < small && small < group, '#src, then the help text, then the group');
  assert.ok(panel.slice(small, group).includes('Clic en un elemento del dibujo selecciona su línea.'), 'help text is the <small> right before the group');
  const body = panel.slice(group).match(/<div class="btn-group">([\s\S]*?)<\/div>/);
  assert.ok(body, 'btn-group exists');
  assert.ok(body[1].includes('id="example"') && body[1].includes('id="btnExample"'), 'select and button are in the group');
  assert.ok(body[1].indexOf('id="example"') < body[1].indexOf('id="btnExample"'), 'button right after the select');
  assert.ok(!body[1].includes('id="btnOpen"'), 'Abrir archivo is outside the group');
});

test('Avisos grows freely: no max-height or overflow rule on .msgs-panel / .msgs / #msgs', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'viewer.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /msgs/.test(m[1]));
  assert.ok(rules.length > 0, 'msgs rules exist');
  for (const [, sel, body] of rules) {
    assert.doesNotMatch(body, /max-height|overflow/, 'rule "' + sel.trim() + '" must not bound the height');
  }
});

test('the size row holds only the five size controls, in order', () => {
  const row = sizeRowHtml();
  const ids = [...row.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, SIZE_IDS);
});

test('Avisos (#msgs) is the last element of the stage, right after the preview section, and not in the column', () => {
  assert.equal(countId('msgs'), 1);
  const msgs = at('id="msgs"');
  const preview = at('<section class="panel preview">');
  const previewEnd = html.indexOf('</section>', preview);
  const stageEnd = html.indexOf('</main>');
  assert.ok(previewEnd < at('<section class="panel msgs-panel">') && at('<section class="panel msgs-panel">') < msgs && msgs < stageEnd);
  assert.ok(!columnHtml().includes('id="msgs"'));
  // Nothing but closing tags between the Avisos section and the end of the stage.
  assert.match(html.slice(msgs, stageEnd), /^id="msgs" class="msgs"><\/ul>\s*<\/section>\s*<\/div>\s*$/);
});

test('the header holds only the logo and the title', () => {
  const header = html.slice(at('<header class="toolbar">'), at('</header>'));
  assert.doesNotMatch(header, /<(?:button|select|input|label|textarea)\b/);
  for (const id of FILE_IDS) assert.ok(!header.includes('id="' + id + '"'), id + ' still in the header');
  assert.match(header, /<img class="logo"/);
  assert.match(header, /<h1>Print Bridge<\/h1>/);
});

test('the hidden image input stays outside the header and the rows, exactly once', () => {
  assert.equal(countId('imageFile'), 1);
  const i = at('id="imageFile"');
  assert.ok(i > at('</header>') && i < at('<main>'));
});

test('the file input keeps its attributes and the file controls keep their text', () => {
  for (const piece of [
    '<input id="file" type="file" accept=".ter,.txt,.zpl,.prn,.tspl,.tpcl" hidden>',
    '<button id="btnOpen">Abrir archivo…</button>',
    '<label>Ejemplo <select id="example"></select></label>',
    '<button id="btnExample">Cargar ejemplo</button>',
  ]) assert.ok(html.includes(piece), piece);
});

// P1g changed the premise: there is no file row any more (its controls are in the Código panel header), so the column is Código, Variables, Convertir.
test('the left column order is Código, Variables, Convertir', () => {
  const order = ['id="src"', 'id="vars"', 'id="convert"'].map(k => html.indexOf(k));
  assert.ok(order.every(i => i > 0), 'all three blocks exist');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'src, vars, convert in this DOM order');
  const column = html.slice(html.indexOf('<div class="column">'), html.indexOf('<div class="stage">'));
  assert.ok(column.includes('id="convert"'), 'convert stays in the left column');
});

test('the Componentes title has the same typography as the Propiedades heading (.panel h2)', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'css', 'viewer.css'), 'utf8');
  const css = raw.split('/*').map((part, i) => (i === 0 ? part : part.slice(part.indexOf('*/') + 2))).join('');
  const declarations = selector => {
    const start = css.indexOf(selector + ' {');
    assert.ok(start >= 0, selector + ' rule exists');
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    return new Map(body.split(';').map(s => s.trim()).filter(Boolean).map(s => [s.slice(0, s.indexOf(':')).trim(), s.slice(s.indexOf(':') + 1).trim()]));
  };
  const heading = declarations('.panel h2');
  const title = declarations('.strip-title');
  for (const name of ['font-size', 'text-transform', 'letter-spacing', 'color']) {
    assert.equal(title.get(name), heading.get(name), name + ' matches the heading');
  }
  assert.equal(title.get('font-weight'), '700', 'bold like a browser h2');
});

test('the size row and the view row have a title with the same style as Componentes (Formato, Vista)', () => {
  for (const [row, title, firstControl] of [['size-row', 'Formato', 'id="size"'], ['view-row', 'Vista', 'id="dpi"']]) {
    const start = html.indexOf('<div class="' + row + '">');
    assert.ok(start >= 0, row + ' exists');
    const tag = '<span class="strip-title">' + title + '</span>';
    const at = html.indexOf(tag, start);
    assert.ok(at > start, row + ' has the title ' + title);
    assert.ok(at < html.indexOf(firstControl, start), 'the title comes before the first control of ' + row);
  }
});
