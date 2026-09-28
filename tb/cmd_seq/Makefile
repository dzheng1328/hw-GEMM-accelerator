# tb/cmd_seq/Makefile -- cocotb flow for rtl/cmd_seq.v, the command
# processor's sequencer, through tb/cmd_seq/cmd_seq_tb.v (4x3 mesh, FATAL = 0
# so faults can be inspected; tb/accel's error-check covers FATAL = 1).

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/cmd_seq_tb.v $(PWD)/../../rtl/cmd_seq.v $(PWD)/../../rtl/sim_mem.v
TOPLEVEL = cmd_seq_tb
MODULE = test_cmd_seq

SIM_BUILD = $(SIM_ROOT)/sim_build_cmd_seq
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build_cmd_seq/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
