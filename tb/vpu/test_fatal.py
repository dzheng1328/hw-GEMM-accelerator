"""One probe of `make fault-check`: rtl/vpu.v built with FATAL = 1 must end
the simulation on the command named by $VPU_PROBE (a name from
test_faults.fault_cases, or start_while_busy). The Makefile passes only if
the run fails AND the log names the VPU's own $fatal message."""

import os

import cocotb
import numpy as np
from cocotb.triggers import RisingEdge

from test_faults import fault_cases
from vpulib import SUBS, Images, run_op, start_clock


@cocotb.test()
async def test_probe(dut):
    await start_clock(dut)
    probe = os.environ["VPU_PROBE"]
    if probe == "start_while_busy":
        dut.sub.value, dut.start.value = SUBS["ADD"], 1
        await RisingEdge(dut.clk)
        await RisingEdge(dut.clk)
        await RisingEdge(dut.clk)  # the second start pulse lands while the first command runs
        dut.start.value = 0
        await RisingEdge(dut.clk)
        return
    img, args = fault_cases()[probe]
    await run_op(dut, img, expect_fault=True, **args)
    raise AssertionError(f"{probe}: the simulation did not stop")
