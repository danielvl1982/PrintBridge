const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// Z2: the ZPL text slice (js/components/text/zpl.js): ^A fonts, ^CF / ^FW defaults, ^FO vs ^FT origins, ^FD / ^FV data with ^FH escapes,
// ^FR reverse print, emit, editing, palette, the example label and the conversions through the shared pipeline.
// All parses use 254 dpi, where one dot is exactly 0.1 mm, so dots and model units are the same number.
// The font matrices (cell height x width and gap of the bitmapped fonts) and the baseline of ^FO are NOT in the 2003 guide (Volume One);
// they are the viewer's simulation, not verified on a printer: the numbers below are the ones js/components/text/zpl.js documents.
const PB = loadUpTo('js/ui.js');
const zpl = PB.languages.get('zpl');
const DPI = 254;

const parse = src => zpl.parse(src, { dpi: DPI });
const one = src => parse(`^XA${src}^XZ`).items[0];
const emitLines = (model, dpi = DPI) => zpl.emit(model, { dpi }).text.split('\r\n').filter(l => l && !/^\^(XA|XZ|PW|LL)/.test(l));
const roundTrip = src => emitLines(parse(`^XA^PW800^LL480${src}^XZ`));
const diagnostics = src => parse(`^XA${src}^XZ`).diagnostics.map(d => `${d.level}: ${d.text}`);
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol + 1e-6, `${label}: ${a} vs ${b} (tolerance ${tol})`);

// ---------------------------------------------------------------------------------------------------------------
// Parse: fonts, origin, orientation

test('the text slice registers a zpl factory next to tpcl and tspl, and ZPL offers the Texto palette entry (first)', () => {
  assert.deepEqual(Object.keys(PB.components.get('text').languages), ['tpcl', 'tspl', 'zpl']);
  assert.deepEqual(zpl.componentTemplates().map(c => [c.kind, c.label]).slice(0, 1), [['text', 'Texto']]);
});

test('^FO is the top-left of the text box: the neutral origin is the baseline, one ascent (0.8 of the height) below it', () => {
  const item = one('^FO100,50^A0N,40,30^FDHello^FS');
  assert.equal(item.kind, 'text');
  assert.equal(item.data, 'Hello');
  assert.deepEqual([item.x, item.y, item.rotation], [100, 82, 0]);
  assert.deepEqual(item.font, { size: 40, scaleX: 0.75, family: 'sans', weight: 700, style: 'normal' });
  assert.deepEqual([item.native.origin, item.native.font, item.native.height, item.native.width], ['FO', '0', 40, 30]);
});

test('^FT is the baseline origin: the neutral origin is the coordinate as written', () => {
  const item = one('^FT100,200^A0N,40,40^FDHi^FS');
  assert.deepEqual([item.x, item.y, item.native.origin], [100, 200, 'FT']);
});

test('orientations N / R / I / B are 0 / 90 / 180 / 270 clockwise; ^FO keeps the top-left of the rotated box', () => {
  // height 40: ascent 32, descent 8; scalable text "Hi" is 2 x 20 = 40 dots long (half the width per character)
  const at = o => one(`^FO100,50^A0${o},40,40^FDHi^FS`);
  assert.deepEqual([at('N').rotation, at('N').x, at('N').y], [0, 100, 82]);
  assert.deepEqual([at('R').rotation, at('R').x, at('R').y], [90, 108, 50]);
  assert.deepEqual([at('I').rotation, at('I').x, at('I').y], [180, 140, 58]);
  assert.deepEqual([at('B').rotation, at('B').x, at('B').y], [270, 132, 90]);
  // ^FT does not move with the rotation
  for (const [o, r] of [['N', 0], ['R', 90], ['I', 180], ['B', 270]]) {
    const item = one(`^FT100,200^A0${o},40,40^FDHi^FS`);
    assert.deepEqual([item.rotation, item.x, item.y], [r, 100, 200]);
  }
});

test('bitmapped fonts: height and width are multiples (1..10) of the standard matrix; the viewer draws them mono 400', () => {
  const a = one('^FO10,10^AAN,9,5^FDabc^FS');
  assert.deepEqual([a.font.size, a.font.family, a.font.weight, a.font.style], [9, 'mono', 400, 'normal']);
  near(a.font.scaleX, 6 / (0.6 * 9), 1e-9, 'font A advance (5 + 1 gap)');
  assert.equal(a.y, 17);
  const b = one('^FO10,10^ABN,22,14^FDabc^FS');
  assert.deepEqual([b.native.hMult, b.native.wMult, b.font.size], [2, 2, 22]);
  near(b.font.scaleX, 18 / (0.6 * 22), 1e-9, 'font B x2 advance (7 + 2 gap) * 2');
  // only the height: the width follows the same magnification; only the width: the height follows it
  const d = one('^FO10,10^ADN,30^FDx^FS');
  assert.deepEqual([d.native.hMult, d.native.wMult, d.font.size], [2, 2, 36]);
  const e = one('^FO10,10^AEN,,30^FDx^FS');
  assert.deepEqual([e.native.hMult, e.native.wMult, e.font.size], [2, 2, 56]);
  // no size at all: the standard matrix; above 10 times: 10
  assert.deepEqual([one('^FO10,10^AAN^FDx^FS').font.size, one('^FO10,10^AAN,200,200^FDx^FS').font.size], [9, 90]);
  assert.deepEqual([one('^FO10,10^AAN,0,0^FDx^FS').font.size], [9]);
});

test('font 0 is scalable (sans bold in the viewer): width 0 or omitted follows the height; no size at all is 15 x 12 (the guide default)', () => {
  const p = one('^FT10,50^A0N,50,0^FDx^FS');
  assert.deepEqual([p.font.size, p.font.scaleX, p.font.family, p.font.weight], [50, 1, 'sans', 700]);
  const d = one('^FT10,50^A0N^FDx^FS');
  assert.deepEqual([d.font.size, d.font.scaleX], [15, 0.8]);
});

test('a font the viewer has no matrix for (P..V, GS, 1..9, downloaded) is drawn like a scalable sans one, with one info', () => {
  const model = parse('^XA^FT10,50^APN,30,30^FDx^FS^FT10,90^APN,30,30^FDy^FS^FT10,130^A5N,30,30^FDz^FS^XZ');
  assert.deepEqual(model.items.map(i => [i.font.size, i.font.family, i.font.weight, i.native.font]), [[30, 'sans', 400, 'P'], [30, 'sans', 400, 'P'], [30, 'sans', 400, '5']]);
  assert.deepEqual(model.diagnostics.map(d => [d.level, /fuente "P"/.test(d.text), /fuente "5"/.test(d.text)]), [['info', true, false], ['info', false, true]]);
});

test('the default font ^CF applies to a field with only data (and to ^A without sizes of the same font); ^CF with only a height is proportional', () => {
  const model = parse('^XA^CF0,40,30^FO10,10^FDDefault^FS^FO10,60^A0N^FDsame^FS^XZ');
  assert.deepEqual(model.diagnostics, []);
  const [d, s] = model.items;
  assert.deepEqual([d.ref, d.data, d.font.size, d.font.scaleX, d.y, d.native.font], ['FD', 'Default', 40, 0.75, 42, '0']);
  assert.deepEqual([s.ref, s.font.size, s.font.scaleX], ['A', 40, 0.75]);
  const proportional = one('^CFD,36^FO10,10^FDx^FS');
  assert.deepEqual([proportional.font.size, proportional.native.hMult, proportional.native.wMult], [36, 2, 2]);
  // a field in the power-up default font: A 9 x 5
  assert.deepEqual([one('^FO10,10^FDx^FS').font.size, one('^FO10,10^FDx^FS').font.family], [9, 'mono']);
});

test('^FW sets the orientation of the fields that do not give one; an explicit one wins', () => {
  assert.equal(one('^FWR^FO10,10^A0,40,40^FDx^FS').rotation, 90);
  assert.equal(one('^FWR^FO10,10^FDx^FS').rotation, 90);
  assert.equal(one('^FWR^FO10,10^A0N,40,40^FDx^FS').rotation, 0);
  const bad = parse('^XA^FWI^FO10,10^A0X,40,40^FDx^FS^XZ');
  assert.equal(bad.items[0].rotation, 180);
  assert.equal(bad.diagnostics[0].level, 'warning');
  assert.match(bad.diagnostics[0].text, /orientación/);
});

test('^LH moves the field: the origin of the text includes it', () => {
  const item = one('^LH10,20^FT100,200^A0N,40,40^FDx^FS');
  assert.deepEqual([item.x, item.y], [110, 220]);
});

test('the data may come before or after ^A; ^FV is read like ^FD; a field without data draws nothing', () => {
  assert.deepEqual(['^FO10,10^FDHello^A0N,30,30^FS', '^FO10,10^A0N,30,30^FDHello^FS', '^FO10,10^A0N,30,30^FVHello^FS'].map(s => one(s).data), ['Hello', 'Hello', 'Hello']);
  const empty = parse('^XA^FO10,10^A0N,30,30^FS^XZ');
  assert.deepEqual([empty.items.length, empty.diagnostics], [0, []]);
});

test('^FH escapes are decoded in the data (default indicator _, or the one given)', () => {
  assert.equal(one('^FO10,10^A0N,30,30^FH^FDa_5Eb_7Ec_5Fd^FS').data, 'a^b~c_d');
  assert.equal(one('^FO10,10^A0N,30,30^FH!^FDa!5Eb_5E^FS').data, 'a^b_5E');
  assert.equal(one('^FO10,10^A0N,30,30^FDa_5Eb^FS').data, 'a_5Eb');
});

test('^FR marks the text as reverse (absent otherwise); ^FP other than horizontal is reported once and the text is drawn left to right', () => {
  assert.equal(one('^FO10,10^A0N,30,30^FR^FDx^FS').reverse, true);
  assert.equal(one('^FO10,10^A0N,30,30^FDx^FS').reverse, undefined);
  const fp = parse('^XA^FO10,10^A0N,30,30^FPV,3^FDa^FS^FO10,60^A0N,30,30^FPR^FDb^FS^FO10,90^A0N,30,30^FPH^FDc^FS^XZ');
  assert.equal(fp.items.length, 3);
  assert.deepEqual(fp.diagnostics.map(d => d.level), ['info']);
  assert.match(fp.diagnostics[0].text, /\^FP/);
});

test('several fields keep their order and each one its own source span', () => {
  const src = '^XA\r\n^FO10,10^A0N,30,30^FDone^FS\r\n^FT10,90^ABN,22,14^FDtwo^FS\r\n^XZ';
  const model = parse(src);
  assert.deepEqual(model.items.map(i => i.data), ['one', 'two']);
  assert.deepEqual(model.items.map(i => src.slice(i.source.spans[0].start, i.source.spans[0].end)), ['^FO10,10^A0N,30,30^FDone^FS', '^FT10,90^ABN,22,14^FDtwo^FS']);
  assert.deepEqual(model.diagnostics, []);
});

test('a ^FB block is not supported: the text is drawn as one line and the command is reported', () => {
  const model = parse('^XA^FO10,10^A0N,30,30^FB300,2,0,L^FDhello^FS^XZ');
  assert.equal(model.items[0].data, 'hello');
  assert.ok(model.diagnostics.some(d => d.level === 'warning' && /\^FB/.test(d.text)));
});

// ---------------------------------------------------------------------------------------------------------------
// Emit

test('parse -> emit -> parse reproduces the field text (^FO and ^FT, every orientation, scalable and bitmapped fonts)', () => {
  for (const src of [
    '^FO100,50^A0N,40,30^FDHello^FS',
    '^FT100,200^A0N,40,40^FDHi^FS',
    '^FO100,50^A0R,40,40^FDHi^FS',
    '^FO100,50^A0I,40,40^FDHi^FS',
    '^FO100,50^A0B,40,40^FDHi^FS',
    '^FO10,10^AAN,9,5^FDabc^FS',
    '^FO10,10^ABN,22,14^FDtext^FS',
    '^FT10,10^ADR,36,20^FDtext^FS',
    '^FT10,10^AEN,56,30^FDOCR^FS',
    '^FO10,10^AFN,26,13^FDx^FS',
    '^FO10,10^AGN,60,40^FDx^FS',
    '^FO10,10^AHN,21,13^FDx^FS',
    '^FO10,10^A0N,40,40^FR^FDreverse^FS',
  ]) {
    assert.deepEqual(roundTrip(src), [src], src);
  }
});

test('emit keeps the font letter of the source when several fonts share the matrix (C = D)', () => {
  assert.deepEqual(roundTrip('^FO10,10^ACN,18,10^FDx^FS'), ['^FO10,10^ACN,18,10^FDx^FS']);
});

test('a text in the default font is written with an explicit font and the same geometry', () => {
  const lines = roundTrip('^CF0,40,30^FO10,10^FDDefault^FS');
  assert.deepEqual(lines, ['^FO10,10^A0N,40,30^FDDefault^FS']);
});

test('parse -> emit -> parse gives the same items (geometry, font, data, reverse) at 203 and 300 dpi', () => {
  const src = '^XA^PW800^LL480^FO30,25^A0N,50,50^FDTitle^FS^FT30,200^ABN,22,14^FDLine two^FS^FO700,30^A0R,40,40^FDside^FS^FO400,300^A0I,30,30^FR^FDinv^FS^FO50,400^A0B,30,30^FDup^FS^XZ';
  for (const dpi of [203, 300]) {
    const first = zpl.parse(src, { dpi });
    const second = zpl.parse(zpl.emit(first, { dpi }).text, { dpi });
    assert.equal(second.items.length, first.items.length);
    first.items.forEach((a, i) => {
      const b = second.items[i];
      assert.deepEqual([b.data, b.rotation, b.reverse], [a.data, a.rotation, a.reverse]);
      near(b.x, a.x, 0.5, `x ${i}`);
      near(b.y, a.y, 0.5, `y ${i}`);
      near(b.font.size, a.font.size, 0.5, `size ${i}`);
      near(b.font.scaleX * b.font.size, a.font.scaleX * a.font.size, 0.5, `width ${i}`);
      assert.deepEqual([b.font.family, b.font.weight], [a.font.family, a.font.weight]);
    });
  }
});

test('data safety: ^ and ~ (and _ once ^FH is on) go through ^FH escapes; line breaks become spaces with a warning; non ASCII is reported', () => {
  const model = { size: { width: 800, height: 480 }, items: [] };
  const text = data => ({ kind: 'text', ref: 'A', x: 10, y: 50, rotation: 0, font: { size: 40, scaleX: 1, family: 'sans', weight: 700, style: 'normal' }, data });
  const out = (data, dpi = DPI) => { const r = zpl.emit({ ...model, items: [text(data)] }, { dpi }); return { lines: r.text.split('\r\n').filter(l => l.startsWith('^FT')), diagnostics: r.diagnostics }; };
  assert.deepEqual(out('a^b~c').lines, ['^FT10,50^A0N,40,40^FH^FDa_5Eb_7Ec^FS']);
  assert.deepEqual(out('a^b_c').lines, ['^FT10,50^A0N,40,40^FH^FDa_5Eb_5Fc^FS']);
  assert.deepEqual(out('a_b').lines, ['^FT10,50^A0N,40,40^FDa_b^FS']);
  assert.equal(parse(`^XA${out('x^y~z_w').lines[0]}^XZ`).items[0].data, 'x^y~z_w');
  const broken = out('one\r\ntwo');
  assert.deepEqual(broken.lines, ['^FT10,50^A0N,40,40^FDone two^FS']);
  assert.ok(broken.diagnostics.some(d => d.level === 'warning' && /saltos de línea/.test(d.text)));
  assert.ok(out('niño').diagnostics.some(d => d.level === 'info' && /fuera de ASCII/.test(d.text)));
});

test('emit maps the neutral font to the nearest ZPL font: mono multiples to a bitmapped font, anything else to the scalable 0', () => {
  const emitFont = (font, extra = {}) => {
    const item = { kind: 'text', ref: 'T', x: 10, y: 100, rotation: 0, data: 'x', font: { style: 'normal', weight: 400, ...font }, ...extra };
    const r = zpl.emit({ size: { width: 800, height: 480 }, items: [item] }, { dpi: DPI });
    return { line: r.text.split('\r\n').find(l => l.startsWith('^FT')), diagnostics: r.diagnostics.map(d => `${d.level}: ${d.text}`) };
  };
  // mono 36 high x 20 wide cells... font D at 2x: height 36, advance 24 dots -> scaleX 24 / (0.6 * 36)
  assert.deepEqual(emitFont({ family: 'mono', size: 36, scaleX: 24 / (0.6 * 36) }), { line: '^FT10,100^ADN,36,20^FDx^FS', diagnostics: [] });
  // sans bold is exactly the scalable font 0 (what the viewer draws it as)
  assert.deepEqual(emitFont({ family: 'sans', weight: 700, size: 50, scaleX: 0.8 }), { line: '^FT10,100^A0N,50,40^FDx^FS', diagnostics: [] });
  // serif / regular weights / italic: font 0 and one fidelity info
  const serif = emitFont({ family: 'serif', size: 50, scaleX: 1 });
  assert.equal(serif.line, '^FT10,100^A0N,50,50^FDx^FS');
  assert.equal(serif.diagnostics.length, 1);
  assert.match(serif.diagnostics[0], /^info: Las fuentes ZPL no coinciden con las de origen/);
  // a mono size that is no multiple of any bitmapped matrix: font 0, and the info
  const odd = emitFont({ family: 'mono', size: 24, scaleX: 1 });
  assert.match(odd.line, /^\^FT10,100\^A0N,24,\d+\^FDx\^FS$/);
  assert.equal(odd.diagnostics.length, 1);
});

test('the fidelity info is written once per label; scalable sizes are kept inside the range of the guide (10..32000)', () => {
  const t = (font, y) => ({ kind: 'text', ref: 'T', x: 10, y, rotation: 0, data: 'x', font });
  const items = [
    t({ family: 'serif', weight: 400, style: 'normal', size: 50, scaleX: 1 }, 100),
    t({ family: 'serif', weight: 700, style: 'italic', size: 60, scaleX: 1 }, 200),
    t({ family: 'sans', weight: 700, style: 'normal', size: 4, scaleX: 1 }, 300),
  ];
  const r = zpl.emit({ size: { width: 800, height: 480 }, items }, { dpi: DPI });
  assert.equal(r.diagnostics.filter(d => /fuentes ZPL/.test(d.text)).length, 1);
  assert.ok(r.diagnostics.some(d => /entre 10 y 32000/.test(d.text)));
  assert.ok(r.text.includes('^FT10,300^A0N,10,10^FDx^FS'));
});

test('rotation not on a quarter turn is rounded with one warning; attributes, alignment, spacing, bold and zero suppression that ZPL text lacks are reported once (the counters are written as ^SN since Z7)', () => {
  const base = { kind: 'text', ref: 'T', x: 10, y: 100, data: '7', font: { family: 'sans', weight: 700, style: 'normal', size: 40, scaleX: 1 } };
  const items = [
    { ...base, rotation: 100 },
    { ...base, rotation: 0, attribute: { kind: 'reverse', h: 10, v: 10 }, align: { kind: 'center' }, spacing: { value: 5 }, bold: { h: 1, v: 1 }, zeroSuppress: 3, counter: { step: 1 } },
    { ...base, rotation: 0, attribute: { kind: 'box', h: 10, v: 10 }, align: { kind: 'right' }, spacing: { value: 5 }, bold: { h: 1, v: 1 }, counter: { step: 1 } },
  ];
  const r = zpl.emit({ size: { width: 800, height: 480 }, items }, { dpi: DPI });
  const texts = r.diagnostics.map(d => `${d.level}: ${d.text}`);
  assert.ok(r.text.includes('^FT10,100^A0R,40,40^FD7^FS'));
  assert.ok(r.text.includes('^SN7,1,N^FS') && r.text.includes('^SN7,1,Y^FS'));
  assert.equal(texts.filter(t => /contador/.test(t)).length, 0);
  for (const re of [/rotación/, /atributo/, /alineación/, /espaciado/, /negrita/, /ceros/]) assert.equal(texts.filter(t => re.test(t)).length, 1, String(re));
  assert.ok(texts.find(t => /rotación/.test(t)).startsWith('warning'));
  assert.ok(texts.find(t => /atributo/.test(t)).startsWith('warning'));
});

// ---------------------------------------------------------------------------------------------------------------
// Editing

const LABEL = '^XA\r\n^PW800\r\n^LL480\r\n^FO100,50^A0N,40,30^FDHello^FS\r\n^FT20,300^ABR,22,14^FR^FDWorld^FS\r\n^CF0,30,30\r\n^FO10,400^FDDefault^FS\r\n^XZ\r\n';
const items = parse(LABEL).items;
const describe = (item, text) => zpl.describeItem(item, text, { dpi: DPI });
const byKey = d => Object.fromEntries(d.fields.map(f => [f.key, f]));
const update = (item, changes, text = LABEL) => zpl.updateItem(text, item, changes, { dpi: DPI });

test('describeItem lists font, height, width, rotation, content and reverse of a ^A field, with and without the text', () => {
  const [hello, world] = items;
  const withText = describe(hello, LABEL);
  assert.equal(withText.kind, 'text');
  assert.deepEqual(withText.fields.map(f => f.key), ['font', 'height', 'width', 'rotation', 'content', 'reverse']);
  assert.deepEqual(withText.fields.map(f => f.value), ['0', 40, 30, 0, 'Hello', false]);
  assert.deepEqual(describe(hello), withText);
  assert.deepEqual(describe(world, LABEL).fields.map(f => f.value), ['B', 22, 14, 90, 'World', true]);
  assert.deepEqual(describe(world), describe(world, LABEL));
  const f = byKey(withText);
  assert.deepEqual([f.height.min, f.height.max, f.width.min, f.width.max], [0, 32000, 0, 32000]);
  assert.deepEqual(f.rotation.options.map(o => o.value), [0, 90, 180, 270]);
  assert.equal(f.reverse.type, 'checkbox');
  assert.equal(f.font.type, 'select');
});

test('the font select lists the guide fonts with their cells, and keeps a font the file has that is not in the list', () => {
  const options = byKey(describe(items[0], LABEL)).font.options;
  assert.deepEqual(options.map(o => o.value), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', '0']);
  assert.match(options.find(o => o.value === 'A').label, /^A · 9×5 puntos/);
  assert.match(options.find(o => o.value === 'E').label, /OCR-B/);
  assert.match(options.find(o => o.value === 'H').label, /OCR-A/);
  assert.match(options.find(o => o.value === '0').label, /Escalable/);
  const text = '^XA^FO10,10^APN,30,30^FDx^FS^XZ';
  const [p] = parse(text).items;
  const font = byKey(describe(p, text)).font;
  assert.equal(font.value, 'P');
  assert.deepEqual(font.options.map(o => o.value).slice(-1), ['P']);
});

test('a field with only data (default font) offers the content and the reverse print; a ^A without orientation or sizes offers only what it has', () => {
  const dflt = items[2];
  assert.deepEqual(describe(dflt, LABEL).fields.map(f => [f.key, f.value]), [['content', 'Default'], ['reverse', false]]);
  assert.deepEqual(describe(dflt).fields.map(f => f.key), ['content', 'reverse']);
  const text = '^XA^FO10,10^A0,,^FDx^FS^XZ';
  const [bare] = parse(text).items;
  assert.deepEqual(describe(bare, text).fields.map(f => f.key), ['font', 'content', 'reverse']);
  assert.deepEqual(describe(bare).fields.map(f => f.key), ['font', 'content', 'reverse']);
});

test('updateItem writes only the targeted argument of the field', () => {
  const [hello] = items;
  assert.equal(update(hello, { font: 'B' }), LABEL.replace('^A0N,40,30', '^ABN,40,30'));
  assert.equal(update(hello, { rotation: 90 }), LABEL.replace('^A0N,40,30', '^A0R,40,30'));
  assert.equal(update(hello, { height: 50 }), LABEL.replace('^A0N,40,30', '^A0N,50,30'));
  assert.equal(update(hello, { width: 0 }), LABEL.replace('^A0N,40,30', '^A0N,40,0'));
  assert.equal(update(hello, { content: 'Bye' }), LABEL.replace('^FDHello', '^FDBye'));
  assert.equal(update(hello, { height: 60, width: 55, rotation: 270, font: 'D' }), LABEL.replace('^A0N,40,30', '^ADB,60,55'));
  // invalid values and unknown keys change nothing
  assert.equal(update(hello, { font: 'ZZ', rotation: 45, height: 'x', nothing: 1 }), LABEL);
  assert.equal(update(hello, { height: 99999 }), LABEL.replace('^A0N,40,30', '^A0N,32000,30'));
});

test('the content with ^ or ~ is written with ^FH escapes (added when missing) and a line break becomes a space', () => {
  const [hello, world] = items;
  const edited = update(hello, { content: 'a^b~c' });
  assert.equal(edited, LABEL.replace('^A0N,40,30^FDHello', '^A0N,40,30^FH^FDa_5Eb_7Ec'));
  const again = parse(edited).items[0];
  assert.equal(again.data, 'a^b~c');
  assert.equal(update(again, { content: 'plain' }, edited), edited.replace('a_5Eb_7Ec', 'plain'));
  assert.equal(update(world, { content: 'x\r\ny' }), LABEL.replace('^FDWorld', '^FDx y'));
});

test('the reverse checkbox adds ^FR before ^FS and removes it (also from its own line)', () => {
  const [hello, world] = items;
  const on = update(hello, { reverse: true });
  assert.equal(on, LABEL.replace('^FDHello^FS', '^FDHello^FR^FS'));
  assert.equal(parse(on).items[0].reverse, true);
  assert.equal(update(world, { reverse: false }), LABEL.replace('^FR^FDWorld', '^FDWorld'));
  assert.equal(update(hello, { reverse: false }), LABEL);
  assert.equal(update(world, { reverse: true }), LABEL);
  const lines = '^XA\r\n^FO10,10\r\n^A0N,30,30\r\n^FR\r\n^FDx\r\n^FS\r\n^XZ';
  const [item] = parse(lines).items;
  assert.equal(update(item, { reverse: false }, lines), '^XA\r\n^FO10,10\r\n^A0N,30,30\r\n^FDx\r\n^FS\r\n^XZ');
  const dflt = update(items[2], { reverse: true });
  assert.equal(dflt, LABEL.replace('^FDDefault^FS', '^FDDefault^FR^FS'));
});

test('moveItem moves only the origin and keeps the rest of the field', () => {
  const [hello, world] = items;
  assert.equal(zpl.moveItem(LABEL, hello, 100, 50, { dpi: DPI }), LABEL.replace('^FO100,50', '^FO200,100'));
  assert.equal(zpl.moveItem(LABEL, world, -10, 10, { dpi: DPI }), LABEL.replace('^FT20,300', '^FT10,310'));
});

// ---------------------------------------------------------------------------------------------------------------
// Palette

test('the palette Texto: ^FO x,y ^A0N ^FD<#TEXTOn#> ^FS before ^XZ at the drop point, upright in a rotated view', () => {
  const base = '^XA\r\n^PW800\r\n^LL480\r\n^XZ\r\n';
  const build = (text, options) => zpl.buildComponent(text, 'text', { x: 100, y: 50 }, { dpi: DPI, ...options });
  const first = build(base, {});
  assert.equal(first, '^XA\r\n^PW800\r\n^LL480\r\n^FO100,50^A0N,40,40^FD<#TEXTO1#>^FS\r\n^XZ\r\n');
  assert.equal(build(first, {}).split('\r\n').filter(l => l.startsWith('^FO')).pop(), '^FO100,50^A0N,40,40^FD<#TEXTO2#>^FS');
  // item rotation = (360 - view) % 360
  assert.match(build(base, { viewRotation: 90 }), /\^A0B,40,40/);
  assert.match(build(base, { viewRotation: 180 }), /\^A0I,40,40/);
  assert.match(build(base, { viewRotation: 270 }), /\^A0R,40,40/);
  // it parses back: top-left at the drop point
  const item = parse(first).items[0];
  assert.deepEqual([item.kind, item.data, item.rotation, item.native.origin], ['text', '<#TEXTO1#>', 0, 'FO']);
  assert.deepEqual(parse(first).diagnostics, []);
  // the sizes are the same physical size at every resolution (4 mm)
  assert.match(zpl.buildComponent(base, 'text', { x: 100, y: 50 }, { dpi: 300 }), /\^FO118,59\^A0N,47,47\^FD/);
  assert.equal(zpl.buildComponent(base, 'nope', { x: 1, y: 1 }, {}), base);
});

// ---------------------------------------------------------------------------------------------------------------
// Rendering

test('the viewer draws a reverse text in white blended with difference and keeps it selectable', () => {
  const draw = src => PB.svgRenderer.render(parse(`^XA^PW800^LL480${src}^XZ`), { width: 800, height: 480 }, { textScale: 1, values: {} }).svg;
  const normal = draw('^FO10,10^A0N,40,40^FDx^FS');
  const reverse = draw('^FO10,10^A0N,40,40^FR^FDx^FS');
  assert.ok(!normal.includes('difference'));
  assert.ok(reverse.includes('mix-blend-mode:difference'));
  assert.ok(reverse.includes('class="hit"'));
});

// ---------------------------------------------------------------------------------------------------------------
// The example label

test('the ZPL example is a plausible label that parses without diagnostics and draws text of several fonts, a rotated one and a reverse one', () => {
  const example = PB.examples.find(e => e.id === 'zpl-label-100x60');
  assert.ok(example, 'there is a ZPL example');
  assert.equal(PB.examples.filter(e => e.id === example.id).length, 1);
  assert.match(example.source, /^\^XA\r?\n/);
  assert.match(example.source, /\^XZ$/);
  assert.equal(PB.languages.detect(example.source).id, 'zpl');
  const model = zpl.parse(example.source, { dpi: 203 });
  assert.deepEqual(model.diagnostics, []);
  assert.ok(model.items.length >= 6 && model.items.every(i => i.kind === 'text'));
  assert.ok(new Set(model.items.map(i => i.native.font)).size >= 3, 'several fonts');
  assert.ok(model.items.some(i => i.rotation === 90 || i.rotation === 270), 'a rotated one');
  assert.ok(model.items.some(i => i.reverse === true), 'a reverse one');
  assert.ok(model.items.some(i => i.native.origin === 'FT') && model.items.some(i => i.native.origin === 'FO'));
  assert.deepEqual([model.size.width, model.size.height].map(Number.isFinite), [true, true]);
  // its variables have test values
  const names = [...example.source.matchAll(/<?#([A-Z0-9_]+)#>?/g)].map(m => m[1]);
  for (const name of names) assert.ok(name in example.values, name);
  assert.deepEqual(zpl.emit(model, { dpi: 203 }).diagnostics.filter(d => d.level !== 'info'), []);
});

// ---------------------------------------------------------------------------------------------------------------
// Conversions through the shared pipeline

const TPCL_TEXT = '{D0500,1000,0500|}\r\n{AX;+000,+000,+00|}\r\n{C|}\r\n{PC001;0100,0200,10,10,J,00,B=Hola|}\r\n{PC002;0100,0400,10,10,J,11,B=Giro|}\r\n{PC003;0500,0300,10,10,A,00,B=Serif|}\r\n{XS;I,0001,0002C4100|}';
const TSPL_TEXT = 'SIZE 100 mm,60 mm\r\nCLS\r\nTEXT 40,30,"3",0,1,1,"Hola"\r\nTEXT 40,130,"0",90,12,12,"Giro"\r\nPRINT 1,1';

test('TPCL -> ZPL: every text keeps its data, rotation and position (^FT baseline), the font is mapped with one info', () => {
  const result = PB.convert.run(TPCL_TEXT, 'zpl', { dpi: 203 });
  assert.equal(result.source, 'tpcl');
  assert.equal(result.target, 'zpl');
  assert.deepEqual(result.diagnostics.filter(d => d.level !== 'info'), []);
  assert.equal(result.diagnostics.filter(d => /Las fuentes ZPL/.test(d.text)).length, 1);
  const original = PB.languages.get('tpcl').parse(TPCL_TEXT, { dpi: 203 });
  const back = zpl.parse(result.text, { dpi: 203 });
  assert.deepEqual(back.diagnostics, []);
  assert.deepEqual(back.items.map(i => i.data), original.items.map(i => i.data));
  assert.deepEqual(back.items.map(i => i.rotation), original.items.map(i => i.rotation));
  assert.ok(back.items.every(i => i.native.origin === 'FT'));
  original.items.forEach((a, i) => {
    near(back.items[i].x, a.x, 1, `x ${i}`);
    near(back.items[i].y, a.y, 1, `y ${i}`);
    near(back.items[i].font.size, a.font.size, 2, `size ${i}`);
  });
  assert.ok(result.text.startsWith('^XA\r\n^PW'));
});

test('TSPL -> ZPL: the mono bitmap font becomes the scalable 0 (no matrix fits) with a font info; data, rotation and position are kept', () => {
  const result = PB.convert.run(TSPL_TEXT, 'zpl', { dpi: 203 });
  assert.equal(result.source, 'tspl');
  assert.deepEqual(result.diagnostics.filter(d => d.level !== 'info'), []);
  assert.equal(result.diagnostics.filter(d => /Las fuentes ZPL/.test(d.text)).length, 1);
  const original = PB.languages.get('tspl').parse(TSPL_TEXT, { dpi: 203 });
  const back = zpl.parse(result.text, { dpi: 203 });
  assert.deepEqual(back.items.map(i => i.data), ['Hola', 'Giro']);
  assert.deepEqual(back.items.map(i => i.rotation), [0, 90]);
  original.items.forEach((a, i) => {
    near(back.items[i].x, a.x, 1, `x ${i}`);
    near(back.items[i].y, a.y, 1, `y ${i}`);
    near(back.items[i].font.size, a.font.size, 1.3, `size ${i}`);
    near(back.items[i].font.size * back.items[i].font.scaleX, a.font.size * a.font.scaleX, 1.3, `width ${i}`);
  });
});

const ZPL_TEXT = '^XA\r\n^PW800\r\n^LL480\r\n^FO100,50^A0N,40,30^FDHola^FS\r\n^FT200,300^AER,28,15^FDGiro^FS\r\n^FT300,400^A0I,50,50^FDInv^FS\r\n^XZ';

for (const target of ['tpcl', 'tspl']) {
  test(`ZPL -> ${target.toUpperCase()}: text keeps data, rotation, position and size; the font is reported`, () => {
    const result = PB.convert.run(ZPL_TEXT, target, { dpi: 203 });
    assert.equal(result.source, 'zpl');
    assert.deepEqual(result.diagnostics.filter(d => d.level !== 'info'), []);
    const language = PB.languages.get(target);
    const original = zpl.parse(ZPL_TEXT, { dpi: 203 });
    const back = language.parse(result.text, { dpi: 203 });
    assert.deepEqual(back.diagnostics.filter(d => d.level !== 'info'), []);
    assert.deepEqual(back.items.map(i => i.data), ['Hola', 'Giro', 'Inv']);
    assert.deepEqual(back.items.map(i => i.rotation), [0, 90, 180]);
    original.items.forEach((a, i) => {
      near(back.items[i].x, a.x, 1.3, `x ${i}`);
      near(back.items[i].y, a.y, 1.3, `y ${i}`);
      near(back.items[i].font.size, a.font.size, 8, `size ${i}`);
    });
    assert.ok(result.diagnostics.some(d => /fuentes/i.test(d.text)), 'the font fallback is reported');
  });
}

test('ZPL -> ZPL through Convertir keeps the text and its fields (round trip of the whole label)', () => {
  const result = PB.convert.run(ZPL_TEXT, 'zpl', { dpi: 203 });
  assert.deepEqual(result.diagnostics.filter(d => /fuentes/.test(d.text)), []);
  const [a, b] = [zpl.parse(ZPL_TEXT, { dpi: 203 }), zpl.parse(result.text, { dpi: 203 })];
  assert.deepEqual(b.items.map(i => [i.data, i.rotation, i.native.font, i.native.origin]), a.items.map(i => [i.data, i.rotation, i.native.font, i.native.origin]));
});
