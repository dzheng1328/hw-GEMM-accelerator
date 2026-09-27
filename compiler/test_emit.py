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
    even, odd = words("act_even.hex"), words("act_odd.hex")
    assert len(even) == len(odd) == -(-len(b.act) // 2)
    assert even[1] == int(b.act[2]) and odd[0] == int(b.act[1])
