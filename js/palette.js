/**
 * Component palette: a list of the components the active language can insert. Each entry is dragged onto the preview
 * (HTML5 drag and drop; the preview reads the kind from the drag data) or activated with a click / Enter, which
 * inserts it at a default position.
 *  - onInsert(kind): an entry was activated without dragging.
 */
(function (PB) {
  'use strict';

  /** Drag data type carrying the component kind. */
  const COMPONENT_MIME = 'application/x-printbridge-component';

  /** Short text glyph of the kinds not migrated to a slice yet; a slice declares its own `glyph`. Unknown kinds get a generic one. */
  const GLYPHS = Object.freeze({ image: '🖼' });

  const glyphOf = kind => (PB.components.get(kind) || {}).glyph || GLYPHS[kind] || '+';

  function createPalette(container, { onInsert }) {
    return Object.freeze({
      /** Shows the entries ({ kind, label }); an empty list hides the palette's panel (the container's parent). */
      render(templates) {
        const items = templates.map(({ kind, label }) => {
          const item = document.createElement('li');
          item.className = 'palette-item';
          item.draggable = true;
          item.tabIndex = 0;
          item.dataset.kind = kind;
          item.title = 'Arrastra a la etiqueta (o pulsa Intro) para insertarlo';
          const glyph = Object.assign(document.createElement('span'), { className: 'palette-glyph', textContent: glyphOf(kind) });
          glyph.setAttribute('aria-hidden', 'true');
          item.append(glyph, label);
          item.addEventListener('dragstart', e => {
            e.dataTransfer.setData(COMPONENT_MIME, kind);
            e.dataTransfer.effectAllowed = 'copy';
          });
          item.addEventListener('click', () => onInsert(kind));
          item.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            onInsert(kind);
          });
          return item;
        });
        container.replaceChildren(...items);
        if (container.parentElement) container.parentElement.hidden = items.length === 0;
      },
    });
  }

  PB.ui = PB.ui || {};
  PB.ui.COMPONENT_MIME = COMPONENT_MIME;
  PB.ui.createPalette = createPalette;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
