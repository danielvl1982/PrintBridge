const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// C1: the ZPL command help under the caret (js/languages/zpl-help.js). Offsets are positions in the text; "|" in the helper marks the caret.
const { zplHelp, slices } = loadApp();

/** Help for a text with the caret marked by "|". */
const at = marked => {
  const offset = marked.indexOf('|');
  return zplHelp.at(marked.replace('|', ''), offset);
};
const current = info => info.params.findIndex(param => param.current);

test('the caret on a command name explains the command and has no current parameter... until a parameter is reached', () => {
  const onName = at('^XA\n^F|O10,20^FS');
  assert.equal(onName.id, '^FO');
  assert.equal(onName.title, 'Origen del campo');
  assert.deepEqual(onName.params.map(param => param.label), ['Posición X', 'Posición Y']);
});

test('the current parameter is the one between the commas around the caret, with its value', () => {
  const first = at('^FO1|0,20^FS');
  assert.equal(current(first), 0);
  assert.equal(first.params[0].value, '10');
  assert.equal(first.params[1].value, '20');
  const second = at('^FO10,2|0^FS');
  assert.equal(current(second), 1);
  assert.equal(second.extra, null);
});

test('a caret right after a comma is on the next parameter, even when it is empty', () => {
  const info = at('^BCN,,|Y');
  assert.equal(info.id, '^BC');
  assert.equal(current(info), 2);
  assert.equal(info.params[1].value, '');
});

test('the caret at the boundary between two commands belongs to the one that starts there', () => {
  assert.equal(at('^FO10,20^FS|^FO5,5').id, '^FO');
  assert.equal(at('^FO10,20|^FS^FO5,5').id, '^FS');
});

test('^A has the font letter and the orientation glued to its name', () => {
  assert.equal(current(at('^A|0N,30,40')), 0);
  assert.equal(current(at('^A0|N,30,40')), 1);
  assert.equal(current(at('^A0N,3|0,40')), 2);
  assert.equal(current(at('^A0N,30,4|0')), 3);
  const info = at('^A0N,30,4|0');
  assert.deepEqual(info.params.map(param => param.value), ['0', 'N', '30', '40']);
  // No orientation: the first comma follows the font letter, so what comes next is still the orientation slot (positional)
  assert.equal(current(at('^A0,3|0,40')), 1);
  assert.equal(current(at('^A0,,3|0')), 2);
});

test('the data of ^FD is its only parameter and a comma inside it does not split it', () => {
  const info = at('^FDa,b|c^FS');
  assert.equal(info.id, '^FD');
  assert.equal(info.params.length, 1);
  assert.equal(info.params[0].value, 'a,bc');
});

test('commas inside the quotes of ^FN do not count', () => {
  const info = at('^FN1"a,b|"');
  assert.equal(info.id, '^FN');
  assert.equal(current(info), 0);
});

test('a command with no parameters in the guide has none current', () => {
  const info = at('^F|S');
  assert.equal(info.id, '^FS');
  assert.equal(current(info), -1);
});

test('parameters beyond the guide are reported as extra', () => {
  const info = at('^FO10,20,3|0^FS');
  assert.equal(info.extra, '30');
});

test('a command with no entry is known: false and still named', () => {
  const info = at('^X|X');
  assert.equal(info.id, '^XX');
  assert.equal(info.known, false);
  assert.deepEqual(info.params, []);
});

test('the caret outside any command gives null', () => {
  assert.equal(at('hel|lo'), null);
  assert.equal(at('|'), null);
});

test('the caret at the very end of the text is on the last command', () => {
  assert.equal(at('^FO10,20^FS|').id, '^FS');
});

test('a ^CC change moves the command prefix', () => {
  assert.equal(at('^CC+\n+FO10,|20^FS').id, '^FO');
});

test('every barcode entry has as many parameters as the parser knows', () => {
  const { COMMANDS } = slices.barcode.zplTables;
  for (const [name, { params }] of Object.entries(COMMANDS)) {
    assert.ok(zplHelp.TABLE[name], `^${name} has no help entry`);
    assert.equal(zplHelp.TABLE[name].params.length, params.length, `^${name}: help has ${zplHelp.TABLE[name].params.length} parameters, the parser ${params.length}`);
  }
});

test('every entry has a title, a description and labelled parameters', () => {
  for (const [name, entry] of Object.entries(zplHelp.TABLE)) {
    assert.ok(entry.title && entry.description, `^${name} lacks a title or a description`);
    for (const param of entry.params) assert.ok(param.label && param.description, `^${name} has an unlabelled parameter`);
  }
});

// The help lives in its own panel at the top of the left column, above the code box (not inside Propiedades)
test('the help panel is the first of the left column, above Código de etiqueta, and starts hidden', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const column = html.slice(html.indexOf('<div class="column">'), html.indexOf('<div class="stage">'));
  const help = column.indexOf('id="cmdHelp"');
  assert.ok(help > 0 && help < column.indexOf('<h2>Código de etiqueta</h2>'), 'cmdHelp comes before Código');
  assert.match(column.slice(column.lastIndexOf('<section', help), column.indexOf('>', help)), /data-collapsible="help"[^>]*hidden/);
  assert.ok(column.indexOf('id="propsHelp"') > help && column.indexOf('id="propsHelp"') < column.indexOf('id="src"'), 'the content sits inside the panel, above #src');
  const props = html.slice(html.indexOf('id="propsPanel"'), html.indexOf('class="panel preview"'));
  assert.ok(!props.includes('propsHelp'), 'Propiedades no longer holds the help');
});
