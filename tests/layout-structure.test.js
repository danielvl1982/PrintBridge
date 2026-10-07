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
  for (const id of ['src', 'convert', 'vars', 'msgs']) assert.ok(column.includes('id="' + id + '"'), id + ' missing from the column');
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
  for (const id of ['btnOpen', 'file', 'example', 'btnExample']) assert.ok(header.includes('id="' + id + '"'), id + ' missing from the header');
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
