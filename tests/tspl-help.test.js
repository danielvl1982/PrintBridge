const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// C3: the TSPL command help under the caret (js/languages/tspl-help.js). "§" marks the caret in the helper.
const { tsplHelp, languages } = loadApp();

const at = marked => tsplHelp.at(marked.replace('§', ''), marked.indexOf('§'));
const current = info => info.params.findIndex(param => param.current);
const values = info => info.params.map(param => param.value);
const labels = info => info.params.map(param => param.label);

test('the caret in a TEXT command gives its parameters with their values and the current one', () => {
  const info = at('TEXT 10,20,"3",0,1§,1,"hola"');
  assert.equal(info.id, 'TEXT');
  assert.equal(info.title, 'Texto');
  assert.deepEqual(values(info), ['10', '20', '"3"', '0', '1', '1', '"hola"']);
  assert.equal(current(info), 4);
  assert.deepEqual(labels(info).slice(0, 3), ['Posición X', 'Posición Y', 'Fuente']);
  assert.equal(info.extra, null);
});

test('the caret in the name is on no parameter', () => {
  assert.equal(current(at('TE§XT 10,20,"3",0,1,1,"hola"')), -1);
});

test('TEXT with the optional alignment labels it before the content', () => {
  const info = at('TEXT 10,20,"3",0,1,1,2,"hola"§');
  assert.deepEqual(labels(info).slice(-2), ['Alineación', 'Contenido']);
  assert.equal(current(info), 7);
});

test('a comma inside the quoted content does not split it', () => {
  const info = at('TEXT 10,20,"3",0,1,1,"a,b§c"');
  assert.equal(info.params.at(-1).value, '"a,bc"');
  assert.equal(current(info), 6);
  assert.equal(info.params.length, 7);
});

test('SIZE and GAP take their values with units', () => {
  const size = at('SIZE 100 mm§,50 mm');
  assert.deepEqual(values(size), ['100 mm', '50 mm']);
  assert.equal(current(size), 0);
  assert.equal(at('GAP 3 mm,§0').params[1].label, 'Desplazamiento');
});

test('BARCODE labels the optional alignment and the content', () => {
  const info = at('BARCODE 10,20,"128",50,1,0,2,2,"1234"§');
  assert.deepEqual(labels(info).slice(2), ['Tipo', 'Altura', 'Texto legible', 'Rotación', 'Barra estrecha', 'Barra ancha', 'Contenido']);
  assert.equal(at('BARCODE 10,20,"128",50,1,0,2,2,1,"1234"§').params.at(-2).label, 'Alineación');
});

test('QRCODE options are told apart by their prefix', () => {
  const info = at('QRCODE 10,20,H,4,A,0,M2,S3,"datos"§');
  assert.deepEqual(labels(info).slice(6), ['Modelo (M)', 'Máscara (S)', 'Contenido']);
});

test('DMATRIX has an optional group of three', () => {
  assert.equal(at('DMATRIX 10,10,400,400,"DM"§').params.length, 5);
  assert.equal(at('DMATRIX 10,10,400,400,3,0,0,"DM"§').params.length, 8);
});

test('BOX, BAR, CIRCLE and the areas are labelled by position', () => {
  assert.deepEqual(labels(at('BOX 10,20,100,200,3§')).slice(2, 5), ['X final', 'Y final', 'Grosor']);
  assert.equal(at('BAR 10,20,100,3§').params[3].label, 'Alto');
  assert.equal(at('CIRCLE 10,20,50,3§').params[2].label, 'Diámetro');
  assert.equal(at('REVERSE 10,20,50,30§').id, 'REVERSE');
});

test('SET COUNTER and the counter assignment are told apart from the name', () => {
  const set = at('SET COUNTER @1 §1');
  assert.equal(set.id, 'SET COUNTER');
  assert.deepEqual(values(set), ['COUNTER', '@1', '1']);
  assert.equal(current(set), 2);
  const start = at('@1="000§1"');
  assert.equal(start.id, '@1');
  assert.equal(start.params[0].label, 'Valor inicial');
  assert.equal(start.params[0].value, '"0001"');
  assert.equal(current(start), 0);
});

test('a command with no parameters has none, an unknown one is known: false, text outside commands gives null', () => {
  assert.deepEqual(at('CL§S').params, []);
  assert.equal(at('FOO 1,2§').known, false);
  assert.equal(at('§'), null);
});

test('parameters beyond the layout are reported as extra', () => {
  assert.equal(at('SIZE 100 mm,50 mm,9§9').extra, '99');
});

test('range gives every command of the selection in order, with no current parameter', () => {
  const text = ['SIZE 100 mm,50 mm', 'CLS', 'TEXT 10,20,"3",0,1,1,"hola"', 'PRINT 1'].join('\n');
  const start = text.indexOf('TEXT');
  assert.deepEqual(tsplHelp.range(text, start, text.indexOf('PRINT')).map(info => info.id), ['TEXT']);
  const all = tsplHelp.range(text, 0, text.length);
  assert.deepEqual(all.map(info => info.id), ['SIZE', 'CLS', 'TEXT', 'PRINT']);
  assert.ok(all.every(info => info.params.every(param => !param.current)));
});

test('the language registry exposes the help of TSPL', () => {
  const language = languages.get('tspl');
  assert.equal(typeof language.helpAt, 'function');
  assert.equal(typeof language.helpRange, 'function');
  assert.equal(language.helpAt('SIZE 100 mm,50 mm', 2).id, 'SIZE');
});

test('every entry has a title, a description and a layout with labelled parameters', () => {
  for (const [name, entry] of Object.entries(tsplHelp.TABLE)) {
    assert.ok(entry.title && entry.description && typeof entry.layout === 'function', name);
    for (const param of entry.layout([])) assert.ok(param.label && param.description, `${name} has an unlabelled parameter`);
  }
});
