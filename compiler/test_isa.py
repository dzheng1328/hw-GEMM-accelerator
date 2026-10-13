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

def test_block_round_trips_the_register_form_bit():
    b = Block(1, 2, 3, 4, 0, acc_keep=True, relu=True, sh=9, m=12345, reg_form=True)
    assert isa.decode(isa.block(b)) == (isa.BLOCK, b)
    assert "reg_form" in isa.disassemble(isa.block(b))


@pytest.mark.parametrize("field", ["round", "no_ret", "requant"])
def test_a_register_form_block_rejects_the_fields_the_registers_replace(field):
    with pytest.raises(ValueError, match="register-form"):
        isa.block(Block(0, 0, 0, 0, **{"round": 0, field: 1 if field == "round" else True}, reg_form=True))


def test_alu_round_trips_register_and_immediate_forms():
    for op in (isa.ALU_ADD, isa.ALU_SUB, isa.ALU_SHR, isa.ALU_AND):
        for word, want in ((isa.alu(op, 31, 22, src2=17), isa.Alu(op, 31, 22, src2=17)),
                           (isa.alu(op, 5, 0, imm=0xFFFF_FFF8), isa.Alu(op, 5, 0, imm=0xFFFF_FFF8))):
            assert isa.decode(word) == (isa.ALU, want)
    assert isa.decode(isa.alu(isa.ALU_ADD, 3, 3, imm=-1)) == (isa.ALU, isa.Alu(isa.ALU_ADD, 3, 3, imm=0xFFFF_FFFF))
    assert isa.disassemble(isa.alu(isa.ALU_SHR, 25, isa.T, imm=3)) == "ALU r25 = r16 shr 3"


def test_alu_rejects_bad_operands():
    with pytest.raises(ValueError, match="exactly one"):
        isa.alu(isa.ALU_ADD, 1, 1)
    with pytest.raises(ValueError, match="exactly one"):
        isa.alu(isa.ALU_ADD, 1, 1, src2=2, imm=3)
    with pytest.raises(ValueError, match="dst"):
        isa.alu(isa.ALU_ADD, 32, 1, imm=0)
    with pytest.raises(ValueError, match="imm"):
        isa.alu(isa.ALU_ADD, 1, 1, imm=1 << 32)


def test_loopr_and_vop_round_trip():
    assert isa.decode(isa.loopr(27)) == (isa.LOOPR, 27)
    assert isa.disassemble(isa.loopr(27)) == "LOOPR r27"
    for sub in range(1, 10):
        assert isa.decode(isa.vop(sub, 22, 23, 31)) == (isa.VOP, isa.Vop(sub, 22, 23, 31))
    assert isa.disassemble(isa.vop(isa.SOFTMAX, 22, 23, 24)) == "VOP SOFTMAX r22, r23, r24"
    assert isa.disassemble(isa.vop(0)) == "VOP INVALID(0)"
    with pytest.raises(ValueError, match="rc"):
        isa.vop(1, rc=32)


def test_the_new_opcodes_and_registers_do_not_collide_with_the_old_ones():
    assert len({isa.ADD, isa.BLOCK, isa.WAIT, isa.LOOP, isa.ENDLOOP, isa.END, isa.ALU, isa.LOOPR, isa.VOP}) == 9
    assert (isa.T, isa.PLEN, isa.INV_TEMP, isa.ROUND, isa.ROWS, isa.RMODE) == (16, 17, 18, 19, 20, 21)
    assert isa.N_REGS == 16 and isa.N_REGS_LM == 32 and isa.WEIGHT_WORDS == 65536
