# gemm_tile real area: SRAM macro vs. flop-array operand_mem (issue #35)

Yosys can only synthesize logic gates, not a real hard macro's internals.
`synth/synth_sky130_gemm_tile.ys` now reads `synth/sram_blackbox.v`, a `(* blackbox *)` stub matching
`rtl/operand_mem.v`'s `sky130_sram_512b_1rw_64x64` instantiation, so `stat` reports 0 area for the two
SRAM banks and real area for everything else.
The real per-bank macro area (from its OpenRAM-generated LEF) is added back in below by hand.

## Logic-only synthesis (SRAM banks blackboxed)

`synth/reports/gemm_tile_sky130.log`, current run:

| | area (um^2) |
|---|---|
| `gemm_tile` total (logic only, no SRAM) | 332,373.7728 |
| `operand_mem` local logic (just the write/read address-priority mux) | 71.318 |
| `tile` (skew_feeder + systolic_array + pe) | 331,097.5492 |
| `gemm_sequencer` | 1,204.9056 |

## Real SRAM macro area

Regenerated via `openram/run_operand_sram.sh` (same pinned OpenRAM commit and
`openram/config_operand_bank.py` as issue #31 -- see `docs/decisions.md`, 2026-09-08 entry, for why this
had to be regenerated rather than reused).

- LEF: `MACRO sky130_sram_512b_1rw_64x64` / `SIZE 508.56 BY 166.525` -> 84,687.954 um^2 per bank.
- Independently corroborated by OpenRAM's own `datasheet.info` output (`84687.95399999998`), an exact
  match to the LEF-derived figure.
- `operand_mem.v` instantiates two banks (`a_bank`, `b_bank`): 2 x 84,687.954 = 169,375.908 um^2.

## Combined real total

| | area (um^2) | % of tile |
|---|---|---|
| Logic-only (blackboxed) | 332,373.7728 | 66.24% |
| Real SRAM macro (2 banks) | 169,375.908 | 33.76% |
| **Real total** | **501,749.6808** | 100% |

## Before / after

| | old (flop-array operand_mem) | new (real SRAM macro) | delta |
|---|---|---|---|
| Total tile area (um^2) | 727,844.3104 | 501,749.6808 | -226,094.6296 (-31.06%) |
| operand_mem share of tile | 309,456.7936 (42.52%) | 169,375.908 (33.76%) | |

The win is real (-31.06% total tile area) but more modest than the raw per-bit comparison alone would
suggest, because a small (4096-bit) real SRAM macro pays fixed peripheral overhead (decoders, sense
amps, and the spare row/column sky130's array-parity constraint required -- see
`openram/config_operand_bank.py`'s comments) that a flip-flop array doesn't -- see `docs/decisions.md`,
2026-09-08 entry, for the full reasoning.

## Known caveats carried forward

- DRC (52,200 violations) / LVS (mismatch) are NOT clean, for the same reason documented at issue #31's
  closure: violations concentrate in vendor-supplied `sky130_fd_bd_sram` primitive cells using
  foundry-internal GDS layers the open sky130 PDK doesn't publish. This is an accepted, documented
  upstream limitation, not new to this run.
- The real macro's actual port shape (`ADDR_WIDTH=7`, `DATA_WIDTH=65`, plus a `spare_wen0` pin) does NOT
  match what `rtl/operand_mem.v` assumes (6-bit address, 64-bit data, no `spare_wen0`) -- a real,
  previously-unverified gap discovered while regenerating the macro for this issue. This does not affect
  the area figures above (area comes from the LEF's physical `SIZE`, independent of port wiring), but it
  is a real correctness gap in the already-merged operand_mem.v. Filed separately; see `docs/decisions.md`,
  2026-09-08 entry, and the linked issue.
- Full OpenLane P&R of `gemm_tile` with the macro as a real hard macro is out of scope for #35 -- that's
  milestone 3 / issue #36's job (`gemm_tile`/`router` P&R), deferred until Phase 3.1-3.3 line up.
