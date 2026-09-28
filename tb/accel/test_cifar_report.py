"""pytest for tb/accel/cifar_report.py."""

from cifar_report import render

RECORD = {"mesh": "2x2", "images": 128, "cycles": 18_750_000, "cycles_per_image": 146_484.4,
          "slot_utilization": 0.902, "counters": {"run_cyc": 18_750_000, "blocks": 303_360},
          "int8_accuracy": 0.8828, "float_accuracy": 0.8906, "float_agreement": 0.9922,
          "reference_agreement": 1.0}


def test_render_reports_accuracy_and_cycles():
    md = render(RECORD)
    assert "88.28%" in md and "89.06%" in md and "99.22%" in md
    assert "128" in md and "2x2" in md and "146,484" in md and "90.2%" in md
    assert "bit-exact" in md


def test_render_refuses_a_record_that_disagrees_with_the_reference():
    bad = dict(RECORD, reference_agreement=0.99)
    try:
        render(bad)
    except ValueError as e:
        assert "reference" in str(e)
    else:
        raise AssertionError("rendered a record whose predictions differ from the reference")
