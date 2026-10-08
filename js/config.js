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
 * and the values of its variables so that it is drawn with real data.
 */
(function (PB) {
  'use strict';

  PB.examples = Object.freeze([
    {
      id: 'spool-99x55',
      name: 'Etiqueta de bobina — ejemplo',
      language: 'tpcl',
      values: {
        MFRDATE: '2026/Jan/01', PN: '100001', LOT: '200001', QTY: '400', ROLLNUM: '1', TOTALROLLS: '10',
        CODIGOBARRAS: '100001@200001@400 mts@1/10@2026/Jan/01',
        DESCRIPCION1: 'SAMPLE FILM 100 X 0,100', DESCRIPCION2: 'SAMPLE DESCRIPTION',
      },
      source: `{D0610,0990,0550|}
{AX;+010,+000,+00|}
{C|}

{PC003;0600,0075,08,08,J,00,B=BOBINA|}

{PC004;0600,0130,05,05,J,00,B=MFR DATE:|}
{PC005;0780,0130,05,05,J,00,B|}
{RC005;#MFRDATE#|}

{PC006;0050,0160,08,08,J,00,B=PN:|}
{PC007;0170,0160,08,08,J,00,B|}
{RC007;#PN#|}

{PC008;0050,0210,08,08,J,00,B=LOT:|}
{PC009;0170,0210,08,08,J,00,B|}
{RC009;#LOT#|}

{PC010;0050,0260,08,08,J,00,B=QTY:|}
{PC011;0170,0260,08,08,J,00,B|}
{RC011;#QTY# mts|}

{PC012;0050,0310,08,08,J,00,B=Roll Numb:|}
{PC013;0335,0310,08,08,J,00,B|}
{RC013;#ROLLNUM# / #TOTALROLLS#|}

{XB01;0700,0160,T,H,04,A,0,M2|}
{RB01;#CODIGOBARRAS#|}

{PC014;0050,0420,05,05,J,00,B|}
{RC014;#DESCRIPCION1#|}

{PC015;0050,0460,05,05,J,00,B|}
{RC015;#DESCRIPCION2#|}

{XS;I,0001,0002C4100|}`,
    },
    {
      id: 'barcodes-code39-itf-code128',
      name: 'Códigos de barras — Code39, ITF y Code128',
      language: 'tpcl',
      values: { CODE39: 'SAMPLE-001', ITF: '00010001', CODE128: '100001@200001' },
      source: `{D0550,0800,0500|}
{C|}

{PC001;0050,0020,05,05,J,00,B=CODE39 (tipo 3)|}
{XB01;0050,0050,3,3,02,02,06,06,02,0,0080,1|}
{RB01;#CODE39#|}

{PC002;0050,0170,05,05,J,00,B=ITF (tipo 2)|}
{XB02;0050,0200,2,1,02,02,05,05,00,0,0080,1|}
{RB02;#ITF#|}

{PC003;0050,0320,05,05,J,00,B=CODE128 (tipo 9)|}
{XB03;0050,0350,9,0,02,0,0080,0,000,1,00|}
{RB03;#CODE128#|}

{XS;I,0001,0002C4100|}`,
    },
    {
      id: 'tspl-label-100x60',
      name: 'Etiqueta TSPL (TSC) — ejemplo 100×60 a 203 dpi',
      language: 'tspl',
      values: {},
      // 100 x 60 mm = 800 x 480 dots at 203 dpi (8 dots/mm); ASCII only: TSPL text depends on the printer code page
      source: `SIZE 100 mm,60 mm
GAP 3 mm,0 mm
DIRECTION 1
REFERENCE 0,0
CLS
BOX 20,10,780,470,4
TEXT 40,30,"4",0,1,1,"ETIQUETA TSPL"
TEXT 40,90,"3",0,1,1,"Producto: Muestra 100"
TEXT 40,130,"2",0,1,1,"Lote: 200001"
TEXT 40,165,"1",0,1,1,"Cant: 400 mts"
TEXT 420,40,"0",0,10,10,"Fuente escalable"
BAR 20,205,760,3
BARCODE 40,230,"128",100,1,0,2,2,"100001200001"
QRCODE 560,240,L,6,A,0,"https://example.com/100001"
PRINT 1,1`,
    },
    {
      id: 'zpl-label-100x60',
      name: 'Etiqueta ZPL (Zebra) — ejemplo 100×60 a 203 dpi',
      language: 'zpl',
      values: { PRODUCTO: 'Muestra 100', LOTE: '200001' },
      // 100 x 60 mm = 800 x 480 dots at 203 dpi; only text for now (the other components arrive with the next ZPL tasks); ASCII only
      source: `^XA
^PW800
^LL480
^FX Text fields: top-left origin or baseline origin, fonts 0 (scalable) and A, B, D, E (bitmapped)
^FO30,25^A0N,60,60^FDETIQUETA ZPL^FS
^FO30,110^ADN,36,20^FDProducto: <#PRODUCTO#>^FS
^FO30,165^ABN,22,14^FDLote: #LOTE#^FS
^FT30,260^AAN,18,10^FDCant: 400 mts^FS
^FT30,330^A0N,40,30^FDFuente escalable^FS
^FO30,350^AEN,28,15^FDOCR-B^FS
^FO740,40^A0R,40,40^FDGIRADO^FS
^FO400,300^A0N,50,50^FR^FDINVERTIDO^FS
^XZ`,
    },
  ]);
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
