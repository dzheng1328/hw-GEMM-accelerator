"""cocotb testbench for rtl/noc_mesh2x2.v -- four router+tile NoC nodes in a
2x2 mesh, the full Phase 2 NoC deliverable.

What this adds over tb/noc/ (the 1x2 pair): the mesh-level claims that only
exist once there's an actual mesh.

  * XY corner turns: a flit from (0,0) to (1,1) must go east to (1,0), turn,
    and continue north -- a 1x2 line has no turns.
  * Concurrent cross-traffic: two injectors at opposite corners drive the
    mesh at the same time, streams crossing through shared routers.
  * Mesh-level output contention: both injectors deliver operand slots into
    the SAME tile's memory (different slots), so router (1,1)'s LOCAL output
    port arbitrates two converging streams -- round-robin at mesh level, not
    just in the single-router testbench.
  * Deadlock/loss-freedom, empirically: every test ends by running the tiles
    and comparing bit-exactly against NumPy, so a lost, duplicated, stalled,
    or misrouted flit anywhere in the mesh fails the compute check.
"""

import random

import cocotb
import numpy as np
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

N = 8
KMAX = 8
AW = 2
ADDRW = 6
PW = ADDRW + 16 * N
TW = 2                       # flit type: 0=OPERAND, 1=GO, 2=RESULT
FW = TW + PW + 2 * AW
T_GO = 1
MESH_RANDOM_SEED = 0x2B2ECC
DONE_TIMEOUT_CYCLES = 8 * (3 * N - 2) * KMAX
DRAIN_CYCLES = 60


def to_signed32(value: int) -> int:
    value &= 0xFFFFFFFF
    if value & 0x80000000:
        value -= 0x100000000
    return value


def pack_lanes(values):
    packed = 0
    for lane, v in enumerate(values):
        packed |= (int(v) & 0xFF) << (8 * lane)
    return packed


def unpack_acc(raw: int, i: int, j: int) -> int:
    field = (raw >> (32 * (i * N + j))) & 0xFFFFFFFF
    return to_signed32(field)


def read_acc(sig):
    raw = sig.value.integer
    return np.array([[unpack_acc(raw, i, j) for j in range(N)] for i in range(N)])


def make_flit(dest_x, dest_y, wr_addr, a_col_lanes, b_row_lanes):
    """OPERAND flit (type 0 in the top bits, so numerically type-free)."""
    payload = (wr_addr << (16 * N)) | (pack_lanes(a_col_lanes) << (8 * N)) | pack_lanes(b_row_lanes)
    return (payload << (2 * AW)) | ((dest_y & 3) << AW) | (dest_x & 3)


def go_flit(dest_x, dest_y, k_chunks, ret_x, ret_y):
    """GO flit: type=1, payload[7:0] = {ret_y, ret_x, k_chunks} -- a compute
    descriptor carrying the result-return address."""
    payload = ((ret_y & 3) << 6) | ((ret_x & 3) << 4) | (k_chunks & 0xF)
    return (T_GO << (PW + 2 * AW)) | (payload << (2 * AW)) | ((dest_y & 3) << AW) | (dest_x & 3)


def operand_flits(dest_x, dest_y, A_full, B_full, k_chunks, chunks=None):
    """Slot-write flits for one tile's matmul; `chunks` restricts to a subset
    of K-chunk indices (for split-source loading)."""
    flits = []
    for k in range(k_chunks) if chunks is None else chunks:
        for c in range(N):
            a_col = [A_full[i][8 * k + c] for i in range(N)]
            b_row = [B_full[8 * k + c][j] for j in range(N)]
            flits.append(make_flit(dest_x, dest_y, k * N + c, a_col, b_row))
    return flits


def rand_mat(rng, rows, cols):
    return [[rng.randint(-128, 127) for _ in range(cols)] for _ in range(rows)]


def reference(A, B):
    C = np.array(A, dtype=np.int64) @ np.array(B, dtype=np.int64)
    return np.vectorize(to_signed32)(C)


async def reset_dut(dut, cycles=3):
    dut.rst.value = 1
    for inj in ("inj00", "inj11"):
        getattr(dut, f"{inj}_valid").value = 0
        getattr(dut, f"{inj}_flit").value = 0
    for node in ("00", "10", "01", "11"):
        getattr(dut, f"start_{node}").value = 0
        getattr(dut, f"k_chunks_{node}").value = 0
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.rst.value = 0
    await RisingEdge(dut.clk)


async def inject(dut, port, flits):
    """Drive `flits` into injection port `port` ('inj00' or 'inj11'),
    honouring the valid/ready handshake."""
    valid = getattr(dut, f"{port}_valid")
    flit_sig = getattr(dut, f"{port}_flit")
    ready = getattr(dut, f"{port}_ready")
    for flit in flits:
        valid.value = 1
        flit_sig.value = flit
        while True:
            await Timer(1, units="ns")
            accepted = int(ready.value) == 1
            await RisingEdge(dut.clk)
            if accepted:
                break
    valid.value = 0
    flit_sig.value = 0


async def wait_done(dut, node):
    done = getattr(dut, f"done_{node}")
    for _ in range(DONE_TIMEOUT_CYCLES):
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")
        if int(done.value) == 1:
            return
    raise AssertionError(f"done_{node} never asserted")


async def run_tiles(dut, nodes, k_chunks):
    """Start every tile in `nodes` on the same cycle, then wait for all."""
    for node in nodes:
        getattr(dut, f"k_chunks_{node}").value = k_chunks
        getattr(dut, f"start_{node}").value = 1
    await RisingEdge(dut.clk)
    for node in nodes:
        getattr(dut, f"start_{node}").value = 0
    for node in nodes:
        await wait_done(dut, node)


@cocotb.test()
async def test_one_injector_reaches_all_four(dut):
    """From (0,0) alone, interleaved operand flits for all four tiles: self
    (LOCAL->LOCAL), one hop east, one hop north, and the (1,1) corner -- the
    X-then-Y turn at router (1,0) that no 1x2 topology can exercise. All four
    tiles then compute concurrently, each checked bit-exactly."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset_dut(dut)

    rng = random.Random(MESH_RANDOM_SEED)
    k_chunks = 2
    K = 8 * k_chunks
    coords = {"00": (0, 0), "10": (1, 0), "01": (0, 1), "11": (1, 1)}
    mats = {node: (rand_mat(rng, N, K), rand_mat(rng, K, N)) for node in coords}

    streams = [
        operand_flits(*coords[node], mats[node][0], mats[node][1], k_chunks)
        for node in coords
    ]
    interleaved = [f for group in zip(*streams) for f in group]

    await inject(dut, "inj00", interleaved)
    for _ in range(DRAIN_CYCLES):
        await RisingEdge(dut.clk)

    await run_tiles(dut, list(coords), k_chunks)

    for node in coords:
        got = read_acc(getattr(dut, f"acc_out_{node}"))
        exp = reference(*mats[node])
        assert np.array_equal(got, exp), f"tile {node} mismatch:\n{got}\nvs\n{exp}"


@cocotb.test()
async def test_concurrent_cross_traffic_contention(dut):
    """Both corners inject at once. Injector (0,0) carries tile (1,0)'s full
    operands plus K-chunk 0 of tile (1,1)'s; injector (1,1) carries tile
    (0,1)'s full operands plus K-chunk 1 of tile (1,1)'s (self-delivery).
    Router (1,1)'s LOCAL output therefore arbitrates two converging streams
    (south-in from the turn path vs local-in) while unrelated traffic crosses
    the mesh in the opposite direction. Every destination tile must still end
    up with a complete, correct operand set -- proven by bit-exact matmuls."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset_dut(dut)

    rng = random.Random(MESH_RANDOM_SEED ^ 0xF00D)
    k_chunks = 2
    K = 8 * k_chunks
    A10, B10 = rand_mat(rng, N, K), rand_mat(rng, K, N)
    A01, B01 = rand_mat(rng, N, K), rand_mat(rng, K, N)
    A11, B11 = rand_mat(rng, N, K), rand_mat(rng, K, N)

    flits_a = operand_flits(1, 0, A10, B10, k_chunks) \
        + operand_flits(1, 1, A11, B11, k_chunks, chunks=[0])
    flits_b = operand_flits(0, 1, A01, B01, k_chunks) \
        + operand_flits(1, 1, A11, B11, k_chunks, chunks=[1])
    rng.shuffle(flits_a)
    rng.shuffle(flits_b)

    ta = cocotb.start_soon(inject(dut, "inj00", flits_a))
    tb = cocotb.start_soon(inject(dut, "inj11", flits_b))
    await ta
    await tb
    for _ in range(DRAIN_CYCLES):
        await RisingEdge(dut.clk)

    await run_tiles(dut, ["10", "01", "11"], k_chunks)

    for node, (A, B) in (("10", (A10, B10)), ("01", (A01, B01)), ("11", (A11, B11))):
        got = read_acc(getattr(dut, f"acc_out_{node}"))
        exp = reference(A, B)
        assert np.array_equal(got, exp), f"tile {node} mismatch:\n{got}\nvs\n{exp}"


@cocotb.test()
async def test_fully_packetized_load_go_result(dut):
    """Everything over the network, zero direct control wires: node (0,0)
    injects operands AND a GO descriptor (with return address (0,0)) for each
    of the three remote tiles, then just listens. Each tile starts itself when
    its GO arrives (per-source-destination FIFO ordering guarantees the GO
    can't overtake its operands), computes, and streams its 64 accumulator
    cells back as RESULT flits -- three 64-flit result streams converging on
    the host corner through shared routers. The host reassembles all three
    8x8 results purely from delivered flits and checks them bit-exactly.
    start_*/acc_out_* are never touched for the remote tiles."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset_dut(dut)

    rng = random.Random(MESH_RANDOM_SEED ^ 0x60)
    k_chunks = 2
    K = 8 * k_chunks
    targets = {"10": (1, 0), "01": (0, 1), "11": (1, 1)}
    mats = {node: (rand_mat(rng, N, K), rand_mat(rng, K, N)) for node in targets}

    flits = []
    for node, (x, y) in targets.items():
        flits += operand_flits(x, y, mats[node][0], mats[node][1], k_chunks)
        flits.append(go_flit(x, y, k_chunks, 0, 0))   # GO last: FIFO order per dest

    collected = {}   # (src_x, src_y) -> {idx: acc}

    async def collect_results():
        expected_total = 3 * N * N
        for _ in range(DONE_TIMEOUT_CYCLES * 4):
            await RisingEdge(dut.clk)
            await Timer(1, units="ns")
            if int(dut.res00_valid.value) == 1:
                src = (int(dut.res00_src_x.value), int(dut.res00_src_y.value))
                idx = int(dut.res00_idx.value)
                acc = to_signed32(int(dut.res00_acc.value))
                collected.setdefault(src, {})[idx] = acc
                if sum(len(v) for v in collected.values()) == expected_total:
                    return
        raise AssertionError(
            f"result collection timed out: got {sum(len(v) for v in collected.values())}"
            f"/{expected_total} flits ({ {k: len(v) for k, v in collected.items()} })"
        )

    mon = cocotb.start_soon(collect_results())
    await inject(dut, "inj00", flits)
    await mon

    for node, (x, y) in targets.items():
        cells = collected[(x, y)]
        assert len(cells) == N * N, f"tile {node}: {len(cells)}/64 result flits"
        got = np.array([[cells[i * N + j] for j in range(N)] for i in range(N)])
        exp = reference(*mats[node])
        assert np.array_equal(got, exp), f"tile {node} (via RESULT flits):\n{got}\nvs\n{exp}"
