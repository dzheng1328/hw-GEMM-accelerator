"""pytest unit tests for tb/perf/perflib.py and tb/perf/report.py (pure Python, no simulator)."""

import pytest

from perflib import COUNTERS, delta, links, make_record, metrics, node_key
from report import render_compare, render_table


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


def rec(name, cycles, util):
    return {"name": name, "workload": "gemm", "K": 8, "N": 32, "tiles": 1, "cycles": cycles,
            "metrics": {"util_mesh": util, "util_used": util, "max_link_occupancy": 0.5,
                        "host_in_occupancy": 0.25, "host_in_stall": 0.0, "host_out_occupancy": 0.75}}


def test_render_table_row():
    q8 = {**rec("gemm_K8_T1_q8", 99, 0.071), "output": "int8"}
    out = render_table([rec("gemm_K8_T1", 1234, 0.071), q8])
    # Records without an output field predate on-chip requant: raw int32.
    assert "| gemm_K8_T1 | 8 | 32 | 1 | int32 | 1234 | 7.1% | 7.1% | 50.0% | 75.0% | 25.0% | 0.0% |" in out
    assert "| gemm_K8_T1_q8 | 8 | 32 | 1 | int8 | 99 |" in out
    assert "(0,0) LOCAL out" in out.splitlines()[0]


def test_render_compare_speedup_and_new_rows():
    out = render_compare([rec("a", 1000, 0.1)], [rec("a", 500, 0.2), rec("b", 10, 0.3)])
    assert "| a | 1000 | 500 | 2.00x | 10.0% | 20.0% |" in out
    assert "| b | - | 10 | new | - | 30.0% |" in out
