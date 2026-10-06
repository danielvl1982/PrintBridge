/**
 * Screen panels: messages, variables, label size, code editor and preview.
 * Each panel only handles its part of the screen and notifies the rest through callbacks.
 */

/**
 * "Avisos" panel: list of diagnostics sorted by severity. Each message carries its level as a CSS class.
 */
(function (PB) {
  'use strict';

  function createMessagesPanel(listEl) {
    return Object.freeze({
      show(diagnostics) {
        listEl.replaceChildren(...(diagnostics.length ? PB.diagnostics.sort(diagnostics) : [PB.diagnostics.info('Sin avisos')])
          .map(d => Object.assign(document.createElement('li'), { className: d.level, textContent: d.text })));
      },
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.createMessagesPanel = createMessagesPanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * "Variables" panel: one input per #VARIABLE# of the label.
 * The values are kept in the "values" object it receives (shared with the rest of the viewer).
 */
(function (PB) {
  'use strict';

  function createVariablesPanel(container, { values, onChange }) {
    let shown = '';

    /** Paints one input per variable (only if the variables changed or invalidate was called). */
    function setNames(names) {
      const key = names.join('|');
      if (key === shown) return;
      shown = key;
      if (!names.length) {
        container.innerHTML = '<span class="empty">No hay variables en la etiqueta</span>';
        return;
      }
      container.replaceChildren(...names.flatMap(name => {
        if (values[name] == null) values[name] = name;
        const label = Object.assign(document.createElement('label'), { textContent: `#${name}#` });
        const input = Object.assign(document.createElement('input'), { value: values[name] });
        input.addEventListener('input', () => { values[name] = input.value; onChange(); });
        return [label, input];
      }));
    }

    return Object.freeze({
      setNames,
      /** Forces the inputs to be repainted on the next setNames (e.g. after changing the values from outside). */
      invalidate() { shown = null; },
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.createVariablesPanel = createVariablesPanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * "Tamaño etiqueta" bar: choose a known size, "según la etiqueta" or a custom one.
 * It does not modify the label: when "Aplicar a la etiqueta" is pressed it calls onApply(size) and whoever uses it does the work.
 */
(function (PB) {
  'use strict';

  const { sizes, units } = PB;
  const FROM_LABEL = 'label', CUSTOM = 'custom';

  /**
   * els: { select, width, height, pitch, apply }
   * callbacks: { onChange(), onApply(resolvedSize) }
   */
  function createSizePanel(els, catalog, { onChange, onApply }) {
    const inputs = [els.width, els.height, els.pitch];
    /** Values of the inputs in mm: [width, height, pitch] (NaN if empty). */
    const readInputs = () => inputs.map(i => parseFloat(String(i.value).replace(',', '.')));

    function fillOptions(selectedId) {
      const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
      els.select.replaceChildren(
        option(FROM_LABEL, 'Según la etiqueta'),
        ...catalog.all().map(s => option(s.id, s.name + (s.required ? ' — obligatorio' : ''))),
        option(CUSTOM, 'Personalizado…'),
      );
      select(selectedId);
    }

    function select(id) {
      els.select.value = [...els.select.options].some(o => o.value === id) ? id : FROM_LABEL;
      refreshControls();
    }

    function refreshControls() {
      const custom = els.select.value === CUSTOM;
      inputs.forEach(i => { i.disabled = !custom; });
    }

    /** Chosen size already resolved (0.1 mm), or null if the label's own size is used. */
    function current() {
      const id = els.select.value;
      if (id === FROM_LABEL) return null;
      if (id === CUSTOM) {
        const [w, h, p] = readInputs();
        return w > 0 && h > 0 ? sizes.resolve({ name: 'Personalizado', w, h, p: p > 0 ? p : h }) : null;
      }
      const s = catalog.get(id);
      return s ? sizes.resolve(s) : null;
    }

    /** Shows in the inputs the size being drawn (except in "Personalizado", which the user types). */
    function showArea(area) {
      if (els.select.value === CUSTOM) return;
      els.width.value = units.toMm(area.width);
      els.height.value = units.toMm(area.height);
      els.pitch.value = area.pitch ? units.toMm(area.pitch) : '';
    }

    /**
     * When opening a label: choose the known size equal to the one it declares (model.size), or "Según la etiqueta" if there is none.
     * If the label does not declare a size, the chosen size is kept.
     */
    function selectFor(declared) {
      if (declared.width == null) return;
      const match = catalog.findBySize(declared);
      select(match ? match.id : FROM_LABEL);
    }

    els.select.addEventListener('change', () => { refreshControls(); onChange(); });
    inputs.forEach(i => i.addEventListener('input', onChange));

    els.apply.addEventListener('click', () => {
      const chosen = current();
      if (chosen) onApply(chosen);
      else alert('Elige un tamaño o "Personalizado" e indica ancho y alto.');
    });

    return Object.freeze({
      init: fillOptions,
      current,
      showArea,
      selectFor,
      select,
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.createSizePanel = createSizePanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Label code editor: type, paste, drag a file or open it with the button.
 *  - onEdit(): the user changed the text by typing (notified after a short delay).
 *  - onOpen(text): a whole label arrives (pasted, dragged or opened from a file).
 */
(function (PB) {
  'use strict';

  const EDIT_DELAY_MS = 150;
  const LINE_HEIGHT_PX = 16;

  function createEditor(textarea, { openButton, fileInput }, { onEdit, onOpen }) {
    let timer;
    const readFile = file => file.text().then(onOpen);

    textarea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(onEdit, EDIT_DELAY_MS); });
    // After pasting, the text is already in the textarea: it is treated as a new label (to choose its size)
    textarea.addEventListener('paste', () => setTimeout(() => { clearTimeout(timer); onOpen(textarea.value); }, 0));

    textarea.addEventListener('dragover', e => { e.preventDefault(); textarea.classList.add('drag'); });
    textarea.addEventListener('dragleave', () => textarea.classList.remove('drag'));
    textarea.addEventListener('drop', e => {
      textarea.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      e.preventDefault();
      readFile(file);
    });

    openButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) readFile(file);
      fileInput.value = '';
    });

    return Object.freeze({
      text: () => textarea.value,
      setText(text) { textarea.value = text; },
      /** Selects a span of the text and centers it on screen. */
      selectRange(start, end) {
        textarea.focus();
        textarea.setSelectionRange(start, end);
        const line = textarea.value.slice(0, start).split('\n').length - 1;
        textarea.scrollTop = Math.max(0, line * LINE_HEIGHT_PX - textarea.clientHeight / 2);
      },
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.createEditor = createEditor;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Preview: shows the SVG, the coordinates under the mouse and notifies when an item is clicked.
 */
(function (PB) {
  'use strict';

  const { units, viewRotation } = PB;

  function createPreview({ container, cursor, dimensions }, { onSelect }) {
    let selected = null;
    let shown = { area: null, rotation: 0 };
    const svg = () => container.querySelector('svg');

    function highlight(index) {
      selected = index;
      container.querySelectorAll('.item.sel').forEach(el => el.classList.remove('sel'));
      if (index != null) container.querySelector(`.item[data-index="${index}"]`)?.classList.add('sel');
    }

    container.addEventListener('click', e => {
      const group = e.target.closest('.item');
      if (!group) return;
      const index = Number(group.dataset.index);
      highlight(index);
      onSelect(index);
    });

    container.addEventListener('mousemove', e => {
      const el = svg();
      if (!el || !shown.area) return;
      const p = el.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      const q = p.matrixTransform(el.getScreenCTM().inverse());
      // q is in the rotated space of the view: it is mapped back to label units
      const [x, y] = viewRotation.inverse([q.x, q.y], shown.rotation, shown.area.width, shown.area.height);
      cursor.textContent = `x: ${Math.round(x)}  y: ${Math.round(y)}`;
    });

    return Object.freeze({
      /** Paints the SVG (already rotated `rotation` degrees) and returns its element. */
      show(markup, area, rotation) {
        shown = { area, rotation };
        container.innerHTML = markup;
        dimensions.textContent = `Etiqueta ${units.formatMm(area.width)} × ${units.formatMm(area.height)} mm`;
        highlight(selected);
        return svg();
      },
      clearSelection: () => highlight(null),
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.createPreview = createPreview;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
