# tb/requant/Makefile -- cocotb flow for rtl/requant.v (one int32 -> int8
# requantization lane), checked against model/fixedpoint.py.

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/../../rtl/requant.v

# Top-level Verilog module under test.
TOPLEVEL = requant

# Python module (tb/requant/test_requant.py, no .py).
MODULE = test_requant

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(SIM_ROOT)/sim_build_requant
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build_requant/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
