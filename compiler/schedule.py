"""Static schedule of a lowered network onto a WxH mesh (spec section 4).

Each layer's output blocks go round-robin to the tiles in waves of W*H, and
each wave is emitted round-major, so a tile's next round of operands
streams while the other tiles compute. A block's rounds all run on one
tile, in order, and nothing else runs on that tile in between (its
accumulator holds the partial sum). A WAIT follows every layer but the
last, since the next layer reads its output; the whole network sits in a
LOOP over images, with the first layer's input and the last layer's output
addressed through the per-image pointers IMG_IN and IMG_OUT."""

import isa
from isa import Block


def schedule(lowered, mesh_w, mesh_h):
    if not (1 <= mesh_w <= isa.MAX_MESH and 1 <= mesh_h <= isa.MAX_MESH):
        raise ValueError(f"mesh {mesh_w}x{mesh_h} outside 1x1..{isa.MAX_MESH}x{isa.MAX_MESH}")
    mem, layers = lowered.mem, lowered.layers
    tiles = [(t % mesh_w, t // mesh_w) for t in range(mesh_w * mesh_h)]
    prog = [isa.add(isa.IMG_IN, isa.ZERO, mem.input_base * isa.TILE),
            isa.add(isa.IMG_OUT, isa.ZERO, mem.output_base),
            isa.loop(mem.n_images)]
    for i, L in enumerate(layers):
        prog += _setup(L, first=i == 0, last=i == len(layers) - 1)
        prog += _blocks(L, tiles)
        if i < len(layers) - 1:
            prog.append(isa.wait())
    prog += [isa.add(isa.IMG_IN, isa.IMG_IN, mem.input_words * isa.TILE),
             isa.add(isa.IMG_OUT, isa.IMG_OUT, mem.output_words),
             isa.endloop(), isa.end()]
    if len(prog) > isa.PROGRAM_WORDS:
        raise ValueError(f"program needs {len(prog)} words; program memory holds {isa.PROGRAM_WORDS}")
    return prog


def _setup(L, first, last):
    prog = []
    for reg, value in L.regs().items():
        if reg == isa.IN_BASE and first:
            prog.append(isa.add(reg, isa.IMG_IN, 0))
        elif reg == isa.OUT_BASE and last:
            prog.append(isa.add(reg, isa.IMG_OUT, 0))
        else:
            prog.append(isa.add(reg, isa.ZERO, value))
    return prog


def _blocks(L, tiles):
    blocks = [(g, pb) for g in range(L.groups) for pb in range(L.pixel_blocks)]
    prog = []
    for start in range(0, len(blocks), len(tiles)):
        wave = blocks[start : start + len(tiles)]
        for r in range(L.rounds):
            final = r == L.rounds - 1
            rq = final and not L.raw
            ky0, kx0 = L.round_start_tap(r)
            for (x, y), (g, pb) in zip(tiles, wave):
                prog.append(isa.block(Block(
                    x, y, g, pb, r, ky0, kx0, acc_keep=r > 0, no_ret=not final, requant=rq, relu=rq,
                    sh=L.sh[g] if rq else 0, m=L.m[g] if rq else 0)))
    return prog
