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

# NOTE: this is "sky130", not "sky130A" -- "sky130A" is the PDK_ROOT variant
# directory name (what PDKPATH points at), a different string in a different
# role. OpenRAM's own technology/ directory (confirmed against the v1.2.48
# release tag) names this tech "sky130". See Task 1's ruling in
# .superpowers/sdd/2026-08-29-operand-mem-sram-macro/task-1-report.md.
tech_name = "sky130"
process_corners = ["TT"]
supply_voltages = [1.8]

output_name = "sky130_sram_512b_1rw_64x64"
output_path = "runs/sky130_sram_512b_1rw_64x64"
