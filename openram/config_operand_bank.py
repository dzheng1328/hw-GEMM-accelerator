# openram/config_operand_bank.py -- OpenRAM config for operand_mem's per-bank
# SRAM macro: one 64-word x 64-bit single-port (1RW) sky130 bank. Generated
# once here (issue #31); rtl/operand_mem.v's two identical banks (a_ram,
# b_ram) each get their own instance of this macro in issue #32, since both
# banks share this exact geometry.
#
# Sizing: operand_mem's real, only-ever-used config is N=8, KMAX=8, giving
# DEPTH = N*KMAX = 64 words per bank, each 8*N = 64 bits wide. See
# docs/superpowers/specs/2026-08-29-operand-mem-sram-macro-design.md for the
# full sizing math and the generation-path/bank-layout/port-config decisions.

word_size = 64
num_words = 64
num_rw_ports = 1
num_r_ports = 0
num_w_ports = 0

# num_spare_rows/num_spare_cols: required padding, not a sizing change.
#
# A real generation run (Task 2, see openram/reports/summary.md) hit a real
# OpenRAM error here: with word_size=64, num_words=64, this sizes to
# words_per_row=1 -> num_cols=64, num_rows=64. sky130's tech.py sets
# array_col_multiple=array_row_multiple=2 (compiler/sram_config.py
# recompute_sizes()), and with a single port (num_rw_ports=1) that check is
# "(num_cols + num_ports) % array_col_multiple == 0" -- 64+1=65 is odd, so it
# hard-errors ("Invalid number of cols including rbl(s)"; the equivalent row
# check would fail the same way right after). OpenRAM's own regression suite
# hits this exact case and works around it the same way: 1 spare row + 1
# spare column, and even special-cases it by tech name
# (compiler/tests/20_sram_1bank_nomux_spare_cols_test.py: "if
# OPTS.tech_name == 'sky130': num_spare_rows = 1; num_spare_cols = 1"). This
# is standard OpenRAM/sky130 practice for any single-port macro whose
# natural row/column count is even, not a change to the macro's logical
# shape -- still 64 words x 64 bits, RW port 1; the spare row/column are
# unused redundant array cells OpenRAM adds purely to satisfy sky130's
# column-mux/row layout parity constraint.
num_spare_rows = 1
num_spare_cols = 1

# words_per_row: force a real 2:1 column mux instead of OpenRAM's auto-sized
# no-mux (words_per_row=1) layout.
#
# A real generation run (Task 2) got past sizing/submodule generation with
# the fix above, then hit a second, real, reproducible OpenRAM v1.2.48
# supply-router failure (compiler/router/supply_router.py: "Couldn't route
# from ... to ..." trying to route a vdd path on met3) -- confirmed
# independent of PDK version (identical failure against both the cached
# volare PDK and the exact commit OpenRAM's own Makefile pins) and not fixed
# by two other config-only options (supply_pin_type="left" hits an unrelated
# router TypeError bug in this OpenRAM version; num_spare_cols=3 fails the
# same way at different coordinates).
#
# technology/sky130/sky130_sram_common.py itself has a live comment flagging
# this exact class of failure: "Local wordlines have issues with met3 power
# routing for now" / "#local_array_size = 16". More tellingly: every real
# 1RW sky130 macro OpenRAM ships (macros/sram_configs/sky130_sram_*_1rw_*.py)
# uses word_size=32 with num_words in the hundreds/thousands, which its own
# estimate_words_per_row() heuristic always sizes to words_per_row>1 (a real
# column mux) -- none of OpenRAM's shipped sky130 1RW references are the
# no-mux (words_per_row=1) shape our word_size=64/num_words=64 geometry
# happens to produce, and the only no-mux test case in the regression suite
# (20_sram_1bank_nomux_spare_cols_test.py) is 128 bits, nowhere near this
# macro's 4096 bits. No evidence anyone has gotten a no-mux macro at this
# scale to route on this OpenRAM/sky130 combination.
#
# words_per_row is a purely internal OpenRAM physical-layout knob (same
# settable-top-level-config mechanism already proven for num_spare_rows/
# num_spare_cols above) -- it changes how the array is organized in silicon,
# not operand_mem's external interface: still exactly one 64-bit word
# read/written per access, a column mux is transparent to the port. Setting
# it to 2 doubles num_cols to 128 (num_cols = words_per_row * word_size),
# which still satisfies sky130's array_col_multiple=2 parity check
# ((128 + 1 num_rw_port + 1 num_spare_col) % 2 == 0) with no other changes.
#
# CONFIRMED (Task 2, real run): this does fix the supply-router failure --
# "** Routing: 394.1 seconds" completes with no error, versus the prior
# unconditional crash. It does NOT, however, produce a clean macro: the same
# run's real DRC/LVS pass (see use_conda fix below, which is what let
# DRC/LVS actually execute) found 52200 real DRC violations and a real LVS
# mismatch, and generation still never reaches the point where the .gds/.lef
# are written -- it crashes later in delay-characterization setup
# (characterizer/simulation.py: "Could not find bl net in timing paths."),
# a separate, third real OpenRAM bug/incompatibility with this word-mux
# configuration. No openram/reports/summary.md was written for this run --
# per this task's own brief, a run with real DRC/LVS violations is not
# reported as a clean success. Full real log evidence is in Task 2's report
# (.superpowers/sdd/2026-08-29-operand-mem-sram-macro/task-2-report.md) and
# will be distilled into docs/learnings.md. This macro is NOT clean; do not
# treat words_per_row=2 as a solved/working configuration.
words_per_row = 2

# NOTE: this is "sky130", not "sky130A" -- "sky130A" is the PDK_ROOT variant
# directory name (what PDKPATH points at), a different string in a different
# role. OpenRAM's own technology/ directory (confirmed against the v1.2.48
# release tag) names this tech "sky130". See Task 1's ruling in
# .superpowers/sdd/2026-08-29-operand-mem-sram-macro/task-1-report.md.
tech_name = "sky130"
process_corners = ["TT"]
supply_voltages = [1.8]

# Match OpenRAM's own reference sky130 1RW macro configs
# (macros/sram_configs/sky130_sram_common.py, e.g. sky130_sram_1rw_tiny.py /
# sky130_sram_1kbyte_1rw_32x256_8.py -- the closest known-good precedent for
# a single-port sky130 macro this shape). check_lvsdrc defaults to False in
# OpenRAM (compiler/options.py) -- without it, DRC/LVS never actually runs,
# which would make this task's "DRC violations / LVS mismatches" numbers
# meaningless. uniquify/nominal_corner_only are the other two options every
# sky130 1RW reference config sets alongside it.
check_lvsdrc = True
uniquify = True
nominal_corner_only = True

# use_conda: this Docker toolchain image (vlsida/openram-ubuntu) has magic/
# netgen/ngspice/klayout installed system-wide (all found fine via plain
# PATH -- confirmed by every run reaching magic at all), but no conda/
# miniconda. use_conda defaults to True in OpenRAM (compiler/options.py),
# which makes compiler/verify/run_script.py unconditionally prepend
# "source {CONDA_HOME}/bin/activate" to every DRC/LVS/ext shell script it
# generates (run_drc.sh, run_lvs.sh, ...). With no conda installed that
# source fails immediately, the script produces no other output, and
# verify/magic.py then can't find a "Total DRC errors found:" line to parse
# -- surfacing as "Unable to find the total error line in Magic output."
# Confirmed directly: a real run with -k (keep temp dir, OPENRAM_TMP pointed
# at a host-visible path) showed .drc.out completely empty and .drc.err
# containing exactly "run_drc.sh: line 2: /openram/miniconda/bin/activate:
# No such file or directory". use_conda=False skips that wrapping entirely
# (and the earlier-harmless-but-noisy install_conda.sh attempt every run
# log shows).
use_conda = False

# use_nix: a genuinely NEW config need, first hit on Task 2's OpenRAM version
# bump (v1.2.48 -> commit b2b069ce, see run_operand_sram.sh's OPENRAM_COMMIT
# comment). This OpenRAM version's compiler/globals.py:init_openram() now
# unconditionally calls install_nix() unless OPTS.use_nix=False, which
# hard-errors immediately ("Nix is required for automatic tool setup, but
# 'nix' was not found in PATH.") because this Docker toolchain image
# (vlsida/openram-ubuntu) has no nix installed -- the exact same class of
# problem as the use_conda fix above (a new tool-bootstrap mechanism this
# image doesn't have). Confirmed via compiler/options.py's own doc comment:
# "Use Nix to initialize the default open-source toolchain. If disabled,
# OpenRAM uses whatever tools are already in PATH." -- and this image's
# magic/netgen/ngspice/klayout are already confirmed on PATH (see the
# use_conda fix's own investigation). Checked both call sites gated by this
# flag (compiler/verify/run_script.py, compiler/characterizer/stimuli.py):
# both simply run the tool command directly, unwrapped, when use_nix=False.
use_nix = False

output_name = "sky130_sram_512b_1rw_64x64"
output_path = "runs/sky130_sram_512b_1rw_64x64"
