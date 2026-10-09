/**
 * Entry point: creates the panels and connects parser -> validation -> drawing -> messages.
 * There is no label logic here, only orchestration.
 */
(function (PB) {
  'use strict';

  const { config, examples, languages, validator, sizes, variables, svgRenderer, layout, sources, images, ui, diagnostics: diag } = PB;
  const $ = id => document.getElementById(id);

  /** Model of an empty label or of an unrecognized text: it draws nothing. */
  const EMPTY_MODEL = Object.freeze({
    language: null,
    size: Object.freeze({ width: null, height: null, pitch: null, gap: null, native: Object.freeze({}) }),
    items: Object.freeze([]),
    diagnostics: Object.freeze([]),
  });

  const catalog = sizes.createCatalog(config.sizes);
  // image: picture overlaid on the label, { href (data URL), naturalW, naturalH } or null. Preview only, never written to the code.
  // image also holds `rotationPicked` (true once the user chose a "Rotación" for this image; until then it follows Giro, see
  // images.rotationForView) and `converted` once the 1-bit conversion that the preview shows is ready:
  // { key: 'WxH@threshold', bitmap: { w, h, data } | null (null = conversion failed, plain picture shown) }.
  // The app starts with the first template (a filled label), not with a blank one
  const startExample = examples.find(e => e.group === 'template') || examples[0];
  const state = { values: { ...startExample.values }, image: null, fileName: undefined };

  const messages = ui.createMessagesPanel($('msgs'));
  const variablesPanel = ui.createVariablesPanel($('vars'), { values: state.values, onChange: () => refresh() });
  const sizePanel = ui.createSizePanel(
    { select: $('size'), width: $('szW'), height: $('szH'), pitch: $('szP'), pitchField: $('szPField'), pitchText: $('szPText') },
    catalog,
    { onApply: applySize },
  );
  const editor = ui.createEditor($('src'), { openButton: $('btnOpen'), fileInput: $('file') }, { onEdit: () => refresh(), onOpen: (text, name) => { if (name) state.fileName = name; open(text); } });
  const preview = ui.createPreview(
    { container: $('svgwrap'), cursor: $('cursor'), dimensions: $('dims') },
    {
      onSelect: index => {
        const range = sources.rangeOf(lastModel.items[index]);
        if (range) editor.selectRange(range.start, range.end);
      },
      onSelectionChange: () => updateProperties(),
      canMove: index => isOverlay(index) || Boolean(sourceLanguage()?.moveItem && sources.rangeOf(lastModel.items[index])),
      onMove: moveItem,
      onInsert: insertComponent,
    },
  );
  // The image slice owns its palette entry (kind, label) and the file-picker half of the overlay
  const imageComponent = PB.components.get('image');
  const palette = ui.createPalette($('palette'), { onInsert: kind => insertComponent(kind, DEFAULT_COMPONENT_POINT[0], DEFAULT_COMPONENT_POINT[1]) });
  // Language whose components the palette shows (null = none yet); the list is rebuilt only when it changes
  let paletteLanguage;

  const imagePanel = ui.createImagePanel(
    {
      fileInput: $('imageFile'), x: $('imgX'), y: $('imgY'), width: $('imgW'),
      rotation: $('imgRotation'), threshold: $('imgThreshold'), thresholdValue: $('imgThresholdValue'), insert: $('btnImageInsert'), remove: $('btnImageRemove'),
    },
    {
      onFile: loadImage,
      onChange: () => { refresh(); updatePreview({ delay: PREVIEW_DELAY_MS }); },
      onThreshold: () => updatePreview({ delay: PREVIEW_DELAY_MS }),
      // The rotation is applied after the conversion (see rotatedBitmap), so the ready conversion is reused: only a redraw is needed
      onRotation: () => { if (state.image) state.image.rotationPicked = true; refresh(); },
      onRemove: removeImage,
      onInsert: insertImage,
    },
  );

  // "Convertir a...": converts what the editor holds at the resolution the app parses with; downloads are named after the opened file (or the example)
  ui.createConvertPanel({ root: $('convert'), getText: () => editor.text(), getDpi: () => Number($('dpi').value), getSourceName: () => state.fileName });

  // Collapsible sections: after every title is rendered (the Convertir panel builds its own)
  ui.initCollapsible(document);

  const propertiesPanel = ui.createPropertiesPanel(
    { empty: $('propsEmpty'), title: $('propsKind'), form: $('propsForm'), overlay: $('propsOverlay') },
    { onChange: changeProperty, onValueChange: changeTestValue },
  );

  // Picks the file for the image entry and remembers where the picture lands
  const imagePicker = imageComponent.overlay.createPicker({ fileInput: $('imageFile'), refresh: options => refresh(options) });

  let lastModel = null;

  /**
   * Model with the overlay image (if any) appended to its items; the parsed model is not modified.
   * The item shows the converted 1-bit dots when they are ready for the current controls (what "Insertar en el código"
   * writes); otherwise (conversion pending or failed) the plain picture. Both are shown rotated by the "Rotación" control:
   * x / y are the top-left of the rotated bounding box and width / height (overlap and outside-the-label checks) are its size.
   */
  function withImage(model) {
    if (!state.image) return model;
    const rotation = imagePanel.rotation();
    const placement = { ...state.image, ...imagePanel.placement(), dpi: Number($('dpi').value), rotation };
    const { converted } = state.image;
    const item = converted && converted.bitmap && converted.key === conversionParams().key
      ? images.makeBitmapItem(placement, rotatedBitmap(converted, rotation))
      : images.makeItem(placement);
    return { ...model, items: [...model.items, item] };
  }

  /**
   * The converted bitmap turned by `rotation` (clockwise on the label, like text). Neither SG nor BITMAP has a rotation
   * parameter, so the dots themselves are rotated, after the conversion: Ancho is the width of the unrotated picture. The
   * result is kept on `converted` per rotation so redrawing does not rotate again.
   */
  function rotatedBitmap(converted, rotation) {
    if (!converted.rotated || converted.rotated.rotation !== rotation) {
      converted.rotated = { rotation, bitmap: images.rotateBitmap(converted.bitmap, rotation) };
    }
    return converted.rotated.bitmap;
  }

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
   */
  function analyze(text, { language }) {
    const detected = language || (text.trim() ? languages.detect(text) : null);
    if (!detected) {
      const model = withImage(EMPTY_MODEL);
      return {
        language: null,
        model,
        area: { ...sizes.view(model), diagnostics: [] },
        diagnostics: text.trim() ? [diag.error('No se reconoce el lenguaje de la etiqueta')] : [],
      };
    }
    const parsed = detected.parse(text, { dpi: Number($('dpi').value) });
    // The overlay image joins the items after parsing and before validation, drawing and layout analysis
    const model = withImage(parsed);
    return { language: detected, model, area: sizes.view(model), diagnostics: [...model.diagnostics, ...validator.validate(model, detected)] };
  }

  /**
   * Analyzes the label again and redraws it. Options:
   *  - language: already known language of the label (if not, it is detected).
   *  - notices: extra messages to show along with those of the label.
   */
  function refresh({ language = null, notices = [] } = {}) {
    try {
      const { model, area, diagnostics, language: used } = analyze(editor.text(), { language });
      variables.seedDefaults(state.values, model); // test values the label suggests (ZPL ^FN data), for the variables that have none yet
      const opts = options();
      const drawing = svgRenderer.render(model, area, opts);
      variablesPanel.setNames(variables.namesInModel(model));
      sizePanel.setLanguage(model.language);
      sizePanel.showArea(area);
      sizePanel.selectFor({ ...model.size, pitch: sizes.declaredPitch(model.size) });
      lastModel = model;
      updatePalette(used || languages.get('tpcl'));
      const svgEl = preview.show(drawing.svg, area, opts.rotation);
      updateProperties();
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

  /** The overlay image is always the last item and has no source in the code. */
  const isOverlay = index => Boolean(state.image) && index === lastModel.items.length - 1;

  /** Language of the label being shown (null if not recognized). */
  const sourceLanguage = () => (lastModel.language ? languages.get(lastModel.language) : null);

  /**
   * Shows what the properties panel offers for the selection: the form of the selected item, the overlay image controls
   * (the selected overlay, or no selection while an overlay exists) or the empty message. A selection that no longer
   * exists (the code changed) is dropped.
   */
  function updateProperties() {
    if (!lastModel) return;
    let index = preview.selected();
    if (index != null && !lastModel.items[index]) {
      preview.clearSelection();
      return;
    }
    if (index == null && state.image) index = lastModel.items.length - 1;
    if (index == null) {
      propertiesPanel.show(null);
    } else if (isOverlay(index)) {
      propertiesPanel.showOverlay();
    } else {
      const language = sourceLanguage();
      const item = lastModel.items[index];
      const descriptor = language && language.describeItem ? language.describeItem(item, editor.text()) : null;
      propertiesPanel.show(descriptor, ui.variableFieldsFor(item, lastModel, state.values));
    }
  }

  /**
   * A test value was edited in the properties form: it is app state shared with the Variables panel (never code), so the
   * preview is redrawn and the Variables panel is repainted, without touching the language or the editor.
   */
  function changeTestValue(name, value) {
    state.values[name] = value;
    variablesPanel.invalidate();
    refresh();
  }

  /** A properties form field was edited: the language rewrites only that field, through a path that keeps Ctrl+Z working. */
  function changeProperty(key, value) {
    const index = preview.selected();
    const language = sourceLanguage();
    const item = index != null && lastModel.items[index];
    if (!language || !language.updateItem || !item) return;
    const text = editor.text();
    const updated = language.updateItem(text, item, { [key]: value }, { dpi: Number($('dpi').value) });
    if (updated !== text) {
      if (!editor.replaceText(updated)) editor.setText(updated);
      // The selection is kept by index in the preview; the code box is not re-selected so the form keeps the focus
      refresh();
    }
    // Also when nothing changed (value out of range or equal): the form goes back to what the code says
    updateProperties();
  }

  /**
   * An item was dropped `dx`, `dy` (0.1 mm) away: the overlay image updates the X / Y fields; any other item has its
   * command rewritten by the language, through a path that keeps Ctrl+Z working in the editor.
   */
  function moveItem(index, dx, dy) {
    if (isOverlay(index)) {
      const { xMm, yMm } = imagePanel.placement();
      const moved = (value, delta) => Math.min(999.9, Math.max(0, Math.round(((parseFloat(String(value).replace(',', '.')) || 0) + delta / 10) * 10) / 10));
      imagePanel.setPosition(moved(xMm, dx), moved(yMm, dy));
      refresh();
      updatePreview({ delay: PREVIEW_DELAY_MS });
      return;
    }
    const language = sourceLanguage();
    const item = lastModel.items[index];
    if (!language || !language.moveItem || !item) return;
    const text = editor.text();
    const moved = language.moveItem(text, item, dx, dy, { dpi: Number($('dpi').value) });
    if (moved === text) return;
    if (!editor.replaceText(moved)) editor.setText(moved);
    refresh();
    const range = sources.rangeOf(lastModel.items[index]);
    if (range) editor.selectRange(range.start, range.end);
  }

  /** Where a component activated without dragging (click / Enter) is placed, in label units (0.1 mm). */
  const DEFAULT_COMPONENT_POINT = [100, 100];

  /** Shows the components the language offers; a language without the hook leaves the palette hidden. */
  function updatePalette(language) {
    if (language === paletteLanguage) return;
    paletteLanguage = language;
    // The image is an app-level entry (a preview overlay, not a language component): only languages with insertImage get it
    palette.render(ui.paletteEntries(language, { kind: imageComponent.kind, label: imageComponent.label }));
  }

  /**
   * A palette component was dropped at x, y (label units): the language writes the new item, through a path that keeps
   * Ctrl+Z working in the editor, and the first command it added is selected.
   */
  function insertComponent(kind, x, y, { dropped = false } = {}) {
    if (kind === imageComponent.kind) {
      imagePicker.pick(x, y, { dropped });
      return;
    }
    // Only an unrecognized (e.g. empty) text falls back to TPCL; a recognized language without the hook never gets TPCL commands
    const language = languages.detect(editor.text()) || languages.get('tpcl');
    if (!language) return;
    if (!language.buildComponent) {
      refresh({ notices: [diag.warning(`El lenguaje de la etiqueta (${language.name}) no admite insertar componentes`)] });
      return;
    }
    const text = editor.text();
    const built = language.buildComponent(text, kind, { x, y }, { dpi: Number($('dpi').value), viewRotation: Number($('rotation').value) });
    if (built === text) {
      refresh({ notices: [diag.warning('No se pudo insertar el componente en el código de la etiqueta')] });
      return;
    }
    if (!editor.replaceText(built)) editor.setText(built);
    refresh();
    // The text before the first difference is unchanged: the first command starting after it is the new one
    let start = 0;
    while (start < text.length && text[start] === built[start]) start++;
    const ranges = lastModel.items.map(item => sources.rangeOf(item)).filter(range => range && range.start >= start);
    if (ranges.length) {
      const first = ranges.reduce((a, b) => (b.start < a.start ? b : a));
      editor.selectRange(first.start, first.end);
    }
  }

  /** Writes the size typed or picked in the Formato row in the label if its language allows it; otherwise reports it. */
  function applySize(size) {
    const text = editor.text();
    // The resolution travels with the size: ZPL writes it in dots (TPCL and TSPL ignore it)
    const result = sizes.apply(languages.detect(text), text, { ...size, dpi: Number($('dpi').value) });
    editor.setText(result.text);
    refresh({ notices: result.supported ? [] : [diag.warning('No se puede escribir el tamaño: el lenguaje de la etiqueta no lo admite o no se reconoce')] });
  }

  /** Reads a picture file as a data URL and measures its natural size in pixels. */
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('no se pudo leer el archivo'));
      reader.onload = () => {
        const href = reader.result;
        const probe = new Image();
        probe.onerror = () => reject(new Error('el archivo no es una imagen válida'));
        probe.onload = () => (probe.naturalWidth > 0 && probe.naturalHeight > 0
          ? resolve({ href, naturalW: probe.naturalWidth, naturalH: probe.naturalHeight })
          : reject(new Error('la imagen no tiene un tamaño en píxeles')));
        probe.src = href;
      };
      reader.readAsDataURL(file);
    });
  }

  /** Sets the overlay image from a chosen file (replacing the previous one) and redraws. */
  function loadImage(file) {
    readImage(file).then(
      image => {
        state.image = image;
        // A new picture starts at the default rotation for the current view, whatever was picked for the previous one
        imagePanel.setRotation(images.rotationForView($('rotation').value));
        const position = imagePicker.takePosition();
        if (position) imagePanel.setPosition(...position);
        // Drop any conversion still running for the previous picture: its stale result would leave previewKey set
        cancelPreview();
        imagePanel.setActive(true);
        preview.clearSelection();
        refresh();
        updatePreview();
      },
      error => {
        imagePicker.clear();
        refresh({ notices: [diag.error(`No se pudo añadir la imagen: ${error.message}`)] });
      },
    );
  }

  function removeImage() {
    if (preview.selected() != null && isOverlay(preview.selected())) preview.clearSelection();
    state.image = null;
    cancelPreview();
    imagePanel.setActive(false);
    refresh();
  }

  /** Largest width or height (dots) of an SG command: its fields have 4 digits. */
  const MAX_SG_DOTS = 9999;

  /** Pause after the last change of a control before the preview is converted again. */
  const PREVIEW_DELAY_MS = 150;

  /** Draws the picture on a white canvas of w x h dots, shrinking by halves (see images.downscaleSteps), and returns its black/white dots (see images.thresholdRGBA). */
  function rasterize(href, w, h, threshold) {
    return new Promise((resolve, reject) => {
      const picture = new Image();
      picture.onerror = () => reject(new Error('no se pudo cargar la imagen'));
      picture.onload = () => {
        if (!(picture.naturalWidth > 0 && picture.naturalHeight > 0)) {
          reject(new Error('la imagen no tiene un tamaño en píxeles'));
          return;
        }
        // Each step is drawn over white from the previous canvas: one big downscale would skip most pixels of line art
        let source = picture;
        let g;
        for (const step of images.downscaleSteps(picture.naturalWidth, picture.naturalHeight, w, h)) {
          const canvas = Object.assign(document.createElement('canvas'), { width: step.w, height: step.h });
          g = canvas.getContext('2d', { willReadFrequently: true });
          g.imageSmoothingQuality = 'high';
          g.fillStyle = '#fff';
          g.fillRect(0, 0, step.w, step.h);
          g.drawImage(source, 0, 0, step.w, step.h);
          source = canvas;
        }
        resolve(images.thresholdRGBA(g.getImageData(0, 0, w, h).data, w, h, threshold));
      };
      picture.src = href;
    });
  }

  /**
   * What the current controls convert the picture to: size in dots, luminance threshold (0-255) and a key that
   * identifies that combination (a conversion is still valid while its key equals the current one).
   */
  function conversionParams() {
    const { w, h } = images.targetDots({ ...state.image, ...imagePanel.placement(), dpi: Number($('dpi').value) });
    const threshold = images.thresholdFromPercent(imagePanel.thresholdPercent());
    return { w, h, threshold, key: `${w}x${h}@${threshold}` };
  }

  /** Black/white bitmap { w, h, data } of the current picture for the current controls: the ready one if still valid, else a new one. */
  function convertImage() {
    const { converted, href } = state.image;
    const { w, h, threshold, key } = conversionParams();
    if (converted && converted.bitmap && converted.key === key) return Promise.resolve(converted.bitmap);
    if (w > MAX_SG_DOTS || h > MAX_SG_DOTS) return Promise.reject(new Error(`${w}×${h} puntos supera el máximo de ${MAX_SG_DOTS}`));
    return rasterize(href, w, h, threshold).then(data => ({ w, h, data }));
  }

  // Latest wins: every new conversion or cancel bumps the token, and an older result that arrives later is dropped.
  let previewTimer = null;
  let previewToken = 0;
  let previewKey = null;

  function cancelPreview() {
    clearTimeout(previewTimer);
    previewToken++;
    previewKey = null;
  }

  /**
   * Converts the picture for the current controls (after `delay` ms without further calls) and redraws the preview
   * with the 1-bit result, the same dots "Insertar en el código" writes. If the conversion fails, the plain picture
   * stays and the error is shown.
   */
  function updatePreview({ delay = 0 } = {}) {
    clearTimeout(previewTimer);
    if (!state.image) return;
    previewTimer = setTimeout(() => {
      const image = state.image;
      if (!image) return;
      const { key } = conversionParams();
      if ((image.converted && image.converted.key === key) || previewKey === key) return;
      const token = ++previewToken;
      previewKey = key;
      const finish = (bitmap, notices) => {
        if (token !== previewToken || image !== state.image) return;
        previewKey = null;
        image.converted = { key, bitmap };
        refresh({ notices });
      };
      convertImage().then(
        bitmap => finish(bitmap, []),
        error => finish(null, [diag.error(`No se pudo convertir la imagen para la vista previa: ${error.message}`)]),
      );
    }, delay);
  }

  /**
   * Writes the preview image into the label code as a graphic command (TPCL SG with nibble data, TSPL BITMAP, ZPL ^GF), then drops the preview
   * overlay: the image is now drawn from the code. The command format is NOT verified on a real printer.
   */
  function insertImage() {
    const image = state.image;
    if (!image) return;
    // Only an unrecognized (e.g. empty) text falls back to TPCL; a recognized language without insertImage is never written to
    const language = languages.detect(editor.text()) || languages.get('tpcl');
    if (!language.insertImage || !language.insertCommand) {
      refresh({ notices: [diag.warning(`El lenguaje de la etiqueta (${language.name}) no admite insertar imágenes en el código: la imagen es solo una vista previa`)] });
      return;
    }
    const placement = imagePanel.placement();
    convertImage()
      .then(bitmap => {
        if (image !== state.image) return;
        // The rotated dots are what is written (the same ones the preview shows), at the top-left of the rotated box
        const { w, h, data } = images.rotateBitmap(bitmap, imagePanel.rotation());
        // TSPL and ZPL write their command from the neutral bitmap (imageCommand); TPCL (no hook) writes an SG with nibble data
        const command = language.imageCommand
          ? language.imageCommand({ ...placement, w, h, data, dpi: Number($('dpi').value) })
          : images.buildSG({ ...placement, w, h, data: images.bitmapToNibble(data, w, h) });
        editor.setText(language.insertCommand(editor.text(), command));
        removeImage();
      })
      .catch(error => refresh({ notices: [diag.error(`No se pudo insertar la imagen: ${error.message}`)] }));
  }

  /** Loads a whole label and draws it; the Formato row shows the size it declares. */
  function open(text, { language } = {}) {
    editor.setText(text);
    preview.clearSelection();
    refresh({ language });
  }

  function loadExample(example) {
    state.fileName = example.id;
    Object.assign(state.values, example.values);
    variablesPanel.invalidate();
    open(example.source, { language: languages.get(example.language) });
  }

  // --- Startup ---
  $('dpi').replaceChildren(...config.resolutions.map(d => Object.assign(document.createElement('option'), { value: d, textContent: `${d} dpi` })));
  PB.ui.createExamplePicker($('example'), examples, { onPick: loadExample });
  // Giro: until the user picks a rotation for the image, it follows the view (the picture looks upright in it). Registered
  // before the generic listener below so the redraw already sees the new default.
  $('rotation').addEventListener('input', () => {
    if (state.image && !state.image.rotationPicked) imagePanel.setRotation(images.rotationForView($('rotation').value));
  });
  ['dpi', 'calib', 'rotation', 'optGrid', 'optAnchor', 'optOverlap'].forEach(id => $(id).addEventListener('input', () => refresh()));
  // The resolution changes the size in dots, so the 1-bit preview has to be converted again
  $('dpi').addEventListener('input', () => updatePreview({ delay: PREVIEW_DELAY_MS }));

  sizePanel.init();
  loadExample(startExample);
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
