/**
 * PrintBridge configuration: known label sizes and example labels.
 * It is the only file that needs to be touched to add a standard size or a new example.
 * The fonts and commands specific to each language live in its module (js/languages/).
 */

/**
 * Static configuration, common to all languages.
 * Standard label sizes are added here.
 */
(function (PB) {
  'use strict';

  PB.config = Object.freeze({
    /**
     * Standard label sizes (in mm), language-agnostic. For other sizes, type them in the Formato row ("Personalizado…").
     *  - id: "<w>x<h>"; p: pitch (distance between the start of one label and the next) = height + 3 mm.
     */
    sizes: Object.freeze([
      [100, 150], [100, 100], [100, 60], [80, 50], [60, 40], [50, 30], [40, 30],
    ].map(([w, h]) => Object.freeze({ id: `${w}x${h}`, name: `${w}×${h} mm`, w, h, p: h + 3 }))),

    /** Size used for drawing if the label does not declare its own (in 0.1 mm). */
    fallbackSize: Object.freeze({ w: 990, h: 550 }),

    /** Ratio of the capital letter height to the font size (to detect overlaps of real ink). */
    capHeightRatio: 0.72,

    resolutions: Object.freeze([203, 300]),
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});

/**
 * Example labels that can be loaded from the viewer.
 * Each example carries the language it is written in (language, key of PB.languages), its source code (source)
 * and the values of its variables so that it is drawn with real data. The optional group ('blank' | 'template')
 * decides the section of the Ejemplo combo it is listed in. Only blank templates and ready-made templates ship;
 * complete sample labels live in the test fixture tests/helpers/legacy-examples.js.
 */
(function (PB) {
  'use strict';

  /** Test values of the three templates (they share the same variables). */
  const TEMPLATE_VALUES = Object.freeze({ PRODUCTO: 'Tornillo M8 x 40', LOTE: 'L2026-0412', CANTIDAD: '250 uds', CODIGO: '100001200001' });

  PB.examples = Object.freeze([
    // Blank templates: only the header (language and 100 x 60 mm label), no items; the palette then inserts that language's commands
    {
      id: 'blank-tpcl',
      group: 'blank',
      name: 'En blanco — TPCL (TEC)',
      language: 'tpcl',
      values: {},
      // D = pitch, width, height in 0.1 mm: 63 mm pitch (60 mm + 3 mm gap), 100 x 60 mm
      source: `{D0630,1000,0600|}
{AX;+010,+000,+00|}
{C|}

{XS;I,0001,0002C4100|}`,
    },
    {
      id: 'blank-tspl',
      group: 'blank',
      name: 'En blanco — TSPL (TSC)',
      language: 'tspl',
      values: {},
      source: `SIZE 100 mm,60 mm
GAP 3 mm,0 mm
DIRECTION 1
REFERENCE 0,0
CLS
PRINT 1,1`,
    },
    {
      id: 'blank-zpl',
      group: 'blank',
      name: 'En blanco — ZPL (Zebra)',
      language: 'zpl',
      values: {},
      source: `^XA
^PW800
^LL480
^XZ`,
    },
    // Templates: the same label (frame, title, three variable lines, line, Code128 and QR) in the three languages, 100 x 60 mm
    // at 203 dpi (800 x 480 dots). Written in TSPL, converted with PB.convert and reviewed by hand; ASCII only.
    {
      id: 'template-tpcl',
      group: 'template',
      name: 'Plantilla — TPCL (TEC)',
      language: 'tpcl',
      values: TEMPLATE_VALUES,
      source: `{D0630,1000,0600|}
{AX;+010,+000,+00|}
{C|}

{LC;0025,0013,0976,0588,1,04|}

{PV00;0050,0070,0050,0040,B,00,B|}
{RV00;ETIQUETA BASICA|}

{PC00;0050,0143,10,09,N,00,B|}
{RC00;Producto: #PRODUCTO#|}
{PC01;0050,0193,10,09,N,00,B|}
{RC01;Lote: #LOTE#|}
{PC02;0050,0243,10,09,N,00,B|}
{RC02;Cant: #CANTIDAD#|}

{LC;0025,0271,0976,0271,0,03|}

{XB00;0050,0300,9,1,02,0,0150,0,000,1,00|}
{RB00;#CODIGO#|}

{XB01;0726,0313,T,L,06,A,0,M2|}
{RB01;https://example.com/#CODIGO#|}

{XS;I,0001,0002C4100|}`,
    },
    {
      id: 'template-tspl',
      group: 'template',
      name: 'Plantilla — TSPL (TSC)',
      language: 'tspl',
      values: TEMPLATE_VALUES,
      source: `SIZE 100 mm,60 mm
GAP 3 mm,0 mm
DIRECTION 1
REFERENCE 0,0
CLS
BOX 20,10,780,470,4
TEXT 40,30,"4",0,1,1,"ETIQUETA BASICA"
TEXT 40,95,"3",0,1,1,"Producto: #PRODUCTO#"
TEXT 40,135,"3",0,1,1,"Lote: #LOTE#"
TEXT 40,175,"3",0,1,1,"Cant: #CANTIDAD#"
BAR 20,215,760,3
BARCODE 40,240,"128",120,1,0,2,2,"#CODIGO#"
QRCODE 580,250,L,6,A,0,"https://example.com/#CODIGO#"
PRINT 1,1`,
    },
    {
      id: 'template-zpl',
      group: 'template',
      name: 'Plantilla — ZPL (Zebra)',
      language: 'zpl',
      values: TEMPLATE_VALUES,
      source: `^XA
^PW800
^LL480
^FX Frame, title, three lines with variables, a line, a Code128 bar code and a QR
^FO18,8^GB764,464,4^FS
^FT40,56^A0N,32,40^FDETIQUETA BASICA^FS
^FT40,114^A0N,24,27^FDProducto: #PRODUCTO#^FS
^FT40,154^A0N,24,27^FDLote: #LOTE#^FS
^FT40,194^A0N,24,27^FDCant: #CANTIDAD#^FS
^FO20,215^GB760,3,3^FS
^BY2
^FO40,240^BCN,120,Y,N,N^FD#CODIGO#^FS
^FO580,250^BQN,2,6^FDLA,https://example.com/#CODIGO#^FS
^XZ`,
    },
  ]);
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
