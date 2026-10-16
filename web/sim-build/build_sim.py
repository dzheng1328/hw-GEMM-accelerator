#!/usr/bin/env python3
"""Rebuilds the committed simulator artifacts under web/src/live/sim/artifacts/.

    .venv/bin/python web/sim-build/build_sim.py                 data, WebAssembly for every mesh, manifest
    .venv/bin/python web/sim-build/build_sim.py data            only the data files (no toolchain needed)
    .venv/bin/python web/sim-build/build_sim.py wasm 2x2        the data, one mesh's WebAssembly, the manifest
    .venv/bin/python web/sim-build/build_sim.py manifest        only the manifest (runs each built mesh once in node); refused when the sources changed

The wasm step needs Verilator and Emscripten (em++) on PATH. A partial wasm build is refused when the sources
changed since the last full build, because the other meshes would then be stale; add --force to override while
developing."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import data
import harness
import sources

HERE = Path(__file__).resolve().parent
ARTIFACTS = sources.ARTIFACTS
LDFLAGS = " ".join([
    "-O3", "--no-entry", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createSim",
    "-sENVIRONMENT=web,worker,node", "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=134217728",
    "-sEXPORTED_FUNCTIONS=_malloc,_free", "-sEXPORTED_RUNTIME_METHODS=HEAPU8",
])


def run(cmd):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True)


def build_wasm(key):
    for tool in ("verilator", "em++", "emar"):
        if not shutil.which(tool):
            sys.exit(f"{tool} is not on PATH; install Verilator and Emscripten (brew install verilator emscripten)")
    w, h = sources.MESHES[key]
    work = Path(tempfile.mkdtemp(prefix=f"hwgemm-sim-{key}-"))
    try:
        cpp = work / "harness.cpp"
        cpp.write_text(harness.render(w, h))
        mdir = work / "obj"
        out = f"cifar-{key}.mjs"
        run([
            "verilator", "--cc", "--top-module", "accel", f"-GW={w}", f"-GH={h}", f"-GAW={sources.AW}",
            "--public-flat-rw", "-Wno-fatal", "-Wno-lint", "-Wno-style", sources.REPO / "tb" / "lint_waivers.vlt",
            *[sources.REPO / f for f in sources.RTL_FILES],
            "--Mdir", mdir, "-O3", "--x-assign", "fast", "--x-initial", "fast", "--exe", cpp, "-o", out,
        ])
        run([
            "make", "-C", mdir, "-f", "Vaccel.mk", f"-j{os.cpu_count() or 4}", "CXX=em++", "LINK=em++", "AR=emar",
            "OPT_FAST=-O3", "OPT_SLOW=-O3", "OPT_GLOBAL=-O3", "VM_USER_CFLAGS=-DVL_IGNORE_UNKNOWN_ARCH",
            f"LDFLAGS={LDFLAGS}", "LDLIBS=", out,
        ])
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        shutil.copy(mdir / out, ARTIFACTS / out)
        shutil.copy(mdir / f"cifar-{key}.wasm", ARTIFACTS / f"cifar-{key}.wasm")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def measure(key):
    done = subprocess.run(["node", str(HERE / "measure.mjs"), key], check=True, capture_output=True, text=True)
    return json.loads(done.stdout.strip().splitlines()[-1])


def tool_versions():
    """First line of `verilator --version` and `em++ --version`; None for a tool that is not on PATH."""
    out = {}
    for key, tool in (("verilator", "verilator"), ("emscripten", "em++")):
        if not shutil.which(tool):
            out[key] = None
            continue
        done = subprocess.run([tool, "--version"], check=True, capture_output=True, text=True)
        out[key] = done.stdout.strip().splitlines()[0]
    return out


def artifact_hashes():
    names = ["weights.bin"]
    for key in sources.MESHES:
        names += [f"cifar-{key}.wasm", f"cifar-{key}.mjs", f"program-{key}.bin"]
    return {n: sources.sha256_file(ARTIFACTS / n) for n in names if (ARTIFACTS / n).exists()}


def write_manifest():
    previous = {}
    if (ARTIFACTS / "manifest.json").exists():
        previous = json.loads((ARTIFACTS / "manifest.json").read_text())
    tools = {k: v or previous.get("tools", {}).get(k) for k, v in tool_versions().items()}
    assert all(tools.values()), f"no recorded version for {[k for k, v in tools.items() if not v]}: build with the tools on PATH"
    q = data.load_q()
    progs = data.programs(q)
    first = next(iter(progs.values()))
    built = [k for k in sources.MESHES if (ARTIFACTS / f"cifar-{k}.wasm").exists()]
    meshes, out_bases = {}, set()
    for key in built:
        w, h = sources.MESHES[key]
        p = progs[key]
        m = measure(key)
        out_bases.add(p.build.lowered.layers[-1].out_base)
        meshes[key] = {
            "w": w, "h": h, "nodes": w * h, "program": f"program-{key}.bin", "programWords": int(len(p.words)),
            "cycles": m["cycles"], "recordBytes": m["recordBytes"], "layers": data.layer_ranges(p.build),
        }
    assert len(out_bases) == 1, f"output base differs between meshes: {out_bases}"
    manifest = {
        "generated": {"regenerate": ".venv/bin/python web/sim-build/build_sim.py (needs verilator and em++)",
                      "note": "generated, do not edit by hand"},
        "sources": sources.source_hashes(),
        "excludedRtl": sources.EXCLUDED_RTL,
        "artifacts": artifact_hashes(),
        "tools": tools,
        "input": {"bytes": data.INPUT_BYTES, "words": data.INPUT_BYTES // 8},
        "output": {"base": int(out_bases.pop()), "stride": 8, "logits": 16, "classes": 10},
        "classNames": data.CLASS_NAMES,
        "weights": {"file": "weights.bin", "words": int(first.weights.size)},
        "meshes": meshes,
    }
    data.dump_json(ARTIFACTS / "manifest.json", manifest)
    print("manifest written for", ", ".join(built))


def refuse_changed_sources():
    """`manifest` re-hashes the sources without rebuilding, so it must not bless wasm built from older ones."""
    path = ARTIFACTS / "manifest.json"
    if path.exists() and json.loads(path.read_text())["sources"] != sources.source_hashes():
        sys.exit("the sources changed since the last build, so the committed wasm is stale: "
                 "rebuild every mesh (build_sim.py wasm), or pass --force while developing")


def refuse_stale_partial(rebuilt):
    path = ARTIFACTS / "manifest.json"
    if path.exists() and set(rebuilt) != set(sources.MESHES):
        if json.loads(path.read_text())["sources"] != sources.source_hashes():
            sys.exit("the sources changed since the last full build, so the other meshes would be stale: "
                     "rebuild every mesh (build_sim.py wasm), or pass --force while developing")


def main(argv):
    cmd, *rest = argv or ["all"]
    force = "--force" in rest
    names = [a for a in rest if a != "--force"]
    unknown = [n for n in names if n not in sources.MESHES]
    if unknown or cmd not in ("all", "data", "wasm", "manifest"):
        sys.exit(__doc__)
    meshes = names or list(sources.MESHES)
    if cmd == "data":
        data.write_data()
        return
    if cmd == "manifest":
        if not force:
            refuse_changed_sources()
        write_manifest()
        return
    if cmd == "wasm" and not force:
        refuse_stale_partial(meshes)
    data.write_data()
    for key in meshes:
        build_wasm(key)
    write_manifest()


if __name__ == "__main__":
    main(sys.argv[1:])
