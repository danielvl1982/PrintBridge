const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo } = require('./helpers/load');

// TPCL content editing (tpcl.js): the data of text, barcode and QR items lives inline ("=data") or in a separate
// R<C|V|B><id> command; updateItem rewrites only that data span and describeItem exposes it as a text field.
const PB = loadUpTo('js/languages/tpcl.js');
const tpcl = PB.languages.get('tpcl');
const FNC1 = PB.barcodeData.FNC1;

const itemsOf = text => tpcl.parse(text).items;
const set = (text, content, index = 0) => tpcl.updateItem(text, itemsOf(text)[index], { content }, { dpi: 203 });
const contentField = (text, index = 0) => tpcl.describeItem(itemsOf(text)[index], text).fields.find(f => f.key === 'content');

const PC_INLINE = '{PC001;0100,0200,05,05,A,00,B=HOLA|}';
const PV_RV = '{PV01;0100,0200,0100,0100,B,00,B|}\n{RV01;HOLA|}';
const PC_RC = '{PC001;0100,0200,05,05,A,00,B|}\n{RC001;HOLA|}';
const XB_128 = '{XB03;0050,0350,9,0,02,0,0080,0,000,1,00|}\n{RB03;ABC123|}';
const XB_39 = '{XB01;0050,0050,3,3,02,02,06,06,02,0,0080,1|}\n{RB01;CODE39|}';
const QR_RB = '{XB02;0100,0200,T,H,04,A,0,M2|}\n{RB02;https://example.com|}';

test('content: inline PC data is described and rewritten after the first "="', () => {
  const f = contentField(PC_INLINE);
  assert.deepEqual([f.key, f.label, f.type, f.value, f.maxLength], ['content', 'Contenido', 'text', 'HOLA', 255]);
  assert.equal(set(PC_INLINE, 'ADIOS = 1'), '{PC001;0100,0200,05,05,A,00,B=ADIOS = 1|}');
  assert.equal(itemsOf(set(PC_INLINE, 'ADIOS = 1'))[0].data, 'ADIOS = 1');
});

test('content: inline PV data with spacing and commas keeps the format options', () => {
  const text = '{PV01;0100,0200,0100,0100,B,+05,00,B=HI, 05,00|}';
  assert.equal(contentField(text).value, 'HI, 05,00');
  assert.equal(set(text, 'X'), '{PV01;0100,0200,0100,0100,B,+05,00,B=X|}');
});

test('content: PV with a separate RV command rewrites only the RV data', () => {
  assert.equal(contentField(PV_RV).value, 'HOLA');
  assert.equal(set(PV_RV, 'MUNDO'), '{PV01;0100,0200,0100,0100,B,00,B|}\n{RV01;MUNDO|}');
});

test('content: PC with an RC command rewrites the RC data, and the RC wins over an inline value', () => {
  const both = '{PC001;0100,0200,05,05,A,00,B=INLINE|}\n{RC001;HOLA|}';
  assert.equal(contentField(PC_RC).value, 'HOLA');
  assert.equal(set(PC_RC, 'ADIOS'), '{PC001;0100,0200,05,05,A,00,B|}\n{RC001;ADIOS|}');
  assert.equal(contentField(both).value, 'HOLA');
  assert.equal(set(both, 'ADIOS'), '{PC001;0100,0200,05,05,A,00,B=INLINE|}\n{RC001;ADIOS|}');
});

test('content: XB Code128 and Code39 rewrite the RB data', () => {
  assert.equal(contentField(XB_128).value, 'ABC123');
  assert.equal(set(XB_128, '999'), '{XB03;0050,0350,9,0,02,0,0080,0,000,1,00|}\n{RB03;999|}');
  assert.equal(contentField(XB_39).value, 'CODE39');
  assert.equal(set(XB_39, 'NEW-1'), '{XB01;0050,0050,3,3,02,02,06,06,02,0,0080,1|}\n{RB01;NEW-1|}');
});

test('content: QR rewrites the RB data (a URL with ":" and "=" is plain content)', () => {
  assert.equal(contentField(QR_RB).value, 'https://example.com');
  assert.equal(set(QR_RB, 'https://a.b/?q=1'), '{XB02;0100,0200,T,H,04,A,0,M2|}\n{RB02;https://a.b/?q=1|}');
});

test('content: the data command is matched by its own id among several items', () => {
  const text = `${PC_RC}\n{PC002;0100,0300,05,05,A,00,B|}\n{RC002;OTRO|}\n{XB02;0100,0200,T,H,04,A,0,M2|}\n{RB02;QR|}\n{RC001;LAST|}`;
  const out = set(text, 'NEW', 1);
  assert.equal(out, text.replace('RC002;OTRO', 'RC002;NEW'));
  assert.equal(set(text, 'NEW', 2), text.replace('RB02;QR', 'RB02;NEW'));
  // two RC for the same field: the parser keeps the last one
  assert.equal(contentField(text, 0).value, 'LAST');
  assert.equal(set(text, 'Z', 0), text.replace('RC001;LAST', 'RC001;Z'));
});

test('content: FNC1 is shown as ">8" and written back as such (lossless round trip)', () => {
  const text = '{XB03;0050,0350,9,0,02,0,0080,0,000,1,00|}\n{RB03;>8010123>8|}';
  const item = itemsOf(text)[0];
  assert.equal(item.data, `${FNC1}010123${FNC1}`);
  assert.equal(contentField(text).value, '>8010123>8');
  assert.equal(tpcl.describeItem(item).fields.find(f => f.key === 'content').value, '>8010123>8');
  assert.equal(set(text, '>8010123>8'), text);
  assert.equal(set(text, '>8991'), text.replace('>8010123>8', '>8991'));
  assert.equal(itemsOf(set(text, '>8991'))[0].data, `${FNC1}991`);
  // a pasted FNC1 character is written in the file notation
  assert.equal(set(text, `${FNC1}7`), text.replace('>8010123>8', '>87'));
});

test('content: CRLF texts keep their line endings and only the data changes', () => {
  const crlf = PC_RC.replaceAll('\n', '\r\n') + '\r\n{XS;I,0001,0002C4100|}\r\n';
  assert.equal(set(crlf, 'ADIOS'), crlf.replace('HOLA', 'ADIOS'));
  const inline = '{PC001;0100,0200,05,05,A,00,B=HOLA|}\r\n{XS;I,0001,0002C4100|}\r\n';
  assert.equal(set(inline, 'X'), inline.replace('HOLA', 'X'));
  assert.equal(contentField(crlf).value, 'HOLA');
});

test('content: a data command split by line breaks is found and its data replaced', () => {
  const text = '{PC001;0100,0200,05,05,A,00,B|}\r\n{RC001;HO\r\nLA|}';
  assert.equal(contentField(text).value, 'HOLA');
  assert.equal(set(text, 'X'), '{PC001;0100,0200,05,05,A,00,B|}\r\n{RC001;X|}');
});

test('content: other commands and bytes stay untouched', () => {
  const text = `{D0800,0600,0500|}\n{AX;+000,+000,+00|}\n{C|}\n${PC_RC}\n{LC;0100,0200,0500,0600,0,02|}\n{XS;I,0001,0002C4100|}\n`;
  assert.equal(set(text, 'ADIOS'), text.replace('RC001;HOLA', 'RC001;ADIOS'));
});

test('content: values with framing characters or line breaks are rejected (text unchanged)', () => {
  for (const bad of ['a|b', 'a{b', 'a}b', 'a\nb', 'a\rb', 'a|}{PV01;0,0|}']) {
    for (const text of [PC_INLINE, PV_RV, XB_128, QR_RB]) assert.equal(set(text, bad), text, JSON.stringify(bad));
  }
  assert.equal(tpcl.updateItem(PC_INLINE, itemsOf(PC_INLINE)[0], { content: 42 }, { dpi: 203 }), PC_INLINE);
});

test('content: an empty value and placeholders are normal content', () => {
  assert.equal(set(PC_RC, ''), '{PC001;0100,0200,05,05,A,00,B|}\n{RC001;|}');
  assert.equal(contentField('{PC001;0100,0200,05,05,A,00,B|}\n{RC001;|}').value, '');
  assert.equal(set(PV_RV, '<#TEXTO1#>'), PV_RV.replace('HOLA', '<#TEXTO1#>'));
  assert.equal(contentField(set(PV_RV, '<#TEXTO1#>')).value, '<#TEXTO1#>');
});

test('content: no data anywhere means no field and the change is ignored', () => {
  const pc = '{PC001;0100,0200,05,05,A,00,B|}';
  const xb = '{XB03;0050,0350,9,0,02,0,0080,0,000,1,00|}';
  for (const text of [pc, xb, '{XB02;0100,0200,T,H,04|}']) {
    assert.equal(contentField(text), undefined);
    assert.equal(tpcl.describeItem(itemsOf(text)[0]).fields.some(f => f.key === 'content'), false);
    assert.equal(set(text, 'X'), text);
  }
});

test('content: an RC that comes before its format command is not the data (no field)', () => {
  const text = '{RC001;HOLA|}\n{PC001;0100,0200,05,05,A,00,B|}';
  assert.equal(contentField(text), undefined);
  assert.equal(set(text, 'X'), text);
});

test('content: a duplicated format command is ambiguous (no field, change ignored)', () => {
  const text = `${PC_RC}\n{PC001;0200,0300,05,05,A,00,B|}`;
  assert.equal(contentField(text), undefined);
  assert.equal(set(text, 'X'), text);
});

test('content: a stale item (its command no longer at the source span) is ignored', () => {
  const item = itemsOf(PC_RC)[0];
  const other = '{LC;0100,0200,0500,0600,0,02|}\n{RC001;HOLA|}';
  assert.equal(tpcl.updateItem(other, item, { content: 'X' }, { dpi: 203 }), other);
});

test('content: describeItem without text uses the item data; the field comes last', () => {
  const d = tpcl.describeItem(itemsOf(PC_RC)[0]);
  assert.deepEqual(d.fields.map(f => f.key), ['fontType', 'kind', 'rotation', 'spacing', 'attribute', 'boldH', 'boldV', 'counter', 'zeroSuppress', 'align', 'content']);
  assert.equal(d.fields[10].value, 'HOLA');
  assert.deepEqual(tpcl.describeItem(itemsOf(PC_RC)[0], PC_RC).fields.map(f => f.key), ['fontType', 'kind', 'hMag', 'vMag', 'rotation', 'font', 'spacing', 'attribute', 'boldH', 'boldV', 'counter', 'zeroSuppress', 'align', 'content']);
  assert.deepEqual(tpcl.describeItem(itemsOf(QR_RB)[0], QR_RB).fields.map(f => f.key), ['cell', 'ecc', 'content']);
  assert.deepEqual(tpcl.describeItem(itemsOf(XB_128)[0], XB_128).fields.map(f => f.key), ['symbology', 'module', 'height', 'rotation', 'counter', 'humanReadable', 'zeroSuppress', 'content']);
});

test('content: several changes at once all apply, whatever their positions', () => {
  const text = '{PC001;0100,0200,05,05,A,00,B=HOLA|}\n{LC;0100,0200,0500,0600,0,02|}';
  const out = tpcl.updateItem(text, itemsOf(text)[0], { content: 'ADIOS MUNDO', rotation: 90, hMag: 15, vMag: 3 }, { dpi: 203 });
  assert.equal(out, '{PC001;0100,0200,15,05,A,11,B=ADIOS MUNDO|}\n{LC;0100,0200,0500,0600,0,02|}');
  const rc = tpcl.updateItem(PC_RC, itemsOf(PC_RC)[0], { rotation: 180, content: 'X', hMag: 7 }, { dpi: 203 });
  assert.equal(rc, '{PC001;0100,0200,07,05,A,22,B|}\n{RC001;X|}');
  const xb = tpcl.updateItem(XB_128, itemsOf(XB_128)[0], { content: 'Q', height: 120, humanReadable: false }, { dpi: 203 });
  assert.equal(xb, '{XB03;0050,0350,9,0,02,0,0120,0,000,0,00|}\n{RB03;Q|}');
});

test('content: a rejected content does not stop the other changes', () => {
  const out = tpcl.updateItem(PC_RC, itemsOf(PC_RC)[0], { content: 'a|b', rotation: 90 }, { dpi: 203 });
  assert.equal(out, '{PC001;0100,0200,05,05,A,11,B|}\n{RC001;HOLA|}');
});

test('content: describeItem values round-trip through updateItem for every kind', () => {
  for (const text of [PC_INLINE, PV_RV, PC_RC, XB_128, XB_39, QR_RB]) {
    const item = itemsOf(text)[0];
    const changes = Object.fromEntries(tpcl.describeItem(item, text).fields.map(f => [f.key, f.value]));
    assert.equal(tpcl.updateItem(text, item, changes, { dpi: 203 }), text);
  }
});
