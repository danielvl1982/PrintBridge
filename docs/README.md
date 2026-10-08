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

## `tspl/` (TSC TTP, TSPL)

Empty for now: no TSPL manual is available locally. The code follows the *TSC TSPL/TSPL2 Programming Manual v3.0*;
save it as `tspl/TSC_TSPL-TSPL2_programming-manual_v3.0.pdf`.

## Left out on purpose

Owner's manuals (hardware), the B-442/443 interface manual (older `<ESC>!` protocol, not the `{…|}` form the parser reads),
the older B-SV4D spec (superseded by the 2004 B-SV4 edition) and a duplicate of the B-452 guide.

Several TPCL formats in the code come from the B-SX4T manual and are **not verified on a real printer** (see `README.md`):
checking them against these manuals is the point of keeping them here.
