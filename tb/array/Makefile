# tb/array/Makefile -- cocotb + Icarus Verilog flow for rtl/systolic_array.v
# Assumes cocotb 1.8.x (see ../../requirements.txt). Ported to the runner API
# if this project ever moves past cocotb 2.0.

SIM ?= icarus
TOPLEVEL_LANG ?= verilog

VERILOG_SOURCES = $(PWD)/../../rtl/pe.v $(PWD)/../../rtl/systolic_array.v

# Top-level Verilog module under test.
TOPLEVEL = systolic_array

# Python module (tb/array/test_systolic_array.py, no .py).
MODULE = test_systolic_array

# Separate build dir from tb/Makefile's so the two suites never clobber
# each other's artifacts.
SIM_BUILD = $(PWD)/../../sim/sim_build_array
COCOTB_RESULTS_FILE = $(PWD)/../../sim/sim_build_array/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
