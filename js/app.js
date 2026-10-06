/**
 * Entry point: creates the panels and connects parser -> validation -> drawing -> messages.
 * There is no label logic here, only orchestration.
 */
(function (PB) {
  'use strict';

  const { config, examples, languages, validator, sizes, variables, svgRenderer, layout, sources, ui, diagnostics: diag } = PB;
  const $ = id => document.getElementById(id);

  /** Model of an empty label or of an unrecognized text: it draws nothing. */
  const EMPTY_MODEL = Object.freeze({
    language: null,
    size: Object.freeze({ width: null, height: null, pitch: null, gap: null, native: Object.freeze({}) }),
    items: Object.freeze([]),
    diagnostics: Object.freeze([]),
  });

  const catalog = sizes.createCatalog(config.sizes);
  const state = { values: { ...examples[0].values } };

  const messages = ui.createMessagesPanel($('msgs'));
  const variablesPanel = ui.createVariablesPanel($('vars'), { values: state.values, onChange: () => refresh() });
  const sizePanel = ui.createSizePanel(
    { select: $('size'), width: $('szW'), height: $('szH'), pitch: $('szP'), apply: $('btnApply') },
    catalog,
    { onChange: () => refresh(), onApply: applySize },
  );
  const editor = ui.createEditor($('src'), { openButton: $('btnOpen'), fileInput: $('file') }, { onEdit: () => refresh(), onOpen: text => open(text) });
  const preview = ui.createPreview(
    { container: $('svgwrap'), cursor: $('cursor'), dimensions: $('dims') },
    {
      onSelect: index => {
        const range = sources.rangeOf(lastModel.items[index]);
        if (range) editor.selectRange(range.start, range.end);
      },
    },
  );

  let lastModel = null;

  function options() {
    return {
      textScale: (Number($('calib').value) || 100) / 100,
      showGrid: $('optGrid').checked,
      showAnchors: $('optAnchor').checked,
      rotation: Number($('rotation').value),
      values: state.values,
    };
  }

  /**
   * Analyzes the label once and prepares everything to be shown, without touching the drawing or the messages:
   * if something fails here it throws and the screen stays as it was.
   * language: already known language (e.g. that of an example); if not, it is detected from the text.
   * fresh: new label, the known size matching the one it declares is chosen first.
   */
  function analyze(text, { language, fresh }) {
    const detected = language || (text.trim() ? languages.detect(text) : null);
    if (!detected) {
      return {
        language: null,
        model: EMPTY_MODEL,
        area: { ...sizes.view(EMPTY_MODEL, sizePanel.current()), diagnostics: [] },
        diagnostics: text.trim() ? [diag.error('No se reconoce el lenguaje de la etiqueta')] : [],
      };
    }
    const model = detected.parse(text, { dpi: Number($('dpi').value) });
    if (fresh) sizePanel.selectFor(model.size);
    return { language: detected, model, area: sizes.view(model, sizePanel.current()), diagnostics: [...model.diagnostics, ...validator.validate(model, detected)] };
  }

  /**
   * Analyzes the label again and redraws it. Options:
   *  - fresh: it is a new label (see analyze).
   *  - language: already known language of the label (if not, it is detected).
   *  - notices: extra messages to show along with those of the label.
   */
  function refresh({ fresh = false, language = null, notices = [] } = {}) {
    try {
      const { model, area, diagnostics, language: used } = analyze(editor.text(), { language, fresh });
      const opts = options();
      const drawing = svgRenderer.render(model, area, opts);
      variablesPanel.setNames(variables.namesInModel(model));
      sizePanel.showArea(area);
      lastModel = model;
      const svgEl = preview.show(drawing.svg, area, opts.rotation);
      messages.show([
        ...notices,
        ...diagnostics,
        ...area.diagnostics,
        ...(used ? layout.analyze(svgEl, model, area, { markOverlaps: $('optOverlap').checked }) : []),
        ...drawing.diagnostics,
      ]);
    } catch (error) {
      messages.show([...notices, diag.error(`Error al procesar la etiqueta: ${error.message}`)]);
    }
  }

  /** Writes the chosen size in the label if its language allows it; otherwise reports it. */
  function applySize(size) {
    const text = editor.text();
    const result = sizes.apply(languages.detect(text), text, size);
    editor.setText(result.text);
    refresh({ notices: result.supported ? [] : [diag.warning('No se puede escribir el tamaño: el lenguaje de la etiqueta no lo admite o no se reconoce')] });
  }

  /** Loads a whole label and draws it. Without sizeId, the known size matching the one it declares is chosen. */
  function open(text, { sizeId, language } = {}) {
    if (sizeId) sizePanel.select(sizeId);
    editor.setText(text);
    preview.clearSelection();
    refresh({ fresh: !sizeId, language });
  }

  function loadExample(example) {
    Object.assign(state.values, example.values);
    variablesPanel.invalidate();
    open(example.source, { sizeId: example.sizeId, language: languages.get(example.language) });
  }

  // --- Startup ---
  $('dpi').replaceChildren(...config.resolutions.map(d => Object.assign(document.createElement('option'), { value: d, textContent: `${d} dpi` })));
  $('example').replaceChildren(...examples.map(e => Object.assign(document.createElement('option'), { value: e.id, textContent: e.name })));
  $('btnExample').addEventListener('click', () => loadExample(examples.find(e => e.id === $('example').value)));
  ['dpi', 'calib', 'rotation', 'optGrid', 'optAnchor', 'optOverlap'].forEach(id => $(id).addEventListener('input', () => refresh()));

  sizePanel.init(examples[0].sizeId);
  loadExample(examples[0]);
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
