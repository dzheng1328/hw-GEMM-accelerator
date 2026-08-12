# pe.v -- OpenLane 2 place & route summary

Run date: 2026-08-12
OpenLane version: 2.3.10 (Docker image `ghcr.io/efabless/openlane2:2.3.10`)
PDK: sky130A (`sky130_fd_sc_hd`), tt/25C/1.80V primary corner, 100MHz (10ns) target
Run directory: `openlane/pe/runs/RUN_2026-08-12_13-56-15` (gitignored; GDSII, LEF, netlists, and all
per-stage reports live there)

## Results

- DRC violations: 0 (Magic DRC: `[INFO] COUNT: 0`; KLayout DRC: 0; final routing DRC: 0 after 5
  TritonRoute iterations)
- LVS mismatches: 0 (`netgen` LVS: "Circuits match uniquely.")
- Antenna violations: 0
- Timing at the primary tt/25C/1.80V corner (the plan's target corner, matching the earlier Yosys pass):
  **setup timing met** -- worst setup slack (WNS) = 0 ns, no violating paths.
- Timing across the full multi-corner PVT sign-off sweep: worst-case setup slack is **-3.20 ns**, at the
  `max_ss_100C_1v60` corner (slow-slow process, 100C, 1.60V -- the pessimistic corner, not the plan's
  target corner). Hold timing is clean (0 ns WNS/TNS) at every corner. Max slew/cap violations remain
  outstanding at the slow corners after the resizer's automatic repair pass.
- Final area: 10,681.5 um^2 standalone-cell (instance) area within a 21,620.7 um^2 core / 26,787 um^2 die
  (compare against the Yosys sky130 pass's 6,209.7 um^2 pre-P&R synthesis estimate for `pe.v` -- the
  larger post-P&R figure reflects real placement/routing overhead, clock buffering, and the resizer's
  timing-repair cell insertions that a synthesis-only estimate doesn't capture).

## Notes

- Two real tooling issues were hit and fixed along the way (see `docs/decisions.md` /
  `docs/learnings.md`): the project's only available Python (3.14, via Homebrew) couldn't build `cocotb`,
  requiring `.venv` to be rebuilt on Python 3.12 so both `cocotb` and `openlane` coexist; and OpenLane's
  `--dockerized` mode defaults to allocating a TTY (`-t` to `docker run`), which fails immediately with no
  container ever created when run without a controlling terminal (e.g. under `nohup`/background execution)
  -- fixed by passing `--docker-no-tty` before `--dockerized` in `openlane/run_pe.sh`.
- Full run artifacts are gitignored (`openlane/pe/runs/`) -- this file is the durable record.
