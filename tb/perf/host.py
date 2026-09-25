"""Packetized GEMM host for the perf harness: drives the 2x2 mesh
(rtl/noc_mesh.v at its default size) purely through the (0,0) injector (OPERAND + GO flits) and reassembles results from
RESULT flits delivered back at (0,0). Flit helpers are local copies of
tb/mesh/test_mesh.py's (per-directory cocotb convention).

Timing discipline: inputs are driven right after a rising edge and every
handshake is sampled at the falling edge, once all drives for the cycle
have settled. Sampling just after the rising edge races with other
coroutines driving in the same timestep (a collector once counted a RESULT
flit whose grant the next wave's injection then took away -- see
docs/learnings.md).

Scheduling (deliberately simple -- this measures today's system, not a
tuned host): C = A @ B is split into 8x8 output-block jobs, dealt to the
given tiles in waves. Per wave, each tile's operands then its GO are
injected back-to-back (a tile computes while the next one loads), then the
host waits for every RESULT flit of the wave.
"""

import cocotb
import numpy as np
from cocotb.triggers import FallingEdge, RisingEdge
from cocotb.utils import get_sim_time

from perflib import COUNTERS, delta, make_record, node_key

N = 8
KMAX = 8
AW = 2
ADDRW = 6
PW = ADDRW + 16 * N
TW = 2
T_GO = 1
CLK_NS = 10
MESH_W, MESH_H = 2, 2
HOST = (0, 0)
# Tiles by distance from the host corner; a T-tile run uses the first T.
TILE_ORDER = [(0, 0), (1, 0), (0, 1), (1, 1)]
RESULT_TIMEOUT_CYCLES = 20000


def to_signed(value, bits):
    value &= (1 << bits) - 1
    return value - (1 << bits) if value >> (bits - 1) else value


def wrap32(a):
    """Two's-complement 32-bit wrap, matching the RTL accumulators."""
    return ((np.asarray(a, dtype=np.int64) + (1 << 31)) % (1 << 32)) - (1 << 31)


def pack_lanes(values):
    packed = 0
    for lane, v in enumerate(values):
        packed |= (int(v) & 0xFF) << (8 * lane)
    return packed


def make_flit(dest_x, dest_y, wr_addr, a_col_lanes, b_row_lanes):
    """OPERAND flit (type 0 in the top bits, so numerically type-free)."""
    payload = (wr_addr << (16 * N)) | (pack_lanes(a_col_lanes) << (8 * N)) | pack_lanes(b_row_lanes)
    return (payload << (2 * AW)) | ((dest_y & 3) << AW) | (dest_x & 3)


def go_flit(dest_x, dest_y, k_chunks, ret_x, ret_y, rq=None):
    """GO flit: type=1, {ret_y, ret_x, k_chunks} plus the output mode: rq=None
    for raw int32 results, or (m, sh, relu) for requantized int8 rows (layout
    in rtl/noc_node.v)."""
    payload = ((ret_y & 3) << 6) | ((ret_x & 3) << 4) | (k_chunks & 0xF)
    if rq is not None:
        m, sh, relu = rq
        payload |= (m << 16) | (sh << 32) | (int(relu) << 38) | (1 << 39)
    return (T_GO << (PW + 2 * AW)) | (payload << (2 * AW)) | ((dest_y & 3) << AW) | (dest_x & 3)


def operand_flits(dest_x, dest_y, A, B_block, k_chunks):
    """Slot-write flits for one job: slot k*N+c holds A[:, 8k+c] and B_block[8k+c, :]."""
    flits = []
    for k in range(k_chunks):
        for c in range(N):
            a_col = [A[i][N * k + c] for i in range(N)]
            b_row = [B_block[N * k + c][j] for j in range(N)]
            flits.append(make_flit(dest_x, dest_y, k * N + c, a_col, b_row))
    return flits


async def reset_dut(dut, cycles=3):
    dut.rst.value = 1
    # Node (0,0) is bit/field 0 of every per-node bus; the host drives only
    # that one, so it can write the whole bus.
    for bus in (dut.inj_valid, dut.inj_flit, dut.start, dut.k_chunks):
        bus.value = 0
    for _ in range(cycles):
        await RisingEdge(dut.clk)
    dut.rst.value = 0
    await RisingEdge(dut.clk)


async def inject(dut, flits):
    """Drive `flits` into the (0,0) injector, honouring valid/ready. Starts on
    a rising edge, so a caller resuming mid-cycle (e.g. after a collector
    returned at a falling edge) cannot change this cycle's arbitration."""
    await RisingEdge(dut.clk)
    for flit in flits:
        dut.inj_valid.value = 1
        dut.inj_flit.value = flit
        while True:
            await FallingEdge(dut.clk)
            accepted = int(dut.inj_ready.value) & 1 == 1
            await RisingEdge(dut.clk)
            if accepted:
                break
    dut.inj_valid.value = 0
    dut.inj_flit.value = 0


async def collect_results(dut, expected_total, q8):
    """RESULT flits (q8=False: {idx: int32 cell}) or RESULT8 flits (q8=True:
    {row: [N int8 lanes]}) delivered at (0,0), keyed by source tile. Raises
    on a duplicate, a flit of the other type, a flit delivered anywhere
    else, or timeout."""
    amask = (1 << AW) - 1
    got = {}
    count = 0
    for _ in range(RESULT_TIMEOUT_CYCLES):
        await FallingEdge(dut.clk)
        valid = int(dut.res_valid.value)
        assert valid & ~1 == 0, f"RESULT flit delivered away from the host (res_valid={valid:#x})"
        if valid:
            src = (int(dut.res_src_x.value) & amask, int(dut.res_src_y.value) & amask)
            idx = int(dut.res_idx.value) & 0x3F
            data = int(dut.res_data.value) & ((1 << (8 * N)) - 1)
            assert (int(dut.res_q8.value) & 1) == q8, f"tile {src}: RESULT type does not match the GO's mode"
            cells = got.setdefault(src, {})
            assert idx not in cells, f"duplicate RESULT flit: tile {src} index {idx}"
            cells[idx] = [to_signed(data >> (8 * j), 8) for j in range(N)] if q8 else to_signed(data, 8 * N)
            count += 1
            if count == expected_total:
                return got
    raise AssertionError(f"result collection timed out: {count}/{expected_total} flits")


async def run_gemm(dut, A, B, tiles, rq=None):
    """C = A @ B over the mesh. A is 8 x K, B is K x Ncols (K a multiple of 8,
    K <= 8*KMAX, Ncols a multiple of 8). With rq = (m, sh, relu) the tiles
    requantize on-chip and C is int8 (model/fixedpoint.py's requant of the
    product). Returns (C, total k_chunks issued)."""
    A = np.asarray(A, dtype=np.int64)
    B = np.asarray(B, dtype=np.int64)
    M, K = A.shape
    assert M == N and B.shape[0] == K and K % N == 0 and K // N <= KMAX and B.shape[1] % N == 0
    k_chunks = K // N
    jobs = list(range(B.shape[1] // N))
    C = np.zeros((N, B.shape[1]), dtype=np.int64)
    per_tile = N if rq else N * N
    for w in range(0, len(jobs), len(tiles)):
        wave = list(zip(jobs[w : w + len(tiles)], tiles))
        flits = []
        for j, (x, y) in wave:
            flits += operand_flits(x, y, A, B[:, N * j : N * j + N], k_chunks)
            flits.append(go_flit(x, y, k_chunks, *HOST, rq))  # GO last: per-destination FIFO order
        collector = cocotb.start_soon(collect_results(dut, per_tile * len(wave), q8=rq is not None))
        await inject(dut, flits)
        got = await collector
        expected_srcs = sorted((x, y) for _, (x, y) in wave)
        lens = {src: len(c) for src, c in got.items()}
        assert sorted(got) == expected_srcs and all(n == per_tile for n in lens.values()), (
            f"wave {w // len(tiles)}: RESULT flits by source tile {lens}, "
            f"expected {per_tile} from each of {expected_srcs}"
        )
        for j, (x, y) in wave:
            cells = got[(x, y)]
            if rq:
                C[:, N * j : N * j + N] = [cells[i] for i in range(N)]
            else:
                C[:, N * j : N * j + N] = [[cells[i * N + c] for c in range(N)] for i in range(N)]
    return C, k_chunks * len(jobs)


def node_scope(dut, x, y):
    """Mesh node (x, y)'s rtl/noc_node.v instance. The only place that knows
    the mesh's hierarchy (rtl/noc_mesh.v's generate loop)."""
    return dut.g_node[y * MESH_W + x].node


def perf_scope(dut, x, y):
    """The rtl/node_perf.v instance inside mesh node (x, y)."""
    return node_scope(dut, x, y).g_perf.perf


def read_counters(dut):
    return {
        node_key(x, y): {c: int(getattr(perf_scope(dut, x, y), c).value) for c in COUNTERS}
        for y in range(MESH_H)
        for x in range(MESH_W)
    }


async def measure(dut, name, work, chunks_expected, tiles_used, **meta):
    """Run `work` (an un-awaited run_gemm coroutine) as one measured region.
    Regions start and end quiescent (nothing in flight), which two checks
    enforce: every flit that entered at a LOCAL port left at one, and the
    array was fed exactly 8 cycles per K-chunk issued.

    Both snapshots are taken at falling edges, when the counters have settled
    (read right after a rising edge, that edge's increments may not be
    visible yet). The region is exactly the rising edges between them, the
    last one being the edge that delivers the final RESULT flit."""
    await FallingEdge(dut.clk)
    t0, before = get_sim_time(units="ns"), read_counters(dut)
    C, chunks = await work
    await FallingEdge(dut.clk)
    t1, after = get_sim_time(units="ns"), read_counters(dut)

    span = int(round(t1 - t0))
    assert span % CLK_NS == 0, f"{name}: region of {span} ns is not whole cycles"
    d = delta(before, after)
    entered = sum(n["lcl_in_xfer"] for n in d.values())
    left = sum(n["out_xfer_l"] for n in d.values())
    assert entered == left, f"{name}: {entered} flits entered but {left} left (region not quiescent)"
    feed = sum(n["feed_cyc"] for n in d.values())
    assert chunks == chunks_expected and feed == N * chunks, (
        f"{name}: fed {feed} cycles for {chunks} chunks (expected {chunks_expected})"
    )
    return C, make_record(name, d, span // CLK_NS, MESH_W, MESH_H, tiles_used, **meta)
