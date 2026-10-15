"""pytest for compiler/emit.py."""

import numpy as np

from build import build
from check_lm import RANDOM_PROMPT, RANDOM_SEEDS
from emit import emit, images
from lm_reference import random_quantized
from lower_lm import lm_build
from nets import NETS, random_net


def test_emit_writes_readmemh_images(tmp_path):
    rng = np.random.default_rng(0)
    shape, specs = NETS["small"]
    q, layers = random_net(rng, shape, specs)
    b = build(q, layers, rng.integers(-128, 128, (2,) + shape), 2, 2)
    paths = emit(tmp_path, b)

    def words(name):
        lines = paths[name].read_text().splitlines()
        assert all(len(line) == 16 for line in lines)
        return [int(line, 16) for line in lines]

    assert words("program.hex") == b.program
    assert words("weights.hex") == [int(w) for w in b.lowered.weights]
    banks = [words(f"act_bank{i}.hex") for i in range(4)]
    assert all(len(bank) == -(-len(b.act) // 4) for bank in banks)
    assert banks[2][1] == int(b.act[6]) and banks[1][0] == int(b.act[1]) and banks[3][2] == int(b.act[11])


def test_emit_writes_a_story_model_build_with_its_a_memory_as_the_weights_image(tmp_path):
    b = lm_build(random_quantized(0), 1, 1, 6, 0, RANDOM_PROMPT, RANDOM_SEEDS)
    program, weights, act = images(b)
    assert program is b.program and weights is b.a_mem and act is b.act
    paths = emit(tmp_path, b)
    lines = paths["weights.hex"].read_text().splitlines()
    assert len(lines) == len(b.a_mem) and int(lines[5], 16) == int(b.a_mem[5])
    assert [int(x, 16) for x in paths["program.hex"].read_text().splitlines()] == b.program
