# Hardware CNN image classifier

A systolic array-based hardware accelerator, designed in Verilog and verified in
simulation, that runs a real trained neural network to classify handwritten
digits (MNIST). Built as a portfolio project for RTL/logic design internship
recruiting.

## What this is

Instead of running image classification as software on a CPU/GPU, this project
designs the actual circuitry that performs it: a grid of multiply-accumulate
processing elements (a systolic array) that computes convolution and matrix
multiplication directly in hardware.

## Phases

- **Phase 1 — core deliverable**: a single verified 8x8 systolic array tile,
  running real MNIST classification, with a cocotb testbench.
- **Phase 2 — scale up**: multiple tiles connected by a simple network-on-chip
  (NoC), plus Yosys synthesis for real area/timing numbers.
- **Phase 3 — stretch goal**: full OpenLane physical design flow, possible
  Tiny Tapeout submission.

## Toolchain

| Tool | Role |
|---|---|
| Verilog | hardware description language — the design itself |
| Icarus Verilog / Verilator | simulate the design |
| cocotb | Python-based testbenches |
| GTKWave | waveform viewing / debugging |
| PyTorch | train + quantize the reference model |
| Yosys | synthesis to gate-level netlist |
| OpenLane | physical design / layout (Phase 3) |

## Status

See the [GitHub Project board](../../projects) for live task tracking, and
[`docs/learnings.md`](docs/learnings.md) for a running log of problems hit and
how they were solved.

## Repo layout

```
rtl/          Verilog source
tb/           cocotb testbenches
model/        PyTorch training + quantization scripts
sim/          simulation build artifacts (gitignored)
docs/         learnings log, design decisions
```
