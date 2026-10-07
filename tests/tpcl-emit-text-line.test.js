const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

const PB = loadUpTo('js/languages/tspl.js');
const tpcl = PB.languages.get('tpcl');
const spool = PB.examples.find(e => e.id === 'spool-99x55');
const barcodes = PB.examples.find(e => e.id === 'barcodes-code39-itf-code128');

const emit = (model, dpi = 203) => PB.languages.emit('tpcl', model, { dpi });
const lines = model => emit(model).text.split('\n');
const model = (items = [], size = {}) => ({
  language: 'tpcl',
  size: { width: 990, height: 550, pitch: 610, gap: null, native: {}, ...size },
  items,
  diagnostics: [],
});
const text = (props = {}) => ({
  kind: 'text', x: 600, y: 75, rotation: 0, data: 'HOLA',
  font: { size: 12 * PB.units.UNITS_PER_POINT * 0.8, scaleX: 1, family: 'sans', weight: 700, style: 'normal' },
  ...props,
});
const pv = (props = {}) => text({ font: { size: 80, scaleX: 0.75, family: 'sans', weight: 700, style: 'normal' }, ...props });
const line = (props = {}) => ({ kind: 'line', x1: 50, y1: 60, x2: 450, y2: 60, rect: false, width: 38, ...props });
const body = model_ => lines(model_).slice(3, -1);
const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));

/** Neutral items of the kinds T2 emits, without the identity/origin fields. */
const neutral = parsed => parsed.items
  .filter(i => ['text', 'line'].includes(i.kind))
  .map(({ source, raw, native, ref, ...rest }) => ({ ...rest, data: 'data' in rest ? rest.data ?? '' : undefined }));

test('the tpcl language registers an emit hook', () => {
  assert.equal(typeof tpcl.emit, 'function');
});

test('header and trailer come from the model size, the catalog AX and the default XS', () => {
  const out = emit(model());
  assert.equal(out.text, '{D0610,0990,0550|}\n{AX;+010,+000,+00|}\n{C|}\n{XS;I,0001,0002C4100|}');
  assert.ok(out.diagnostics.some(d => d.level === 'info' && /\{XS\}.*por defecto.*verifíquelos en su impresora/.test(d.text)));
});

test('dRaw and axRaw are reused while the size is unchanged', () => {
  const m = model([], { pitch: 610, width: 990, height: 550, native: { dRaw: 'D610,990,550', axRaw: 'AX;+001,+002,+03' } });
  const out = lines(m);
  assert.equal(out[0], '{D610,990,550|}');
  assert.equal(out[1], '{AX;+001,+002,+03|}');
});

test('a changed size builds D again and drops a stale axRaw', () => {
  const m = model([], { width: 1000, native: { dRaw: 'D610,990,550', axRaw: 'AX;+001,+002,+03' } });
  const out = emit(m);
  assert.deepEqual(out.text.split('\n').slice(0, 2), ['{D0610,1000,0550|}', '{C|}']);
  assert.ok(out.diagnostics.some(d => d.level === 'info' && /AX/.test(d.text)));
});

test('a size outside the catalog omits AX with a Spanish info', () => {
  const out = emit(model([], { pitch: 550, width: 800, height: 500 }));
  assert.equal(out.text.split('\n')[0], '{D0550,0800,0500|}');
  assert.ok(!/\{AX/.test(out.text));
  assert.ok(out.diagnostics.some(d => d.level === 'info' && /AX/.test(d.text)));
});

test('a model without size writes no D and warns in Spanish', () => {
  const out = emit(model([], { width: null, height: null, pitch: null }));
  assert.ok(!/\{D/.test(out.text));
  assert.ok(out.text.includes('{C|}'));
  assert.ok(out.diagnostics.some(d => d.level === 'warning' && /tamaño/.test(d.text)));
});

test('bitmap fonts: a model font that matches BITMAP_FONTS becomes PC + RC', () => {
  assert.deepEqual(body(model([text()])), ['{PC00;0600,0075,08,08,J,00,B|}', '{RC00;HOLA|}']);
});

test('PC keeps different horizontal and vertical magnifications', () => {
  const font = { size: 12 * PB.units.UNITS_PER_POINT * 0.5, scaleX: 1.6, family: 'sans', weight: 700, style: 'normal' };
  assert.equal(body(model([text({ font })]))[0], '{PC00;0600,0075,08,05,J,00,B|}');
});

test('serif italic matches the italic bitmap font F', () => {
  const font = { size: 12 * PB.units.UNITS_PER_POINT, scaleX: 1, family: 'serif', weight: 400, style: 'italic' };
  assert.equal(body(model([text({ font })]))[0], '{PC00;0600,0075,10,10,F,00,B|}');
});

test('outline fonts: a font that matches no bitmap font becomes PV + RV with width = size * scaleX', () => {
  assert.deepEqual(body(model([pv()])), ['{PV00;0600,0075,0060,0080,B,00,B|}', '{RV00;HOLA|}']);
});

test('rotations map to the text codes 00/11/22/33', () => {
  const codes = [0, 90, 180, 270].map(rotation => body(model([text({ rotation })]))[0].match(/,(\d\d),B\|\}$/)[1]);
  assert.deepEqual(codes, ['00', '11', '22', '33']);
});

test('ids are unique 2-digit numbers per namespace and match their data command', () => {
  const out = body(model([text(), text(), text(), pv(), pv()]));
  assert.deepEqual(out.map(l => l.match(/^\{([A-Z]{2}\d\d);/)[1]), ['PC00', 'RC00', 'PC01', 'RC01', 'PC02', 'RC02', 'PV00', 'RV00', 'PV01', 'RV01']);
});

test('data with #NAME# placeholders is written as the parser accepts it back', () => {
  const m = model([text({ data: '#ROLLNUM# / #TOTALROLLS#' })]);
  assert.equal(body(m)[1], '{RC00;#ROLLNUM# / #TOTALROLLS#|}');
  assert.equal(tpcl.parse(emit(m).text).items[0].data, '#ROLLNUM# / #TOTALROLLS#');
});

test('characters that break the {…|} framing become spaces with one Spanish warning', () => {
  const out = emit(model([text({ data: 'a|b{c}d' }), pv({ data: 'x}y' })]));
  assert.ok(out.text.includes('{RC00;a b c d|}'));
  assert.ok(out.text.includes('{RV00;x y|}'));
  const warnings = levels(out.diagnostics, 'warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /\{.*\|/);
});

test('text without data still gets an (empty) data command', () => {
  assert.deepEqual(body(model([text({ data: null })])), ['{PC00;0600,0075,08,08,J,00,B|}', '{RC00;|}']);
});

test('coordinates outside 0..9999 are clamped with a single warning', () => {
  const out = emit(model([text({ x: 12000, y: -5 }), text({ x: 20000 })]));
  assert.ok(out.text.includes('{PC00;9999,0000,'));
  assert.ok(out.text.includes('{PC01;9999,0075,'));
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

test('lines and boxes become LC with the thickness converted to dots at the resolution', () => {
  assert.equal(body(model([line()]))[0], '{LC;0050,0060,0450,0060,0,30|}');
  assert.equal(body(model([line({ rect: true })]))[0], '{LC;0050,0060,0450,0060,1,30|}');
  assert.equal(emit(model([line()]), 300).text.split('\n')[3], '{LC;0050,0060,0450,0060,0,45|}');
});

test('the line thickness is at least 1 dot and at most 99 (with a warning)', () => {
  assert.equal(body(model([line({ width: 0.5 })]))[0].split(',').pop(), '01|}');
  const out = emit(model([line({ width: 200 })]), 300);
  assert.ok(out.text.includes(',99|}'));
  assert.equal(levels(out.diagnostics, 'warning').length, 1);
});

test('line coordinates are clamped too', () => {
  assert.equal(body(model([line({ x2: 99999 })]))[0], '{LC;0050,0060,9999,0060,0,30|}');
});

test('items of a kind without an emitter are reported as a Spanish warning', () => {
  const out = emit(model([{ kind: 'hologram', x: 1, y: 1 }, text()]));
  assert.ok(out.diagnostics.some(d => d.level === 'warning' && /hologram/.test(d.text) && /sin emisor/.test(d.text)));
  assert.ok(out.text.includes('{PC00;'));
});

test('emitted text/line/box re-parses without errors or warnings', () => {
  const m = model([text(), pv({ rotation: 90 }), line(), line({ rect: true })]);
  const parsed = tpcl.parse(emit(m).text);
  assert.deepEqual(levels(parsed.diagnostics, 'error', 'warning'), []);
  assert.equal(parsed.items.length, 4);
});

test('PB.languages.emit returns { text, diagnostics } with LF lines and no trailing newline', () => {
  const out = PB.languages.emit('tpcl', model([text()]), { dpi: 203 });
  assert.equal(typeof out.text, 'string');
  assert.ok(Array.isArray(out.diagnostics));
  assert.ok(out.text.startsWith('{D') && out.text.endsWith('|}') && !out.text.includes('\r'));
});

for (const example of [spool, barcodes]) {
  test(`round trip on the "${example.id}" example keeps the text/line/box items`, () => {
    const first = tpcl.parse(example.source);
    const out = emit(first);
    const second = tpcl.parse(out.text);
    assert.deepEqual(levels(second.diagnostics, 'error', 'warning'), []);
    assert.ok(neutral(first).length > 0);
    assert.deepEqual(neutral(second), neutral(first));
    assert.deepEqual([second.size.width, second.size.height, second.size.pitch], [first.size.width, first.size.height, first.size.pitch]);
    assert.equal(second.size.native.dRaw, first.size.native.dRaw);
    assert.equal(second.size.native.axRaw, first.size.native.axRaw);
    // Every kind has an emitter since T3 (barcode, qr, image)
    assert.equal(out.diagnostics.filter(d => /sin emisor/.test(d.text)).length, 0);
  });
}
