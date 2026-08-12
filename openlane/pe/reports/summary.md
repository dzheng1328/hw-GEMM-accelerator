# pe.v -- OpenLane 2 place & route summary

Run date: 2026-08-12 (P&R run), 2026-08-12 (timing-closure pass)
OpenLane version: 2.3.10 (Docker image `ghcr.io/efabless/openlane2:2.3.10`)
PDK: sky130A (`sky130_fd_sc_hd`), tt/25C/1.80V primary corner, 100MHz (10ns) target
Run directory: `openlane/pe/runs/RUN_2026-08-12_14-28-01` (gitignored; GDSII, LEF, netlists, and all
per-stage reports live there). Current `openlane/pe/config.json` sets `IO_DELAY_CONSTRAINT: 10` (see
Timing Closure Pass below); this run is the one that config produces.

## Results

- DRC violations: 0 (Magic + KLayout)
- LVS mismatches: 0 (`netgen` LVS: "Circuits match uniquely.")
- Antenna violations: 0
- Timing at the primary tt/25C/1.80V corner: **setup timing met with real positive margin** -- worst
  setup slack is **+3.11 ns** (at `max_tt_025C_1v80`; +3.15 ns nom, +3.20 ns min) on the 10 ns period, no
  violating paths. (OpenLane's `timing__setup__wns` metric clamps to 0 ns when a corner has zero
  violating paths -- that clamp is not the design's actual slack, which is the positive number above,
  taken directly from OpenSTA's per-corner summary report.)
- Timing across the full multi-corner PVT sign-off sweep: worst-case setup slack is **-2.21 ns**, at the
  `max_ss_100C_1v60` corner (slow-slow process, 100C, 1.60V -- the pessimistic corner, not the plan's
  target corner; -2.09 ns nom, -1.99 ns min at that same slow-process/hot-temp condition). Hold timing is
  clean (0 ns WNS/TNS) at every corner. Max-slew and max-cap are both clean everywhere. 3 max-fanout
  violations are present at every corner (including the target corner), small and non-gating.
- Final area: 10,312.4 um^2 standalone-cell (instance) area within a 21,620.7 um^2 core / 26,787 um^2 die
  (compare against the Yosys sky130 pass's 6,209.7 um^2 pre-P&R synthesis estimate for `pe.v` -- the
  larger post-P&R figure reflects real placement/routing overhead, clock buffering, and the resizer's
  timing-repair cell insertions that a synthesis-only estimate doesn't capture).

## Timing Closure Pass (2026-08-12)

The first P&R run (`RUN_2026-08-12_13-56-15`, superseded above) closed timing at the target tt/25C/1.80V
corner (+2.19 ns) but left -3.20 ns of worst-case setup slack at the pessimistic `max_ss_100C_1v60`
sign-off corner. Root-cause investigation (reading the actual OpenSTA critical-path report, not guessing):

- **Every violating path in the original run starts at `b_in` (bits 1 and 3 specifically) and runs
  straight through the PE's combinational multiply-accumulate logic** (~25 standard-cell stages: the 8x8
  signed multiplier tree feeding the 16-bit accumulate adder) to the accumulator flops. (After the
  IO_DELAY_CONSTRAINT fix below, the resizer re-optimizes the design and the remaining violating paths
  shift to start at `a_in[7]`/`b_in[0]` instead -- different specific bits, same underlying combinational
  MAC logic.) This is inherent to `pe.v`'s architecture: a single-cycle, unpipelined MAC. The path already
  nearly fills the clock period at typical conditions and overflows it under slow/hot/low-voltage
  derating.
- **A real, fixable contributing factor**: OpenLane's default SDC reserves `IO_DELAY_CONSTRAINT` = 20% of
  the clock period (2 ns on this 10ns clock) as a generic input/output timing margin on every port. That
  default models a macro with unknown external drivers -- but `pe.v`'s `a_in`/`b_in` are actually driven
  directly by a neighboring PE's own *registered* `a_out`/`b_out` forwarding ports in the systolic array,
  so the generic 20% assumption is unrealistically conservative for this design's real usage context.

**Hypothesis testing** (one variable at a time, per the project's debugging process): halving
`IO_DELAY_CONSTRAINT` to 10% recovered the worst-case slack from -3.20 ns to **-2.21 ns** (0.99 ns
recovered against the 1 ns of margin freed -- close enough to confirm the diagnosis; the small residual is
P&R re-optimization noise, since the resizer inserts a slightly different number of repair cells per run).
Testing the extreme boundary (`IO_DELAY_CONSTRAINT: 0`, the most optimistic assumption possible) recovered
further to -1.38 ns -- **still violating**. This proves the I/O-delay assumption, while a real and
worthwhile fix, cannot fully close the gap on its own: roughly 1.2-1.4 ns of the shortfall at the
pessimistic corner is a genuine microarchitectural limit of the current single-cycle PE, independent of
any SDC/P&R tuning.

**Decision**: kept `IO_DELAY_CONSTRAINT: 10` (a real, justified improvement, not an arbitrary knob-turn)
and documented the remaining gap as a known limitation rather than pursue the more aggressive/unrealistic
0% value. **Full closure at the pessimistic corner would require pipelining the multiply-accumulate
datapath in `rtl/pe.v`** (adding a register stage) -- a genuine RTL/architecture change that ripples into
`systolic_array.v`'s single-cycle dataflow model project-wide, scoped as a separate future card rather
than done here.

## Notes

- Two real tooling issues were hit and fixed during the initial P&R run (see `docs/decisions.md` /
  `docs/learnings.md`): the project's only available Python (3.14, via Homebrew) couldn't build `cocotb`,
  requiring `.venv` to be rebuilt on Python 3.12 so both `cocotb` and `openlane` coexist; and OpenLane's
  `--dockerized` mode defaults to allocating a TTY (`-t` to `docker run`), which fails immediately with no
  container ever created when run without a controlling terminal (e.g. under `nohup`/background execution)
  -- fixed by passing `--docker-no-tty` before `--dockerized` in `openlane/run_pe.sh`.
- Full run artifacts are gitignored (`openlane/pe/runs/`) -- this file is the durable record.
