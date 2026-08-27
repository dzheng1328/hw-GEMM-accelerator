"""cocotb testbench for rtl/pe.v -- the systolic array MAC processing element.

Verifies reset behavior and multiply-accumulate correctness (including
negative operands, valid_in gating, and a randomized fuzz sweep).
"""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer


async def reset_dut(dut, cycles=2):
    dut.reset.value = 1
    dut.valid_in.value = 0
    dut.a_in.value = 0
    dut.b_in.value = 0
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.reset.value = 0


def to_signed32(value: int) -> int:
    """Wrap a Python int into the RTL accumulator's 32-bit two's-complement
    range, mirroring `acc_out <= acc_out + (a_in * b_in)` (reg signed [31:0],
    no saturation -- silent modulo-2**32 wraparound on overflow)."""
    value &= 0xFFFFFFFF
    if value & 0x80000000:
        value -= 0x100000000
    return value


def numpy_mac_reference(terms):
    """Given an ordered list of (a_in, b_in) int8 pairs, return the expected
    acc_out after each successive term, matching the RTL's running MAC.

    Operands are explicitly upcast to np.int64 before multiplying/adding so
    NumPy's own int8/int16 default-dtype overflow rules can never silently
    corrupt the *reference* model (a distinct failure mode from any RTL bug).
    The RTL's actual 32-bit wraparound is applied deliberately via
    to_signed32, not left to incidental NumPy overflow behavior.
    """
    acc = np.int64(0)
    running = []
    for a, b in terms:
        acc = acc + np.int64(a) * np.int64(b)
        running.append(to_signed32(int(acc)))
    return running


# (a_in, b_in, description) -- covers all four sign quadrants, the int8
# boundary values, and zero-operand cases.
DIRECTED_CASES = [
    (5, 7, "small positive x positive"),
    (-5, 7, "small negative x positive (a_in sign-extension canary)"),
    (5, -7, "small positive x negative (b_in sign-extension canary)"),
    (-5, -7, "small negative x negative -> positive product"),
    (-128, 127,
     "int8 min x int8 max: if signedness were lost, unsigned 0x80=128 "
     "would give 128*127=16256 instead of the correct -16256"),
    (127, -128, "same canary as above with operands swapped"),
    (-128, -128,
     "int8 min x int8 min: -128 has no positive int8 counterpart; "
     "exercises sign-extension of the boundary value on both ports"),
    (127, 127, "int8 max x int8 max: largest legitimate positive product"),
    (-1, -1,
     "0xFF x 0xFF as signed -1 x -1 = 1; distinct bit-pattern canary from "
     "-128 -- unsigned reading would give 255*255=65025"),
    (0, 127, "zero x positive: multiply-by-zero must not leak b_in through"),
    (127, 0, "positive x zero, operands swapped"),
    (0, -128, "zero must dominate even against the -128 boundary value"),
    (0, 0, "zero x zero baseline"),
]

ACCUMULATION_TERMS = [
    (5, 7), (-5, 7), (5, -7), (-5, -7),
    (-128, 127), (127, -128), (-128, -128), (127, 127),
    (-1, -1), (0, 100), (100, 0), (3, 3),
]

RANDOM_SEED = 0xC0C07B  # fixed, independent of cocotb's own ambient seed
RANDOM_ITERATIONS = 200
ACC_LATENCY = 2


@cocotb.test()
async def test_reset_clears_accumulator(dut):
    clock = Clock(dut.clk, 10, units="ns")  # 100 MHz
    cocotb.start_soon(clock.start())
    await reset_dut(dut)
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")  # settle past the NBA update, still allows writes after
    assert dut.acc_out.value == 0, (
        f"acc_out should be 0 after reset, got {dut.acc_out.value}"
    )


@cocotb.test()
async def test_mac_directed_products(dut):
    """One (a_in, b_in) pair per reset, across all four sign quadrants plus
    int8 boundary and zero-operand cases. Checks acc_out after exactly one
    valid_in=1 cycle against the exact integer product (no wraparound
    possible here: max |a*b| = 128*128 = 16384, far under 2**31)."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())

    for a, b, description in DIRECTED_CASES:
        await reset_dut(dut)
        dut.valid_in.value = 1
        dut.a_in.value = a
        dut.b_in.value = b
        await RisingEdge(dut.clk)          # pipe_valid<=1, prod_reg<=a*b
        await Timer(1, units="ns")
        dut.valid_in.value = 0
        await RisingEdge(dut.clk)          # acc_out <= acc_out + prod_reg (ACC_LATENCY=2)
        await Timer(1, units="ns")

        expected = a * b
        got = dut.acc_out.value.signed_integer
        assert got == expected, (
            f"{description}: a_in={a}, b_in={b} -> acc_out={got}, "
            f"expected {expected}"
        )


@cocotb.test()
async def test_mac_running_accumulation(dut):
    """Drive a sequence of terms over consecutive cycles (no reset between
    them) and check the running acc_out, offset by the pipeline's 2-cycle
    ACC_LATENCY, against a NumPy reference model."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())
    await reset_dut(dut)

    expected_running = numpy_mac_reference(ACCUMULATION_TERMS)
    observed = []

    # Prime the pipeline with a reset-settle cycle so observed[k+ACC_LATENCY]
    # aligns correctly: the k-th input appears at observed[k+ACC_LATENCY].
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")
    observed.append(dut.acc_out.value.signed_integer)

    dut.valid_in.value = 1
    for a, b in ACCUMULATION_TERMS:
        dut.a_in.value = a
        dut.b_in.value = b
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
        observed.append(dut.acc_out.value.signed_integer)

    dut.valid_in.value = 0
    for _ in range(ACC_LATENCY):
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
        observed.append(dut.acc_out.value.signed_integer)

    # acc_out reflects term k only ACC_LATENCY cycles after it's fed.
    for k, expected in enumerate(expected_running):
        got = observed[k + ACC_LATENCY]
        assert got == expected, (
            f"after term {k} (lagged by ACC_LATENCY={ACC_LATENCY} cycles): "
            f"acc_out={got}, expected {expected} (running total diverged mid-sequence)"
        )


@cocotb.test()
async def test_valid_in_gates_accumulation(dut):
    """valid_in=0 must hold acc_out constant regardless of a_in/b_in."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())
    await reset_dut(dut)

    dut.valid_in.value = 1
    dut.a_in.value = 6
    dut.b_in.value = 7
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")
    dut.valid_in.value = 0
    for _ in range(ACC_LATENCY - 1):
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
    held_value = dut.acc_out.value.signed_integer
    assert held_value == 42, f"setup MAC failed: got {held_value}"
    for a, b in [(1, 1), (-128, 127), (100, 100)]:
        dut.a_in.value = a
        dut.b_in.value = b
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")  # settle past the NBA update, still allows writes after
        got = dut.acc_out.value.signed_integer
        assert got == held_value, (
            f"valid_in=0 but acc_out changed: got {got}, expected it to "
            f"stay at {held_value} (a_in={a}, b_in={b} should be ignored)"
        )


@cocotb.test()
async def test_mac_random_products(dut):
    """Randomized single-shot MAC fuzz test over the full int8 x int8 space.
    Resets between draws so any failure stays isolated to one (a, b) pair.
    Seeded explicitly (independent of cocotb's own COCOTB_RANDOM_SEED) for
    reproducible failures."""
    clock = Clock(dut.clk, 10, units="ns")
    cocotb.start_soon(clock.start())

    rng = random.Random(RANDOM_SEED)

    for _ in range(RANDOM_ITERATIONS):
        a = rng.randint(-128, 127)
        b = rng.randint(-128, 127)

        await reset_dut(dut)
        dut.valid_in.value = 1
        dut.a_in.value = a
        dut.b_in.value = b
        await RisingEdge(dut.clk)          # pipe_valid<=1, prod_reg<=a*b
        await Timer(1, units="ns")
        dut.valid_in.value = 0
        await RisingEdge(dut.clk)          # acc_out <= acc_out + prod_reg (ACC_LATENCY=2)
        await Timer(1, units="ns")

        expected = a * b
        got = dut.acc_out.value.signed_integer
        assert got == expected, (
            f"random case (seed={RANDOM_SEED}) a_in={a}, b_in={b} -> "
            f"acc_out={got}, expected {expected}"
        )
