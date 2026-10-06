/**
 * Properties panel: a form for the selected item, built from the fields its language describes (see describeItem in
 * core.js), or the overlay image controls, or an empty-state message. It writes nothing: it notifies and whoever uses
 * it rewrites the label.
 */
(function (PB) {
  'use strict';

  /**
   * Value a form control holds, as the language expects it, or undefined if the input is not valid (the caller then
   * keeps the field as it was). raw: text of a number / select control, checked state of a checkbox.
   */
  function coerceFieldValue(field, raw) {
    if (field.type === 'checkbox') return Boolean(raw);
    if (field.type === 'select') {
      const option = (field.options || []).find(o => String(o.value) === String(raw));
      return option ? option.value : undefined;
    }
    const text = String(raw).trim().replace(',', '.');
    const number = text === '' ? NaN : Number(text);
    return Number.isFinite(number) ? number : undefined;
  }

  /**
   * els: { empty, title, form, overlay } (the overlay element holds the image controls, which belong to the page).
   *  - onChange(key, value): a field was edited (applied on `change`, not on every keystroke). The caller re-shows the panel.
   */
  function createPropertiesPanel(els, { onChange }) {
    function control(field) {
      if (field.type === 'select') {
        const select = document.createElement('select');
        for (const o of field.options || []) {
          select.append(Object.assign(document.createElement('option'), { value: o.value, textContent: o.label, selected: o.value === field.value }));
        }
        return select;
      }
      const input = document.createElement('input');
      if (field.type === 'checkbox') {
        input.type = 'checkbox';
        input.checked = Boolean(field.value);
        return input;
      }
      input.type = 'number';
      input.value = field.value;
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      input.step = field.step !== undefined ? field.step : 1;
      return input;
    }

    function row(field) {
      const label = document.createElement('label');
      const input = control(field);
      input.dataset.key = field.key;
      input.addEventListener('change', () => {
        const value = coerceFieldValue(field, field.type === 'checkbox' ? input.checked : input.value);
        // An invalid entry goes back to the value shown before
        if (value === undefined) input.value = field.value;
        else onChange(field.key, value);
      });
      label.append(Object.assign(document.createElement('span'), { textContent: field.label }), input);
      return label;
    }

    function setMode(mode) {
      els.empty.hidden = mode !== 'empty';
      els.form.hidden = mode !== 'form';
      els.overlay.hidden = mode !== 'overlay';
    }

    return Object.freeze({
      /** Shows the form of a descriptor { kind, fields }; null (or one without fields) shows the empty message. */
      show(descriptor) {
        const focused = els.form.contains(document.activeElement) ? document.activeElement.dataset.key : null;
        if (!descriptor || !descriptor.fields.length) {
          els.form.replaceChildren();
          els.title.textContent = '';
          els.empty.textContent = descriptor ? 'Este objeto no tiene propiedades editables' : 'Selecciona un objeto';
          setMode('empty');
          return;
        }
        els.title.textContent = descriptor.kind || '';
        els.form.replaceChildren(...descriptor.fields.map(row));
        setMode('form');
        // The edit re-renders the form: the field being edited keeps the keyboard focus
        if (focused) els.form.querySelector(`[data-key="${focused}"]`)?.focus();
      },
      /** Shows the overlay image controls instead of a form. */
      showOverlay() {
        els.form.replaceChildren();
        els.title.textContent = 'imagen';
        setMode('overlay');
      },
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.coerceFieldValue = coerceFieldValue;
  PB.ui.createPropertiesPanel = createPropertiesPanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
