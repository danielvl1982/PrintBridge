const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/ui.js');
const { variables } = PB;

test('assigned() drops the placeholder values (a variable whose value is its own name) and keeps real and empty ones', () => {
  const values = { PN: '100001', LOT: 'LOT', EMPTY: '', MISSING: undefined, NONE: null };
  assert.deepEqual(variables.assigned(values), { PN: '100001', EMPTY: '' });
  assert.deepEqual(variables.assigned(undefined), {});
});

test('printing replaces the variables that have a value and sends the others as written', () => {
  const text = 'TEXT 10,10,"3",0,1,1,"PN: #PN# LOT: <#LOT#> X: #X#"';
  const replaced = variables.substitute(text, variables.assigned({ PN: '100001', LOT: 'LOT', X: '' }));
  assert.equal(replaced, 'TEXT 10,10,"3",0,1,1,"PN: 100001 LOT: <#LOT#> X: "');
});

test('js/app.js builds the printed bytes from the editor text with the assigned values', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /variables\.substitute\(source, variables\.assigned\(state\.values\)\)/);
  assert.match(app, /PB\.convert\.toBytes\(text, language\.id\)/);
});
