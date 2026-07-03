# tb/Makefile -- cocotb + Icarus Verilog flow for rtl/pe.v
# Assumes cocotb 1.8.x (see ../requirements.txt). Ported to the runner API
# if this project ever moves past cocotb 2.0.

SIM ?= icarus
TOPLEVEL_LANG ?= verilog

VERILOG_SOURCES = $(PWD)/../rtl/pe.v
TOPLEVEL = pe
MODULE = test_pe

SIM_BUILD = $(PWD)/../sim/sim_build
COCOTB_RESULTS_FILE = $(PWD)/../sim/sim_build/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
