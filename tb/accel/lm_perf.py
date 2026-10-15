"""Per-interval cycle categories of a story-model run (spec 4.3g section 2), shared by the test that checks them
(test_accel.py) and the report that prints them (lm_report.py).

An interval is a dict of counter deltas {"cmd": {cmd_perf and tagged counter: n}, "vpu": [vpu_perf cnt[0..9]],
"feed": [feed cycles per tile], "busy": [busy cycles per tile]}; a snapshot has the same shape (absolute values)."""

# rtl/cmd_perf.v's partition of the run cycles at node (0,0)'s injection port, and its tagged twins.
SPLIT = ("slot_cyc", "go_cyc", "inj_stall_cyc", "wait_cyc", "credit_cyc", "other_cyc")
ATTN = tuple("attn_" + k for k in SPLIT) + ("attn_blocks",)
CATEGORIES = ("weight matmuls", "attention", "VPU", "other")


def delta(a, b):
    """b minus a, counter by counter (both snapshots)."""
    return {"cmd": {k: b["cmd"][k] - a["cmd"][k] for k in b["cmd"]},
            "vpu": [y - x for x, y in zip(a["vpu"], b["vpu"])],
            "feed": [y - x for x, y in zip(a["feed"], b["feed"])],
            "busy": [y - x for x, y in zip(a["busy"], b["busy"])]}


def add(a, b):
    """The interval a followed by the interval b."""
    return {"cmd": {k: a["cmd"][k] + b["cmd"][k] for k in a["cmd"]},
            "vpu": [x + y for x, y in zip(a["vpu"], b["vpu"])],
            "feed": [x + y for x, y in zip(a["feed"], b["feed"])],
            "busy": [x + y for x, y in zip(a["busy"], b["busy"])]}


def categories(d):
    """The interval's run cycles as four counts: attention (every cycle with the tag set), the VPU (its busy
    cycles, which cmd_perf counts as wait cycles), weight matmuls (untagged cycles with a flit at the port or
    stalled), and other (the untagged wait cycles outside the VPU, credit stalls, and other cycles)."""
    c = d["cmd"]
    tagged = {k: c["attn_" + k] for k in SPLIT}
    vpu = d["vpu"][0]
    return {
        "weight matmuls": sum(c[k] - tagged[k] for k in SPLIT[:3]),
        "attention": sum(tagged.values()),
        "VPU": vpu,
        "other": (c["wait_cyc"] - tagged["wait_cyc"] - vpu) + (c["credit_cyc"] - tagged["credit_cyc"])
                 + (c["other_cyc"] - tagged["other_cyc"]),
    }


def check_categories(d, where="interval"):
    """categories(d), after checking that they partition run_cyc exactly and none is negative (a negative one
    means a tagged counter exceeds its twin, or a VPU cycle fell inside a tagged window)."""
    cats = categories(d)
    if min(cats.values()) < 0:
        raise ValueError(f"{where}: a negative category {cats}")
    if sum(cats.values()) != d["cmd"]["run_cyc"]:
        raise ValueError(f"{where}: the categories sum to {sum(cats.values())}, not run_cyc {d['cmd']['run_cyc']}")
    return cats
