"""pytest for compiler/schedule.py."""

from collections import defaultdict

import numpy as np
import pytest

import isa
from build import build
from cifar_reference import NPZ_PATH
from cifar_spec import LAYERS
from lower import lower
from nets import NETS, random_net
from schedule import schedule


def test_cifar_program_outline():
    lw = lower(np.load(NPZ_PATH), LAYERS, (4, 32, 32), 128)
    ops = [isa.decode(w) for w in schedule(lw, 2, 2)]
    assert sum(op == isa.BLOCK for op, _ in ops) == sum(L.groups * L.pixel_blocks * L.rounds for L in lw.layers) == 2370
    assert sum(op == isa.WAIT for op, _ in ops) == 5
    assert ops[:3] == [(isa.ADD, (isa.IMG_IN, 0, 0)), (isa.ADD, (isa.IMG_OUT, 0, lw.mem.output_base)), (isa.LOOP, 128)]
    assert [op for op, _ in ops[-4:]] == [isa.ADD, isa.ADD, isa.ENDLOOP, isa.END]
    assert ops[-4][1] == (isa.IMG_IN, isa.IMG_IN, 512 * 8) and ops[-3][1] == (isa.IMG_OUT, isa.IMG_OUT, 128)
    assert len(ops) == 2460


@pytest.mark.parametrize("mesh", [(1, 1), (2, 2), (4, 3), (8, 8)])
def test_every_block_runs_its_rounds_in_order_on_one_tile(mesh):
    shape, specs = NETS["wide"]
    q, layers = random_net(np.random.default_rng(0), shape, specs)
    b = build(q, layers, np.zeros((1,) + shape, dtype=np.int64), *mesh)
    layer, seen, open_on_tile = -1, defaultdict(list), {}
    for op, arg in map(isa.decode, b.program):
        if op == isa.ADD and arg[0] == isa.W_BASE:
            layer += 1
        if op != isa.BLOCK:
            continue
        L = b.lowered.layers[layer]
        key = (layer, arg.group, arg.pixel_block)
        tile = (arg.tile_x, arg.tile_y)
        assert tile[0] < mesh[0] and tile[1] < mesh[1]
        assert open_on_tile.get(tile, key) == key, "another block's partial sum is still in this tile"
        r = len(seen[key])
        final = r == L.rounds - 1
        assert arg.round == r and (arg.ky0, arg.kx0) == L.round_start_tap(r)
        assert (arg.acc_keep, arg.no_ret) == (r > 0, not final)
        assert arg.requant == arg.relu == (final and not L.raw)
        assert (arg.m, arg.sh) == ((L.m[arg.group], L.sh[arg.group]) if arg.requant else (0, 0))
        seen[key].append(tile)
        if final:
            open_on_tile.pop(tile, None)
        else:
            open_on_tile[tile] = key
    for key, tiles in seen.items():
        assert len(set(tiles)) == 1 and len(tiles) == b.lowered.layers[key[0]].rounds
    assert len(seen) == sum(L.groups * L.pixel_blocks for L in b.lowered.layers)


def test_program_memory_overflow_is_a_compile_error(monkeypatch):
    shape, specs = NETS["small"]
    lw = lower(*random_net(np.random.default_rng(0), shape, specs), shape, 1)
    monkeypatch.setattr(isa, "PROGRAM_WORDS", 50)
    with pytest.raises(ValueError, match="program memory"):
        schedule(lw, 1, 1)


def test_mesh_size_limits():
    shape, specs = NETS["small"]
    lw = lower(*random_net(np.random.default_rng(0), shape, specs), shape, 1)
    with pytest.raises(ValueError, match="mesh"):
        schedule(lw, 9, 1)
