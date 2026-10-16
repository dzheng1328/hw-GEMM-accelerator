"""pytest for tb/accel/lm_report.py, on a small synthetic fixture (the real records are minutes of simulation)."""

import json

import numpy as np
import pytest

import lm_report
from lm_perf import add

PIECES = np.array(["<unk>", "<s>", "</s>", "▁once", "▁a", "▁cat", "▁sat", "▁big", "<0x0A>"])


def step(tiles=2, k=1):
    """One decode step's counter deltas (170 cycles: 69 weight + 50 attention + 30 VPU + 21 other), times k."""
    cmd = {"run_cyc": 170, "blocks": 4, "wb_words": 8, "slot_cyc": 100, "go_cyc": 10, "inj_stall_cyc": 5,
           "wait_cyc": 50, "credit_cyc": 1, "other_cyc": 4,
           "attn_slot_cyc": 40, "attn_go_cyc": 4, "attn_inj_stall_cyc": 2, "attn_wait_cyc": 3,
           "attn_credit_cyc": 0, "attn_other_cyc": 1, "attn_blocks": 2}
    feed = [60, 40] if tiles == 2 else [100]  # the tiles' feed cycles sum to the slots injected
    return {"cmd": {n: v * k for n, v in cmd.items()}, "vpu": [30 * k] + [3 * k] * 8 + [6 * k],
            "feed": [f * k for f in feed], "busy": [95 * k, 85 * k][:tiles]}


def tail(tiles=2, k=1):
    cmd = {n: 0 for n in step()["cmd"]}
    cmd.update(run_cyc=3 * k, other_cyc=3 * k)
    return {"cmd": cmd, "vpu": [0] * 10, "feed": [0] * tiles, "busy": [0] * tiles}


def tokens(steps, inv_temp):
    base = [1, 3, 4, 5, 6] + [7] * (steps - 4)
    if inv_temp == 0:
        return [list(base) for _ in range(8)]
    return [base[:5] + [3 + (s + i) % 5 for i in range(steps - 4)] for s in range(8)]


def record(mesh, inv_temp, steps=6, tiles=2, k=1):
    """A consistent run record: every counter is the sum of its step intervals and the tail (k scales the cycles)."""
    total = tail(tiles, k)
    for _ in range(steps):
        total = add(step(tiles, k), total)
    c = total["cmd"]
    return {
        "case": f"lm_story_t{inv_temp}", "mesh": mesh, "steps": steps, "inv_temp": inv_temp,
        "cycles": c["run_cyc"], "slots": c["slot_cyc"], "blocks": c["blocks"],
        "slot_utilization": c["slot_cyc"] / c["run_cyc"],
        "counters": {n: v for n, v in c.items() if not n.startswith("attn_")},
        "attn": {n: v for n, v in c.items() if n.startswith("attn_")},
        "vpu": total["vpu"],
        "mesh_perf": {"corner": {"lcl_in_xfer": c["slot_cyc"] + c["go_cyc"], "lcl_in_stall": c["inj_stall_cyc"],
                                 "out_xfer_l": 0, "out_xfer_n": 0, "out_xfer_e": 0, "out_stall_n": 0,
                                 "out_stall_e": 0},
                      "feed_cyc": total["feed"], "busy_cyc": total["busy"]},
        "step_deltas": [step(tiles, k) for _ in range(steps)], "tail": tail(tiles, k),
        "tokens": tokens(steps, inv_temp),
    }


def records(steps=6):
    return [record("2x2", 0, steps), record("2x2", 256, steps), record("1x1", 256, steps, tiles=1, k=2),
            record("4x4", 256, steps)]


def q():
    return {"vocab": PIECES, "float_val_loss": np.float64(1.24), "int_val_loss": np.float64(1.30)}


def test_combine_keys_the_four_required_runs():
    assert set(lm_report.combine(records())["runs"]) == {"2x2_t0", "2x2_t256", "1x1_t256", "4x4_t256"}


@pytest.mark.parametrize("break_it, match", [
    (lambda rs: rs.pop(), "missing"),
    (lambda rs: rs[0]["tokens"][3].__setitem__(5, 3), "temperature 0"),
    (lambda rs: rs[1].__setitem__("tokens", tokens(6, 0)), "identical"),
    (lambda rs: rs[2]["tokens"][0].__setitem__(5, 6), "mesh"),
    (lambda rs: rs[0]["counters"].__setitem__("other_cyc", 99), "sum"),
    (lambda rs: rs[0]["step_deltas"][2]["cmd"].__setitem__("attn_wait_cyc", 60), "negative"),
    (lambda rs: rs[0]["step_deltas"].pop(), "steps"),
])
def test_combine_rejects_a_bad_record(break_it, match):
    rs = records()
    break_it(rs)
    with pytest.raises(ValueError, match=match):
        lm_report.combine(rs)


def test_combine_requires_the_intervals_to_sum_to_the_totals():
    rs = records()
    rs[3]["step_deltas"][0]["feed"][0] += 1
    with pytest.raises(ValueError, match="sum"):
        lm_report.combine(rs)


def ended_records():
    """records() with story 0 at temperature 1.0 (on every mesh) given a second paragraph and then a BOS at row 7,
    which step 6 sampled: the model ends a story with a BOS (llama2.c), not an EOS."""
    rs = records(steps=10)
    for r in rs[1:]:
        r["tokens"][0][5:10] = [8, 7, 1, 3, 4]
    return rs


@pytest.mark.parametrize("log, end", [([1, 3, 4, 1, 5], 2), ([1, 3, 2, 1], 2), ([1, 3, 4], None), ([1], None)])
def test_a_story_ends_at_the_step_that_sampled_the_next_bos(log, end):
    """As model/lm_tok.py decodes it: the next BOS ends the story, an EOS is skipped (the model never samples one)."""
    assert lm_report.story_end(log) == end


def test_render_quotes_each_paragraph_and_names_the_step_a_story_ended():
    out = lm_report.render(lm_report.combine(ended_records()), q())
    assert "**Story 0** (ends at step 6)" in out and "**Story 1**\n" in out
    assert "> once a cat sat\n>\n> big\n" in out  # a paragraph break stays one inside the quote
    assert not any(line != line.rstrip() for line in out.splitlines())


def test_render_holds_the_stories_the_breakdown_and_the_scaling_table():
    out = lm_report.render(lm_report.combine(records()), q())
    assert "do not edit" in out
    assert "once a cat sat" in out  # decoded text of a story
    assert "| weight matmuls |" in out and "| attention |" in out and "| VPU |" in out and "| other |" in out
    assert "| 1x1 |" in out and "| 2x2 |" in out and "| 4x4 |" in out
    assert "1.297" in out and "1.24" in out and "1.30" in out and "0.06" in out
    assert "identical" in out  # the temperature 0 note
    assert "```mermaid" in out
    # a lone line takes the palette's first color, near white in mermaid's default theme, so the chart sets its own
    assert '"plotColorPalette": "#2563eb"' in out and 'x-axis "First step of the 32-step bucket" ["0"]' in out
    assert "\u2014" not in out  # the em dash is banned in docs


def test_trace_names_its_source_and_holds_per_step_breakdowns(monkeypatch):
    probs = [[np.full((8, t + 1), 5, dtype=np.int64) for _ in range(5)] for t in range(6)]

    def fake_generate(qq, prompt, steps, inv_temp, seeds, return_probs=False, **kw):
        assert inv_temp == 256 and return_probs
        return np.array(tokens(steps, 256)).T, probs

    monkeypatch.setattr("lm_reference.generate", fake_generate)
    qq = dict(q(), prompt_ids=np.array([1, 3, 4, 5, 6]), seeds=np.arange(8))
    t = lm_report.trace(lm_report.combine(records()), qq)
    json.dumps(t)
    assert t["attention"]["source"].startswith("model/lm_reference.py")
    assert len(t["steps"]) == 6 and len(t["stories"]) == 8 and t["config"]["mesh"] == "2x2"
    assert set(t["steps"][0]["categories"]) == {"weight matmuls", "attention", "VPU", "other"}
    assert len(t["steps"][0]["tile_busy"]) == 2
    assert len(t["attention"]["probs"]) == 6 and len(t["attention"]["probs"][3][4]) == 8
    assert len(t["attention"]["probs"][3][4][0]) == 4
    assert [s["end_step"] for s in t["stories"]] == [None] * 8


def test_trace_names_the_step_a_story_ended(monkeypatch):
    rs = ended_records()
    monkeypatch.setattr("lm_reference.generate", lambda *a, **kw: (np.array(rs[1]["tokens"]).T, []))
    t = lm_report.trace(lm_report.combine(rs), dict(q(), prompt_ids=np.array([1, 3, 4, 5, 6]), seeds=np.arange(8)))
    assert [s["end_step"] for s in t["stories"]] == [6] + [None] * 7
    assert t["stories"][0]["text"] == "once a cat sat\n big"  # as model/lm_tok.py decodes it
