/**
 * Screen panels: messages, variables, label size, code editor, preview and image overlay.
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
      /**
       * Replaces the whole text keeping the browser's undo stack (Ctrl+Z), unlike setText. Returns false if the browser
       * refuses; the caller then falls back to setText. The caller refreshes: the edit notification it triggers is dropped.
       */
      replaceText(text) {
        textarea.focus();
        textarea.select();
        const done = document.execCommand('insertText', false, text);
        clearTimeout(timer);
        return done;
      },
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
 * Preview: shows the SVG, the coordinates under the mouse, notifies when an item is clicked and lets items be dragged.
 */
(function (PB) {
  'use strict';

  const { units, viewRotation } = PB;

  /** Screen movement (px) under which a press on an item is a click, not a drag. */
  const DRAG_THRESHOLD_PX = 3;

  /**
   * callbacks:
   *  - onSelect(index): an item was clicked.
   *  - canMove(index): whether that item can be dragged (it gets the "movable" class and the grab cursor).
   *  - onMove(index, dx, dy): an item was dropped, moved by dx/dy in label units (0.1 mm). Called once, on drop.
   *  - onInsert(kind, x, y): a palette component was dropped on the label at x/y (label units, not clamped).
   */
  function createPreview({ container, cursor, dimensions }, { onSelect, onMove, onInsert, canMove = () => false }) {
    let selected = null;
    let shown = { area: null, rotation: 0 };
    // Press on a movable item: { id, index, group, startX, startY, startView, active, cancelled, dx, dy }
    let drag = null;
    let suppressClick = false;
    const svg = () => container.querySelector('svg');

    /** Client point -> point in the rotated space of the view (what the SVG draws), or null if nothing is drawn. */
    function toView(clientX, clientY) {
      const el = svg();
      if (!el || !shown.area) return null;
      const p = el.createSVGPoint();
      p.x = clientX; p.y = clientY;
      const q = p.matrixTransform(el.getScreenCTM().inverse());
      return [q.x, q.y];
    }

    function highlight(index) {
      selected = index;
      container.querySelectorAll('.item.sel').forEach(el => el.classList.remove('sel'));
      if (index != null) container.querySelector(`.item[data-index="${index}"]`)?.classList.add('sel');
    }

    container.addEventListener('click', e => {
      if (suppressClick) return;
      const group = e.target.closest('.item');
      if (!group) return;
      const index = Number(group.dataset.index);
      highlight(index);
      onSelect(index);
    });

    /** Client point -> label units (0.1 mm), not clamped, or null if no label is drawn under it. */
    function labelPointAt(clientX, clientY) {
      const q = toView(clientX, clientY);
      // q is in the rotated space of the view: it is mapped back to label units
      return q ? viewRotation.inverse(q, shown.rotation, shown.area.width, shown.area.height) : null;
    }

    container.addEventListener('mousemove', e => {
      const point = labelPointAt(e.clientX, e.clientY);
      if (point) cursor.textContent = `x: ${Math.round(point[0])}  y: ${Math.round(point[1])}`;
    });

    // Palette components (HTML5 drag and drop). Only drags carrying the component type are accepted, so file drops and
    // other drags are untouched. The handlers live on the container: show() rebuilds the SVG inside it.
    const isComponentDrag = e => Array.from(e.dataTransfer?.types || []).includes(PB.ui.COMPONENT_MIME);
    container.addEventListener('dragover', e => {
      if (!isComponentDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      container.classList.add('drop-target');
    });
    container.addEventListener('dragleave', e => {
      if (!container.contains(e.relatedTarget)) container.classList.remove('drop-target');
    });
    container.addEventListener('drop', e => {
      if (!isComponentDrag(e)) return;
      e.preventDefault();
      container.classList.remove('drop-target');
      const kind = e.dataTransfer.getData(PB.ui.COMPONENT_MIME);
      const point = labelPointAt(e.clientX, e.clientY);
      // Outside the label (or nothing drawn): ignored
      if (kind && point && onInsert) onInsert(kind, point[0], point[1], { dropped: true });
    });

    // Drag: the pointer is captured only once it moved past the threshold, so a plain click reaches the click handler.
    // Meanwhile only the dragged <g> is translated (in label units: it lives inside the rotated group); the code is
    // written once, on drop, because every refresh rebuilds the SVG.
    container.addEventListener('pointerdown', e => {
      if (e.button !== 0 || drag) return;
      const group = e.target.closest('.item.movable');
      const startView = group && toView(e.clientX, e.clientY);
      if (!startView) return;
      drag = { id: e.pointerId, index: Number(group.dataset.index), group, startX: e.clientX, startY: e.clientY, startView, active: false, cancelled: false, dx: 0, dy: 0 };
    });

    container.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id || drag.cancelled) return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
        drag.active = true;
        container.setPointerCapture(drag.id);
        container.classList.add('dragging');
      }
      const view = toView(e.clientX, e.clientY);
      if (!view) return;
      // The screen movement is a movement in the rotated view; the item is in label space
      [drag.dx, drag.dy] = viewRotation.delta([view[0] - drag.startView[0], view[1] - drag.startView[1]], shown.rotation).map(Math.round);
      drag.group.style.transform = `translate(${drag.dx}px, ${drag.dy}px)`;
    });

    /** Ends the press: restores the visual and, if it was a drag that was not cancelled, reports the move. */
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const done = drag;
      drag = null;
      if (!done.active) return;
      container.classList.remove('dragging');
      if (container.hasPointerCapture(done.id)) container.releasePointerCapture(done.id);
      done.group.style.transform = '';
      // The click that follows the drop must not select anything
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (e.type === 'pointerup' && !done.cancelled && (done.dx || done.dy)) {
        highlight(done.index);
        onMove(done.index, done.dx, done.dy);
      }
    }
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);

    // Escape cancels the drag at once; the press itself ends when the button is released
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !drag || !drag.active || drag.cancelled) return;
      drag.cancelled = true;
      drag.group.style.transform = '';
    });

    return Object.freeze({
      /** Paints the SVG (already rotated `rotation` degrees) and returns its element. */
      show(markup, area, rotation) {
        shown = { area, rotation };
        container.innerHTML = markup;
        container.querySelectorAll('.item').forEach(g => g.classList.toggle('movable', canMove(Number(g.dataset.index))));
        dimensions.textContent = `Etiqueta ${units.formatMm(area.width)} × ${units.formatMm(area.height)} mm`;
        highlight(selected);
        return svg();
      },
      clearSelection: () => highlight(null),
      labelPointAt,
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.createPreview = createPreview;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * "Imagen" bar: choose a picture file and place it on the label (position and optional width in mm).
 * It does not read the file or draw anything: it notifies and whoever uses it does the work.
 *  - onFile(file): the user chose a picture file.
 *  - onChange(): x, y or width changed.
 *  - onThreshold(): the "Umbral" slider moved (its value is already shown next to it).
 *  - onRemove(): "Quitar imagen" was pressed.
 *  - onInsert(): "Insertar en el código" was pressed.
 */
(function (PB) {
  'use strict';

  /** els: { addButton, fileInput, x, y, width, threshold, thresholdValue, insert, remove } */
  function createImagePanel(els, { onFile, onChange, onThreshold, onRemove, onInsert }) {
    const inputs = [els.x, els.y, els.width, els.threshold];
    const showThreshold = () => { els.thresholdValue.textContent = `${els.threshold.value} %`; };

    els.addButton.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files[0];
      if (file) onFile(file);
      els.fileInput.value = '';
    });
    [els.x, els.y, els.width].forEach(i => i.addEventListener('input', onChange));
    els.threshold.addEventListener('input', () => { showThreshold(); onThreshold(); });
    els.remove.addEventListener('click', onRemove);
    els.insert.addEventListener('click', onInsert);
    showThreshold();

    return Object.freeze({
      /** Raw values typed in the inputs (mm; text, possibly empty). */
      placement: () => ({ xMm: els.x.value, yMm: els.y.value, widthMm: els.width.value }),
      /** Shows a new position (mm) in the X / Y inputs; it does not notify. */
      setPosition(xMm, yMm) {
        els.x.value = xMm;
        els.y.value = yMm;
      },
      /** Raw value of the "Umbral" slider (percent, text). */
      thresholdPercent: () => els.threshold.value,
      /** Enables the placement controls only while there is an image to place. */
      setActive(active) {
        inputs.forEach(i => { i.disabled = !active; });
        els.remove.disabled = !active;
        els.insert.disabled = !active;
      },
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.createImagePanel = createImagePanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
