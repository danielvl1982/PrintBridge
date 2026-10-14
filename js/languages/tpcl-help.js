/**
 * TPCL command help: what the caret is on in the code editor, in the same shape as the ZPL one (js/languages/zpl-help.js):
 * { id, known, title, description, params: [{ label, description, value, current }], extra }. Pure (no DOM); the editor reports the caret
 * and the help panel draws the result.
 * Source: the layouts the parser and the emitters of js/languages/tpcl.js and js/components/<kind>/tpcl.js handle, whose headers quote the TEC
 * guides (B-452-TS12 ES, B-SV4 and B-452-R specifications in docs/tpcl, local PDFs never committed). The texts are short summaries in Spanish.
 * A TPCL command is `{name nn;p1,p2,...|}`: the name (letters), an optional field number, a `;` and the parameters separated by commas; `D`
 * has no `;` (`{D0300,0250,0250|}`), `PC` / `PV` / `XB` may end with `=data` (the data is one parameter, commas included), `RC` / `RV` / `RB`
 * are the number and the data, and the data of `SG` is whatever follows its fifth comma.
 * Unlike ZPL the parameters are not a fixed list: an optional one changes what comes after it (the `±` spacing of PC / PV, the type of XB), so
 * each command has a layout function that labels the parameters actually written, in order. A caret in the name is on no parameter; a caret
 * past the last parameter is on the last. `extra` is null (a layout labels everything it finds).
 * Exposed as PB.tpclHelp = { at, range, TABLE }.
 */
(function (PB) {
  'use strict';

  const p = (label, description) => ({ label, description });

  const X = p('Posición X', 'Distancia al borde izquierdo en 0,1 mm (4 dígitos)');
  const Y = p('Posición Y', 'Distancia al borde superior en 0,1 mm (4 o 5 dígitos)');
  const FIELD = range => p('Número de campo', `Número que une este comando con su dato (RC / RV / RB), ${range}`);
  const ROTATION_TEXT = p('Rotación', '00 normal, 11 girado 90°, 22 invertido 180°, 33 girado 270° (sentido horario)');
  const ROTATION_CODE = p('Rotación', '0 normal, 1 girado 90°, 2 invertido 180°, 3 girado 270° (sentido horario)');
  const DATA = p('Datos', 'El texto o contenido del campo, hasta el final del comando');
  const SPACING = p('Espaciado entre caracteres', '± y dos o tres cifras: puntos que se añaden (positivo) o quitan (negativo) entre caracteres');
  const ATTRIBUTE = p('Atributo', 'B negro; Waabb invertido; Faabb con marco; Caa tachado (aa y bb: desplazamientos en puntos, 01 a 99)');

  /** Optional tail of PC / PV after the attribute, one parameter each, by what it starts with. */
  function tailLabel(text) {
    if (/^J\d/.test(text)) return p('Negrita', 'Jkkll: repeticiones del carácter en horizontal (kk) y vertical (ll), 00 a 16');
    if (/^M\d/.test(text)) return p('Dígito de control', 'M0 a M2: dígito de control del contador');
    if (/^[+-]\d{10}$/.test(text)) return p('Incremento', '± y diez cifras: lo que suma el contador en cada etiqueta');
    if (/^Z\d/.test(text)) return p('Supresión de ceros', 'Zpp: cuántos ceros a la izquierda se suprimen (00 a 20)');
    if (/^P5/.test(text)) return p('Bloque de texto', 'P5aaaabbbcc: ancho (aaaa, 0,1 mm), interlineado (bbb) y número de líneas (cc); solo con fuente PC');
    if (/^P4/.test(text)) return p('Espaciado igual', 'P4aaaa: reparte el texto en ese ancho (0050 a 1057, 0,1 mm)');
    if (/^P[123]/.test(text)) return p('Alineación', 'P1 izquierda, P2 derecha, P3 centro');
    return p('Parámetro adicional', 'Opción que sigue al atributo');
  }

  /** Layout of the text commands: PC (bitmap font) and PV (outline font) after the field number. */
  function textLayout(kind, tokens) {
    const bitmap = kind === 'PC';
    const out = [
      FIELD(bitmap ? '000 a 199' : '00 a 99'), X, Y,
      bitmap ? p('Ampliación horizontal', '1 a 9, 05 a 09 (0,5 a 0,9), 10 y de 15 a 95 de 5 en 5') : p('Ancho del carácter', 'En 0,1 mm (0020 a 0850)'),
      bitmap ? p('Ampliación vertical', 'Los mismos valores que la horizontal') : p('Alto del carácter', 'En 0,1 mm (0020 a 0850)'),
      bitmap ? p('Fuente', 'Letra de la fuente de mapa de bits, A a T') : p('Fuente', 'Fuente vectorial: A, B o E a J'),
    ];
    let i = 6;
    if (tokens[i] && /^[+-]\d+$/.test(tokens[i].text)) out.push(SPACING), i++;
    out.push(ROTATION_TEXT, ATTRIBUTE);
    for (i += 2; i < tokens.length; i++) out.push(tokens[i].data ? DATA : tailLabel(tokens[i].text));
    return out;
  }

  /** Layout of XB: the third parameter (the type) says which family of symbol follows. */
  function barcodeLayout(tokens) {
    const type = (tokens[3] ? tokens[3].text : '').trim().toUpperCase();
    const head = [FIELD('00 a 31'), X, Y, p('Tipo de código', 'Qué símbolo es: 1 MSI, 2 ITF, 3 / B Code 39, 4 NW7, O 2 de 5 industrial, 9 / A Code 128, C Code 93, 5 / 7 / 8 EAN-13, 0 / I / J EAN-8, K / L / M UPC-A, 6 / G / H UPC-E, T QR, Q Data Matrix')];
    const check = p('Dígito de control', '1 ninguno, 2 comprobar, 3 a 5 añadir (según el tipo)');
    let rest;
    if (type === 'T') {
      rest = [p('Corrección de errores', 'L baja, M media, Q alta, H máxima'), p('Tamaño del módulo', 'Puntos por módulo (00 a 52)'), p('Modo de datos', 'M manual, A automático'), ROTATION_CODE,
        p('Modelo', 'M1 o M2'), p('Máscara', 'K0 a K8'), p('Conexión', 'Jkkllmm: unión de varios símbolos')];
    } else if (type === 'Q') {
      rest = [p('Tipo ECC', '20 es ECC 200; 00 a 14 los ignora la impresora'), p('Ancho de celda', 'Puntos por celda (00 a 99; 00 no se dibuja)'), p('Formato', 'Identificador de formato (00 a 06, 11 a 16): sin función'), ROTATION_CODE,
        p('Número de celdas', 'Ciiijjj: celdas en X e Y, pares (000 automático)'), p('Conexión', 'Jkkllmmmnnn: unión de varios símbolos')];
    } else if (['1', '2', '3', '4', 'B', 'O'].includes(type)) {
      rest = [check, p('Barra estrecha', 'Puntos (01 a 99)'), p('Espacio estrecho', 'Puntos (01 a 99)'), p('Barra ancha', 'Puntos (01 a 99)'), p('Espacio ancho', 'Puntos (01 a 99)'),
        p('Espacio entre caracteres', 'Puntos (00 a 99)'), ROTATION_CODE, p('Altura', 'Altura de las barras en 0,1 mm (0000 a 1000)')];
    } else {
      rest = [check, p('Módulo', 'Puntos del módulo (01 a 15)'), ROTATION_CODE, p('Altura', 'Altura de las barras en 0,1 mm (0000 a 1000)'), p('Incremento', 'Lo que suma el contador, o 0'),
        p('Barra de guarda', 'Largo de la barra de guarda en 0,1 mm (000 sin guarda)'), p('Texto legible', '1 imprime los dígitos bajo las barras, 0 no'), p('Supresión de ceros', 'Dos cifras')];
    }
    const out = [...head, ...rest];
    // What the family does not list (the tail after the height: increment, readable text, zero suppression, start / stop) is labelled by what it looks like
    const known = out.length;
    const labelled = out.slice(0, tokens.length);
    for (let i = known; i < tokens.length; i++) {
      const text = tokens[i].text.trim();
      if (tokens[i].data) labelled.push(DATA);
      else if (/^[+-]\d+$/.test(text)) labelled.push(p('Incremento', '± y cifras: lo que suma el contador en cada etiqueta'));
      else if (/^[TPN]$/.test(text)) labelled.push(p('Inicio / parada', 'T solo inicio, P solo parada, N ninguno'));
      else labelled.push(p('Parámetro adicional', 'Opción final del comando'));
    }
    return labelled;
  }

  const TABLE = Object.freeze({
    D: {
      title: 'Tamaño de etiqueta', description: 'Define el paso, el ancho y el largo de la etiqueta.',
      layout: () => [p('Paso', 'Distancia entre el inicio de una etiqueta y el de la siguiente, en 0,1 mm (0100 a 9999)'), p('Ancho', 'Ancho de la etiqueta en 0,1 mm (0100 a 1080)'), p('Largo', 'Largo de la etiqueta en 0,1 mm (0060 a 9970; el paso no puede ser menor)')],
    },
    AX: {
      title: 'Ajuste fino de posición', description: 'Corrige la posición de alimentación, corte y retroceso de la impresora.',
      layout: () => [p('Avance', '± y tres cifras en 0,1 mm (000 a 500)'), p('Corte', '± y tres cifras en 0,1 mm (000 a 500)'), p('Retroceso', '± y dos cifras en 0,1 mm (00 a 99)'), p('Corrección de largo', '± y tres cifras en 0,1 % (000 a 100), opcional')],
    },
    XS: {
      title: 'Orden de impresión', description: 'Imprime lo dibujado. Lleva la cantidad y las opciones de corte, sensor, modo, velocidad y cinta.',
      layout: () => [p('Tipo', 'I: emisión por etiquetas'), p('Cantidad', 'Número de etiquetas (0001 a 9999)'), p('Opciones', 'bbbcdefgh: intervalo de corte (bbb, 000 a 100), sensor (c, 0 a 5), modo (d: C corte, D, E), velocidad (e, 1 a 9 o A), cinta (f, 0 a 2), rotación (g, 0 a 3), respuesta de estado (h, 0 o 1)')],
    },
    C: { title: 'Borrar memoria de imagen', description: 'Limpia la memoria de imagen antes de dibujar la etiqueta.', layout: () => [] },
    XQ: { title: 'Comando de control', description: 'Comando de control sin parámetros.', layout: () => [] },
    PC: { title: 'Texto con fuente de mapa de bits', description: 'Dibuja un texto con una fuente de mapa de bits de la impresora; el dato puede ir al final (=texto) o en un RC.', layout: tokens => textLayout('PC', tokens) },
    PV: { title: 'Texto con fuente vectorial', description: 'Dibuja un texto con una fuente vectorial; el dato puede ir al final (=texto) o en un RV.', layout: tokens => textLayout('PV', tokens) },
    XB: { title: 'Código de barras o 2D', description: 'Dibuja un código de barras, QR o Data Matrix; el dato puede ir al final (=datos) o en un RB.', layout: barcodeLayout },
    RC: { title: 'Datos de un texto PC', description: 'El texto del comando PC con el mismo número de campo.', layout: () => [FIELD('el del PC'), DATA] },
    RV: { title: 'Datos de un texto PV', description: 'El texto del comando PV con el mismo número de campo.', layout: () => [FIELD('el del PV'), DATA] },
    RB: { title: 'Datos de un código', description: 'Los datos del comando XB con el mismo número de campo (hasta 255 caracteres; 2000 en QR y Data Matrix).', layout: () => [FIELD('el del XB'), DATA] },
    LC: {
      title: 'Línea o rectángulo', description: 'Dibuja una línea o un rectángulo entre dos puntos.',
      layout: () => [p('X inicial', 'En 0,1 mm (4 dígitos)'), p('Y inicial', 'En 0,1 mm (4 o 5 dígitos)'), p('X final', 'En 0,1 mm (4 dígitos)'), p('Y final', 'En 0,1 mm (4 o 5 dígitos)'),
        p('Tipo', '0 línea, 1 rectángulo (2 y 3: discontinuos)'), p('Grosor', 'Puntos (1 a 99)'), p('Radio', 'ggg: esquinas redondeadas del rectángulo, en 0,1 mm (opcional)')],
    },
    XR: {
      title: 'Área: borrar o invertir', description: 'Aplica una operación a un rectángulo de lo ya dibujado.',
      layout: () => [p('X de una esquina', 'En 0,1 mm (4 dígitos)'), p('Y de una esquina', 'En 0,1 mm (4 o 5 dígitos)'), p('X de la opuesta', 'En 0,1 mm (4 dígitos)'), p('Y de la opuesta', 'En 0,1 mm (4 o 5 dígitos)'),
        p('Operación', 'A borra el área, B la invierte')],
    },
    SG: {
      title: 'Imagen gráfica', description: 'Dibuja una imagen de puntos con los datos que lleva dentro.',
      layout: () => [p('Posición X', 'En 0,1 mm; con D al final, en puntos'), p('Posición Y', 'En 0,1 mm; con D al final, en puntos'), p('Ancho', 'Ancho de la imagen (4 dígitos)'), p('Alto', 'Alto de la imagen (4 o 5 dígitos)'),
        p('Modo', '0 a 7 (el visor dibuja el 0 y el 4)'), DATA],
    },
  });

  const NUMBERED = new Set(['PC', 'PV', 'XB', 'RC', 'RV', 'RB']);
  const DATA_ONLY = new Set(['RC', 'RV', 'RB']);

  /** Splits the body of a command ({ and |} excluded) into its name and the tokens [{ text, start, end, data }] (offsets inside the body). */
  function split(body) {
    const m = /^([A-Z]+)(\d*)(;?)/.exec(body);
    if (!m) return null;
    const name = m[1];
    const tokens = [];
    const add = (start, end, data = false) => tokens.push({ text: body.slice(start, end).replace(/[\r\n]/g, ''), start, end, data });
    let at = name === 'D' ? name.length : m[0].length;
    if (NUMBERED.has(name)) {
      add(name.length, name.length + m[2].length);
      at = m[0].length;
    }
    if (at > body.length) return { name, tokens };
    if (DATA_ONLY.has(name)) {
      if (body.length > at || m[3]) add(at, body.length, true);
      return { name, tokens };
    }
    // Where the parameters end: the inline data (=) of PC / PV / XB
    let stop = body.length;
    const equal = NUMBERED.has(name) ? body.indexOf('=', at) : -1;
    if (equal >= 0) stop = equal;
    const cuts = [];
    for (let i = at; i < stop; i++) if (body[i] === ',') cuts.push(i);
    // SG: the data is whatever follows the fifth comma (it holds ; : and commas)
    const splitAt = name === 'SG' ? cuts.slice(0, 5) : cuts;
    let from = at;
    for (const cut of splitAt) { add(from, cut); from = cut + 1; }
    if (name === 'SG' && cuts.length >= 5) add(from, stop, true);
    else if (from < stop || splitAt.length) add(from, stop);
    if (equal >= 0) add(equal + 1, body.length, true);
    return { name, tokens };
  }

  /** The commands of the text with their absolute offsets (the same `{...|}` the TPCL parser walks). */
  function* commands(src) {
    const re = /\{([\s\S]*?)\|\}/g;
    let m;
    while ((m = re.exec(src))) yield { start: m.index, end: m.index + m[0].length, body: m[1] };
  }

  /** The help of one command; offset: caret position in the text, or null for no current parameter. */
  function describe(cmd, offset) {
    const parts = split(cmd.body);
    const name = parts ? parts.name : '';
    const entry = TABLE[name];
    const info = { id: name ? `{${name}` : '{', known: Boolean(entry), title: entry ? entry.title : '', description: entry ? entry.description : '', params: [], extra: null };
    if (!entry) return info;
    const labels = entry.layout(parts.tokens);
    const caret = offset === null ? -1 : offset - (cmd.start + 1);
    let current = -1;
    if (caret >= 0) {
      current = parts.tokens.findIndex(t => caret >= t.start && caret <= t.end);
      if (current < 0 && parts.tokens.length && caret > parts.tokens.at(-1).end) current = parts.tokens.length - 1;
    }
    info.params = labels.map((label, i) => ({ ...label, value: parts.tokens[i] ? parts.tokens[i].text.trim() : '', current: i === current }));
    // Parameters the layout has no label for (more written than the guide lists) are reported as extra
    if (parts.tokens.length > labels.length) info.extra = parts.tokens.slice(labels.length).map(t => t.text).join(',');
    return info;
  }

  /** What the caret is on in the TPCL text, or null when it is in no command. offset: caret position in the text. */
  function at(text, offset) {
    for (const cmd of commands(text)) if (cmd.start <= offset && offset < cmd.end) return describe(cmd, offset);
    return null;
  }

  /** The help of every command that overlaps the span [start, end) (an object selected in the preview), in order, with no current parameter. */
  function range(text, start, end) {
    const out = [];
    for (const cmd of commands(text)) if (cmd.end > start && cmd.start < end) out.push(describe(cmd, null));
    return out;
  }

  PB.tpclHelp = Object.freeze({ at, range, TABLE });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
