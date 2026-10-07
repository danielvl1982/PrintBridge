const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tspl.js');
const tspl = PB.languages.get('tspl');
const tpcl = PB.languages.get('tpcl');
const parse = (src, opts) => tspl.parse(src, opts);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('tspl is registered after tpcl', () => {
  assert.equal(tspl.id, 'tspl');
  assert.equal(tspl.name, 'TSPL (TSC TTP)');
  assert.deepEqual(PB.languages.all().map(l => l.id), ['tpcl', 'tspl']);
});

test('parse returns the neutral model with an undeclared size', () => {
  const model = parse('CLS\r\n');
  assert.equal(model.language, 'tspl');
  assert.deepEqual(model.items, []);
  assert.equal(model.size.width, null);
  assert.equal(model.size.height, null);
  assert.equal(model.size.gap, null);
  assert.deepEqual(model.diagnostics, []);
});

test('SIZE in inches (default), with decimals and the one-value form', () => {
  const two = parse('SIZE 4,2\r\n').size;
  assert.equal(two.width, 1016);
  assert.equal(two.height, 508);
  near(parse('SIZE 3.94,1.97').size.width, 3.94 * 254);
  const one = parse('SIZE 4').size;
  assert.equal(one.width, 1016);
  assert.equal(one.height, null);
});

test('SIZE in mm and dots (space before the unit), case-insensitive', () => {
  const mm = parse('SIZE 100 mm,60 mm').size;
  assert.equal(mm.width, 1000);
  assert.equal(mm.height, 600);
  near(parse('size 99.5 MM, 60.2 mm').size.width, 995);
  const dots = parse('SIZE 800 dot,480 dot', { dpi: 203 }).size;
  near(dots.width, 800 * 254 / 203);
  near(dots.height, 480 * 254 / 203);
  near(parse('SIZE 800 dot,480 dot', { dpi: 300 }).size.width, 800 * 254 / 300);
});

test('SIZE keeps the native text and an invalid SIZE warns', () => {
  assert.equal(parse('SIZE 100 mm,60 mm').size.native.sizeRaw, 'SIZE 100 mm,60 mm');
  const model = parse('SIZE abc');
  assert.equal(model.size.width, null);
  assert.equal(model.diagnostics.length, 1);
  assert.equal(model.diagnostics[0].level, 'warning');
});

test('GAP and BLINE are stored in size.gap / native in the same units', () => {
  const gap = parse('GAP 3 mm,0 mm').size;
  assert.equal(gap.gap, 30);
  assert.equal(gap.native.gapRaw, 'GAP 3 mm,0 mm');
  assert.equal(parse('GAP 0.12,0').size.gap, 0.12 * 254);
  const bline = parse('BLINE 2 mm,0').size;
  assert.equal(bline.gap, 20);
  assert.equal(bline.native.blineRaw, 'BLINE 2 mm,0');
});

test('CRLF, LF and CR line endings give the same commands', () => {
  const crlf = parse('SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\n').size;
  const lf = parse('SIZE 100 mm,60 mm\nGAP 3 mm,0 mm\nCLS\n').size;
  const cr = parse('SIZE 100 mm,60 mm\rGAP 3 mm,0 mm\rCLS\r').size;
  assert.equal(crlf.width, 1000);
  assert.deepEqual(lf, crlf);
  assert.deepEqual(cr, crlf);
});

test('ignored commands produce no diagnostics', () => {
  const src = [
    'DENSITY 8', 'SPEED 4', 'OFFSET 0 mm', 'SET TEAR ON', 'SET COUNTER @1 1', '@1="0001"', 'CODEPAGE 1252', 'COUNTRY 001',
    'FEED 10', 'BACKFEED 10', 'HOME', 'FORMFEED', 'LIMITFEED 5', 'SELFTEST', 'INITIALPRINTER', 'END', 'BLINEDETECT',
    'AUTODETECT', 'KILL "X"', 'FILES', 'DOWNLOAD "A.BAS"', 'EOP', 'RUN "A.BAS"', 'MOVE', 'INPUT', 'OUT "x"',
    'cls', 'PRINT 1,1',
  ].join('\r\n');
  assert.deepEqual(parse(src).diagnostics, []);
});

test('an unknown command warns in the TPCL style', () => {
  const model = parse('FROBNICATE 1,2,3 and a very long tail of text that is cut at forty chars\r\n');
  assert.equal(model.diagnostics.length, 1);
  assert.equal(model.diagnostics[0].level, 'warning');
  assert.equal(model.diagnostics[0].text, 'Comando no soportado por el visor: FROBNICATE 1,2,3 and a very long tail of');
});

test('DIRECTION 0 reports it is drawn as DIRECTION 1; DIRECTION 1 is silent', () => {
  const zero = parse('DIRECTION 0\r\n');
  assert.equal(zero.diagnostics.length, 1);
  assert.equal(zero.diagnostics[0].level, 'info');
  assert.match(zero.diagnostics[0].text, /DIRECTION 0/);
  assert.equal(zero.size.native.direction, 0);
  const one = parse('DIRECTION 1,0\r\n');
  assert.deepEqual(one.diagnostics, []);
  assert.equal(one.size.native.direction, 1);
  assert.equal(one.size.native.mirror, 0);
});

/** Context as parse() builds it, with the given setup commands already run. */
function ctxAfter(src, dpi) {
  return PB.tspl.run(src, { dpi });
}

test('REFERENCE and SHIFT offsets are applied by ctx.pos / ctx.len', () => {
  const { model, ctx } = ctxAfter('REFERENCE 16,24\r\nSHIFT 8,-8\r\n', 203);
  assert.deepEqual(model.diagnostics, []);
  const dot = 254 / 203;
  near(ctx.dot, dot);
  near(ctx.len(10), 10 * dot);
  const p = ctx.pos(100, 200);
  near(p.x, (100 + 16 + 8) * dot);
  near(p.y, (200 + 24 - 8) * dot);
  assert.deepEqual(ctx.reference, { x: 16, y: 24 });
  assert.deepEqual(ctx.shift, { x: 8, y: -8 });
});

test('SHIFT with a single value shifts only Y; the offsets default to zero', () => {
  assert.deepEqual(ctxAfter('SHIFT 12').ctx.shift, { x: 0, y: 12 });
  const { ctx } = ctxAfter('CLS');
  assert.deepEqual(ctx.reference, { x: 0, y: 0 });
  assert.deepEqual(ctx.shift, { x: 0, y: 0 });
  assert.equal(ctx.direction, 1);
});

test('dpi 300 vs 203 changes the dot size', () => {
  near(ctxAfter('CLS', 203).ctx.len(100), 100 * 254 / 203);
  near(ctxAfter('CLS', 300).ctx.len(100), 100 * 254 / 300);
  near(ctxAfter('CLS').ctx.len(100), 100 * 254 / PB.config.resolutions[0]);
});

test('tokenizer: names are case-insensitive and arguments respect quotes', () => {
  const cmds = [...PB.tspl.commands('text 10,20,"0",0,1,1,"Hello, world"\r\nBarcode 1,2,"128",50,1,0,2,2,"A\\"B,C"')];
  assert.equal(cmds.length, 2);
  assert.equal(cmds[0].name, 'TEXT');
  assert.equal(cmds[0].args.length, 7);
  assert.equal(cmds[0].args[2].value, '0');
  assert.equal(cmds[0].args[2].raw, '"0"');
  assert.equal(cmds[0].args[6].value, 'Hello, world');
  assert.equal(cmds[0].args[6].raw, '"Hello, world"');
  assert.equal(cmds[1].name, 'BARCODE');
  assert.equal(cmds[1].args.length, 9);
  assert.equal(cmds[1].args[8].value, 'A"B,C');
});

test('tokenizer: spans cover each command line', () => {
  const src = 'SIZE 4,2\r\n\r\nCLS\nPRINT 1';
  const cmds = [...PB.tspl.commands(src)];
  assert.deepEqual(cmds.map(c => src.slice(c.start, c.end)), ['SIZE 4,2', 'CLS', 'PRINT 1']);
  assert.deepEqual(cmds.map(c => c.raw), ['SIZE 4,2', 'CLS', 'PRINT 1']);
});

test('tokenizer: BITMAP data is read by length, including CR/LF/quote/comma bytes', () => {
  const data = '\r\n",\r' + String.fromCharCode(0xFF, 0x00); // 7 bytes = 7 x 1
  const src = `CLS\r\nBITMAP 10,20,7,1,0,${data}\r\nPRINT 1\r\n`;
  const cmds = [...PB.tspl.commands(src)];
  assert.deepEqual(cmds.map(c => c.name), ['CLS', 'BITMAP', 'PRINT']);
  const bitmap = cmds[1];
  assert.equal(bitmap.data.length, 7);
  assert.equal(bitmap.data, data);
  assert.equal(bitmap.raw, 'BITMAP 10,20,7,1,0,');
  assert.equal(bitmap.args.length, 5);
  assert.equal(src.slice(bitmap.start, bitmap.end), `BITMAP 10,20,7,1,0,${data}`);
  assert.equal(cmds[2].raw, 'PRINT 1');
});

test('tokenizer: BITMAP bytes are taken as chars & 0xFF and a truncated bitmap does not throw', () => {
  const src = 'BITMAP 0,0,2,2,0,ŁĂ';
  const [bitmap] = [...PB.tspl.commands(src)];
  assert.equal(bitmap.data.length, 2);
  assert.deepEqual([...bitmap.data].map(c => c.charCodeAt(0)), [0x41, 0x02]);
  const [cut] = [...PB.tspl.commands('BITMAP 0,0,4,4,0,ab')];
  assert.equal(cut.end, 'BITMAP 0,0,4,4,0,ab'.length);
});

test('ctx.sourceOf gives the span of the command line and a label', () => {
  const src = 'SIZE 4,2\r\nTEXT 1,2\r\n';
  const cmd = [...PB.tspl.commands(src)][1];
  const { ctx } = ctxAfter('CLS');
  assert.deepEqual(ctx.sourceOf(cmd), { spans: [{ start: 10, end: 18 }], label: 'TEXT 1,2' });
});

test('detect: TSPL text yes; TPCL, ZPL-like, plain and empty text no', () => {
  assert.equal(tspl.detect('SIZE 100 mm,60 mm\r\nCLS\r\n'), true);
  assert.equal(tspl.detect('cls\n'), true);
  assert.equal(tspl.detect('DENSITY 8\nTEXT 10,10,"3",0,1,1,"hi"'), true);
  assert.equal(tspl.detect('BARCODE 10,10,"128",50,1,0,2,2,"123"'), true);
  assert.equal(tspl.detect('QRCODE 10,10,L,4,A,0,"x"'), true);
  assert.equal(tspl.detect('BOX 1,2,3,4,5'), true);
  assert.equal(tspl.detect(''), false);
  assert.equal(tspl.detect('plain text'), false);
  assert.equal(tspl.detect('^XA^FO10,10^FDhello^FS^XZ'), false);
  assert.equal(tspl.detect('{D0300,0400,0300|}\n{C|}\n{XS;I,0001,0002C5000|}'), false);
  assert.equal(tspl.detect('SIZE is not a command'), false);
});

test('detect: the TPCL examples stay TPCL and TSPL text is not claimed by TPCL', () => {
  for (const example of PB.examples) assert.equal(PB.languages.detect(example.source).id, 'tpcl');
  assert.equal(PB.languages.detect('SIZE 100 mm,60 mm\r\nCLS\r\n').id, 'tspl');
  assert.equal(tpcl.detect('SIZE 100 mm,60 mm\r\nCLS\r\n'), false);
});
