# tb/operand_mem/Makefile -- cocotb + Icarus Verilog flow for rtl/operand_mem.v,
# tested in isolation (not through the full tile) against the behavioral SRAM
# macro stand-in.
# Assumes cocotb 1.8.x (see ../../requirements.txt).

SIM ?= icarus
TOPLEVEL_LANG ?= verilog

VERILOG_SOURCES = $(PWD)/../../rtl/operand_mem.v \
                  $(PWD)/sram_macro_behavioral.v

# Top-level Verilog module under test.
TOPLEVEL = operand_mem

# Python module (tb/operand_mem/test_operand_mem.py, no .py).
MODULE = test_operand_mem

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(PWD)/../../sim/sim_build_operand_mem
COCOTB_RESULTS_FILE = $(PWD)/../../sim/sim_build_operand_mem/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
