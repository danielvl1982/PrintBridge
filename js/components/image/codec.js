/**
 * Image slice: bitmap codec and preview overlay. Images the viewer overlays on the label (not part of any printer
 * language's code). Published as PB.images (public name kept). Loads after js/core.js (PB.units).
 */
(function (PB) {
  'use strict';

  const { units } = PB;

  /** Millimetres (number or text with a comma) -> tenths of mm, or null if empty or not a number. */
  const mmOrNull = mm => {
    const v = units.fromMm(mm);
    return Number.isFinite(v) ? v : null;
  };

  /** Number with 4 digits, as TPCL requires ("55" -> "0055"). */
  const pad4 = n => String(Math.max(0, Math.round(n))).padStart(4, '0');

  /** Nibble data: each char holds 4 dots, '0' (0x30) .. '?' (0x3F). */
  const NIBBLE_BASE = 0x30;

  /** Bytes per bitmap row: dots padded up to a multiple of 8. */
  const rowBytes = w => (w + 7) >> 3;

  /** Luminance (0-255) below which a pixel is black unless another threshold is given: 50 %. */
  const DEFAULT_THRESHOLD = 128;

  PB.images = Object.freeze({
    /**
     * Bitmap -> nibble data (TPCL SG): rows top to bottom, 4 dots per char with the leftmost dot in the highest bit,
     * rows padded to a multiple of 8 dots with white. Length = ((w+7)>>3) * h * 2.
     * bits: flat array of 0/1 (1 = black), row by row, length w * h.
     */
    bitmapToNibble(bits, w, h) {
      const perRow = rowBytes(w) * 2;
      let out = '';
      for (let y = 0; y < h; y++) {
        for (let c = 0; c < perRow; c++) {
          let v = 0;
          for (let k = 0; k < 4; k++) {
            const x = c * 4 + k;
            v = (v << 1) | (x < w && bits[y * w + x] ? 1 : 0);
          }
          out += String.fromCharCode(NIBBLE_BASE + v);
        }
      }
      return out;
    },

    /**
     * Nibble data -> flat Uint8Array of 0/1 (1 = black), w * h. Tolerant: missing or foreign chars count as white and
     * extra chars are ignored (the TPCL parser reports the length mismatch).
     */
    nibbleToBitmap(data, w, h) {
      const perRow = rowBytes(w) * 2;
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = data.charCodeAt(y * perRow + (x >> 2)) - NIBBLE_BASE;
          out[y * w + x] = v >= 0 && v <= 0xf && (v >> (3 - (x & 3))) & 1 ? 1 : 0;
        }
      }
      return out;
    },

    /**
     * TPCL SG command: {SG;xxxx,yyyy,wwww,hhhh,0,<nibble data>|}
     * xMm/yMm = position in mm (number or text with a comma; empty or invalid = 0), written in 0.1 mm;
     * w/h = size in printer dots; data = nibble data (e = 0, overwrite).
     * The format comes from the B-SX4T manual; it has NOT been verified on a B-EX4 or on a real printer.
     */
    buildSG({ xMm, yMm, w, h, data }) {
      const at = mm => mmOrNull(mm) ?? 0;
      return `{SG;${pad4(at(xMm))},${pad4(at(yMm))},${pad4(w)},${pad4(h)},0,${data}|}`;
    },

    /**
     * Size in printer dots an image is converted to: the width in mm at the resolution (without a valid positive width,
     * the natural pixels) and the height by aspect ratio. { naturalW, naturalH, widthMm, dpi } -> { w, h }, at least 1 dot.
     */
    targetDots({ naturalW, naturalH, widthMm, dpi }) {
      const widthUnits = mmOrNull(widthMm);
      const w = Math.max(1, widthUnits > 0 ? Math.round(widthUnits / units.dotSize(dpi)) : naturalW);
      return { w, h: Math.max(1, Math.round(w * naturalH / naturalW)) };
    },

    /**
     * Slider percent (0-100, number or text) -> luminance threshold 0-255, clamped; invalid = 50% (128, the default of
     * thresholdRGBA).
     */
    thresholdFromPercent(percent) {
      const p = parseFloat(percent);
      return Number.isFinite(p) ? Math.round(Math.min(100, Math.max(0, p)) * 255 / 100) : DEFAULT_THRESHOLD;
    },

    /**
     * Sizes to draw a picture through when shrinking it, so each canvas step averages about 2x2 pixels instead of
     * skipping most of them: the width is halved (rounded, at least 1) while the next size is still at least twice the
     * target width; the height follows the source aspect ratio. Always ends at the target. When the target is not
     * smaller than the source (or the source size is not valid) it is just [target]. -> [{ w, h }, ...]
     */
    downscaleSteps(srcW, srcH, dstW, dstH) {
      const target = { w: dstW, h: dstH };
      const steps = [];
      if (!(srcW >= 1 && srcH >= 1) || dstW >= srcW) return [target];
      for (let w = Math.max(1, Math.round(srcW / 2)); w >= 2 * dstW && w < srcW; w = Math.max(1, Math.round(w / 2))) {
        steps.push({ w, h: Math.max(1, Math.round(w * srcH / srcW)) });
      }
      return [...steps, target];
    },

    /**
     * RGBA pixels (canvas ImageData) -> flat Uint8Array of 0/1 (1 = black): alpha is composited over white and a pixel
     * is black when its luminance is below the threshold (0-255, clamped; default and invalid values = 128, i.e. 50%).
     */
    thresholdRGBA(rgba, w, h, threshold) {
      const limit = typeof threshold === 'number' && Number.isFinite(threshold) ? Math.min(255, Math.max(0, threshold)) : DEFAULT_THRESHOLD;
      const out = new Uint8Array(w * h);
      for (let i = 0; i < out.length; i++) {
        const a = rgba[i * 4 + 3] / 255;
        const channel = k => rgba[i * 4 + k] * a + 255 * (1 - a);
        out[i] = 0.299 * channel(0) + 0.587 * channel(1) + 0.114 * channel(2) < limit ? 1 : 0;
      }
      return out;
    },

    /**
     * `image` item that shows the converted dots (what "Insertar en el código" writes): same placement as makeItem, but
     * drawn from bitmap = { w, h, data } (flat 0/1) and sized in printer dots, as the parsed SG command will be.
     */
    makeBitmapItem({ href, xMm, yMm, dpi, ref }, bitmap) {
      const { href: _href, ...item } = PB.images.makeItem({ href, naturalW: bitmap.w, naturalH: bitmap.h, xMm, yMm, dpi, ref });
      return { ...item, width: Math.round(bitmap.w * units.dotSize(dpi)), height: Math.round(bitmap.h * units.dotSize(dpi)), bitmap };
    },

    /**
     * Neutral `image` item from a picture and its placement.
     * { href, naturalW, naturalH (pixels), xMm, yMm, widthMm (optional), dpi }
     * Without a valid positive widthMm the size is the natural pixels times the printer dot size; the height always
     * keeps the aspect ratio. Empty or invalid x/y count as 0.
     */
    makeItem({ href, naturalW, naturalH, xMm, yMm, widthMm, dpi, ref = 'IMG1' }) {
      const widthUnits = mmOrNull(widthMm);
      const width = widthUnits > 0 ? widthUnits : naturalW * units.dotSize(dpi);
      return {
        kind: 'image',
        ref,
        x: mmOrNull(xMm) ?? 0,
        y: mmOrNull(yMm) ?? 0,
        width: Math.round(width),
        height: Math.round(width * naturalH / naturalW),
        href,
        data: null,
      };
    },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
