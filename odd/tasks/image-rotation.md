# image-rotation

Branch: `feat/image-rotation`. Delivery strategy: ask-on-risk (default). Planning forecast: ~350 authored lines in 1 task.

## Objective
An inserted image keeps the orientation of the label: labels printed at 270 degrees (paper used sideways) need the picture rotated, and today
the image is always inserted at 0 degrees. Text and barcodes already take the current view rotation (item rotation = (360 - Giro) % 360 so they
look upright in that view); the image must follow the same rule, and the user must be able to choose the rotation.

## Findings
- Neither TPCL `SG` nor TSPL `BITMAP` has a rotation parameter: the rotation has to be baked into the bitmap (rotate the pixels) before the command is
  written.
- The image pipeline lives in js/app.js (convertImage, rasterize, insertImage, the overlay item), js/components/image/ (codec.js `makeItem` /
  `makeBitmapItem` / `bitmapToNibble`, panel.js, overlay.js, render.js) and the language hooks `imageCommand` (TSPL) / `images.buildSG` (TPCL).

## Decisions
- New select `Rotación` (0/90/180/270, clockwise on the label, same convention as text) in the image controls. Default for a new image and
  whenever Giro changes (until the user picks a value for the current image): `(360 - Giro) % 360`, so the picture looks upright in the view.
- `Ancho` is the width of the picture along its own horizontal axis (before rotating); the height keeps the aspect ratio. Rotating does not
  change the scale.
- `Posición X / Y` is the top-left corner of the rotated picture's bounding box in label coordinates (what dragging already shows).
- Images read from the code (BITMAP / SG) are already bitmaps: no rotation control for them.

## Tasks
- [x] T1 Rotation of the inserted image: pure `rotateBitmap` in the codec, the `Rotación` select and its default, preview overlay drawn rotated
      (converted dots and plain picture), insertion writes the rotated bitmap through SG and BITMAP, tests, README.

## Route declaration
Delegated direct, one writer (multi-file).

## Acceptance
Rotating a known 3x2 bitmap by 90/180/270 gives the exact expected matrix; the inserted command of a rotated image decodes (parse) to the rotated
bitmap in TPCL and TSPL; the preview shows the same dots that get inserted; changing Giro updates the default; `node --test` green.

## Verification
`node --test`; Chrome check by the assistant (puppeteer-core outside the repo) of the preview and the panel; user check with a real 270 label.

## Progress
Plan created. T1 done: rotateBitmap, Rotación select, rotated preview and insertion, tests, README (commit id below).
