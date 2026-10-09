/**
 * Screen panels: messages, variables, label size, code editor and preview.
 * Each panel only handles its part of the screen and notifies the rest through callbacks.
 * The image controls panel (PB.ui.createImagePanel) lives in js/components/image/panel.js.
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
 * "Ejemplo" combo: a disabled placeholder is the shown value; choosing an example calls onPick(example) and the combo
 * goes back to the placeholder, so choosing the same example again loads it again.
 * The examples are listed in <optgroup>s by their optional `group` (GROUPS, in that order); an example without a known
 * group is listed last, outside any group.
 */
(function (PB) {
  'use strict';

  /** Sections of the combo: example group id -> header. */
  const GROUPS = Object.freeze([['blank', 'En blanco'], ['basic', 'Básicos'], ['full', 'Ejemplos completos']]);

  function createExamplePicker(select, examples, { onPick }) {
    const option = (value, textContent) => Object.assign(document.createElement('option'), { value, textContent });
    const placeholder = Object.assign(option('', 'Elegir ejemplo…'), { disabled: true });
    const optionOf = e => option(e.id, e.name);
    const groupNodes = GROUPS
      .map(([id, label]) => [label, examples.filter(e => e.group === id)])
      .filter(([, members]) => members.length)
      .map(([label, members]) => {
        const node = document.createElement('optgroup');
        node.label = label;
        node.replaceChildren(...members.map(optionOf));
        return node;
      });
    const known = new Set(GROUPS.map(([id]) => id));
    select.replaceChildren(placeholder, ...groupNodes, ...examples.filter(e => !known.has(e.group)).map(optionOf));
    select.value = '';
    select.addEventListener('change', () => {
      const example = examples.find(e => e.id === select.value);
      select.value = '';
      if (example) onPick(example);
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.createExamplePicker = createExamplePicker;
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
 * "Formato" row: a view of the size the label declares. The fields (mm) always show it; editing a field and leaving it
 * (change), or picking a standard size, calls onApply(resolvedSize) and whoever uses the panel writes it to the label.
 * Picking "Personalizado…" only marks the combo. The panel itself never modifies the label.
 */
(function (PB) {
  'use strict';

  const { sizes, units } = PB;
  const CUSTOM = 'custom';

  /**
   * els: { select, width, height, pitch }
   * callbacks: { onApply(resolvedSize) } (0.1 mm)
   */
  function createSizePanel(els, catalog, { onApply }) {
    const inputs = [els.width, els.height, els.pitch];
    /** Last size shown (what the label declares): invalid input goes back to it. */
    let shown = null;
    /** Field the user is typing in: showArea leaves it alone until it is left (change). */
    let editing = null;

    /** Values of the inputs in mm: [width, height, pitch] (NaN if empty). */
    const readInputs = () => inputs.map(i => parseFloat(String(i.value).replace(',', '.')));

    function init() {
      const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
      els.select.replaceChildren(
        ...catalog.all().map(s => option(s.id, s.name)),
        option(CUSTOM, 'Personalizado…'),
      );
      els.select.value = CUSTOM;
    }

    /** Shows in the fields the size the label declares (or the fallback it is drawn with), except the field being edited. */
    function showArea(area) {
      shown = area;
      const values = [units.toMm(area.width), units.toMm(area.height), area.pitch ? units.toMm(area.pitch) : ''];
      inputs.forEach((input, i) => { if (input !== editing) input.value = values[i]; });
    }

    /** Marks the standard size equal to the declared one, or "Personalizado" (also if the label declares none). */
    function selectFor(declared) {
      const match = declared.width != null ? catalog.findBySize(declared) : null;
      els.select.value = match ? match.id : CUSTOM;
    }

    /** A field was left: write the typed size to the label, or go back to the label's values if it is not valid. */
    function commit() {
      editing = null;
      const [w, h, p] = readInputs();
      const pitchEmpty = String(els.pitch.value).trim() === '';
      if (w > 0 && h > 0 && (pitchEmpty || p > 0)) {
        onApply(sizes.resolve({ name: 'Personalizado', w, h, p: pitchEmpty ? h : p }));
      } else if (shown) {
        showArea(shown);
      }
    }

    els.select.addEventListener('change', () => {
      const standard = catalog.get(els.select.value);
      if (standard) onApply(sizes.resolve(standard));
    });
    inputs.forEach(input => {
      input.addEventListener('input', () => { editing = input; });
      input.addEventListener('change', commit);
    });

    return Object.freeze({ init, showArea, selectFor });
  }

  PB.ui = PB.ui || {};
  PB.ui.createSizePanel = createSizePanel;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * File bytes -> editor text (PB.ui.decodeFile).
 * UTF-8 is the default, as before. TSPL BITMAP data is raw binary: decoding it as UTF-8 turns every invalid sequence into
 * U+FFFD and loses the bytes, while the TSPL tokenizer expects one character per byte (latin1). So when the bytes are not
 * plain UTF-8 text of another language, the latin1 text is used if it is TSPL and it either failed to decode as UTF-8 or
 * carries a BITMAP (whose bytes may form valid UTF-8 sequences by chance).
 * The textarea normalizes CR / CRLF to LF in its value, which would alter a payload byte 0x0D (and shrink the payload for a
 * CRLF pair). So the 0x0D bytes inside BITMAP payloads become PB.tspl.CR_PLACEHOLDER here (the tokenizer finds the payload
 * spans in the faithful text); the file's own line endings are left alone. The readers of payload chars map it back.
 * Limits: pasted text (textarea) cannot carry arbitrary bytes, only files can.
 */
(function (PB) {
  'use strict';

  const BITMAP_LINE = /^[ \t]*BITMAP[ \t]+\d/im;
  const CHUNK = 8192;

  /** One character per byte (code points 0-255). */
  function latin1(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += CHUNK) text += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return text;
  }

  const isTspl = text => { const language = PB.languages.detect(text); return !!language && language.id === 'tspl'; };

  /** The 0x0D chars inside BITMAP payloads replaced by the placeholder; the rest of the text is untouched. */
  function protectCr(text) {
    if (!text.includes('\r')) return text;
    let out = '';
    let from = 0;
    for (const cmd of PB.tspl.commands(text)) {
      if (cmd.name !== 'BITMAP' || cmd.data === undefined) continue;
      const start = cmd.end - cmd.data.length;
      out += text.slice(from, start) + text.slice(start, cmd.end).replace(/\r/g, PB.tspl.CR_PLACEHOLDER);
      from = cmd.end;
    }
    return out + text.slice(from);
  }

  function decodeFile(bytes) {
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    // ASCII only: the UTF-8 text is the latin1 text, and a BITMAP payload may still hold 0x0D
    if (!bytes.some(b => b > 127)) return BITMAP_LINE.test(utf8) && isTspl(utf8) ? protectCr(utf8) : utf8;
    const raw = latin1(bytes);
    if (isTspl(raw) && (utf8.includes('\uFFFD') || BITMAP_LINE.test(raw))) return protectCr(raw);
    return utf8;
  }

  PB.ui = PB.ui || {};
  PB.ui.decodeFile = decodeFile;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Label code editor: type, paste, drag a file or open it with the button.
 *  - onEdit(): the user changed the text by typing (notified after a short delay).
 *  - onOpen(text, name?): a whole label arrives (pasted, dragged or opened from a file); name is the file name, none when pasted.
 */
(function (PB) {
  'use strict';

  const EDIT_DELAY_MS = 150;
  const LINE_HEIGHT_PX = 16;

  function createEditor(textarea, { openButton, fileInput }, { onEdit, onOpen }) {
    let timer;
    // Files are read as bytes so that binary payloads (TSPL BITMAP) survive; see PB.ui.decodeFile
    const readFile = file => file.arrayBuffer().then(buffer => onOpen(PB.ui.decodeFile(new Uint8Array(buffer)), file.name));

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
   *  - onSelectionChange(index | null): the selection changed (an item was clicked or dropped, empty space was clicked, or it was cleared).
   *  - canMove(index): whether that item can be dragged (it gets the "movable" class and the grab cursor).
   *  - onMove(index, dx, dy): an item was dropped, moved by dx/dy in label units (0.1 mm). Called once, on drop.
   *  - onInsert(kind, x, y): a palette component was dropped on the label at x/y (label units, not clamped).
   */
  function createPreview({ container, cursor, dimensions }, { onSelect, onSelectionChange = () => {}, onMove, onInsert, canMove = () => false }) {
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
      if (!group) {
        highlight(null);
        onSelectionChange(null);
        return;
      }
      const index = Number(group.dataset.index);
      highlight(index);
      onSelect(index);
      onSelectionChange(index);
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
        onSelectionChange(done.index);
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
      clearSelection() {
        highlight(null);
        onSelectionChange(null);
      },
      /** Index of the selected item, or null. */
      selected: () => selected,
      labelPointAt,
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.createPreview = createPreview;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
