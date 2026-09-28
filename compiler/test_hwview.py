"""pytest for compiler/hwview.py."""

import isa
from hwview import dma_ports, entry_words


def test_entry_words_cover_a_block_row_major():
    assert list(entry_words(100, 5, False)) == [100 + 5 * i for i in range(8)]
    raw = entry_words(1000, 16, True)
    assert len(raw) == 64
    assert list(raw[:9]) == [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1016]
    assert raw[-1] == 1000 + 7 * 16 + 7


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
