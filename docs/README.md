# Printer manuals (local only)

The vendor manuals are **not** in the repository: they are copyrighted and the repo is public.
`.gitignore` excludes every `*.pdf` under `docs/`. Keep the PDFs here on your machine; only this README is versioned.

## `tpcl/` (Toshiba TEC, TPCL)

| File | Printer / scope | Why it is here |
|---|---|---|
| `B-SV4_external-equipment-interface-spec_2004-08.pdf` | B-SV4 series (English, 1st ed. Aug 2004) | Main reference: the printer family we target. `{PC/PV/RV/XB/SG…\|}` formats. |
| `B-452-R_462-R_software-specification_2012-11.pdf` | B-452-R / B-462-R (English, 3rd ed. Nov 2012) | Most recent edition of the same command set. |
| `B-452-TS12_guia-de-programacion_es_2001-07.pdf` | B-452-TS12 (Spanish, Jul 2001) | Same commands in Spanish. |
| `B-x72_guia-de-programacion_es_2001-09.pdf` | B-x72 (Spanish, Sep 2001) | Legacy `[ESC]` form (e.g. `[ESC]XB` for Code39/ITF) that the code also reads. |

## `tspl/` (TSC-style TSPL: TSC TTP, TEC B-442/443)

| File | Printer / scope | Why it is here |
|---|---|---|
| `B-442-443_interface-manual_tspl-command-set.pdf` | TEC B-442 / B-443 (English, 137 pages) | Despite the TEC name it documents the TSPL command set (`SIZE`, `GAP`, `DIRECTION`, `CLS`, `TEXT`, `BARCODE`, `BOX`, `BITMAP`, `PRINT`…). An older subset: no `QRCODE` or `SHIFT`. |

The code follows the *TSC TSPL/TSPL2 Programming Manual v3.0*; if you find it, save it as
`tspl/TSC_TSPL-TSPL2_programming-manual_v3.0.pdf`.

## `zpl/` (Zebra ZPL II)

| File | Printer / scope | Why it is here |
|---|---|---|
| `Zebra_ZPL-II_programming-guide-vol-1_2003.pdf` | Zebra ZPL II, Programming Guide Volume One (English, 428 pages, 2003) | Reference for the ZPL support: label setup (`^XA`, `^PW`, `^LL`, `^LH`), fields (`^FO`, `^FT`, `^FD`, `^FS`), text (`^A`, `^CF`, `^FW`, `^FH`), barcodes (`^B*`), graphics (`^GB`, `^GC`, `^GD`, `^GE`, `^GF`), reverse (`^FR`, `^LR`), counters (`^SN`) and variable fields (`^FN`). |

## Left out on purpose

Owner's manuals (hardware), the older B-SV4D spec (superseded by the 2004 B-SV4 edition) and a duplicate of the B-452 guide.

Several TPCL formats in the code come from the B-SX4T manual and are **not verified on a real printer** (see `README.md`):
checking them against these manuals is the point of keeping them here.
