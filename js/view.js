/**
 * Preview rotation: only changes how the label looks, never the model or the code.
 * Pure computation (no DOM): maps points from label space (0.1 mm, origin at the top left)
 * to the rotated screen space and back. Angles are clockwise: 0, 90, 180 or 270.
 */
(function (PB) {
  'use strict';

  const ANGLES = Object.freeze([0, 90, 180, 270]);

  const normalize = angle => {
    const a = ((Number(angle) % 360) + 360) % 360;
    if (!ANGLES.includes(a)) throw new RangeError(`Invalid rotation: ${angle}`);
    return a;
  };

  /** Label (x, y) -> rotated view. width/height are those of the unrotated label. */
  function rotate([x, y], angle, width, height) {
    switch (normalize(angle)) {
      case 90: return [height - y, x];
      case 180: return [width - x, height - y];
      case 270: return [y, width - x];
      default: return [x, y];
    }
  }

  /** Rotated view (x, y) -> label. Inverse of rotate. */
  function inverse([x, y], angle, width, height) {
    switch (normalize(angle)) {
      case 90: return [y, height - x];
      case 180: return [width - x, height - y];
      case 270: return [width - y, x];
      default: return [x, y];
    }
  }

  /** Movement [dx, dy] in the rotated view -> movement in label space (the rotation without the translation). */
  function delta([dx, dy], angle) {
    return inverse([dx, dy], angle, 0, 0);
  }

  /** viewBox of the rotated SVG, with the pad margin around it: at 90 and 270 width and height are swapped. */
  function viewBoxFor(width, height, angle, pad) {
    const swap = normalize(angle) % 180 !== 0;
    return { x: -pad, y: -pad, width: (swap ? height : width) + 2 * pad, height: (swap ? width : height) + 2 * pad };
  }

  /** Value of the transform attribute that applies rotate to the whole drawing ('' if no rotation). */
  function transformFor(width, height, angle) {
    switch (normalize(angle)) {
      case 90: return `matrix(0 1 -1 0 ${height} 0)`;
      case 180: return `matrix(-1 0 0 -1 ${width} ${height})`;
      case 270: return `matrix(0 -1 1 0 0 ${width})`;
      default: return '';
    }
  }

  PB.viewRotation = Object.freeze({ ANGLES, rotate, inverse, delta, viewBoxFor, transformFor });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
