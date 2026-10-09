/**
 * Properties panel: a form for the selected item, built from the fields its language describes (see describeItem in
 * core.js), or the overlay image controls, or an empty-state message. It writes nothing: it notifies and whoever uses
 * it rewrites the label.
 */
(function (PB) {
  'use strict';

  /**
   * Value a form control holds, as the language expects it, or undefined if the input is not valid (the caller then
   * keeps the field as it was). raw: text of a number / select / radio / text control, checked state of a checkbox. A text field keeps its string as is.
   */
  function coerceFieldValue(field, raw) {
    if (field.type === 'checkbox') return Boolean(raw);
    if (field.type === 'select' || field.type === 'radio') {
      const option = (field.options || []).find(o => String(o.value) === String(raw));
      return option ? option.value : undefined;
    }
    if (field.type === 'text') return typeof raw === 'string' ? raw : undefined;
    const text = String(raw).trim().replace(',', '.');
    const number = text === '' ? NaN : Number(text);
    return Number.isFinite(number) ? number : undefined;
  }

  /**
   * Test values of the variables an item uses: [{ name, value, usedIn }] in order of appearance. value is the current test
   * value ('' if none); usedIn is how many objects of the model use the variable. They are app-level (state.values), not
   * part of the label code, so they are not fields of the language.
   */
  function variableFieldsFor(item, model, values) {
    if (!item) return [];
    const { namesIn } = PB.variables;
    const perItem = model.items.map(it => namesIn(it.data));
    return namesIn(item.data).map(name => ({
      name,
      value: values[name] ?? '',
      usedIn: perItem.filter(names => names.includes(name)).length,
    }));
  }

  /**
   * els: { empty, title, form, overlay } (the overlay element holds the image controls, which belong to the page).
   *  - onChange(key, value): a field was edited (applied on `change`, not on every keystroke). The caller re-shows the panel.
   *  - onValueChange(name, value): the test value of a variable was edited (on `change`); it is never a field of the language.
   */
  function createPropertiesPanel(els, { onChange, onValueChange }) {
    function control(field) {
      if (field.type === 'select') {
        const select = document.createElement('select');
        for (const o of field.options || []) {
          select.append(Object.assign(document.createElement('option'), { value: o.value, textContent: o.label, selected: o.value === field.value }));
        }
        // A choice with a single option (the Tipo of a TPCL text: only a line) has nothing to choose: shown, but disabled
        if ((field.options || []).length === 1) select.disabled = true;
        return select;
      }
      const input = document.createElement('input');
      if (field.type === 'text') {
        input.type = 'text';
        input.value = field.value;
        if (field.maxLength !== undefined) input.maxLength = field.maxLength;
        return input;
      }
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

    /** A radio field (a few exclusive choices shown together): a group of radio inputs, one per option; it notifies the option chosen. */
    function radioRow(field) {
      const group = document.createElement('div');
      group.className = 'props-field props-radio';
      group.setAttribute('role', 'radiogroup');
      const choices = document.createElement('span');
      choices.className = 'props-choices';
      for (const o of field.options || []) {
        const choice = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `prop-${field.key}`;
        input.value = o.value;
        input.checked = o.value === field.value;
        input.dataset.key = field.key;
        input.addEventListener('change', () => {
          const value = coerceFieldValue(field, input.value);
          if (input.checked && value !== undefined) onChange(field.key, value);
        });
        choice.append(input, Object.assign(document.createElement('span'), { textContent: o.label }));
        choices.append(choice);
      }
      group.append(Object.assign(document.createElement('span'), { textContent: field.label }), choices);
      if (field.note) group.append(Object.assign(document.createElement('small'), { className: 'props-note', textContent: field.note }));
      return group;
    }

    function row(field) {
      if (field.type === 'radio') return radioRow(field);
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
      // An explanation of the field (field.note), under the control and as its tooltip
      if (field.note) {
        input.title = field.note;
        label.append(Object.assign(document.createElement('small'), { className: 'props-note', textContent: field.note }));
      }
      return label;
    }

    /** Section with one text input per variable of the object, after the language fields. */
    function valuesSection(variableFields) {
      const section = document.createElement('div');
      section.className = 'props-values';
      section.append(Object.assign(document.createElement('span'), { className: 'props-values-title', textContent: 'Valores de prueba (solo vista previa)' }));
      for (const { name, value, usedIn } of variableFields) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.dataset.key = `var:${name}`;
        // The raw string goes as typed: no number parsing, and it never reaches the language
        input.addEventListener('change', () => onValueChange(name, input.value));
        label.append(Object.assign(document.createElement('span'), { textContent: `Valor de ${name}` }), input);
        if (usedIn > 1) label.append(Object.assign(document.createElement('small'), { className: 'props-note', textContent: `usada en ${usedIn} objetos` }));
        section.append(label);
      }
      return section;
    }

    function setMode(mode) {
      els.empty.hidden = mode !== 'empty';
      els.form.hidden = mode !== 'form';
      els.overlay.hidden = mode !== 'overlay';
    }

    return Object.freeze({
      /**
       * Shows the form of a descriptor { kind, fields }; null (or one without fields and variables) shows the empty message.
       * variableFields (see variableFieldsFor) adds the test values section after the fields.
       */
      show(descriptor, variableFields = []) {
        const focused = els.form.contains(document.activeElement) ? document.activeElement.dataset.key : null;
        if (!descriptor || (!descriptor.fields.length && !variableFields.length)) {
          els.form.replaceChildren();
          els.title.textContent = '';
          els.empty.textContent = descriptor ? 'Este objeto no tiene propiedades editables' : 'Selecciona un objeto';
          setMode('empty');
          return;
        }
        els.title.textContent = descriptor.kind || '';
        els.form.replaceChildren(...descriptor.fields.map(row), ...(variableFields.length ? [valuesSection(variableFields)] : []));
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
  PB.ui.variableFieldsFor = variableFieldsFor;
  PB.ui.createPropertiesPanel = createPropertiesPanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
