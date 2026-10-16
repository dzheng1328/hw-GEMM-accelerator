"""pytest for tb/accel/lm_perf.py."""

import pytest

from lm_perf import ATTN, SPLIT, add, categories, check_categories, delta


def interval(**over):
    cmd = {"run_cyc": 170, "blocks": 4, "wb_words": 8, "slot_cyc": 100, "go_cyc": 10, "inj_stall_cyc": 5,
           "wait_cyc": 50, "credit_cyc": 1, "other_cyc": 4,
           "attn_slot_cyc": 40, "attn_go_cyc": 4, "attn_inj_stall_cyc": 2, "attn_wait_cyc": 3,
           "attn_credit_cyc": 0, "attn_other_cyc": 1, "attn_blocks": 2}
    cmd.update(over)
    return {"cmd": cmd, "vpu": [30, 3, 3, 3, 3, 3, 3, 3, 3, 6], "feed": [90, 80], "busy": [95, 85]}


def test_the_categories_partition_the_run_cycles():
    cats = check_categories(interval())
    assert cats == {"weight matmuls": 69, "attention": 50, "VPU": 30, "other": 21}
    assert len(ATTN) == 7 and ATTN[0] == "attn_slot_cyc" and ATTN[-1] == "attn_blocks" and len(SPLIT) == 6


def test_a_vpu_cycle_inside_a_tagged_window_is_rejected():
    # 60 VPU cycles, but only 50 - 3 = 47 untagged wait cycles to hold them: the VPU cannot all be outside the window.
    d = interval()
    d["vpu"][0] = 60
    with pytest.raises(ValueError, match="negative"):
        check_categories(d)


def test_categories_that_do_not_sum_to_the_run_are_rejected():
    with pytest.raises(ValueError, match="sum"):
        check_categories(interval(run_cyc=171))


def test_delta_and_add_are_inverse():
    a, b = interval(), interval(slot_cyc=130, run_cyc=200)
    d = delta(a, b)
    assert d["cmd"]["slot_cyc"] == 30 and d["vpu"] == [0] * 10
    assert add(a, d) == b
    assert categories(a) == categories(interval())
