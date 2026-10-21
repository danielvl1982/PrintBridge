const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tspl.js');
const tspl = PB.languages.get('tspl');

test('TSPL emit closes the printed label with END', () => {
  const model = { language: 'tspl', size: { width: 1000, height: 600, native: {} }, items: [] };
  assert.match(tspl.emit(model, { dpi: 203 }).text, /PRINT 1,1\r\nEND\r\n$/);
});

test('TSPL RAW print adds END after a final PRINT without changing the editor source', () => {
  const source = 'SIZE 100 mm,60 mm\r\nCLS\r\nPRINT 1,1\r\n';
  assert.equal(tspl.prepareForPrint(source), `${source}END\r\n`);
  assert.equal(source, 'SIZE 100 mm,60 mm\r\nCLS\r\nPRINT 1,1\r\n');
  assert.equal(tspl.prepareForPrint('CLS\nPRINT 1,1'), 'CLS\nPRINT 1,1\nEND\n');
});

test('TSPL RAW print does not duplicate END or alter non-label programs', () => {
  const closed = 'CLS\r\nPRINT 1,1\r\nEND\r\n';
  assert.equal(tspl.prepareForPrint(closed), closed);
  assert.equal(tspl.prepareForPrint('DOWNLOAD "DEMO.BAS"\r\nPRINT 1\r\nEOP\r\n'), 'DOWNLOAD "DEMO.BAS"\r\nPRINT 1\r\nEOP\r\n');
  assert.equal(tspl.prepareForPrint('CLS\r\n'), 'CLS\r\n');
});

test('TSPL print preparation preserves BITMAP payload bytes and does not affect TPCL', () => {
  const source = 'SIZE 100 mm,60 mm\r\nBITMAP 0,0,1,1,0,\xff\r\nPRINT 1,1\r\n';
  const original = PB.convert.toBytes(source, 'tspl');
  const prepared = PB.convert.toBytes(tspl.prepareForPrint(source), 'tspl');
  assert.deepEqual(Array.from(prepared.slice(0, original.length)), Array.from(original));
  assert.deepEqual(Array.from(prepared.slice(original.length)), Array.from(Buffer.from('END\r\n', 'latin1')));
  assert.equal(PB.languages.get('tpcl').prepareForPrint, undefined);
});
