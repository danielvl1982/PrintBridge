const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

// Task S4 of odd/tasks/gs1-128.md: editing a gs1-128 barcode in the properties panel (Tipo de código, Contenido) in TPCL, TSPL and ZPL.
// The panel shows and accepts the standard notation with parentheses; the file always gets the Code 128 form (leading FNC1, separators).
const PB = loadApp();
const LANGS = ['tpcl', 'tspl', 'zpl'];
const GS1 = '(01)09501101530003(17)250101';
const GS1_MIXED = '(01)09501101530003(17)250101(10)ABC123(21)99';

const tpclText = data => `{D0630,1000,0600|}\n{AX;+000,+000,+00|}\n{C|}\n{XB01;0100,0200,9,1,02,0,0080,+0000000000,000,1,00|}\n{RB01;${data}|}\n{XS;I,0001,0002C4100|}`;
const tsplText = (type, data) => `SIZE 100 mm,60 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nBARCODE 100,200,"${type}",80,1,0,2,2,"${data}"\r\nPRINT 1,1\r\n`;
const zplText = data => `^XA\r\n^PW800\r\n^LL480\r\n^BY2,3,80\r\n^FO100,200^BCN,80,Y,N,N^FD${data}^FS\r\n^XZ\r\n`;
// A label of each language holding a Code 128 / GS1-128 barcode with the given data (the Code 128 form, as written in the file)
const FILES = {
  tpcl: { code128: tpclText('ABC123'), gs1: tpclText('>8010950110153000317250101'), plain: tpclText(GS1) },
  tspl: { code128: tsplText('128', 'ABC123'), gs1: tsplText('EAN128', '010950110153000317250101'), plain: tsplText('128', GS1) },
  zpl: { code128: zplText('ABC123'), gs1: zplText('>8010950110153000317250101'), plain: zplText(GS1) },
};

const lang = id => PB.languages.get(id);
const barcodeOf = (id, text) => lang(id).parse(text, { dpi: 203 }).items.find(i => i.kind === 'barcode');
const describe = (id, text) => lang(id).describeItem(barcodeOf(id, text), text, { dpi: 203 });
const field = (descriptor, key) => descriptor.fields.find(f => f.key === key);
const update = (id, text, changes) => lang(id).updateItem(text, barcodeOf(id, text), changes, { dpi: 203 });

// --- the select

for (const id of LANGS) {
  test(`${id}: Tipo de código offers GS1-128 and shows it for a gs1-128 barcode`, () => {
    const gs1 = describe(id, FILES[id].gs1);
    assert.equal(barcodeOf(id, FILES[id].gs1).symbology, 'gs1-128');
    assert.equal(field(gs1, 'symbology').value, 'gs1-128');
    assert.ok(field(gs1, 'symbology').options.some(o => o.value === 'gs1-128' && o.label === 'GS1-128'));
    const plain = describe(id, FILES[id].code128);
    assert.equal(field(plain, 'symbology').value, 'code128');
    assert.ok(field(plain, 'symbology').options.some(o => o.value === 'gs1-128'));
    // Also without the text (the model only)
    assert.equal(field(lang(id).describeItem(barcodeOf(id, FILES[id].gs1)), 'symbology').value, 'gs1-128');
  });

  test(`${id}: Contenido of a gs1-128 barcode shows the parenthesized notation, with a hint`, () => {
    const content = field(describe(id, FILES[id].gs1), 'content');
    assert.equal(content.value, GS1);
    assert.match(content.note, /\(01\)/);
    assert.match(content.note, /logístic/);
    assert.equal(field(describe(id, FILES[id].code128), 'content').note, undefined);
  });
}

// --- content: the standard notation in, the Code 128 form out

test('TPCL: a content edit writes >8 and the AIs without parentheses; a variable AI adds the separator', () => {
  const out = update('tpcl', FILES.tpcl.gs1, { content: GS1_MIXED });
  assert.ok(out.includes('{RB01;>8010950110153000317250101' + '10ABC123>82199|}'), out);
  assert.ok(!/RB01;[^|]*\(/.test(out), 'no parentheses reach the printer');
  const again = barcodeOf('tpcl', out);
  assert.equal(again.symbology, 'gs1-128');
  assert.equal(again.data, GS1_MIXED);
});

test('TSPL: a content edit writes EAN128 for a leading FNC1 only and 128M with !102 for a separator, and back', () => {
  const mixed = update('tspl', FILES.tspl.gs1, { content: GS1_MIXED });
  assert.ok(mixed.includes('"128M"') && mixed.includes('"!102010950110153000317250101' + '10ABC123!1022199"'), mixed);
  assert.equal(barcodeOf('tspl', mixed).data, GS1_MIXED);
  const lead = update('tspl', mixed, { content: GS1 });
  assert.ok(lead.includes('"EAN128"') && lead.includes('"010950110153000317250101"'), lead);
  assert.equal(barcodeOf('tspl', lead).data, GS1);
  assert.ok(!lead.includes('('));
});

test('ZPL: a content edit writes >8 and ">" as >0; the "_" indicator is escaped only when ^FH is on', () => {
  const mixed = update('zpl', FILES.zpl.gs1, { content: GS1_MIXED });
  assert.ok(mixed.includes('^FD>8010950110153000317250101' + '10ABC123>82199^FS'), mixed);
  assert.equal(barcodeOf('zpl', mixed).data, GS1_MIXED);
  const odd = update('zpl', FILES.zpl.gs1, { content: '(01)09501101530003(10)A>B_C' });
  assert.ok(odd.includes('^FD>8010950110153000310A>0B_C^FS'), odd);
  assert.equal(barcodeOf('zpl', odd).data, '(01)09501101530003(10)A>B_C');
  const hex = update('zpl', FILES.zpl.gs1.replace('^FD', '^FH^FD'), { content: '(01)09501101530003(10)A_C' });
  assert.ok(hex.includes('^FH^FD>8010950110153000310A_5FC^FS'), hex);
  assert.equal(barcodeOf('zpl', hex).data, '(01)09501101530003(10)A_C');
});

for (const id of LANGS) {
  test(`${id}: a content that is not a GS1 element string is refused, the text stays as it was`, () => {
    for (const content of ['(99)123', 'no parentheses', '', '(01']) {
      assert.equal(update(id, FILES[id].gs1, { content }), FILES[id].gs1, `${id} "${content}"`);
    }
  });

  test(`${id}: a content with a bad check digit is written (it is a warning, not garbage) and the diagnostics name the expected digit`, () => {
    const out = update(id, FILES[id].gs1, { content: '(01)09501101530004(17)250101' });
    assert.notEqual(out, FILES[id].gs1);
    const parsed = lang(id).parse(out, { dpi: 203 });
    const item = parsed.items.find(i => i.kind === 'barcode');
    assert.equal(item.symbology, 'gs1-128');
    const found = PB.slices.barcode.validate(item).filter(d => d.level === 'error');
    assert.equal(found.length, 1);
    assert.match(found[0].text, /dígito de control incorrecto.*debería ser 3/);
  });
}

// --- diagnostics of the notation (gs1.parse through the barcode validation of the panel)

test('diagnostics: unknown AI, wrong length, characters, date and the 48 characters limit are shown in Spanish', () => {
  const messages = data => PB.slices.barcode.validate({ symbology: 'gs1-128', ref: 'XB01', data }).map(d => `${d.level}: ${d.text}`);
  assert.match(messages('(99)123')[0], /error: .*\(99\).*subconjunto logístico/);
  assert.match(messages('(01)1234')[0], /debe tener 14 caracteres y tiene 4/);
  assert.match(messages('(10)ab#c')[0], /carácter no permitido/);
  assert.match(messages('(17)251301')[0], /el mes 13 no está entre 01 y 12/);
  assert.match(messages('(21)' + 'A'.repeat(20) + '(10)' + 'B'.repeat(20) + '(240)' + 'C'.repeat(10))[0], /^warning: .*más de los 48/);
  assert.deepEqual(messages(GS1_MIXED), []);
});

// --- switching the type

for (const id of LANGS) {
  test(`${id}: Code 128 with GS1 notation becomes GS1-128 and back; nothing else changes`, () => {
    const plain = FILES[id].plain;
    assert.equal(barcodeOf(id, plain).symbology, 'code128');
    const up = update(id, plain, { symbology: 'gs1-128' });
    assert.notEqual(up, plain);
    const item = barcodeOf(id, up);
    assert.equal(item.symbology, 'gs1-128');
    assert.equal(item.data, GS1);
    assert.ok(!up.includes('(01)'), 'the file holds the Code 128 form');
    const down = update(id, up, { symbology: 'code128' });
    const back = barcodeOf(id, down);
    assert.equal(back.symbology, 'code128');
    assert.equal(back.data, GS1);
    assert.equal(down, plain, 'back to the original text');
  });

  test(`${id}: Code 128 whose data is not a GS1 element string cannot become GS1-128 (refused, text unchanged)`, () => {
    assert.equal(update(id, FILES[id].code128, { symbology: 'gs1-128' }), FILES[id].code128);
  });

  test(`${id}: a gs1-128 barcode only changes to Code 128 (other types would lose the FNC1 data)`, () => {
    assert.equal(update(id, FILES[id].gs1, { symbology: 'code39' }), FILES[id].gs1);
    assert.equal(update(id, FILES[id].gs1, { symbology: 'ean13' }), FILES[id].gs1);
  });
}

test('TSPL: a gs1-128 command written with 128M keeps its form on a type switch and a 128M literal "!nnn" is refused', () => {
  const file = tsplText('128M', '!102010950110153000317250101');
  assert.equal(barcodeOf('tspl', file).symbology, 'gs1-128');
  assert.equal(update('tspl', file, { content: '(01)09501101530003(10)A!103B(21)9' }), file, '!103 would be read as a control code');
});

// --- the writer names the real cause

for (const id of LANGS) {
  test(`${id}: a gs1-128 barcode with invalid data warns about the GS1-128 data, not about a missing equivalent`, () => {
    const item = { kind: 'barcode', x: 100, y: 200, rotation: 0, module: 2.5, height: 80, humanReadable: true, symbology: 'gs1-128', data: '(99)123' };
    const out = PB.languages.emit(id, { language: 'neutral', size: { width: 1000, height: 600, pitch: 630, gap: 30, native: {} }, items: [item], diagnostics: [] }, { dpi: 203 });
    const warnings = out.diagnostics.filter(d => d.level === 'warning').map(d => d.text);
    assert.ok(warnings.some(t => /GS1-128/.test(t) && /datos no válidos/.test(t) && /\(99\)/.test(t)), warnings.join(' | '));
    assert.ok(!warnings.some(t => /sin equivalente/.test(t)));
    assert.equal(lang(id).parse(out.text, { dpi: 203 }).items.filter(i => i.kind === 'barcode').length, 0);
  });
}

// S5: a refused edit is reported in the avisos (js/app.js changeProperty shows this text as a warning notice).
test('PB.gs1.rejectedEditMessage names the cause of a notation that cannot be encoded and says the previous content is kept', () => {
  const unknown = PB.gs1.rejectedEditMessage('(99)123');
  assert.match(unknown, /\(99\)/);
  assert.match(unknown, /no está en el subconjunto logístico/);
  assert.match(unknown, /se mantiene el contenido anterior/);
  assert.match(PB.gs1.rejectedEditMessage('sin paréntesis'), /deben empezar por un identificador/);
  assert.match(PB.gs1.rejectedEditMessage(''), /vacíos/);
});

test('PB.gs1.rejectedEditMessage has a generic cause when the notation is fine but the language cannot write it', () => {
  assert.match(PB.gs1.rejectedEditMessage(GS1), /no se puede escribir en este lenguaje/);
});

test('the refused edit of the three languages leaves the text unchanged (the case the message reports)', () => {
  const tspl = 'SIZE 100 mm,60 mm\nGAP 3 mm,0 mm\nCLS\nBARCODE 40,40,"EAN128",100,1,0,2,2,"0109501101530003"\nPRINT 1,1';
  const src = { tpcl: tpclText('>80109501101530003'), tspl, zpl: '^XA\n^FO40,40^BCN,100,Y,N,N^FD>80109501101530003^FS\n^XZ' };
  for (const id of LANGS) {
    const language = PB.languages.get(id);
    const item = language.parse(src[id], { dpi: 203 }).items.find(i => i.kind === 'barcode');
    assert.equal(item.symbology, 'gs1-128', id);
    assert.equal(language.updateItem(src[id], item, { content: '(99)123' }, { dpi: 203 }), src[id], id);
  }
});
