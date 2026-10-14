"""cocotb testbench for the vector unit's faults (rtl/vpu.v built with
FATAL = 0, so a fault raises the sticky `fault` output instead of ending the
simulation): each command below must raise `fault`, never `done`, leave every
memory port low afterwards, and block every later command until reset.
`make fault-check` runs the same commands with FATAL = 1 and proves each one
ends the simulation (tb/vpu/test_fatal.py)."""

import cocotb
import numpy as np
from cocotb.triggers import FallingEdge, RisingEdge

from vpulib import SUBS, Images, put_i16, put_param, run_op, start_clock


def fault_cases():
    """name -> (image, run_op arguments) for each command that must fault."""
    rng = np.random.default_rng(0xFA17)
    cases = {}

    def image():
        return Images(rng, fill="zero")

    cases["invalid_sub_op_0"] = (image(), dict(sub=0))
    cases["invalid_sub_op_10"] = (image(), dict(sub=10))
    for name in ("EMBED", "ROPE", "KVWRITE", "SOFTMAX", "SAMPLE"):
        cases[f"t_at_context_{name.lower()}"] = (image(), dict(sub=SUBS[name], t=256, plen=1, inv_temp=256))
    img = image()
    put_i16(img.act, 0, [1, 2, 3, 512, 5, 6, 7, 8])  # story 3's token is outside the 512-token vocabulary
    put_param(img, 10, 1 << 15, 8)
    cases["embed_token_outside_vocabulary"] = (img, dict(sub=SUBS["EMBED"], ra=100, rb=2000, rc=10, t=0))
    img = image()
    put_i16(img.act, 0, [1, 2, 3, -1, 5, 6, 7, 8])
    put_param(img, 10, 1 << 15, 8)
    cases["embed_negative_token"] = (img, dict(sub=SUBS["EMBED"], ra=100, rb=2000, rc=10, t=0))
    return cases


@cocotb.test()
async def test_every_fault_stops_the_command_and_blocks_the_next(dut):
    await start_clock(dut)
    for name, (img, args) in fault_cases().items():
        await run_op(dut, img, expect_fault=True, **args)
        # sticky: a valid command is now ignored, with no done and no memory traffic
        before = Images(np.random.default_rng(1), fill="zero")
        await run_op(dut, before, sub=SUBS["ADD"], ra=0, rb=128, expect_fault=True)
        # reset clears it, and the next command runs
        dut.rst.value = 1
        await RisingEdge(dut.clk)
        await RisingEdge(dut.clk)
        dut.rst.value = 0
        await RisingEdge(dut.clk)
        await FallingEdge(dut.clk)
        assert not int(dut.fault.value), f"{name}: reset did not clear the fault"
        ok = Images(np.random.default_rng(2))
        cycles = await run_op(dut, ok, sub=SUBS["TRANSPOSE"], ra=0, rb=100, rc=1)
        assert cycles > 0
        dut._log.info(f"{name}: fault raised, blocked until reset")
