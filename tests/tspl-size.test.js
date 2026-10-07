const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// size-from-label T3: TSPL writes the label size (SIZE and GAP) from the Formato row.
const PB = loadUpTo('js/languages/tspl.js');
const tspl = PB.languages.get('tspl');

const size = (w, h, p) => ({ w, h, p: p === undefined ? h : p });
const MM = (w, h, p) => size(w * 10, h * 10, p === undefined ? undefined : p * 10);

test('sizeCommands: SIZE always, GAP only when the pitch is larger than the height', () => {
  assert.deepEqual(tspl.sizeCommands(MM(100, 60, 63)), ['SIZE 100 mm,60 mm', 'GAP 3 mm,0 mm']);
  assert.deepEqual(tspl.sizeCommands(MM(99, 55.5, 58.7)), ['SIZE 99 mm,55.5 mm', 'GAP 3.2 mm,0 mm']);
  assert.deepEqual(tspl.sizeCommands(MM(100, 60)), ['SIZE 100 mm,60 mm']);
  assert.deepEqual(tspl.sizeCommands(size(1000, 600, 600)), ['SIZE 100 mm,60 mm']);
});

test('applySize replaces the SIZE and GAP lines and nothing else', () => {
  const text = 'SIZE 4,3\r\nGAP 0.12,0\r\nDIRECTION 1\r\nCLS\r\nTEXT 10,10,"3",0,1,1,"Hi"\r\nPRINT 1,1\r\n';
  assert.equal(tspl.applySize(text, MM(100, 60, 63)),
    'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nTEXT 10,10,"3",0,1,1,"Hi"\r\nPRINT 1,1\r\n');
});

test('applySize matches the commands like the parser: case-insensitive, leading whitespace', () => {
  const out = tspl.applySize('  size 4,3\r\n\tgap 2 mm,0\r\nCLS\r\n', MM(50, 30, 33));
  assert.equal(out, '  SIZE 50 mm,30 mm\r\n\tGAP 3 mm,0 mm\r\nCLS\r\n');
});

test('applySize inserts SIZE at the top and GAP right after it when they are missing', () => {
  assert.equal(tspl.applySize('CLS\r\nPRINT 1,1\r\n', MM(100, 60, 63)),
    'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nPRINT 1,1\r\n');
  // SIZE present, GAP missing: GAP goes right after the SIZE line
  assert.equal(tspl.applySize('DIRECTION 1\r\nSIZE 4,3\r\nCLS\r\n', MM(100, 60, 63)),
    'DIRECTION 1\r\nSIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\n');
  // GAP present, SIZE missing: SIZE at the top, GAP replaced in place
  assert.equal(tspl.applySize('CLS\r\nGAP 0.1,0\r\n', MM(100, 60, 63)),
    'SIZE 100 mm,60 mm\r\nCLS\r\nGAP 3 mm,0 mm\r\n');
});

test('applySize with pitch == height writes no GAP and leaves an existing one untouched', () => {
  assert.equal(tspl.applySize('SIZE 4,3\r\nGAP 0.12,0\r\nCLS\r\n', MM(100, 60)), 'SIZE 100 mm,60 mm\r\nGAP 0.12,0\r\nCLS\r\n');
  assert.equal(tspl.applySize('CLS\r\n', MM(100, 60)), 'SIZE 100 mm,60 mm\r\nCLS\r\n');
});

test('applySize keeps the line ending and the trailing newline of the file', () => {
  const s = MM(100, 60, 63);
  assert.equal(tspl.applySize('CLS\nPRINT 1,1\n', s), 'SIZE 100 mm,60 mm\nGAP 3 mm,0 mm\nCLS\nPRINT 1,1\n');
  assert.equal(tspl.applySize('CLS\r\nPRINT 1,1', s), 'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nPRINT 1,1');
  assert.equal(tspl.applySize('SIZE 4,3\nCLS', s), 'SIZE 100 mm,60 mm\nGAP 3 mm,0 mm\nCLS');
  assert.equal(tspl.applySize('SIZE 4,3', s), 'SIZE 100 mm,60 mm\nGAP 3 mm,0 mm');
  assert.equal(tspl.applySize('', s), 'SIZE 100 mm,60 mm\nGAP 3 mm,0 mm\n');
});

test('applySize never touches BITMAP bytes (latin1) or BLINE', () => {
  const data = 'a\xE9,\r\n"\x00\x80';
  const text = `SIZE 4,3\r\nBLINE 2 mm,0\r\nCLS\r\nBITMAP 0,0,2,4,0,${data}\r\nTEXT 1,1,"3",0,1,1,"\xF1"\r\nPRINT 1,1\r\n`;
  const out = tspl.applySize(text, MM(100, 60, 63));
  assert.equal(out, text.replace('SIZE 4,3\r\n', 'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\n'));
  assert.ok(out.includes(data));
  assert.ok(out.includes('BLINE 2 mm,0'));
});

test('applySize does not rewrite SIZE or GAP words inside quoted content or other commands', () => {
  const text = 'TEXT 10,10,"3",0,1,1,"SIZE 4,3"\r\nBARCODE 10,40,"128",40,1,0,2,2,"GAP 1,0"\r\nPRINT 1,1\r\n';
  const out = tspl.applySize(text, MM(100, 60, 63));
  assert.ok(out.startsWith('SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nTEXT 10,10'));
  assert.ok(out.includes('"SIZE 4,3"') && out.includes('"GAP 1,0"'));
  assert.equal(out.split('SIZE 100 mm').length, 2);
});

test('applySize is idempotent', () => {
  for (const text of ['SIZE 4,3\r\nGAP 0.1,0\r\nCLS\r\n', 'CLS\n', '', 'SIZE 4,3']) {
    for (const s of [MM(100, 60, 63), MM(100, 60)]) {
      const once = tspl.applySize(text, s);
      assert.equal(tspl.applySize(once, s), once);
    }
  }
});

test('round trip: the parser reads back the width and height and the gap (pitch - height) that were written', () => {
  for (const s of [MM(100, 60, 63), MM(99, 55), MM(80, 50, 53), MM(40.5, 30.5, 33.5)]) {
    for (const text of ['CLS\r\n', 'SIZE 4,3\r\nGAP 0.12,0\r\nCLS\r\n']) {
      const model = tspl.parse(tspl.applySize(text, s));
      assert.equal(model.size.width, s.w);
      assert.equal(model.size.height, s.h);
      // the TSPL parser reports the separation as `gap` and never derives a pitch (the conversion to TPCL relies on it)
      assert.equal(model.size.pitch, null);
      if (s.p > s.h) assert.equal(+(model.size.height + model.size.gap).toFixed(4), s.p);
    }
  }
  // no GAP written and none present: the separation is unknown
  assert.equal(tspl.parse(tspl.applySize('CLS\r\n', MM(99, 55))).size.gap, null);
});

test('end to end: PB.sizes.apply writes a TSPL label through the detected language', () => {
  const text = 'SIZE 4,3\r\nCLS\r\nTEXT 10,10,"3",0,1,1,"Hi"\r\nPRINT 1,1\r\n';
  const result = PB.sizes.apply(PB.languages.detect(text), text, MM(100, 60, 63));
  assert.equal(result.supported, true);
  assert.equal(result.text, 'SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nTEXT 10,10,"3",0,1,1,"Hi"\r\nPRINT 1,1\r\n');
});
