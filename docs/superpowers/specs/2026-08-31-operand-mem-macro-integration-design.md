# Integrate the SRAM macro behind `operand_mem`'s existing port interface — design

Issue: [#32](https://github.com/dzheng1328/hw-GEMM-accelerator/issues/32) (Phase 3.2 milestone).

## Context

Issue #31 (in progress as of this writing) generates a real sky130 SRAM macro via OpenRAM, sized to
`operand_mem`'s real per-bank geometry: `N=8, KMAX=8` -> `DEPTH = N*KMAX = 64` words per bank, each
`8*N = 64` bits wide, single read/write port (1RW), two identical banks (`a_ram`, `b_ram`). That sizing
is fixed by the already-approved #31 spec regardless of how #31's generation itself resolves, so this
design doesn't depend on #31's exact final DRC/LVS/area outcome -- only on the fact that a working 1RW
macro of this shape will eventually exist, named `sky130_sram_512b_1rw_64x64` (the `output_name` already
fixed in `openram/config_operand_bank.py`). Executing this design (touching the real generated files)
still has to wait for #31 to actually land.

Today `rtl/operand_mem.v` is a flop-array register file with a **combinational** read: `rd_a_col`/
`rd_b_row` are valid the same cycle `rd_addr` is presented. A real SRAM macro reads **synchronously**
(registered): the read data is valid one cycle after the address is presented. Issue #32's job is to
wrap the real macro behind `operand_mem`'s existing write/read port shape and make that one-cycle
latency correct and explicit at this module's boundary -- not to fix any of its callers (that's #33).

## A scope-boundary finding, not just an implementation detail

Reading issues #32/#33/#34's actual text (not just their titles) surfaces real overlap: #33 says it
"re-verifies bit-exact results end to end," but #34 says it separately "updates tb/gemm/ and tb/tile/
testbenches for the new read latency" -- the same testbenches #33's end-to-end re-verification would
need. This is the same shape of ambiguity the #25-28 pe.v-pipelining milestone hit: that design spec's
own mid-stream finding was "this reshapes what issue #26 actually is... the real ripple lands mostly in
issue #28, not #26," and the actual shipped PR (#39) bundled the RTL pipeline change, the sequencer
propagation, and all testbench updates into one PR regardless of the three separate issue numbers.

**Decision for this design:** issue #32 gets its **own new, isolated testbench** (`tb/operand_mem/`,
testing `operand_mem.v` directly, not through the full tile) so it can land green on its own, without
touching `gemm_sequencer.v` or requiring `tb/gemm/`/`tb/tile/`/`tb/mnist/` to pass yet. Those suites are
*expected* to go red once `operand_mem`'s real timing changes, until #33 compensates for it -- mirroring
how #26 (pe.v's MAC pipelining) shipped clean on its own before the sequencer/testbench ripple landed in
the same PR as #27/#28. Issue numbers here are organizational, not a strict promise about PR boundaries;
the actual PR-sized chunk of work may end up bundling #32+#33 (or more) together, same as last time --
that's a call to make once real implementation starts, not now.

## Options considered

**Macro selection mechanism (real macro for synthesis vs. behavioral model for simulation):**
- **(chosen) Build-system file substitution.** `operand_mem.v` instantiates two fixed-name modules
  (`sky130_sram_512b_1rw_64x64`) with zero internal branching. A behavioral stand-in file
  (`tb/operand_mem/sram_macro_behavioral.v`) defines that same module name with matching ports, for
  testbenches to compile against; the real OpenRAM-generated `.v` (once #31/#35 exist) is what synthesis/
  OpenLane compiles against instead. Standard hardware practice -- module resolution by name across
  whatever files happen to be in a given compile's file list -- and keeps `operand_mem.v` itself
  synthesis-clean with no simulation-only logic in it.
- **An internal `ifdef`/parameter switch inside `operand_mem.v`** (e.g. `generate if (SIM) ... else
  ...`). Rejected: this is a feature-flag-style branch inside the module that will actually get taped
  out, for a distinction (sim vs. synthesis) the build system already naturally provides for free via
  its file lists. No benefit over the file-substitution approach, and it's exactly the kind of
  feature-flag complexity this project's conventions steer away from.

**Shared read/write address bus (the real macro has one address/control port, not two):**
- **(chosen) Priority mux, write wins:** `addr = wr_en ? wr_addr : rd_addr`, `we = wr_en`. Confirmed
  safe by re-reading `rtl/gemm_tile.v`/`rtl/noc_node.v`: `wr_en` only ever fires during OPERAND-flit
  delivery (the load phase), and `rd_addr` only matters after `start` triggers the sequencer (the
  compute phase) -- the two are never concurrent in any real usage today, so no real arbitration is
  needed, just a mux.
- **A real arbiter/FSM for concurrent read+write.** Rejected: no current or planned usage overlaps
  read and write in the same cycle; building arbitration for a case that can't happen today is
  premature (the #31 spec already made the identical YAGNI call rejecting a dual-port macro for the
  same reason).

**Latency contract:**
- **(chosen) `localparam RD_LATENCY = 1`** inside `operand_mem.v`, as the source of truth -- exactly
  mirroring `pe.v`'s `ACC_LATENCY` localparam. Issue #33 threads it onward as an overridable parameter
  the same way `PE_ACC_LATENCY` already flows through `gemm_sequencer`/`gemm_tile`/`noc_node` (per the
  sync-sites comment already in `gemm_sequencer.v`'s header). This is the established, working pattern
  in this codebase for exactly this kind of cross-module latency contract -- no reason to invent a new
  one.
- **A valid/ready handshake on the read port instead of a fixed-latency contract.** Rejected: the real
  macro's read latency is a fixed hardware fact (not data-dependent, not variable), so a handshake
  would add real complexity (extra signals, extra states in every consumer) for no behavioral benefit
  over a named constant the consumer's FSM sizes itself against -- exactly the reasoning that already
  justified `ACC_LATENCY` over a handshake for `pe.v`'s pipeline.

## Design

### 1. `rtl/operand_mem.v`

Port list is **unchanged** in shape (`wr_en`/`wr_addr`/`wr_a_col`/`wr_b_row`/`rd_addr` in,
`rd_a_col`/`rd_b_row` out) -- only the internal implementation and the read timing change:

```verilog
module operand_mem #(
    parameter N    = 8,
    parameter KMAX = 8
) (
    input  wire                            clk,
    input  wire                            wr_en,
    input  wire [$clog2(N*KMAX)-1:0]       wr_addr,
    input  wire signed [8*N-1:0]           wr_a_col,
    input  wire signed [8*N-1:0]           wr_b_row,
    input  wire [$clog2(N*KMAX)-1:0]       rd_addr,
    output wire signed [8*N-1:0]           rd_a_col,
    output wire signed [8*N-1:0]           rd_b_row
);
    localparam RD_LATENCY = 1;  // real SRAM macro: registered (synchronous) read

    wire [$clog2(N*KMAX)-1:0] a_addr = wr_en ? wr_addr : rd_addr;
    wire [$clog2(N*KMAX)-1:0] b_addr = wr_en ? wr_addr : rd_addr;

    sky130_sram_512b_1rw_64x64 a_bank (
        .clk0  (clk),
        .csb0  (1'b0),          // exact port names confirmed against the real
        .web0  (~wr_en),        // generated macro's .v once #31 lands -- OpenRAM's
        .addr0 (a_addr),        // convention (clk0/csb0/web0/addr0/din0/dout0) is
        .din0  (wr_a_col),      // the placeholder here; verify and correct at
        .dout0 (rd_a_col)       // implementation time, not guessed permanently
    );

    sky130_sram_512b_1rw_64x64 b_bank (
        .clk0  (clk),
        .csb0  (1'b0),
        .web0  (~wr_en),
        .addr0 (b_addr),
        .din0  (wr_b_row),
        .dout0 (rd_b_row)
    );
endmodule
```

The exact macro port names (`clk0`/`csb0`/`web0`/`addr0`/`din0`/`dout0` above) are OpenRAM's typical
convention for a 1RW macro, but this design doesn't treat them as settled fact -- confirming them
against the real generated `.v` (or the behavioral stand-in built to match it, see below) is an
implementation-time step, not a design-time guess to build further decisions on.

### 2. `tb/operand_mem/sram_macro_behavioral.v` (new, test-owned, not under `rtl/`)

A minimal behavioral model of `sky130_sram_512b_1rw_64x64`: a 64x64 register array, registered
(1-cycle-latency) read, matching whatever real port names get confirmed in step 1. Lives under
`tb/operand_mem/`, not `rtl/`, since it is explicitly not part of the taped-out design -- keeps `rtl/`
meaning only the real synthesizable design, per this repo's existing layout convention.

### 3. `tb/operand_mem/` (new isolated testbench)

New `tb/operand_mem/Makefile` (matching the existing `tb/tile/Makefile` pattern: `VERILOG_SOURCES` =
`rtl/operand_mem.v` + `tb/operand_mem/sram_macro_behavioral.v`, `TOPLEVEL = operand_mem`, its own
`sim/sim_build_operand_mem/` build dir) and `test_operand_mem.py`, covering:
- Write then read back at several slots (both banks), confirming data integrity.
- `RD_LATENCY` precisely: `rd_a_col`/`rd_b_row` do NOT reflect a newly-presented `rd_addr` in the same
  cycle; they do exactly one cycle later.
- Bank independence: writing `a_ram` doesn't disturb `b_ram` and vice versa.

`./test.sh` gets a new `tb/operand_mem` stanza alongside its existing eight.

### 4. Unaffected in this issue: `rtl/gemm_tile.v`, `rtl/gemm_sequencer.v`, `rtl/skew_feeder.v`

No changes. `gemm_tile.v`'s wiring of `operand_mem` is already timing-agnostic (plain wires); it doesn't
need to change for `operand_mem`'s internal latency to change. `gemm_sequencer.v` compensating for the
new latency, and `tb/gemm/`/`tb/tile/`/`tb/mnist/` needing to pass again, is #33's job. Expect those
suites to go red after this issue lands, until #33 lands -- that's correct, not a regression to chase
down here.

## Out of scope

- Any change to `gemm_sequencer.v`, `skew_feeder.v`, or the sequencer's drain-window sizing -- #33.
- Making `tb/gemm/`, `tb/tile/`, or `tb/mnist/` pass again -- #33/#34.
- Blackbox-instantiating the macro in Yosys/OpenLane for `gemm_tile` synthesis, and any further
  refinement of the behavioral sim model beyond what #32's own isolated testbench needs -- #35 and #34
  respectively, per each issue's own stated scope.
- Anything about #31's actual generation outcome (area, DRC/LVS numbers) -- this design only depends on
  the macro's fixed word/port shape, which doesn't change regardless of how #31 resolves.
