"""pytest for tb/accel/scaling_report.py."""

import pytest

from scaling_report import combine, render

CORNER = {"lcl_in_xfer": 0, "lcl_in_stall": 0, "out_xfer_l": 0, "out_xfer_n": 0, "out_xfer_e": 0,
          "out_stall_n": 0, "out_stall_e": 0}


def record(mesh, tiles, run, inj_stall):
    slots, blocks = 5_400, 100
    feed = [slots // tiles] * tiles
    feed[0] += slots - sum(feed)
    return {"mesh": mesh, "images": 2, "int8_accuracy": 0.75, "reference_agreement": 1.0,
            "counters": {"run_cyc": run, "blocks": blocks, "slot_cyc": slots, "inj_stall_cyc": inj_stall,
                         "wait_cyc": 10, "credit_cyc": 0, "wb_words": 200},
            "mesh_perf": {"corner": dict(CORNER, lcl_in_xfer=slots + blocks, lcl_in_stall=inj_stall),
                          "feed_cyc": feed, "busy_cyc": feed}}


RECORDS = [record("4x4", 16, 5_830, 20), record("1x1", 1, 12_000, 6_000),
           record("2x2", 4, 5_900, 90), record("2x1", 2, 7_000, 1_000)]


def test_combine_orders_by_tile_count():
    assert [r["mesh"] for r in combine(RECORDS)] == ["1x1", "2x1", "2x2", "4x4"]


def test_render_reports_speedup_floor_and_saturation():
    md = render(RECORDS)
    assert "| 4x4 | 16 | 2,915 | 2.06x |" in md
    assert "floor of 2,750 cycles per image" in md    # (5,400 slots + 100 GOs) / 2 images
    assert "saturates at **2x2**" in md               # 2x2 is within 5% of 4x4; 2x1 is not
    assert "xychart-beta" in md and "line [1, 2, 4, 16]" in md
    assert "bit-exact" in md and "—" not in md


@pytest.mark.parametrize("field,value,message", [
    ("reference_agreement", 0.99, "reference"),
    ("images", 3, "different numbers of images"),
])
def test_combine_refuses_inconsistent_records(field, value, message):
    bad = dict(RECORDS[2], **{field: value})
    with pytest.raises(ValueError, match=message):
        combine(RECORDS[:2] + [bad])


def test_combine_refuses_feeds_that_do_not_match_the_slots_sent():
    bad = record("2x2", 4, 5_900, 90)
    bad["mesh_perf"]["feed_cyc"][0] -= 1
    with pytest.raises(ValueError, match="slots"):
        combine([bad])


def test_combine_refuses_a_mesh_twice():
    with pytest.raises(ValueError, match="same mesh"):
        combine(RECORDS + [RECORDS[0]])
