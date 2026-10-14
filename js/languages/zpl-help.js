/**
 * ZPL command help: what the caret is on in the code editor, as { id, title, description, params: [{ label, description, value, current }] }.
 * Pure (no DOM): the editor reports the caret offset and the Propiedades panel draws the result (js/properties.js, showCommandHelp).
 * Source: ZPL II Programming Guide, Volume One (2003) and Volume Two (2005), local copies in docs/zpl (never committed). The texts are short
 * summaries in Spanish (the UI language), not quotations; a command with no entry still gets its id with `known: false`.
 * Shape of TABLE: command name (upper case, without the prefix) -> { title, description, params: [{ label, description }] } in the order the
 * guide gives the parameters. Rules of the caret mapping (`at`):
 *   - the caret belongs to the command that contains it: start <= offset < end, or offset == end at the very end of the text, so
 *     "^FS|^FO" is on ^FO;
 *   - the parameter is the one between the commas around the caret (commas inside double quotes do not count); ^A has the font letter and the
 *     orientation glued to the name (^A0N,30,30): the first two characters after it are its first two parameters;
 *   - a command with no parameters (^FD data, ^FS, ^FX...) has none current; the data commands show the data as their only parameter;
 *   - an offset past the last parameter of the guide is reported as `extra` (the command was given more parameters than it has).
 * Exposed as PB.zplHelp = { at, TABLE }; the barcode rows are checked against PB.slices.barcode.zplTables by tests/zpl-help.test.js.
 */
(function (PB) {
  'use strict';

  const p = (label, description) => ({ label, description });

  // Parameters the barcode commands share
  const ORIENTATION = p('Orientación', 'N normal, R girado 90°, I invertido 180°, B girado 270°. Por defecto la de ^FW');
  const HEIGHT = p('Altura', 'Altura de las barras en puntos (1 a 32000). Por defecto la de ^BY');
  const LINE = p('Línea de interpretación', 'Y imprime el texto legible, N no (por defecto Y)');
  const ABOVE = p('Línea sobre el código', 'Y imprime el texto legible encima del código, N debajo (por defecto N)');
  const CHECK = (label, description) => p(label, description);
  const PRINT_CHECK = p('Imprimir dígito de control', 'Y imprime el dígito de control en la línea legible, N no');

  const barcode = (title, description, ...params) => ({ title, description, params });
  const XY = [p('Posición X', 'Distancia al borde izquierdo en puntos (0 a 32000)'), p('Posición Y', 'Distancia al borde superior en puntos (0 a 32000)')];
  const THICKNESS = p('Grosor', 'Grosor del borde en puntos; si es mayor que la mitad del lado la forma sale rellena');
  const COLOR = p('Color', 'B negro (por defecto) o W blanco');
  const FILE = p('Nombre', 'Dispositivo, nombre y extensión, p. ej. R:FORMATO.ZPL');

  const TABLE = Object.freeze({
    XA: { title: 'Inicio de formato', description: 'Abre una etiqueta: todo lo que sigue hasta ^XZ es un formato.', params: [] },
    XZ: { title: 'Fin de formato', description: 'Cierra la etiqueta y la imprime.', params: [] },
    FO: { title: 'Origen del campo', description: 'Pone la esquina superior izquierda del campo respecto del origen de la etiqueta (^LH).', params: XY },
    FT: { title: 'Origen del campo (base)', description: 'Pone el campo por su línea de base: el texto o el código se asienta sobre esa coordenada.', params: XY },
    FD: { title: 'Datos del campo', description: 'Los datos que imprime el campo: texto, o el contenido del código de barras.', params: [p('Datos', 'Hasta el siguiente ^FS. Con ^FH admite caracteres escapados en hexadecimal')] },
    FV: { title: 'Datos variables', description: 'Como ^FD, pero para campos que cambian en cada etiqueta de un formato guardado.', params: [p('Datos', 'Hasta el siguiente ^FS')] },
    FS: { title: 'Fin de campo', description: 'Cierra el campo abierto por ^FO o ^FT.', params: [] },
    FX: { title: 'Comentario', description: 'Texto que la impresora ignora.', params: [p('Comentario', 'Hasta el siguiente ^FS o comando')] },
    FR: { title: 'Campo inverso', description: 'Invierte el color del campo respecto de lo ya dibujado debajo (negro sobre blanco y al revés).', params: [] },
    FN: { title: 'Número de campo', description: 'Asigna un número al campo para llenarlo desde un formato guardado (^DF / ^XF).', params: [p('Número', 'Número de campo (1 a 9999); entre comillas, opcionalmente, el texto que pide la impresora')] },
    FW: { title: 'Orientación del campo', description: 'Orientación por defecto de los campos que siguen (texto y códigos de barras).', params: [p('Orientación', 'N normal, R 90°, I 180°, B 270°')] },
    FB: {
      title: 'Bloque de texto', description: 'Dibuja el campo como un bloque que se parte en líneas.',
      params: [
        p('Ancho', 'Ancho del bloque en puntos (0 a 32000)'), p('Líneas', 'Máximo de líneas (1 a 9999)'),
        p('Espacio entre líneas', 'Puntos añadidos entre líneas (-9999 a 9999)'), p('Justificación', 'L izquierda, C centro, R derecha, J justificado'),
        p('Sangría', 'Sangría de las líneas siguientes a la primera, en puntos (0 a 9999)'),
      ],
    },
    FH: { title: 'Carácter hexadecimal', description: 'Activa el escape hexadecimal en los datos del campo (_ + dos dígitos hex).', params: [p('Carácter indicador', 'Carácter que marca el escape (por defecto _)')] },
    FP: { title: 'Dirección del campo', description: 'Dirección en la que se escribe el texto del campo.', params: [p('Dirección', 'H horizontal, V vertical, R inversa'), p('Espacio entre caracteres', 'Puntos entre caracteres (0 a 9999)')] },
    FC: { title: 'Indicador de reloj', description: 'Marca de los campos que imprimen la fecha y la hora del reloj de la impresora.', params: [p('Primer indicador', 'Carácter (por defecto %)'), p('Segundo indicador', 'Carácter (por defecto %)'), p('Tercer indicador', 'Carácter (por defecto %)')] },
    FM: { title: 'Posiciones de campo múltiples', description: 'Posiciones en las que se repite un campo (usado con ^SF y códigos de barras).', params: [...XY] },
    A: {
      title: 'Fuente escalable / de mapa de bits', description: 'Elige la fuente, su orientación y su tamaño para el campo.',
      params: [
        p('Fuente', 'Letra A a Z o cifra 0 a 9 (0 es la fuente escalable por defecto)'), p('Orientación', 'N normal, R 90°, I 180°, B 270°'),
        p('Altura', 'Altura del carácter en puntos (10 a 32000)'), p('Ancho', 'Ancho del carácter en puntos (10 a 32000)'),
      ],
    },
    'A@': { title: 'Fuente descargada', description: 'Como ^A pero con una fuente guardada en la impresora.', params: [ORIENTATION, p('Altura', 'Altura del carácter en puntos'), p('Ancho', 'Ancho del carácter en puntos'), FILE] },
    CF: { title: 'Fuente por defecto', description: 'Fuente y tamaño de los campos de texto sin ^A.', params: [p('Fuente', 'Letra A a Z o cifra 0 a 9'), p('Altura', 'Altura en puntos (0 a 32000)'), p('Ancho', 'Ancho en puntos (0 a 32000)')] },
    CI: { title: 'Juego de caracteres', description: 'Tabla de caracteres con la que se interpretan los datos.', params: [p('Tabla', 'Número de la tabla (0 a 36; 28 es Unicode UTF-8, 13 la tabla 850 por defecto)')] },
    CC: { title: 'Carácter de comando', description: 'Cambia el carácter que inicia los comandos (por defecto ^).', params: [p('Carácter', 'El nuevo carácter')] },
    CD: { title: 'Carácter delimitador', description: 'Cambia el separador de parámetros (por defecto coma).', params: [p('Carácter', 'El nuevo carácter')] },
    CT: { title: 'Carácter de control', description: 'Cambia el carácter de los comandos de control (por defecto ~).', params: [p('Carácter', 'El nuevo carácter')] },
    CW: { title: 'Fuente por letra', description: 'Asigna una letra a una fuente guardada en la impresora.', params: [p('Letra', 'Letra A a Z o cifra 0 a 9'), FILE] },
    GB: {
      title: 'Caja', description: 'Dibuja una caja o una línea (una de sus medidas igual al grosor).',
      params: [p('Ancho', 'Ancho en puntos (1 a 32000)'), p('Alto', 'Alto en puntos (1 a 32000)'), THICKNESS, COLOR, p('Redondeo', 'Esquinas redondeadas, de 0 (rectas) a 8 (las más redondas)')],
    },
    GC: { title: 'Círculo', description: 'Dibuja un círculo.', params: [p('Diámetro', 'Diámetro en puntos (3 a 4095)'), THICKNESS, COLOR] },
    GD: { title: 'Línea diagonal', description: 'Dibuja una diagonal dentro de una caja de ese ancho y alto.', params: [p('Ancho', 'Ancho de la caja en puntos'), p('Alto', 'Alto de la caja en puntos'), THICKNESS, COLOR, p('Inclinación', 'R sube hacia la derecha, L hacia la izquierda')] },
    GE: { title: 'Elipse', description: 'Dibuja una elipse.', params: [p('Ancho', 'Ancho en puntos (3 a 4095)'), p('Alto', 'Alto en puntos (3 a 4095)'), THICKNESS, COLOR] },
    GF: {
      title: 'Campo gráfico', description: 'Dibuja un mapa de bits (1 = punto negro) con los datos que lleva dentro.',
      params: [p('Formato', 'A hexadecimal ASCII, B binario, C binario comprimido'), p('Bytes enviados', 'Cantidad de bytes de datos'), p('Bytes totales', 'Bytes de la imagen completa'), p('Bytes por fila', 'Bytes de cada fila de la imagen'), p('Datos', 'Los datos de la imagen')],
    },
    GS: { title: 'Símbolo gráfico', description: 'Dibuja un símbolo de la fuente de símbolos de la impresora (marca registrada, copyright…).', params: [ORIENTATION, p('Altura', 'Altura en puntos'), p('Ancho', 'Ancho en puntos')] },
    LR: { title: 'Inverso de la etiqueta', description: 'Invierte todos los campos que siguen, hasta otro ^LR.', params: [p('Inverso', 'Y activa, N desactiva (por defecto N)')] },
    SN: { title: 'Número de serie', description: 'Campo cuyo número aumenta en cada etiqueta que se imprime.', params: [p('Valor inicial', 'El número de partida; la parte numérica del final es la que aumenta'), p('Incremento', 'Cuánto suma en cada etiqueta (por defecto 1; admite negativo)'), p('Ceros a la izquierda', 'Y los imprime, N no (por defecto N)')] },
    SF: { title: 'Serialización con máscara', description: 'Serializa el campo con una máscara que dice cómo cuenta cada posición.', params: [p('Máscara', 'D y % para decimal (% no se imprime); A, H, O y N para otras bases'), p('Incremento', 'Cadena con el incremento de cada posición')] },
    BY: { title: 'Valores por defecto de códigos de barras', description: 'Módulo, relación y altura de los códigos de barras que siguen.', params: [p('Ancho del módulo', 'Puntos de la barra estrecha (1 a 10, por defecto 2)'), p('Relación', 'Ancha / estrecha: de 2.0 a 3.0 en pasos de 0.1 (por defecto 3.0)'), p('Altura', 'Altura por defecto de las barras en puntos (por defecto 10)')] },
    BC: barcode('Code 128', 'Código de barras Code 128.', ORIENTATION, HEIGHT, LINE, ABOVE, CHECK('Dígito de control UCC', 'Y añade el dígito de control UCC, N no'), p('Modo', 'N sin modo, U UCC, A automático, D UCC / EAN-128')),
    B3: barcode('Code 39', 'Código de barras Code 39.', ORIENTATION, CHECK('Control mod 43', 'Y calcula y añade el dígito de control mod 43, N no'), HEIGHT, LINE, ABOVE),
    B2: barcode('Interleaved 2 of 5', 'Código de barras 2 de 5 intercalado.', ORIENTATION, HEIGHT, LINE, ABOVE, CHECK('Control mod 10', 'Y calcula y añade el dígito de control mod 10, N no')),
    BE: barcode('EAN-13', 'Código de barras EAN-13.', ORIENTATION, HEIGHT, LINE, ABOVE),
    B8: barcode('EAN-8', 'Código de barras EAN-8.', ORIENTATION, HEIGHT, LINE, ABOVE),
    BU: barcode('UPC-A', 'Código de barras UPC-A.', ORIENTATION, HEIGHT, LINE, ABOVE, PRINT_CHECK),
    B9: barcode('UPC-E', 'Código de barras UPC-E.', ORIENTATION, HEIGHT, LINE, ABOVE, PRINT_CHECK),
    BA: barcode('Code 93', 'Código de barras Code 93.', ORIENTATION, HEIGHT, LINE, ABOVE, PRINT_CHECK),
    BK: barcode('Codabar', 'Código de barras Codabar (ANSI).', ORIENTATION, CHECK('Dígito de control', 'Solo N (fijo)'), HEIGHT, LINE, ABOVE, p('Carácter de inicio', 'A, B, C o D (por defecto A)'), p('Carácter de parada', 'A, B, C o D (por defecto A)')),
    BM: barcode('MSI', 'Código de barras MSI.', ORIENTATION, CHECK('Dígito de control', 'A ninguno, B mod 10, C dos mod 10, D mod 11 + mod 10 (por defecto B)'), HEIGHT, LINE, ABOVE, PRINT_CHECK),
    BI: barcode('Industrial 2 of 5', 'Código de barras 2 de 5 industrial.', ORIENTATION, HEIGHT, LINE, ABOVE),
    BJ: barcode('Standard 2 of 5', 'Código de barras 2 de 5 estándar.', ORIENTATION, HEIGHT, LINE, ABOVE),
    BQ: {
      title: 'QR Code', description: 'Código QR.',
      params: [p('Orientación', 'Siempre N'), p('Modelo', '1 original, 2 mejorado (por defecto 2)'), p('Ampliación', 'Puntos por módulo (1 a 10)'), p('Corrección de errores', 'H máxima, Q alta, M estándar, L baja'), p('Máscara', 'Máscara de datos 0 a 7 (por defecto, la que elige la impresora)')],
    },
    BX: {
      title: 'Data Matrix', description: 'Código Data Matrix.',
      params: [ORIENTATION, p('Alto del módulo', 'Puntos por módulo'), p('Calidad', '0, 50, 80, 100, 140 o 200 (200 es ECC 200)'), p('Columnas', 'Columnas a codificar'), p('Filas', 'Filas a codificar'), p('Formato', 'Formato de los datos 1 a 6'), p('Carácter de escape', 'Carácter de escape de los datos'), p('Proporción', '1 cuadrado, 2 rectangular')],
    },
    PW: { title: 'Ancho de impresión', description: 'Ancho de la etiqueta en puntos.', params: [p('Ancho', 'Puntos de ancho de la etiqueta')] },
    LL: { title: 'Largo de etiqueta', description: 'Largo de la etiqueta en puntos.', params: [p('Largo', 'Puntos de largo de la etiqueta (1 a 32000)')] },
    LH: { title: 'Origen de la etiqueta', description: 'Punto desde el que se miden todos los ^FO y ^FT.', params: XY },
    LS: { title: 'Desplazamiento a la izquierda', description: 'Mueve todos los campos hacia la izquierda.', params: [p('Puntos', '-9999 a 9999')] },
    LT: { title: 'Margen superior', description: 'Mueve todos los campos hacia arriba o abajo.', params: [p('Puntos', '-120 a 120')] },
    PO: { title: 'Orientación de impresión', description: 'Invierte toda la etiqueta.', params: [p('Orientación', 'N normal, I invertida 180°')] },
    PQ: {
      title: 'Cantidad de impresión', description: 'Cuántas etiquetas se imprimen.',
      params: [p('Cantidad', 'Total de etiquetas (1 a 99999999)'), p('Pausa y corte', 'Etiquetas entre pausas (0 = sin pausa)'), p('Réplicas', 'Copias de cada número de serie'), p('Sin pausa', 'Y imprime sin hacer las pausas'), p('Corte por error', 'Y corta aunque haya un error')],
    },
    PR: { title: 'Velocidad de impresión', description: 'Velocidad de impresión, de avance y de retroceso.', params: [p('Velocidad de impresión', 'En pulgadas por segundo'), p('Velocidad de avance', 'En pulgadas por segundo'), p('Velocidad de retroceso', 'En pulgadas por segundo')] },
    MD: { title: 'Oscuridad del medio', description: 'Ajusta la oscuridad de la impresión sobre el valor de la impresora.', params: [p('Ajuste', '-30 a 30')] },
    MM: { title: 'Modo de impresión', description: 'Cómo sale la etiqueta tras imprimirse.', params: [p('Modo', 'T arrancar, P despegar, R rebobinar, A aplicador, C cortar, D retraso, F RFID'), p('Prepelado', 'Y despega antes de imprimir la siguiente')] },
    MN: { title: 'Seguimiento del medio', description: 'Cómo detecta la impresora el principio de la etiqueta.', params: [p('Seguimiento', 'N continuo, Y huecos, W banda, M marca, A automático'), p('Desplazamiento', 'Puntos de la marca negra')] },
    MT: { title: 'Tipo de medio', description: 'Térmico directo o transferencia térmica.', params: [p('Tipo', 'T transferencia térmica, D térmico directo')] },
    DF: { title: 'Guardar formato', description: 'Guarda el formato que sigue (hasta ^XZ) con ese nombre.', params: [FILE] },
    XF: { title: 'Recuperar formato', description: 'Imprime el formato guardado con ese nombre.', params: [FILE] },
  });

  /** Characters of ^A glued to its name before the first comma: the font letter and, when there is one, the orientation (^A0N,30,30 -> 2). */
  const glueOf = region => (region[1] && region[1] !== ',' ? 2 : 1);

  /** Index in the parameters of the caret, from the text of the region after the command id and the caret position in it. */
  function parameterIndex(region, at, name) {
    let index = 0;
    let quoted = false;
    let from = 0;
    // ^A: the font letter and the orientation are glued to the name (^A0N,30,30)
    if (name === 'A') {
      const glued = glueOf(region);
      if (at === 0) return 0;
      if (at <= glued) return glued === 2 ? 1 : 0;
      from = glued;
      index = glued - 1;
    }
    for (let i = from; i < at && i < region.length; i++) {
      if (region[i] === '"') quoted = !quoted;
      else if (region[i] === ',' && !quoted) index++;
    }
    return index;
  }

  /** What the caret is on in the ZPL text, or null when it is in no command. offset: caret position in the text. */
  function at(text, offset) {
    let found = null;
    for (const cmd of PB.zpl.commands(text)) {
      if (cmd.start <= offset && offset < cmd.end) { found = cmd; break; }
      if (offset === cmd.end && cmd.end === text.length) found = cmd;
    }
    if (!found) return null;
    const entry = TABLE[found.name];
    const info = { id: found.id, known: Boolean(entry), title: entry ? entry.title : '', description: entry ? entry.description : '', params: [], extra: null };
    if (!entry) return info;
    const region = text.slice(found.start + found.id.length, found.end);
    const caret = Math.max(0, offset - (found.start + found.id.length));
    const split = [];
    // The text of each parameter, to show the value next to its label
    if (found.name === 'A') {
      const glued = glueOf(region);
      split.push(region.slice(0, 1), glued === 2 ? region[1] : '', ...region.slice(glued + (region[glued] === ',' ? 1 : 0)).split(','));
    } else if (found.data || found.name === 'CC' || found.name === 'CD' || found.name === 'CT') {
      split.push(region);
    } else {
      let part = '';
      let quoted = false;
      for (const c of region) {
        if (c === '"') quoted = !quoted;
        if (c === ',' && !quoted) { split.push(part); part = ''; } else part += c;
      }
      split.push(part);
    }
    const current = entry.params.length ? parameterIndex(region, caret, found.name) : -1;
    info.params = entry.params.map((param, i) => ({ ...param, value: (split[i] ?? '').trim(), current: i === current }));
    if (current >= entry.params.length) info.extra = split.slice(entry.params.length).join(',');
    return info;
  }

  PB.zplHelp = Object.freeze({ at, TABLE });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
