# tb/Makefile -- cocotb flow for rtl/pe.v
# Assumes cocotb 1.8.x (see ../requirements.txt). Ported to the runner API
# if this project ever moves past cocotb 2.0.

include $(PWD)/common.mk

VERILOG_SOURCES = $(PWD)/../rtl/pe.v
TOPLEVEL = pe
MODULE = test_pe

SIM_BUILD = $(SIM_ROOT)/sim_build
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
