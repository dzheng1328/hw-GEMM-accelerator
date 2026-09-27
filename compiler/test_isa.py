"""pytest for compiler/isa.py."""

from functools import reduce
from operator import or_

import pytest

import isa
from isa import Block


def test_block_round_trips_every_field_at_its_limits():
    hi = Block(tile_x=7, tile_y=7, group=63, pixel_block=255, round=127, ky0=7, kx0=7,
               acc_keep=True, no_ret=True, requant=True, relu=True, sh=63, m=0xFFFF)
    for b in (hi, Block(0, 0, 0, 0, 0), Block(1, 2, 3, 4, 5, 6, 7, relu=True, sh=9, m=12345)):
        assert isa.decode(isa.block(b)) == (isa.BLOCK, b)


def test_block_fields_are_disjoint_and_below_the_opcode():
    masks = [((1 << width) - 1) << lsb for lsb, width in isa.BLOCK_FIELDS.values()]
    assert sum(masks) == reduce(or_, masks) and max(masks) < 1 << 60


def test_out_of_range_fields_are_rejected():
    with pytest.raises(ValueError, match="group"):
        isa.block(Block(0, 0, 64, 0, 0))
    with pytest.raises(ValueError, match="count"):
        isa.loop(1 << 16)
    with pytest.raises(ValueError, match="at least 1"):
        isa.loop(0)
    with pytest.raises(ValueError, match="dst"):
        isa.add(16, 0, 0)
    with pytest.raises(ValueError, match="imm"):
        isa.add(1, 0, 1 << 32)


def test_add_stores_imm_as_32_bit_twos_complement():
    assert isa.decode(isa.add(3, 14, -8)) == (isa.ADD, (3, 14, 0xFFFF_FFF8))


def test_simple_commands_and_disassembly():
    assert isa.decode(isa.loop(5)) == (isa.LOOP, 5)
    assert [isa.decode(w)[0] for w in (isa.wait(), isa.endloop(), isa.end())] == [isa.WAIT, isa.ENDLOOP, isa.END]
    assert isa.decode(0) == (0, None)
    assert isa.disassemble(0) == "INVALID 0000000000000000"
    assert isa.disassemble(isa.add(1, 14, 0)) == "ADD r1, r14, 0"
    text = isa.disassemble(isa.block(Block(1, 0, 2, 3, 4, acc_keep=True, no_ret=True)))
    assert text == "BLOCK tile=(1,0) g=2 pb=3 r=4 tap0=(0,0) m=0 sh=0 acc_keep,no_ret"


@pytest.mark.parametrize("args, out", [
    ((4, 32, 32, 16, 3, 1, 1), (32, 32)),
    ((16, 32, 32, 32, 3, 2, 1), (16, 16)),
    ((64, 8, 8, 16, 8, 1, 0), (1, 1)),
    ((128, 16, 16, 8, 1, 2, 0), (8, 8)),
])
def test_check_shape_accepts(args, out):
    assert isa.check_shape("t", *args) == out


@pytest.mark.parametrize("args, msg", [
    ((3, 32, 32, 16, 3, 1, 1), "powers of two"),
    ((4, 8, 4, 16, 3, 1, 1), "multiple of 8"),
    ((4, 32, 32, 12, 3, 1, 1), "Cout"),
    ((4, 32, 32, 16, 3, 3, 1), "stride"),
    ((4, 32, 32, 16, 9, 1, 1), "KSIZE"),
    ((8, 16, 16, 8, 3, 1, 0), "Wout"),
    ((8, 16, 8, 8, 8, 1, 0), "Hout=1"),
    ((4, 64, 64, 8, 3, 1, 1), "pixel blocks"),
])
def test_check_shape_rejects(args, msg):
    with pytest.raises(isa.ShapeError, match=msg):
        isa.check_shape("t", *args)
