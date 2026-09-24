"""Pure-Python side of the measurement harness (issue #54): counter names,
snapshot deltas, and derived metrics. No cocotb import, so pytest can test
it directly and tb/perf/report.py can reuse it.

Counters come from rtl/node_perf.v, one instance per mesh node. They are
free-running from reset; a measured region is the modulo-2^32 difference of
two snapshots. A mesh link's occupancy is its SENDER's out_xfer/out_stall
for that direction (counting at the receiver too would double-count).
"""

PORTS = ("l", "n", "e", "s", "w")  # index == router port: LOCAL, NORTH, EAST, SOUTH, WEST
COUNTERS = (
    "busy_cyc",
    "feed_cyc",
    *(f"out_xfer_{p}" for p in PORTS),
    *(f"out_stall_{p}" for p in PORTS),
    "lcl_in_xfer",
    "lcl_in_stall",
)
# Every fed cycle drives one MAC in each of the 8x8 PEs.
MACS_PER_FEED_CYCLE = 64
_DIRS = {"n": (0, 1), "e": (1, 0), "s": (0, -1), "w": (-1, 0)}


def node_key(x, y):
    return f"{x},{y}"


def delta(before, after):
    return {
        node: {c: (after[node][c] - before[node][c]) % (1 << 32) for c in COUNTERS}
        for node in after
    }


def links(width, height):
    """Every directed mesh link as (src_key, direction, dst_key)."""
    out = []
    for y in range(height):
        for x in range(width):
            for d, (dx, dy) in _DIRS.items():
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height:
                    out.append((node_key(x, y), d, node_key(nx, ny)))
    return out


def metrics(d, cycles, width, height, tiles_used, host="0,0"):
    feed = sum(n["feed_cyc"] for n in d.values())
    occ, stall = {}, {}
    for src, direction, dst in links(width, height):
        name = f"{src}->{dst}"
        occ[name] = d[src][f"out_xfer_{direction}"] / cycles
        stall[name] = d[src][f"out_stall_{direction}"] / cycles
    return {
        "cycles": cycles,
        "macs": MACS_PER_FEED_CYCLE * feed,
        "util_mesh": feed / (cycles * width * height),
        "util_used": feed / (cycles * tiles_used),
        "tile_busy": {node: n["busy_cyc"] / cycles for node, n in d.items()},
        "link_occupancy": occ,
        "link_stall": stall,
        "max_link_occupancy": max(occ.values()),
        "host_in_occupancy": d[host]["lcl_in_xfer"] / cycles,
        "host_in_stall": d[host]["lcl_in_stall"] / cycles,
        "host_out_occupancy": d[host]["out_xfer_l"] / cycles,
    }


def make_record(name, d, cycles, width, height, tiles_used, **meta):
    return {
        "name": name,
        **meta,
        "tiles": tiles_used,
        "cycles": cycles,
        "counters": d,
        "metrics": metrics(d, cycles, width, height, tiles_used),
    }
