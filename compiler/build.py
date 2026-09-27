"""Compile a network end to end: lower, schedule, and pack the inputs; run
the golden executor on the result."""

from dataclasses import dataclass

import numpy as np

from lower import Lowered, lower, pack_inputs
from schedule import schedule


@dataclass(frozen=True)
class Build:
    lowered: Lowered
    program: list
    act: np.ndarray  # initial activation memory, '<u8' words
    mesh: tuple


def build(q, layers, x, mesh_w, mesh_h):
    """x: int8 inputs (N, Cin, H, W)."""
    x = np.asarray(x)
    lowered = lower(q, layers, x.shape[1:], len(x))
    return Build(lowered, schedule(lowered, mesh_w, mesh_h), pack_inputs(lowered, x), (mesh_w, mesh_h))


def cifar_build(q, images_uint8, mesh_w, mesh_h):
    from cifar_reference import quantize_input
    from cifar_spec import LAYERS

    return build(q, LAYERS, quantize_input(images_uint8), mesh_w, mesh_h)


def run_golden(b):
    """Final activation memory bytes after running b on the golden executor."""
    from golden import Golden

    return Golden(*b.mesh, b.program, b.lowered.weights, b.act).run()
