const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// C2: the TPCL command help under the caret (js/languages/tpcl-help.js). "§" marks the caret in the helper (the "|" is the command terminator).
const { tpclHelp, languages } = loadApp();

const at = marked => tpclHelp.at(marked.replace('§', ''), marked.indexOf('§'));
/** The help of the first command with the caret right after its "{". */
const first = text => tpclHelp.at(text, 1);
const current = info => info.params.findIndex(param => param.current);
const values = info => info.params.map(param => param.value);

test('the caret in a PC command gives its parameters with their values and the current one', () => {
  const info = at('{PC001;0100,02§00,05,05,J,00,B|}');
  assert.equal(info.id, '{PC');
  assert.equal(info.title, 'Texto con fuente de mapa de bits');
  assert.deepEqual(values(info), ['001', '0100', '0200', '05', '05', 'J', '00', 'B']);
  assert.equal(current(info), 2);
  assert.deepEqual(info.params.map(param => param.label).slice(0, 3), ['Número de campo', 'Posición X', 'Posición Y']);
  assert.equal(info.extra, null);
});

test('the caret in the name is on no parameter, in the field number it is on the number', () => {
  assert.equal(current(at('{P§C001;0100,0200,05,05,J,00,B|}')), -1);
  assert.equal(current(at('{PC00§1;0100,0200,05,05,J,00,B|}')), 0);
});

test('PC with the optional spacing shifts the labels that follow it', () => {
  const info = first('{PC001;0100,0200,05,05,J,+03,00,B|}');
  assert.deepEqual(info.params.map(param => param.label).slice(5), ['Fuente', 'Espaciado entre caracteres', 'Rotación', 'Atributo']);
});

test('the inline data of a PC is one parameter, commas included, and the tail options are labelled by what they start with', () => {
  const info = at('{PC001;0100,0200,05,05,J,00,B,P2=a,b§c|}');
  assert.deepEqual(info.params.slice(-3).map(param => param.label), ['Atributo', 'Alineación', 'Datos']);
  assert.equal(info.params.at(-1).value, 'a,bc');
  assert.equal(current(info), 9);
});

test('D has no semicolon: its first parameter follows the name', () => {
  const info = at('{D0300,02§50,0250|}');
  assert.deepEqual(values(info), ['0300', '0250', '0250']);
  assert.equal(current(info), 1);
});

test('AX, XS and LC are labelled by position', () => {
  // The optional fourth parameter of AX is listed with no value
  assert.deepEqual(values(first('{AX;+000,+000,+00|}')), ['+000', '+000', '+00', '']);
  assert.equal(first('{XS;I,0001,0002C4100|}').params.length, 3);
  const lc = first('{LC;0010,0020,0100,0020,0,2|}');
  assert.deepEqual(values(lc), ['0010', '0020', '0100', '0020', '0', '2', '']);
  assert.equal(lc.params[4].label, 'Tipo');
});

test('XB labels depend on the type: Code 39 widths, Code 128 module, QR and Data Matrix', () => {
  assert.equal(first('{XB001;0100,0200,3,1,02,02,06,06,00,0,0100,1|}').params[5].label, 'Barra estrecha');
  assert.equal(first('{XB001;0100,0200,9,1,02,0,0100,0,000,1,00|}').params[5].label, 'Módulo');
  assert.equal(first('{XB001;0100,0200,T,H,04,A,0,M2|}').params[5].label, 'Tamaño del módulo');
  assert.equal(first('{XB001;0100,0200,Q,20,04,00,0|}').params[5].label, 'Ancho de celda');
});

test('RC / RV / RB are the number and the data', () => {
  const info = first('{RC001;hola, mundo|}');
  assert.deepEqual(values(info), ['001', 'hola, mundo']);
  assert.equal(info.params[1].label, 'Datos');
});

test('SG keeps everything after its fifth comma as the data', () => {
  const info = first('{SG;0010,0020,0016,0016,0,ab,cd:ef;gh|}');
  assert.equal(info.params.length, 6);
  assert.equal(info.params[5].value, 'ab,cd:ef;gh');
});

test('a command with no parameters has none, an unknown one is known: false, text outside commands gives null', () => {
  const c = first('{C|}');
  assert.equal(c.id, '{C');
  assert.deepEqual(c.params, []);
  assert.equal(first('{ZZ1;1,2|}').known, false);
  assert.equal(at('hel§lo'), null);
});

test('parameters beyond the layout are reported as extra', () => {
  assert.equal(first('{D0300,0250,0250,99|}').extra, '99');
});

test('range gives every command of the selection in order, with no current parameter', () => {
  const text = '{D0300,0250,0250|}\n{C|}\n{PC001;0100,0200,05,05,J,00,B=hola|}\n{XS;I,0001,0002C4100|}';
  const infos = tpclHelp.range(text, text.indexOf('{PC'), text.indexOf('{XS'));
  assert.deepEqual(infos.map(info => info.id), ['{PC']);
  const all = tpclHelp.range(text, 0, text.length);
  assert.deepEqual(all.map(info => info.id), ['{D', '{C', '{PC', '{XS']);
  assert.ok(all.every(info => info.params.every(param => !param.current)));
});

test('the language registry exposes the help of TPCL and of ZPL', () => {
  for (const id of ['tpcl', 'zpl']) {
    const language = languages.get(id);
    assert.equal(typeof language.helpAt, 'function', id);
    assert.equal(typeof language.helpRange, 'function', id);
  }
  assert.equal(languages.get('tpcl').helpAt('{D0300,0250,0250|}', 3).id, '{D');
  assert.equal(languages.get('zpl').helpAt('^XA^FO10,10^FS^XZ', 5).id, '^FO');
});

test('every entry has a title, a description and a layout with labelled parameters', () => {
  for (const [name, entry] of Object.entries(tpclHelp.TABLE)) {
    assert.ok(entry.title && entry.description && typeof entry.layout === 'function', name);
    for (const param of entry.layout([])) assert.ok(param.label && param.description, `${name} has an unlabelled parameter`);
  }
});
