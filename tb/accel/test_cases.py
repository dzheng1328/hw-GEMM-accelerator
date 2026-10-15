"""pytest for tb/accel/cases.py."""

import pytest

from cases import PROBES, cycle_budget, lm_extra_cycles, probe_message, probe_programs
from golden import Golden, GoldenError

# Measured (docs/decisions.md, docs/perf/cifar.md): tiles, slots, words
# written back, cycles (cmd_perf run_cyc).
MEASURED = {
    "rand1 2x2": (4, 1536, 4608, 5532),             # result-delivery bound
    "small 2x2": (4, 9248, 1024, 11479),            # injection bound
    "small 1x1": (1, 9248, 1024, 23351),            # one tile computes everything
    "cifar128 2x2": (4, 16_910_336, 671_744, 18_742_977),
}


def test_budget_leaves_margin_over_every_measured_run():
    for name, (tiles, slots, words, cycles) in MEASURED.items():
        assert cycle_budget(slots, words, tiles) >= 1.5 * cycles, name


def test_budget_ends_a_hung_run_within_a_few_times_its_real_length():
    for name, (tiles, slots, words, cycles) in MEASURED.items():
        assert cycle_budget(slots, words, tiles) <= 3 * cycles + 10_000, name


# Story-model runs (cmd_perf run_cyc): tiles, slots, words written back, steps, VOPs, cycles.
LM_MEASURED = {
    "lm_t0 2x2": (4, 378_880, 59_520, 10, 480, 699_392),
    "lm_t0 1x1": (1, 378_880, 59_520, 10, 480, 1_175_582),
    "lm_real8 4x3": (12, 299_008, 46_592, 8, 384, 528_012),
    "lm_full 2x2": (4, 19_726_336, 4_030_464, 256, 12_288, 62_661_872),
}


def lm_budget(tiles, slots, words, steps, vops):
    return cycle_budget(slots, words, tiles) + lm_extra_cycles(steps, vops, slots)


def test_lm_budget_leaves_margin_over_every_measured_run():
    for name, (tiles, slots, words, steps, vops, cycles) in LM_MEASURED.items():
        assert lm_budget(tiles, slots, words, steps, vops) >= 1.5 * cycles, name


def test_lm_budget_ends_a_hung_run_within_a_few_times_its_real_length():
    for name, (tiles, slots, words, steps, vops, cycles) in LM_MEASURED.items():
        assert lm_budget(tiles, slots, words, steps, vops) <= 3 * cycles + 10_000, name


@pytest.mark.parametrize("name", sorted(probe_programs()))
def test_every_fault_probe_is_a_golden_fault_at_the_pc_its_message_names(name):
    program, message, pc = probe_programs()[name]
    with pytest.raises(GoldenError) as e:
        Golden(1, 1, program, [], []).run()
    assert e.value.pc == pc and message.endswith(f"at pc {pc}")
    assert probe_message(name, 2, 2) == message


def test_the_probe_list_has_the_mesh_probe_and_every_program_probe():
    assert PROBES[0] == "wrong_mesh" and set(PROBES[1:]) == set(probe_programs())
    assert probe_message("wrong_mesh", 4, 3) == "is outside the 4x3 mesh"
