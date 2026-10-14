/**
 * TSPL command help: what the caret is on in the code editor, in the same shape as the ZPL and TPCL ones (js/languages/zpl-help.js,
 * js/languages/tpcl-help.js): { id, known, title, description, params: [{ label, description, value, current }], extra }. Pure (no DOM).
 * Source: the TSC TSPL manual B-442 / B-443 (docs/tspl, local PDF never committed: its syntax sections are what the layouts follow) and the
 * layouts the parser handles (js/languages/tspl.js and js/components/<kind>/tspl.js, whose headers say where the manual is silent: BLOCK, ELLIPSE
 * and CIRCLE are not in it). The texts are short summaries in Spanish.
 * A TSPL command is one line `NAME p1,p2,...`; PB.tspl.commands(text) yields it with the absolute offsets of each parameter (commas inside quotes
 * do not split, and the binary data of BITMAP is not a parameter). Two commands are not split by name: `SET COUNTER @n step` (the name is SET)
 * and the assignment `@n="value"` (the name is the whole token); both are told apart here.
 * Like TPCL the parameters are not always a fixed list (TEXT / BARCODE have an optional alignment before the content, BLOCK and QRCODE optional
 * ones, DMATRIX an optional group of three), so each command has a layout function that labels the parameters actually written, in order; the
 * content of the quoted commands is always the last one. A caret in the name is on no parameter and one past the last parameter is on the last.
 * Exposed as PB.tsplHelp = { at, range, TABLE }.
 */
(function (PB) {
  'use strict';

  const p = (label, description) => ({ label, description });

  const X = p('Posición X', 'Coordenada X en puntos');
  const Y = p('Posición Y', 'Coordenada Y en puntos');
  const ROTATION = p('Rotación', '0, 90, 180 o 270 grados en sentido horario');
  const CONTENT = p('Contenido', 'El texto o los datos, entre comillas (una comilla se escribe \\["], un salto de línea \\[L], un retorno \\[R])');
  const LENGTH = 'en pulgadas por defecto, o con unidad: 100 mm, 800 dot';

  /** Layout of a command with `head` labels, optional parameters in the middle and the content last (TEXT, BARCODE, BLOCK, DMATRIX...). */
  const withContent = (head, middle) => args => {
    const out = head.slice(0, args.length < head.length + 1 ? head.length : args.length);
    const extra = Math.max(0, args.length - head.length - 1);
    for (let i = 0; i < extra; i++) out.push(middle[i] || p('Parámetro adicional', 'Opción que sigue a los parámetros fijos'));
    out.push(CONTENT);
    return out;
  };

  /** Option of QRCODE told apart by its prefix letter. */
  function qrOption(text) {
    const t = text.trim();
    if (/^J\d/.test(t)) return p('Modo de conexión (J)', 'J1 a J9: cantidad de símbolos unidos');
    if (/^M\d/.test(t)) return p('Modelo (M)', 'M1 original, M2 mejorado');
    if (/^S\d/.test(t)) return p('Máscara (S)', 'S0 a S8');
    if (/^X\d/.test(t)) return p('Tamaño de área (X)', 'X seguido de un número');
    if (/^L\d/.test(t)) return p('Largo de los datos (L)', 'L seguido de un número');
    return p('Parámetro adicional', 'Opción del QR');
  }

  const TABLE = Object.freeze({
    SIZE: { title: 'Tamaño de etiqueta', description: 'Ancho y largo de la etiqueta.', layout: () => [p('Ancho', `Ancho de la etiqueta, ${LENGTH}`), p('Largo', `Largo de la etiqueta, ${LENGTH}`)] },
    GAP: { title: 'Separación entre etiquetas', description: 'Distancia entre dos etiquetas y su desplazamiento.', layout: () => [p('Separación', `Distancia entre etiquetas, ${LENGTH}`), p('Desplazamiento', `Desplazamiento de la separación, ${LENGTH}`)] },
    BLINE: { title: 'Marca negra', description: 'Altura de la marca negra y su desplazamiento (en lugar de GAP).', layout: () => [p('Altura de la marca', `Altura de la línea negra, ${LENGTH}`), p('Desplazamiento', `Desplazamiento, ${LENGTH}`)] },
    OFFSET: { title: 'Desplazamiento de parada', description: 'Distancia que avanza la etiqueta tras imprimir.', layout: () => [p('Distancia', `Distancia, ${LENGTH}`)] },
    SPEED: { title: 'Velocidad', description: 'Velocidad de impresión.', layout: () => [p('Velocidad', 'Pulgadas por segundo (en la B-442 / B-443: 1.5, 2.0 o 3.0)')] },
    DENSITY: { title: 'Densidad', description: 'Oscuridad de la impresión.', layout: () => [p('Nivel', '0 es el más claro y 15 el más oscuro')] },
    DIRECTION: { title: 'Sentido de impresión', description: 'Orientación de la etiqueta al imprimir.', layout: () => [p('Sentido', '0 o 1 (1 deja el origen arriba a la izquierda; 0 gira la salida 180°)'), p('Espejo', '1 imprime en espejo, 0 normal')] },
    REFERENCE: { title: 'Punto de referencia', description: 'Origen de las coordenadas de la etiqueta.', layout: () => [p('X', 'Desplazamiento horizontal en puntos'), p('Y', 'Desplazamiento vertical en puntos')] },
    SHIFT: { title: 'Desplazamiento de la imagen', description: 'Mueve toda la imagen; con un solo valor es el vertical.', layout: args => (args.length > 1 ? [p('X', 'Desplazamiento horizontal en puntos'), p('Y', 'Desplazamiento vertical en puntos')] : [p('Y', 'Desplazamiento vertical en puntos')]) },
    FEED: { title: 'Avance', description: 'Hace avanzar el papel.', layout: () => [p('Puntos', 'Cantidad de puntos (1 a 65535)')] },
    CODEPAGE: { title: 'Página de códigos', description: 'Tabla de caracteres con la que se interpretan los textos.', layout: () => [p('Página', 'Nombre o número de la página de códigos (por ejemplo 437)')] },
    CLS: { title: 'Borrar imagen', description: 'Limpia la memoria de imagen antes de dibujar la etiqueta.', layout: () => [] },
    PRINT: { title: 'Imprimir', description: 'Imprime la etiqueta dibujada.', layout: () => [p('Juegos', 'Cuántos juegos de etiquetas (1 a 65535)'), p('Copias', 'Copias de cada etiqueta (1 a 65535)')] },
    TEXT: {
      title: 'Texto', description: 'Dibuja un texto con una fuente de la impresora.',
      layout: withContent([X, Y, p('Fuente', '1 (8x12) a 5 (32x48) puntos, 0 escalable, o el nombre de una fuente'), ROTATION,
        p('Ampliación horizontal', '1 a 10 (8 en la B-442 / B-443)'), p('Ampliación vertical', '1 a 10 (8 en la B-442 / B-443)')], [p('Alineación', '0 o 1 izquierda, 2 centro, 3 derecha')]),
    },
    BLOCK: {
      title: 'Bloque de texto', description: 'Dibuja un texto que se parte en líneas dentro de un recuadro (no figura en el manual B-442 / B-443).',
      layout: withContent([X, Y, p('Ancho', 'Ancho del bloque en puntos'), p('Alto', 'Alto del bloque en puntos'), p('Fuente', 'Fuente de la impresora'), ROTATION,
        p('Ampliación horizontal', 'Multiplicador'), p('Ampliación vertical', 'Multiplicador')],
      [p('Espacio entre líneas', 'Puntos entre líneas'), p('Alineación', '0 o 1 izquierda, 2 centro, 3 derecha'), p('Ajuste', 'Ajuste del texto al recuadro')]),
    },
    BARCODE: {
      title: 'Código de barras', description: 'Dibuja un código de barras.',
      layout: withContent([X, Y, p('Tipo', 'Símbolo: 128, 128M, EAN128, 25, 25C, 39, 39C, 93, EAN13 / EAN8 (con +2 o +5), UPCA, UPCE, CODA, ITF14…'), p('Altura', 'Altura de las barras en puntos'),
        p('Texto legible', '0 no, 1 a la izquierda, 2 centrado, 3 a la derecha'), p('Rotación', '0, 90, 180 o 270 grados'), p('Barra estrecha', 'Puntos de la barra estrecha'), p('Barra ancha', 'Puntos de la barra ancha')],
      [p('Alineación', '0 o 1 izquierda, 2 centro, 3 derecha')]),
    },
    QRCODE: {
      title: 'QR Code', description: 'Dibuja un código QR.',
      layout: args => {
        const out = [X, Y, p('Corrección de errores', 'L baja, M media, Q alta, H máxima'), p('Tamaño de celda', 'Puntos por módulo (1 a 10)'), p('Modo', 'A automático, M manual'), ROTATION];
        for (let i = 6; i < args.length - 1; i++) out.push(qrOption(args[i].text));
        out.push(CONTENT);
        return out;
      },
    },
    DMATRIX: {
      title: 'Data Matrix', description: 'Dibuja un código Data Matrix.',
      layout: args => {
        const head = [X, Y, p('Ancho', 'Ancho del símbolo en puntos'), p('Alto', 'Alto del símbolo en puntos')];
        return args.length >= 8 ? [...head, p('Multiplicador', 'Tamaño del módulo'), p('Filas', 'Filas (0 automático)'), p('Columnas', 'Columnas (0 automático)'), p('Expresión', 'Los datos, entre comillas')] : [...head, p('Expresión', 'Los datos, entre comillas')];
      },
    },
    BAR: { title: 'Barra', description: 'Dibuja un rectángulo relleno (una línea gruesa).', layout: () => [X, Y, p('Ancho', 'Ancho en puntos'), p('Alto', 'Alto en puntos')] },
    BOX: { title: 'Caja', description: 'Dibuja el borde de un rectángulo entre dos esquinas.', layout: () => [X, Y, p('X final', 'Esquina opuesta en puntos'), p('Y final', 'Esquina opuesta en puntos'), p('Grosor', 'Grosor del borde en puntos'), p('Radio', 'Esquinas redondeadas en puntos (opcional)')] },
    ELLIPSE: { title: 'Elipse', description: 'Dibuja una elipse (no figura en el manual B-442 / B-443).', layout: () => [X, Y, p('Ancho', 'Ancho en puntos'), p('Alto', 'Alto en puntos'), p('Grosor', 'Grosor del borde en puntos')] },
    CIRCLE: { title: 'Círculo', description: 'Dibuja un círculo (no figura en el manual B-442 / B-443).', layout: () => [X, Y, p('Diámetro', 'Diámetro en puntos'), p('Grosor', 'Grosor del borde en puntos')] },
    REVERSE: { title: 'Área invertida', description: 'Invierte el color de un rectángulo de lo ya dibujado.', layout: () => [X, Y, p('Ancho', 'Ancho en puntos'), p('Alto', 'Alto en puntos')] },
    ERASE: { title: 'Área borrada', description: 'Borra un rectángulo de lo ya dibujado.', layout: () => [X, Y, p('Ancho', 'Ancho en puntos'), p('Alto', 'Alto en puntos')] },
    BITMAP: { title: 'Imagen de mapa de bits', description: 'Dibuja una imagen de puntos con los bytes que lleva a continuación.', layout: () => [X, Y, p('Ancho en bytes', 'Bytes por fila (1 a 1250)'), p('Alto', 'Filas de la imagen en puntos (1 a 9999)'), p('Modo', '0 sobrescribe, 1 OR, 2 XOR')] },
    PUTBMP: { title: 'Imagen BMP guardada', description: 'Dibuja un archivo BMP de la impresora (el visor no lo dibuja).', layout: () => [X, Y, p('Archivo', 'Nombre del archivo entre comillas')] },
    PUTPCX: { title: 'Imagen PCX guardada', description: 'Dibuja un archivo PCX de la impresora (el visor no lo dibuja).', layout: () => [X, Y, p('Archivo', 'Nombre del archivo entre comillas')] },
    PUTPNG: { title: 'Imagen PNG guardada', description: 'Dibuja un archivo PNG de la impresora (el visor no lo dibuja).', layout: () => [X, Y, p('Archivo', 'Nombre del archivo entre comillas')] },
    'SET COUNTER': { title: 'Contador', description: 'Define el paso de un contador que cambia en cada etiqueta.', layout: () => [p('Subcomando', 'COUNTER'), p('Contador', '@0 a @49'), p('Paso', 'Entero que suma en cada etiqueta (hasta ±999999999)')] },
    '@': { title: 'Valor inicial del contador', description: 'Da el valor de partida del contador entre comillas.', layout: () => [p('Valor inicial', 'Texto entre comillas; su parte numérica final es la que cambia')] },
  });

  /** The key of the command in TABLE and its tokens [{ text, start, end }] (absolute offsets), or null for an unusable line. */
  function parse(text, cmd) {
    const line = text.slice(cmd.start, cmd.end);
    if (/^@\d+\s*=/.test(cmd.name)) {
      const equal = cmd.start + line.indexOf('=') + 1;
      return { key: '@', id: cmd.name.replace(/=.*/, ''), nameEnd: equal, tokens: [{ text: text.slice(equal, cmd.end).trim(), start: equal, end: cmd.end }] };
    }
    if (cmd.name === 'SET' && /^SET\s+COUNTER\b/i.test(line)) {
      const tokens = [];
      for (const m of line.matchAll(/\S+/g)) if (tokens.length || m[0].toUpperCase() === 'SET') tokens.push({ text: m[0], start: cmd.start + m.index, end: cmd.start + m.index + m[0].length });
      return { key: 'SET COUNTER', id: 'SET COUNTER', nameEnd: tokens[0].end, tokens: tokens.slice(1) };
    }
    return { key: cmd.name, id: cmd.name, nameEnd: cmd.start + cmd.name.length, tokens: cmd.args.map(a => ({ text: a.raw, start: a.start, end: a.end })) };
  }

  /** The help of one command; offset: caret position in the text, or null for no current parameter. */
  function describe(text, cmd, offset) {
    const parts = parse(text, cmd);
    const entry = TABLE[parts.key];
    const info = { id: parts.id, known: Boolean(entry), title: entry ? entry.title : '', description: entry ? entry.description : '', params: [], extra: null };
    if (!entry) return info;
    const labels = entry.layout(parts.tokens);
    let current = -1;
    if (offset !== null && offset > parts.nameEnd && parts.tokens.length) {
      current = parts.tokens.findIndex(t => offset <= t.end);
      if (current < 0) current = parts.tokens.length - 1;
    }
    info.params = labels.map((label, i) => ({ ...label, value: parts.tokens[i] ? parts.tokens[i].text.trim() : '', current: i === current }));
    if (parts.tokens.length > labels.length) info.extra = parts.tokens.slice(labels.length).map(t => t.text).join(',');
    return info;
  }

  /** What the caret is on in the TSPL text, or null when it is in no command. offset: caret position in the text. */
  function at(text, offset) {
    let found = null;
    for (const cmd of PB.tspl.commands(text)) {
      if (cmd.start <= offset && offset < cmd.end) { found = cmd; break; }
      if (offset === cmd.end && cmd.end === text.length) found = cmd;
    }
    return found ? describe(text, found, offset) : null;
  }

  /** The help of every command that overlaps the span [start, end) (an object selected in the preview), in order, with no current parameter. */
  function range(text, start, end) {
    const out = [];
    for (const cmd of PB.tspl.commands(text)) if (cmd.end > start && cmd.start < end) out.push(describe(text, cmd, null));
    return out;
  }

  PB.tsplHelp = Object.freeze({ at, range, TABLE });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
