"""cocotb testbench for rtl/operand_mem.v -- exercises the module in isolation
against tb/operand_mem/sram_macro_behavioral.v (the real OpenRAM macro's
behavioral stand-in), not through the full tile. Covers: write-then-read data
integrity on both banks, the macro's RD_LATENCY=1 registered read timing, and
bank independence (a_ram/b_ram don't cross-talk).
"""

import random

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

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
    await Timer(1, units="ns")
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
