const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUpTo, manifest } = require('./helpers/load');

const PB = loadUpTo('js/components/image/index.js');

/** Minimal fake element: value/textContent/disabled/files plus addEventListener and a manual dispatch. */
function fakeEl(props = {}) {
  const listeners = {};
  return Object.assign({
    value: '', textContent: '', disabled: false, files: [], clicked: 0,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { (listeners[type] || []).forEach(fn => fn()); },
    click() { this.clicked++; },
  }, props);
}

test('image UI files are in the manifest before the slice registers and before ui.js', () => {
  const files = manifest();
  const at = file => files.indexOf(file);
  assert.ok(at('js/components/image/panel.js') > at('js/components/image/tpcl.js'));
  assert.ok(at('js/components/image/overlay.js') > at('js/components/image/tpcl.js'));
  assert.ok(at('js/components/image/index.js') > at('js/components/image/panel.js'));
  assert.ok(at('js/components/image/index.js') > at('js/components/image/overlay.js'));
  assert.ok(at('js/components/image/panel.js') < at('js/ui.js'));
});

test('PB.ui.createImagePanel is exposed by the image slice and extends PB.ui', () => {
  assert.equal(typeof PB.ui.createImagePanel, 'function');
  assert.equal(PB.ui.createImagePanel, PB.slices.image.createImagePanel);
});

test('the image panel reads placement, shows the threshold and reports controls', () => {
  const els = {
    fileInput: fakeEl(), x: fakeEl({ value: '10' }), y: fakeEl({ value: '20' }), width: fakeEl({ value: '' }),
    threshold: fakeEl({ value: '50' }), thresholdValue: fakeEl(), insert: fakeEl(), remove: fakeEl(),
  };
  const calls = [];
  const panel = PB.ui.createImagePanel(els, {
    onFile: file => calls.push(['file', file]), onChange: () => calls.push('change'),
    onThreshold: () => calls.push('threshold'), onRemove: () => calls.push('remove'), onInsert: () => calls.push('insert'),
  });
  assert.equal(els.thresholdValue.textContent, '50 %');
  assert.deepEqual(panel.placement(), { xMm: '10', yMm: '20', widthMm: '' });
  panel.setPosition(1.5, 2);
  assert.deepEqual([els.x.value, els.y.value], [1.5, 2]);
  els.threshold.value = '70';
  els.threshold.fire('input');
  assert.equal(els.thresholdValue.textContent, '70 %');
  assert.equal(panel.thresholdPercent(), '70');
  els.x.fire('input');
  els.remove.fire('click');
  els.insert.fire('click');
  els.fileInput.files = ['pic'];
  els.fileInput.fire('change');
  assert.deepEqual(calls, ['threshold', 'change', 'remove', 'insert', ['file', 'pic']]);
  assert.equal(els.fileInput.value, '');
  panel.setActive(true);
  assert.deepEqual([els.x.disabled, els.threshold.disabled, els.remove.disabled, els.insert.disabled], [false, false, false, false]);
  panel.setActive(false);
  assert.deepEqual([els.x.disabled, els.threshold.disabled, els.remove.disabled, els.insert.disabled], [true, true, true, true]);
});

test('the registry exposes the image palette entry and the overlay picker factory', () => {
  const image = PB.components.get('image');
  assert.equal(image.kind, 'image');
  assert.equal(typeof image.overlay.createPicker, 'function');
});

test('the picker stores the position in mm (clamped), opens the file input and hands the position over once', () => {
  const fileInput = fakeEl();
  const refreshed = [];
  const picker = PB.components.get('image').overlay.createPicker({ fileInput, refresh: arg => refreshed.push(arg) });
  picker.pick(123, 99999);
  assert.equal(fileInput.clicked, 1);
  assert.deepEqual(picker.takePosition(), [12.3, 999.9]);
  assert.equal(picker.takePosition(), null);
  picker.pick(50, 50);
  fileInput.fire('cancel');
  assert.equal(picker.takePosition(), null);
  assert.deepEqual(refreshed, []);
});

test('the picker warns instead of opening the file input when a drop has no user activation or click throws', () => {
  const hint = 'El navegador no permite abrir el selector de archivos al soltar: haz clic en "Imagen" de la paleta';
  const fileInput = fakeEl();
  const refreshed = [];
  const picker = PB.components.get('image').overlay.createPicker({ fileInput, refresh: arg => refreshed.push(arg) });
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userActivation: { isActive: false } }, configurable: true });
  try {
    picker.pick(10, 10, { dropped: true });
    assert.equal(fileInput.clicked, 0);
    assert.equal(picker.takePosition(), null);
    assert.equal(refreshed[0].notices[0].text, hint);
    fileInput.click = () => { throw new Error('blocked'); };
    picker.pick(10, 10);
    assert.equal(picker.takePosition(), null);
    assert.equal(refreshed.length, 2);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator;
  }
});
