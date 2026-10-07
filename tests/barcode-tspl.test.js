const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/drawing.js');
const tspl = PB.languages.get('tspl');
const parse = (src, opts) => tspl.parse(src, opts);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const one = (src, opts) => {
  const model = parse(src, opts);
  assert.equal(model.items.length, 1, JSON.stringify(model.diagnostics));
  return model.items[0];
};
const DOT = 254 / 203;
const bc = (type, content = '12345678', extra = '') => `BARCODE 10,20,"${type}",100,1,0,2,4,${extra}"${content}"`;
const FNC1 = PB.barcodeData.FNC1;

test('barcode registers a TSPL hook factory next to the TPCL one', () => {
  assert.equal(typeof PB.components.get('barcode').languages.tspl, 'function');
  assert.equal(typeof PB.components.get('barcode').languages.tpcl, 'function');
});

test('BARCODE builds the neutral item: position, height and module in dots -> 0.1 mm', () => {
  const item = one('BARCODE 16,40,"128",80,1,0,3,6,"ABC123"');
  assert.equal(item.kind, 'barcode');
  assert.equal(item.ref, 'BARCODE');
  assert.equal(item.symbology, 'code128');
  near(item.x, 16 * DOT);
  near(item.y, 40 * DOT);
  near(item.height, 80 * DOT);
  near(item.module, 3 * DOT);
  assert.equal(item.rotation, 0);
  assert.equal(item.humanReadable, true);
  assert.equal(item.data, 'ABC123');
  assert.deepEqual(item.native, { type: '128', module: 3, wide: 6, humanReadable: 1 });
});

test('BARCODE conversions at 300 dpi', () => {
  const item = one('BARCODE 12,24,"128",120,0,0,2,4,"A"', { dpi: 300 });
  near(item.x, 12 * 254 / 300);
  near(item.y, 24 * 254 / 300);
  near(item.height, 120 * 254 / 300);
  near(item.module, 2 * 254 / 300);
});

test('BARCODE applies REFERENCE', () => {
  const item = one('REFERENCE 10,5\r\nBARCODE 10,20,"128",100,0,0,2,4,"A"');
  near(item.x, 20 * DOT);
  near(item.y, 25 * DOT);
});

test('human readable: 0 none, 1/2/3 shown', () => {
  const hr = v => one(`BARCODE 0,0,"128",100,${v},0,2,4,"A"`).humanReadable;
  assert.equal(hr(0), false);
  assert.equal(hr(1), true);
  assert.equal(hr(2), true);
  assert.equal(hr(3), true);
});

test('rotation 0/90/180/270 clockwise; an invalid one warns and draws unrotated', () => {
  for (const r of [0, 90, 180, 270]) assert.equal(one(`BARCODE 0,0,"128",100,0,${r},2,4,"A"`).rotation, r);
  const model = parse('BARCODE 0,0,"128",100,0,45,2,4,"A"');
  assert.equal(model.items[0].rotation, 0);
  assert.match(model.diagnostics[0].text, /rotación/);
});

test('type map: 128, 39 family, 25 family and EAN13', () => {
  const sym = t => one(bc(t)).symbology;
  assert.equal(sym('128'), 'code128');
  assert.equal(sym('39'), 'code39');
  assert.equal(sym('39S'), 'code39');
  assert.equal(sym('39C'), 'code39');
  assert.equal(sym('25'), 'itf');
  assert.equal(sym('25C'), 'itf');
  assert.equal(sym('ITF14'), 'itf');
  assert.equal(sym('EAN14'), 'itf');
  assert.equal(sym('EAN13'), 'ean13');
  assert.equal(sym('ean13'), 'ean13');
});

test('check digit: 39C is mod43, 39 none, 25C has no neutral equivalent', () => {
  assert.equal(one(bc('39C', 'ABC')).check, 'mod43');
  assert.equal(one(bc('39', 'ABC')).check, 'none');
  assert.equal(one(bc('25C')).check, 'unsupported');
  assert.equal(one(bc('25')).check, 'none');
});

test('Code 39 / ITF take the wide and narrow widths from narrow and wide dots', () => {
  const item = one('BARCODE 0,0,"39",100,0,0,2,5,"ABC"');
  near(item.widths.narrowBar, 2 * DOT);
  near(item.widths.narrowSpace, 2 * DOT);
  near(item.widths.wideBar, 5 * DOT);
  near(item.widths.wideSpace, 5 * DOT);
  near(item.interCharGap, 2 * DOT);
  assert.equal(one(bc('128')).widths, undefined);
});

test('128M: start codes dropped, !102 is FNC1', () => {
  assert.equal(one(bc('128M', '!104ABC')).data, 'ABC');
  assert.equal(one(bc('128M', '!103A!102B')).data, 'A' + FNC1 + 'B');
  assert.equal(one(bc('128M', '!105!1021234')).data, FNC1 + '1234');
  assert.equal(one(bc('128M', 'X')).symbology, 'code128');
});

test('128M: other control codes are dropped with one info', () => {
  const model = parse(bc('128M', '!104A!100B!101'));
  assert.equal(model.items[0].data, 'AB');
  const infos = model.diagnostics.filter(d => d.level === 'info');
  assert.equal(infos.length, 1);
  assert.match(infos[0].text, /!100, !101/);
});

test('EAN128 is Code128 with a leading FNC1', () => {
  const item = one(bc('EAN128', '0112345678901231'));
  assert.equal(item.symbology, 'code128');
  assert.equal(item.data, FNC1 + '0112345678901231');
  assert.equal(item.native.type, 'EAN128');
});

test('optional alignment: present with 10 arguments', () => {
  const item = one('BARCODE 0,0,"128",100,1,0,2,4,2,"HELLO"');
  assert.equal(item.data, 'HELLO');
  assert.equal(item.native.align, 2);
  assert.equal(one('BARCODE 0,0,"128",100,1,0,2,4,"HELLO"').native.align, undefined);
});

test('quoted commas and the \\" escape in the content', () => {
  assert.equal(one('BARCODE 0,0,"128",100,0,0,2,4,"A,B"').data, 'A,B');
  assert.equal(one('BARCODE 0,0,"128",100,0,0,2,4,"A\\"B"').data, 'A"B');
});

test('unknown types are unknown with the raw type kept and a validator warning', () => {
  for (const type of ['93', 'CODA', 'MSI', 'POST', 'UPCA', 'EAN8', 'EAN13+2x']) {
    const item = one(bc(type));
    assert.equal(item.symbology, 'unknown', type);
    assert.equal(item.native.type, type);
  }
  const model = parse(bc('93'));
  const warnings = PB.validator.validate(model).filter(d => d.level === 'warning');
  assert.ok(warnings.some(d => /BARCODE: código "unknown" \(tipo 93\)/.test(d.text)), JSON.stringify(warnings));
});

test('add-on variants use the base type and note the add-on', () => {
  const model = parse(bc('EAN13+2'));
  assert.equal(model.items[0].symbology, 'ean13');
  assert.equal(model.items[0].native.type, 'EAN13+2');
  assert.ok(model.diagnostics.some(d => d.level === 'info' && /complemento/.test(d.text)));
  assert.equal(one(bc('UPCA+5')).symbology, 'unknown');
});

test('counters stay literal with a single info per label', () => {
  const model = parse('BARCODE 0,0,"128",100,0,0,2,4,"X"+@1\r\nBARCODE 0,50,"128",100,0,0,2,4,@2');
  assert.equal(model.items.length, 2);
  assert.equal(model.items[0].data, '"X"+@1');
  assert.equal(model.diagnostics.filter(d => /contador/.test(d.text)).length, 1);
});

test('incomplete or invalid BARCODE warns and adds no item', () => {
  for (const src of ['BARCODE 0,0,"128",100', 'BARCODE a,0,"128",100,0,0,2,4,"A"', 'BARCODE 0,0,"128",0,0,0,2,4,"A"']) {
    const model = parse(src);
    assert.equal(model.items.length, 0, src);
    assert.equal(model.diagnostics.length, 1, src);
    assert.equal(model.diagnostics[0].level, 'warning');
  }
});

test('the source span covers exactly the BARCODE line', () => {
  const src = 'SIZE 100 mm,60 mm\r\nBARCODE 10,20,"128",100,1,0,2,4,"ABC"\r\nPRINT 1\r\n';
  const item = one(src);
  const [span] = item.source.spans;
  assert.equal(src.slice(span.start, span.end), 'BARCODE 10,20,"128",100,1,0,2,4,"ABC"');
  assert.equal(item.source.spans.length, 1);
});

test('end to end: SIZE + BARCODE', () => {
  const model = parse('SIZE 100 mm,60 mm\r\nCLS\r\nBARCODE 40,40,"128",80,1,0,2,4,"HELLO"\r\nPRINT 1,1\r\n');
  assert.equal(model.size.width, 1000);
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].kind, 'barcode');
  assert.deepEqual(model.diagnostics, []);
});

test('a parsed TSPL barcode renders with the SVG renderer', () => {
  const draw = src => {
    const model = parse(src);
    return PB.svgRenderer.render(model, PB.sizes.view(model, null), { textScale: 1, showGrid: false, showAnchors: false, values: {} });
  };
  const c128 = draw('SIZE 100 mm,60 mm\r\nBARCODE 16,40,"128",80,1,90,2,4,"ABC123"');
  assert.match(c128.svg, /<g transform="rotate\(90 /);
  assert.match(c128.svg, /<path d="M/);
  assert.match(c128.svg, />ABC123<\/text>/);
  assert.equal((c128.svg.match(/class="not-generated"/g) || []).length, 0);
  assert.match(c128.diagnostics[0].text, /^BARCODE: Code128: /);
  const c39 = draw('SIZE 100 mm,60 mm\r\nBARCODE 16,40,"39C",80,0,0,2,5,"ABC"');
  assert.match(c39.diagnostics[0].text, /^BARCODE: Code39: /);
  const gs1 = draw('SIZE 100 mm,60 mm\r\nBARCODE 16,40,"EAN128",80,1,0,2,4,"0112345678901231"');
  assert.equal(gs1.svg.includes(FNC1), false);
  const unk = draw('SIZE 100 mm,60 mm\r\nBARCODE 16,40,"93",80,0,0,2,4,"ABC"');
  assert.match(unk.diagnostics[0].text, /\(aprox\.\)/);
});
