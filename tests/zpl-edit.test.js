const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo, load } = require('./helpers/load');

// Z1: the ZPL field machinery (grouping of the commands of a field, the deferred dispatch at ^FS) and the generic move /
// describe / update / build engines (js/languages/zpl-edit.js), exercised with a TEST slice: a fake component registered
// before js/languages/zpl.js loads, standing for what the real slices (text in Z2, bar codes in Z3...) will provide.
// All parses use 254 dpi, where one dot is exactly 0.1 mm, so dots and model units are the same number.
const PB = loadUpTo('js/languages/zpl-edit.js');

const ROTATIONS = [0, 90, 180, 270];
const rotationOptions = ROTATIONS.map(value => ({ value, label: `${value}°` }));

PB.components.register({
  kind: 'zfake',
  order: 5,
  label: 'Fake',
  glyph: 'F',
  languages: {
    zpl: helpers => {
      const { sourceOf, int, rotationOf, orientationOf, numberField, stringSelectField, checkboxField, contentField, insertCommand, dropDots, itemRotation, fieldData, toDots, fo } = helpers;
      const base = (ref, field, ctx) => {
        const o = ctx.origin(field);
        return { kind: 'zfake', ref, source: sourceOf(field), x: o.x, y: o.y, originKind: o.kind, data: field.data ? field.data.value : null, reverse: field.reverse };
      };
      return {
        handlers: [
          {
            // ^Af,o,h,w text: the font letter and the orientation are glued in the first argument
            pattern: /^\^A$/,
            handle(m, cmd, ctx, field) {
              const raw = cmd.args[0] ? cmd.args[0].raw : '';
              const height = int(cmd.args[1]);
              ctx.addItem({
                ...base('A', field, ctx), rotation: rotationOf(raw[1] || ctx.orientation), height: height === null ? 0 : height,
                native: { height }, fieldMain: cmd.id,
              });
            },
          },
          {
            // A field with data and no font command: text in the default font (^CF)
            pattern: /^\^FD$/,
            handle(m, cmd, ctx, field) {
              ctx.addItem({ ...base('FD', field, ctx), rotation: rotationOf(ctx.orientation), height: ctx.font.height, native: {}, fieldMain: cmd.id });
            },
          },
          {
            pattern: /^\^GB$/,
            handle(m, cmd, ctx, field) {
              ctx.addItem({ ...base('GB', field, ctx), rotation: 0, width: ctx.len(int(cmd.args[0]) || 0), native: { width: int(cmd.args[0]) } });
            },
          },
          {
            pattern: /^\^BC$/,
            handle(m, cmd, ctx, field) {
              ctx.addItem({ ...base('BC', field, ctx), rotation: rotationOf(cmd.args[0] ? cmd.args[0].raw : ctx.orientation), native: {} });
            },
          },
          { pattern: /^\^LR$/, immediate: true, handle(m, cmd, ctx) { ctx.fakeLR = (ctx.fakeLR || 0) + 1; } },
        ],
        coordinates: [{ applies: item => item.kind === 'zfake' }],
        editable: [
          {
            applies: (item, field) => item.kind === 'zfake' && item.ref !== 'GB' && item.ref !== 'BC' && (!field || field.has('A') || !field.has('GB')),
            fields: [
              contentField('content', 'Contenido', item => item.data),
              numberField('height', 'Alto (puntos)', 'A', 1, 1, 32000, item => item.native && item.native.height),
              {
                key: 'rotation', label: 'Rotación', type: 'select', cmd: 'A', arg: 0, options: rotationOptions, model: item => item.rotation,
                read: a => (a.raw.length > 1 ? rotationOf(a.raw[1]) : undefined),
                write: (v, a) => (ROTATIONS.includes(v) ? a.raw[0] + orientationOf(v) + a.raw.slice(2) : null),
              },
            ],
          },
          {
            applies: (item, field) => item.kind === 'zfake' && item.ref === 'GB' && (!field || field.has('GB')),
            fields: [
              numberField('width', 'Ancho (puntos)', 'GB', 0, 1, 32000, item => item.native && item.native.width),
              { ...stringSelectField('color', 'Color', 'GB', 3, ['B', 'W'], () => 'B'), optional: 'B' },
              { key: 'variant', label: 'Variante', type: 'select', cmd: 'GB', arg: 0, reemit: true, options: [{ value: 'x', label: 'x' }], read: () => 'x', write: () => null },
            ],
            // Fields flagged reemit are written by the shape: here "x" rewrites the first argument
            reemit: (field, item, changes) => (changes.variant === 'x' ? [{ start: field.find('GB').args[0].start, end: field.find('GB').args[0].end, value: '999' }] : null),
          },
          {
            applies: (item, field) => item.kind === 'zfake' && item.ref === 'BC' && (!field || field.has('BC')),
            fields: [
              { ...checkboxField('humanReadable', 'Texto legible', 'BC', 2, 'Y', 'N', () => true), optional: true },
            ],
          },
        ],
        build(text, point, options) {
          const { x, y } = dropDots(text, point, options);
          return insertCommand(text, `^FO${x},${y}^A0${orientationOf(itemRotation(options))},30,30^FDText^FS`);
        },
        emit(item, ctx) {
          if (item.ref === 'GB') return `${fo(ctx, item.x, item.y)}^GB${toDots(ctx, item.width)},1,1^FS`;
          return `${fo(ctx, item.x, item.y)}^A0${orientationOf(item.rotation || 0)},${toDots(ctx, item.height)},${toDots(ctx, item.height)}${fieldData(ctx, item.data)}^FS`;
        },
      };
    },
  },
});
load(['js/languages/zpl.js']);

const zpl = PB.languages.get('zpl');
const parse = src => zpl.parse(src, { dpi: 254 });
const run = src => PB.zpl.run(src, { dpi: 254 });
const move = (text, item, dx, dy) => zpl.moveItem(text, item, dx, dy, { dpi: 254 });
const fieldOf = (model, i = 0) => model.items[i];
const warnings = model => model.diagnostics.filter(d => d.level === 'warning');

// ---------------------------------------------------------------------------------------------------------------
// Field grouping and the deferred dispatch

test('a field is dispatched at its ^FS: the item spans ^FO .. ^FS and carries the origin, the font command and the data', () => {
  const src = '^XA^FO10,20^A0N,30,30^FDHello^FS^XZ';
  const model = parse(src);
  assert.equal(model.items.length, 1);
  const item = fieldOf(model);
  assert.deepEqual([item.kind, item.ref, item.x, item.y, item.originKind, item.rotation, item.height, item.data], ['zfake', 'A', 10, 20, 'FO', 0, 30, 'Hello']);
  const [span] = item.source.spans;
  assert.equal(src.slice(span.start, span.end), '^FO10,20^A0N,30,30^FDHello^FS');
  assert.equal(item.source.label, '^FO10,20^A0N,30,30^FDHello^FS');
  assert.deepEqual(model.diagnostics, []);
});

test('a field written over several lines has one span and a one-line label', () => {
  const src = '^XA\r\n^FO10,20\r\n^A0N,30,30\r\n^FDHello\r\n^FS\r\n^XZ';
  const item = fieldOf(parse(src));
  const [span] = item.source.spans;
  assert.equal(src.slice(span.start, span.end), '^FO10,20\r\n^A0N,30,30\r\n^FDHello\r\n^FS');
  assert.equal(item.source.label, '^FO10,20 ^A0N,30,30 ^FDHello ^FS');
  assert.equal(item.data, 'Hello');
});

test('the data may come before the font command: the handler still sees both at ^FS', () => {
  const item = fieldOf(parse('^XA^FO10,20^FDHello^A0R,30,30^FS^XZ'));
  assert.deepEqual([item.data, item.rotation, item.height], ['Hello', 90, 30]);
});

test('^FT is the baseline origin: the item says which one was used; hex escapes in the data are decoded; ^FR marks the field', () => {
  const item = fieldOf(parse('^XA^FT10,20^A0N,30,30^FR^FH^FDa_5Eb^FS^XZ'));
  assert.deepEqual([item.originKind, item.x, item.y, item.data, item.reverse], ['FT', 10, 20, 'a^b', true]);
  assert.equal(fieldOf(parse('^XA^FO1,1^A0N,30,30^FDx^FS^XZ')).reverse, false);
});

test('a field with only data (no font command) is dispatched to the ^FD handler: text in the default font', () => {
  const { model } = run('^XA^CF0,50^FO10,20^FDplain^FS^XZ');
  assert.equal(model.items.length, 1);
  assert.deepEqual([model.items[0].ref, model.items[0].fieldMain, model.items[0].height, model.items[0].data], ['FD', '^FD', 50, 'plain']);
});

test('the main command is the last command of the field that has a handler (a bar code after a font command wins)', () => {
  const model = parse('^XA^FO10,20^A0N,30,30^BCN,100^FDcode^FS^XZ');
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].ref, 'BC');
});

test('the default orientation ^FW applies when the command does not give one', () => {
  assert.equal(fieldOf(parse('^XA^FWR^FO1,1^A0,30,30^FDx^FS^XZ')).rotation, 90);
  assert.equal(fieldOf(parse('^XA^FWR^FO1,1^A0B,30,30^FDx^FS^XZ')).rotation, 270);
  // ^FW after the field does not change it, a later field uses it
  const model = parse('^XA^FO1,1^A0,30,30^FDx^FS^FWI^FO1,1^A0,30,30^FDy^FS^XZ');
  assert.deepEqual(model.items.map(i => i.rotation), [0, 180]);
});

test('^LH, ^LS and ^LT move every later field; the setup commands inside a field apply to it (the ^CF example of the guide)', () => {
  const model = parse('^XA^LH100,50^LS20^LT-5^FO10,10^A0N,30,30^FDa^FS^LH0,0^FO10,10^A0N,30,30^FDb^FS^XZ');
  assert.deepEqual(model.items.map(i => [i.x, i.y]), [[90, 55], [-10, 5]]);
  const inside = parse('^XA^FO10,20^CF0,70,93^FR^FDREVERSE^FS^XZ');
  assert.equal(inside.items[0].height, 70);
});

test('immediate handlers (setup commands) run when they are read, even inside an open field, and do not split it', () => {
  const { model, ctx } = run('^XA^FO10,20^LR^A0N,30,30^FDx^FS^XZ');
  assert.equal(ctx.fakeLR, 1);
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].data, 'x');
});

test('a field not closed by ^FS ends at the next field start (one warning per label) or at ^XZ (silently); its span ends at its last command', () => {
  const src = '^XA^FO10,20^A0N,30,30^FDa^FO10,60^A0N,30,30^FDb^FO10,90^A0N,30,30^FDc^XZ';
  const model = parse(src);
  assert.deepEqual(model.items.map(i => i.data), ['a', 'b', 'c']);
  assert.equal(warnings(model).length, 1);
  assert.match(warnings(model)[0].text, /\^FS/);
  const [last] = model.items[2].source.spans;
  assert.equal(src.slice(last.start, last.end), '^FO10,90^A0N,30,30^FDc');
  // closed at ^XZ only: nothing to warn about
  assert.deepEqual(parse('^XA^FO10,20^A0N,30,30^FDa^XZ').diagnostics, []);
});

test('a field-less command outside ^FO / ^FT is its own field at 0,0 (one info per label); ^FO alone and a stray ^FS draw nothing', () => {
  const model = parse('^XA^GB100,50,3^FS^FO5,5^FS^FS^GB10,10,1^FS^XZ');
  assert.deepEqual(model.items.map(i => [i.ref, i.x, i.y]), [['GB', 0, 0], ['GB', 0, 0]]);
  assert.equal(model.diagnostics.filter(d => d.level === 'info').length, 1);
  assert.equal(warnings(model).length, 0);
});

test('an unknown command in a field warns once and does not stop the field; a field with only unknown commands is not drawn', () => {
  const mixed = parse('^XA^FO10,20^A0N,30,30^ZQ9^FDx^FS^XZ');
  assert.equal(mixed.items.length, 1);
  assert.equal(warnings(mixed).length, 1);
  assert.match(warnings(mixed)[0].text, /\^ZQ9/);
  const only = parse('^XA^FO10,20^ZQ9^FDwould be text^FS^XZ');
  assert.equal(only.items.length, 0);
  assert.equal(warnings(only).length, 1);
});

test('several formats: only the fields of the first one are drawn', () => {
  const model = parse('^XA^FO1,1^A0N,30,30^FDone^FS^XZ^XA^FO1,1^A0N,30,30^FDtwo^FS^XZ');
  assert.deepEqual(model.items.map(i => i.data), ['one']);
  assert.equal(model.diagnostics.filter(d => d.level === 'info').length, 1);
});

test('fields before ^XA and a text without ^XA are one implicit format', () => {
  assert.equal(parse('^FO1,1^A0N,30,30^FDx^FS').items.length, 1);
  assert.equal(parse('^FO1,1^A0N,30,30^FDx^FS^XA^FO2,2^A0N,30,30^FDy^FS^XZ').items.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// Move

const LABEL = '^XA\r\n^PW400^LL300\r\n^FO10,20^A0N,30,30^FDHello^FS\r\n^FT100,200^A0N,30,30^FDWorld^FS\r\n^XZ\r\n';

test('moveItem rewrites only the ^FO x,y of that field; everything else stays byte for byte', () => {
  const model = parse(LABEL);
  const out = move(LABEL, model.items[0], 5, -7);
  assert.equal(out, LABEL.replace('^FO10,20', '^FO15,13'));
  const out2 = move(LABEL, model.items[1], -40, 3);
  assert.equal(out2, LABEL.replace('^FT100,200', '^FT60,203'));
});

test('moveItem never writes a position below 0 and ignores a move that changes nothing', () => {
  const model = parse(LABEL);
  assert.equal(move(LABEL, model.items[0], -500, -500), LABEL.replace('^FO10,20', '^FO0,0'));
  assert.equal(move(LABEL, model.items[0], 0, 0), LABEL);
  assert.equal(move(LABEL, model.items[0], NaN, 1), LABEL);
});

test('moveItem subtracts ^LH, ^LS and ^LT, and rounds to whole dots at the resolution', () => {
  const src = '^XA^LH100,50^LS20^LT-5^FO10,10^A0N,30,30^FDa^FS^XZ';
  const item = parse(src).items[0];
  assert.deepEqual([item.x, item.y], [90, 55]);
  assert.equal(move(src, item, 10, 10), src.replace('^FO10,10', '^FO20,20'));
  // the item sits at 0.1 mm = 1/254 inch dots here; at 203 dpi a 0.1 mm step is below one dot
  const dpi203 = zpl.parse('^XA^FO10,10^A0N,30,30^FDa^FS^XZ', { dpi: 203 }).items[0];
  assert.equal(zpl.moveItem('^XA^FO10,10^A0N,30,30^FDa^FS^XZ', dpi203, 12.512, 0, { dpi: 203 }), '^XA^FO20,10^A0N,30,30^FDa^FS^XZ');
});

test('moveItem fills omitted or empty origin arguments and leaves non numeric ones alone', () => {
  const only = '^XA^FO10^A0N,30,30^FDa^FS^XZ';
  assert.equal(move(only, parse(only).items[0], 5, 8), '^XA^FO15,8^A0N,30,30^FDa^FS^XZ');
  const empty = '^XA^FO,20^A0N,30,30^FDa^FS^XZ';
  assert.equal(move(empty, parse(empty).items[0], 5, 0), '^XA^FO5,20^A0N,30,30^FDa^FS^XZ');
  const none = '^XA^FO^A0N,30,30^FDa^FS^XZ';
  assert.equal(move(none, parse(none).items[0], 0, 8), '^XA^FO0,8^A0N,30,30^FDa^FS^XZ');
  assert.equal(move(none, parse(none).items[0], 0, 0), none);
});

test('moveItem keeps the other fields, comments and the line endings; items without source or from another text are not moved', () => {
  const text = '^XA\n^FXtitle^FS\n^FO10,20^A0N,30,30^FDa^FS\n^FO10,60^A0N,30,30^FDb^FS\n^XZ\n';
  const model = parse(text);
  assert.equal(move(text, model.items[1], 0, 10), text.replace('^FO10,60', '^FO10,70'));
  const { source, ...bare } = model.items[0];
  assert.equal(move(text, bare, 10, 10), text);
  assert.equal(move('^XA^XZ', model.items[0], 10, 10), '^XA^XZ');
  assert.equal(move(text, { ...model.items[0], kind: 'unknown' }, 5, 5), text.replace('^FO10,20', '^FO10,20'));
});

// ---------------------------------------------------------------------------------------------------------------
// describeItem

const FIELD_TEXT = '^XA^FO10,20^A0N,30,30^FDHello^FS^XZ';
const byKey = (descriptor, key) => descriptor.fields.find(f => f.key === key);

test('describeItem reads the values from the field in the text and lists the fields with their ranges and options', () => {
  const item = parse(FIELD_TEXT).items[0];
  const d = zpl.describeItem(item, FIELD_TEXT, { dpi: 254 });
  assert.equal(d.kind, 'zfake');
  assert.deepEqual(d.fields.map(f => f.key), ['content', 'height', 'rotation']);
  assert.deepEqual([byKey(d, 'content').type, byKey(d, 'content').value, byKey(d, 'content').maxLength], ['text', 'Hello', 3072]);
  assert.deepEqual(byKey(d, 'height'), { key: 'height', label: 'Alto (puntos)', type: 'number', value: 30, min: 1, max: 32000, step: 1 });
  assert.deepEqual([byKey(d, 'rotation').type, byKey(d, 'rotation').value], ['select', 0]);
  assert.deepEqual(byKey(d, 'rotation').options, rotationOptions);
});

test('describeItem without text (or with text that does not match) falls back to the model values', () => {
  const item = parse(FIELD_TEXT).items[0];
  const d = zpl.describeItem(item);
  assert.deepEqual(d.fields.map(f => [f.key, f.value]), [['content', 'Hello'], ['height', 30], ['rotation', 0]]);
  // text the item was not parsed from: the panel falls back to the model values (updateItem would change nothing)
  assert.deepEqual(zpl.describeItem(item, '^XA^XZ').fields, d.fields);
  assert.deepEqual(zpl.describeItem(null).fields, []);
  assert.deepEqual(zpl.describeItem({ kind: 'nothing' }, FIELD_TEXT), { kind: 'nothing', fields: [] });
});

test('describeItem decodes hex escapes in the content and leaves out a field whose command is missing', () => {
  const text = '^XA^FO10,20^A0N,30,30^FH^FDa_5Eb^FS^XZ';
  assert.equal(byKey(zpl.describeItem(parse(text).items[0], text), 'content').value, 'a^b');
  // no ^A command: the height and the rotation have nothing to read
  const noFont = '^XA^FO10,20^FDplain^FS^XZ';
  const d = zpl.describeItem(parse(noFont).items[0], noFont);
  assert.deepEqual(d.fields.map(f => f.key), ['content']);
});

test('describeItem lists an omitted optional argument with its default, a stringSelect option outside the list is kept as an extra option', () => {
  const text = '^XA^FO1,1^GB100,50,3^FS^XZ';
  const d = zpl.describeItem(parse(text).items[0], text);
  assert.deepEqual(d.fields.map(f => [f.key, f.value]), [['width', 100], ['color', 'B'], ['variant', 'x']]);
  const odd = '^XA^FO1,1^GB100,50,3,Q^FS^XZ';
  // Q is not B or W: it is listed as an extra option, and never written
  const q = byKey(zpl.describeItem(parse(odd).items[0], odd), 'color');
  assert.deepEqual([q.value, q.options.map(o => o.value)], ['Q', ['B', 'W', 'Q']]);
  assert.equal(update(odd, { color: 'Q' }), odd);
  const barcode = '^XA^FO1,1^BCN,100,N^FDx^FS^XZ';
  assert.equal(byKey(zpl.describeItem(parse(barcode).items[0], barcode), 'humanReadable').value, false);
  const omitted = '^XA^FO1,1^BCN,100^FDx^FS^XZ';
  assert.equal(byKey(zpl.describeItem(parse(omitted).items[0], omitted), 'humanReadable').value, true);
});

// ---------------------------------------------------------------------------------------------------------------
// updateItem

const update = (text, changes, i = 0) => zpl.updateItem(text, parse(text).items[i], changes, { dpi: 254 });

test('updateItem rewrites only the argument of the changed field, clamped to its range', () => {
  assert.equal(update(FIELD_TEXT, { height: 45 }), FIELD_TEXT.replace('^A0N,30,30', '^A0N,45,30'));
  assert.equal(update(FIELD_TEXT, { height: 99999 }), FIELD_TEXT.replace('^A0N,30,30', '^A0N,32000,30'));
  assert.equal(update(FIELD_TEXT, { height: -5 }), FIELD_TEXT.replace('^A0N,30,30', '^A0N,1,30'));
  assert.equal(update(FIELD_TEXT, { height: 30 }), FIELD_TEXT);
});

test('updateItem ignores unknown keys, invalid values, items without a source and a text the item was not parsed from', () => {
  assert.equal(update(FIELD_TEXT, { nothing: 1 }), FIELD_TEXT);
  assert.equal(update(FIELD_TEXT, { height: 'tall' }), FIELD_TEXT);
  assert.equal(update(FIELD_TEXT, { height: NaN }), FIELD_TEXT);
  assert.equal(update(FIELD_TEXT, { rotation: 45 }), FIELD_TEXT);
  assert.equal(update(FIELD_TEXT, null), FIELD_TEXT);
  const item = parse(FIELD_TEXT).items[0];
  const { source, ...bare } = item;
  assert.equal(zpl.updateItem(FIELD_TEXT, bare, { height: 40 }), FIELD_TEXT);
  assert.equal(zpl.updateItem('^XA^XZ', item, { height: 40 }), '^XA^XZ');
});

test('updateItem can rewrite a part of an argument: the orientation glued to the font letter', () => {
  assert.equal(update(FIELD_TEXT, { rotation: 90 }), FIELD_TEXT.replace('^A0N,', '^A0R,'));
  assert.equal(update('^XA^FO1,1^A0B,30,30^FDx^FS^XZ', { rotation: 180 }), '^XA^FO1,1^A0I,30,30^FDx^FS^XZ');
});

test('updateItem content: plain data is written as is, a line break becomes a space, an over-long or non-string value is ignored', () => {
  assert.equal(update(FIELD_TEXT, { content: 'Bye, now' }), FIELD_TEXT.replace('Hello', 'Bye, now'));
  assert.equal(update(FIELD_TEXT, { content: 'a\r\nb' }), FIELD_TEXT.replace('Hello', 'a b'));
  assert.equal(update(FIELD_TEXT, { content: '' }), FIELD_TEXT.replace('Hello', ''));
  assert.equal(update(FIELD_TEXT, { content: 'x'.repeat(3073) }), FIELD_TEXT);
  assert.equal(update(FIELD_TEXT, { content: 42 }), FIELD_TEXT);
  assert.equal(update('^XA^FO1,1^A0N,30,30^FVold^FS^XZ', { content: 'new' }), '^XA^FO1,1^A0N,30,30^FVnew^FS^XZ');
});

test('updateItem content with ^ or ~ adds ^FH before the ^FD and escapes them (and _); an existing ^FH is reused with its indicator', () => {
  assert.equal(update(FIELD_TEXT, { content: 'a^b~c_d' }), FIELD_TEXT.replace('^FDHello', '^FH^FDa_5Eb_7Ec_5Fd'));
  const withFh = '^XA^FO10,20^A0N,30,30^FH^FDa_5Eb^FS^XZ';
  assert.equal(update(withFh, { content: 'x^y_z' }), withFh.replace('a_5Eb', 'x_5Ey_5Fz'));
  const custom = '^XA^FO10,20^A0N,30,30^FH\\^FDa\\5Eb^FS^XZ';
  assert.equal(update(custom, { content: 'x^y_z\\w' }), custom.replace('a\\5Eb', 'x\\5Ey_z\\5Cw'));
  // a plain value in a field that already has ^FH still escapes the indicator
  assert.equal(update(withFh, { content: 'a_b' }), withFh.replace('a_5Eb', 'a_5Fb'));
});

test('updateItem keeps the neighbouring fields, the comments and the line ending byte for byte', () => {
  const text = '^XA\r\n^FXtop^FS\r\n^FO10,20^A0N,30,30^FDa^FS\r\n^FO10,60^A0N,30,30^FDb^FS\r\n^XZ\r\n';
  assert.equal(update(text, { content: 'B', height: 50 }, 1), text.replace('^A0N,30,30^FDb', '^A0N,50,30^FDB'));
});

test('updateItem appends an omitted optional trailing argument, fills an empty one and writes nothing for the default', () => {
  const text = '^XA^FO1,1^GB100,50,3^FS^XZ';
  assert.equal(update(text, { color: 'W' }), '^XA^FO1,1^GB100,50,3,W^FS^XZ');
  assert.equal(update(text, { color: 'B' }), text);
  assert.equal(update(text, { color: 'Z' }), text);
  assert.equal(update('^XA^FO1,1^GB100,50,3,,2^FS^XZ', { color: 'W' }), '^XA^FO1,1^GB100,50,3,W,2^FS^XZ');
  assert.equal(update('^XA^FO1,1^GB100,50,3,W^FS^XZ', { color: 'B' }), '^XA^FO1,1^GB100,50,3,B^FS^XZ');
});

test('checkbox fields write Y / N, also on an omitted optional argument', () => {
  assert.equal(update('^XA^FO1,1^BCN,100,Y^FDx^FS^XZ', { humanReadable: false }), '^XA^FO1,1^BCN,100,N^FDx^FS^XZ');
  assert.equal(update('^XA^FO1,1^BCN,100,N^FDx^FS^XZ', { humanReadable: true }), '^XA^FO1,1^BCN,100,Y^FDx^FS^XZ');
  assert.equal(update('^XA^FO1,1^BCN,100^FDx^FS^XZ', { humanReadable: false }), '^XA^FO1,1^BCN,100,N^FDx^FS^XZ');
  assert.equal(update('^XA^FO1,1^BCN,100^FDx^FS^XZ', { humanReadable: true }), '^XA^FO1,1^BCN,100^FDx^FS^XZ');
});

test('fields flagged reemit are written by the shape hook and win over the edits of other fields on the same argument', () => {
  const text = '^XA^FO1,1^GB100,50,3^FS^XZ';
  assert.equal(update(text, { variant: 'x' }), '^XA^FO1,1^GB999,50,3^FS^XZ');
  assert.equal(update(text, { variant: 'x', width: 200 }), '^XA^FO1,1^GB999,50,3^FS^XZ');
  assert.equal(update(text, { variant: 'y' }), text);
});

// ---------------------------------------------------------------------------------------------------------------
// Palette: componentTemplates / buildComponent

test('componentTemplates lists the slices with a build hook, in slice order', () => {
  // the fake slice has order 5 so that its handlers come before the real text slice (order 10), whose ^A / ^FD handlers it shadows here
  assert.deepEqual(zpl.componentTemplates(), [{ kind: 'zfake', label: 'Fake' }, { kind: 'text', label: 'Texto' }, { kind: 'barcode', label: 'Código de barras' }]);
});

test('buildComponent inserts a whole field before ^XZ at the drop point, rotated against the view rotation', () => {
  const text = '^XA\r\n^PW400\r\n^XZ\r\n';
  const built = zpl.buildComponent(text, 'zfake', { x: 100, y: 50 }, { dpi: 254 });
  assert.equal(built, '^XA\r\n^PW400\r\n^FO100,50^A0N,30,30^FDText^FS\r\n^XZ\r\n');
  // view rotated 90: the item is written rotated 270 (bottom-up), so it looks upright
  assert.match(zpl.buildComponent(text, 'zfake', { x: 100, y: 50 }, { dpi: 254, viewRotation: 90 }), /\^A0B,30,30/);
  assert.match(zpl.buildComponent(text, 'zfake', { x: 100, y: 50 }, { dpi: 254, viewRotation: 180 }), /\^A0I,30,30/);
  assert.match(zpl.buildComponent(text, 'zfake', { x: 100, y: 50 }, { dpi: 254, viewRotation: 270 }), /\^A0R,30,30/);
  // the inserted field parses back as an item at the drop point
  assert.deepEqual([parse(built).items[0].x, parse(built).items[0].y], [100, 50]);
});

test('buildComponent subtracts ^LH / ^LS / ^LT, rounds to dots at the resolution and never goes below 0', () => {
  const text = '^XA^LH20,10^LS5^LT2^XZ';
  const built = zpl.buildComponent(text, 'zfake', { x: 100, y: 50 }, { dpi: 254 });
  assert.match(built, /\^FO85,38\^A0N/);
  assert.match(zpl.buildComponent(text, 'zfake', { x: 0, y: 0 }, { dpi: 254 }), /\^FO0,0\^A0N/);
  assert.match(zpl.buildComponent('^XA^XZ', 'zfake', { x: 12.512, y: 25.024 }, { dpi: 203 }), /\^FO10,20\^A0N/);
  assert.equal(parse(built).items[0].x, 100);
});

test('buildComponent leaves the text alone for an unknown kind or an invalid point, and starts a format in an empty text', () => {
  const text = '^XA^XZ';
  assert.equal(zpl.buildComponent(text, 'nothing', { x: 1, y: 1 }, { dpi: 254 }), text);
  assert.equal(zpl.buildComponent(text, 'zfake', { x: NaN, y: 1 }, { dpi: 254 }), text);
  assert.equal(zpl.buildComponent(text, 'zfake', null, { dpi: 254 }), text);
  assert.equal(zpl.buildComponent('', 'zfake', { x: 10, y: 10 }, { dpi: 254 }), '^XA\n^FO10,10^A0N,30,30^FDText^FS\n^XZ\n');
});

// ---------------------------------------------------------------------------------------------------------------
// Emit through the slices, and the helpers

test('emit writes the items with the slices emit hooks between the header and ^XZ; parse -> emit -> parse keeps the items', () => {
  const src = '^XA^PW400^LL300^FO10,20^A0R,30,30^FH^FDa_5Eb_7E^FS^FO5,5^GB100,1,1^FS^XZ';
  const model = parse(src);
  const out = PB.languages.emit('zpl', model, { dpi: 254 });
  assert.equal(out.text, '^XA\r\n^PW400\r\n^LL300\r\n^FO10,20^A0R,30,30^FH^FDa_5Eb_7E^FS\r\n^FO5,5^GB100,1,1^FS\r\n^XZ\r\n');
  assert.deepEqual(out.diagnostics, []);
  const again = zpl.parse(out.text, { dpi: 254 });
  const plain = items => items.map(({ source, ...rest }) => rest);
  assert.deepEqual(plain(again.items), plain(model.items));
});

test('the rotation helpers map N / R / I / B to 0 / 90 / 180 / 270 clockwise and back; a new item is rotated against the view', () => {
  const { rotationOf, orientationOf, itemRotation } = PB.zpl.SLICE_HELPERS;
  assert.deepEqual(['N', 'R', 'I', 'B'].map(rotationOf), [0, 90, 180, 270]);
  assert.deepEqual([0, 90, 180, 270].map(orientationOf), ['N', 'R', 'I', 'B']);
  assert.equal(rotationOf('r'), 90);
  assert.equal(rotationOf('Q'), null);
  assert.equal(orientationOf(45), null);
  assert.deepEqual([undefined, { viewRotation: 0 }, { viewRotation: 90 }, { viewRotation: 180 }, { viewRotation: 270 }, { viewRotation: 33 }].map(itemRotation), [0, 0, 270, 180, 90, 0]);
});

test('the generic engines are built from definitions: createZplEditing works with injected ones too', () => {
  const editing = PB.zplEdit.createZplEditing({
    coordinates: [{ applies: item => item.kind === 'dot' }],
    editable: [],
    commands: PB.zpl.commands,
  });
  const text = '^XA^FO10,20^GB1,1,1^FS^XZ';
  const item = { kind: 'dot', source: { spans: [{ start: 3, end: 22 }] } };
  assert.equal(editing.moveItem(text, item, 5, 5, { dpi: 254 }), '^XA^FO15,25^GB1,1,1^FS^XZ');
  assert.equal(editing.moveItem(text, { kind: 'other', source: item.source }, 5, 5, { dpi: 254 }), text);
});
