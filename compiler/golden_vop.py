"""The vector commands' semantics at command level (spec section 3), for
golden.py. The sub-ops arrive in the tasks that follow; this skeleton gives
golden.py its dispatch point and the invalid-sub-op fault."""

import golden
import isa


def execute(g, pc, v):
    """Run VOP v (an isa.Vop) on Golden g at program counter pc."""
    name = isa.VOP_NAMES.get(v.sub)
    if name is None:
        raise golden.GoldenError(pc, f"invalid VOP sub-op {v.sub}")
    raise golden.GoldenError(pc, f"VOP {name} is not implemented")
