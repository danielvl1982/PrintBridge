/**
 * Box slice, TPCL language: the build template and the emitter (shared with the line). A box is an LC command with the rectangle flag, so parsing,
 * moving and editing belong to the line slice (js/components/line/tpcl.js), which handles both.
 * Must load after the line slice files.
 */
(function (PB) {
  'use strict';

  PB.slices = PB.slices || {};
  PB.slices.box = PB.slices.box || {};

  const { buildLC, emitLC } = PB.slices.line;

  /** Box size in 0.1 mm: [width, height]. */
  const SIZE = Object.freeze([300, 200]);

  PB.slices.box.tpcl = helpers => ({
    build: (text, point) => buildLC(helpers, text, point, SIZE, true),
    // The LC command of a rectangle (same emitter as the line: the rect flag decides)
    emit: emitLC(helpers),
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
