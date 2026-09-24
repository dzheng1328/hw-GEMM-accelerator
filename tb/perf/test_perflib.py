"""pytest unit tests for tb/perf/perflib.py (pure Python, no simulator)."""

import pytest

from perflib import COUNTERS, delta, links, make_record, metrics, node_key


def zero_node():
    return {c: 0 for c in COUNTERS}


def mesh2x2(**overrides):
    """All-zero counters for a 2x2 mesh; overrides maps node_key -> {counter: value}."""
    d = {node_key(x, y): zero_node() for y in range(2) for x in range(2)}
    for key, vals in overrides.items():
        d[key].update(vals)
    return d


def test_counter_names_match_rtl():
    assert COUNTERS == (
        "busy_cyc", "feed_cyc",
        "out_xfer_l", "out_xfer_n", "out_xfer_e", "out_xfer_s", "out_xfer_w",
        "out_stall_l", "out_stall_n", "out_stall_e", "out_stall_s", "out_stall_w",
        "lcl_in_xfer", "lcl_in_stall",
    )


def test_delta_wraps_modulo_2_32():
    before = mesh2x2(**{"0,0": {"busy_cyc": 0xFFFF_FFF0}})
    after = mesh2x2(**{"0,0": {"busy_cyc": 0x0000_0010}})
    assert delta(before, after)["0,0"]["busy_cyc"] == 0x20


def test_links_2x2_are_the_eight_directed_edges():
    assert sorted(links(2, 2)) == sorted([
        ("0,0", "e", "1,0"), ("1,0", "w", "0,0"),
        ("0,1", "e", "1,1"), ("1,1", "w", "0,1"),
        ("0,0", "n", "0,1"), ("0,1", "s", "0,0"),
        ("1,0", "n", "1,1"), ("1,1", "s", "1,0"),
    ])


def test_metrics_utilization_and_occupancy():
    d = mesh2x2(**{
        "1,0": {"feed_cyc": 100, "busy_cyc": 150, "out_xfer_w": 50, "out_stall_w": 20},
        "0,0": {"lcl_in_xfer": 40, "lcl_in_stall": 10, "out_xfer_l": 60},
    })
    m = metrics(d, cycles=200, width=2, height=2, tiles_used=1)
    assert m["cycles"] == 200
    assert m["macs"] == 6400
    assert m["util_mesh"] == pytest.approx(100 / (200 * 4))
    assert m["util_used"] == pytest.approx(100 / 200)
    assert m["tile_busy"]["1,0"] == pytest.approx(0.75)
    assert m["link_occupancy"]["1,0->0,0"] == pytest.approx(0.25)
    assert m["link_stall"]["1,0->0,0"] == pytest.approx(0.10)
    assert m["max_link_occupancy"] == pytest.approx(0.25)
    assert m["host_in_occupancy"] == pytest.approx(0.20)
    assert m["host_in_stall"] == pytest.approx(0.05)
    assert m["host_out_occupancy"] == pytest.approx(0.30)


def test_make_record_carries_meta_and_counters():
    d = mesh2x2()
    r = make_record("gemm_K8_T1", d, 100, 2, 2, 1, workload="gemm", K=8, N=32)
    assert r["name"] == "gemm_K8_T1"
    assert (r["workload"], r["K"], r["N"], r["tiles"], r["cycles"]) == ("gemm", 8, 32, 1, 100)
    assert r["counters"] == d
    assert r["metrics"]["cycles"] == 100
