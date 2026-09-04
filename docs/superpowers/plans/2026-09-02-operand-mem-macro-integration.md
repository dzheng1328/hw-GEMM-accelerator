# Integrate the SRAM macro behind `operand_mem`'s port interface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `rtl/operand_mem.v`'s combinational flop-array read with a real synchronous SRAM macro
instantiation (`sky130_sram_512b_1rw_64x64`, one cycle registered read latency), behind the module's
existing write/read port shape, verified by a new isolated testbench.

**Architecture:** `operand_mem.v` instantiates two macro banks (`a_bank`, `b_bank`) through a fixed
module name with zero internal branching; a write-priority mux (`wr_en ? wr_addr : rd_addr`) drives each
bank's single shared address port since write and read never overlap in any real caller today. Module
resolution by name (not an `ifdef`) is what selects the real generated macro at synthesis time vs. a
test-only behavioral stand-in at simulation time — the build system's file list does the swapping, not
`operand_mem.v` itself. `RD_LATENCY = 1` is a `localparam` inside `operand_mem.v`, the source of truth
issue #33 threads onward into `gemm_sequencer.v`'s drain-window sizing (out of scope here).

**Tech Stack:** Verilog (Icarus Verilog simulation), cocotb + Python for the testbench, `make` via the
existing `tb/<suite>/Makefile` + `include $(shell cocotb-config --makefiles)/Makefile.sim` pattern.

**Spec:** `docs/superpowers/specs/2026-08-31-operand-mem-macro-integration-design.md`

## Global Constraints

- Port list of `operand_mem.v` stays unchanged in shape (`wr_en`/`wr_addr`/`wr_a_col`/`wr_b_row`/`rd_addr`
  in, `rd_a_col`/`rd_b_row` out) — only the internal implementation and read timing change.
- No changes to `rtl/gemm_tile.v`, `rtl/gemm_sequencer.v`, or `rtl/skew_feeder.v` — that ripple is issue
  #33's job. `tb/gemm/`, `tb/tile/`, `tb/mnist/` are *expected* to go red once this lands; that is correct,
  not a regression to chase down in this plan.
- No `ifdef`/parameter simulation-vs-synthesis switch inside `operand_mem.v` — module-name resolution via
  the build system's file list only.
- The macro's exact port convention (`clk0`/`csb0`/`web0`/`addr0`/`din0`/`dout0`) is OpenRAM's typical 1RW
  convention, not yet cross-checked against the real generated `.v` (issue #31's macro artifacts are
  gitignored build output, regenerated on demand, not present in this checkout). Task 2 calls this out
  explicitly as a follow-up to verify next time the macro is regenerated (e.g. alongside issue #35) — not
  a blocker for this plan, since #32's own testbench only exercises the behavioral stand-in.
- `operand_mem.v` has no reset port today and this plan doesn't add one (matches the existing port list
  and real SRAM macros, which have no reset — data is undefined until written).

---

## File Structure

- **Create:** `tb/operand_mem/sram_macro_behavioral.v` — test-only behavioral model of
  `sky130_sram_512b_1rw_64x64` (64 words × 64 bits, 1RW, registered read). Lives under `tb/`, not `rtl/`,
  since it's explicitly not part of the taped-out design.
- **Create:** `tb/operand_mem/Makefile` — cocotb + Icarus flow, matching `tb/tile/Makefile`'s pattern.
- **Create:** `tb/operand_mem/test_operand_mem.py` — isolated testbench for `operand_mem.v` alone (not
  through the full tile).
- **Modify:** `rtl/operand_mem.v` — replace the flop-array body with the two-macro-bank instantiation.
- **Modify:** `test.sh` — add a `tb/operand_mem` stanza.

## Task 1: Isolated testbench infrastructure (behavioral macro model + failing test)

**Files:**
- Create: `tb/operand_mem/sram_macro_behavioral.v`
- Create: `tb/operand_mem/Makefile`
- Create: `tb/operand_mem/test_operand_mem.py`

**Interfaces:**
- Produces: `sky130_sram_512b_1rw_64x64` module — ports `clk0` (in), `csb0` (in, active-low chip select),
  `web0` (in, active-low write enable), `addr0[5:0]` (in), `din0[63:0]` (in), `dout0[63:0]` (out,
  registered). Task 2 instantiates this module by name.
- Consumes: `rtl/operand_mem.v`'s existing port list (unchanged this task — this task only adds test
  infrastructure and runs it against the *current*, unmodified `operand_mem.v` to prove the new test
  actually detects the latency difference).

- [ ] **Step 1: Write the behavioral SRAM macro stand-in**

```verilog
`timescale 1ns / 1ps

// tb/operand_mem/sram_macro_behavioral.v -- test-only behavioral stand-in for the
// real OpenRAM-generated sky130_sram_512b_1rw_64x64 macro. rtl/operand_mem.v
// instantiates this module by name; the real generated .v (from issue #31's
// OpenRAM run) takes this file's place at synthesis time via the build system's
// file list, not an ifdef. Port convention (clk0/csb0/web0/addr0/din0/dout0)
// matches OpenRAM's typical single-port (1RW) SRAM macro output -- verify
// against the real generated .v next time the macro is regenerated (issue #31's
// build artifacts are gitignored, not checked into this repo).
module sky130_sram_512b_1rw_64x64 (
    input  wire        clk0,
    input  wire        csb0,   // active-low chip select
    input  wire        web0,   // active-low write enable
    input  wire [5:0]  addr0,
    input  wire [63:0] din0,
    output reg  [63:0] dout0
);
    reg [63:0] mem [0:63];

    always @(posedge clk0) begin
        if (!csb0) begin
            if (!web0) begin
                mem[addr0] <= din0;
            end
            dout0 <= mem[addr0];
        end
    end
endmodule
```

- [ ] **Step 2: Write the Makefile**

```makefile
# tb/operand_mem/Makefile -- cocotb + Icarus Verilog flow for rtl/operand_mem.v,
# tested in isolation (not through the full tile) against the behavioral SRAM
# macro stand-in.
# Assumes cocotb 1.8.x (see ../../requirements.txt).

SIM ?= icarus
TOPLEVEL_LANG ?= verilog

VERILOG_SOURCES = $(PWD)/../../rtl/operand_mem.v \
                  $(PWD)/sram_macro_behavioral.v

# Top-level Verilog module under test.
TOPLEVEL = operand_mem

# Python module (tb/operand_mem/test_operand_mem.py, no .py).
MODULE = test_operand_mem

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(PWD)/../../sim/sim_build_operand_mem
COCOTB_RESULTS_FILE = $(PWD)/../../sim/sim_build_operand_mem/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
```

- [ ] **Step 3: Write the failing test**

```python
"""cocotb testbench for rtl/operand_mem.v -- exercises the module in isolation
against tb/operand_mem/sram_macro_behavioral.v (the real OpenRAM macro's
behavioral stand-in), not through the full tile. Covers: write-then-read data
integrity on both banks, the macro's RD_LATENCY=1 registered read timing, and
bank independence (a_ram/b_ram don't cross-talk).
"""

import random

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge

N = 8
KMAX = 8
DEPTH = N * KMAX  # 64
RD_LATENCY = 1  # matches rtl/operand_mem.v's RD_LATENCY localparam
SEED = 0x0BAD5EED


def mask64():
    return (1 << 64) - 1


async def start_clock(dut):
    cocotb.start_soon(Clock(dut.clk, 2, units="ns").start())


async def idle(dut):
    dut.wr_en.value = 0
    dut.wr_addr.value = 0
    dut.wr_a_col.value = 0
    dut.wr_b_row.value = 0
    dut.rd_addr.value = 0


async def write_slot(dut, addr, a_val, b_val):
    dut.wr_en.value = 1
    dut.wr_addr.value = addr
    dut.wr_a_col.value = a_val & mask64()
    dut.wr_b_row.value = b_val & mask64()
    await RisingEdge(dut.clk)
    dut.wr_en.value = 0


@cocotb.test()
async def test_write_then_read_all_slots(dut):
    """Every slot in both banks round-trips exactly, addressed 0..DEPTH-1."""
    await start_clock(dut)
    await idle(dut)
    await RisingEdge(dut.clk)

    rnd = random.Random(SEED)
    a_vals = [rnd.getrandbits(64) for _ in range(DEPTH)]
    b_vals = [rnd.getrandbits(64) for _ in range(DEPTH)]

    for addr in range(DEPTH):
        await write_slot(dut, addr, a_vals[addr], b_vals[addr])

    for addr in range(DEPTH):
        dut.rd_addr.value = addr
        await RisingEdge(dut.clk)
        await RisingEdge(dut.clk)  # generous margin -- exact latency is checked below
        assert dut.rd_a_col.value.integer == a_vals[addr], f"a_ram[{addr}] mismatch"
        assert dut.rd_b_row.value.integer == b_vals[addr], f"b_ram[{addr}] mismatch"


@cocotb.test()
async def test_read_latency_is_registered(dut):
    """rd_a_col/rd_b_row must NOT reflect a newly-presented rd_addr on the same
    cycle -- they must reflect it exactly RD_LATENCY cycles later."""
    await start_clock(dut)
    await idle(dut)
    await RisingEdge(dut.clk)

    await write_slot(dut, 5, 0xAAAA_BBBB_CCCC_DDDD, 0x1111_2222_3333_4444)
    await write_slot(dut, 9, 0x5555_6666_7777_8888, 0x9999_AAAA_BBBB_CCCC)

    dut.rd_addr.value = 5
    await RisingEdge(dut.clk)
    dut.rd_addr.value = 9
    # Same cycle rd_addr changes to 9: output must still reflect addr 5.
    assert dut.rd_a_col.value.integer == 0xAAAA_BBBB_CCCC_DDDD
    assert dut.rd_b_row.value.integer == 0x1111_2222_3333_4444

    await RisingEdge(dut.clk)
    # Exactly RD_LATENCY cycles after presenting addr 9: output reflects addr 9.
    assert dut.rd_a_col.value.integer == 0x5555_6666_7777_8888
    assert dut.rd_b_row.value.integer == 0x9999_AAAA_BBBB_CCCC


@cocotb.test()
async def test_banks_are_independent(dut):
    """a_ram and b_ram must not cross-talk: writing distinguishable patterns to
    each bank at the same addresses must read back without mixing."""
    await start_clock(dut)
    await idle(dut)
    await RisingEdge(dut.clk)

    addrs = [0, 1, 17, 32, 63]
    for addr in addrs:
        await write_slot(dut, addr, addr, (~addr) & mask64())

    for addr in addrs:
        dut.rd_addr.value = addr
        await RisingEdge(dut.clk)
        await RisingEdge(dut.clk)
        assert dut.rd_a_col.value.integer == addr, f"a_ram[{addr}] wrong or leaked from b_ram"
        assert dut.rd_b_row.value.integer == ((~addr) & mask64()), f"b_ram[{addr}] wrong or leaked from a_ram"
```

- [ ] **Step 4: Run the suite and confirm it fails against the current (unmodified) `operand_mem.v`**

Run: `cd tb/operand_mem && make`
Expected: FAIL — `operand_mem.v` today is a combinational flop-array (same-cycle read), so
`test_read_latency_is_registered` must fail (its same-cycle assertion after the address change will see
the *new* address's data immediately, not the old one). `test_write_then_read_all_slots` and
`test_banks_are_independent` may pass by coincidence (they only check eventual data, not exact timing) —
what matters is that `test_read_latency_is_registered` fails for the expected reason. Confirm the
failure output specifically names that test and shows a same-cycle mismatch, not a compile error or an
unrelated crash.

- [ ] **Step 5: Commit**

```bash
git add tb/operand_mem/
git commit -m "Add isolated operand_mem testbench against a behavioral SRAM macro stand-in

Confirms the current combinational operand_mem.v fails the new registered-read
latency test, as expected before the real macro instantiation lands."
```

## Task 2: Instantiate the SRAM macro in `rtl/operand_mem.v`

**Files:**
- Modify: `rtl/operand_mem.v` (full rewrite of the module body; port list unchanged)
- Modify: `test.sh`

**Interfaces:**
- Consumes: `sky130_sram_512b_1rw_64x64` (Task 1's behavioral stand-in at simulation time; the real
  OpenRAM-generated `.v` at synthesis time via the build system's file list — same module name, same
  ports, no `operand_mem.v` change needed to swap between them).
- Produces: `operand_mem.v`'s port list is unchanged from before this plan (`wr_en`, `wr_addr`,
  `wr_a_col`, `wr_b_row`, `rd_addr` in; `rd_a_col`, `rd_b_row` out) — every existing caller
  (`gemm_tile.v`) keeps compiling unchanged. `RD_LATENCY` is a new `localparam` = 1, for issue #33 to read
  and thread onward.

- [ ] **Step 1: Rewrite `rtl/operand_mem.v`**

```verilog
`timescale 1ns / 1ps

// rtl/operand_mem.v -- the tile's operand buffer, backed by a real sky130 SRAM
// macro (issue #31/#32). One slot == one (chunk, column) of a tiled matmul: it
// holds an unskewed column of A (rd_a_col) and the matching row of B
// (rd_b_row). Addressing is addr = chunk*N + col, so an N-chunk N-block
// occupies N*chunks slots (up to N*KMAX).
//
// The write port is deliberately shaped like what a NoC/DMA delivers:
// {wr_addr, wr_a_col, wr_b_row} is an addressed operand payload.
//
// The real macro has one shared address/control port per bank, not separate
// read and write ports -- write wins by priority (wr_en ? wr_addr : rd_addr)
// since no real caller today ever asserts wr_en and expects a read in the same
// cycle (write happens during the NoC load phase; reads happen once the
// sequencer starts the compute phase).
//
// Read is now REGISTERED (RD_LATENCY cycles after rd_addr is presented, not
// the same cycle) -- a real SRAM macro's read is synchronous. Issue #33 threads
// RD_LATENCY into gemm_sequencer.v's drain-window sizing.
module operand_mem #(
    parameter N    = 8,
    parameter KMAX = 8
) (
    input  wire                            clk,
    // Load / write port (NoC/DMA delivers this).
    input  wire                            wr_en,
    input  wire [$clog2(N*KMAX)-1:0]       wr_addr,
    input  wire signed [8*N-1:0]           wr_a_col,   // unskewed column of A for this slot
    input  wire signed [8*N-1:0]           wr_b_row,   // matching row of B for this slot
    // Read port (to the sequencer / tile), registered.
    input  wire [$clog2(N*KMAX)-1:0]       rd_addr,
    output wire signed [8*N-1:0]           rd_a_col,
    output wire signed [8*N-1:0]           rd_b_row
);

    localparam RD_LATENCY = 1;  // real SRAM macro: registered (synchronous) read

    wire [$clog2(N*KMAX)-1:0] a_addr = wr_en ? wr_addr : rd_addr;
    wire [$clog2(N*KMAX)-1:0] b_addr = wr_en ? wr_addr : rd_addr;

    sky130_sram_512b_1rw_64x64 a_bank (
        .clk0  (clk),
        .csb0  (1'b0),
        .web0  (~wr_en),
        .addr0 (a_addr),
        .din0  (wr_a_col),
        .dout0 (rd_a_col)
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

- [ ] **Step 2: Run the isolated `tb/operand_mem` suite and confirm all three tests pass**

Run: `cd tb/operand_mem && make`
Expected: PASS — all three tests (`test_write_then_read_all_slots`,
`test_read_latency_is_registered`, `test_banks_are_independent`) pass. If `test_read_latency_is_registered`
still fails, check the write-priority mux and the behavioral macro's `always` block ordering before
touching anything else — those two are the only places a same-cycle vs. next-cycle bug can hide.

- [ ] **Step 3: Add `tb/operand_mem` to `test.sh`**

In `test.sh`, add a new stanza after the `tb/tile` block and before `tb/gemm` (matches the dependency
order: `operand_mem` is `gemm_tile`'s building block, same position `tb/tile` already occupies relative
to `tb/gemm`):

```bash
cd "$REPO_ROOT/tb/tile"
make "$@"

cd "$REPO_ROOT/tb/operand_mem"
make "$@"

cd "$REPO_ROOT/tb/gemm"
make "$@"
```

Update the file's header comment (currently lists `rtl/gemm_sequencer.v via rtl/gemm_tile.v` etc.) to
also mention `rtl/operand_mem.v` by name.

- [ ] **Step 4: Run the full suite and confirm the expected pass/fail split**

Run: `./test.sh`
Expected: `tb/`, `tb/array/`, `tb/tile/`, `tb/operand_mem/`, `tb/router/`, `tb/noc/`, `tb/mesh/` PASS.
`tb/gemm/`, `tb/mnist/` FAIL — this is the expected, documented ripple (their sequencer/tile-level tests
assume the old combinational read timing; issue #33 fixes this by threading `RD_LATENCY` into
`gemm_sequencer.v`). Confirm the failures are specifically about data/timing mismatches downstream of
`operand_mem`'s new latency, not a compile error or a crash unrelated to the latency change — a compile
error would mean something in this task's change is actually broken, not just "expected to go red."

- [ ] **Step 5: Commit**

```bash
git add rtl/operand_mem.v test.sh
git commit -m "Instantiate the sky130 SRAM macro behind operand_mem's port interface (closes #32)

Replaces the combinational flop-array with two sky130_sram_512b_1rw_64x64
bank instances behind a write-priority address mux. Port list is unchanged;
read latency is now RD_LATENCY=1 (registered), verified by a new isolated
tb/operand_mem/ suite against a behavioral macro stand-in.

tb/gemm/ and tb/mnist/ now fail as expected -- their sequencer-level timing
assumes the old same-cycle read; issue #33 threads RD_LATENCY into
gemm_sequencer.v's drain-window sizing to fix this."
```

---

## Self-Review Notes

**Spec coverage:** Section 1 (`rtl/operand_mem.v`) → Task 2. Section 2 (behavioral stand-in) → Task 1.
Section 3 (isolated testbench, all three listed test cases) → Task 1. Section 4 (no changes to
`gemm_tile.v`/`gemm_sequencer.v`/`skew_feeder.v`) → enforced by Global Constraints and Task 2 Step 4's
explicit expected-red check. `test.sh` stanza → Task 2 Step 3.

**Type consistency:** `RD_LATENCY` (Task 2's RTL localparam) matches the `RD_LATENCY` constant used in
Task 1's test file (both = 1) — Task 1 is written first per TDD ordering but references the same name
Task 2 defines, since the test file is what proves the constant's value once Task 2 lands.
`sky130_sram_512b_1rw_64x64`'s port names (`clk0`/`csb0`/`web0`/`addr0`/`din0`/`dout0`) are identical
between Task 1's behavioral model and Task 2's instantiation.
