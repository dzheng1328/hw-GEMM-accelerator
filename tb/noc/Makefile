# tb/noc/Makefile -- cocotb + Icarus Verilog flow for rtl/noc_pair.v (two
# router+tile NoC nodes over a registered link -- the full RTL stack).
# Assumes cocotb 1.8.x (see ../../requirements.txt).

SIM ?= icarus
TOPLEVEL_LANG ?= verilog

VERILOG_SOURCES = $(PWD)/../../rtl/pe.v \
                  $(PWD)/../../rtl/systolic_array.v \
                  $(PWD)/../../rtl/skew_feeder.v \
                  $(PWD)/../../rtl/tile.v \
                  $(PWD)/../../rtl/operand_mem.v \
                  $(PWD)/../../rtl/gemm_sequencer.v \
                  $(PWD)/../../rtl/gemm_tile.v \
                  $(PWD)/../../rtl/router.v \
                  $(PWD)/../../rtl/flit_buf.v \
                  $(PWD)/../../rtl/noc_node.v \
                  $(PWD)/../../rtl/noc_pair.v

# Top-level Verilog module under test.
TOPLEVEL = noc_pair

# Python module (tb/noc/test_noc.py, no .py).
MODULE = test_noc

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(PWD)/../../sim/sim_build_noc
COCOTB_RESULTS_FILE = $(PWD)/../../sim/sim_build_noc/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
