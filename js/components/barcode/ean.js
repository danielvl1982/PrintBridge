/**
 * Barcode slice: EAN-13, EAN-8, UPC-A and UPC-E encoders with the EAN-2 / EAN-5 add-ons (the "WPC" types of TPCL), published as PB.ean.
 * Pure functions, no DOM. encode(symbology, data, { check, addon }) returns
 *   { ok, symbology, addon, pattern, addonPattern, width, addonOffset, totalWidth, text, addonText, bars, addonBars, digits, warnings }
 *   - pattern / addonPattern: the symbol and the add-on as a string of modules ("1" = bar, "0" = space); '' when not drawn.
 *   - width: modules of the symbol (EAN-13 and UPC-A 95, EAN-8 67, UPC-E 51), no quiet zones; addonOffset: where the add-on starts
 *     (width + ADDON_GAP); totalWidth: width, plus the gap and the add-on when there is one.
 *   - text: the digits of the symbol as printed (check digit attached); addonText: the add-on digits.
 *   - bars / addonBars: runs of bars as { x, w, guard } in modules from the origin of the symbol (guard: part of a start, centre or
 *     end guard, which are drawn longer when the digits are printed). addonBars x is relative to the same origin.
 *   - digits: { char, x, zone } with x = the centre of each printed digit in modules ('main' | 'addon'); the digits outside the bars
 *     (the first digit of the EAN-13, the number system and check digit of UPC-A / UPC-E) have x < 0 or x > width.
 *   - warnings: Spanish messages. When the data cannot be encoded ok is false and nothing is drawn.
 * check (neutral, each language maps its option): 'auto' (the default) | 'check' | 'none' | 'unsupported'. Data of the length without
 * the check digit always gets it (computed, modulus 10; with 'check' and 'none' that is reported); data with it is validated (with
 * 'auto' and 'check'; a mismatch is reported and the digits are drawn as given); 'none' takes the data as it is. 'unsupported' (a
 * language option the viewer does not know, e.g. the TPCL price check digits) is drawn as automatic and reported.
 * The data of a symbol with an add-on is the base digits followed by the add-on digits (an assumption: neither manual documents
 * how the printer takes the add-on).
 */
(function (PB) {
  'use strict';

  const { UNSUPPORTED_CHECK } = PB.slices.barcode;

  /** Left-hand odd parity (L), left-hand even parity (G) and right-hand (R) digit patterns; G is R reversed, R is L inverted. */
  const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R_CODES = L_CODES.map(p => [...p].map(bit => (bit === '1' ? '0' : '1')).join(''));
  const G_CODES = R_CODES.map(p => [...p].reverse().join(''));
  const CODES = { L: L_CODES, G: G_CODES, R: R_CODES };

  /** EAN-13: parity (L / G) of the six left digits chosen by the first digit. */
  const EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  /** UPC-E number system 0: parity of the six digits chosen by the check digit (E = G, O = L); number system 1 is the inverse. */
  const UPCE_PARITY = ['GGGLLL', 'GGLGLL', 'GGLLGL', 'GGLLLG', 'GLGGLL', 'GLLGGL', 'GLLLGG', 'GLGLGL', 'GLGLLG', 'GLLGLG'];
  /** EAN-5 add-on: parity of the five digits chosen by the checksum; EAN-2: by the value modulo 4. */
  const ADDON5_PARITY = ['GGLLL', 'GLGLL', 'GLLGL', 'GLLLG', 'LGGLL', 'LLGGL', 'LLLGG', 'LGLGL', 'LGLLG', 'LLGLG'];
  const ADDON2_PARITY = ['LL', 'LG', 'GL', 'GG'];

  const START = '101';
  const CENTER = '01010';
  const END = '101';
  const UPCE_END = '010101';
  const ADDON_START = '1011';
  const ADDON_SEPARATOR = '01';
  /** Spaces between the symbol and its add-on, in modules (the standard allows 7 to 12). */
  const ADDON_GAP = 9;
  /** Centre of the digits printed outside the bars, in modules from the nearest end of the symbol. */
  const OUTSIDE = 5;

  const NAMES = Object.freeze({ ean13: 'EAN-13', ean8: 'EAN-8', upca: 'UPC-A', upce: 'UPC-E' });
  /** Digits without the check digit (one or more lengths) and with it. */
  const SPECS = Object.freeze({
    ean13: { bare: [12], full: 13 },
    ean8: { bare: [7], full: 8 },
    upca: { bare: [11], full: 12 },
    upce: { bare: [6, 7], full: 8 },
  });

  /** Modulus 10 check digit of the digits without it: the rightmost weighs 3, then 1, 3, 1... */
  function checkDigit(digits) {
    const sum = [...String(digits)].reverse().reduce((total, d, i) => total + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
    return String((10 - (sum % 10)) % 10);
  }

  /** The 11 digits of the UPC-A that a UPC-E (number system and its six digits) stands for. */
  function expand(ns, six) {
    const [d1, d2, d3, d4, d5, d6] = six;
    if ('012'.includes(d6)) return `${ns}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
    if (d6 === '3') return `${ns}${d1}${d2}${d3}00000${d4}${d5}`;
    if (d6 === '4') return `${ns}${d1}${d2}${d3}${d4}00000${d5}`;
    return `${ns}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }

  /** Splits the digits of a UPC-E (6, 7 or 8) into number system, six digits and the check digit given (undefined if absent). */
  function splitUpce(digits) {
    if (digits.length === 6) return { ns: '0', six: digits };
    return { ns: digits[0], six: digits.slice(1, 7), given: digits[7] };
  }

  /** UPC-A (12 digits, the check digit computed) equivalent of a UPC-E of 6, 7 or 8 digits. */
  function upceToUpca(digits) {
    const { ns, six } = splitUpce(String(digits));
    const base = expand(ns, six);
    return base + checkDigit(base);
  }

  /** EAN-5 add-on checksum: 3 x (digits 1, 3, 5) + 9 x (digits 2, 4), modulo 10. */
  function addonChecksum(digits) {
    const d = [...String(digits)].map(Number);
    return (3 * (d[0] + d[2] + d[4]) + 9 * (d[1] + d[3])) % 10;
  }

  const cells = (digits, parity) => [...digits].map((d, i) => CODES[parity[i]][d]);
  const flip = parity => [...parity].map(p => (p === 'G' ? 'L' : 'G')).join('');

  function addonPatternOf(digits) {
    const parity = digits.length === 2 ? ADDON2_PARITY[Number(digits) % 4] : ADDON5_PARITY[addonChecksum(digits)];
    return ADDON_START + cells(digits, parity).join(ADDON_SEPARATOR);
  }

  /** Runs of bars of a pattern as { x, w, guard }; `guards` are [from, to) module ranges where a bar starting is a guard bar. */
  function barsOf(pattern, guards = [], offset = 0) {
    return [...pattern.matchAll(/1+/g)].map(m => ({
      x: offset + m.index, w: m[0].length, guard: guards.some(([from, to]) => m.index >= from && m.index < to),
    }));
  }

  const fail = (symbology, addon, warnings) => ({
    ok: false, symbology, addon, pattern: '', addonPattern: '', width: 0, addonOffset: 0, totalWidth: 0, text: '', addonText: '', bars: [], addonBars: [], digits: [], warnings,
  });

  /** Number phrase of the lengths a symbology takes, e.g. "12 dígitos (13 con dígito de control)". */
  function expected(spec) {
    const bare = spec.bare.length > 1 ? `${spec.bare.slice(0, -1).join(', ')} o ${spec.bare.at(-1)}` : String(spec.bare[0]);
    return `${bare} dígitos (${spec.full} con dígito de control)`;
  }

  function encode(symbology, data, { check = 'auto', addon = 0 } = {}) {
    const name = NAMES[symbology];
    const spec = SPECS[symbology];
    const addonDigits = addon === 2 || addon === 5 ? addon : 0;
    const raw = String(data ?? '');
    if (!spec) return fail(symbology, addonDigits, [`${symbology}: no es un código EAN / UPC, no se dibuja`]);
    if (!/^\d*$/.test(raw)) return fail(symbology, addonDigits, [`${name}: solo admite dígitos, no se dibuja`]);

    // Base digits and add-on digits: the add-on takes the last 2 or 5 digits when the rest is a length of the symbology
    const lengths = [...spec.bare, spec.full];
    let base = raw;
    let addonText = '';
    const warnings = [];
    if (addonDigits && lengths.includes(raw.length - addonDigits)) {
      base = raw.slice(0, raw.length - addonDigits);
      addonText = raw.slice(raw.length - addonDigits);
    } else if (addonDigits && lengths.includes(raw.length)) {
      warnings.push(`${name}: falta el complemento de ${addonDigits} dígitos, se dibuja sin él`);
    }
    if (!lengths.includes(base.length)) {
      return fail(symbology, addonDigits, [`${name}: se esperaban ${expected(spec)}${addonDigits ? ` más ${addonDigits} del complemento` : ''} y hay ${raw.length}, no se dibuja`]);
    }
    if (check === 'unsupported') warnings.push(`${name}: ${UNSUPPORTED_CHECK}`);

    // UPC-E: number system, six digits and the check digit, which comes from the equivalent UPC-A
    let ns = '';
    let digits = base;
    let computed;
    let given;
    if (symbology === 'upce') {
      ({ ns } = splitUpce(base));
      if (ns !== '0' && ns !== '1') return fail(symbology, addonDigits, [`${name}: el sistema numérico debe ser 0 o 1, no se dibuja`]);
      const six = splitUpce(base).six;
      computed = checkDigit(expand(ns, six));
      given = splitUpce(base).given;
      digits = ns + six + (given ?? computed);
    } else {
      computed = checkDigit(base.slice(0, spec.full - 1));
      given = base.length === spec.full ? base[spec.full - 1] : undefined;
      digits = given === undefined ? base + computed : base;
    }
    if (given === undefined && (check === 'none' || check === 'check')) {
      warnings.push(`${name}: datos sin dígito de control con la opción "${check === 'none' ? 'sin dígito de control' : 'comprobar'}", el visor lo calcula para poder dibujar`);
    }
    if (given !== undefined && check !== 'none' && given !== computed) {
      warnings.push(`${name}: el dígito de control ${given} no coincide con el calculado (${computed})`);
    }

    return layout(symbology, digits, addonText, addonDigits, warnings);
  }

  /** Pattern, bars and digit positions of a symbol from its final digits. */
  function layout(symbology, digits, addonText, addon, warnings) {
    let pattern;
    let guards;
    const printed = [];
    const at = (char, x) => printed.push({ char, x, zone: 'main' });
    if (symbology === 'ean8') {
      pattern = START + cells(digits.slice(0, 4), 'LLLL').join('') + CENTER + cells(digits.slice(4), 'RRRR').join('') + END;
      guards = [[0, 3], [31, 36], [64, 67]];
      [...digits].forEach((d, i) => at(d, (i < 4 ? 3 + 7 * i : 36 + 7 * (i - 4)) + 3.5));
    } else if (symbology === 'upce') {
      const parity = UPCE_PARITY[Number(digits[7])];
      pattern = START + cells(digits.slice(1, 7), digits[0] === '1' ? flip(parity) : parity).join('') + UPCE_END;
      guards = [[0, 3], [45, 51]];
      at(digits[0], -OUTSIDE);
      [...digits.slice(1, 7)].forEach((d, i) => at(d, 3 + 7 * i + 3.5));
      at(digits[7], 51 + OUTSIDE);
    } else {
      // EAN-13, and UPC-A as an EAN-13 with a leading 0 (the pattern is the same)
      const ean13 = symbology === 'upca' ? '0' + digits : digits;
      pattern = START + cells(ean13.slice(1, 7), EAN13_PARITY[ean13[0]]).join('') + CENTER + cells(ean13.slice(7), 'RRRRRR').join('') + END;
      guards = [[0, 3], [45, 50], [92, 95]];
      if (symbology === 'ean13') {
        at(digits[0], -OUTSIDE);
        [...digits.slice(1, 7)].forEach((d, i) => at(d, 3 + 7 * i + 3.5));
        [...digits.slice(7)].forEach((d, i) => at(d, 50 + 7 * i + 3.5));
      } else {
        at(digits[0], -OUTSIDE);
        [...digits.slice(1, 6)].forEach((d, i) => at(d, 3 + 7 * (i + 1) + 3.5));
        [...digits.slice(6, 11)].forEach((d, i) => at(d, 50 + 7 * i + 3.5));
        at(digits[11], 95 + OUTSIDE);
      }
    }
    const width = pattern.length;
    const addonPattern = addonText ? addonPatternOf(addonText) : '';
    const addonOffset = width + ADDON_GAP;
    [...addonText].forEach((d, i) => printed.push({ char: d, x: addonOffset + ADDON_START.length + 9 * i + 3.5, zone: 'addon' }));
    return {
      ok: true, symbology, addon, pattern, addonPattern, width, addonOffset, totalWidth: addonText ? addonOffset + addonPattern.length : width,
      text: digits, addonText, bars: barsOf(pattern, guards), addonBars: barsOf(addonPattern, [], addonOffset), digits: printed, warnings,
    };
  }

  PB.ean = Object.freeze({ NAMES, SPECS, ADDON_GAP, checkDigit, upceToUpca, addonChecksum, encode });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
