"""cocotb testbench for rtl/noc_mesh.v -- a WxH mesh of router+tile NoC
nodes, the full RTL stack. The mesh shape comes from the MESH_W / MESH_H /
MESH_AW environment variables, which tb/mesh/Makefile also passes to the RTL
as parameters; every test is written for any shape of at least 2x2.

What this adds over tb/noc/ (the 1x2 pair): the mesh-level claims that only
exist once there's an actual mesh.

  * XY corner turns: a flit from (0,0) to the far corner goes east along row
    0, turns, and continues north -- a 1x2 line has no turns.
  * Concurrent cross-traffic: injectors at opposite corners (and, in the
    all-to-all test, at every node) drive the mesh at once, streams crossing
    through shared routers.
  * Mesh-level output contention: two injectors deliver operand slots into
    the SAME tile's memory (different slots), so that router's LOCAL output
    port arbitrates two converging streams -- round-robin at mesh level, not
    just in the single-router testbench.
  * Deadlock/loss-freedom, empirically: every test ends by running the tiles
    and comparing bit-exactly against NumPy, so a lost, duplicated, stalled,
    or misrouted flit anywhere in the mesh fails the compute check.

Timing discipline: inputs are driven right after a rising edge and outputs
are sampled at the falling edge (see docs/learnings.md for the race that
sampling at rising edge + 1ns causes).
"""

import os
import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

W = int(os.environ.get("MESH_W", "2"))
H = int(os.environ.get("MESH_H", "2"))
AW = int(os.environ.get("MESH_AW", "2"))
NN = W * H
N = 8
KMAX = 8
ADDRW = 6
PW = ADDRW + 16 * N
TW = 2                       # flit type: 0=OPERAND, 1=GO, 2=RESULT
FW = TW + PW + 2 * AW
T_GO = 1
AMASK = (1 << AW) - 1
MESH_RANDOM_SEED = 0x2B2ECC
DONE_TIMEOUT_CYCLES = 8 * (3 * N - 2) * KMAX
RESULT_TIMEOUT_CYCLES = 20000
DRAIN_CYCLES = 60 + 4 * (W + H)

HOST = (0, 0)
FAR = (W - 1, H - 1)
NODES = [(x, y) for y in range(H) for x in range(W)]   # flat-index order


def nid(node):
    """Flat node index, matching rtl/noc_mesh.v's i = y*W + x."""
    x, y = node
    return y * W + x


def to_signed32(value: int) -> int:
    value &= 0xFFFFFFFF
    if value & 0x80000000:
        value -= 0x100000000
    return value


def field(sig, i, width):
    """Field i of a flat per-node bus."""
    return (int(sig.value) >> (i * width)) & ((1 << width) - 1)


def pack_lanes(values):
    packed = 0
    for lane, v in enumerate(values):
        packed |= (int(v) & 0xFF) << (8 * lane)
    return packed


def read_acc(dut, node):
    raw = field(dut.acc_out, nid(node), 32 * N * N)
    return np.array([[to_signed32(raw >> (32 * (i * N + j))) for j in range(N)] for i in range(N)])


def make_flit(dest, wr_addr, a_col_lanes, b_row_lanes):
    """OPERAND flit (type 0 in the top bits, so numerically type-free)."""
    x, y = dest
    payload = (wr_addr << (16 * N)) | (pack_lanes(a_col_lanes) << (8 * N)) | pack_lanes(b_row_lanes)
    return (payload << (2 * AW)) | ((y & AMASK) << AW) | (x & AMASK)


def go_flit(dest, k_chunks, ret):
    """GO flit: type=1, payload = {ret_y, ret_x, k_chunks[3:0]} -- a compute
    descriptor carrying the result-return address."""
    (x, y), (rx, ry) = dest, ret
    payload = ((ry & AMASK) << (4 + AW)) | ((rx & AMASK) << 4) | (k_chunks & 0xF)
    return (T_GO << (PW + 2 * AW)) | (payload << (2 * AW)) | ((y & AMASK) << AW) | (x & AMASK)


def operand_flits(dest, A_full, B_full, k_chunks, chunks=None):
    """Slot-write flits for one tile's matmul; `chunks` restricts to a subset
    of K-chunk indices (for split-source loading)."""
    flits = []
    for k in range(k_chunks) if chunks is None else chunks:
        for c in range(N):
            a_col = [A_full[i][8 * k + c] for i in range(N)]
            b_row = [B_full[8 * k + c][j] for j in range(N)]
            flits.append(make_flit(dest, k * N + c, a_col, b_row))
    return flits


def rand_mat(rng, rows, cols):
    return [[rng.randint(-128, 127) for _ in range(cols)] for _ in range(rows)]


def reference(A, B):
    C = np.array(A, dtype=np.int64) @ np.array(B, dtype=np.int64)
    return np.vectorize(to_signed32)(C)


class MeshIO:
    """Owns the mesh's per-node input buses. cocotb cannot drive one field of
    a packed vector, and a read-modify-write from two coroutines in the same
    timestep would lose one of them, so every change rewrites each bus from
    this shared state."""

    def __init__(self, dut):
        self.dut = dut
        self.inj_valid = [0] * NN
        self.inj_flit = [0] * NN
        self.start = [0] * NN
        self.k_chunks = [0] * NN

    def drive(self):
        def pack(values, width):
            return sum(v << (i * width) for i, v in enumerate(values))

        self.dut.inj_valid.value = pack(self.inj_valid, 1)
        self.dut.inj_flit.value = pack(self.inj_flit, FW)
        self.dut.start.value = pack(self.start, 1)
        self.dut.k_chunks.value = pack(self.k_chunks, 4)


async def setup(dut, cycles=3):
    """Start the clock, reset the mesh, and return its MeshIO."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    io = MeshIO(dut)
    io.drive()
    dut.rst.value = 1
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.rst.value = 0
    await RisingEdge(dut.clk)
    return io


async def inject(dut, io, node, flits):
    """Drive `flits` into `node`'s injection port, honouring valid/ready."""
    i = nid(node)
    await RisingEdge(dut.clk)
    for flit in flits:
        io.inj_valid[i], io.inj_flit[i] = 1, flit
        io.drive()
        while True:
            await FallingEdge(dut.clk)
            accepted = field(dut.inj_ready, i, 1) == 1
            await RisingEdge(dut.clk)
            if accepted:
                break
    io.inj_valid[i], io.inj_flit[i] = 0, 0
    io.drive()


async def drain(dut):
    for _ in range(DRAIN_CYCLES):
        await RisingEdge(dut.clk)


async def run_tiles(dut, io, nodes, k_chunks):
    """Start every tile in `nodes` on the same cycle over the direct ports,
    then wait for all of them."""
    for node in nodes:
        io.start[nid(node)], io.k_chunks[nid(node)] = 1, k_chunks
    io.drive()
    await RisingEdge(dut.clk)
    for node in nodes:
        io.start[nid(node)] = 0
    io.drive()
    for node in nodes:
        for _ in range(DONE_TIMEOUT_CYCLES):
            await FallingEdge(dut.clk)
            if field(dut.done, nid(node), 1):
                break
        else:
            raise AssertionError(f"tile {node} never asserted done")


async def collect_results(dut, expected_total):
    """Collect RESULT flits delivered at every node, in arrival order:
    {(dest, src): [(idx, acc), ...]}."""
    streams = {}
    count = 0
    for _ in range(RESULT_TIMEOUT_CYCLES):
        await FallingEdge(dut.clk)
        valid = int(dut.res_valid.value)
        if not valid:
            continue
        for dest in NODES:
            i = nid(dest)
            if (valid >> i) & 1:
                src = (field(dut.res_src_x, i, AW), field(dut.res_src_y, i, AW))
                cell = (field(dut.res_idx, i, 6), to_signed32(field(dut.res_acc, i, 32)))
                streams.setdefault((dest, src), []).append(cell)
                count += 1
        if count == expected_total:
            return streams
    raise AssertionError(
        f"result collection timed out: got {count}/{expected_total} flits "
        f"({ {k: len(v) for k, v in streams.items()} })"
    )


def stream_to_matrix(stream):
    """One 64-flit RESULT stream -> 8x8 matrix (each index exactly once)."""
    cells = dict(stream)
    assert len(stream) == N * N and len(cells) == N * N, f"malformed stream: {len(stream)} flits"
    return np.array([[cells[i * N + j] for j in range(N)] for i in range(N)])


@cocotb.test()
async def test_one_injector_reaches_all(dut):
    """From (0,0) alone, interleaved operand flits for every tile: self
    (LOCAL->LOCAL), along both edges, and across the interior -- including
    the X-then-Y turns no 1x2 topology can exercise. All tiles then compute
    concurrently, each checked bit-exactly."""
    io = await setup(dut)
    rng = random.Random(MESH_RANDOM_SEED)
    k_chunks = 2
    K = 8 * k_chunks
    mats = {node: (rand_mat(rng, N, K), rand_mat(rng, K, N)) for node in NODES}

    streams = [operand_flits(node, *mats[node], k_chunks) for node in NODES]
    interleaved = [f for group in zip(*streams) for f in group]

    await inject(dut, io, HOST, interleaved)
    await drain(dut)
    await run_tiles(dut, io, NODES, k_chunks)

    for node in NODES:
        got, exp = read_acc(dut, node), reference(*mats[node])
        assert np.array_equal(got, exp), f"tile {node} mismatch:\n{got}\nvs\n{exp}"


@cocotb.test()
async def test_concurrent_cross_traffic_contention(dut):
    """Opposite corners inject at once. The (0,0) injector carries the
    south-east tile's full operands plus K-chunk 0 of the far corner's; the
    far-corner injector carries the north-west tile's full operands plus
    K-chunk 1 of its own tile's (self-delivery). The far corner's LOCAL
    output therefore arbitrates two converging streams (south-in from the
    turn path vs local-in) while unrelated traffic crosses the mesh in the
    opposite direction. Every destination tile must still end up with a
    complete, correct operand set -- proven by bit-exact matmuls."""
    io = await setup(dut)
    rng = random.Random(MESH_RANDOM_SEED ^ 0xF00D)
    k_chunks = 2
    K = 8 * k_chunks
    se, nw = (W - 1, 0), (0, H - 1)
    mats = {node: (rand_mat(rng, N, K), rand_mat(rng, K, N)) for node in (se, nw, FAR)}

    flits_a = operand_flits(se, *mats[se], k_chunks) + operand_flits(FAR, *mats[FAR], k_chunks, chunks=[0])
    flits_b = operand_flits(nw, *mats[nw], k_chunks) + operand_flits(FAR, *mats[FAR], k_chunks, chunks=[1])
    rng.shuffle(flits_a)
    rng.shuffle(flits_b)

    ta = cocotb.start_soon(inject(dut, io, HOST, flits_a))
    tb = cocotb.start_soon(inject(dut, io, FAR, flits_b))
    await ta
    await tb
    await drain(dut)
    await run_tiles(dut, io, list(mats), k_chunks)

    for node, (A, B) in mats.items():
        got, exp = read_acc(dut, node), reference(A, B)
        assert np.array_equal(got, exp), f"tile {node} mismatch:\n{got}\nvs\n{exp}"


@cocotb.test()
async def test_fully_packetized_load_go_result(dut):
    """Everything over the network, zero direct control wires: node (0,0)
    injects operands AND a GO descriptor (with return address (0,0)) for
    every other tile, then just listens. Each tile starts itself when its GO
    arrives (per-source-destination FIFO ordering guarantees the GO can't
    overtake its operands), computes, and streams its 64 accumulator cells
    back as RESULT flits -- every result stream converging on the host
    corner through shared routers. The host reassembles every 8x8 result
    purely from delivered flits and checks it bit-exactly."""
    io = await setup(dut)
    rng = random.Random(MESH_RANDOM_SEED ^ 0x60)
    k_chunks = 2
    K = 8 * k_chunks
    targets = [node for node in NODES if node != HOST]
    mats = {node: (rand_mat(rng, N, K), rand_mat(rng, K, N)) for node in targets}

    flits = []
    for node in targets:
        flits += operand_flits(node, *mats[node], k_chunks)
        flits.append(go_flit(node, k_chunks, HOST))   # GO last: FIFO order per dest

    mon = cocotb.start_soon(collect_results(dut, len(targets) * N * N))
    await inject(dut, io, HOST, flits)
    streams = await mon

    assert set(streams) == {(HOST, node) for node in targets}, f"unexpected streams: {sorted(streams)}"
    for node in targets:
        got, exp = stream_to_matrix(streams[(HOST, node)]), reference(*mats[node])
        assert np.array_equal(got, exp), f"tile {node} (via RESULT flits):\n{got}\nvs\n{exp}"


@cocotb.test()
async def test_every_node_injects_concurrently(dut):
    """All-to-all, fully packetized: every node at once sends operands and a
    GO to its point mirror (W-1-x, H-1-y), with itself as the return
    address. Every link carries operand traffic one way and result traffic
    the other, and every node's RESULT port must receive exactly its
    mirror's 64 cells, bit-exact."""
    io = await setup(dut)
    rng = random.Random(MESH_RANDOM_SEED ^ 0xA11)
    k_chunks = 2
    K = 8 * k_chunks
    mirror = {(x, y): (W - 1 - x, H - 1 - y) for x, y in NODES}
    mats = {node: (rand_mat(rng, N, K), rand_mat(rng, K, N)) for node in NODES}   # keyed by computing tile

    mon = cocotb.start_soon(collect_results(dut, NN * N * N))
    injectors = [
        cocotb.start_soon(inject(
            dut, io, src,
            operand_flits(mirror[src], *mats[mirror[src]], k_chunks) + [go_flit(mirror[src], k_chunks, src)],
        ))
        for src in NODES
    ]
    for task in injectors:
        await task
    streams = await mon

    assert set(streams) == {(src, mirror[src]) for src in NODES}, f"unexpected streams: {sorted(streams)}"
    for src in NODES:
        tile = mirror[src]
        got, exp = stream_to_matrix(streams[(src, tile)]), reference(*mats[tile])
        assert np.array_equal(got, exp), f"tile {tile} -> node {src}:\n{got}\nvs\n{exp}"


@cocotb.test()
async def test_prefetch_overlap_is_backpressured(dut):
    """Issue #44: block 2's OPERAND flits (targeting the SAME operand_mem
    slots) and GO are injected immediately behind block 1's GO, so they reach
    the tile while block 1 is still computing. The LOCAL port must hold them
    off until the tile is idle -- otherwise the writes steal operand_mem's
    shared address port from in-flight reads and overwrite slots block 1 still
    needs, and block 2's GO is dropped by the busy sequencer. Both results
    must come back bit-exact, in order."""
    io = await setup(dut)
    rng = random.Random(MESH_RANDOM_SEED ^ 0x44)
    k_chunks = 2
    K = 8 * k_chunks
    tile = (W - 1, 0)
    blocks = [(rand_mat(rng, N, K), rand_mat(rng, K, N)) for _ in range(2)]

    flits = []
    for A, B in blocks:
        flits += operand_flits(tile, A, B, k_chunks)
        flits.append(go_flit(tile, k_chunks, HOST))

    mon = cocotb.start_soon(collect_results(dut, 2 * N * N))
    await inject(dut, io, HOST, flits)
    stream = (await mon)[(HOST, tile)]

    for b, (A, B) in enumerate(blocks):
        got, exp = stream_to_matrix(stream[b * N * N:(b + 1) * N * N]), reference(A, B)
        assert np.array_equal(got, exp), f"block {b}:\n{got}\nvs\n{exp}"


@cocotb.test()
async def test_back_to_back_go_is_backpressured(dut):
    """Issue #44: a second GO sent right behind the first reaches the tile
    while it is computing (and, once released, must not restart the tile
    while the first result is still streaming back -- that would clear the
    accumulators mid-stream). Both GOs must each produce a full, correct
    result stream over the same loaded operands."""
    io = await setup(dut)
    rng = random.Random(MESH_RANDOM_SEED ^ 0x45)
    k_chunks = 1
    A, B = rand_mat(rng, N, 8 * k_chunks), rand_mat(rng, 8 * k_chunks, N)
    flits = operand_flits(FAR, A, B, k_chunks)
    flits += [go_flit(FAR, k_chunks, HOST), go_flit(FAR, k_chunks, HOST)]

    mon = cocotb.start_soon(collect_results(dut, 2 * N * N))
    await inject(dut, io, HOST, flits)
    stream = (await mon)[(HOST, FAR)]

    exp = reference(A, B)
    for r in range(2):
        got = stream_to_matrix(stream[r * N * N:(r + 1) * N * N])
        assert np.array_equal(got, exp), f"run {r}:\n{got}\nvs\n{exp}"
