"""cocotb testbench for rtl/pe.v -- the systolic array MAC processing element.

Phase 1 smoke test: after a synchronous reset pulse, acc_out must read
back as zero.
"""

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge


async def reset_dut(dut, cycles=2):
    dut.reset.value = 1
    dut.valid_in.value = 0
    dut.a_in.value = 0
    dut.b_in.value = 0
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.reset.value = 0


@cocotb.test()
async def test_reset_clears_accumulator(dut):
    clock = Clock(dut.clk, 10, units="ns")  # 100 MHz
    cocotb.start_soon(clock.start())

    await reset_dut(dut)
    await RisingEdge(dut.clk)

    assert dut.acc_out.value == 0, (
        f"acc_out should be 0 after reset, got {dut.acc_out.value}"
    )
