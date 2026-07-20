"""cocotb testbench for rtl/router.v -- a single 2D-mesh NoC router.

Covers the three jobs of the "Design a simple NoC router" card (and most of the
"Verify routing + arbitration" card): XY dimension-order routing to every
output port, round-robin fairness when inputs contend for one output, and
valid/ready backpressure.

The router at test is at mesh coordinate (MY_X, MY_Y) = (1, 1). Ports are
indexed LOCAL=0, NORTH=1, EAST=2, SOUTH=3, WEST=4.
"""

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

AW = 2
PW = 64  # must match rtl/router.v's PW default
FW = PW + 2 * AW
NP = 5
LOCAL, NORTH, EAST, SOUTH, WEST = 0, 1, 2, 3, 4
MY_X, MY_Y = 1, 1


def make_flit(dest_x, dest_y, payload):
    """Pack {payload, dest_y, dest_x} with dest_x in the low bits."""
    return (payload << (2 * AW)) | ((dest_y & ((1 << AW) - 1)) << AW) | (dest_x & ((1 << AW) - 1))


def pack_bus(per_port):
    """Pack a list of NP per-port FW-bit values into the flattened in_flit bus
    (port p in bits [p*FW +: FW])."""
    bus = 0
    for p, v in enumerate(per_port):
        bus |= (v & ((1 << FW) - 1)) << (p * FW)
    return bus


def get_out_flit(dut, port):
    raw = dut.out_flit.value.integer
    return (raw >> (port * FW)) & ((1 << FW) - 1)


async def drive_idle(dut):
    dut.in_valid.value = 0
    dut.in_flit.value = 0
    dut.out_ready.value = (1 << NP) - 1  # all outputs ready by default


async def reset(dut):
    dut.my_x.value = MY_X
    dut.my_y.value = MY_Y
    dut.rst.value = 1
    await drive_idle(dut)
    for _ in range(2):
        await RisingEdge(dut.clk)
    dut.rst.value = 0
    await RisingEdge(dut.clk)


@cocotb.test()
async def test_xy_routing_all_directions(dut):
    """A single flit on the WEST input, destined to each of the five reachable
    targets, must leave on the XY-correct output port with its payload intact."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset(dut)

    # (dest_x, dest_y) -> expected output port, given the router is at (1,1).
    cases = [
        ((2, 1), EAST),
        ((0, 1), WEST),
        ((1, 2), NORTH),
        ((1, 0), SOUTH),
        ((1, 1), LOCAL),
    ]
    for (dx, dy), exp_port in cases:
        payload = 0xABC0 + (dx << 2) + dy
        flit = make_flit(dx, dy, payload)
        flits = [0] * NP
        flits[WEST] = flit
        dut.in_flit.value = pack_bus(flits)
        dut.in_valid.value = 1 << WEST
        await Timer(1, units="ns")  # settle the combinational crossbar

        ov = dut.out_valid.value.integer
        assert ov == (1 << exp_port), (
            f"dest ({dx},{dy}): out_valid={ov:05b}, expected only port {exp_port} set"
        )
        got_payload = get_out_flit(dut, exp_port) >> (2 * AW)
        assert got_payload == payload, (
            f"dest ({dx},{dy}): payload {got_payload:#x} != sent {payload:#x}"
        )
        assert dut.in_ready.value.integer == (1 << WEST), "sender should be accepted"
        await RisingEdge(dut.clk)

    await drive_idle(dut)


@cocotb.test()
async def test_round_robin_arbitration(dut):
    """EAST and WEST inputs both target LOCAL every cycle with LOCAL ready. The
    round-robin arbiter must alternate the winner and never starve either, and
    only the winner may be accepted (in_ready)."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset(dut)

    flits = [0] * NP
    flits[EAST] = make_flit(MY_X, MY_Y, 0xE)  # -> LOCAL
    flits[WEST] = make_flit(MY_X, MY_Y, 0xF)  # -> LOCAL
    dut.in_flit.value = pack_bus(flits)
    dut.in_valid.value = (1 << EAST) | (1 << WEST)
    dut.out_ready.value = (1 << NP) - 1

    winners = []
    for _ in range(6):
        await Timer(1, units="ns")
        assert dut.out_valid.value.integer == (1 << LOCAL), "exactly LOCAL should win"
        inr = dut.in_ready.value.integer
        assert bin(inr).count("1") == 1, f"exactly one input accepted, got {inr:05b}"
        winners.append(EAST if (inr >> EAST) & 1 else WEST)
        await RisingEdge(dut.clk)

    # Must alternate (round-robin), so both appear and no long starvation.
    assert EAST in winners and WEST in winners, f"one input starved: {winners}"
    assert all(winners[i] != winners[i + 1] for i in range(len(winners) - 1)), (
        f"not alternating (round-robin broken): {winners}"
    )

    await drive_idle(dut)


@cocotb.test()
async def test_backpressure(dut):
    """When the destination output is not ready, the input must NOT be accepted
    (in_ready low) even though the output still offers the flit (out_valid high)."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset(dut)

    flits = [0] * NP
    flits[WEST] = make_flit(2, 1, 0x55)  # -> EAST
    dut.in_flit.value = pack_bus(flits)
    dut.in_valid.value = 1 << WEST
    dut.out_ready.value = (1 << NP) - 1 & ~(1 << EAST)  # EAST not ready
    await Timer(1, units="ns")

    assert (dut.out_valid.value.integer >> EAST) & 1 == 1, "output should still offer the flit"
    assert dut.in_ready.value.integer == 0, "sender must be held off when EAST not ready"

    # Now make EAST ready: the transfer completes.
    dut.out_ready.value = (1 << NP) - 1
    await Timer(1, units="ns")
    assert dut.in_ready.value.integer == (1 << WEST), "sender accepted once EAST is ready"

    await drive_idle(dut)
