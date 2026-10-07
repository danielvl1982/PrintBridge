# brand-logo

Branch: `feat/brand-logo`. Delivery strategy: ask-on-risk (default).

## Objective
New brand look for Print Bridge, matching the user's GitHub avatar style (two-colour wordmark, teal + orange, clean bold sans-serif):
icon redrawn with the same palette and the header name written in two colours.

## Design
- Palette (sampled by eye from the avatar): dark teal `#143a49`, orange `#e88a23`.
- `img/logo.svg` (64x64, also the favicon): same concept (label, bridge arch, barcode bars) recoloured: teal tile, white label,
  orange bridge arch, teal bars. Readable at 28 px.
- Header: `<h1 class="brand"><span class="brand-print">Print</span><span class="brand-bridge">Bridge</span></h1>`, bold system
  sans-serif (Segoe UI stack already used), 20 px, slightly tight letter-spacing. The page `<title>` stays "Print Bridge".
  Colours as CSS custom properties. The header height must not change (the logo's 28 px sets it), so the preview max-height
  arithmetic in css/viewer.css stays valid.

## Tasks
- [x] T1 Recolour img/logo.svg, two-colour header wordmark, CSS tokens, update structure tests.

## Verification
`node --test` all green. Browser (user): the header shows the icon and "PrintBridge" in teal + orange; favicon updated.

## Progress
- T1 done (route: inline via parent-delegated writer). RED: 4 failing structure tests before edits (title/header, brand tokens, logo/SVG, header contents). GREEN: node --test 738 pass, 0 fail. Header height unchanged (20px wordmark, line-height 1 < 28px logo). Browser check pending (user). Commit: pending (parent).
