# tb/tile/Makefile -- cocotb + Icarus Verilog flow for rtl/tile.v
# (rtl/skew_feeder.v + rtl/systolic_array.v + rtl/pe.v).
# Assumes cocotb 1.8.x (see ../../requirements.txt).

SIM ?= icarus
TOPLEVEL_LANG ?= verilog

VERILOG_SOURCES = $(PWD)/../../rtl/pe.v \
                  $(PWD)/../../rtl/systolic_array.v \
                  $(PWD)/../../rtl/skew_feeder.v \
                  $(PWD)/../../rtl/tile.v

# Top-level Verilog module under test.
TOPLEVEL = tile

# Python module (tb/tile/test_tile.py, no .py).
MODULE = test_tile

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(PWD)/../../sim/sim_build_tile
COCOTB_RESULTS_FILE = $(PWD)/../../sim/sim_build_tile/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
