/**
 * Export of the viewer drawing to a PNG (PB.renderExport), the first half of "print through the printer driver": the agent
 * (POST /print-image, agent/printbridge-agent.js) receives this PNG and prints it at its real size in mm.
 *
 * The SVG the viewer paints is the source (an <svg> element or its markup). The export never touches the viewer: it works on a copy.
 *  - Editor chrome is removed (grid, origin points, hit / selection areas, overlap marks, tooltips): it is not part of the label.
 *  - The drawing is always upright, as the label is defined: the on-screen view rotation (g.view-rotation) is unwrapped and the
 *    viewBox is the label itself (0 0 width height, in 0.1 mm) without the pad the viewer keeps around it.
 *  - The label border the viewer draws (stroke of .label-background) is a screen aid: the printed page has a plain white background.
 *  - An SVG shown through an <img> does not see the page CSS, so the rules the drawing depends on (typefaces, bold / italic, text
 *    attributes, strokes) are inlined in a <style>. Typefaces are the same stacks as css/label.css; they are system fonts, no web font
 *    is involved, so the PNG uses whatever the browser resolves for them, exactly as the viewer does.
 *  - Pictures are data URLs already (overlay image); any other href is fetched and embedded.
 * The pure parts (pixel size, chrome rule, query string, viewBox) take plain values and are tested under node; toPng needs a browser.
 */
(function (PB) {
  'use strict';

  const MAX_SIDE_PX = 16384;
  const MAX_PIXELS = 100e6; // 100 megapixels
  // The agent's ranges (agent/printbridge-agent.js parseImageQuery): keep them in step
  const MAX_SIZE_MM = 1000;
  const MAX_OFFSET_MM = 100;
  const MAX_COPIES = 99;
  const MIN_DPI = 72;
  const MAX_DPI = 1200;
  const MM_PER_INCH = 25.4;

  const isNumber = v => typeof v === 'number' && Number.isFinite(v);

  /** Size in whole pixels of a widthMm x heightMm label at `dpi`. Throws an Error with a Spanish message when it is not usable. */
  function pixelSize(widthMm, heightMm, dpi) {
    if (!isNumber(widthMm) || widthMm <= 0 || !isNumber(heightMm) || heightMm <= 0) throw new Error('El tamaño de la etiqueta no es válido');
    if (!isNumber(dpi) || dpi < MIN_DPI || dpi > MAX_DPI) throw new Error(`La resolución debe estar entre ${MIN_DPI} y ${MAX_DPI} ppp`);
    const width = Math.max(1, Math.round(widthMm / MM_PER_INCH * dpi));
    const height = Math.max(1, Math.round(heightMm / MM_PER_INCH * dpi));
    if (width > MAX_SIDE_PX || height > MAX_SIDE_PX) {
      throw new Error(`La imagen (${width} × ${height} px) supera el máximo de ${MAX_SIDE_PX} px por lado: baja la resolución`);
    }
    if (width * height > MAX_PIXELS) {
      throw new Error(`La imagen (${width} × ${height} px) supera el máximo de ${MAX_PIXELS / 1e6} megapíxeles: baja la resolución`);
    }
    return { width, height };
  }

  /**
   * Query string of POST /print-image, validated with the same ranges as the agent. Throws an Error with a Spanish message.
   * offsetXmm / offsetYmm default to 0, copies to 1 and paper to 'default'.
   */
  function imageQuery({ printer, widthMm, heightMm, dpi, offsetXmm = 0, offsetYmm = 0, copies = 1, paper = 'default' } = {}) {
    if (typeof printer !== 'string' || printer === '') throw new Error('Elige una impresora');
    const range = (value, label, min, max, { minExclusive = false, integer = false } = {}) => {
      const ok = isNumber(value) && value <= max && (minExclusive ? value > min : value >= min) && (!integer || Number.isInteger(value));
      if (!ok) {
        throw new Error(`${label} debe ser un número ${integer ? 'entero ' : ''}${minExclusive ? 'mayor que' : 'entre'} ${min}${minExclusive ? ' y hasta' : ' y'} ${max}`);
      }
      // Up to 6 decimals, never an exponent: the agent only accepts plain decimal numbers
      return Number(value.toFixed(6)).toString();
    };
    if (paper !== 'label' && paper !== 'default') throw new Error('El papel debe ser "label" o "default"');
    const params = new URLSearchParams();
    params.set('printer', printer);
    params.set('widthMm', range(widthMm, 'El ancho (mm)', 0, MAX_SIZE_MM, { minExclusive: true }));
    params.set('heightMm', range(heightMm, 'El alto (mm)', 0, MAX_SIZE_MM, { minExclusive: true }));
    params.set('dpi', range(dpi, 'La resolución (ppp)', MIN_DPI, MAX_DPI));
    params.set('offsetXmm', range(offsetXmm, 'El desplazamiento X (mm)', -MAX_OFFSET_MM, MAX_OFFSET_MM));
    params.set('offsetYmm', range(offsetYmm, 'El desplazamiento Y (mm)', -MAX_OFFSET_MM, MAX_OFFSET_MM));
    params.set('copies', range(copies, 'Las copias', 1, MAX_COPIES, { integer: true }));
    params.set('paper', paper);
    return params.toString();
  }

  /** Classes the viewer adds for the editor only (grid, origin points, hit / selection, overlap marks, drop preview). */
  const CHROME_CLASSES = Object.freeze(['hit', 'grid-line', 'grid-text', 'origin', 'overlaps', 'overlap', 'drop-target']);
  const CHROME_SELECTOR = CHROME_CLASSES.map(name => `.${name}`).join(',') + ',title';

  /** True when an element with these class names (a string or a list) is editor chrome and must not be printed. */
  function isEditorChrome(classNames) {
    const list = Array.isArray(classNames) ? classNames : String(classNames || '').split(/\s+/);
    return list.some(name => CHROME_CLASSES.includes(name));
  }

  /** viewBox of the exported drawing: the label alone, upright, in the viewer's units (0.1 mm). */
  const labelViewBox = (width, height) => `0 0 ${width} ${height}`;

  /**
   * The CSS rules the drawing needs when it is shown through an <img> (copied from css/label.css; a test keeps them in step).
   * The background is plain white with no border: the border is a screen aid.
   */
  const LABEL_CSS = [
    '.label-background { fill: #fff; stroke: none; }',
    '.font-serif { font-family: "Times New Roman", Times, serif; }',
    '.font-sans { font-family: Arial, Helvetica, sans-serif; }',
    '.font-mono { font-family: "Courier New", Courier, monospace; }',
    '.bold { font-weight: 700; }',
    '.italic { font-style: italic; }',
    '.attr-fill { fill: #000; stroke: none; }',
    '.attr-outline { fill: none; stroke: #000; stroke-width: 3; }',
    '.attr-line { stroke: #000; stroke-width: 3; }',
    'text.attr-reverse { fill: #fff; }',
    '.human-readable { font-family: Arial, Helvetica, sans-serif; text-anchor: middle; }',
    '.stroke { stroke: #000; fill: none; }',
    '.hatch { stroke: #c4320a; stroke-width: 2; }',
    '.not-generated { fill: url(#not-generated); }',
  ];

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  const readAsDataUrl = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  /** Embeds every picture that is not a data URL already (the SVG shown through an <img> cannot load anything outside itself). */
  async function embedPictures(root) {
    const pictures = [...root.querySelectorAll('image')];
    await Promise.all(pictures.map(async picture => {
      const href = picture.getAttribute('href') || picture.getAttributeNS(XLINK_NS, 'href') || '';
      if (href === '' || href.startsWith('data:')) return;
      const response = await fetch(href);
      if (!response.ok) throw new Error('No se pudo leer una imagen de la etiqueta');
      picture.setAttribute('href', await readAsDataUrl(await response.blob()));
    }));
  }

  /**
   * Prepares the export copy of the viewer SVG: a parsed <svg> element sized width x height px with the label as its viewBox.
   * Returns { root, labelWidth, labelHeight }. Browser only (DOMParser).
   */
  function prepare(svg, { width, height }) {
    const markup = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);
    const text = /<svg[^>]*\sxmlns=/.test(markup) ? markup : markup.replace('<svg', `<svg xmlns="${SVG_NS}"`);
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('El dibujo de la etiqueta no es un SVG válido');

    root.querySelectorAll(CHROME_SELECTOR).forEach(node => node.remove());
    // The label is always printed upright: drop the view rotation the screen shows
    root.querySelectorAll('.view-rotation').forEach(group => {
      group.removeAttribute('transform');
    });
    const background = root.querySelector('.label-background');
    const labelWidth = background ? Number(background.getAttribute('width')) : NaN;
    const labelHeight = background ? Number(background.getAttribute('height')) : NaN;
    if (!(labelWidth > 0) || !(labelHeight > 0)) throw new Error('El dibujo no contiene la etiqueta');

    root.setAttribute('width', String(width));
    root.setAttribute('height', String(height));
    root.setAttribute('viewBox', labelViewBox(labelWidth, labelHeight));
    root.setAttribute('preserveAspectRatio', 'none');
    const style = doc.createElementNS(SVG_NS, 'style');
    style.textContent = LABEL_CSS.join('\n');
    root.insertBefore(style, root.firstChild);
    return { root, labelWidth, labelHeight };
  }

  const loadImage = url => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('El navegador no pudo dibujar la etiqueta'));
    image.src = url;
  });

  /**
   * Renders the label to a PNG Blob of exactly pixelSize(widthMm, heightMm, dpi) on a white background.
   *   svg: the viewer's <svg> element or its markup (any view rotation: the PNG is always upright)
   * Rejects with an Error with a Spanish message.
   */
  async function toPng({ svg, widthMm, heightMm, dpi }) {
    const size = pixelSize(widthMm, heightMm, dpi);
    const { root } = prepare(svg, size);
    await embedPictures(root);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('El navegador no pudo crear la imagen');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(image, 0, 0, size.width, size.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('El navegador no pudo crear la imagen PNG (¿resolución demasiado alta?)');
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  PB.renderExport = Object.freeze({
    pixelSize, imageQuery, isEditorChrome, labelViewBox, toPng,
    CHROME_CLASSES, CHROME_SELECTOR, LABEL_CSS, MAX_SIDE_PX, MAX_PIXELS,
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
