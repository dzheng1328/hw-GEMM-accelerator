"""pytest for compiler/emit.py."""

import numpy as np

from build import build
from emit import emit
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
