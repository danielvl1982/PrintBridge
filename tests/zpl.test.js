const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// Z1: ZPL language core: tokenizer, label setup commands, detection, registration, emit skeleton, size writing, insertCommand
// and the data escaping. Commands and defaults come from the ZPL II Programming Guide Volume One (2003); what it does not
// document is marked "not verified" in js/languages/zpl.js. No component has a ZPL factory yet (Z2 onwards), so no item is drawn here.
const PB = loadUpTo('js/languages/zpl.js');
const zpl = PB.languages.get('zpl');
const { commands, run } = PB.zpl;

const cmds = src => [...commands(src)];
const ids = src => cmds(src).map(c => c.id);
const parse = (src, dpi = 203) => zpl.parse(src, { dpi });
const texts = model => model.diagnostics.map(d => `${d.level}: ${d.text}`);

// ---------------------------------------------------------------------------------------------------------------
// Registration

test('ZPL is registered after TPCL and TSPL with its name, extension and encoding', () => {
  assert.deepEqual(PB.languages.all().map(l => l.id), ['tpcl', 'tspl', 'zpl']);
  assert.equal(zpl.name, 'ZPL (Zebra)');
  assert.equal(zpl.fileExtension, 'zpl');
  assert.equal(zpl.fileEncoding, 'utf-8');
  for (const hook of ['detect', 'parse', 'emit', 'sizeCommands', 'applySize', 'insertCommand', 'moveItem', 'describeItem', 'updateItem', 'componentTemplates', 'buildComponent']) {
    assert.equal(typeof zpl[hook], 'function', hook);
  }
  // the image slice gives ZPL the Imagen entry (Z6): the preview picture is written as a ^GF field
  assert.equal(zpl.insertImage, true);
  assert.equal(typeof zpl.imageCommand, 'function');
});

test('the converter offers ZPL as a target next to TPCL and TSPL, with the .zpl name and UTF-8 bytes', () => {
  assert.deepEqual(PB.convert.targets().map(t => t.id), ['tpcl', 'tspl', 'zpl']);
  assert.equal(PB.convert.targets()[2].name, 'ZPL (Zebra)');
  assert.equal(PB.convert.fileName('zpl'), 'etiqueta.zpl');
  assert.equal(PB.convert.fileName('zpl', 'C:\\x\\bobina.ter'), 'bobina.zpl');
  assert.deepEqual(Array.from(PB.convert.toBytes('^FDñ', 'zpl')), Array.from(new TextEncoder().encode('^FDñ')));
});

test('PB.zpl exposes the tokenizer, the driver and the helpers for the slices', () => {
  for (const name of ['commands', 'run', 'createContext']) assert.equal(typeof PB.zpl[name], 'function', name);
  assert.ok(PB.zpl.SLICE_HELPERS && Object.isFrozen(PB.zpl.SLICE_HELPERS));
  for (const name of ['sourceOf', 'num', 'int', 'rotationOf', 'orientationOf', 'toDots', 'safeData', 'fieldData', 'insertCommand', 'itemRotation', 'dropDots', 'lengthDots', 'numberField', 'contentField']) {
    assert.equal(typeof PB.zpl.SLICE_HELPERS[name], 'function', name);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Tokenizer

test('commands: names of 2 characters and of 1 character (^A), ^A@, with the id written with the standard prefix', () => {
  assert.deepEqual(ids('^XA^FO10,20^A0N,30,30^A@N,25,25,E:ARIAL.TTF^BCN,100^FS^XZ'), ['^XA', '^FO', '^A', '^A@', '^BC', '^FS', '^XZ']);
  const [, , a] = cmds('^XA^FO10,20^A0N,30,30');
  assert.equal(a.name, 'A');
  assert.deepEqual(a.args.map(x => x.raw), ['0N', '30', '30']);
});

test('commands: raw, start and end of each command and the offsets of every argument', () => {
  const src = '^XA\r\n^FO 10 , 20 \r\n^GB100,50,3^FS';
  const [xa, fo, gb] = cmds(src);
  assert.equal(src.slice(xa.start, xa.end), '^XA');
  assert.equal(fo.raw, '^FO 10 , 20');
  assert.equal(src.slice(fo.start, fo.end), '^FO 10 , 20');
  assert.deepEqual(fo.args.map(a => a.raw), ['10', '20']);
  for (const cmd of [fo, gb]) for (const a of cmd.args) assert.equal(src.slice(a.start, a.end), a.raw);
  assert.equal(gb.args.length, 3);
});

test('commands: names are case-insensitive, an empty argument keeps its position, a bare prefix has an empty name', () => {
  assert.equal(cmds('^fo10,20')[0].id, '^FO');
  const fo = cmds('^FO,50')[0];
  assert.deepEqual(fo.args.map(a => a.raw), ['', '50']);
  assert.equal(fo.args[0].start, fo.args[0].end);
  assert.equal(cmds('^ ^XA')[0].name, '');
  assert.deepEqual(ids('hello world, no commands'), []);
});

test('commands: ~ control commands have the ~ id and control = true', () => {
  const [sd, xa] = cmds('~SD15\r\n^XA');
  assert.equal(sd.id, '~SD');
  assert.equal(sd.control, true);
  assert.deepEqual(sd.args.map(a => a.raw), ['15']);
  assert.equal(xa.control, false);
});

test('commands: ^FD data runs up to the next command, commas and quotes included; the line break before the next command is not data', () => {
  const src = '^FO1,2^FDa,b c;"x" é\r\n^FS';
  const fd = cmds(src)[1];
  assert.equal(fd.id, '^FD');
  assert.equal(fd.args.length, 1);
  assert.equal(fd.args[0].raw, 'a,b c;"x" é');
  assert.equal(fd.args[0].value, 'a,b c;"x" é');
  assert.equal(src.slice(fd.args[0].start, fd.args[0].end), fd.args[0].raw);
  assert.equal(src.slice(fd.start, fd.end), '^FDa,b c;"x" é');
});

test('commands: spaces inside the data are data, an empty ^FD has an empty argument at its position', () => {
  assert.equal(cmds('^FD  two  ^FS')[0].args[0].raw, '  two  ');
  const empty = cmds('^FD^FS')[0];
  assert.equal(empty.args[0].raw, '');
  assert.equal(empty.args[0].start, empty.args[0].end);
});

test('commands: ^FV is data like ^FD; line breaks inside the data are dropped from its value but kept in the raw text', () => {
  const [fv] = cmds('^FVline1\r\nline2^FS');
  assert.equal(fv.id, '^FV');
  assert.equal(fv.args[0].raw, 'line1\r\nline2');
  assert.equal(fv.args[0].value, 'line1line2');
});

test('commands: ^FH enables the _XX hex escapes of the data of that field (^FH with another indicator too); ^FS switches them off', () => {
  assert.equal(cmds('^FH^FDA_5EB_7E_5Fc^FS')[1].args[0].value, 'A^B~_c');
  assert.equal(cmds('^FH\\^FDx\\5Ey_5E^FS')[1].args[0].value, 'x^y_5E');
  const [, fd1, , fd2] = cmds('^FH^FDa_41^FS^FDb_41^FS');
  assert.equal(fd1.args[0].value, 'aA');
  assert.equal(fd2.args[0].value, 'b_41');
  // not an escape: fewer than two hex digits, or not hex
  assert.equal(cmds('^FH^FD_4 _G1 _4^FS')[1].args[0].value, '_4 _G1 _4');
  // the raw text keeps the escapes
  assert.equal(cmds('^FH^FD_5E^FS')[1].args[0].raw, '_5E');
});

test('commands: ^FX is a comment up to the next command; its text is one argument', () => {
  const [fx, fo] = cmds('^FXthis, is a comment ^FO1,2');
  assert.equal(fx.id, '^FX');
  assert.equal(fx.args[0].raw, 'this, is a comment ');
  assert.equal(fo.id, '^FO');
});

test('commands: a format without the closing ^FS or ^XZ still ends its last command at the end of the text', () => {
  assert.deepEqual(ids('^XA^FO1,2^FDabc'), ['^XA', '^FO', '^FD']);
  assert.equal(cmds('^XA^FO1,2^FDabc')[2].args[0].raw, 'abc');
});

test('commands: several formats in one text are a single stream', () => {
  assert.deepEqual(ids('^XA^FO1,1^FDa^FS^XZ\r\n^XA^FO2,2^FDb^FS^XZ\r\n'), ['^XA', '^FO', '^FD', '^FS', '^XZ', '^XA', '^FO', '^FD', '^FS', '^XZ']);
});

test('commands: LF and CRLF files give the same commands', () => {
  const lf = '^XA\n^FO10,20\n^A0N,30,30\n^FDHello\n^FS\n^XZ\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const strip = list => list.map(c => [c.id, c.args.map(a => a.value)]);
  assert.deepEqual(strip(cmds(crlf)), strip(cmds(lf)));
});

test('commands: the control characters STX, ETX and SI stand for ^XA, ^XZ and ^FS', () => {
  assert.deepEqual(ids('\x02^FO1,2^FDx\x0F\x03'), ['^XA', '^FO', '^FD', '^FS', '^XZ']);
});

test('commands: ^GF takes the data after its fourth comma as one argument (the ASCII hex data uses commas as fill characters)', () => {
  const [gf] = cmds('^GFA,8,8,1,,FF,0F\r\n^FS');
  assert.deepEqual(gf.args.map(a => a.raw), ['A', '8', '8', '1', ',FF,0F']);
});

test('commands: ^CC / ~CC change the format prefix, ^CT the control prefix and ^CD the delimiter (one character, taken right after the name)', () => {
  assert.deepEqual(ids('^CC/\r\n/XA/FO10,10/FDx/FS/XZ'), ['^CC', '^XA', '^FO', '^FD', '^FS', '^XZ']);
  assert.deepEqual(ids('^CC/^XA/XZ'), ['^CC', '^XZ']);
  const ct = cmds('^CT+\r\n+SD15^XA');
  assert.deepEqual(ct.map(c => c.id), ['^CT', '~SD', '^XA']);
  assert.equal(ct[1].control, true);
  assert.deepEqual(cmds('^CD.^XA^FO10.20^FS').find(c => c.id === '^FO').args.map(a => a.raw), ['10', '20']);
  // a ~CC prefix change is the same as ^CC
  assert.deepEqual(ids('~CC/\r\n/XA'), ['~CC', '^XA']);
});

// ---------------------------------------------------------------------------------------------------------------
// Label setup

test('^PW and ^LL give the size in 0.1 mm at the resolution, rounded to 0.1 mm; the dots are kept in native', () => {
  const m203 = parse('^XA^PW812^LL1218^XZ', 203);
  assert.equal(m203.language, 'zpl');
  assert.deepEqual([m203.size.width, m203.size.height, m203.size.pitch, m203.size.gap], [1016, 1524, null, null]);
  assert.equal(m203.size.native.pw, 812);
  assert.equal(m203.size.native.ll, 1218);
  const m300 = parse('^XA^PW1200^LL600^XZ', 300);
  assert.deepEqual([m300.size.width, m300.size.height], [1016, 508]);
  assert.deepEqual(m203.diagnostics, []);
});

test('a label without ^PW / ^LL declares no size; invalid values are warnings and the last valid one wins; one outside 2..32000 is drawn at the limit', () => {
  const none = parse('^XA^XZ');
  assert.deepEqual([none.size.width, none.size.height], [null, null]);
  const bad = parse('^XA^PW400^PWabc^LL^PW400^PWx^XZ', 254);
  assert.equal(bad.size.width, 400);
  assert.equal(bad.diagnostics.filter(d => d.level === 'warning' && /\^PW/.test(d.text)).length, 2);
  const zero = parse('^XA^PW400^PW0^XZ', 254); // V9: 0 is outside 2..32000, read as written and drawn as the smallest valid width
  assert.equal(zero.size.width, 2);
  assert.equal(zero.size.native.pw, 0);
  assert.equal(bad.diagnostics.filter(d => d.level === 'warning' && /\^LL/.test(d.text)).length, 1);
});

test('^LH, ^LS and ^LT feed the position conversion: x = (x + LH.x - LS) dots, y = (y + LH.y + LT) dots, in 0.1 mm', () => {
  const { ctx } = run('^XA^LH100,50^LS20^LT-5^XZ', { dpi: 254 });
  assert.deepEqual(ctx.lh, { x: 100, y: 50 });
  assert.equal(ctx.ls, 20);
  assert.equal(ctx.lt, -5);
  assert.deepEqual(ctx.pos(10, 10), { x: 90, y: 55 });
  assert.equal(ctx.len(8), 8);
  const m = run('^XA^LH100,50^XZ', { dpi: 203 }).ctx;
  assert.ok(Math.abs(m.pos(0, 0).x - 100 * 254 / 203) < 1e-9);
});

test('^LH / ^LS / ^LT with invalid values are warnings and leave the previous value', () => {
  const { model, ctx } = run('^XA^LH10,20^LHx,y^LS^LT^XZ', { dpi: 254 });
  assert.deepEqual(ctx.lh, { x: 10, y: 20 });
  assert.equal(model.diagnostics.filter(d => d.level === 'warning').length, 3);
});

test('^FW sets the default orientation (a missing parameter is ignored, an invalid one warns); ^CF the default font; ^BY the bar code defaults', () => {
  const a = run('^XA^FWR^XZ').ctx;
  assert.equal(a.orientation, 'R');
  const b = run('^XA^FWR^FW^XZ');
  assert.equal(b.ctx.orientation, 'R');
  assert.deepEqual(b.model.diagnostics, []);
  assert.equal(run('^XA^FWQ^XZ').model.diagnostics.length, 1);
  const initial = run('^XA^XZ').ctx;
  assert.equal(initial.orientation, 'N');
  assert.deepEqual(initial.font, { name: 'A', height: 9, width: 5, explicit: false });
  assert.deepEqual(run('^XA^CF0,70,93^XZ').ctx.font, { name: '0', height: 70, width: 93, explicit: true });
  // only the height: the width becomes proportional (null); no value at all: the previous ones stay
  assert.deepEqual(run('^XA^CFD,40^XZ').ctx.font, { name: 'D', height: 40, width: null, explicit: true });
  assert.deepEqual(run('^XA^CFD,40^CF^XZ').ctx.font, { name: 'D', height: 40, width: null, explicit: true });
  // a ^CF with only the font letter gives no sizes (Volume Two, page 63 is about ^CF with sizes)
  assert.deepEqual(run('^XA^CFD^XZ').ctx.font, { name: 'D', height: 9, width: 5, explicit: false });
  assert.deepEqual(initial.by, { module: 2, ratio: 3, height: 10 });
  assert.deepEqual(run('^XA^BY3,2.5,50^XZ').ctx.by, { module: 3, ratio: 2.5, height: 50 });
  assert.deepEqual(run('^XA^BY4^XZ').ctx.by, { module: 4, ratio: 3, height: 10 });
});

test('^PO: N is the default, I (inverted 180 degrees) is reported as an info and not applied', () => {
  assert.deepEqual(parse('^XA^PON^XZ').diagnostics, []);
  const inverted = parse('^XA^POI^XZ');
  assert.equal(inverted.diagnostics.length, 1);
  assert.equal(inverted.diagnostics[0].level, 'info');
  assert.match(inverted.diagnostics[0].text, /\^PO/);
  assert.equal(inverted.size.native.invert, true);
  assert.equal(parse('^XA^POX^XZ').diagnostics[0].level, 'warning');
});

test('^CI is accepted (kept in the context, nothing is drawn differently)', () => {
  const { model, ctx } = run('^XA^CI13^XZ');
  assert.equal(ctx.charset, 13);
  assert.deepEqual(model.diagnostics, []);
});

test('printer configuration commands are recognised and not drawn: one info per label lists them', () => {
  const model = parse('^XA^MMT^PR4,4^MD10^MNY~SD15^PQ1^LH0,0^XZ');
  assert.equal(model.diagnostics.length, 1);
  assert.equal(model.diagnostics[0].level, 'info');
  for (const id of ['^MM', '^PR', '^MD', '^MN', '~SD', '^PQ']) assert.ok(model.diagnostics[0].text.includes(id), id);
  assert.ok(!model.diagnostics[0].text.includes('^LH'));
});

test('unknown commands are one warning each, and ^FX comments and the tolerated empty ^FS are silent', () => {
  const model = parse('^XA^FXcomment^FS^ZQ1^YY^FS^XZ');
  assert.deepEqual(texts(model).map(t => t.split(':')[0]), ['warning', 'warning']);
  assert.match(model.diagnostics[0].text, /\^ZQ1/);
  assert.match(model.diagnostics[1].text, /\^YY/);
});

test('a field whose command has no handler (^GS, the graphic symbol) reports it once and draws nothing; the text (Z2) is drawn', () => {
  const model = parse('^XA^FO10,10^A0N,30,30^FDHi^FS^FO10,60^GSN,30,30^FDA^FS^XZ');
  assert.deepEqual(model.items.map(i => [i.kind, i.data]), [['text', 'Hi']]);
  assert.equal(model.diagnostics.filter(d => d.level === 'warning').length, 1);
  assert.match(model.diagnostics[0].text, /\^GSN,30,30/);
});

test('several formats: the first one is shown and an info says how many there are', () => {
  const model = parse('^XA^PW400^LL300^XZ\r\n^XA^PW800^LL600^XZ\r\n^XA^XZ', 254);
  assert.equal(model.size.width, 400);
  assert.equal(model.size.height, 300);
  const infos = model.diagnostics.filter(d => d.level === 'info');
  assert.equal(infos.length, 1);
  assert.match(infos[0].text, /3 /);
  assert.match(infos[0].text, /primer/);
  assert.equal(parse('^XA^PW400^XZ').diagnostics.length, 0);
});

test('commands before ^XA (printer state) apply, an empty or unrecognised text parses to an empty model', () => {
  assert.equal(parse('^PW400\r\n^XA^XZ', 254).size.width, 400);
  const empty = parse('');
  assert.deepEqual([empty.items, empty.diagnostics, empty.size.width], [[], [], null]);
});

// ---------------------------------------------------------------------------------------------------------------
// Detection

const TPCL_LABEL = '{D0610,0990,0550|}\r\n{C|}\r\n{PC001;0050,0020,05,05,J,00,B=Hola|}\r\n{XS;I,0001,0002C4100|}';
const TSPL_LABEL = 'SIZE 100 mm,60 mm\r\nCLS\r\nTEXT 10,10,"3",0,1,1,"Hola"\r\nPRINT 1,1\r\n';

test('detect: a ^XA format, or at least two ZPL commands, is ZPL', () => {
  assert.equal(zpl.detect('^XA^XZ'), true);
  assert.equal(zpl.detect('^xa\r\n^xz'), true);
  assert.equal(zpl.detect('^XA\r\n^FO10,10^A0N,30,30^FDHi^FS\r\n^XZ'), true);
  assert.equal(zpl.detect('^FO10,10^FDHi^FS'), true);
  assert.equal(zpl.detect('~SD15\r\n^PW812\r\n'), true);
});

test('detect: other text is not ZPL (empty, prose, a single command, TPCL, TSPL)', () => {
  assert.equal(zpl.detect(''), false);
  assert.equal(zpl.detect('hola ^ mundo ~ nada'), false);
  assert.equal(zpl.detect('^FDsolo'), false);
  assert.equal(zpl.detect(TPCL_LABEL), false);
  assert.equal(zpl.detect(TSPL_LABEL), false);
  assert.equal(zpl.detect('{PC001;0010,0010,05,05,J,00,B=^XA^FO|}'), false);
  assert.equal(zpl.detect(undefined), false);
});

test('the registry picks the right language for TPCL, TSPL and ZPL examples; TPCL and TSPL detection is unchanged', () => {
  for (const example of PB.examples) assert.equal(PB.languages.detect(example.source).id, example.language, example.id);
  assert.equal(PB.languages.detect(TPCL_LABEL).id, 'tpcl');
  assert.equal(PB.languages.detect(TSPL_LABEL).id, 'tspl');
  assert.equal(PB.languages.detect('^XA\r\n^PW812\r\n^XZ').id, 'zpl');
  assert.equal(PB.languages.get('tpcl').detect('^XA^FO10,10^FDx^FS^XZ'), false);
  assert.equal(PB.languages.get('tspl').detect('^XA^FO10,10^FDx^FS^XZ'), false);
  assert.equal(PB.languages.detect('plain text'), null);
});

// ---------------------------------------------------------------------------------------------------------------
// Emit skeleton

test('emit writes ^XA, ^PW, ^LL and ^XZ with CRLF and a trailing line break, in dots at the resolution', () => {
  const model = { language: 'zpl', size: { width: 1016, height: 1524, pitch: null, gap: null, native: {} }, items: [], diagnostics: [] };
  const out = PB.languages.emit('zpl', model, { dpi: 203 });
  assert.equal(out.text, '^XA\r\n^PW812\r\n^LL1218\r\n^XZ\r\n');
  assert.deepEqual(out.diagnostics, []);
  assert.equal(PB.languages.emit('zpl', model, { dpi: 300 }).text, '^XA\r\n^PW1200\r\n^LL1800\r\n^XZ\r\n');
});

test('emit without a declared size writes no ^PW / ^LL and warns; an item without a ZPL emitter is skipped with a warning', () => {
  const model = { language: 'tspl', size: { width: null, height: null, pitch: null, gap: null, native: {} }, items: [{ kind: 'hologram', x: 0, y: 0, width: 10, height: 10, data: null }], diagnostics: [] };
  const out = PB.languages.emit('zpl', model, { dpi: 203 });
  assert.equal(out.text, '^XA\r\n^XZ\r\n');
  assert.equal(out.diagnostics.filter(d => d.level === 'warning').length, 2);
  assert.ok(out.diagnostics.some(d => /tamaño/.test(d.text)));
  assert.ok(out.diagnostics.some(d => /zpl/.test(d.text)));
});

test('emit then parse gives the same size back', () => {
  const model = parse('^XA^PW812^LL1218^XZ', 203);
  const text = PB.languages.emit('zpl', model, { dpi: 203 }).text;
  assert.equal(text, '^XA\r\n^PW812\r\n^LL1218\r\n^XZ\r\n');
  assert.deepEqual([parse(text).size.width, parse(text).size.height], [model.size.width, model.size.height]);
});

// ---------------------------------------------------------------------------------------------------------------
// Data escaping: ^ and ~ cannot appear in field data, so they are written with ^FH and _5E / _7E

const { safeData, fieldData } = PB.zpl.SLICE_HELPERS;
const emitCtx = () => PB.emit.createContext({ dpi: 203, language: 'zpl' });

test('fieldData: plain data is ^FD<data>; ^ and ~ switch on ^FH and are written _5E / _7E (and _ itself _5F)', () => {
  const ctx = emitCtx();
  assert.equal(fieldData(ctx, 'Hello, world'), '^FDHello, world');
  assert.equal(fieldData(ctx, 'a_b'), '^FDa_b');
  assert.equal(fieldData(ctx, 'x^y~z_w'), '^FH^FDx_5Ey_7Ez_5Fw');
  assert.equal(fieldData(ctx, 'v', 'FV'), '^FVv');
  assert.equal(fieldData(ctx, null), '^FD');
  assert.deepEqual(ctx.diagnostics, []);
  // what was written reads back as the original text
  const back = cmds(`${fieldData(ctx, 'x^y~z_w')}^FS`)[1].args[0].value;
  assert.equal(back, 'x^y~z_w');
});

test('safeData: line breaks become spaces with one warning per emit; non-ASCII text gets one info; returns { hex, text }', () => {
  const ctx = emitCtx();
  assert.deepEqual(safeData(ctx, 'a\r\nb\nc'), { hex: false, text: 'a b c' });
  safeData(ctx, 'x\ny');
  assert.equal(ctx.diagnostics.filter(d => d.level === 'warning').length, 1);
  assert.deepEqual(safeData(ctx, 'ñ^'), { hex: true, text: 'ñ_5E' });
  safeData(ctx, 'é');
  assert.equal(ctx.diagnostics.filter(d => d.level === 'info').length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// sizeCommands / applySize / insertCommand

const size = (w, h, dpi) => ({ w: w * 10, h: h * 10, p: h * 10 + 30, dpi });

test('sizeCommands: ^PW and ^LL in dots at the size resolution (203 dpi when it is not given)', () => {
  assert.deepEqual(zpl.sizeCommands(size(100, 60, 203)), ['^PW799', '^LL480']);
  assert.deepEqual(zpl.sizeCommands(size(100, 60, 300)), ['^PW1181', '^LL709']);
  assert.deepEqual(zpl.sizeCommands(size(100, 60)), ['^PW799', '^LL480']);
});

test('applySize replaces the first ^PW and ^LL of the first format in place and nothing else', () => {
  const text = '^XA\r\n^PW400\r\n^LL300\r\n^FO10,10^FDx^FS\r\n^XZ\r\n';
  assert.equal(zpl.applySize(text, size(100, 60, 203)), '^XA\r\n^PW799\r\n^LL480\r\n^FO10,10^FDx^FS\r\n^XZ\r\n');
  // idempotent
  const once = zpl.applySize(text, size(100, 60, 203));
  assert.equal(zpl.applySize(once, size(100, 60, 203)), once);
});

test('applySize adds the missing ^PW / ^LL right after ^XA, using the line ending of the file', () => {
  assert.equal(zpl.applySize('^XA\r\n^FO1,1^FDx^FS\r\n^XZ\r\n', size(100, 60, 203)), '^XA\r\n^PW799\r\n^LL480\r\n^FO1,1^FDx^FS\r\n^XZ\r\n');
  assert.equal(zpl.applySize('^XA\n^FO1,1^FDx^FS\n^XZ\n', size(100, 60, 203)), '^XA\n^PW799\n^LL480\n^FO1,1^FDx^FS\n^XZ\n');
  // only ^LL present: it is replaced, ^PW is added after ^XA
  assert.equal(zpl.applySize('^XA\r\n^LL100\r\n^XZ', size(100, 60, 203)), '^XA\r\n^PW799\r\n^LL480\r\n^XZ');
  // everything on one line: nothing is split
  assert.equal(zpl.applySize('^XA^FO1,1^FDx^FS^XZ', size(100, 60, 203)), '^XA^PW799^LL480^FO1,1^FDx^FS^XZ');
});

test('applySize only touches the first format and its first ^PW; the letters PW inside field data are never matched', () => {
  const text = '^XA^PW400^FO1,1^FDa ^PW^FS^XZ\r\n^XA^PW123^LL456^XZ';
  // 50 x 30 mm at 203 dpi = 400 x 240 dots; the missing ^LL goes right after ^XA, the second format is left alone
  assert.equal(zpl.applySize(text, size(50, 30, 203)), '^XA^LL240^PW400^FO1,1^FDa ^PW^FS^XZ\r\n^XA^PW123^LL456^XZ');
  const data = '^XA^FO1,1^FDPW ^FS^XZ';
  assert.equal(zpl.applySize(data, size(50, 30, 203)), '^XA^PW400^LL240^FO1,1^FDPW ^FS^XZ');
});

test('applySize on an empty text writes a new format; on text without ^XA it prepends the commands', () => {
  assert.equal(zpl.applySize('', size(100, 60, 203)), '^XA\n^PW799\n^LL480\n^XZ\n');
  assert.equal(zpl.applySize('^FO1,1^FDx^FS\r\n', size(100, 60, 203)), '^PW799\r\n^LL480\r\n^FO1,1^FDx^FS\r\n');
});

test('insertCommand adds the field before the closing ^XZ of the first format, keeping the line ending', () => {
  const field = '^FO10,10^FDnew^FS';
  assert.equal(zpl.insertCommand('^XA\r\n^PW400\r\n^XZ\r\n', field), '^XA\r\n^PW400\r\n^FO10,10^FDnew^FS\r\n^XZ\r\n');
  assert.equal(zpl.insertCommand('^XA\n^PW400\n^XZ\n', field), '^XA\n^PW400\n^FO10,10^FDnew^FS\n^XZ\n');
  assert.equal(zpl.insertCommand('^XA^PW400^XZ', field), '^XA^PW400^FO10,10^FDnew^FS^XZ');
  // the first format only
  assert.equal(zpl.insertCommand('^XA\n^XZ\n^XA\n^XZ\n', field), '^XA\n^FO10,10^FDnew^FS\n^XZ\n^XA\n^XZ\n');
});

test('insertCommand: no ^XZ appends at the end; an empty text becomes a new format; ^XZ inside field data is not matched', () => {
  assert.equal(zpl.insertCommand('^XA\r\n^PW400\r\n', '^FO1,1^FDx^FS'), '^XA\r\n^PW400\r\n^FO1,1^FDx^FS\r\n');
  assert.equal(zpl.insertCommand('', '^FO1,1^FDx^FS'), '^XA\n^FO1,1^FDx^FS\n^XZ\n');
  assert.equal(zpl.insertCommand('  \r\n', '^FO1,1^FDx^FS'), '^XA\r\n^FO1,1^FDx^FS\r\n^XZ\r\n');
  assert.equal(zpl.insertCommand('^XA\n^FO1,1^FDwith XZ inside^FS\n^XZ\n', '^FO2,2^FDy^FS'), '^XA\n^FO1,1^FDwith XZ inside^FS\n^FO2,2^FDy^FS\n^XZ\n');
});
