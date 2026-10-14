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
   * The aviso for a number the user typed in a field when the label ends up holding another value (clamped to the
   * field's min / max, snapped to its step, rounded by the language), or null when the value was kept (or the field is
   * not a number, or the language reports nothing back). Applies to every field generically, so no edit is adjusted silently.
   */
  function adjustmentNotice(field, typed, used) {
    if (!field || field.type !== 'number' || typeof typed !== 'number' || typeof used !== 'number' || !Number.isFinite(used)) return null;
    if (Math.abs(typed - used) < 1e-9) return null;
    const outside = (field.min !== undefined && typed < field.min) || (field.max !== undefined && typed > field.max);
    const range = field.min !== undefined && field.max !== undefined ? `${field.min}..${field.max}` : field.min !== undefined ? `desde ${field.min}` : `hasta ${field.max}`;
    const text = outside ? `${field.label}: ${typed} está fuera del rango ${range}; se usa ${used}` : `${field.label}: ${typed} se ajusta a ${used}`;
    return PB.diagnostics.warning(text);
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
   * els: { empty, title, form, overlay, help, helpPanel } (the overlay element holds the image controls, which belong to the page; help is the
   * element that holds the command help and helpPanel, optional, the panel around it that is shown or hidden with it; showCommandHelp fills it
   * whatever the selection is).
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

    /**
     * The Contenido of a GS1-128 barcode (field.editor === 'gs1') as one row per element: AI select, value, remove. The rows are validated as
     * typed and only a complete, error-free set is notified (as the notation with parentheses); until then they stay in the panel (the draft)
     * and the label keeps its last good content. The text input of the notation stays as the advanced way to paste a whole string.
     */
    let gs1Draft = null;
    function gs1Row(field) {
      const { gs1 } = PB;
      const state = gs1Draft && gs1Draft.committed === field.value ? gs1Draft : { committed: field.value, rows: gs1.rowsOf(field.value) };
      const group = document.createElement('div');
      group.className = 'props-field props-gs1';
      const commit = () => {
        const notation = gs1.commitRows(state.rows);
        gs1Draft = { committed: notation ?? state.committed, rows: state.rows };
        if (notation !== null && notation !== field.value) onChange(field.key, notation);
        else render();
      };
      const note = (text, className = 'props-note') => Object.assign(document.createElement('small'), { className, textContent: text });
      function render() {
        const rows = document.createElement('div');
        rows.className = 'props-gs1-rows';
        state.rows.forEach((r, i) => {
          const line = document.createElement('div');
          line.className = 'props-gs1-row';
          const select = document.createElement('select');
          for (const o of gs1.aiOptions()) select.append(Object.assign(document.createElement('option'), { value: o.value, textContent: o.label, selected: o.value === r.ai }));
          select.addEventListener('change', () => { r.ai = select.value; commit(); });
          const input = Object.assign(document.createElement('input'), { type: 'text', value: r.value, placeholder: gs1.valueHint(r.ai), className: 'props-gs1-value' });
          input.addEventListener('change', () => { r.value = input.value; commit(); });
          const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: '✕', title: 'Quitar este elemento' });
          remove.addEventListener('click', () => { state.rows.splice(i, 1); commit(); });
          line.append(select, input, remove);
          rows.append(line);
          for (const d of gs1.checkRow(r)) rows.append(note(d.text, d.level === 'error' ? 'props-note props-gs1-error' : 'props-note'));
        });
        const add = Object.assign(document.createElement('button'), { type: 'button', textContent: '+ Añadir elemento' });
        add.addEventListener('click', () => {
          state.rows.push({ ai: state.rows.length ? '10' : '01', value: '' });
          gs1Draft = { committed: state.committed, rows: state.rows };
          render();
          group.querySelectorAll('.props-gs1-value')[state.rows.length - 1]?.focus();
        });
        const complete = gs1.commitRows(state.rows) !== null;
        const advanced = document.createElement('details');
        const text = Object.assign(document.createElement('input'), { type: 'text', value: field.value, maxLength: field.maxLength ?? 255 });
        text.dataset.key = field.key;
        text.addEventListener('change', () => { gs1Draft = null; onChange(field.key, text.value); });
        advanced.append(Object.assign(document.createElement('summary'), { textContent: 'Modo avanzado: escribir la cadena completa' }), text);
        group.replaceChildren(
          Object.assign(document.createElement('span'), { textContent: field.label }),
          rows,
          add,
          note(`Cadena: ${gs1.notationOf(state.rows) || '(sin elementos)'}`),
          note(complete ? 'FNC1 se añade solo después de los elementos de largo variable que no son el último; el dígito de control se valida, no se añade' : 'Se guarda cuando todos los elementos están completos y sin errores; mientras tanto la etiqueta conserva el contenido anterior'),
          advanced,
        );
      }
      render();
      return group;
    }

    function row(field) {
      if (field.editor === 'gs1') return gs1Row(field);
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

    /** Sub-section with the help of the command under the caret (see PB.zplHelp.at): its id and title, the description and its parameters. */
    function commandHelp(info) {
      const box = document.createElement('div');
      box.className = 'props-help-body';
      const head = document.createElement('div');
      head.className = 'props-help-head';
      head.append(Object.assign(document.createElement('strong'), { textContent: info.id }), info.title ? ` ${info.title}` : '');
      box.append(head);
      if (!info.known) {
        box.append(Object.assign(document.createElement('p'), { className: 'props-note', textContent: 'Este comando todavía no tiene ayuda en PrintBridge' }));
        return box;
      }
      box.append(Object.assign(document.createElement('p'), { className: 'props-help-text', textContent: info.description }));
      if (info.params.length) {
        const list = document.createElement('ol');
        list.className = 'props-help-params';
        for (const param of info.params) {
          const item = document.createElement('li');
          item.className = param.current ? 'current' : '';
          item.append(Object.assign(document.createElement('b'), { textContent: param.label }));
          if (param.value) item.append(' ', Object.assign(document.createElement('code'), { textContent: param.value }));
          item.append(Object.assign(document.createElement('small'), { className: 'props-note', textContent: param.description }));
          list.append(item);
        }
        box.append(list);
      }
      if (info.extra !== null) box.append(Object.assign(document.createElement('p'), { className: 'props-note', textContent: `Sobran parámetros: ${info.extra}` }));
      return box;
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
        if (!descriptor.fields.some(f => f.editor === 'gs1')) gs1Draft = null;
        els.form.replaceChildren(...descriptor.fields.map(row), ...(variableFields.length ? [valuesSection(variableFields)] : []));
        setMode('form');
        // The edit re-renders the form: the field being edited keeps the keyboard focus
        if (focused) els.form.querySelector(`[data-key="${focused}"]`)?.focus();
      },
      /** Shows the help of the command under the caret in the help panel (one info from PB.zplHelp.at, or the list from PB.zplHelp.range, one block each); null or an empty list hides it. */
      showCommandHelp(info) {
        if (!els.help) return;
        const list = info ? [].concat(info) : [];
        (els.helpPanel || els.help).hidden = list.length === 0;
        els.help.replaceChildren(...list.map(commandHelp));
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
  PB.ui.adjustmentNotice = adjustmentNotice;
  PB.ui.variableFieldsFor = variableFieldsFor;
  PB.ui.createPropertiesPanel = createPropertiesPanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
