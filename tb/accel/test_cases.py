"""pytest for tb/accel/cases.py."""

from cases import cycle_budget

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
