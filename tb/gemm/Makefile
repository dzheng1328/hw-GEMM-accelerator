# tb/gemm/Makefile -- cocotb flow for rtl/gemm_tile.v
# (rtl/gemm_sequencer.v + rtl/tile.v + rtl/skew_feeder.v + rtl/systolic_array.v
# + rtl/pe.v). Assumes cocotb 1.8.x (see ../../requirements.txt).

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/../../rtl/pe.v \
                  $(PWD)/../../rtl/systolic_array.v \
                  $(PWD)/../../rtl/skew_feeder.v \
                  $(PWD)/../../rtl/tile.v \
                  $(PWD)/../../rtl/operand_mem.v \
                  $(PWD)/../operand_mem/sram_macro_behavioral.v \
                  $(PWD)/../../rtl/gemm_sequencer.v \
                  $(PWD)/../../rtl/gemm_tile.v

# Top-level Verilog module under test.
TOPLEVEL = gemm_tile

# Python module (tb/gemm/test_gemm.py, no .py).
MODULE = test_gemm

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(SIM_ROOT)/sim_build_gemm
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build_gemm/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
