/**
 * Barcode slice: MSI (Plessey MSI) encoder (wide/narrow symbology), published as PB.msi.
 * encode(data, { check }) returns { elements, text, characters, warnings } like PB.code39 (see code39.js): elements are alternating
 * bars and spaces, starting with a bar, as { bar, wide }; if the data cannot be encoded, elements is [].
 * Digits only, 4 bits each (most significant first): bit 1 = wide bar + narrow space, bit 0 = narrow bar + wide space. The start
 * pattern is a 1 bit's wide bar + narrow space; the stop pattern is narrow bar + wide space + narrow bar. There is no space
 * between characters (the TPCL manual fixes that field to 00).
 * check (the options of the TPCL manual, field e): 'none'; 'check' (the data already ends with an IBM modulus 10 check digit that the
 * printer verifies: drawn as it is, warned when wrong); 'auto' = IBM modulus 10 attached; 'mod1010' = IBM modulus 10 twice;
 * 'mod1110' = IBM modulus 11 then IBM modulus 10; 'unsupported' draws like 'none' and reports it.
 */
(function (PB) {
  'use strict';

  const { UNSUPPORTED_CHECK } = PB.slices.barcode;

  const bar = wide => ({ bar: true, wide });
  const space = wide => ({ bar: false, wide });

  const sumDigits = n => [...String(n)].reduce((sum, d) => sum + Number(d), 0);

  /** IBM modulus 10 check digit: the digits at odd positions from the right (the last one first) form a number that is doubled; its digits plus the others are summed. */
  function mod10(data) {
    const digits = [...data].map(Number);
    const odd = digits.filter((d, i) => (digits.length - 1 - i) % 2 === 0).join('');
    const even = digits.filter((d, i) => (digits.length - 1 - i) % 2 === 1);
    const total = sumDigits(odd === '' ? 0 : BigInt(odd) * 2n) + even.reduce((a, b) => a + b, 0);
    return (10 - (total % 10)) % 10;
  }

  /** IBM modulus 11 check digit: weights 2..7 repeating from the right; 11 - remainder, with 10 and 11 written as 0 (not documented: reported by the caller). */
  function mod11(data) {
    const digits = [...data].map(Number);
    const total = digits.reduceRight((sum, d, i) => sum + d * (((digits.length - 1 - i) % 6) + 2), 0);
    return (11 - (total % 11)) % 11;
  }

  /** The check digits (a string, 0, 1 or 2 digits) each option attaches to the data; `ten` = modulus 11 gave 10 (written as 0). */
  function checkDigits(data, check) {
    if (check === 'auto') return { digits: String(mod10(data)), ten: false };
    if (check === 'mod1010') { const first = String(mod10(data)); return { digits: first + mod10(data + first), ten: false }; }
    if (check === 'mod1110') {
      const raw = mod11(data);
      const first = String(raw % 10);
      return { digits: first + mod10(data + first), ten: raw === 10 };
    }
    return { digits: '', ten: false };
  }

  function encodeMsi(data, { check = 'none' } = {}) {
    const text = String(data);
    if (!/^\d*$/.test(text)) return { elements: [], text, characters: 0, warnings: ['MSI: solo admite dígitos, no se dibuja'] };
    const warnings = check === 'unsupported' ? [`MSI: ${UNSUPPORTED_CHECK}`] : [];
    const attached = checkDigits(text, check);
    if (attached.ten) warnings.push('MSI: el módulo 11 da 10, que no es un dígito: se escribe 0 (comportamiento de la impresora no documentado)');
    if (check === 'check' && (text.length < 2 || mod10(text.slice(0, -1)) !== Number(text.at(-1)))) {
      warnings.push('MSI: el último dígito no es el dígito de control correcto (módulo 10 IBM), la impresora puede rechazar el dato');
    }
    const digits = text + attached.digits;
    const body = [...digits].flatMap(d => [...Number(d).toString(2).padStart(4, '0')].flatMap(b => (b === '1' ? [bar(true), space(false)] : [bar(false), space(true)])));
    return { elements: [bar(true), space(false), ...body, bar(false), space(true), bar(false)], text, characters: digits.length, warnings };
  }

  PB.msi = Object.freeze({ mod10, mod11, checkDigits, encode: encodeMsi });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
