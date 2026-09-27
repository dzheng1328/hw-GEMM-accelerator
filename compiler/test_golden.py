"""pytest for compiler/golden.py: level 2 of the verification ladder on
random conv stacks and on CIFAR-10, plus the faults and ordering rules."""

import numpy as np
import pytest

import isa
from build import build, cifar_build, run_golden
from cifar_reference import NPZ_PATH, run_int8, run_layers
from golden import Golden, GoldenError
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
    ([isa.loop(2), isa.loop(2)], "LOOP inside an active loop", 1),
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
