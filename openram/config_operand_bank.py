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

output_name = "sky130_sram_512b_1rw_64x64"
output_path = "runs/sky130_sram_512b_1rw_64x64"
