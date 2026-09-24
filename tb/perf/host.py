"""Packetized GEMM host for the perf harness: drives the 2x2 mesh purely
through the (0,0) injector (OPERAND + GO flits) and reassembles results from
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

from perflib import COUNTERS, node_key

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


def to_signed32(value):
    value &= 0xFFFFFFFF
    return value - (1 << 32) if value & 0x80000000 else value


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


def go_flit(dest_x, dest_y, k_chunks, ret_x, ret_y):
    """GO flit: type=1, payload[7:0] = {ret_y, ret_x, k_chunks}."""
    payload = ((ret_y & 3) << 6) | ((ret_x & 3) << 4) | (k_chunks & 0xF)
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


async def inject(dut, flits):
    """Drive `flits` into the (0,0) injector, honouring valid/ready. Starts on
    a rising edge, so a caller resuming mid-cycle (e.g. after a collector
    returned at a falling edge) cannot change this cycle's arbitration."""
    await RisingEdge(dut.clk)
    for flit in flits:
        dut.inj00_valid.value = 1
        dut.inj00_flit.value = flit
        while True:
            await FallingEdge(dut.clk)
            accepted = int(dut.inj00_ready.value) == 1
            await RisingEdge(dut.clk)
            if accepted:
                break
    dut.inj00_valid.value = 0
    dut.inj00_flit.value = 0


async def collect_results(dut, expected_total):
    """RESULT flits delivered at (0,0): {(src_x, src_y): {idx: acc}}.
    Raises on a duplicated cell or on timeout."""
    got = {}
    count = 0
    for _ in range(RESULT_TIMEOUT_CYCLES):
        await FallingEdge(dut.clk)
        if int(dut.res00_valid.value) == 1:
            src = (int(dut.res00_src_x.value), int(dut.res00_src_y.value))
            idx = int(dut.res00_idx.value)
            cells = got.setdefault(src, {})
            assert idx not in cells, f"duplicate RESULT flit: tile {src} cell {idx}"
            cells[idx] = to_signed32(int(dut.res00_acc.value))
            count += 1
            if count == expected_total:
                return got
    raise AssertionError(f"result collection timed out: {count}/{expected_total} flits")


async def run_gemm(dut, A, B, tiles):
    """C = A @ B over the mesh. A is 8 x K, B is K x Ncols (K a multiple of 8,
    K <= 8*KMAX, Ncols a multiple of 8). Returns (C, total k_chunks issued)."""
    A = np.asarray(A, dtype=np.int64)
    B = np.asarray(B, dtype=np.int64)
    M, K = A.shape
    assert M == N and B.shape[0] == K and K % N == 0 and K // N <= KMAX and B.shape[1] % N == 0
    k_chunks = K // N
    jobs = list(range(B.shape[1] // N))
    C = np.zeros((N, B.shape[1]), dtype=np.int64)
    for w in range(0, len(jobs), len(tiles)):
        wave = list(zip(jobs[w : w + len(tiles)], tiles))
        flits = []
        for j, (x, y) in wave:
            flits += operand_flits(x, y, A, B[:, N * j : N * j + N], k_chunks)
            flits.append(go_flit(x, y, k_chunks, *HOST))  # GO last: per-destination FIFO order
        collector = cocotb.start_soon(collect_results(dut, N * N * len(wave)))
        await inject(dut, flits)
        got = await collector
        expected_srcs = sorted((x, y) for _, (x, y) in wave)
        lens = {src: len(c) for src, c in got.items()}
        assert sorted(got) == expected_srcs and all(n == N * N for n in lens.values()), (
            f"wave {w // len(tiles)}: RESULT flits by source tile {lens}, expected 64 from each of {expected_srcs}"
        )
        for j, (x, y) in wave:
            cells = got[(x, y)]
            C[:, N * j : N * j + N] = [[cells[i * N + c] for c in range(N)] for i in range(N)]
    return C, k_chunks * len(jobs)


def perf_scope(dut, x, y):
    """The rtl/node_perf.v instance inside mesh node (x, y). The only place
    that knows the mesh's hierarchy (4.1c's WxH mesh changes it here)."""
    return getattr(dut, f"node{x}{y}").g_perf.perf


def read_counters(dut):
    return {
        node_key(x, y): {c: int(getattr(perf_scope(dut, x, y), c).value) for c in COUNTERS}
        for y in range(MESH_H)
        for x in range(MESH_W)
    }
