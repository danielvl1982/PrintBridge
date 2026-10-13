const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Task S3 of odd/tasks/gs1-128.md: read, write and convert 'gs1-128' in TPCL, TSPL and ZPL. Printers never accept parentheses, so every language
// writes the Code 128 data (leading FNC1, FNC1 after a non-last variable AI) and reads Code 128 data that starts with FNC1 and is an element
// string as 'gs1-128'; any other Code 128 stays 'code128'.
const PB = loadApp();
const FNC1 = PB.barcodeData.FNC1;
const LANGS = ['tpcl', 'tspl', 'zpl'];
const DPIS = [203, 300];

const SSCC = '(00)000422730000001131';
const LEADING_ONLY = '(01)09501101530003(17)250101';
const MIXED = '(01)09501101530003(17)250101(10)ABC123(21)99';
// The Code 128 data of the strings above, without the leading FNC1 (the FNC1 separator after the lot (10) is written per language)
const SSCC_BODY = '00000422730000001131';
const LEADING_BODY = '010950110153000317250101';
const MIXED_HEAD = `${LEADING_BODY}10ABC123`;
const MIXED_TAIL = '2199';

const SIZE = { width: 1000, height: 600, pitch: 630, gap: 30, native: {} };
const barcode = (o = {}) => ({ kind: 'barcode', x: 100, y: 200, rotation: 0, module: 2.5, height: 80, humanReadable: true, symbology: 'gs1-128', data: SSCC, ...o });
const labelOf = items => ({ language: 'neutral', size: SIZE, items, diagnostics: [] });
const emit = (id, items, dpi = 203) => PB.languages.emit(id, labelOf(items), { dpi });
const parse = (id, text, dpi = 203) => PB.languages.get(id).parse(text, { dpi });
const barcodes = parsed => parsed.items.filter(i => i.kind === 'barcode');
const levels = (diagnostics, ...wanted) => diagnostics.filter(d => wanted.includes(d.level));
/** The neutral fields of an item (source, raw, native and ref belong to the language it was read from). */
const neutralOf = ({ source, raw, native, ref, ...rest }) => rest;

const tpclLabel = (data, type = '9') => `{D0630,1000,0600|}\n{AX;+000,+000,+00|}\n{C|}\n{XB01;0100,0200,${type},1,02,0,0080,+0000000000,000,1,00|}\n{RB01;${data}|}\n{XS;I,0001,0002C4100|}`;
const tsplLabel = (type, data) => `SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nBARCODE 100,200,"${type}",80,1,0,2,2,"${data}"\r\nPRINT 1,1\r\n`;
const zplLabel = (params, data) => `^XA\r\n^PW800\r\n^LL480\r\n^BY2,3,80\r\n^FO100,200^BC${params}^FD${data}^FS\r\n^XZ\r\n`;

// --- write

test('TPCL writes a gs1-128 barcode as Code 128 (type 9) with >8 for every FNC1', () => {
  const out = emit('tpcl', [barcode({ data: MIXED })]);
  assert.match(out.text, /\{XB\d+;\d+,\d+,9,/);
  assert.ok(out.text.includes(`;>8${MIXED_HEAD}>8${MIXED_TAIL}|}`), out.text);
  assert.ok(!out.text.includes('('), 'no parentheses reach the printer');
  assert.deepEqual(levels(out.diagnostics, 'warning', 'error'), []);
});

test('TSPL writes EAN128 for a leading FNC1 only and 128M with !102 for a separator', () => {
  const lead = emit('tspl', [barcode({ data: LEADING_ONLY })]).text;
  assert.match(lead, /"EAN128"/);
  assert.ok(lead.includes(`"${LEADING_BODY}"`), lead);
  const mixed = emit('tspl', [barcode({ data: MIXED })]).text;
  assert.match(mixed, /"128M"/);
  assert.ok(mixed.includes(`"!102${MIXED_HEAD}!102${MIXED_TAIL}"`), mixed);
  assert.ok(!mixed.includes('('));
});

test('ZPL writes ^BC with >8 for every FNC1 and keeps the UCC / mode extras it read', () => {
  const out = emit('zpl', [barcode({ data: MIXED })]).text;
  assert.ok(out.includes(`^FD>8${MIXED_HEAD}>8${MIXED_TAIL}^FS`), out);
  assert.match(out, /\^BCN,\d+,Y,N,N\^FD/);
  const item = barcodes(parse('zpl', zplLabel('N,80,Y,N,Y,U', `>8${SSCC_BODY}`)))[0];
  assert.equal(item.symbology, 'gs1-128');
  assert.equal(item.native.ucc, true);
  assert.equal(item.native.mode, 'U');
  assert.match(emit('zpl', [item]).text, new RegExp(`\\^BCN,80,Y,N,Y,U\\^FD>8${SSCC_BODY}\\^FS`));
});

// --- read

test('TPCL reads type 9 / A data that starts with FNC1 as gs1-128; plain Code 128 and non element strings stay code128', () => {
  const sscc = barcodes(parse('tpcl', tpclLabel(`>8${SSCC_BODY}`)))[0];
  assert.equal(sscc.symbology, 'gs1-128');
  assert.equal(sscc.data, SSCC);
  assert.equal(barcodes(parse('tpcl', tpclLabel(`>8${MIXED_HEAD}>8${MIXED_TAIL}`)))[0].data, MIXED);
  assert.equal(barcodes(parse('tpcl', tpclLabel(`>8${SSCC_BODY}`, 'A')))[0].symbology, 'gs1-128');
  const plain = barcodes(parse('tpcl', tpclLabel('ABC123')))[0];
  assert.equal(plain.symbology, 'code128');
  assert.equal(plain.data, 'ABC123');
  const unknownAi = barcodes(parse('tpcl', tpclLabel('>8ZZ123')))[0];
  assert.equal(unknownAi.symbology, 'code128');
  assert.equal(unknownAi.data, `${FNC1}ZZ123`);
  assert.equal(barcodes(parse('tpcl', tpclLabel(SSCC_BODY)))[0].symbology, 'code128');
});

test('TPCL type N (UCC/EAN128: 19 digits, the printer adds FNC1 and the check digits) stays unknown with an info and never crashes', () => {
  const parsed = parse('tpcl', tpclLabel('0004227300000011310', 'N'));
  const item = barcodes(parsed)[0];
  assert.equal(item.symbology, 'unknown');
  assert.equal(item.native.type, 'N');
  assert.ok(levels(parsed.diagnostics, 'info').some(d => /UCC\/EAN128/.test(d.text)));
  for (const id of LANGS) assert.doesNotThrow(() => emit(id, [item]));
});

test('TSPL reads EAN128 and 128M data that begins with FNC1 as gs1-128; 128 stays code128', () => {
  const ean = barcodes(parse('tspl', tsplLabel('EAN128', LEADING_BODY)))[0];
  assert.equal(ean.symbology, 'gs1-128');
  assert.equal(ean.data, LEADING_ONLY);
  const manual = barcodes(parse('tspl', tsplLabel('128M', `!102${MIXED_HEAD}!102${MIXED_TAIL}`)))[0];
  assert.equal(manual.symbology, 'gs1-128');
  assert.equal(manual.data, MIXED);
  assert.equal(barcodes(parse('tspl', tsplLabel('128', LEADING_BODY)))[0].symbology, 'code128');
  const notGs1 = barcodes(parse('tspl', tsplLabel('EAN128', 'ZZ123')))[0];
  assert.equal(notGs1.symbology, 'code128');
  assert.equal(notGs1.data, `${FNC1}ZZ123`);
});

test('ZPL reads ^BC data that starts with >8 as gs1-128; plain Code 128 stays code128', () => {
  const item = barcodes(parse('zpl', zplLabel('N,80,Y,N,N', `>8${MIXED_HEAD}>8${MIXED_TAIL}`)))[0];
  assert.equal(item.symbology, 'gs1-128');
  assert.equal(item.data, MIXED);
  assert.equal(barcodes(parse('zpl', zplLabel('N,80,Y,N,N', 'ABC123')))[0].symbology, 'code128');
  assert.equal(barcodes(parse('zpl', zplLabel('N,80,Y,N,N', '>8ZZ123')))[0].symbology, 'code128');
});

// --- structural errors never crash an emitter

for (const id of LANGS) {
  test(`${id}: a gs1-128 barcode that cannot be encoded gives the "cannot write" warning and no barcode`, () => {
    for (const data of ['(99)123', 'no parentheses', '', '(01']) {
      const out = emit(id, [barcode({ data })]);
      assert.ok(levels(out.diagnostics, 'warning').some(d => /sin equivalente/.test(d.text)), `${id} "${data}"`);
      assert.equal(barcodes(parse(id, out.text)).length, 0, `${id} "${data}": no barcode written`);
    }
  });
}

// --- round trips and conversion

const CASES = [
  ['sscc', { data: SSCC }],
  ['leading FNC1 only', { data: LEADING_ONLY }],
  ['separators', { data: MIXED }],
  ['no readable line, rotated', { data: MIXED, humanReadable: false, rotation: 90 }],
];

for (const dpi of DPIS) {
  for (const id of LANGS) {
    for (const [name, extra] of CASES) {
      test(`round trip ${id} @${dpi} dpi: parse(emit(x)) keeps the gs1-128 item (${name})`, () => {
        const source = barcode(extra);
        const out = emit(id, [source], dpi);
        assert.deepEqual(levels(out.diagnostics, 'warning', 'error'), []);
        const items = barcodes(parse(id, out.text, dpi));
        assert.equal(items.length, 1);
        assert.equal(items[0].symbology, 'gs1-128');
        assert.equal(items[0].data, source.data);
        assert.equal(items[0].humanReadable, source.humanReadable);
        assert.equal(items[0].rotation, source.rotation);
        const second = emit(id, [items[0]], dpi);
        assert.deepEqual(neutralOf(barcodes(parse(id, second.text, dpi))[0]), neutralOf(items[0]));
      });
    }
  }
}

for (const dpi of DPIS) {
  for (const from of LANGS) {
    for (const to of LANGS.filter(t => t !== from)) {
      test(`conversion ${from} > ${to} @${dpi} dpi: the same gs1-128 bars, no new warning`, () => {
        for (const [, extra] of CASES) {
          const written = emit(from, [barcode(extra)], dpi).text;
          const result = PB.convert.run(written, to, { dpi, sourceId: from });
          assert.deepEqual(levels(result.diagnostics, 'warning', 'error'), []);
          const [item] = barcodes(parse(to, result.text, dpi));
          assert.equal(item.symbology, 'gs1-128');
          assert.equal(item.data, extra.data);
        }
      });
    }
  }
}
