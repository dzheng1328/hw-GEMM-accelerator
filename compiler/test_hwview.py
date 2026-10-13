"""pytest for compiler/hwview.py."""

import numpy as np
import pytest

import isa
from golden import Golden
from hwview import dma_ports, entry_words


def test_entry_words_cover_a_block_row_major():
    assert list(entry_words(100, 5, False)) == [100 + 5 * i for i in range(8)]
    raw = entry_words(1000, 16, True)
    assert len(raw) == 64
    assert list(raw[:9]) == [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1016]
    assert raw[-1] == 1000 + 7 * 16 + 7


def test_entry_words_row_limit_keeps_the_first_rows_in_every_mode():
    assert list(entry_words(100, 5, False, rows=3)) == [100, 105, 110]
    raw = entry_words(1000, 16, True, rows=2)
    assert len(raw) == 16 and raw[8] == 1016 and raw[-1] == 1016 + 7


def test_entry_words_q16_lands_two_halves_per_row():
    # RESULT16 row i half h (flit idx 2i + h) lands at base + i * step + h.
    assert list(entry_words(100, 4, False, q16=True, rows=3)) == [100, 101, 104, 105, 108, 109]
    assert len(entry_words(0, 2, False, q16=True)) == 16


def test_entry_words_wrap_like_the_address_width():
    assert entry_words(isa.ACT_WORDS - 1, 1, False)[1] == 0


def test_dma_ports_narrow_the_registers():
    regs = [0] * isa.N_REGS
    regs[isa.IN_BASE], regs[isa.STRIDE], regs[isa.PAD] = 4096, 2, 1
    regs[isa.BIAS] = 40 | (0x85 << 16)
    p = dma_ports(regs)
    assert p["in_base"] == 4096 and p["stride2"] == 1 and p["pad"] == 1
    assert p["bias_start"] == 40 and p["bias_val"] == 0x85
    regs[isa.STRIDE] = 1
    assert dma_ports(regs)["stride2"] == 0
    assert set(p) == {"in_base", "w_base", "cin_log2", "h_log2", "w_log2", "wout_log2", "stride2", "pad",
                      "ksize", "ks", "bias_start", "bias_val"}


@pytest.mark.parametrize("raw, q16", [(True, False), (False, False), (False, True)])
@pytest.mark.parametrize("rows", [1, 2, 8])
def test_golden_result_words_equal_the_write_back_entry_rtl_computes(raw, q16, rows):
    """rtl/cmd_seq.v: wb_base = OUT_BASE + (group * 8 * OSTRIDE + pixel_block), times 8 for raw;
    wb_step = OSTRIDE, times 8 for raw. golden.result_words must land on the same words."""
    g = Golden(1, 1, [], [], [])
    g.regs[isa.OUT_BASE], g.regs[isa.OSTRIDE] = 5000, 7
    b = isa.Block(0, 0, group=3, pixel_block=2, round=0, requant=not raw)
    row0 = 3 * 8 * 7 + 2
    base, step = 5000 + (row0 * 8 if raw else row0), 7 * 8 if raw else 7
    assert np.array_equal(g.result_words(b, rows, q16), entry_words(base, step, raw, q16, rows))
