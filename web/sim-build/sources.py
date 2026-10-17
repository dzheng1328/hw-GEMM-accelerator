"""Which files the committed simulator artifacts are built from, and the mesh table.

The RTL list is the Verilog source list of tb/accel/Makefile without the testbench wrapper."""

import hashlib
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ARTIFACTS = REPO / "web" / "src" / "live" / "sim" / "artifacts"
for sub in ("model", "compiler"):
    if str(REPO / sub) not in sys.path:
        sys.path.insert(0, str(REPO / sub))

MESHES = {"1x1": (1, 1), "2x2": (2, 2), "4x4": (4, 4)}
AW = 2  # coordinate width in flits; fits meshes up to 4x4 (tb/accel/Makefile)

RTL_FILES = [
    "rtl/pe.v", "rtl/systolic_array.v", "rtl/skew_feeder.v", "rtl/tile.v",
    "rtl/operand_mem.v", "tb/operand_mem/sram_macro_behavioral.v",
    "rtl/gemm_sequencer.v", "rtl/gemm_tile.v", "rtl/router.v", "rtl/flit_buf.v",
    "rtl/node_perf.v", "rtl/requant.v", "rtl/noc_node.v", "rtl/noc_mesh.v",
    "rtl/sim_mem.v", "rtl/dma_gather.v", "rtl/flit_pack.v", "rtl/cmd_seq.v",
    "rtl/writeback.v", "rtl/cmd_perf.v",
    "rtl/vpu.v", "rtl/vpu_add.v", "rtl/vpu_transpose.v", "rtl/vpu_embed.v",
    "rtl/vpu_rmsnorm.v", "rtl/vpu_silu.v", "rtl/vpu_rope.v", "rtl/vpu_kvwrite.v",
    "rtl/vpu_softmax.v", "rtl/vpu_sample.v", "rtl/vpu_rsqrt.v", "rtl/vpu_exp.v",
    "rtl/vpu_exparg.v", "rtl/vpu_lanes.v", "rtl/vpu_rng.v", "rtl/vpu_perf.v",
    "rtl/accel.v",
]
# Used only by testbenches, not by the accelerator.
EXCLUDED_RTL = ["rtl/noc_pair.v"]

HASHED = RTL_FILES + [
    "tb/lint_waivers.vlt",
    "compiler/build.py", "compiler/lower.py", "compiler/schedule.py", "compiler/isa.py", "compiler/emit.py",
    "model/cifar_reference.py", "model/cifar_spec.py", "model/fixedpoint.py", "model/cifar_quantized.npz",
    "web/sim-build/sources.py", "web/sim-build/data.py", "web/sim-build/harness.py", "web/sim-build/build_sim.py",
]


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sha256(rel):
    return sha256_file(REPO / rel)


def source_hashes():
    return {rel: sha256(rel) for rel in HASHED}
