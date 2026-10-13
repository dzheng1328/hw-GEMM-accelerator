"""pytest for compiler/golden.py: level 2 of the verification ladder on
random conv stacks and on CIFAR-10, plus the faults and ordering rules."""

import numpy as np
import pytest

import isa
from build import build, cifar_build, run_golden
from cifar_reference import NPZ_PATH, run_int8, run_layers
from golden import Golden, GoldenError, Tracer
from lower import read_buffer, read_output
from nets import NETS, random_net


def net_build(name, mesh, n_images=3, seed=0):
    rng = np.random.default_rng(seed)
    shape, specs = NETS[name]
    q, layers = random_net(rng, shape, specs)
    x = rng.integers(-128, 128, (n_images,) + shape)
    return q, layers, x, build(q, layers, x, *mesh)


@pytest.mark.parametrize("mesh", [(1, 1), (2, 2), (4, 3), (8, 8)])
@pytest.mark.parametrize("name", sorted(NETS))
def test_golden_matches_the_direct_reference(name, mesh):
    q, layers, x, b = net_build(name, mesh)
    act = run_golden(b)
    ref = run_layers(q, layers, x)
    assert len(np.unique(ref[0])) > 20, "test net saturates; the comparison would be weak"
    for n in range(len(x)):
        assert np.array_equal(read_output(b.lowered, act, n), ref[-1][n])
    for i in range(len(layers) - 1):
        assert np.array_equal(read_buffer(b.lowered, act, i), ref[i][-1])


def test_golden_runs_cifar_bit_exact():
    q = np.load(NPZ_PATH)
    images = q["test_images"][:2]
    b = cifar_build(q, images, 2, 2)
    act = run_golden(b)
    ref = run_int8(q, images)
    logits = np.stack([read_output(b.lowered, act, n).reshape(-1) for n in range(2)])
    assert np.array_equal(logits, ref[-1])
    for i in range(len(ref) - 1):
        assert np.array_equal(read_buffer(b.lowered, act, i), ref[i][-1])


def run(b, program=None, mesh=None):
    return Golden(*(mesh or b.mesh), b.program if program is None else program, b.lowered.weights, b.act).run()


def test_a_missing_wait_is_a_read_after_write_hazard():
    b = net_build("small", (2, 2))[-1]
    with pytest.raises(GoldenError, match="before a WAIT"):
        run(b, [w for w in b.program if isa.decode(w)[0] != isa.WAIT])


def test_two_outstanding_writes_to_one_word_fault():
    b = net_build("small", (1, 1))[-1]
    prog = list(b.program)
    i = next(i for i, w in enumerate(prog) if isa.decode(w)[0] == isa.BLOCK and not isa.decode(w)[1].no_ret)
    prog.insert(i + 1, prog[i])
    with pytest.raises(GoldenError, match="also writes"):
        run(b, prog)


def test_a_tile_outside_the_mesh_faults_at_its_pc():
    b = net_build("small", (2, 2))[-1]
    with pytest.raises(GoldenError, match="outside the 1x1 mesh") as e:
        run(b, mesh=(1, 1))
    assert isa.decode(b.program[e.value.pc])[1].tile_x == 1


@pytest.mark.parametrize("program, msg, pc", [
    ([0], "invalid opcode 0", 0),
    ([isa.loop(2)] * 5, "LOOP nested deeper than 4", 4),
    ([isa.loopr(5), isa.end()], "LOOPR count 0", 0),
    ([isa.endloop()], "ENDLOOP without an active LOOP", 0),
    ([isa.LOOP << 60], "LOOP count 0", 0),
    ([isa.loop(2), isa.endloop()], "invalid opcode 0", 2),
])
def test_program_faults(program, msg, pc):
    with pytest.raises(GoldenError, match=msg) as e:
        Golden(1, 1, program, [], []).run()
    assert e.value.pc == pc


def test_a_runaway_program_is_stopped():
    with pytest.raises(GoldenError, match="no END"):
        Golden(1, 1, [isa.loop(0xFFFF), isa.wait(), isa.endloop(), isa.end()], [], []).run(max_commands=1000)


def test_add_wraps_and_r0_stays_zero():
    g = Golden(1, 1, [isa.add(0, 0, 5), isa.add(3, 0, 0xFFFF_FFFF), isa.add(3, 3, 2), isa.end()], [], [])
    g.run()
    assert g.regs[0] == 0 and g.regs[3] == 1


def retap(word, **fields):
    blk = isa.decode(word)[1]
    return isa.block(isa.Block(**{**blk.__dict__, **fields}))


@pytest.mark.parametrize("round_, fields", [
    (2, {"kx0": 0}),  # round 2 of the Cin-128 layer starts at tap 1 = (0, 1)
    (1, {"kx0": 3}),  # kx0 >= KSIZE would carry into ky in a flat counter only
    (18, {"kx0": 1}),  # a round starting in the bias slots must carry (0, 0)
])
def test_a_block_whose_tap_does_not_start_its_round_faults(round_, fields):
    b = net_build("wide", (1, 1), n_images=1)[-1]
    prog = list(b.program)
    i = next(i for i, w in enumerate(prog) if isa.decode(w)[0] == isa.BLOCK and isa.decode(w)[1].round == round_)
    prog[i] = retap(prog[i], **fields)
    with pytest.raises(GoldenError, match="tap") as e:
        run(b, prog)
    assert e.value.pc == i


@pytest.mark.parametrize("name", sorted(NETS))
def test_invalid_lanes_and_padding_cells_stay_zero(name):
    q, layers, x, b = net_build(name, (2, 2))
    act = run_golden(b).view("<i8")
    L = b.lowered.layers[-1]
    cells = act[L.out_base : L.out_base + len(x) * L.out_words].reshape(len(x), L.cout, -1)
    assert not cells[:, :, L.hout * L.wout :].any()


def window_program(stride):
    """One raw BLOCK over a single 64-byte input row, 1x1 kernel."""
    regs = {isa.W_LOG2: 6, isa.WOUT_LOG2: 3, isa.STRIDE: stride, isa.KSIZE: 1, isa.KS: 8,
            isa.BIAS: 1 | (1 << 16), isa.OSTRIDE: 1, isa.OUT_BASE: 64}
    return [isa.add(r, isa.ZERO, v) for r, v in regs.items()] + [isa.block(isa.Block(0, 0, 0, 0, 0)), isa.end()]


def test_a_gather_wider_than_three_words_faults():
    # Stride 2 spreads a slot's 8 lanes over 15 bytes (at most 3 words, one
    # per bank); stride 4 over 29 bytes, four words.
    Golden(1, 1, window_program(2), [], []).run()
    with pytest.raises(GoldenError, match="3 consecutive words"):
        Golden(1, 1, window_program(4), [], []).run()


def test_operands_are_what_a_block_accumulates():
    q, layers, x, b = net_build("wide", (1, 1), n_images=1)
    g = Golden(1, 1, [], b.lowered.weights, b.act)
    L = b.lowered.layers[0]
    for reg, value in L.regs().items():
        g.regs[reg] = value
    blk = isa.Block(0, 0, 0, 3, 2, *L.round_start_tap(2))
    a, bm = g.operands(blk)
    assert a.shape == bm.shape == (64, 8)
    # Round 2 of the Cin-128 layer starts at slot 128: tap 1 = (ky 0, kx 1),
    # channels 0..63. Pixel block 3 of the 8x8 output is row oy = 3, ox = 0..7,
    # so slot 5 reads channel 5 at iy = 2*3 + 0 - 1 = 5, ix = 2*ox + 1 - 1.
    xi = x[0].astype(np.int64)
    assert np.array_equal(bm[5], xi[5, 5, 2 * np.arange(8)])
    assert np.array_equal(a[5], q["l0_w"][0:8, 5, 0, 1])


@pytest.mark.parametrize("name", sorted(NETS))
def test_tracer_records_every_block_and_the_totals(name):
    q, layers, x, b = net_build(name, (2, 2))
    t = Tracer(*b.mesh, b.program, b.lowered.weights, b.act)
    assert np.array_equal(t.run(), run_golden(b))
    L, n = b.lowered.layers, len(x)
    static = sum(isa.decode(w)[0] == isa.BLOCK for w in b.program)
    assert len(t.blocks) == n * static
    assert t.slots == n * sum(p.groups * p.pixel_blocks * p.ks for p in L)
    assert t.wb_words == n * sum(p.out_words for p in L)
    # A WAIT after every layer but the last, per image, then END.
    assert t.epoch == n * (len(L) - 1) + 1
    epochs = [e for _, _, _, e, _ in t.blocks]
    assert epochs == sorted(epochs)
    for pc, blk, regs, epoch, words in t.blocks:
        assert (words is None) == blk.no_ret
        assert len(regs) == isa.N_REGS


def test_result_words_are_where_a_block_writes():
    b = net_build("small", (1, 1), n_images=1)[-1]
    act0 = np.asarray(b.act, dtype="<u8").copy()
    t = Tracer(1, 1, b.program, b.lowered.weights, b.act)
    act = t.run().view("<u8")
    written = np.zeros(len(act), bool)
    for *_, words in t.blocks:
        if words is not None:
            written[words] = True
    changed = np.flatnonzero(act[: len(act0)] != act0)
    assert written[changed].all(), "golden changed a word no BLOCK's result_words covers"


# --- 4.3d: ALU, LOOPR, nested loops, the register-form BLOCK, RESULT16, the row limit ---

def setregs(regs):
    """ALU commands that set registers by name (isa.T, isa.ROUND, ... or r<index>)."""
    return [isa.alu(isa.ALU_ADD, r, 0, imm=v) for r, v in regs.items()]


def run_prog(prog, wmem=(), act=(), mesh=(1, 1)):
    g = Golden(*mesh, prog + [isa.end()], wmem, act)
    g.run()
    return g


def qk_style_setup(wmem_base, in_word, out_word, cin_log2=3, w_log2=3, ks=8, ostride=2, **extra):
    regs = {isa.IN_BASE: in_word * 8, isa.OUT_BASE: out_word, isa.W_BASE: wmem_base, isa.CIN_LOG2: cin_log2,
            isa.H_LOG2: 0, isa.W_LOG2: w_log2, isa.WOUT_LOG2: w_log2, isa.STRIDE: 1, isa.PAD: 0, isa.KSIZE: 1,
            isa.KS: ks, isa.BIAS: ks, isa.OSTRIDE: ostride}
    regs.update(extra)
    return setregs(regs)


def random_mems(seed=0):
    rng = np.random.default_rng(seed)
    wmem = rng.integers(0, 2**63, isa.WEIGHT_WORDS, dtype=np.uint64)
    act = rng.integers(0, 2**63, isa.ACT_WORDS, dtype=np.uint64)
    return wmem, act


def expect_acc(g, wmem, act, w_word, b_words, n=8):
    a = wmem[w_word : w_word + n].view(np.int8).reshape(n, 8).astype(np.int64)
    b = np.stack([act[w : w + 1].view(np.int8).astype(np.int64) for w in b_words])
    return a.T @ b


def test_alu_operations_wrap_and_use_registers_or_immediates():
    g = run_prog([isa.alu(isa.ALU_ADD, 25, 0, imm=0xFFFF_FFF0), isa.alu(isa.ALU_ADD, 26, 25, imm=0x20),
                  isa.alu(isa.ALU_SUB, 27, 0, imm=1), isa.alu(isa.ALU_SHR, 28, 27, imm=28),
                  isa.alu(isa.ALU_AND, 29, 25, imm=0xFFFF_FFF8), isa.alu(isa.ALU_SUB, 30, 26, src2=25),
                  isa.alu(isa.ALU_ADD, 0, 0, imm=7), isa.alu(isa.ALU_SHR, 31, 25, imm=33)])
    assert g.regs[26] == 0x10 and g.regs[27] == 0xFFFF_FFFF and g.regs[28] == 0xF
    assert g.regs[29] == 0xFFFF_FFF0 and g.regs[30] == 0x20 and g.regs[0] == 0
    assert g.regs[31] == 0x7FFF_FFF8  # a shift count is taken mod 32


def test_nested_loops_run_four_deep_and_loopr_takes_its_count_from_a_register():
    g = run_prog([
        isa.alu(isa.ALU_ADD, 25, 0, imm=3),
        isa.loop(2), isa.loop(2), isa.loop(2), isa.loopr(25),
        isa.alu(isa.ALU_ADD, 26, 26, imm=1),
        isa.endloop(), isa.endloop(), isa.endloop(), isa.endloop()])
    assert g.regs[26] == 2 * 2 * 2 * 3


def test_a_loopr_count_of_zero_faults_like_loop_zero():
    """The compiler never emits a zero count (nblk and rounds are at least 1), so, like LOOP 0, it is a
    fault rather than a skip that the RTL's sequencer would have to scan ahead for."""
    prog = [isa.loopr(25), isa.alu(isa.ALU_ADD, 26, 26, imm=1), isa.endloop()]
    with pytest.raises(GoldenError, match="LOOPR count 0") as e:
        run_prog(prog)
    assert e.value.pc == 0


def test_a_loopr_count_that_does_not_fit_16_bits_faults():
    with pytest.raises(GoldenError, match="does not fit in 16 bits"):
        run_prog([isa.alu(isa.ALU_ADD, 25, 0, imm=1 << 16), isa.loopr(25), isa.endloop()])


def test_the_golden_register_file_is_32_wide_but_a_tracer_reports_the_hardware_16():
    prog = [isa.alu(isa.ALU_ADD, 25, 0, imm=3)] + qk_style_setup(0, 0, 100) + [
        isa.block(isa.Block(0, 0, 0, 0, 0, no_ret=True)), isa.end()]
    g = Tracer(1, 1, prog, [], [])
    g.run()
    assert len(g.regs) == isa.N_REGS_LM and g.regs[25] == 3
    assert len(g.blocks[0][2]) == isa.N_REGS


@pytest.mark.parametrize("sub", [0, 10, 15])
def test_an_invalid_vop_sub_op_faults(sub):
    with pytest.raises(GoldenError, match=f"invalid VOP sub-op {sub}"):
        Golden(1, 1, [isa.vop(sub), isa.end()], [], []).run()


def test_register_form_result16_lands_two_words_per_row_with_the_row_limit():
    wmem, act = random_mems(1)
    wmem[700:708] &= 0x0303030303030303  # keep the products small
    for r in range(8):
        act[1000 + r] &= 0x0F0F0F0F0F0F0F0F
    m, sh = 40000, 6
    prog = qk_style_setup(700, 1000, 3000) + setregs({isa.ROUND: 0, isa.ROWS: 1, isa.RMODE: isa.RMODE_Q16}) \
        + [isa.block(isa.Block(0, 0, 0, 0, 0, sh=sh, m=m, reg_form=True))]
    g = run_prog(prog, wmem, act)
    acc = expect_acc(g, wmem, act, 700, range(1000, 1008))
    want = np.clip((acc * m + (1 << (sh - 1))) >> sh, -32768, 32767)
    got = g.actw[3000:3004].view("<i2").reshape(2, 8)
    assert np.array_equal(got, want[:2]) and want[:2].any()
    assert np.array_equal(g.actw[3004:3008], act[3004:3008]), "rows past the limit must not be written"


def test_result16_saturates_at_both_int16_rails():
    wmem, act = random_mems(5)
    wmem[700:708] = 0x7F7F7F7F7F7F7F7F  # every A column 127
    act[1000:1008] = 0x817F817F817F817F  # lanes alternate +127, -127: |acc| = 8 * 127 * 127
    prog = qk_style_setup(700, 1000, 3000) + setregs({isa.ROUND: 0, isa.ROWS: 7, isa.RMODE: isa.RMODE_Q16}) \
        + [isa.block(isa.Block(0, 0, 0, 0, 0, sh=0, m=0xFFFF, reg_form=True))]
    g = run_prog(prog, wmem, act)
    got = g.actw[3000:3016].view("<i2").reshape(8, 8)
    assert (got[:, 0::2] == 32767).all() and (got[:, 1::2] == -32768).all()


def test_register_form_modes_raw_result8_and_the_flags_come_from_the_registers():
    wmem, act = random_mems(2)
    wmem[700:708] &= 0x0303030303030303
    for r in range(8):
        act[1000 + r] &= 0x0F0F0F0F0F0F0F0F
    base = qk_style_setup(700, 1000, 3000, ostride=1)
    blk = isa.block(isa.Block(0, 0, 0, 0, 0, sh=4, m=60000, relu=True, reg_form=True))
    g = run_prog(base + setregs({isa.ROUND: 0, isa.ROWS: 7, isa.RMODE: isa.RMODE_Q8}) + [blk], wmem, act)
    acc = expect_acc(g, wmem, act, 700, range(1000, 1008))
    want = np.clip((acc * 60000 + 8) >> 4, 0, 127)  # relu applies to RESULT8
    assert np.array_equal(g.act[3000 * 8 : 3008 * 8].view(np.int8).reshape(8, 8), want)
    g = run_prog(base + setregs({isa.ROUND: 0, isa.ROWS: 2, isa.RMODE: isa.RMODE_RAW}) + [blk], wmem, act)
    assert np.array_equal(g.actw[3000 : 3000 + 24].view(np.int64).reshape(3, 8), acc[:3])


def test_register_form_rounds_accumulate_and_only_the_last_returns():
    wmem, act = random_mems(3)
    wmem[700:700 + 136] &= 0x0101010101010101
    for r in range(256):
        act[1000 + r] &= 0x0707070707070707
    regs = dict(cin_log2=8, w_log2=3, ks=136, ostride=8)
    prog = qk_style_setup(700, 1000, 3000, **regs)
    prog += setregs({isa.ROWS: 1, isa.RMODE: isa.RMODE_Q8})
    for rnd in range(3):
        prog += setregs({isa.ROUND: rnd}) + [isa.block(isa.Block(0, 0, 0, 0, 0, sh=3, m=30000, reg_form=True))]
    g = run_prog(prog, wmem, act)
    acc = expect_acc(g, wmem, act, 700, range(1000, 1136), n=136)
    want = np.clip((acc * 30000 + 4) >> 3, -128, 127)
    got = g.act[3000 * 8 : 3000 * 8 + 8].view(np.int8)
    assert np.array_equal(got, want[0]) and np.array_equal(g.actw[3001:3008], act[3001:3008])
    assert np.array_equal(g.act[3008 * 8 : 3008 * 8 + 8].view(np.int8), want[1])


@pytest.mark.parametrize("regs, msg", [
    ({isa.ROWS: 8}, "ROWS 8 out of range"),
    ({isa.RMODE: 3}, "RMODE 3 out of range"),
    ({isa.ROUND: 128}, "ROUND 128 out of range"),
])
def test_register_form_registers_out_of_range_fault_at_the_block(regs, msg):
    prog = qk_style_setup(0, 0, 100) + setregs(regs) + [isa.block(isa.Block(0, 0, 0, 0, 0, reg_form=True))]
    with pytest.raises(GoldenError, match=msg) as e:
        run_prog(prog)
    assert e.value.pc == len(prog) - 1


def test_a_register_form_block_with_acc_keep_adds_to_the_previous_block_at_round_zero():
    wmem, act = random_mems(4)
    wmem[700:708] &= 0x0101010101010101
    for r in range(8):
        act[1000 + r] &= 0x0707070707070707
    prog = qk_style_setup(700, 1000, 3000) + setregs({isa.ROUND: 0, isa.ROWS: 7, isa.RMODE: isa.RMODE_Q16})
    prog += [isa.block(isa.Block(0, 0, 0, 0, 0, no_ret=True)),
             isa.block(isa.Block(0, 0, 0, 0, 0, acc_keep=True, sh=0, m=1, reg_form=True))]
    g = run_prog(prog, wmem, act)
    acc = 2 * expect_acc(g, wmem, act, 700, range(1000, 1008))
    assert np.array_equal(g.actw[3000:3016].view("<i2").reshape(8, 8), acc)
