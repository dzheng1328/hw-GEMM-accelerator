"""How the command processor's RTL carries ISA state across its module
boundaries, for testbenches: the layer registers narrowed to
rtl/dma_gather.v's ports, and the write-back entry (base, step, raw) that
rtl/cmd_seq.v computes and rtl/writeback.v expands into word addresses."""

import numpy as np

import isa


def dma_ports(regs):
    """rtl/dma_gather.v's register inputs, by port name, from the 16
    registers (a sequence or a dict keyed by register index)."""
    return {
        "in_base": regs[isa.IN_BASE], "w_base": regs[isa.W_BASE],
        "cin_log2": regs[isa.CIN_LOG2], "h_log2": regs[isa.H_LOG2], "w_log2": regs[isa.W_LOG2],
        "wout_log2": regs[isa.WOUT_LOG2], "stride2": int(regs[isa.STRIDE] == 2), "pad": regs[isa.PAD],
        "ksize": regs[isa.KSIZE], "ks": regs[isa.KS],
        "bias_start": regs[isa.BIAS] & 0xFFFF, "bias_val": (regs[isa.BIAS] >> 16) & 0xFF,
    }


def entry_words(base, step, raw):
    """The activation words a write-back entry covers, in flit order: row i
    at base + i * step, and for raw results cell (i, j) at
    base + i * step + j, modulo the address width like the RTL's adder."""
    rows = int(base) + int(step) * np.arange(8, dtype=np.int64)
    words = (rows[:, None] + np.arange(8)[None, :]).reshape(-1) if raw else rows
    return words % isa.ACT_WORDS
