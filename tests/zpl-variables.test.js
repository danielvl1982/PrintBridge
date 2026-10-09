const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Z7: ZPL field variables ^FN and the stored formats ^DF / ^XF (js/languages/zpl.js), and the app's <#NAME#> test values through ZPL data.
// The 2003 guide (Volume One) documents: ^FN# (number 0..9999, default 0) "is used where you would normally use ^FD" in a stored format (^DF) and,
// when the format is recalled (^XF), together with ^FD to give the data; "the same ^FN value can be stored with several different fields"; "if a
// label format contains a field with ^FN and ^FD, the data in that field prints for any other field containing the same ^FN value"; ^DFd:o.x
// right after ^XA stores the format as text; ^XFd:o.x recalls it; ^FV replaces ^FD for variable fields. It does NOT document: the quoted prompt
// ^FN#"prompt" (later guides; read, not verified), what a recalled template looks like (the stored text is on the printer), nor ^FN with 2D codes.
// All parses use 254 dpi, where one dot is exactly 0.1 mm.
const PB = loadApp();
const zpl = PB.languages.get('zpl');
const tpcl = PB.languages.get('tpcl');
const DPI = 254;

const wrap = body => `^XA^PW800^LL480${body}^XZ`;
const parse = body => zpl.parse(wrap(body), { dpi: DPI });
const one = body => parse(body).items[0];
const note = diagnostics => diagnostics.map(d => `${d.level}: ${d.text}`);
const emitOf = model => zpl.emit(model, { dpi: DPI });
const emitLines = model => emitOf(model).text.split('\r\n').filter(l => l && !/^\^(XA|XZ|PW|LL)/.test(l));
const draw = (model, values = {}) => PB.svgRenderer.render(model, { width: 800, height: 480 }, { textScale: 1, values }).svg;

const FIELD = fn => `^FO100,50^A0N,40,40${fn}^FS`;

// ---------------------------------------------------------------------------------------------------------------
// Parse ^FN

test('^FNn without data: a text whose data is the variable <#FNn#>, native.fn keeps the number; one info says the fields use their default data', () => {
  const model = parse(FIELD('^FN1'));
  assert.equal(model.items.length, 1);
  const item = model.items[0];
  assert.equal(item.kind, 'text');
  assert.equal(item.data, '<#FN1#>');
  assert.deepEqual(item.native.fn, { n: 1, prompt: undefined, default: undefined });
  assert.equal(model.variableDefaults, undefined);
  assert.equal(note(model.diagnostics).filter(t => /^info: .*\^FN/.test(t)).length, 1);
  assert.deepEqual(PB.variables.namesInModel(model), ['FN1']);
});

test('^FNn with ^FD (before or after it): the data is the default test value, suggested through model.variableDefaults', () => {
  for (const body of [FIELD('^FN1^FDACME'), FIELD('^FDACME^FN1')]) {
    const model = parse(body);
    assert.equal(model.items[0].data, '<#FN1#>', body);
    assert.equal(model.items[0].native.fn.default, 'ACME', body);
    assert.deepEqual(model.variableDefaults, { FN1: 'ACME' }, body);
  }
});

test('^FN with the ^FH escapes in the default data: the default is the decoded text', () => {
  const model = parse(FIELD('^FN3^FH^FDA_2CB'));
  assert.deepEqual(model.variableDefaults, { FN3: 'A,B' });
});

test('^FN without a number is ^FN0 (the guide default); a number over 9999 or not a number is reported and the field has no variable', () => {
  assert.equal(one(FIELD('^FN')).data, '<#FN0#>');
  assert.equal(one(FIELD('^FN0')).data, '<#FN0#>');
  assert.equal(one(FIELD('^FN9999')).data, '<#FN9999#>');
  for (const bad of ['^FN10000', '^FNabc', '^FN-1']) {
    const model = parse(FIELD(`${bad}^FDtexto`));
    assert.equal(model.items[0].data, 'texto', bad);
    assert.equal(model.items[0].native.fn, undefined, bad);
    assert.equal(note(model.diagnostics).filter(t => /^warning: \^FN no válido/.test(t)).length, 1, bad);
  }
});

test('^FNn"prompt" (later guides, not verified): the prompt is kept, also with a comma inside', () => {
  const item = one(FIELD('^FN2"Nombre, apellido"^FDx'));
  assert.equal(item.data, '<#FN2#>');
  assert.deepEqual(item.native.fn, { n: 2, prompt: 'Nombre, apellido', default: 'x' });
  assert.equal(one(FIELD('^FN2""')).native.fn.prompt, '');
});

test('the same ^FN in several fields: they are all the variable, and the data of the one that has ^FD is the default of all', () => {
  const model = parse(`${FIELD('^FN1')}^FO10,10^A0N,20,20^FN1^FDEl dato^FS^FO10,100^A0N,20,20^FN2^FS`);
  assert.deepEqual(model.items.map(i => i.data), ['<#FN1#>', '<#FN1#>', '<#FN2#>']);
  assert.deepEqual(model.variableDefaults, { FN1: 'El dato' });
  assert.deepEqual(PB.variables.namesInModel(model), ['FN1', 'FN2']);
});

test('^FN with a bar code: the data of the barcode is the variable (the default is a test value)', () => {
  const model = parse('^BY2,3,60^FO10,10^B3N,,100^FN4^FS^FO10,200^BCN,60,Y,N,N^FN5^FD12345678^FS');
  assert.deepEqual(model.items.map(i => [i.kind, i.data]), [['barcode', '<#FN4#>'], ['barcode', '<#FN5#>']]);
  assert.deepEqual(model.variableDefaults, { FN5: '12345678' });
});

test('^FN with QR and Data Matrix: no variable (the data carries the ECC prefix and the symbol is built from it): the ^FD default is the data, one info', () => {
  const model = parse('^FO10,10^BQN,2,4^FN1^FDMA,hola^FS^FO10,200^BXN,4,200^FN2^FS^FO10,300^BXN,4,200^FN3^FDabc^FS');
  assert.deepEqual(model.items.map(i => i.kind), ['qr', 'datamatrix']);
  assert.equal(model.items[0].data.endsWith('hola'), true);
  assert.equal(model.items[1].data, 'abc');
  assert.equal(model.variableDefaults, undefined);
  assert.equal(note(model.diagnostics).filter(t => /^info: .*\^FN.*(QR|2D)/.test(t)).length, 1);
});

test('^FN and ^SN in the same field: the ^FN wins (one warning)', () => {
  const model = parse(FIELD('^SN001,1,Y^FN1'));
  assert.equal(model.items[0].data, '<#FN1#>');
  assert.equal(model.items[0].counter, undefined);
  assert.equal(note(model.diagnostics).filter(t => /^warning: .*\^FN.*\^SN/.test(t)).length, 1);
});

test('^FV is the variable data command and reads like ^FD (Z1 tokenizer): text and bar code', () => {
  const item = one('^FO10,10^A0N,30,30^FVhello, world^FS');
  assert.deepEqual([item.kind, item.data], ['text', 'hello, world']);
  const model = parse('^BY2,3,60^FO10,10^BCN,60,Y,N,N^FV12345^FS');
  assert.equal(model.items[0].data, '12345');
  const withFn = one(FIELD('^FN1^FVdefecto'));
  assert.equal(withFn.native.fn.default, 'defecto');
});

// ---------------------------------------------------------------------------------------------------------------
// ^DF / ^XF

const TEMPLATE = '^XA^DFR:SAMPLE.ZPL^FS^FO20,30^GB750,200,4^FS^FO30,40^ADN,36,20^FDShip to:^FS^FO150,125^ADN,36,20^FN1^FS^FO60,330^ADN,36,20^FN2^FS^XZ';

test('^DF at the start of a template: ignored with one info, and the template is drawn as a normal label (placeholders for its ^FN fields)', () => {
  const model = zpl.parse(TEMPLATE, { dpi: DPI });
  assert.deepEqual(model.items.map(i => i.kind), ['line', 'text', 'text', 'text']);
  assert.deepEqual(model.items.map(i => i.data), [undefined, 'Ship to:', '<#FN1#>', '<#FN2#>']);
  const texts = note(model.diagnostics);
  assert.equal(texts.filter(t => /^info: \^DF/.test(t)).length, 1);
  assert.equal(texts.filter(t => /no soportado/.test(t)).length, 0);
  assert.equal(texts.filter(t => /^warning/.test(t)).length, 0);
});

test('^XF recall: reported once as "plantilla almacenada no disponible"; the ^FN fields without a position are data for the template, not drawn, but their data is kept as defaults', () => {
  const model = zpl.parse('^XA^XFR:SAMPLE.ZPL^FS^FN1^FDAcme Printing^FS^FN2^FD14042^FS^XZ', { dpi: DPI });
  assert.deepEqual(model.items, []);
  assert.deepEqual(model.variableDefaults, { FN1: 'Acme Printing', FN2: '14042' });
  assert.equal(note(model.diagnostics).filter(t => /plantilla almacenada no disponible/.test(t)).length, 1);
  assert.equal(note(model.diagnostics).filter(t => /no soportado|sin origen|sin ^FO/.test(t)).length, 0);
});

test('^XF in a format with its own positioned fields: those are drawn, the recall is reported', () => {
  const model = zpl.parse('^XA^XFR:SAMPLE.ZPL^FS^FO10,10^A0N,30,30^FDHola^FS^XZ', { dpi: DPI });
  assert.deepEqual(model.items.map(i => i.data), ['Hola']);
  assert.equal(note(model.diagnostics).filter(t => /plantilla almacenada no disponible/.test(t)).length, 1);
});

test('the guide example in two formats: the viewer draws the first one (the template), as it does for every file with several formats', () => {
  const src = `${TEMPLATE}^XA^XFR:SAMPLE.ZPL^FN1^FDAcme Printing^FS^XZ`;
  const model = zpl.parse(src, { dpi: DPI });
  assert.equal(model.items.length, 4);
  assert.ok(note(model.diagnostics).some(t => /2 formatos/.test(t)));
});

test('^DF and ^XF are known commands for the detection and are not "unsupported"', () => {
  assert.equal(zpl.detect('^DFR:A.ZPL^FS ^XFR:A.ZPL^FS'), true);
});

// ---------------------------------------------------------------------------------------------------------------
// Emit and round trips

test('emit: an item that came from ^FN is written back with ^FNn (prompt and default kept); a field without a default has no ^FD', () => {
  for (const body of [FIELD('^FN1'), FIELD('^FN1^FDACME'), FIELD('^FN12"Nombre"^FDACME'), FIELD('^FN3"Solo prompt"')]) {
    const out = emitLines(parse(body));
    assert.equal(out.length, 1, body);
    assert.equal(out[0], `^FO100,50^A0N,40,40${body.match(/\^FN.*(?=\^FS)/)[0]}^FS`, body);
  }
  assert.ok(emitLines(parse('^BY2,3,60^FO10,10^BCN,60,Y,N,N^FN5^FD12345678^FS')).some(l => l.includes('^FN5^FD12345678^FS')));
});

test('round trip parse -> emit -> parse keeps the variable, its number, prompt and default (text and bar code)', () => {
  const sources = [FIELD('^FN1'), FIELD('^FN1^FDACME'), FIELD('^FN7"Nombre"^FDACME'), '^BY2,3,60^FO10,10^BCN,60,Y,N,N^FN5^FD12345678^FS'];
  for (const body of sources) {
    const first = parse(body);
    const again = zpl.parse(emitOf(first).text, { dpi: DPI });
    assert.equal(again.items.length, 1, body);
    assert.equal(again.items[0].data, first.items[0].data, body);
    assert.deepEqual(again.items[0].native.fn, first.items[0].native.fn, body);
    assert.deepEqual(again.variableDefaults, first.variableDefaults, body);
  }
});

test('emit: an item whose data was edited away from <#FNn#> is written as plain data (the variable is gone)', () => {
  const item = { ...one(FIELD('^FN1^FDACME')), data: 'cambiado' };
  const out = emitLines({ size: { width: 800, height: 480 }, items: [item] });
  assert.ok(out[0].includes('^FDcambiado^FS') && !out[0].includes('^FN'));
});

test('emit: #NAME# / <#NAME#> placeholders of other languages are written as literal data, with one info that ZPL variables are not generated', () => {
  const items = [
    { kind: 'text', ref: 'A', x: 10, y: 50, rotation: 0, data: '<#NOMBRE#>', font: { size: 40, scaleX: 1, family: 'sans', weight: 700, style: 'normal' } },
    { kind: 'text', ref: 'A', x: 10, y: 150, rotation: 0, data: 'Lote #LOTE#', font: { size: 40, scaleX: 1, family: 'sans', weight: 700, style: 'normal' } },
  ];
  const result = emitOf({ size: { width: 800, height: 480 }, items });
  assert.ok(result.text.includes('^FD<#NOMBRE#>^FS') && result.text.includes('^FDLote #LOTE#^FS'));
  assert.equal(note(result.diagnostics).filter(t => /^info: Las variables .* literal en ZPL/.test(t)).length, 1);
  assert.deepEqual(result.diagnostics.filter(d => d.level !== 'info'), []);
});

// ---------------------------------------------------------------------------------------------------------------
// Edit

test('describeItem: an ^FN field has no content or counter fields (its test value is edited in "Valores de prueba"); its other fields stay', () => {
  const src = wrap(FIELD('^FN1^FDACME'));
  const fields = zpl.describeItem(zpl.parse(src, { dpi: DPI }).items[0], src).fields.map(f => f.key);
  assert.deepEqual(fields, ['font', 'height', 'width', 'rotation', 'reverse']);
  const bare = wrap('^FO10,10^A0N,30,30^FN1^FS');
  assert.deepEqual(zpl.describeItem(zpl.parse(bare, { dpi: DPI }).items[0], bare).fields.map(f => f.key), ['font', 'height', 'width', 'rotation', 'reverse']);
});

test('updateItem: the ^FN is untouched when another property of the field changes, and the counter / content edits refuse', () => {
  const src = wrap(FIELD('^FN1"Nombre"^FDACME'));
  const item = zpl.parse(src, { dpi: DPI }).items[0];
  assert.equal(zpl.updateItem(src, item, { height: 60 }, { dpi: DPI }), wrap('^FO100,50^A0N,60,40^FN1"Nombre"^FDACME^FS'));
  assert.equal(zpl.updateItem(src, item, { counter: 3 }, { dpi: DPI }), src);
  assert.equal(zpl.updateItem(src, item, { content: 'otro' }, { dpi: DPI }), src);
});

test('describeItem: the content of a QR / Data Matrix with ^FN keeps being its ^FD data', () => {
  const src = wrap('^FO10,10^BXN,4,200^FN3^FDabc^FS');
  const content = zpl.describeItem(zpl.parse(src, { dpi: DPI }).items[0], src).fields.find(f => f.key === 'content');
  assert.equal(content && content.value, 'abc');
});

test('the properties panel lists the variable of an ^FN field with its default as the test value (variableFieldsFor + seedDefaults)', () => {
  const model = zpl.parse(wrap(FIELD('^FN1^FDACME')), { dpi: DPI });
  const values = {};
  PB.variables.seedDefaults(values, model);
  assert.deepEqual(PB.ui.variableFieldsFor(model.items[0], model, values), [{ name: 'FN1', value: 'ACME', usedIn: 1 }]);
});

// ---------------------------------------------------------------------------------------------------------------
// Test values (the Variables panel and Propiedades): <#NAME#> in ZPL data

test('seedDefaults: a default fills only the variables with no value yet (the user value and an empty value stay), and a model without defaults changes nothing', () => {
  const model = parse(`${FIELD('^FN1^FDACME')}^FO10,10^A0N,20,20^FN2^FDdos^FS`);
  const values = { FN2: '' };
  PB.variables.seedDefaults(values, model);
  assert.deepEqual(values, { FN2: '', FN1: 'ACME' });
  const same = { FN1: 'mio' };
  PB.variables.seedDefaults(same, model);
  assert.equal(same.FN1, 'mio');
  const untouched = { A: '1' };
  PB.variables.seedDefaults(untouched, parse(FIELD('^FDplain')));
  PB.variables.seedDefaults(untouched, null);
  assert.deepEqual(untouched, { A: '1' });
});

test('a ZPL text with ^FD<#NAME#> shows the test value in the preview (the variable substitution is language independent)', () => {
  const model = parse('^FO10,10^A0N,40,40^FD<#NOMBRE#>^FS');
  assert.deepEqual(PB.variables.namesInModel(model), ['NOMBRE']);
  assert.match(draw(model, { NOMBRE: 'Ana García' }), />Ana García<\/text>/);
  assert.match(draw(model, {}), /&lt;#NOMBRE#&gt;|<#NOMBRE#>/);
});

test('an ^FN field shows its default data (seeded as the test value) and the value the user types afterwards', () => {
  const model = parse(FIELD('^FN1^FDACME'));
  const values = {};
  PB.variables.seedDefaults(values, model);
  assert.match(draw(model, values), />ACME<\/text>/);
  assert.match(draw(model, { FN1: 'Otro' }), />Otro<\/text>/);
});

// ---------------------------------------------------------------------------------------------------------------
// Conversions

const TPCL_HEAD = '{D0500,1000,0500|}\r\n{AX;+000,+000,+00|}\r\n{C|}\r\n';

test('TPCL -> ZPL: #NAME# placeholders stay literal text in ^FD with one info (the same loss notice other conversions give)', () => {
  const text = `${TPCL_HEAD}{PC001;0100,0200,10,10,J,00,B=Hola #NOMBRE#|}\r\n{PC002;0100,0400,10,10,J,00,B=<#LOTE#>|}\r\n{XS;I,0001,0002C4100|}`;
  const result = PB.convert.run(text, 'zpl', { dpi: 203 });
  assert.ok(result.text.includes('^FDHola #NOMBRE#^FS') && result.text.includes('^FD<#LOTE#>^FS'), result.text);
  assert.equal(result.diagnostics.filter(d => /literal en ZPL/.test(d.text)).length, 1);
  assert.deepEqual(result.diagnostics.filter(d => d.level !== 'info'), []);
});

test('ZPL -> TPCL: an ^FN field becomes text with the placeholder <#FNn#> (the test value is the app\'s, not the file\'s)', () => {
  const result = PB.convert.run(wrap(FIELD('^FN1^FDACME')), 'tpcl', { dpi: 203 });
  const back = tpcl.parse(result.text, { dpi: 203 });
  assert.equal(back.items[0].data, '<#FN1#>');
});

test('ZPL -> ZPL through the converter writes the ^FN fields back (a ZPL file round-trips exactly)', () => {
  const src = wrap(`${FIELD('^FN1"Nombre"^FDACME')}^FO10,10^A0N,20,20^FN2^FS`);
  const result = PB.convert.run(src, 'zpl', { dpi: 203 });
  assert.ok(result.text.includes('^FN1"Nombre"^FDACME^FS') && result.text.includes('^FN2^FS'), result.text);
});

// ---------------------------------------------------------------------------------------------------------------
// Volume Two (2005): the examples of the programming exercises and of the advanced techniques (printed pages 33-37 and 41-43)

test('Volume Two exercise 5 (page 33): ^SNSERIAL NUMBER 00000000111,1,Y is a text counter whose start value is the data as written; the format commands around it are not drawn', () => {
  const model = zpl.parse('^XA^LH30,30^FO20,10^AF^FDZEBRA^FS^FO20,60^B3,,40,,^FDAA001^FS^FO20,180^AF^SNSERIAL NUMBER 00000000111,1,Y^FS^PQ10^XZ', { dpi: DPI });
  assert.deepEqual(model.items.map(i => [i.kind, i.data]), [['text', 'ZEBRA'], ['barcode', 'AA001'], ['text', 'SERIAL NUMBER 00000000111']]);
  assert.deepEqual([model.items[2].counter.step, model.items[2].zeroSuppress], [1, undefined]);
  assert.deepEqual(model.diagnostics.map(d => d.level), ['info', 'info']);
  assert.equal(emitLines(model).find(l => l.includes('^SNSERIAL NUMBER 00000000111,1,Y')) !== undefined, true);
});

test('Volume Two exercise 6 and the stored format example (pages 35-37, 43): ^DF / ^XF with ^FN and ^FA (field allocate, no effect on the drawing) read without a warning', () => {
  const exercise6 = zpl.parse('^XA^DFFORMAT^FS^LH30,30^FO20,10^AF^FN1^FS^FO20,60^B3,,40,,^FN2^FS^XZ^XA^XFFORMAT^FS^FN1^FDZEBRA^FS^FN2^FDAAA001^FS^XZ', { dpi: DPI });
  assert.deepEqual(exercise6.items.map(i => [i.kind, i.data]), [['text', '<#FN1#>'], ['barcode', '<#FN2#>']]);
  assert.deepEqual(exercise6.diagnostics.filter(d => d.level !== 'info'), []);
  const stored = zpl.parse('^XA^DFFORMAT^FS^LH30,30^BY2,3,100^FO120,100^CFD^FN1^FA9^FS^FO120,160^B3^FN2^FA6^FS^XZ', { dpi: DPI });
  assert.deepEqual(stored.items.map(i => [i.kind, i.data, i.native && i.native.font]), [['text', '<#FN1#>', 'D'], ['barcode', '<#FN2#>', undefined]]);
  assert.deepEqual(stored.diagnostics.filter(d => d.level !== 'info'), []);
  assert.ok(stored.diagnostics.some(d => d.text.includes('^FA')));
});
